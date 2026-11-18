/* Core: backend client, document/tab state, canvas documents and generation.

   The graph engine is Vue Flow (js/infcanvas-flow.js). Documents hold plain
   JSON (nodes / edges / viewport); there is no LiteGraph graph object any more,
   and nothing here registers node types with ComfyUI's graph.

   Storage: payloads written by the old LiteGraph canvas are `version: 1` with a
   `graph: { nodes: [{ id, type, pos, size, properties }], links: [...] }`.
   `hydrate()` still reads those and converts them into canvas nodes, so every
   canvas saved before the switch opens unchanged. New saves are `version: 2`. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. Named `tr` (not `t`)
     because toast() below has a local `t` bound to the host toast object. */
  const tr = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

  const APP = () => NS.app || window.comfyAPI?.app?.app;
  const API = () => window.comfyAPI?.api?.api;
  const EXT = () => APP()?.extensionManager;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const uid = () => "ic_" + Math.random().toString(36).slice(2, 10);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  /* Robust text decoding for pasted / dropped .txt / .md files, ported from the
     reference xcat-paste.js: UTF-8 (with BOM) -> UTF-16 BOM -> GBK -> lenient
     UTF-8, so Chinese ANSI/GBK files don't turn into mojibake. */
  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return new TextDecoder("utf-8").decode(u8.subarray(3));
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      try { return new TextDecoder("utf-16le").decode(u8.subarray(2)); } catch (error) { /* fall through */ }
    }
    if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
      try { return new TextDecoder("utf-16be").decode(u8.subarray(2)); } catch (error) { /* fall through */ }
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (error) { /* fall through */ }
    try { return new TextDecoder("gbk").decode(u8); } catch (error) { /* fall through */ }
    return new TextDecoder("utf-8").decode(u8);
  }
  async function readTextFile(file) {
    if (file.arrayBuffer) return decodeText(await file.arrayBuffer());
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(decodeText(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  const EXT_KIND = {
    png: "image", jpg: "image", jpeg: "image", webp: "image", gif: "image",
    bmp: "image", avif: "image", svg: "image",
    mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video",
    mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", m4a: "audio",
    txt: "text", md: "text", json: "text", csv: "text",
  };
  const kindFromFile = (name) => EXT_KIND[String(name).split(".").pop().toLowerCase()] || null;

  /* `size` is the whole frame for every node (no title bar any more).
     ONE node type per medium: 图像 / 视频 / 音频 are generators by default and
     turn into material nodes the moment a file lands on them. `data.asset` is
     the only discriminator — a material node is a final state (delete + create
     to get a generator back), so there is no separate role for the two states.
     Text stays its own role: it is never uploaded, only typed/pasted. */
  const SPECS = [
    { type: "infcanvas/media_image", role: "media", kind: "image", title: "图像", desc: "图片素材，或调用 ComfyUI 生成图片", icon: "pi pi-image", workflow: "image", size: [480, 270] },
    { type: "infcanvas/media_video", role: "media", kind: "video", title: "视频", desc: "视频素材，或调用 ComfyUI 生成视频", icon: "pi pi-video", workflow: "video", size: [480, 270] },
    { type: "infcanvas/media_audio", role: "media", kind: "audio", title: "音频", desc: "音频素材，或调用 ComfyUI 生成音频", icon: "pi pi-volume-up", workflow: "audio", size: [480, 270] },
    { type: "infcanvas/asset_text", role: "text", kind: "text", title: "文本", desc: "文本素材", icon: "pi pi-align-left", size: [480, 270] },
    /* LoRA stack: a pure configuration node. It is wired INTO a generator as a
       MODEL modifier — never carries media, never produces an output file. Its
       loras ride along in data.loras and are injected into the workflow by
       buildPrompt() at run time (LoraLoaderModelOnly chain on the MODEL input). */
    { type: "infcanvas/lora_stack", role: "lora", kind: "lora", title: "LoRA 栈", desc: "叠加多个 LoRA 到生成模型", icon: "pi pi-sliders-h", size: [480, 270] },
  ];
  const TYPE_BY_KIND = {
    image: "infcanvas/media_image",
    video: "infcanvas/media_video",
    audio: "infcanvas/media_audio",
    text: "infcanvas/asset_text",
    lora: "infcanvas/lora_stack",
  };
  const SPEC_BY_TYPE = Object.fromEntries(SPECS.map((spec) => [spec.type, spec]));
  /* Every type ever written to disk points at the merged type now; the role
     lives in the node data, so old canvases load into the unified node. */
  const LEGACY_TYPE = {
    "infcanvas/asset_image": "infcanvas/media_image",
    "infcanvas/asset_video": "infcanvas/media_video",
    "infcanvas/asset_audio": "infcanvas/media_audio",
    "infcanvas/asset_text": "infcanvas/asset_text",
    "infcanvas/gen_image": "infcanvas/media_image",
    "infcanvas/gen_video": "infcanvas/media_video",
    "infcanvas/gen_audio": "infcanvas/media_audio",
  };
  const TYPE_BY_LEGACY = Object.fromEntries(
    Object.entries(LEGACY_TYPE).map(([old, current]) => [old, SPEC_BY_TYPE[current]]));
  /* Old type names keep working for saved graphs and for any script that still
     asks for "infcanvas/gen_image" — the merged node is what comes back. */
  const specOf = (type) => SPEC_BY_TYPE[type] || TYPE_BY_LEGACY[type] || null;
  NS.SPECS = SPECS;
  NS.TYPE_BY_KIND = TYPE_BY_KIND;

  const TITLE_H = 30;
  const SLOT_IDS = ["image", "video", "audio", "text"];

  /* ------------------------------ helpers ------------------------------ */

  /* Host toast store (src/components/ui/toast/toastStore.ts):
       success/error/info/warning/loading(title, { description, duration })
     `duration` MUST be passed -- the store defaults it to POSITIVE_INFINITY,
     so a toast without it never closes on its own. */
  function toast(kind, summary, detail = "", duration = 3000) {
    const t = EXT()?.toast;
    if (!t) { console.log("[InfCanvas]", kind, summary, detail); return; }
    try {
      if (typeof t[kind] === "function") {
        t[kind](summary, { description: detail || undefined, duration });
      } else if (typeof t.add === "function") t.add({ severity: kind, summary, detail, life: duration });
    } catch (error) { console.warn("[InfCanvas] toast failed", error); }
  }

  async function confirmDialog(opts = {}) {
    const dialog = EXT()?.dialog;
    if (dialog?.confirm) {
      return await dialog.confirm({
        key: opts.key || "infcanvas-confirm",
        title: opts.title,
        message: opts.message,
        hint: opts.hint,
        itemList: opts.itemList,
        denyLabel: opts.denyLabel,
        confirmLabel: opts.confirmLabel,
        type: opts.threeWay ? "dirtyClose" : (opts.type || "default"),
      });
    }
    if (opts.threeWay) {
      const text = (opts.title || "确认") + "\n\n" + (opts.message || "") +
        "\n\n确定 = 保存，取消 = 不保存；直接关闭窗口 = 取消操作";
      const ok = window.confirm(text);
      return ok ? true : (window.confirm("不保存并继续？") ? false : null);
    }
    return window.confirm((opts.title || "确认") + "\n\n" + (opts.message || ""));
  }

  async function promptDialog({ title, message, defaultValue }) {
    const dialog = EXT()?.dialog;
    if (dialog?.prompt) return await dialog.prompt({ title, message, defaultValue });
    return window.prompt(message || title, defaultValue || "");
  }

  function suppressPreexistingDialogs(on) {
    for (const portal of Array.from(document.querySelectorAll("body > div.z-overlay"))) {
      for (const child of Array.from(portal.children)) {
        if (on) child.setAttribute("data-infcanvas-suppressed", "1");
        else child.removeAttribute("data-infcanvas-suppressed");
      }
    }
  }

  /* 多用户（--multi-user + 素材隔离）下文件实际在 input|output/<user>/ 里，而
     <img> 标签没法带 comfy-user 头。只写 filename 的话宿主 /view 会当成全局
     目录去解析，正好命中全局 input/output 里的同名旧文件——素材明明替换成功，
     画布却显示成别人的图。宿主自己的 assets API 就是把用户段塞进 subfolder，
     它的 /view 兜底也按这个形状解析，这里跟它保持一致。 */
  function assetUser() {
    try {
      const user = window.comfyAPI?.api?.api?.user;
      return user ? String(user) : "";
    } catch (error) { return ""; }
  }
  function userSubfolder(subfolder) {
    const user = assetUser();
    const sub = String(subfolder || "");
    if (!user) return sub;
    if (sub === user || sub.startsWith(user + "/")) return sub;
    return sub ? user + "/" + sub : user;
  }
  /* 旧画布里存的是没有用户段的老地址，载入时按当前用户重算一次。只碰本站的
     /view 地址，外部链接 / blob 原样保留。 */
  function refreshViewUrl(asset) {
    if (!asset || typeof asset !== "object" || !asset.filename) return asset;
    const url = String(asset.url || "");
    if (url && !url.includes("/view?")) return asset;
    asset.url = viewUrl(asset);
    return asset;
  }

  function viewUrl(asset) {
    const query = new URLSearchParams({
      filename: asset.filename || "",
      subfolder: userSubfolder(asset.subfolder),
      type: asset.type || "input",
    }).toString();
    const url = "/view?" + query;
    try {
      const api = API();
      return api?.fileURL ? api.fileURL(url) : url;
    } catch (error) { return url; }
  }

  /* Resolve a possibly-mislabelled asset to a working /view URL via the backend,
     which searches input/output for the real file. Falls back to the local
     viewUrl() if the backend is unreachable (e.g. not yet restarted). */
  async function resolveMediaUrl(asset) {
    const filename = asset?.filename || "";
    if (!filename) return viewUrl(asset);
    try {
      const q = new URLSearchParams({
        filename,
        subfolder: asset.subfolder || "",
        type: asset.type || "input",
      }).toString();
      const api = API();
      const res = await api.fetchApi("/infcanvas/media/resolve?" + q);
      if (res.ok) {
        const data = await res.json();
        if (data && data.url) return data.url;
      }
    } catch (error) { /* fall through to local viewUrl */ }
    return viewUrl(asset);
  }

  /* ------------------------------ backend ------------------------------ */

  const backend = NS.backend = {
    async call(route, options = {}) {
      const api = API();
      if (!api?.fetchApi) throw new Error("ComfyUI API is not available");
      const response = await api.fetchApi("/infcanvas" + route, options);
      if (!response.ok) throw new Error(route + " → HTTP " + response.status);
      return await response.json();
    },
    health: () => backend.call("/health"),
    canvases: () => backend.call("/canvases"),
    canvas: (name) => backend.call("/canvas?name=" + encodeURIComponent(name)),
    save: (name, data) => backend.call("/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, data }),
    }),
    remove: (name) => backend.call("/canvas?name=" + encodeURIComponent(name), { method: "DELETE" }),
    assets: () => backend.call("/assets"),
    workflows: () => backend.call("/workflows"),
    /* The generate node may point at ANY workflow file, including Chinese names
       such as 文生音乐：MiniMax Music 3. The legacy ?name= route validates with
       the old ASCII-only NAME_RE, so the newer REST route is tried first (it
       accepts every legal filename) and ?name= only back-stops an un-restarted
       backend that does not have it yet. */
    async workflow(name) {
      try {
        const data = await backend.call("/workflows/" + encodeURIComponent(name));
        if (data && data.workflow) return data.workflow;
      } catch (error) { /* fall through to the legacy route */ }
      return backend.call("/workflow?name=" + encodeURIComponent(name));
    },
    async upload(file) {
      const form = new FormData();
      form.append("file", file, file.name);
      const response = await API().fetchApi("/infcanvas/upload", {
        method: "POST", body: form, timeoutMs: null,
      });
      if (!response.ok) throw new Error("upload → HTTP " + response.status);
      const payload = await response.json();
      return payload.asset;
    },
    async history(promptId) {
      const response = await API().fetchApi("/history/" + encodeURIComponent(promptId));
      if (!response.ok) throw new Error("history → HTTP " + response.status);
      return await response.json();
    },
  };

  /* 添加到收藏: fetch the asset's bytes from its (possibly signed) URL and
     hand them to the backend, which writes them into the user-chosen 收藏
     folder under a kind sub-folder. Taking bytes rather than a disk path keeps
     this working for generated results, gallery items and arbitrary URLs. */

  async function addToFavorites(asset, options = {}) {
    const kind = options.kind || asset?.kind || "text";
    let name = options.name || asset?.filename || asset?.name || tr("素材");
    if (kind === "text" && !/\.[a-z0-9]+$/i.test(name)) name += ".txt";
    let blob;
    /* Only text assets take their bytes from data.text. Image/video/audio nodes
       also carry an (often empty) data.text; treating that empty string as the
       payload produced a 0-byte Blob and the backend rejected it with
       "empty file". For every non-text kind, read the real file from its URL. */
    const textPayload = options.text != null ? String(options.text) : "";
    if (kind === "text" && textPayload.length > 0) {
      blob = new Blob([textPayload], { type: "text/plain;charset=utf-8" });
    } else {
      const raw = options.url || asset?.url || (asset && viewUrl(asset));
      if (!raw) throw new Error(tr("没有可添加的素材"));
      /* 本站地址（裸 /view、签名 /xcat/gallery/file 等）必须走 api.fetchApi：
         它会自动带 Comfy-User 头，多用户下后端才知道去 input|output/<user>/
         取文件。裸 fetch 不带身份，带子目录的资产（如 <user>/ming_tts/x.flac）
         会 404。URL 保持原样——/view 需要 subfolder 里的用户段，后端会据请求
         头去重，不会再造成 <user>/<user> 双重嵌套。blob / data / 外链本就自
         带数据或无需身份，走原生 fetch 即可。 */
      const source = String(raw);
      const sameSite = source.startsWith("/") && !source.startsWith("//");
      const response = await (sameSite
        ? API().fetchApi(source)
        : fetch(source));
      if (!response.ok) throw new Error(tr("读取素材失败：HTTP") + " " + response.status);
      blob = await response.blob();
    }
    const form = new FormData();
    form.append("file", blob, name);
    const api = API();
    const saved = await api.fetchApi(
      "/xcat/favorites/add?kind=" + encodeURIComponent(kind),
      { method: "POST", body: form, timeoutMs: null }
    );
    if (!saved.ok) {
      let message = tr("添加到收藏失败");
      try { const body = await saved.json(); if (body?.error) message = body.error; }
      catch (error) { /* keep the generic message */ }
      throw new Error(message);
    }
    const result = await saved.json();
    // The 收藏 sidebar (a separate gallery-panel mount) caches its file list.
    // Announce the new asset so an open panel reloads without a manual refresh.
    try {
      document.dispatchEvent(new CustomEvent("xcat-favorites-changed", { detail: result }));
    } catch (error) { /* non-browser context */ }
    return result;
  }

  /* 提示词收藏: per-account {title,text} snippets stored as one JSON file
     under the user's Cat-Nodes dir. All calls go through api.fetchApi so the
     /api prefix and the multi-user Comfy-User header are attached for us. */
  async function promptRequest(path, options = {}) {
    const response = await API().fetchApi("/xcat/prompts" + path, options);
    if (!response.ok) {
      let message = "HTTP " + response.status;
      try { const body = await response.json(); if (body?.error) message = body.error; }
      catch (error) { /* keep the status */ }
      throw new Error(message);
    }
    return await response.json();
  }
  async function listPrompts() {
    return await promptRequest("");
  }
  async function addPrompt(title, text) {
    return await promptRequest("", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text }),
    });
  }
  async function removePrompt(id) {
    return await promptRequest("?id=" + encodeURIComponent(id), { method: "DELETE" });
  }
  async function updatePrompt(id, title, text) {
    return await promptRequest("", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, title, text }),
    });
  }

  /* ------------------------------- state ------------------------------- */

  const state = NS.state = {
    active: false,
    exiting: false,
    docs: [],
    activeId: null,
    shell: null,
    tabsHost: null,
    panelKey: null,
    panelBody: null,
    panelToken: 0,
    autosaveTimer: null,
    results: 0,
  };

  /* Canvas persistence mirrors ComfyUI's workflow store (see workflowStore.ts
     + useWorkflowTabState.ts in the frontend source). Three independent pieces:
       - Tabs: the ordered list of open canvas ids + the active index.
       - Drafts: node/edge/viewport payload for every canvas, keyed by its STABLE
         id (never its name), so unsaved work survives a page refresh.
       - Meta: name/saved per id, so a draft can be told apart from a saved file.
     A saved canvas lives on disk under user/<user>/Cat-Nodes/canvases;
     drafts are only the localStorage mirror of the in-memory state. */
  const TABS_KEY = "InfCanvas.Tabs.v1";
  const DRAFT_KEY = (id) => "InfCanvas.Draft.v1:" + id;
  const META_KEY = (id) => "InfCanvas.Meta.v1:" + id;

  const storageRead = (key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (error) { return null; }
  };
  const storageWrite = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) { /* storage unavailable / quota */ }
  };
  const storageRemove = (key) => {
    try { localStorage.removeItem(key); } catch (error) { /* storage unavailable */ }
  };

  /* Persist the tab list + each doc's meta. Called after every tab operation
     (new/open/close/switch/save/rename) so a refresh can rebuild the exact set. */
  function persistTabs() {
    storageWrite(TABS_KEY, {
      ids: state.docs.map((doc) => doc.id),
      activeIndex: Math.max(0, state.docs.findIndex((doc) => doc.id === state.activeId)),
    });
    for (const doc of state.docs) {
      storageWrite(META_KEY(doc.id), { id: doc.id, name: doc.name, saved: !!doc.saved });
    }
  }

  /* Write a doc's current graph to its draft slot. Source of truth for unsaved
     canvases; for saved ones it is just a mirror used until the next disk save. */
  function writeDraft(doc) {
    if (!doc) return;
    storageWrite(DRAFT_KEY(doc.id), {
      version: 2,
      nodes: doc.nodes || [],
      edges: doc.edges || [],
      groups: doc.groups || [],
      viewport: doc.viewport || null,
    });
  }
  function readDraft(id) { return storageRead(DRAFT_KEY(id)); }
  function clearDraft(id) { storageRemove(DRAFT_KEY(id)); storageRemove(META_KEY(id)); }

  const flow = () => NS.flow;
  const activeDoc = () => state.docs.find((doc) => doc.id === state.activeId) || null;
  const autoSaveEnabled = () => {
    try { return EXT()?.setting?.get("InfCanvas.AutoSave") !== false; } catch (error) { return true; }
  };

  /* ------------------------- document <-> nodes ------------------------- */

  function newNodeId() { return "n_" + uid().slice(3); }

  function nodeFromSpec(spec, position, asset = null) {
    const data = {
      role: spec.role, kind: spec.kind, legacyType: spec.type,
      title: spec.title,
      asset: asset || null,
      text: "", prompt: "", negative: "",
      /* Audio generator: second text area (歌词 / 朗读文本), the mode tab, the
         mapping of the two areas onto the workflow's exposed text fields, and
         every value the user set on an API-exposed widget. */
      lyrics: "", audioMode: "", audioMap: {}, apiValues: {},
      /* LoRA stack entries: [{ name, strength, enabled }]. `name` is one of the
         lora_name values from /object_info/LoraLoaderModelOnly. Only enabled
         entries with a name are injected into the generated workflow. */
      loras: [],
      seed: 0, steps: 20, width: 512, height: 512,
      workflow: spec.workflow || "",
      status: "idle", error: "", result: null,
      size: spec.size.slice(),
    };
    if (asset) {
      data.kind = asset.kind || data.kind;
      if (asset.text) data.text = asset.text;
      /* Title stays the plain medium name ("图像"): the generator and the
         material node are the same thing, so the name must not advertise which
         state the node happens to be in. */
    }
    return { id: newNodeId(), type: "ic", position: { x: position[0], y: position[1] }, data };
  }

  /* LiteGraph stored node.pos at the *body* top-left and drew the title 30px
     above it; Vue Flow's node.position is the whole node's top-left, so the
     conversion is a straight -30 on Y. Links become edges with the slot index
     mapped back to a handle id (generate nodes have four typed inputs). */
  function migrateLegacyGraph(doc, data) {
    const graph = data.graph || {};
    const savedProps = graph.infcanvas_node_props || {};
    const legacyNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const legacyLinks = Array.isArray(graph.links) ? graph.links : [];
    const idMap = new Map();

    for (const node of legacyNodes) {
      const props = savedProps[String(node.id)] || node.properties || {};
      const spec = TYPE_BY_LEGACY[node.type]
        || SPEC_BY_TYPE[TYPE_BY_KIND[props.kind || "image"]]
        || SPEC_BY_TYPE[TYPE_BY_KIND.image];
      if (!spec) continue;
      const pos = Array.isArray(node.pos) ? node.pos : [node.pos?.[0] || 0, node.pos?.[1] || 0];
      const size = Array.isArray(node.size) ? node.size : (spec.size || [480, 270]);
      const created = {
        id: String(node.id),
        type: "ic",
        position: { x: pos[0], y: pos[1] - TITLE_H },
        data: {
          role: spec.role, kind: props.kind || spec.kind, legacyType: node.type,
          title: props.title || node.title || spec.title,
          asset: props.asset || null,
          text: props.text || "",
          prompt: props.prompt || "",
          negative: props.negative || "",
          seed: Number(props.seed) || 0,
          steps: Number(props.steps) || 20,
          width: Number(props.width) || 512,
          height: Number(props.height) || 512,
          workflow: props.workflow || spec.workflow || "",
          status: props.status || "idle",
          error: props.error || "",
          result: props.result || null,
          size: [Number(size[0]) || 480, Number(size[1]) || 270],
        },
      };
      /* Old labels were auto-composed ("图像 · a.png"). Keep a real user name,
         otherwise name the node after its material file / its medium. */
      const savedTitle = String(created.data.title || "").trim();
      if (!savedTitle || savedTitle.indexOf(spec.title + " · ") === 0) {
        created.data.title = created.data.asset
          ? (created.data.asset.name || created.data.asset.filename || spec.title)
          : spec.title;
      }
      idMap.set(String(node.id), created);
      doc.nodes.push(created);
    }

    for (const link of legacyLinks) {
      const parts = Array.isArray(link)
        ? { id: link[0], origin_id: link[1], target_id: link[3], target_slot: link[4] }
        : link;
      const target = idMap.get(String(parts.target_id));
      if (!target) continue;
      // Only a generator (a media node with no material) accepts input; legacy
      // links into material nodes (old "in" handle) are dropped to match it.
      if (target.data.role !== "media" || target.data.asset) continue;
      doc.edges.push({
        id: "e_" + (parts.id ?? Math.random().toString(36).slice(2, 8)),
        source: String(parts.origin_id),
        sourceHandle: "out",
        target: String(parts.target_id),
        targetHandle: "in",
        type: "ic",
      });
    }
    doc.viewport = normalizeViewport(data.viewport);
  }

  function normalizeViewport(viewport) {
    if (!viewport) return null;
    // v1 stored LiteGraph's offset (translation in screen px) and scale.
    if (Array.isArray(viewport.offset) || viewport.scale !== undefined) {
      const offset = Array.isArray(viewport.offset) ? viewport.offset : [0, 0];
      return { x: Number(offset[0]) || 0, y: Number(offset[1]) || 0, zoom: Number(viewport.scale) || 1 };
    }
    return {
      x: Number(viewport.x) || 0,
      y: Number(viewport.y) || 0,
      zoom: Number(viewport.zoom) || 1,
    };
  }

  /* Old canvases stored two roles (`asset` / `gen`) and two type names per
     medium. The unified node keeps `data.asset` as the state, so all that has
     to change is the role label; the title is rewritten too because material
     nodes used to append the file name to it. */
  /* 分类在 2026-11-17 全局改名（当天改了两次）；旧画布 nodes 里存的
     imageMode/videoMode/audioMode/textMode 可能是最早的名字，也可能是第一次
     改名后的中间名。载入时一律映射到最终名，否则 activeCategory 过滤不到新
     分类的工作流。和 server_routes.CATEGORY_RENAMES 保持一致。 */
  const LEGACY_MODE_NAMES = {
    "图片生成": "文生图", "图片编辑": "图像编辑", "图片放大": "图像放大",
    "移除背景": "背景移除", "全能参考": "参考生视频", "参考视频": "参考生视频",
    "首帧": "图生视频", "首尾帧": "首尾帧视频", "音乐设计": "文生音乐",
    "音乐翻唱": "音乐翻唱", "语音设计": "语音合成", "TTS": "语音合成",
    "语音克隆": "语音克隆", "LLM": "智能对话", "LLM对话": "智能对话",
  };
  const migrateMode = (value) => (value ? (LEGACY_MODE_NAMES[value] || value) : value);

  function normalizeNodeData(data) {
    if (!data) return;
    if (data.role === "asset" || data.role === "gen") {
      data.role = data.kind === "text" ? "text" : "media";
    }
    for (const key of ["imageMode", "videoMode", "audioMode", "textMode"]) {
      if (typeof data[key] === "string") data[key] = migrateMode(data[key]);
    }
    /* 旧画布里存的预览地址没有用户段：载入时按当前账号重算，否则同一个文件名
       在全局 input/output 里另有一份时，画面会显示成那份旧文件。 */
    refreshViewUrl(data.asset);
    refreshViewUrl(data.result);
    if (data.role === "media" || data.role === "text") {
      const spec = SPEC_BY_TYPE[TYPE_BY_KIND[data.kind || "image"]];
      if (spec) {
        data.legacyType = spec.type;
        /* Titles are user-editable, so a saved name must survive a reload. Only
           the OLD auto-composed label ("图像 · a.png") is rewritten: a material
           node is named after its file, a generator after its medium. */
        const title = typeof data.title === "string" ? data.title.trim() : "";
        const legacyLabel = title.indexOf(spec.title + " · ") === 0;
        if (!title || legacyLabel) {
          data.title = data.asset
            ? (data.asset.name || data.asset.filename || spec.title)
            : spec.title;
        }
      }
    }
  }

  /* 旧版本在生成器旁边留了一个结果节点，而生成器本身就显示同一张图。载入时
     直接收掉：画面留在生成器里，老画布看起来和新规则产物一样（素材 → 生成器）。 */
  function foldResultNodes(doc) {
    const nodes = doc.nodes || [];
    const byId = new Map(nodes.map((entry) => [String(entry.id), entry]));
    const drop = new Map();
    for (const entry of nodes) {
      const ownerId = entry?.data?.resultOf;
      if (!ownerId) continue;
      const owner = byId.get(String(ownerId));
      /* 生成器还没结果可显示时不动它：那张图此时只存在于结果节点里。 */
      if (!owner?.data?.result) continue;
      drop.set(String(entry.id), String(owner.id));
    }
    if (!drop.size) return;
    doc.nodes = nodes.filter((entry) => !drop.has(String(entry.id)));
    doc.edges = (doc.edges || []).filter((edge) =>
      !drop.has(String(edge.source)) && !drop.has(String(edge.target)));
    for (const ownerId of new Set(drop.values())) {
      const owner = byId.get(ownerId);
      if (owner?.data) owner.data.resultNodes = [];
    }
  }

  function hydrate(doc, data) {
    if (!data) return;
    if (Number(data.version) >= 2 && Array.isArray(data.nodes)) {
      doc.nodes = data.nodes;
      doc.edges = Array.isArray(data.edges) ? data.edges : [];
      doc.groups = Array.isArray(data.groups) ? data.groups : [];
      for (const node of doc.nodes) normalizeNodeData(node?.data);
      foldResultNodes(doc);
      /* The unified node exposes a single input handle ("in"), and only in its
         generator state. Normalize legacy edges that targeted the old four
         typed handles so their lines survive. */
      const genIds = new Set(doc.nodes
        .filter((n) => n?.data?.role === "media" && !n.data.asset)
        .map((n) => String(n.id)));
      for (const edge of doc.edges) {
        if (genIds.has(String(edge.target))) edge.targetHandle = "in";
      }
      doc.viewport = normalizeViewport(data.viewport);
      return;
    }
    try { migrateLegacyGraph(doc, data); }
    catch (error) {
      console.error("[InfCanvas] migrate failed", error);
      toast("error", tr("画布迁移失败"), String(error));
    }
  }

  /* Mirrors workflowStore.getUnconflictedPath(). */
  const BASE_NAME = "Unsaved Canva";

  function unconflictedName(base = BASE_NAME) {
    const taken = new Set(state.docs.map((doc) => doc.name));
    let name = base;
    let counter = 2;
    while (taken.has(name)) {
      name = `${base} (${counter})`;
      counter += 1;
    }
    return name;
  }

  function createDoc(name = null, data = null, id = null) {
    const doc = {
      id: id || uid(), name: name || unconflictedName(), saved: !!name, dirty: false,
      nodes: [], edges: [], groups: [], viewport: null,
    };
    hydrate(doc, data);
    return doc;
  }

  function markDirty(doc = null) {
    const target = doc || activeDoc();
    if (!target) return;
    if (!target.dirty) { target.dirty = true; NS.ui?.renderTabs(); }
    if (target.id === state.activeId) syncDocFromFlow(target);
    writeDraft(target);
    persistTabs();
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(async () => {
      if (!state.active || !target.saved || !autoSaveEnabled()) return;
      try { await saveActive(false, target); }
      catch (error) { console.warn("[InfCanvas] autosave failed", error); }
    }, 3000);
  }

  /* Keep the in-memory doc in sync with what the user sees, so switching tabs
     never loses a drag that happened since the last save. */
  function syncDocFromFlow(doc) {
    if (!doc || doc.id !== state.activeId) return;
    const snapshot = flow()?.snapshot?.();
    if (!snapshot) return;
    doc.nodes = snapshot.nodes;
    doc.edges = snapshot.edges;
    doc.groups = snapshot.groups || [];
    doc.viewport = snapshot.viewport;
  }

  function switchDoc(id) {
    const previous = activeDoc();
    if (previous && previous.id !== id) { syncDocFromFlow(previous); writeDraft(previous); }
    const doc = state.docs.find((entry) => entry.id === id);
    if (!doc || !flow()) return;
    state.activeId = id;
    flow().load(doc);
    persistTabs();
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
  }

  async function saveActive(askName = false, docOverride = null) {
    const doc = docOverride || activeDoc();
    if (!doc) return false;
    let name = doc.name;
    if (!name || askName) {
      const input = await promptDialog({
        title: tr("保存画布"), message: tr("画布名称"),
        defaultValue: name || BASE_NAME,
      });
      if (input === null || !String(input).trim()) return false;
      name = String(input).trim();
    }
    if (doc.id === state.activeId) syncDocFromFlow(doc);
    const payload = {
      version: 2, engine: "vueflow",
      name, savedAt: new Date().toISOString(),
      nodes: doc.nodes, edges: doc.edges, groups: doc.groups || [], viewport: doc.viewport,
    };
    await backend.save(name, payload);
    doc.name = name; doc.saved = true; doc.dirty = false;
    /* Content is now on disk; the draft is redundant. ComfyUI does the same
       on save — the draft is only for work that has not reached a file. */
    clearDraft(doc.id);
    persistTabs();
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
    toast("success", tr("画布已保存"), name);
    return true;
  }

  async function closeDoc(id) {
    const doc = state.docs.find((entry) => entry.id === id);
    if (!doc) return false;
    if (doc.dirty) {
      const choice = await confirmDialog({
        title: tr("保存更改？"),
        message: tr("画布「{name}」有未保存的更改", { name: doc.name || BASE_NAME }),
        hint: tr("保存：保存并关闭；不保存：直接关闭；取消操作：留在当前状态"),
        threeWay: true,
      });
      if (choice === null) return false;
      if (choice === true && !(await saveActive(false, doc))) return false;
    }
    state.docs = state.docs.filter((entry) => entry.id !== id);
    clearDraft(id);
    if (state.activeId === id) {
      const next = state.docs[0];
      if (next) switchDoc(next.id);
      else {
        const fresh = createDoc();
        state.docs.push(fresh);
        switchDoc(fresh.id);
      }
    } else persistTabs();
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
    return true;
  }

  async function openByName(name) {
    /* Disk is the source of truth. Even when a tab with this name is already
       open, reload its content from disk — otherwise the stale in-memory copy
       would hide (and on next save overwrite) the persisted version. This is
       exactly the "Unsaved Canva loses its content" bug. */
    try {
      const response = await backend.canvas(name);
      if (!response.exists) { toast("error", tr("打开画布失败"), tr("画布不存在：") + name); return; }
      const existing = state.docs.find((doc) => doc.name === name && doc.saved);
      if (existing) {
        /* Same identity, fresh content. Keep the id so its draft/meta follow. */
        hydrate(existing, response.data);
        existing.dirty = false;
        clearDraft(existing.id);
        switchDoc(existing.id);
      } else {
        const doc = createDoc(name, response.data);
        state.docs.push(doc);
        switchDoc(doc.id);
      }
      toast("info", tr("已打开画布"), name);
    } catch (error) { toast("error", tr("打开画布失败"), String(error)); }
  }

  function newCanvas() {
    const doc = createDoc();
    state.docs.push(doc);
    switchDoc(doc.id);
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
  }

  async function renameDoc(id) {
    const doc = state.docs.find((entry) => entry.id === id);
    if (!doc) return;
    const value = await promptDialog({
      title: tr("重命名画布"), message: tr("画布名称"),
      defaultValue: doc.name || BASE_NAME,
    });
    if (value === null || !String(value).trim()) return;
    doc.name = String(value).trim();
    doc.dirty = true;
    /* If it was saved under the old name, renaming detaches it from that file
       until the next explicit save — same as ComfyUI's Save As. */
    if (doc.saved) doc.saved = false;
    writeDraft(doc);
    persistTabs();
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
  }

  function duplicateDoc(id) {
    const doc = state.docs.find((entry) => entry.id === id);
    if (!doc) return;
    syncDocFromFlow(doc);
    const base = String(doc.name || BASE_NAME).replace(/\s*\(\d+\)$/, "");
    const name = unconflictedName(base + (doc.saved ? " (Copy)" : ""));
    const copy = createDoc(null, {
      version: 2,
      nodes: JSON.parse(JSON.stringify(doc.nodes)),
      edges: JSON.parse(JSON.stringify(doc.edges)),
      groups: JSON.parse(JSON.stringify(doc.groups || [])),
      viewport: doc.viewport ? { ...doc.viewport } : null,
    });
    copy.name = name;
    copy.saved = false;
    copy.dirty = true;
    state.docs.push(copy);
    writeDraft(copy);
    switchDoc(copy.id);
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
  }

  /* Bookmarks mirror ComfyUI's useWorkflowBookmarkStore: a Set of canvas names
     kept in localStorage. The sidebar marks each row with a bookmark button. */
  const BOOKMARKS_KEY = "InfCanvas.Bookmarks.v1";

  function readBookmarks() {
    const value = storageRead(BOOKMARKS_KEY);
    return new Set(Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string") : []);
  }
  function writeBookmarks(set) { storageWrite(BOOKMARKS_KEY, Array.from(set)); }
  function isBookmarked(name) { return !!name && readBookmarks().has(name); }
  function toggleBookmark(name) {
    const set = readBookmarks();
    const next = !set.has(name);
    if (next) set.add(name); else set.delete(name);
    writeBookmarks(set);
    return next;
  }

  /* Rename/duplicate a saved canvas by composing the existing GET/POST/DELETE
     canvas routes, so no Python change (and no ComfyUI restart) is required. */
  async function renameCanvas(oldName, newName) {
    const target = String(newName || "").trim();
    if (!target) throw new Error("名称不能为空");
    if (target === oldName) return target;
    const response = await backend.canvas(oldName);
    if (!response.exists) throw new Error(tr("画布不存在：") + oldName);
    const payload = {
      ...(response.data || {}), name: target, savedAt: new Date().toISOString(),
    };
    await backend.save(target, payload);
    await backend.remove(oldName);
    for (const doc of state.docs) {
      if (doc.saved && doc.name === oldName) doc.name = target;
    }
    const marks = readBookmarks();
    if (marks.delete(oldName)) { marks.add(target); writeBookmarks(marks); }
    persistTabs();
    NS.ui?.renderTabs();
    return target;
  }

  /* 复制 ≠ 保存. Duplicating a canvas only loads its content into a NEW
     in-memory document (saved=false, dirty=true) and opens it — exactly like
     duplicateDoc() for tabs. Nothing is written to disk until the user saves,
     so no "<name> (Copy)" file appears in the canvas list.
     `takenNames` lets the caller fold in the on-disk names it already knows. */
  async function duplicateCanvas(name, newName, takenNames) {
    const response = await backend.canvas(name);
    if (!response.exists) throw new Error(tr("画布不存在：") + name);
    const source = response.data || {};
    const used = new Set([
      ...(Array.isArray(takenNames) ? takenNames : []),
      ...state.docs.map((doc) => doc.name),
    ]);
    const suggested = String(newName || "").trim()
      || String(name).replace(/\s*\(\d+\)$/, "") + " (Copy)";
    let target = suggested;
    if (used.has(target)) {
      const stem = suggested.replace(/\s*\(\d+\)$/, "");
      let counter = 2;
      while (used.has(`${stem} (${counter})`)) counter += 1;
      target = `${stem} (${counter})`;
    }
    const copy = createDoc(null, {
      version: 2,
      nodes: JSON.parse(JSON.stringify(source.nodes || [])),
      edges: JSON.parse(JSON.stringify(source.edges || [])),
      viewport: source.viewport ? { ...source.viewport } : null,
    });
    copy.name = target;
    copy.saved = false;
    copy.dirty = true;
    state.docs.push(copy);
    writeDraft(copy);
    persistTabs();
    switchDoc(copy.id);
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
    return target;
  }

  async function closeDocsAt(id, mode) {
    const index = state.docs.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    let targets;
    if (mode === "left") targets = state.docs.slice(0, index);
    else if (mode === "right") targets = state.docs.slice(index + 1);
    else targets = [...state.docs.slice(index + 1), ...state.docs.slice(0, index)];
    for (const targetId of targets.map((entry) => entry.id)) {
      if (!(await closeDoc(targetId))) break;
    }
  }

  /* ----------------------------- placement ----------------------------- */

  const REVEAL_MARGIN = { top: 8, right: 8, bottom: 56, left: 8 };

  function visibleRect() {
    const vp = flow()?.getViewport?.();
    const host = document.querySelector("#infcanvas-vueflow");
    if (!vp || !host) return null;
    const width = host.clientWidth / (vp.zoom || 1);
    const height = host.clientHeight / (vp.zoom || 1);
    if (!(width > 0) || !(height > 0)) return null;
    return [-vp.x / (vp.zoom || 1), -vp.y / (vp.zoom || 1), width, height];
  }

  function centerPos() {
    const area = visibleRect();
    if (area) return [area[0] + area[2] / 2, area[1] + area[3] / 2];
    return [100, 100];
  }

  function leftOcclusion() {
    const host = document.querySelector("#infcanvas-vueflow");
    const panel = document.querySelector("#infcanvas-panel");
    if (!host || !panel) return 0;
    const box = panel.getBoundingClientRect();
    if (!(box.width > 0)) return 0;
    const base = host.getBoundingClientRect();
    return Math.max(0, box.right - base.left);
  }

  function freeSpot(point, size, role = "asset") {
    const area = visibleRect();
    const zoom = flow()?.getViewport?.().zoom || 1;
    const width = Number(size?.[0]) || 200;
    /* All nodes are frameless: data.size[1] IS the whole frame height. */
    const height = Number(size?.[1]) || 120;
    const step = 30;
    const stride = Math.max(120, width + 20);
    const startX = point[0];
    const startY = point[1];
    const bottom = area ? area[1] + area[3] - REVEAL_MARGIN.bottom - step : startY + 12000;
    const right = area ? area[0] + area[2] - REVEAL_MARGIN.right : startX + 12000;
    const left = area ? area[0] + REVEAL_MARGIN.left + leftOcclusion() / zoom : startX - 12000;

    const taken = (x, y) => {
      for (const node of flow()?.nodesOf?.() || []) {
        const pos = node.position;
        const dim = node.data?.size || [200, 120];
        const h = dim[1] || 120;
        if (x < pos.x + dim[0] && x + width > pos.x && y < pos.y + h && y + height > pos.y) return true;
      }
      return false;
    };

    const columns = [];
    for (let index = 0; index < 12; index += 1) {
      const k = Math.ceil(index / 2);
      const x = index === 0 ? startX : (index % 2 === 1 ? startX + k * stride : startX - k * stride);
      if (area && (x < left || x + width > right)) continue;
      columns.push(x);
    }
    if (!columns.length) columns.push(startX);

    for (let y = startY; y <= bottom; y += step) {
      for (const x of columns) if (!taken(x, y)) return [x, y];
    }
    for (let y = bottom + step; y < startY + 20000; y += step) {
      if (!taken(columns[0], y)) return [columns[0], y];
    }
    return [startX, startY];
  }

  function revealNode(node) {
    const area = visibleRect();
    const vp = flow()?.getViewport?.();
    if (!area || !vp || !node?.position) return;
    const dim = node.data?.size || [200, 120];
    const zoom = vp.zoom || 1;
    const x1 = node.position.x;
    const y1 = node.position.y;
    const x2 = x1 + (dim[0] || 0);
    const y2 = y1 + (dim[1] || 0);
    const left = area[0] + REVEAL_MARGIN.left + leftOcclusion() / zoom;
    const top = area[1];
    const right = area[0] + area[2];
    const bottom = top + area[3];
    let dx = 0, dy = 0;
    if (x2 - x1 + REVEAL_MARGIN.left + REVEAL_MARGIN.right <= right - left) {
      if (x1 < left) dx = x1 - left;
      else if (x2 + REVEAL_MARGIN.right > right) dx = x2 + REVEAL_MARGIN.right - right;
    } else dx = x1 - left;
    if (y2 - y1 + REVEAL_MARGIN.top + REVEAL_MARGIN.bottom <= area[3]) {
      if (y1 - REVEAL_MARGIN.top < top) dy = y1 - REVEAL_MARGIN.top - top;
      else if (y2 + REVEAL_MARGIN.bottom > bottom) dy = y2 + REVEAL_MARGIN.bottom - bottom;
    } else dy = y1 - REVEAL_MARGIN.top - top;
    if (!dx && !dy) return;
    flow().setViewport({ x: vp.x - dx * zoom, y: vp.y - dy * zoom, zoom });
  }

  function addNodeByType(type, pos = null, asset = null, title = null) {
    const spec = specOf(type);
    if (!spec || !flow()) {
      toast("error", tr("无法创建节点"), tr("画布尚未就绪，请刷新页面后重试"));
      return null;
    }
    const autoPlaced = !pos;
    const position = autoPlaced ? freeSpot(centerPos(), spec.size, spec.role) : [pos[0], pos[1]];
    const node = nodeFromSpec(spec, position, asset);
    /* A node that starts life WITH a material is named after that material (the
       file the user dropped or pasted). A generated result passes its title
       explicitly so the new node keeps the plain medium name. */
    if (title !== null) node.data.title = title;
    else if (asset) node.data.title = asset.name || asset.filename || spec.title;
    flow().addNode(node);
    flow().selectNodes([node.id]);
    markDirty();
    if (autoPlaced) revealNode(node);
    return node;
  }

  function removeNode(id) {
    if (!flow()) return;
    flow().removeNodes([id]);
    markDirty();
  }

  /* ---- dropping a file ON a node: generator -> material, one way ----
     A media node is a generator until a file lands on it, and that flip is
     final (delete + create to get a generator back). Collapsing the states
     means the flip may never destroy work: a node that already produced a
     result, or that is being fed by upstream nodes, refuses the drop. */
  const MEDIA_LABELS = { image: "图片", video: "视频", audio: "音频" };
  function absorbReason(node) {
    const data = node?.data;
    if (!data || data.role !== "media") return "该节点不接受素材";
    if (data.asset) return "该节点已经是素材节点，如需更换请删除后重建";
    if (data.result) return "该节点已生成结果，不能再转为素材节点，请新建一个图像 / 视频 / 音频节点";
    const wired = (flow()?.edgesOf?.() || []).filter((edge) => edge.target === node.id);
    if (wired.length) return "该节点已接入上游素材，请先断开连线";
    return "";
  }

  async function absorbFiles(node, files, point) {
    const data = node?.data;
    if (!data) return;
    const file = files?.[0];
    if (!file) return;
    if (files.length > 1) toast("info", tr("只接收第一个文件"), file.name);
    const kind = kindOfFile(file);
    if (!kind) { toast("warning", tr("不支持的文件类型"), file.name); return; }
    const reason = absorbReason(node);
    if (reason) { toast("warning", tr("无法拖入素材"), reason); return; }
    if (kind !== data.kind) {
      toast("warning", tr("文件类型不匹配"),
        tr("「{title}」节点仅接受{kind}文件：{file}", { title: data.title || tr(MEDIA_LABELS[data.kind] || data.kind), kind: tr(MEDIA_LABELS[data.kind] || data.kind), file: file.name }));
      return;
    }
    try {
      const asset = await backend.upload(file);
      asset.kind = kind;
      asset.name = asset.name || file.name;
      asset.url = refreshViewUrl(asset).url || viewUrl(asset);
      if (kind === "text") {
        try { asset.text = (await readTextFile(file)).slice(0, 4000); } catch (error) { /* binary */ }
      }
      /* The capsule shows the name the user actually dropped (file.name), not
         the store name the backend gave it (which carries a timestamp suffix). */
      NS.flow?.updateNodeData?.(node.id, kind === "text"
        ? { asset, text: asset.text || "", title: file.name }
        : { asset, title: file.name });
      markDirty();
      NS.ui?.refreshPanels?.();
      toast("success", tr("已转为素材节点"), file.name);
    } catch (error) { toast("error", tr("上传失败"), file.name + " · " + String(error)); }
  }

  /* ---- system clipboard / file drop -> nodes (ported from xcat-paste.js) ----
     Both paste and drop funnel through handleFiles(). A bare text/plain paste
     creates a text node directly (no upload), matching the reference's single
     "asset-text" node for both pasted text and dropped .txt/.md files. */
  const TEXT_EXT = /\.(txt|text|md|markdown|mdown|mkd|mdx)$/i;
  const TEXT_MIME = /^(?:text\/(?:plain|markdown|md|x-markdown)|application\/(?:markdown|x-markdown))/i;
  const isTextFile = (file) => !!file && (
    TEXT_EXT.test(String(file.name || "")) || TEXT_MIME.test(String(file.type || ""))
  );
  /* Extend kindFromFile (extension only) with MIME sniffing for clipboard files,
     which often arrive without a usable filename. */
  function kindOfFile(file) {
    const byName = kindFromFile(file?.name);
    if (byName) return byName;
    const mime = String(file?.type || "").toLowerCase();
    if (mime.indexOf("image/") === 0) return "image";
    if (mime.indexOf("video/") === 0) return "video";
    if (mime.indexOf("audio/") === 0) return "audio";
    if (isTextFile(file)) return "text";
    return null;
  }
  function collectFiles(dt) {
    const out = [];
    if (dt?.files?.length) for (const file of dt.files) out.push(file);
    /* Images copied from a web page sometimes live only in dt.items. */
    if (!out.length && dt?.items?.length) {
      for (const item of dt.items) {
        if (item?.kind === "file" && item.getAsFile) {
          const file = item.getAsFile();
          if (file) out.push(file);
        }
      }
    }
    return out.filter((file) => file && (file.size > 0 || file.type || file.name));
  }
  const lastPointer = { x: 0, y: 0, ok: false };
  function rememberPointer(event) {
    if (!state.active) return;
    if (event.target?.closest?.(".vue-flow, #infcanvas-vueflow")) {
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      lastPointer.ok = true;
    }
  }
  /* Paste events carry no useful client coords, so anchor on the last pointer
     position inside the canvas; fall back to the visible-area centre. */
  function pastePoint() {
    const at = lastPointer.ok
      ? flow()?.screenToFlow?.(lastPointer.x, lastPointer.y)
      : null;
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) return { x: at.x, y: at.y };
    const center = centerPos();
    return { x: center[0], y: center[1] };
  }
  const isTypingTarget = (target) => !!target?.closest?.(
    "input, textarea, select, [contenteditable='true'], [contenteditable='']");

  function createTextNode(text, point) {
    const node = addNodeByType(TYPE_BY_KIND.text, [point.x, point.y], null);
    if (!node) return null;
    node.data.text = String(text || "").slice(0, 4000);
    NS.flow?.updateNodeData?.(node.id, { text: node.data.text });
    markDirty();
    revealNode(node);
    return node;
  }

  async function handleFiles(files, point) {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const kind = kindOfFile(file);
      if (!kind) { toast("warning", tr("不支持的文件类型"), file.name); continue; }
      try {
        const asset = await backend.upload(file);
        if (kind === "text") {
          try { asset.text = (await readTextFile(file)).slice(0, 4000); } catch (error) { /* binary */ }
        }
        addNodeByType(TYPE_BY_KIND[kind], [point.x + index * 24, point.y + index * 24], asset, file.name);
        NS.ui?.refreshPanels();
        toast("success", tr("素材已添加"), file.name);
      } catch (error) { toast("error", tr("上传失败"), file.name + " · " + String(error)); }
    }
  }

  function onPaste(event) {
    if (!state.active || event.defaultPrevented) return;
    /* Let text fields paste normally (node editor, rename box). */
    if (isTypingTarget(event.target)) return;
    if (NS.tools?.isOpen?.()) return;
    if (document.querySelector('[data-reka-dialog-content][data-state="open"]')) return;
    const dt = event.clipboardData;
    if (!dt) return;
    const files = collectFiles(dt);
    let text = "";
    try { text = String(dt.getData("text/plain") || ""); } catch (error) { text = ""; }
    if (!files.length && !text.trim()) return;
    event.preventDefault();
    event.stopPropagation();
    if (files.length) { handleFiles(files, pastePoint()); return; }
    createTextNode(text, pastePoint());
  }

  async function onDrop(event) {
    const point = flow()?.screenToFlow?.(event.clientX, event.clientY) || { x: 0, y: 0 };
    const custom = event.dataTransfer?.getData("application/x-infcanvas-asset");
    if (custom) {
      try {
        const asset = JSON.parse(custom);
        addNodeByType(TYPE_BY_KIND[asset.kind] || TYPE_BY_KIND.text, [point.x, point.y], asset);
      } catch (error) { toast("error", tr("资产解析失败"), String(error)); }
      return;
    }
    await handleFiles(collectFiles(event.dataTransfer), point);
  }

  /* ---------------------------- generation ----------------------------- */

  /* Edges carry the connection order; a generate node has four typed inputs, so
     the handle id is what tells us which kind of asset arrived. */
  function collectInputs(node) {
    const result = [];
    /* A single source wired into this node more than once is ONE input. Dedupe
       by source id so a text node dragged twice contributes its prompt once,
       and a media node wired twice yields one asset. */
    const seenSources = new Set();
    for (const edge of flow()?.edgesOf?.() || []) {
      if (edge.target !== node.id) continue;
      if (seenSources.has(edge.source)) continue;
      seenSources.add(edge.source);
      const source = (flow()?.nodesOf?.() || []).find((entry) => entry.id === edge.source);
      /* 生成器把结果回显在自己身上（data.result），没有独立的结果节点；它
         照样能作为素材接到下一个生成节点，所以这里两种都认。 */
      const asset = source?.data?.asset || source?.data?.result;
      const kind = source?.data?.kind || asset?.kind || (source?.data?.role === "text" ? "text" : null);
      /* A text node is a PROMPT input, not an asset — it legitimately has no
         asset, so don't drop it. Media nodes still require an asset. */
      if (!asset && kind !== "text") continue;
      const slot = SLOT_IDS.indexOf(edge.targetHandle);
      result.push({
        slot: slot < 0 ? 0 : slot,
        name: edge.targetHandle || "",
        asset: asset || null,
        kind,
        text: source.data.text || source.data.result?.text || "",
      });
    }
    return result;
  }

  /* LoRA stack nodes wired into a generator contribute their enabled entries.
     Walks the SAME incoming edges as collectInputs; a generator may have more
     than one LoRA stack wired in, so entries are concatenated in wire order.
     Duplicate filenames collapse (first wins) so the same model is never
     applied twice when two stacks overlap. */
  function collectLoras(node) {
    const entries = [];
    const seen = new Set();
    const nodes = flow()?.nodesOf?.() || [];
    for (const edge of flow()?.edgesOf?.() || []) {
      if (edge.target !== node.id) continue;
      const source = nodes.find((entry) => entry.id === edge.source);
      if (source?.data?.role !== "lora") continue;
      for (const item of (source.data.loras || [])) {
        if (!item || item.enabled === false || !item.name || seen.has(item.name)) continue;
        seen.add(item.name);
        entries.push({ name: item.name, strength: Number(item.strength) });
      }
    }
    return entries;
  }

  /* Inject the LoRA chain into a built prompt. ComfyUI's LoraLoaderModelOnly
     takes a MODEL and returns a MODEL, so stacks chain naturally: the first
     LoRA reads the template's original MODEL source and every consumer of that
     source is rewired to the chain tail. A consumer is any node whose `model`
     input is a link [nodeId, slot]; the source is the node at the other end.
     Templates with no MODEL link (pure audio/text prompts) are left alone. */
  function injectLoras(prompt, loras) {
    const active = (loras || []).filter((entry) => entry && entry.name && Number.isFinite(entry.strength));
    if (!active.length) return;
    /* Collect MODEL links: { consumer, key, sourceId }. A link is an array
       whose first element is the upstream node id. */
    const links = [];
    for (const [id, node] of Object.entries(prompt)) {
      if (!node?.inputs) continue;
      for (const [key, value] of Object.entries(node.inputs)) {
        if (key !== "model" || !Array.isArray(value) || !value.length) continue;
        const sourceId = String(value[0]);
        if (!prompt[sourceId]) continue;
        links.push({ id, key, sourceId });
      }
    }
    if (!links.length) return;
    /* Only TRUE sources get a chain: a node referenced by `model` that itself
       has no `model` input (CheckpointLoaderSimple / UNETLoader). A node sitting
       in the middle of a template's existing LoRA chain (e.g. a bundled
       LoraLoaderModelOnly) is BOTH a consumer and a source — injecting there
       would modulate twice and rewire the sampler away from the template chain. */
    const consumerIds = new Set(links.map((link) => link.id));
    const bySource = new Map();
    for (const link of links) {
      if (consumerIds.has(link.sourceId)) continue;
      if (!bySource.has(link.sourceId)) bySource.set(link.sourceId, []);
      bySource.get(link.sourceId).push(link);
    }
    if (!bySource.size) return;
    let seq = 0;
    for (const [sourceId, consumers] of bySource) {
      let tail = sourceId;
      for (const lora of active) {
        const chainId = "_xcat_lora_" + (++seq);
        prompt[chainId] = {
          class_type: "LoraLoaderModelOnly",
          inputs: {
            model: [tail, 0],
            lora_name: lora.name,
            strength_model: Math.max(-100, Math.min(100, lora.strength)),
          },
          _meta: { title: "LoRA · " + lora.name.split(/[\\/]/).pop() },
        };
        tail = chainId;
      }
      for (const consumer of consumers) {
        prompt[consumer.id].inputs[consumer.key] = [tail, 0];
      }
    }
  }

  function assetPath(asset) {
    return (asset.subfolder ? asset.subfolder + "/" : "") + (asset.filename || "");
  }

  /* Audio generator: the panel's two text areas and the API-exposed widgets are
     written into the workflow's own LITERAL inputs. Templates that carry no
     {{placeholders}} (MiniMax music / voice design…) still receive them.
       audioMap  = { a: "nodeId:key", b: "nodeId:key" } for 提示词/语气 + 歌词/朗读文本
       apiValues = every right-hand widget, keyed the same way
     Both deliberately OVERWRITE the template value: an explicit user value
     beats whatever default the workflow file shipped with. Unlinked inputs only
     — a linked input (["node", 0]) is data, not a parameter. */
  function applyNodeInputs(target, data, areaA) {
    if (!target || typeof target !== "object") return;
    const writes = [];
    const map = data?.audioMap || {};
    /* `areaA` is the first input area INCLUDING any wired text node, so a text
       wire reaches the workflow even when the user typed nothing. */
    if (map.a) writes.push([map.a, areaA ?? data.prompt ?? ""]);
    if (map.b) writes.push([map.b, data.lyrics ?? ""]);
    /* The prompt of an image / video / text generator is edited in the node's
       own text area, not in the settings popover; `promptMap` says which
       exposed input it belongs to. An empty area leaves the workflow's own
       default alone instead of wiping it. */
    const promptId = data?.promptMap || "";
    if (promptId && (areaA ?? data.prompt ?? "")) writes.push([promptId, areaA ?? data.prompt ?? ""]);
    for (const [id, value] of Object.entries(data?.apiValues || {})) {
      if (promptId && id === promptId) continue;
      writes.push([id, value]);
    }
    for (const [id, value] of writes) {
      const [nodeId, key] = String(id).split(":");
      const node = target[nodeId];
      if (!node || !key || !node.inputs || !(key in node.inputs)) continue;
      if (Array.isArray(node.inputs[key])) continue;
      /* Copy-on-write so the caller's template object is never mutated. */
      target[nodeId] = { ...node, inputs: { ...node.inputs, [key]: value } };
    }
  }

  /* Seeds are 64-bit in ComfyUI. Only fall back to a random pick when the panel
     actually has no value -- `Number(data.seed) || x` used to rewrite a legal 0. */
  function seedOrRandom(raw) {
    const value = Number(raw);
    if (raw !== "" && raw !== null && raw !== undefined && Number.isFinite(value)) return value;
    return Math.floor(Math.random() * SAFE_INT_MAX);
  }

  async function buildPrompt(kind, template, data, inputs, loras = []) {
    let checkpoint = "";
    try {
      const defs = await API().getNodeDefs();
      checkpoint = defs?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0] || "";
    } catch (error) { /* object_info may be unavailable */ }
    const find = (wanted) => inputs.find((entry) => entry.kind === wanted)?.asset || null;
    /* LoadImage / LoadVideo / LoadAudio 只读 input 目录，而生成结果都落在 output：
       「生成 → 放大 / 编辑 / 再生成」这条链以前直接抛错，让用户把同一张图再拖一次
       才算上传。现在先请求后端把文件拷进 input/infcanvas（同一份只拷一次），
       拿到的 ref 再交给模板。老后端没有这条路由时保持原来的报错。 */
    const MEDIA_LABEL = { image: "图像", video: "视频", audio: "音频" };
    async function ensureInputAsset(asset, kind) {
      if (!asset || !asset.filename) return asset;
      if ((asset.type || "input") === "input") return asset;
      try {
        const api = API();
        const res = await api.fetchApi("/infcanvas/media/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: asset.filename,
            subfolder: asset.subfolder || "",
            type: asset.type || "input",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const next = data?.asset;
          if (next?.filename) {
            return { ...asset, filename: next.filename, subfolder: next.subfolder || "", type: "input" };
          }
        }
      } catch (error) { /* 旧后端没有 /media/import，走下面的兜底报错 */ }
      throw new Error((MEDIA_LABEL[kind] || "素材") + "需来自 input 目录；请先把该素材拖入画布上传一次");
    }
    /* 只搬模板真的会用到的素材：文本节点也接受图片/视频，但它的模板里没有
       {{image}} 占位符，为一个用不上的 100MB 视频做拷贝没有意义。 */
    const templateText = JSON.stringify(template);
    const legacyImage = !!(template["3"] && template["4"] && template["5"]);
    const consumed = {
      image: templateText.includes("{{image}}") || legacyImage,
      video: templateText.includes("{{video}}"),
      audio: templateText.includes("{{audio}}"),
    };
    const take = async (wanted) => {
      const asset = find(wanted);
      return consumed[wanted] ? await ensureInputAsset(asset, wanted) : asset;
    };
    const image = await take("image");
    const video = await take("video");
    const audio = await take("audio");
    const text = inputs.filter((entry) => entry.kind === "text")
      .map((entry) => entry.text || entry.asset?.name || "").filter(Boolean).join("\n");
    const promptText = [data.prompt || "", text].filter(Boolean).join("\n") || "a photo";
    /* The audio generator's FIRST area (提示词 / 语气) is what a wired text node
       feeds. Typed text wins the first line, wired prompts are appended — that
       is the only place wired text is allowed to land (never 歌词 / 朗读文本). */
    const areaA = [data.prompt || "", text].filter(Boolean).join("\n");
    if (!checkpoint && JSON.stringify(template).includes("{{checkpoint}}")) {
      throw new Error("未检测到 Checkpoint 模型，请先在 ComfyUI 中放置一个模型");
    }
    const values = {
      prompt: promptText,
      negative: data.negative || "",
      text: text || promptText,
      /* Audio generator aliases: the second area is 歌词 (music) / 朗读文本
         (voice), the first one doubles as 语气 for voice templates. */
      lyrics: data.lyrics || "",
      tone: areaA,
      /* 0 is a legal seed, so test for absence rather than truthiness; the
         fallback stays inside the same 64-bit range object_info reports. */
      seed: seedOrRandom(data.seed),
      steps: Number(data.steps) || 20,
      width: Number(data.width) || 512,
      height: Number(data.height) || 512,
      checkpoint, prefix: kind + "_" + Date.now(),
      image: image ? assetPath(image) : "",
      video: video ? assetPath(video) : "",
      audio: audio ? assetPath(audio) : "",
    };
    const clean = {};
    for (const [key, value] of Object.entries(template)) {
      if (!key.startsWith("_")) clean[key] = value;
    }
    let raw = JSON.stringify(clean);
    for (const [key, value] of Object.entries(values)) {
      const quoted = '"{{' + key + '}}"';
      const replacement = typeof value === "number" ? String(value) : JSON.stringify(String(value));
      raw = raw.split(quoted).join(replacement);
      const inner = JSON.stringify(String(value)).slice(1, -1);
      raw = raw.split("{{" + key + "}}").join(inner);
    }
    if (raw.includes("{{")) throw new Error("模板中存在未识别的占位符");
    const prompt = JSON.parse(raw);
    /* Audio panel values beat the template's own defaults. Applied AFTER the
       placeholder pass so the user's own text is never scanned for {{tokens}}
       (a lyric may legitimately contain braces). */
    applyNodeInputs(prompt, data, areaA);
    if (image && prompt["3"]?.inputs && prompt["4"] && prompt["5"]) {
      prompt["1001"] = { class_type: "LoadImage", inputs: { image: values.image } };
      prompt["1002"] = { class_type: "VAEEncode", inputs: { pixels: ["1001", 0], vae: ["4", 2] } };
      prompt["3"].inputs.latent_image = ["1002", 0];
      delete prompt["5"];
    }
    /* LoRA stacks are wired into the generator as MODEL modifiers. Inject AFTER
       every other mutation so the rewired MODEL links are the final ones. */
    injectLoras(prompt, loras);
    return prompt;
  }

  function extractOutputs(outputs) {
    const result = [];
    for (const output of Object.values(outputs || {})) {
      for (const key of ["images", "gifs", "videos", "audio", "text", "strings"]) {
        const items = output?.[key];
        if (!Array.isArray(items)) continue;
        if (key === "text" || key === "strings") {
          for (const value of items) {
            result.push({ kind: "text", name: "生成文本", text: String(value), filename: "", subfolder: "", type: "output", url: "" });
          }
          continue;
        }
        for (const item of items) {
          if (!item?.filename) continue;
          const kind = key === "gifs" || key === "videos" ? "video" : key === "audio" ? "audio" : "image";
          const asset = {
            kind, name: item.filename, filename: item.filename,
            subfolder: item.subfolder || "", type: item.type || "output",
          };
          asset.url = viewUrl(asset);
          result.push(asset);
        }
      }
    }
    return result;
  }

  async function pollHistory(promptId) {
    for (let attempt = 0; attempt < 720; attempt += 1) {
      const data = await backend.history(promptId);
      const entry = data?.[promptId];
      if (entry) {
        const status = entry.status?.status_str;
        if (status === "error") {
          throw new Error(JSON.stringify(entry.status?.messages || []).slice(0, 300));
        }
        if (entry.outputs && Object.keys(entry.outputs).length) return extractOutputs(entry.outputs);
      }
      await sleep(500);
    }
    throw new Error("等待生成结果超时");
  }

  /* 结果直接写回生成器自己：节点本来就把 data.result 当画面显示
     （assetOf = asset || result），再在旁边放一个结果节点就是同一张图出现两次。
     回显出来的这张图本身就能当素材接到下一个生成节点（生成器对外提供 result）。
     只有一次跑出多个输出（批量）时，生成器装不下的那些才各占一个节点。
     `resultNodes` 因此只记这些多余槽位；`data.resultOf` 反过来指回生成器。 */
  function attachResults(node, assets) {
    const data = node.data;
    const list = (assets || []).filter(Boolean);
    if (!list.length) return;

    /* 旧版本在生成器右边留的结果节点：直接收走，回显只留在生成器里。 */
    for (const id of Array.isArray(data.resultNodes) ? data.resultNodes.slice() : []) {
      const found = flow()?.findNode?.(id);
      if (!found || found.data?.resultOf !== node.id) continue;
      removeNode(found.id);
    }

    const next = [];
    list.slice(1).forEach((asset, index) => {
      const type = TYPE_BY_KIND[asset.kind] || TYPE_BY_KIND.text;
      const spec = SPEC_BY_TYPE[type];
      const size = data?.size || [250, 230];
      const position = [
        node.position.x + (size[0] || 250) + 70,
        node.position.y + ((state.results + index) % 5) * 46,
      ];
      /* A generated result keeps the medium name ("图像"), NOT the output file
         name: the file name is an implementation detail of the run, while the
         node stays the same kind of thing the user created. */
      const created = addNodeByType(type, position, asset, spec?.title || null);
      if (!created) return;
      /* Marked through the flow layer, not on the raw object: Vue Flow keeps its
         own copy of the node, so a plain field write would only reach the
         serialised array and fail the resultOf check on the next run. */
      NS.flow?.updateNodeData?.(created.id, { resultOf: node.id });
      next.push(created.id);
      state.results += 1;
    });

    data.resultNodes = next;
    /* 再次运行 = 覆盖同一个画面，不会每跑一次多一张。 */
    data.result = list[0];
    NS.flow?.updateNodeData?.(node.id, { resultNodes: next, result: data.result });
  }

  /* Value control (ComfyUI core/graph/widgets/valueControl.ts). Mirrors
     computeNextNumberValue(): randomize = floor(random() * range) * step + min.
     The guard is 2^64-1, the range object_info reports for INT seeds -- anything
     tighter would silently truncate the templates' own seeds (4.4e14 and up). */
  const SAFE_INT_MAX = 18446744073709552000;
  function nextControlledValue(mode, spec, current) {
    const value = Number(current);
    if (!Number.isFinite(value)) return undefined;
    if (mode === "fixed") return undefined;
    const step = Number.isFinite(Number(spec?.step)) && Number(spec.step) > 0
      ? Number(spec.step) : 1;
    const min = Math.max(-SAFE_INT_MAX, Number.isFinite(Number(spec?.min))
      ? Number(spec.min) : 0);
    const max = Math.min(SAFE_INT_MAX, Number.isFinite(Number(spec?.max))
      ? Number(spec.max) : min + step * 1000000);
    let next = value;
    if (mode === "increment") next += step;
    else if (mode === "decrement") next -= step;
    else if (mode === "randomize") {
      /* A float cannot hold 2^64-1 exactly: drawing near the ceiling rounds UP
         to 2^64, which ComfyUI then rejects with value_bigger_than_max. Rolling
         inside the safe-integer range stays a valid seed and never overflows. */
      const ceiling = Math.min(max, Number.MAX_SAFE_INTEGER);
      const range = (ceiling - min) / step;
      if (!(range > 0)) return min;
      next = Math.floor(Math.random() * range) * step + min;
    } else return undefined;
    return Number(Math.min(Math.max(next, min), max).toFixed(6));
  }

  NS.fieldControl = {
    next: nextControlledValue,
    /* Runs right after the prompt is queued (the host's "after generate").
       Writing apiValues means the NEXT run uses the new seed and the node's own
       input shows it immediately. */
    applyAfterQueue(node) {
      const modes = node?.data?.fieldModes || {};
      const specs = node?.data?.fieldSpecs || {};
      /* EVERY exposed 随机数 counts, not only the ones whose badge was clicked:
         the badge shows 随机值 by default (the host default is "randomize"), so
         an untouched seed still has to advance after each run -- keying off
         fieldModes alone made 递增 / 递减 / 随机 all do nothing until the user
         happened to re-pick a mode. */
      const ids = [...new Set([...Object.keys(specs), ...Object.keys(modes)])];
      if (!ids.length) return;
      const values = { ...(node.data.apiValues || {}) };
      let changed = false;
      for (const id of ids) {
        const spec = specs[id] || {};
        const raw = values[id];
        /* Never touched: the panel is showing the template's own value, so that
           is the number to advance. Passing undefined skipped every mode. */
        const current = raw === undefined || raw === null || raw === ""
          ? spec.default
          : raw;
        const next = nextControlledValue(modes[id] || "randomize", spec, current);
        if (next === undefined || next === current) continue;
        values[id] = next;
        changed = true;
      }
      if (!changed) return;
      node.data.apiValues = values;
      NS.flow?.updateNodeData?.(node.id, { apiValues: values });
      markDirty();
    },
  };

  NS.generate = {
    async run(nodeId) {
      const node = (flow()?.nodesOf?.() || []).find((entry) => entry.id === nodeId);
      if (!node) return;
      const data = node.data;
      if (data.status === "running") { toast("info", tr("该节点正在生成")); return; }
      const kind = data.kind;
      const templateName = data.workflow || kind;
      let template;
      try { template = await backend.workflow(templateName); }
      catch (error) { toast("error", tr("读取生成模板失败"), String(error)); return; }
      if (template?._requires_config) {
        toast("warning", tr("请先配置生成模板"), template.hint || `workflows/${templateName}.json`);
        return;
      }
      let prompt;
      /* collectInputs walks edges by NODE id, so it needs the node, not its
         data object (data has no id — passing it silently yielded zero
         wired inputs, so {{image}}/{{text}}/{{audio}} were always empty). */
      try { prompt = await buildPrompt(kind, template, data, collectInputs(node), collectLoras(node)); }
      catch (error) { toast("error", tr("构建工作流失败"), String(error)); return; }
      data.status = "running";
      data.error = "";
      markDirty();
      /* A status flip is runtime state, not an edit: keep it out of undo. */
      NS.flow?.history?.absorb?.();
      try {
        const queued = await API().queuePrompt(0, { output: prompt, workflow: {} });
        if (!queued?.prompt_id) throw new Error("提交任务失败，未返回 prompt_id");
        /* Comfy.WidgetControlMode defaults to "after": the seed advances once the
           prompt is queued, so this run keeps the value it was submitted with. */
        NS.fieldControl.applyAfterQueue(node);
        const outputs = await pollHistory(queued.prompt_id);
        if (!outputs.length) throw new Error("任务完成但没有返回可用输出");
        attachResults(node, outputs);
        data.status = "done";
        toast("success", tr("生成完成"), tr("{n} 个结果已回显到节点", { n: outputs.length }));
      } catch (error) {
        data.status = "error";
        data.error = String(error);
        toast("error", tr("生成失败"), String(error));
      }
      markDirty();
      NS.flow?.history?.absorb?.();
      NS.ui?.refreshPanels();
    },
  };

  /* --------------------------- enter / exit ---------------------------- */

  function ensureSurface(stage) {
    const host = flow().init(stage);
    /* The host element survives exit/re-enter (the Vue app stays mounted), so
       the DOM listeners may only be attached once. */
    if (host.dataset.wired === "1") return host;
    host.dataset.wired = "1";
    host.addEventListener("dragover", (event) => {
      event.preventDefault(); event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    host.addEventListener("drop", (event) => {
      event.preventDefault(); event.stopPropagation();
      onDrop(event);
    });
    /* A file dropped ON a node never creates a second node: it flips that
       generator into a material node (or is refused with a reason). Vue Flow
       puts the node id on the wrapper, so the hit test needs no DOM markers of
       our own. Capture phase, so the host's "drop -> new node" handler below
       never sees it. */
    const mediaTarget = (event) => {
      const wrapper = event.target?.closest?.(".vue-flow__node");
      const id = wrapper?.dataset?.id;
      if (!id) return null;
      const node = (flow()?.nodesOf?.() || []).find((entry) => String(entry.id) === String(id));
      return node?.data?.role === "media" ? node : null;
    };
    document.addEventListener("dragover", (event) => {
      if (!state.active) return;
      const target = mediaTarget(event);
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      const effect = absorbReason(target) ? "none" : "copy";
      try { if (event.dataTransfer) event.dataTransfer.dropEffect = effect; } catch (error) { /* ignore */ }
    }, true);
    document.addEventListener("drop", (event) => {
      if (!state.active) return;
      const target = mediaTarget(event);
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      const reason = absorbReason(target);
      if (reason) { toast("warning", tr("无法拖入素材"), reason); return; }
      /* Asset payloads dragged out of a node's own tool dialog arrive as JSON,
         not as a File -- flip the node straight to that asset. */
      const custom = event.dataTransfer?.getData("application/x-infcanvas-asset");
      if (custom) {
        try {
          const asset = JSON.parse(custom);
          NS.flow?.updateNodeData?.(target.id, { asset });
          markDirty();
          NS.ui?.refreshPanels?.();
          toast("success", tr("已转为素材节点"), asset.name || asset.filename || "");
        } catch (error) { toast("error", tr("资产解析失败"), String(error)); }
        return;
      }
      absorbFiles(target, collectFiles(event.dataTransfer));
    }, true);
    /* Double-clicking empty canvas opens the canvas's own node list at the
       pointer. Vue Flow gives us screen->flow conversion, so the new node lands
       exactly under the cursor -- same contract as LiteGraph's
       node.pos = convertEventToCanvasOffset(event). */
    host.addEventListener("dblclick", (event) => {
      if (!state.active) return;
      if (NS.tools?.isOpen?.()) return;
      /* LiteGraph's processMouseDown returns early when read_only is set
         (LGraphCanvas.ts:2843), so a double click in hand mode never opens the
         node menu in ComfyUI either. */
      if (NS.flow?.state?.mode?.value === "drag") return;
      if (event.target.closest?.(".vue-flow__node")) return;
      /* Groups and the multi-select toolbox are real controls on the canvas:
         double-clicking a group title renames it, and the toolbox buttons
         must never open the add-node menu underneath them. */
      if (event.target.closest?.(".ic-group, .ic-group-ui, .ic-selection-tools")) return;
      const point = flow().screenToFlow(event.clientX, event.clientY);
      NS.ui?.showAddNodeMenu?.({
        clientX: event.clientX, clientY: event.clientY,
        world: [point.x, point.y],
      });
      event.stopPropagation();
    }, true);
    return host;
  }

  async function enter() {
    if (state.exiting) return;
    if (state.active) { NS.ui?.renderTabs(); return; }
    if (!flow()) {
      toast("error", tr("画布引擎未就绪"), tr("请刷新页面后重试"));
      return;
    }
    NS.ui?.injectStyles();
    const shell = NS.ui?.mountShell();
    if (!shell) { toast("error", tr("画布界面创建失败"), tr("请刷新页面后重试")); return; }
    ensureSurface(shell.stage);
    try { NS.controls?.mount?.(shell.stage); }
    catch (error) { console.error("[InfCanvas] mountControls failed", error); }
    try { NS.ui?.mountTabs(); }
    catch (error) { console.error("[InfCanvas] mountTabs failed", error); }
    state.active = true;
    suppressPreexistingDialogs(true);
    document.documentElement.classList.add("infcanvas-mode");
    if (!state.docs.length) {
      /* Rebuild every open tab from persisted state. Saved canvases come from
         disk (fresh), unsaved ones from their localStorage draft. Both carry
         their original id so drafts/metas stay attached. */
      const tabs = storageRead(TABS_KEY);
      if (tabs && Array.isArray(tabs.ids) && tabs.ids.length) {
        for (const id of tabs.ids) {
          const meta = storageRead(META_KEY(id));
          let data = readDraft(id);
          let name = meta?.name || "";
          let saved = !!meta?.saved;
          if (saved && name) {
            try {
              const response = await backend.canvas(name);
              if (response.exists) data = response.data;
              else { /* file gone: fall back to draft if we have one */
                if (!data) continue;
                saved = false;
              }
            } catch (error) { if (!data) continue; }
          }
          if (!data) continue;
          const doc = createDoc(name || null, data, id);
          doc.saved = saved;
          doc.dirty = !saved;
          state.docs.push(doc);
        }
      }
      if (!state.docs.length) {
        const doc = createDoc();
        state.docs.push(doc);
        writeDraft(doc);
      }
      const wanted = tabs && Number.isInteger(tabs.activeIndex)
        ? Math.min(Math.max(tabs.activeIndex, 0), state.docs.length - 1) : 0;
      state.activeId = state.docs[wanted]?.id || state.docs[0].id;
    }
    switchDoc(state.activeId || state.docs[0].id);
    toast("info", tr("已进入无限画布"), tr("拖入素材或点击左侧「节点」"));
  }

  async function exit() {
    if (state.exiting) return;
    if (!state.active) {
      document.documentElement.classList.remove("infcanvas-mode");
      suppressPreexistingDialogs(false);
      NS.ui?.unmountShell();
      flow()?.unmount?.();
      return;
    }
    state.exiting = true;
    try {
      for (const doc of Array.from(state.docs)) {
        if (doc.dirty) {
          const choice = await confirmDialog({
            title: tr("保存更改？"),
            message: tr("画布「{name}」有未保存的更改", { name: doc.name || BASE_NAME }),
            hint: tr("保存：保存后返回；不保存：直接返回；取消操作：留在画布"),
            threeWay: true,
          });
          if (choice === null) return;
          if (choice === true && !(await saveActive(false, doc))) return;
        }
        syncDocFromFlow(doc);
        writeDraft(doc);
      }
      persistTabs();
      state.active = false;
      try { flow()?.pauseAll?.(); } catch (error) { /* optional */ }
      document.documentElement.classList.remove("infcanvas-mode");
      suppressPreexistingDialogs(false);
      NS.ui?.removeTabs();
      try { NS.controls?.unmount?.(); } catch (error) { /* optional */ }
      NS.ui?.unmountShell();
      flow()?.unmount?.();
      toast("info", tr("已返回 ComfyUI"));
    } finally {
      state.exiting = false;
    }
  }

  /* ------------------------------- init -------------------------------- */

  /* ComfyUI keeps its own dialogs mounted after closing them (the template
     browser stays in the DOM with data-state="open" while visibility:hidden),
     so a bare querySelector would swallow every canvas shortcut. Only a dialog
     that is actually on screen may own the keyboard. */
  function hostDialogOpen() {
    const dialogs = document.querySelectorAll('[data-reka-dialog-content][data-state="open"]');
    for (const dialog of dialogs) {
      const style = getComputedStyle(dialog);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const box = dialog.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return true;
    }
    return false;
  }

  function onKeyDown(event) {
    if (!state.active) return;
    /* Our own tool modals own the keyboard while open (Delete/Ctrl+S/etc.
       must not mutate the graph behind them). */
    if (NS.tools?.isOpen?.()) return;
    if (hostDialogOpen()) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
    const key = String(event.key || "").toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && key === "i") {
      event.preventDefault(); event.stopImmediatePropagation();
      exit();
      return;
    }
    if (mod && key === "s") {
      event.preventDefault(); event.stopImmediatePropagation();
      saveActive(false);
      return;
    }
    /* Ctrl+Z undo / Ctrl+Y (or Ctrl+Shift+Z) redo — ComfyUI's ChangeTracker
       bindings. Hand mode is the read-only canvas, so it blocks both. */
    if (mod && (key === "z" || key === "y")) {
      if (NS.flow?.state?.mode?.value === "drag") return;
      const redo = key === "y" || event.shiftKey;
      event.preventDefault(); event.stopImmediatePropagation();
      if (redo) flow()?.history?.redo?.();
      else flow()?.history?.undo?.();
      return;
    }
    if ((key === "delete" || key === "backspace") && !mod) {
      /* Hand mode is ComfyUI's read_only canvas: it blocks every mutation. */
      if (NS.flow?.state?.mode?.value === "drag") return;
      const selected = flow()?.selectedNodes?.() || [];
      /* Groups share the selection with nodes: Delete removes both, while a
         group's member nodes stay exactly where they are (ComfyUI's
         selected-LGraphGroup behaviour). */
      const groupIds = (flow()?.state?.selectedGroupIds?.value || []).slice();
      if (selected.length || groupIds.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (selected.length) flow().removeNodes(selected.map((node) => node.id));
        if (groupIds.length) flow()?.state?.groupActions?.deleteGroups?.(groupIds);
        markDirty();
        return;
      }
      /* No node or group selected: a highlighted link is what Delete removes. */
      const edges = NS.flow?.state?.flow?.getSelectedEdges?.value || [];
      if (edges.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        flow().removeEdges(edges.map((edge) => edge.id));
      }
      return;
    }
    /* Ctrl+G groups the current selection, like ComfyUI's group command.
       At least two nodes are required; a single node is not a selection. */
    if (mod && key === "g" && !event.shiftKey) {
      const selected = flow()?.selectedNodes?.() || [];
      if (selected.length >= 2) {
        event.preventDefault(); event.stopImmediatePropagation();
        flow()?.state?.groupActions?.createGroup?.();
      }
      return;
    }
    if (mod && key === "a") {
      const nodes = flow()?.nodesOf?.() || [];
      if (nodes.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        flow().selectNodes(nodes.map((node) => node.id));
      }
    }
  }

  function onKeyBubble(event) {
    if (!state.active) return;
    const target = event.target;
    if (target instanceof Element && target.closest(
      '[role="dialog"], [data-reka-dialog-content], [data-reka-portal], [data-toast-dock], .z-overlay, .z-toast')) return;
    if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]")) return;
    event.stopPropagation();
  }

  function init(app) {
    if (NS.ready) return;
    NS.app = app;
    NS.ui?.injectStyles();
    if (flow()) {
      flow().state.onDirty = () => markDirty();
      // The toolbar used to be refreshed by LiteGraph's per-frame draw loop;
      // now the viewport event is the only thing that changes the zoom label.
      flow().onViewport = () => NS.controls?.tick?.();
    }
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onKeyBubble, false);
    document.addEventListener("keyup", onKeyBubble, false);
    /* System clipboard paste -> nodes. Capture phase so Vue Flow / ComfyUI's
       own handlers see it after us, and we can cancel a plain-text paste. */
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("pointermove", rememberPointer, true);
    document.addEventListener("pointerdown", rememberPointer, true);
    NS.ready = true;
    // core.js may load before infcanvas-flow.js; wire the dirty hook once both exist.
    if (!NS.flow) {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (NS.flow) {
          NS.flow.state.onDirty = () => markDirty();
          NS.flow.onViewport = () => NS.controls?.tick?.();
          clearInterval(timer);
        } else if (tries > 100) clearInterval(timer);
      }, 50);
    }
  }

  /* LoRA names come straight from ComfyUI's object_info (the same source the
     real Load LoRA node uses). Cached for the session; an empty result just
     leaves the stack's dropdown empty and the node still functional. */
  let loraNamesCache = null;
  async function loraNames(force = false) {
    if (!force && loraNamesCache) return loraNamesCache;
    try {
      const defs = await API().getNodeDefs();
      const names = defs?.LoraLoaderModelOnly?.input?.required?.lora_name?.[0];
      loraNamesCache = Array.isArray(names) ? names.slice() : [];
    } catch (error) { loraNamesCache = []; }
    return loraNamesCache;
  }

  NS.api = {
    init, enter, exit, toast, confirmDialog, promptDialog, viewUrl, resolveMediaUrl,
    markDirty, saveActive, closeDoc, closeDocsAt, openByName, newCanvas,
    renameDoc, duplicateDoc, switchDoc,
    renameCanvas, duplicateCanvas, isBookmarked, toggleBookmark,
    addNodeByType, removeNode, revealNode, freeSpot, activeDoc, kindFromFile, esc, readTextFile,
    addToFavorites, loraNames, listPrompts, addPrompt, removePrompt, updatePrompt,
    docs: () => state.docs, activeId: () => state.activeId,
    isActive: () => state.active,
    /** @deprecated kept for extensions written against the LiteGraph build. */
    canvas: () => null,
    activeGraph: () => activeDoc(),
  };

  if (NS.pendingApp && !NS.ready && NS.css && NS.ui?.injectStyles) init(NS.pendingApp);
})();
