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

  /* `size` is the whole frame for every node (no title bar any more):
     asset nodes fill it with media, generate nodes host their form inside it. */
  const SPECS = [
    { type: "infcanvas/asset_image", role: "asset", kind: "image", title: "图像", desc: "图片素材", icon: "pi pi-image", size: [320, 180] },
    { type: "infcanvas/asset_video", role: "asset", kind: "video", title: "视频", desc: "视频素材", icon: "pi pi-video", size: [320, 180] },
    { type: "infcanvas/asset_audio", role: "asset", kind: "audio", title: "音频", desc: "音频素材", icon: "pi pi-volume-up", size: [320, 180] },
    { type: "infcanvas/asset_text", role: "text", kind: "text", title: "文本", desc: "文本素材", icon: "pi pi-align-left", size: [320, 180] },
    { type: "infcanvas/gen_image", role: "gen", kind: "image", title: "生成图像", desc: "调用 ComfyUI 生成图片", icon: "pi pi-sparkles", workflow: "image", size: [320, 180] },
    { type: "infcanvas/gen_video", role: "gen", kind: "video", title: "生成视频", desc: "调用 ComfyUI 生成视频", icon: "pi pi-sparkles", workflow: "video", size: [320, 180] },
    { type: "infcanvas/gen_audio", role: "gen", kind: "audio", title: "生成音频", desc: "调用 ComfyUI 生成音频", icon: "pi pi-sparkles", workflow: "audio", size: [320, 180] },
  ];
  const TYPE_BY_KIND = {
    image: "infcanvas/asset_image",
    video: "infcanvas/asset_video",
    audio: "infcanvas/asset_audio",
    text: "infcanvas/asset_text",
  };
  const SPEC_BY_TYPE = Object.fromEntries(SPECS.map((spec) => [spec.type, spec]));
  const TYPE_BY_LEGACY = SPEC_BY_TYPE;
  NS.SPECS = SPECS;
  NS.TYPE_BY_KIND = TYPE_BY_KIND;

  const TITLE_H = 30;
  const SLOT_IDS = ["image", "video", "audio", "text"];

  /* ------------------------------ helpers ------------------------------ */

  function toast(kind, summary, detail = "") {
    const t = EXT()?.toast;
    if (!t) { console.log("[InfCanvas]", kind, summary, detail); return; }
    try {
      if (typeof t[kind] === "function") t[kind](summary, { description: detail, duration: 3200 });
      else if (typeof t.add === "function") t.add({ severity: kind, summary, detail, life: 3200 });
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

  function viewUrl(asset) {
    const query = new URLSearchParams({
      filename: asset.filename || "",
      subfolder: asset.subfolder || "",
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
      seed: 0, steps: 20, width: 512, height: 512,
      workflow: spec.workflow || "",
      status: "idle", error: "", result: null,
      size: spec.size.slice(),
    };
    if (asset) {
      data.kind = asset.kind || data.kind;
      if (asset.text) data.text = asset.text;
      data.title = spec.title + " · " + (asset.name || "");
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
      const spec = TYPE_BY_LEGACY[node.type] ||
        (props.role === "gen" ? SPEC_BY_TYPE["infcanvas/gen_" + (props.kind || "image")] : SPEC_BY_TYPE[TYPE_BY_KIND[props.kind || "image"]]);
      if (!spec) continue;
      const pos = Array.isArray(node.pos) ? node.pos : [node.pos?.[0] || 0, node.pos?.[1] || 0];
      const size = Array.isArray(node.size) ? node.size : (spec.size || [320, 180]);
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
          size: [Number(size[0]) || 320, Number(size[1]) || 180],
        },
      };
      idMap.set(String(node.id), created);
      doc.nodes.push(created);
    }

    for (const link of legacyLinks) {
      const parts = Array.isArray(link)
        ? { id: link[0], origin_id: link[1], target_id: link[3], target_slot: link[4] }
        : link;
      const target = idMap.get(String(parts.target_id));
      if (!target) continue;
      // Only generation nodes accept input now; legacy links into material
      // nodes (old "in" handle) are dropped to match the current rule.
      if (target.data.role !== "gen") continue;
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

  function hydrate(doc, data) {
    if (!data) return;
    if (Number(data.version) >= 2 && Array.isArray(data.nodes)) {
      doc.nodes = data.nodes;
      doc.edges = Array.isArray(data.edges) ? data.edges : [];
      /* Generate nodes now expose a single input handle ("in"). Normalize legacy
         edges that targeted the old four typed handles so their lines survive. */
      const genIds = new Set(doc.nodes.filter((n) => n?.data?.role === "gen").map((n) => String(n.id)));
      for (const edge of doc.edges) {
        if (genIds.has(String(edge.target))) edge.targetHandle = "in";
      }
      doc.viewport = normalizeViewport(data.viewport);
      return;
    }
    try { migrateLegacyGraph(doc, data); }
    catch (error) {
      console.error("[InfCanvas] migrate failed", error);
      toast("error", "画布迁移失败", String(error));
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

  function createDoc(name = null, data = null) {
    const doc = {
      id: uid(), name: name || unconflictedName(), saved: !!name, dirty: false,
      nodes: [], edges: [], viewport: null,
    };
    hydrate(doc, data);
    return doc;
  }

  function markDirty(doc = null) {
    const target = doc || activeDoc();
    if (!target) return;
    if (!target.dirty) { target.dirty = true; NS.ui?.renderTabs(); }
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
    doc.viewport = snapshot.viewport;
  }

  function switchDoc(id) {
    const previous = activeDoc();
    if (previous && previous.id !== id) syncDocFromFlow(previous);
    const doc = state.docs.find((entry) => entry.id === id);
    if (!doc || !flow()) return;
    state.activeId = id;
    flow().load(doc);
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
  }

  async function saveActive(askName = false, docOverride = null) {
    const doc = docOverride || activeDoc();
    if (!doc) return false;
    let name = doc.name;
    if (!name || askName) {
      const input = await promptDialog({
        title: "保存画布", message: "画布名称",
        defaultValue: name || BASE_NAME,
      });
      if (input === null || !String(input).trim()) return false;
      name = String(input).trim();
    }
    if (doc.id === state.activeId) syncDocFromFlow(doc);
    const payload = {
      version: 2, engine: "vueflow",
      name, savedAt: new Date().toISOString(),
      nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport,
    };
    await backend.save(name, payload);
    doc.name = name; doc.saved = true; doc.dirty = false;
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
    toast("success", "画布已保存", name);
    return true;
  }

  async function closeDoc(id) {
    const doc = state.docs.find((entry) => entry.id === id);
    if (!doc) return false;
    if (doc.dirty) {
      const choice = await confirmDialog({
        title: "保存更改？",
        message: `画布「${doc.name || BASE_NAME}」有未保存的更改`,
        hint: "保存：保存并关闭；不保存：直接关闭；取消操作：留在当前状态",
        threeWay: true,
      });
      if (choice === null) return false;
      if (choice === true && !(await saveActive(false, doc))) return false;
    }
    state.docs = state.docs.filter((entry) => entry.id !== id);
    if (state.activeId === id) {
      const next = state.docs[0];
      if (next) switchDoc(next.id);
      else {
        const fresh = createDoc();
        state.docs.push(fresh);
        switchDoc(fresh.id);
      }
    }
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
    return true;
  }

  async function openByName(name) {
    const existing = state.docs.find((doc) => doc.name === name);
    if (existing) { switchDoc(existing.id); return; }
    try {
      const response = await backend.canvas(name);
      const doc = createDoc(name, response.exists ? response.data : null);
      state.docs.push(doc);
      switchDoc(doc.id);
      toast("info", "已打开画布", name);
    } catch (error) { toast("error", "打开画布失败", String(error)); }
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
      title: "重命名画布", message: "画布名称",
      defaultValue: doc.name || BASE_NAME,
    });
    if (value === null || !String(value).trim()) return;
    doc.name = String(value).trim();
    doc.dirty = true;
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
      viewport: doc.viewport ? { ...doc.viewport } : null,
    });
    copy.name = name;
    copy.saved = false;
    copy.dirty = true;
    state.docs.push(copy);
    switchDoc(copy.id);
    NS.ui?.renderTabs();
    NS.ui?.refreshPanels();
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

  function addNodeByType(type, pos = null, asset = null) {
    const spec = SPEC_BY_TYPE[type];
    if (!spec || !flow()) {
      toast("error", "无法创建节点", "画布尚未就绪，请刷新页面后重试");
      return null;
    }
    const autoPlaced = !pos;
    const position = autoPlaced ? freeSpot(centerPos(), spec.size, spec.role) : [pos[0], pos[1]];
    const node = nodeFromSpec(spec, position, asset);
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
      if (!kind) { toast("warning", "不支持的文件类型", file.name); continue; }
      try {
        const asset = await backend.upload(file);
        if (kind === "text") {
          try { asset.text = (await readTextFile(file)).slice(0, 4000); } catch (error) { /* binary */ }
        }
        addNodeByType(TYPE_BY_KIND[kind], [point.x + index * 24, point.y + index * 24], asset);
        NS.ui?.refreshPanels();
        toast("success", "素材已添加", file.name);
      } catch (error) { toast("error", "上传失败", file.name + " · " + String(error)); }
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
      } catch (error) { toast("error", "资产解析失败", String(error)); }
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
      const asset = source?.data?.asset;
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
        text: source.data.text || "",
      });
    }
    return result;
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
  function applyNodeInputs(target, data) {
    if (!target || typeof target !== "object") return;
    const writes = [];
    const map = data?.audioMap || {};
    if (map.a) writes.push([map.a, data.prompt ?? ""]);
    if (map.b) writes.push([map.b, data.lyrics ?? ""]);
    for (const [id, value] of Object.entries(data?.apiValues || {})) writes.push([id, value]);
    for (const [id, value] of writes) {
      const [nodeId, key] = String(id).split(":");
      const node = target[nodeId];
      if (!node || !key || !node.inputs || !(key in node.inputs)) continue;
      if (Array.isArray(node.inputs[key])) continue;
      /* Copy-on-write so the caller's template object is never mutated. */
      target[nodeId] = { ...node, inputs: { ...node.inputs, [key]: value } };
    }
  }

  async function buildPrompt(kind, template, data, inputs) {
    let checkpoint = "";
    try {
      const defs = await API().getNodeDefs();
      checkpoint = defs?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0]?.[0] || "";
    } catch (error) { /* object_info may be unavailable */ }
    const find = (wanted) => inputs.find((entry) => entry.kind === wanted)?.asset || null;
    const image = find("image"), video = find("video"), audio = find("audio");
    const text = inputs.filter((entry) => entry.kind === "text")
      .map((entry) => entry.text || entry.asset?.name || "").filter(Boolean).join("\n");
    const promptText = [data.prompt || "", text].filter(Boolean).join("\n") || "a photo";
    if (image && image.type !== "input") {
      throw new Error("图像素材需来自 input 目录；请先把该素材拖入画布上传一次");
    }
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
      tone: data.prompt || "",
      seed: Number(data.seed) || Math.floor(Math.random() * 1000000000),
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
    applyNodeInputs(prompt, data);
    if (image && prompt["3"]?.inputs && prompt["4"] && prompt["5"]) {
      prompt["1001"] = { class_type: "LoadImage", inputs: { image: values.image } };
      prompt["1002"] = { class_type: "VAEEncode", inputs: { pixels: ["1001", 0], vae: ["4", 2] } };
      prompt["3"].inputs.latent_image = ["1002", 0];
      delete prompt["5"];
    }
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

  function attachResult(node, asset) {
    const type = TYPE_BY_KIND[asset.kind] || TYPE_BY_KIND.text;
    const size = node.data?.size || [250, 230];
    const position = [
      node.position.x + (size[0] || 250) + 70,
      node.position.y + (state.results % 5) * 46,
    ];
    const created = addNodeByType(type, position, asset);
    // Material nodes no longer accept input connections, so the generated
    // result is placed next to the generator rather than wired into it.
    node.data.result = asset;
    state.results += 1;
  }

  NS.generate = {
    async run(nodeId) {
      const node = (flow()?.nodesOf?.() || []).find((entry) => entry.id === nodeId);
      if (!node) return;
      const data = node.data;
      if (data.status === "running") { toast("info", "该节点正在生成"); return; }
      const kind = data.kind;
      const templateName = data.workflow || kind;
      let template;
      try { template = await backend.workflow(templateName); }
      catch (error) { toast("error", "读取生成模板失败", String(error)); return; }
      if (template?._requires_config) {
        toast("warning", "请先配置生成模板", template.hint || `workflows/${templateName}.json`);
        return;
      }
      let prompt;
      try { prompt = await buildPrompt(kind, template, data, collectInputs(data)); }
      catch (error) { toast("error", "构建工作流失败", String(error)); return; }
      data.status = "running";
      data.error = "";
      markDirty();
      /* A status flip is runtime state, not an edit: keep it out of undo. */
      NS.flow?.history?.absorb?.();
      try {
        const queued = await API().queuePrompt(0, { output: prompt, workflow: {} });
        if (!queued?.prompt_id) throw new Error("提交任务失败，未返回 prompt_id");
        const outputs = await pollHistory(queued.prompt_id);
        if (!outputs.length) throw new Error("任务完成但没有返回可用输出");
        outputs.forEach((asset) => attachResult(node, asset));
        data.status = "done";
        toast("success", "生成完成", `${outputs.length} 个结果已回贴到画布`);
      } catch (error) {
        data.status = "error";
        data.error = String(error);
        toast("error", "生成失败", String(error));
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
    /* Generate nodes never accept media (ported from the reference project's
       xcat-no-media-import.js). Swallow dragover/drop in the CAPTURE phase so
       the host's drop handler above never fires for a generate node — the event
       is stopped before it can bubble down to `host`. Everything else (asset
       nodes, empty canvas, panel media-strip reorders) passes through. */
    const genTarget = (event) => {
      const t = event.target;
      return t && t.closest ? t.closest(".icn--gen") : null;
    };
    document.addEventListener("dragover", (event) => {
      if (!state.active || !genTarget(event)) return;
      event.preventDefault(); event.stopPropagation();
      try { if (event.dataTransfer) event.dataTransfer.dropEffect = "none"; } catch (error) { /* ignore */ }
    }, true);
    document.addEventListener("drop", (event) => {
      if (!state.active || !genTarget(event)) return;
      event.preventDefault(); event.stopPropagation();
      toast("warning", "生成节点不接受素材", "请在下方选择工作流并运行");
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
      toast("error", "画布引擎未就绪", "请刷新页面后重试");
      return;
    }
    NS.ui?.injectStyles();
    const shell = NS.ui?.mountShell();
    if (!shell) { toast("error", "画布界面创建失败", "请刷新页面后重试"); return; }
    ensureSurface(shell.stage);
    try { NS.controls?.mount?.(shell.stage); }
    catch (error) { console.error("[InfCanvas] mountControls failed", error); }
    try { NS.ui?.mountTabs(); }
    catch (error) { console.error("[InfCanvas] mountTabs failed", error); }
    state.active = true;
    suppressPreexistingDialogs(true);
    document.documentElement.classList.add("infcanvas-mode");
    if (!state.docs.length) {
      const doc = createDoc();
      state.docs.push(doc);
      state.activeId = doc.id;
    }
    switchDoc(state.activeId || state.docs[0].id);
    toast("info", "已进入无限画布", "拖入素材或点击左侧「新建节点」");
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
            title: "保存更改？",
            message: `画布「${doc.name || BASE_NAME}」有未保存的更改`,
            hint: "保存：保存后返回；不保存：直接返回；取消操作：留在画布",
            threeWay: true,
          });
          if (choice === null) return;
          if (choice === true && !(await saveActive(false, doc))) return;
        }
        syncDocFromFlow(doc);
      }
      state.active = false;
      try { flow()?.pauseAll?.(); } catch (error) { /* optional */ }
      document.documentElement.classList.remove("infcanvas-mode");
      suppressPreexistingDialogs(false);
      NS.ui?.removeTabs();
      try { NS.controls?.unmount?.(); } catch (error) { /* optional */ }
      NS.ui?.unmountShell();
      flow()?.unmount?.();
      toast("info", "已返回 ComfyUI");
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
      if (selected.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        flow().removeNodes(selected.map((node) => node.id));
        markDirty();
        return;
      }
      /* No node selected: a highlighted link is what Delete removes. */
      const edges = NS.flow?.state?.flow?.getSelectedEdges?.value || [];
      if (edges.length) {
        event.preventDefault(); event.stopImmediatePropagation();
        flow().removeEdges(edges.map((edge) => edge.id));
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

  NS.api = {
    init, enter, exit, toast, confirmDialog, promptDialog, viewUrl, resolveMediaUrl,
    markDirty, saveActive, closeDoc, closeDocsAt, openByName, newCanvas,
    renameDoc, duplicateDoc, switchDoc,
    addNodeByType, removeNode, revealNode, freeSpot, activeDoc, kindFromFile, esc, readTextFile,
    docs: () => state.docs, activeId: () => state.activeId,
    isActive: () => state.active,
    /** @deprecated kept for extensions written against the LiteGraph build. */
    canvas: () => null,
    activeGraph: () => activeDoc(),
  };

  if (NS.pendingApp && !NS.ready && NS.css && NS.ui?.injectStyles) init(NS.pendingApp);
})();
