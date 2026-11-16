/* API 配置弹窗.

   A 1:1 port of the reference project's "工作流配置" dialog:
     frontend/src/components/dialogs/WorkflowConfig.vue
     frontend/src/components/FloatingWindow/index.vue
     frontend/src/components/WorkflowPreview/index.vue
     frontend/src/components/WorkflowPreview/PreviewNode.vue
     frontend/src/components/WorkflowPreview/NodeFields.vue

   The rail entry (labelled "API", see infcanvas-ui.js) opens this dialog;
   the dialog title is "API配置" (renamed from 工作流配置 as requested).
   The reference gates its "COMFYUI 后端地址" input behind import.meta.env.DEV
   (WorkflowConfig.vue: showAddress); this build ships INSIDE ComfyUI, so that
   dev-only field is intentionally omitted - every request already goes to the
   current ComfyUI server. All shipped features are kept: drag-to-reorder
   workflow list, multi-file upload with API-format validation, delete, message toast,
   "N 个节点 · 已暴露 M 个字段" head, save/delete actions, a zoomable node-graph
   preview with a fit button, click-a-node field inspector (all 11 field types,
   select options, number ranges, media notes), field persistence into
   <name>.fields.json, and the workflows-changed event that refreshes the
   workflow selector inside every generate node.

   The shell is NS.tools.openModal (mounts inside #infcanvas-root, swallows
   canvas gestures, Escape to close, NS.tools.isOpen() guards core.js).
   The graph preview is plain DOM + SVG rather than a second VueFlow app: the
   layout algorithm, hue mapping, node card and zoom controls are ported
   verbatim from WorkflowPreview/PreviewNode. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});

  const CSS = `
.ac-config, .ac-config * { box-sizing:border-box; }
.ac-config {
  display:flex; gap:14px; height:100%; min-height:0;
  color:var(--ic-text, #ffffff);
  font:var(--ic-ctrl-fs, 12px)/1.5 Inter, ui-sans-serif, system-ui, sans-serif;
}
.ac-config button { font:inherit; cursor:pointer; }
.ac-config input, .ac-config select { font:inherit; }
.ac-config [hidden] { display:none !important; }

/* ---------------- left column ---------------- */
.ac-left { flex:0 0 268px; display:flex; flex-direction:column; gap:12px; min-height:0; overflow:auto; }
.ac-block { display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid var(--ic-line, #494a50);
  border-radius:var(--ic-radius, 10px); background:var(--ic-input, #171718); }
.ac-grow { flex:1 1 auto; min-height:0; }
.ac-label { font-size:10px; letter-spacing:.08em; color:var(--ic-soft, #8a8a8a); }
.ac-list { display:flex; flex-direction:column; gap:4px; min-height:0; overflow:auto; }
.ac-item { display:flex; align-items:center; gap:8px; width:100%; padding:8px 9px;
  border:1px solid transparent; border-radius:var(--ic-ctrl-r, 7px); background:transparent;
  color:var(--ic-text, #ffffff); text-align:left; }
.ac-item:hover { background:var(--ic-hover, #313235); }
.ac-item.is-active { border-color:var(--ic-brand, #0b8ce9); background:var(--ic-brand-soft, rgba(11,140,233,.15)); }
.ac-item.is-dragging { opacity:.45; }
.ac-item.is-drop { border-color:var(--ic-brand, #0b8ce9); background:var(--ic-brand-soft, rgba(11,140,233,.15)); }
.ac-item-icon { flex:0 0 auto; color:var(--ic-soft, #8a8a8a); }
.ac-item-name { flex:1 1 auto; min-width:0; font-size:var(--ic-ctrl-fs, 12px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ac-item-meta { flex:0 0 auto; font-size:11px; color:var(--ic-soft, #8a8a8a); }
.ac-empty-list { padding:14px 10px; border:1px dashed var(--ic-line, #494a50); border-radius:var(--ic-ctrl-r, 7px);
  font-size:11px; color:var(--ic-soft, #8a8a8a); text-align:center; }
.ac-upload { height:var(--ic-ctrl-h, 30px); border:1px dashed var(--ic-line, #494a50); border-radius:var(--ic-ctrl-r, 7px);
  background:transparent; color:var(--ic-soft, #8a8a8a); font-size:var(--ic-ctrl-fs, 12px); }
.ac-upload:hover { border-color:var(--ic-brand, #0b8ce9); color:var(--ic-brand, #0b8ce9); }
.ac-msg { padding:8px 10px; border-radius:var(--ic-ctrl-r, 7px); background:var(--ic-panel, #262729);
  font-size:11px; color:var(--ic-soft, #8a8a8a); }
.ac-msg.is-error { background:var(--ic-danger-soft, rgba(179,58,58,.16)); color:var(--ic-danger, #b33a3a); }

/* ---------------- right column ---------------- */
.ac-right { position:relative; flex:1 1 auto; display:flex; flex-direction:column; gap:12px;
  min-width:0; min-height:0; }
.ac-head { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:10px 12px; border:1px solid var(--ic-line, #494a50); border-radius:var(--ic-radius, 10px);
  background:var(--ic-input, #171718); }
.ac-head-info { min-width:0; }
.ac-name { font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ac-sub { margin-top:2px; font-size:11px; color:var(--ic-soft, #8a8a8a); }
.ac-actions { flex:0 0 auto; display:flex; gap:6px; }
.ac-danger { height:var(--ic-ctrl-h, 30px); padding:0 12px; border:1px solid var(--ic-line, #494a50);
  border-radius:var(--ic-ctrl-r, 7px); background:transparent; color:var(--ic-soft, #8a8a8a);
  font-size:var(--ic-ctrl-fs, 12px); }
.ac-danger:hover { border-color:var(--ic-danger, #b33a3a); background:var(--ic-danger-soft, rgba(179,58,58,.16));
  color:var(--ic-danger, #b33a3a); }
.ac-save { height:var(--ic-ctrl-h, 30px); padding:0 12px; border:1px solid var(--ic-brand, #0b8ce9);
  border-radius:var(--ic-ctrl-r, 7px); background:var(--ic-brand, #0b8ce9); color:#fff;
  font-size:var(--ic-ctrl-fs, 12px); }
.ac-save:hover:not(:disabled) { filter:brightness(.9); }
.ac-save:disabled { opacity:.45; cursor:default; }

/* ---------------- graph preview ---------------- */
.ac-preview { position:relative; flex:1 1 auto; min-height:0; border:1px solid var(--ic-line, #494a50);
  border-radius:var(--ic-radius, 10px); overflow:hidden; background:var(--ic-input, #171718); }
.ac-viewport { position:absolute; inset:0; overflow:hidden; cursor:grab;
  background-color:var(--ic-input, #171718);
  background-image:radial-gradient(var(--ic-line, #494a50) 1px, transparent 1px);
  background-size:18px 18px; }
.ac-viewport.is-panning { cursor:grabbing; }
.ac-scene { position:absolute; left:0; top:0; transform-origin:0 0; will-change:transform; }
.ac-edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; z-index:0; }
.ac-edge { fill:none; stroke:var(--ic-soft, #8a8a8a); stroke-width:1.2; opacity:.55; }
/* The hue border still distinguishes node TYPES; the card surface itself now
   uses the same theme palette as every other panel. */
.ac-node { position:absolute; z-index:1; width:168px; padding:6px 9px;
  border:1px solid hsl(var(--n-hue) 42% 55% / .55); border-radius:var(--ic-ctrl-r, 7px);
  background:var(--ic-panel, #262729); box-shadow:0 4px 12px rgba(0,0,0,.45);
  cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease; }
.ac-node:hover { border-color:hsl(var(--n-hue) 55% 70%); box-shadow:0 4px 16px rgba(0,0,0,.45); }
.ac-node.is-configurable { border-color:var(--ic-brand, #0b8ce9); }
.ac-node-title { display:flex; align-items:baseline; justify-content:space-between; gap:6px;
  font-size:11px; font-weight:600; color:var(--ic-text, #ffffff); white-space:nowrap; overflow:hidden; }
.ac-node-id { flex:0 0 auto; font-weight:400; font-size:10px; color:hsl(var(--n-hue) 55% 72%); }
.ac-node-type { display:flex; align-items:center; gap:4px; margin-top:2px; font-size:10px;
  color:var(--ic-soft, #8a8a8a); white-space:nowrap; overflow:hidden; }
.ac-node-count { margin-left:auto; flex:0 0 auto; color:var(--ic-brand, #0b8ce9); }
.ac-handle { position:absolute; top:50%; width:6px; height:6px; margin-top:-3px; border-radius:50%;
  background:hsl(var(--n-hue) 45% 60% / .7); }
.ac-handle--in { left:-4px; }
.ac-handle--out { right:-4px; }
.ac-tools { position:absolute; top:10px; right:10px; z-index:5; display:flex; align-items:center; gap:2px;
  padding:3px; border:1px solid var(--ic-line, #494a50); border-radius:var(--ic-ctrl-r, 7px);
  background:var(--ic-panel, #262729); }
.ac-tools button { width:24px; height:24px; display:grid; place-items:center; border:0; border-radius:5px;
  background:transparent; color:var(--ic-soft, #8a8a8a); font-size:13px; }
.ac-tools button:hover { background:var(--ic-hover, #313235); color:var(--ic-text, #ffffff); }
.ac-fit { width:auto !important; padding:0 8px; font-size:11px !important; }
.ac-zoom { min-width:40px; text-align:center; font-size:11px; color:var(--ic-soft, #8a8a8a); }
.ac-empty { position:absolute; inset:0; display:grid; place-items:center; font-size:var(--ic-ctrl-fs, 12px);
  color:var(--ic-soft, #8a8a8a); pointer-events:none; }
.ac-empty.is-tip { inset:auto 0 14px; font-size:11px; }

/* ---------------- node fields inspector ---------------- */
.ac-nf-mask { position:absolute; inset:0; z-index:15; display:flex; align-items:center;
  justify-content:center; padding:24px; background:rgba(0,0,0,.66); backdrop-filter:blur(2px); }
.ac-nf-card { display:flex; flex-direction:column; width:min(520px,100%); max-height:100%;
  border:1px solid var(--ic-line, #494a50); border-radius:var(--ic-radius-lg, 14px);
  background:var(--ic-panel, #262729); box-shadow:0 20px 50px rgba(0,0,0,.45); overflow:hidden; }
.ac-nf-head { flex:0 0 auto; display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
  padding:14px 14px 10px; border-bottom:1px solid var(--ic-line, #494a50); }
.ac-nf-title { display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; }
.ac-nf-dot { width:9px; height:9px; border-radius:2px; background:var(--ic-brand, #0b8ce9); transform:rotate(45deg); }
.ac-nf-sub { margin-top:2px; font-size:11px; color:var(--ic-soft, #8a8a8a); }
.ac-nf-close { width:26px; height:26px; flex:0 0 auto; display:grid; place-items:center; border:0;
  border-radius:var(--ic-ctrl-r, 7px); background:transparent; color:var(--ic-soft, #8a8a8a);
  font-size:16px; line-height:1; }
.ac-nf-close:hover { background:var(--ic-hover, #313235); color:var(--ic-text, #ffffff); }
.ac-nf-list { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; gap:8px;
  padding:12px; overflow-y:auto; }
.ac-nf-item { padding:9px 10px; border:1px solid var(--ic-line, #494a50);
  border-radius:var(--ic-radius, 10px); background:var(--ic-input, #171718); }
.ac-nf-enable { display:flex; align-items:center; gap:8px; cursor:pointer; }
.ac-nf-check { flex:0 0 auto; width:14px; height:14px; margin:0; border:1px solid var(--ic-line, #494a50);
  border-radius:4px; background:var(--ic-input, #171718); appearance:none; -webkit-appearance:none; cursor:pointer; }
.ac-nf-check:checked { border-color:var(--ic-brand, #0b8ce9); background:var(--ic-brand, #0b8ce9); }
.ac-nf-key { font-size:var(--ic-ctrl-fs, 12px); color:var(--ic-text, #ffffff); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ac-nf-default { margin-left:auto; flex:0 1 auto; min-width:0; font-size:11px; color:var(--ic-soft, #8a8a8a);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ac-nf-detail { display:flex; flex-direction:column; gap:6px; margin-top:8px; padding-top:8px;
  border-top:1px dashed var(--ic-line, #494a50); }
.ac-nf-row { display:flex; gap:6px; }
.ac-nf-select, .ac-nf-input { height:var(--ic-ctrl-h, 30px); padding:0 8px; border:1px solid var(--ic-line, #494a50);
  border-radius:var(--ic-ctrl-r, 7px); background:var(--ic-input, #171718); color:var(--ic-text, #ffffff);
  font-size:var(--ic-ctrl-fs, 12px); outline:none; min-width:0; }
.ac-nf-select:focus, .ac-nf-input:focus { border-color:var(--ic-brand, #0b8ce9); }
.ac-nf-select { flex:0 0 108px; }
.ac-nf-input { flex:1 1 auto; }
.ac-nf-options { display:flex; flex-direction:column; gap:6px; }
.ac-nf-note { padding:6px 8px; border-radius:var(--ic-ctrl-r, 7px); background:var(--ic-panel, #262729);
  font-size:11px; line-height:1.5; color:var(--ic-soft, #8a8a8a); }
.ac-nf-remove { flex:0 0 auto; width:var(--ic-ctrl-h, 30px); height:var(--ic-ctrl-h, 30px); display:grid; place-items:center;
  border:1px solid var(--ic-line, #494a50); border-radius:var(--ic-ctrl-r, 7px);
  background:var(--ic-panel, #262729); color:var(--ic-soft, #8a8a8a); font-size:14px; line-height:1; }
.ac-nf-remove:hover { border-color:var(--ic-danger, #b33a3a); background:var(--ic-danger-soft, rgba(179,58,58,.16));
  color:var(--ic-danger, #b33a3a); }
.ac-nf-add { height:var(--ic-ctrl-h, 30px); border:1px dashed var(--ic-brand, #0b8ce9);
  border-radius:var(--ic-ctrl-r, 7px); background:transparent; color:var(--ic-brand, #0b8ce9);
  font-size:var(--ic-ctrl-fs, 12px); }
.ac-nf-add:hover { background:var(--ic-brand-soft, rgba(11,140,233,.15)); }
.ac-nf-nums { gap:8px; }
.ac-nf-num { flex:1 1 0; display:flex; align-items:center; gap:4px; min-width:0; font-size:11px;
  color:var(--ic-soft, #8a8a8a); white-space:nowrap; }
.ac-nf-num .ac-nf-input { width:100%; }
.ac-nf-empty { padding:26px 10px; border:1px dashed var(--ic-line, #494a50);
  border-radius:var(--ic-radius, 10px); font-size:var(--ic-ctrl-fs, 12px);
  color:var(--ic-soft, #8a8a8a); text-align:center; }
.ac-nf-foot { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:10px;
  padding:10px 14px 12px; border-top:1px solid var(--ic-line, #494a50); }
.ac-nf-count { font-size:11px; color:var(--ic-soft, #8a8a8a); }
.ac-nf-done { height:var(--ic-ctrl-h, 30px); padding:0 16px; border:1px solid var(--ic-brand, #0b8ce9);
  border-radius:var(--ic-ctrl-r, 7px); background:var(--ic-brand, #0b8ce9); color:#fff;
  font-size:var(--ic-ctrl-fs, 12px); font-weight:600; }
.ac-nf-done:hover { filter:brightness(.9); }
`;

  /* --------------------------- constants --------------------------- */

  const TYPE_OPTIONS = [
    ["text", "文本"], ["textarea", "多行文本"], ["number", "数字"], ["slider", "滑块"],
    ["select", "下拉框"], ["switch", "开关"], ["image", "图像（单张）"],
    ["image_list", "图像列表"], ["audio", "音频"], ["video", "视频"], ["random", "随机数"],
  ];
  const MEDIA_LABELS = {
    image: "第一张图像", image_list: "全部图像（按上游在前、自身在后排列）",
    audio: "第一个音频", video: "第一个视频",
  };
  /* WorkflowPreview/index.vue */
  const COL_STEP = 220, ROW_STEP = 62;
  /* PreviewNode.vue */
  const NODE_W = 168, NODE_H = 42;
  const MIN_ZOOM = 0.2, MAX_ZOOM = 2;

  const ICON_SVG =
    '<svg class="ac-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">' +
    '<circle cx="4" cy="3.5" r="1.8" stroke="currentColor" stroke-width="1.3" />' +
    '<circle cx="4" cy="12.5" r="1.8" stroke="currentColor" stroke-width="1.3" />' +
    '<circle cx="12" cy="8" r="1.8" stroke="currentColor" stroke-width="1.3" />' +
    '<path d="M4 5.3v5.4M5.8 3.5h2.4a1.8 1.8 0 0 1 1.8 1.8v1M5.8 12.5h2.4a1.8 1.8 0 0 0 1.8-1.8v-1" ' +
    'stroke="currentColor" stroke-width="1.3" /></svg>';

  let injected = false;
  function injectStyles() {
    if (injected) return;
    const style = document.createElement("style");
    style.dataset.owner = "infcanvas-api-config";
    style.textContent = CSS;
    document.head.appendChild(style);
    injected = true;
  }

  /* ----------------------------- helpers ----------------------------- */

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  /* Reference request(): reads the body as text, throws the backend's own
     error message, and complains when the endpoint returned nothing (which is
     what an un-restarted ComfyUI looks like for the new routes). */
  async function request(route, options = {}) {
    const api = window.comfyAPI?.api?.api;
    const path = "/infcanvas" + route;
    const response = api?.fetchApi
      ? await api.fetchApi(path, options)
      : await fetch("/api" + path, options);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (!response.ok) throw new Error((data && data.error) || `请求失败（${response.status}）`);
    if (data === null) throw new Error("接口无响应，请完全重启 ComfyUI");
    return data;
  }

  const jsonOptions = (method, payload) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  /* Only real API nodes count. This project's bundled templates carry a few
     metadata keys (_kind / _name / kind / name / hint / _requires_config),
     which the reference project keeps in a separate manifest. */
  const META_KEYS = new Set(["kind", "name", "hint"]);
  function apiNodes(workflow) {
    if (!workflow || typeof workflow !== "object") return {};
    const out = {};
    for (const [id, value] of Object.entries(workflow)) {
      if (id.startsWith("_") || META_KEYS.has(id)) continue;
      if (value && typeof value === "object" && value.class_type) out[id] = value;
    }
    return out;
  }
  function isApiWorkflow(data) {
    return !!data && typeof data === "object" && !Array.isArray(data) &&
      Object.keys(apiNodes(data)).length > 0;
  }

  function hueOf(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
    return hash;
  }
  function guessType(value, key) {
    if (typeof value === "boolean") return "switch";
    if (typeof value === "number") return "number";
    const text = String(value || "");
    if (/text|prompt|string|caption/i.test(key) || text.includes("\n") || text.length > 40) return "textarea";
    return "text";
  }
  function previewValue(value) {
    if (typeof value === "string") return value ? `"${value.slice(0, 60)}"` : '""';
    if (value === true || value === false) return String(value);
    return String(value);
  }
  const toNum = (raw) => {
    if (raw === "" || raw === null || raw === undefined) return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  };
  const clampZoom = (z) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);
  /* This project's list returns `name` as a display label and `filename`/`id`
     as the actual file stem; every REST path must use the stem. */
  const wfKey = (item) => item.filename || item.id || item.name;

  /* ------------------------------ state ------------------------------ */

  let ui = null;
  const D = {};                 // DOM refs
  let entries = [];             // NodeFields inspector rows
  let messageTimer = 0;
  let panDrag = null;

  const S = {
    workflows: [], currentName: "", currentWorkflow: null,
    dragIndex: -1, dropIndex: -1,
    message: "", messageError: false,
    fields: [], fieldsDirty: false, inspecting: "",
    zoom: 1, panX: 0, panY: 0,
  };

  const nodeCount = () => Object.keys(apiNodes(S.currentWorkflow)).length;
  const inspectNode = () => apiNodes(S.currentWorkflow)[S.inspecting] || null;
  const inspectFields = () => S.fields.filter((f) => String(f.nodeId) === S.inspecting);

  function notify(text, isError = false) {
    S.message = text; S.messageError = !!isError;
    renderMessage();
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { S.message = ""; renderMessage(); }, 2500);
  }
  function renderMessage() {
    if (!D.msg) return;
    D.msg.hidden = !S.message;
    D.msg.textContent = S.message || "";
    D.msg.classList.toggle("is-error", S.messageError);
  }

  /* --------------------------- dialog shell --------------------------- */

  function buildUI(body) {
    body.classList.add("ac-host");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.overflow = "hidden";
    body.style.padding = "16px";
    body.style.minHeight = "0";

    const config = el("div", "ac-config");
    const left = el("aside", "ac-left");
    const right = el("section", "ac-right");
    config.append(left, right);
    body.appendChild(config);

    /* ---- left: workflow list ----
       ComfyUI 插件直接跑在 ComfyUI 内部，没有可填的后端地址；参考项目的
       「COMFYUI 后端地址」是 import.meta.env.DEV 才显示的调试项，上线形态省略。 */
    const listBlock = el("section", "ac-block ac-grow");
    listBlock.appendChild(el("div", "ac-label", "工作流列表（拖动可调整顺序）"));
    D.list = el("div", "ac-list");
    listBlock.appendChild(D.list);
    D.upload = el("button", "ac-upload", "上传工作流");
    D.upload.type = "button";
    D.upload.addEventListener("click", () => D.fileInput.click());
    listBlock.appendChild(D.upload);
    D.fileInput = document.createElement("input");
    D.fileInput.type = "file";
    D.fileInput.accept = ".json,application/json";
    D.fileInput.multiple = true;
    D.fileInput.hidden = true;
    D.fileInput.addEventListener("change", onFiles);
    listBlock.appendChild(D.fileInput);
    left.appendChild(listBlock);

    D.msg = el("div", "ac-msg");
    D.msg.hidden = true;
    left.appendChild(D.msg);

    /* ---- right: head ---- */
    const head = el("header", "ac-head");
    const headInfo = el("div", "ac-head-info");
    D.name = el("div", "ac-name", "未选择工作流");
    D.sub = el("div", "ac-sub");
    headInfo.append(D.name, D.sub);
    const actions = el("div", "ac-actions");
    D.save = el("button", "ac-save", "保存配置");
    D.save.type = "button";
    D.save.addEventListener("click", saveFields);
    D.danger = el("button", "ac-danger", "删除");
    D.danger.type = "button";
    D.danger.addEventListener("click", removeWorkflow);
    actions.append(D.save, D.danger);
    head.append(headInfo, actions);
    right.appendChild(head);

    /* ---- right: graph preview ---- */
    const preview = el("div", "ac-preview");
    D.viewport = el("div", "ac-viewport");
    D.scene = el("div", "ac-scene");
    D.viewport.appendChild(D.scene);
    preview.appendChild(D.viewport);

    const tools = el("div", "ac-tools");
    const zoomOut = el("button", "", "−");
    zoomOut.type = "button"; zoomOut.title = "缩小";
    zoomOut.addEventListener("click", () => zoomTo(S.zoom - 0.2));
    D.zoomLabel = el("span", "ac-zoom", "100%");
    const zoomIn = el("button", "", "+");
    zoomIn.type = "button"; zoomIn.title = "放大";
    zoomIn.addEventListener("click", () => zoomTo(S.zoom + 0.2));
    const fitBtn = el("button", "ac-fit", "适应");
    fitBtn.type = "button"; fitBtn.title = "适应画布";
    fitBtn.addEventListener("click", fit);
    tools.append(zoomOut, D.zoomLabel, zoomIn, fitBtn);
    preview.appendChild(tools);

    D.empty = el("div", "ac-empty", "选择左侧工作流查看预览");
    D.tip = el("div", "ac-empty is-tip", "点击节点配置可暴露给画布的参数");
    D.tip.hidden = true;
    preview.append(D.empty, D.tip);
    right.appendChild(preview);

    /* wheel zoom + background pan, matching Vue Flow's default preview gestures */
    D.viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = D.viewport.getBoundingClientRect();
      const px = event.clientX - rect.left, py = event.clientY - rect.top;
      const next = clampZoom(S.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
      const ratio = next / S.zoom;
      S.panX = px - (px - S.panX) * ratio;
      S.panY = py - (py - S.panY) * ratio;
      S.zoom = next;
      applyTransform();
    }, { passive: false });
    D.viewport.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".ac-node") || event.button !== 0) return;
      panDrag = { x: event.clientX, y: event.clientY, panX: S.panX, panY: S.panY };
      D.viewport.classList.add("is-panning");
      D.viewport.setPointerCapture?.(event.pointerId);
    });
    D.viewport.addEventListener("pointermove", (event) => {
      if (!panDrag) return;
      S.panX = panDrag.panX + event.clientX - panDrag.x;
      S.panY = panDrag.panY + event.clientY - panDrag.y;
      applyTransform();
    });
    const endPan = () => { panDrag = null; D.viewport.classList.remove("is-panning"); };
    D.viewport.addEventListener("pointerup", endPan);
    D.viewport.addEventListener("pointercancel", endPan);

    /* ---- right: node fields inspector ---- */
    D.nfMask = el("div", "ac-nf-mask");
    D.nfMask.hidden = true;
    D.nfCard = el("div", "ac-nf-card");
    const nfHead = el("header", "ac-nf-head");
    const nfHeadText = el("div", "ac-nf-head-text");
    D.nfTitle = el("div", "ac-nf-title");
    D.nfTitleDot = el("span", "ac-nf-dot");
    D.nfTitleText = el("span", "", "");
    D.nfTitle.append(D.nfTitleDot, D.nfTitleText);
    D.nfSub = el("div", "ac-nf-sub");
    nfHeadText.append(D.nfTitle, D.nfSub);
    const nfClose = el("button", "ac-nf-close", "×");
    nfClose.type = "button"; nfClose.title = "关闭";
    nfClose.addEventListener("click", closeNodeFields);
    nfHead.append(nfHeadText, nfClose);
    D.nfList = el("div", "ac-nf-list");
    const nfFoot = el("footer", "ac-nf-foot");
    D.nfCount = el("span", "ac-nf-count", "已启用 0 个字段");
    const nfDone = el("button", "ac-nf-done", "完成");
    nfDone.type = "button";
    nfDone.addEventListener("click", closeNodeFields);
    nfFoot.append(D.nfCount, nfDone);
    D.nfCard.append(nfHead, D.nfList, nfFoot);
    D.nfMask.appendChild(D.nfCard);
    right.appendChild(D.nfMask);

    renderList();
    renderHead();
    renderPreview();
    renderMessage();
  }

  /* --------------------------- backend readiness --------------------------- */

  /* 插件运行在 ComfyUI 内部，请求天然发往当前 ComfyUI，没有后端地址可配。
     保留 GET /settings 只作为「新增 Python 路由是否已加载」的探针：未完全
     重启 ComfyUI 时会 404，弹窗据此显示重启横幅。返回值一律忽略。 */
  async function probeBackend() {
    try {
      await request("/settings");
    } catch (error) {
      if (/404|无响应|请求失败/.test(String(error?.message || "")) && ui?.setApiReady) ui.setApiReady(false);
      notify(error.message, true);
    }
  }

  /* --------------------------- workflow list --------------------------- */

  async function loadWorkflows() {
    try {
      const data = await request("/workflows");
      S.workflows = data.workflows || [];
      const exists = S.workflows.some((item) => wfKey(item) === S.currentName);
      if (!exists) {
        S.currentName = ""; S.currentWorkflow = null; S.fields = []; S.fieldsDirty = false;
        closeNodeFields();
        if (S.workflows.length) await selectWorkflow(wfKey(S.workflows[0]));
      }
      renderList(); renderHead(); renderPreview();
      /* Reference: let the canvas pick up the newest order / first workflow. */
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
    } catch (error) {
      if (/404|无响应|请求失败/.test(String(error?.message || "")) && ui?.setApiReady) ui.setApiReady(false);
      notify(error.message, true);
    }
  }

  function renderList() {
    if (!D.list) return;
    D.list.replaceChildren();
    if (!S.workflows.length) {
      D.list.appendChild(el("div", "ac-empty-list", "还没有工作流，先上传一个"));
      return;
    }
    S.workflows.forEach((item, index) => {
      const button = el("button", "ac-item");
      button.type = "button";
      button.draggable = true;
      button.innerHTML = ICON_SVG;
      button.appendChild(el("span", "ac-item-name", item.name || wfKey(item)));
      button.appendChild(el("span", "ac-item-meta", (item.nodes ?? 0) + " 个节点"));
      button.classList.toggle("is-active", wfKey(item) === S.currentName);
      button.classList.toggle("is-dragging", S.dragIndex === index);
      button.classList.toggle("is-drop", S.dropIndex === index && S.dragIndex !== index);
      button.addEventListener("click", () => selectWorkflow(wfKey(item)));
      button.addEventListener("dragstart", (event) => onDragStart(event, index));
      button.addEventListener("dragover", (event) => onDragOver(event, index));
      button.addEventListener("drop", (event) => onDrop(event, index));
      button.addEventListener("dragend", onDragEnd);
      D.list.appendChild(button);
    });
  }

  /* Drag state must only toggle classes. Rebuilding the list here would remove
     the very element being dragged and cancel the HTML5 drag immediately. */
  function updateDragClasses() {
    if (!D.list) return;
    D.list.querySelectorAll(".ac-item").forEach((item, index) => {
      item.classList.toggle("is-dragging", S.dragIndex === index);
      item.classList.toggle("is-drop", S.dropIndex === index && S.dragIndex !== index);
    });
  }
  function onDragStart(event, index) {
    S.dragIndex = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      /* Firefox needs data before it actually starts a drag. */
      event.dataTransfer.setData("text/plain", String(index));
    }
    updateDragClasses();
  }
  function onDragOver(event, index) {
    if (S.dragIndex < 0) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (S.dropIndex !== index) { S.dropIndex = index; updateDragClasses(); }
  }
  async function onDrop(event, index) {
    event.preventDefault();
    const from = S.dragIndex;
    S.dragIndex = -1; S.dropIndex = -1;
    if (from < 0 || from === index) { renderList(); return; }
    const list = [...S.workflows];
    const [moved] = list.splice(from, 1);
    list.splice(index, 0, moved);
    S.workflows = list;
    renderList();
    try {
      const data = await request("/workflows/order", jsonOptions("PUT", { names: list.map(wfKey) }));
      if (data.workflows) S.workflows = data.workflows;
      notify("顺序已保存");
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
    } catch (error) {
      notify(error.message, true);
      await loadWorkflows();
    }
    renderList();
  }
  function onDragEnd() {
    S.dragIndex = -1; S.dropIndex = -1;
    updateDragClasses();
  }

  /* ------------------------- selection / fields ------------------------- */

  async function selectWorkflow(name) {
    try {
      let data;
      try {
        data = await request("/workflows/" + encodeURIComponent(name));
      } catch (error) {
        /* Before ComfyUI is restarted the new REST route is missing. Fall back
           to the original read-only template endpoint so the preview still
           renders; the banner keeps asking for a full restart. */
        if (!/404/.test(String(error?.message || ""))) throw error;
        const tpl = await request("/workflow?name=" + encodeURIComponent(name));
        data = { name, workflow: tpl };
        if (ui?.setApiReady) ui.setApiReady(false);
      }
      S.currentName = data.name;
      S.currentWorkflow = data.workflow;
      closeNodeFields();
      await loadFields(name);
      renderList(); renderHead(); renderPreview();
    } catch (error) {
      notify(error.message, true);
    }
  }

  async function loadFields(name) {
    try {
      const data = await request("/workflows/" + encodeURIComponent(name) + "/fields");
      S.fields = data.fields || [];
    } catch (_) {
      S.fields = [];
    }
    S.fieldsDirty = false;
  }

  function renderHead() {
    if (!D.name) return;
    D.name.textContent = S.currentName || "未选择工作流";
    D.sub.textContent = S.currentName ? `${nodeCount()} 个节点 · 已暴露 ${S.fields.length} 个字段` : "";
    D.save.hidden = !S.currentName;
    D.save.disabled = !S.fieldsDirty;
    D.danger.hidden = !S.currentName;
  }

  async function saveFields() {
    if (!S.currentName) return;
    try {
      const data = await request("/workflows/" + encodeURIComponent(S.currentName) + "/fields",
        jsonOptions("PUT", { fields: S.fields }));
      S.fields = data.fields || [];
      S.fieldsDirty = false;
      renderHead(); updateExposedCounts();
      notify("配置已保存");
    } catch (error) {
      notify(error.message, true);
    }
  }

  /* ---------------------- upload / delete ---------------------- */

  async function onFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    for (const file of files) {
      try {
        let workflow;
        try { workflow = JSON.parse(await file.text()); }
        catch (_) { throw new Error(`${file.name} 不是合法 JSON`); }
        if (!isApiWorkflow(workflow)) throw new Error(`${file.name} 不是 ComfyUI API 格式工作流`);
        const name = file.name.replace(/\.json$/i, "");
        const saved = await request("/workflows", jsonOptions("POST", { name, workflow }));
        await loadWorkflows();
        await selectWorkflow(saved.name);
        notify(`已保存 ${saved.name}`);
      } catch (error) {
        notify(error.message, true);
      }
    }
  }

  async function removeWorkflow() {
    if (!S.currentName) return;
    const ok = await NS.api?.confirmDialog?.({
      title: "删除工作流",
      message: `删除工作流「${S.currentName}」？`,
      confirmLabel: "删除", denyLabel: "取消",
    });
    if (!ok) return;
    try {
      await request("/workflows/" + encodeURIComponent(S.currentName), { method: "DELETE" });
      S.currentName = ""; S.currentWorkflow = null; S.fields = []; S.fieldsDirty = false;
      closeNodeFields();
      await loadWorkflows();
      renderHead(); renderPreview();
      notify("已删除");
    } catch (error) {
      notify(error.message, true);
    }
  }

  /* ---------------------- graph preview ---------------------- */

  /* WorkflowPreview: auto-layout by dependency depth, columns offset so the
     longest column is centred. Edges are de-duplicated source->target. */
  function layout() {
    const workflow = apiNodes(S.currentWorkflow);
    const ids = Object.keys(workflow);
    const sourceOf = (id) => {
      const found = new Set();
      const inputs = workflow[id]?.inputs || {};
      for (const value of Object.values(inputs)) {
        if (Array.isArray(value) && value.length === 2 && workflow[String(value[0])]) {
          found.add(String(value[0]));
        }
      }
      return [...found];
    };
    const depth = new Map(), visiting = new Set();
    const visit = (id) => {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      let level = 0;
      for (const up of sourceOf(id)) level = Math.max(level, visit(up) + 1);
      visiting.delete(id);
      depth.set(id, level);
      return level;
    };
    ids.forEach(visit);

    const levelCount = new Map();
    for (const id of ids) {
      const level = depth.get(id) || 0;
      levelCount.set(level, (levelCount.get(level) || 0) + 1);
    }
    const maxCount = Math.max(...levelCount.values(), 1);
    const rows = new Map();
    const exposed = new Map();
    for (const field of S.fields) {
      const id = String(field.nodeId);
      exposed.set(id, (exposed.get(id) || 0) + 1);
    }
    const nodes = ids.map((id) => {
      const level = depth.get(id) || 0;
      const row = rows.get(level) || 0;
      rows.set(level, row + 1);
      const offset = (maxCount - levelCount.get(level)) / 2;
      const info = workflow[id] || {};
      return {
        id,
        x: level * COL_STEP, y: (offset + row) * ROW_STEP,
        title: info._meta?.title || info.class_type || id,
        classType: info.class_type || "",
        hue: hueOf(info.class_type || id),
        exposed: exposed.get(id) || 0,
      };
    });

    const seen = new Set(), edges = [];
    for (const [id, info] of Object.entries(workflow)) {
      for (const value of Object.values(info?.inputs || {})) {
        if (!Array.isArray(value) || value.length !== 2) continue;
        const source = String(value[0]);
        if (!workflow[source]) continue;
        const key = `${source}->${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source, target: id });
      }
    }
    return { nodes, edges };
  }

  function renderPreview() {
    if (!D.scene) return;
    const { nodes, edges } = layout();
    D.scene.replaceChildren();

    const maxX = Math.max(0, ...nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(0, ...nodes.map((n) => n.y + NODE_H));
    D.scene.style.width = maxX + "px";
    D.scene.style.height = maxY + "px";

    const NS_SVG = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS_SVG, "svg");
    svg.setAttribute("class", "ac-edges");
    svg.setAttribute("width", String(maxX));
    svg.setAttribute("height", String(maxY));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of edges) {
      const a = byId.get(edge.source), b = byId.get(edge.target);
      if (!a || !b) continue;
      const sx = a.x + NODE_W, sy = a.y + NODE_H / 2;
      const tx = b.x, ty = b.y + NODE_H / 2;
      const bend = Math.max(30, Math.abs(tx - sx) * 0.5);
      const path = document.createElementNS(NS_SVG, "path");
      path.setAttribute("class", "ac-edge");
      path.setAttribute("d", `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`);
      svg.appendChild(path);
    }
    D.scene.appendChild(svg);

    for (const node of nodes) {
      const card = el("div", "ac-node" + (node.exposed ? " is-configurable" : ""));
      card.style.left = node.x + "px";
      card.style.top = node.y + "px";
      card.style.setProperty("--n-hue", String(node.hue));
      card.dataset.nodeId = node.id;
      const title = el("div", "ac-node-title");
      title.appendChild(el("span", "", node.title));
      title.appendChild(el("span", "ac-node-id", "#" + node.id));
      const type = el("div", "ac-node-type");
      type.appendChild(el("span", "", node.classType));
      if (node.exposed) type.appendChild(el("span", "ac-node-count ac-exposed", node.exposed + " 已用"));
      card.append(title, type, el("span", "ac-handle ac-handle--in"), el("span", "ac-handle ac-handle--out"));
      card.addEventListener("click", (event) => {
        event.stopPropagation();
        openNodeFields(node.id);
      });
      D.scene.appendChild(card);
    }

    D.empty.hidden = !!S.currentWorkflow;
    D.tip.hidden = !S.currentWorkflow || !!S.fields.length;
    fit();
  }

  function updateExposedCounts() {
    if (!D.scene) return;
    const counts = new Map();
    for (const field of S.fields) {
      const id = String(field.nodeId);
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const card of D.scene.querySelectorAll(".ac-node")) {
      const id = card.dataset.nodeId;
      const count = counts.get(id) || 0;
      card.classList.toggle("is-configurable", count > 0);
      const type = card.querySelector(".ac-node-type");
      if (!type) continue;
      const badge = type.querySelector(".ac-exposed");
      if (badge) badge.remove();
      if (count) type.appendChild(el("span", "ac-node-count ac-exposed", count + " 已用"));
    }
    if (D.tip) D.tip.hidden = !S.currentWorkflow || !!S.fields.length;
  }

  function applyTransform() {
    if (!D.scene || !D.viewport) return;
    D.scene.style.transform = `translate(${S.panX}px, ${S.panY}px) scale(${S.zoom})`;
    if (D.zoomLabel) D.zoomLabel.textContent = Math.round(S.zoom * 100) + "%";
    const gap = 18 * S.zoom;
    D.viewport.style.backgroundSize = `${gap}px ${gap}px`;
    D.viewport.style.backgroundPosition = `${S.panX}px ${S.panY}px`;
  }

  function setZoom(next) {
    S.zoom = clampZoom(next);
    applyTransform();
  }
  function zoomTo(next) {
    const rect = D.viewport.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;
    const z = clampZoom(next);
    const ratio = z / S.zoom;
    S.panX = cx - (cx - S.panX) * ratio;
    S.panY = cy - (cy - S.panY) * ratio;
    S.zoom = z;
    applyTransform();
  }
  function fit() {
    if (!D.viewport || !D.scene) return;
    const rect = D.viewport.getBoundingClientRect();
    const w = parseFloat(D.scene.style.width) || 0;
    const h = parseFloat(D.scene.style.height) || 0;
    if (!w || !h || !rect.width || !rect.height) { setZoom(1); return; }
    /* VueFlow fitView({ padding:0.1, maxZoom:1 }) */
    const z = clampZoom(Math.min(rect.width * 0.9 / w, rect.height * 0.9 / h, 1));
    S.zoom = z;
    S.panX = (rect.width - w * z) / 2;
    S.panY = (rect.height - h * z) / 2;
    applyTransform();
  }

  /* ---------------------- node fields inspector ---------------------- */

  function openNodeFields(nodeId) {
    const node = apiNodes(S.currentWorkflow)[String(nodeId)];
    if (!node) return;
    S.inspecting = String(nodeId);
    renderNodeFields();
  }
  function closeNodeFields() {
    S.inspecting = "";
    if (D.nfMask) D.nfMask.hidden = true;
  }

  function renderNodeFields() {
    if (!D.nfMask) return;
    const node = inspectNode();
    if (!node || !S.inspecting) { D.nfMask.hidden = true; return; }
    D.nfMask.hidden = false;
    D.nfTitleText.textContent = node._meta?.title || node.class_type || "#" + S.inspecting;
    D.nfSub.textContent = `${node.class_type || ""} · #${S.inspecting}`;

    /* NodeFields.buildEntries(): only literal inputs; links (arrays) and
       nested objects cannot be exposed through a form. */
    const saved = new Map(inspectFields().map((field) => [field.key, field]));
    entries = [];
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) || (value !== null && typeof value === "object")) continue;
      const field = saved.get(key);
      let options = [...(field?.options || [])];
      if (!options.length && typeof value === "string" && value) options = [value];
      entries.push({
        key, enabled: !!field,
        type: field?.type || guessType(value, key),
        label: field?.label || "", options,
        min: field?.min ?? "", max: field?.max ?? "", step: field?.step ?? "",
        defaultText: previewValue(value),
      });
    }
    paintNodeFields();
  }

  function paintNodeFields() {
    D.nfList.replaceChildren();
    if (!entries.length) {
      D.nfList.appendChild(el("div", "ac-nf-empty", "这个节点没有可直接修改的参数（连线字段不可暴露）"));
    }
    for (const entry of entries) {
      const item = el("div", "ac-nf-item");
      const enable = el("label", "ac-nf-enable");
      const check = document.createElement("input");
      check.type = "checkbox"; check.className = "ac-nf-check"; check.checked = entry.enabled;
      check.addEventListener("change", () => {
        entry.enabled = check.checked;
        paintNodeFields(); syncNodeFields();
      });
      const key = el("span", "ac-nf-key", entry.key);
      key.title = entry.key;
      const def = el("span", "ac-nf-default", "默认值: " + entry.defaultText);
      def.title = entry.defaultText;
      enable.append(check, key, def);
      item.appendChild(enable);

      const detail = el("div", "ac-nf-detail");
      detail.hidden = !entry.enabled;
      if (entry.enabled) {
        const row = el("div", "ac-nf-row");
        const select = el("select", "ac-nf-select");
        for (const [value, label] of TYPE_OPTIONS) {
          const option = document.createElement("option");
          option.value = value; option.textContent = label;
          if (value === entry.type) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener("change", () => {
          entry.type = select.value;
          paintNodeFields(); syncNodeFields();
        });
        const labelInput = el("input", "ac-nf-input");
        labelInput.placeholder = "显示名";
        labelInput.spellcheck = false;
        labelInput.value = entry.label;
        labelInput.addEventListener("input", () => { entry.label = labelInput.value; syncNodeFields(); });
        row.append(select, labelInput);
        detail.appendChild(row);

        if (entry.type === "select") {
          const options = el("div", "ac-nf-options");
          entry.options.forEach((value, index) => {
            const optionRow = el("div", "ac-nf-row");
            const input = el("input", "ac-nf-input");
            input.placeholder = `选项 ${index + 1}`;
            input.spellcheck = false;
            input.value = value;
            input.addEventListener("input", () => { entry.options[index] = input.value; syncNodeFields(); });
            const remove = el("button", "ac-nf-remove", "×");
            remove.type = "button"; remove.title = "删除这个选项";
            remove.addEventListener("click", () => {
              entry.options.splice(index, 1); paintNodeFields(); syncNodeFields();
            });
            optionRow.append(input, remove);
            options.appendChild(optionRow);
          });
          const add = el("button", "ac-nf-add", "+ 添加选项");
          add.type = "button";
          add.addEventListener("click", () => {
            entry.options.push(""); paintNodeFields(); syncNodeFields();
          });
          options.appendChild(add);
          detail.appendChild(options);
        }

        if (["slider", "number", "random"].includes(entry.type)) {
          const nums = el("div", "ac-nf-row ac-nf-nums");
          for (const [prop, text] of [["min", "最小"], ["max", "最大"], ["step", "步长"]]) {
            const wrap = el("label", "ac-nf-num", text);
            const input = el("input", "ac-nf-input");
            input.type = "number"; input.value = entry[prop];
            input.addEventListener("input", () => { entry[prop] = input.value; syncNodeFields(); });
            wrap.appendChild(input);
            nums.appendChild(wrap);
          }
          detail.appendChild(nums);
        }

        if (MEDIA_LABELS[entry.type]) {
          detail.appendChild(el("div", "ac-nf-note",
            `运行时自动取节点上的${MEDIA_LABELS[entry.type]}，优先上游、其次自身，这里不用填。`));
        }
      }
      item.appendChild(detail);
      D.nfList.appendChild(item);
    }
    D.nfCount.textContent = `已启用 ${entries.filter((e) => e.enabled).length} 个字段`;
  }

  /* NodeFields.collect(): emit the full field table for the inspected node. */
  function collectNodeFields() {
    return entries.filter((entry) => entry.enabled).map((entry) => {
      const field = {
        nodeId: S.inspecting, key: entry.key, type: entry.type,
        label: entry.label.trim() || entry.key,
      };
      if (entry.type === "select") {
        field.options = entry.options.map((item) => String(item).trim()).filter(Boolean);
      }
      if (entry.type === "number" || entry.type === "slider") {
        const min = toNum(entry.min), max = toNum(entry.max), step = toNum(entry.step);
        if (min !== undefined) field.min = min;
        if (max !== undefined) field.max = max;
        if (step !== undefined) field.step = step;
      }
      return field;
    });
  }

  function syncNodeFields() {
    const list = collectNodeFields();
    const others = S.fields.filter((field) => String(field.nodeId) !== S.inspecting);
    S.fields = [...others, ...list];
    S.fieldsDirty = true;
    renderHead();
    updateExposedCounts();
    D.nfCount.textContent = `已启用 ${list.length} 个字段`;
  }

  /* ------------------------------- open ------------------------------- */

  function open() {
    if (!NS.tools?.openModal) return;
    injectStyles();
    ui = NS.tools.openModal({
      title: "API配置",
      width: 1100,
      applyLabel: null,
      cancelLabel: "关闭",
      /* Shown when the new Python routes are not loaded (an un-restarted
         ComfyUI answers 404). Same banner pattern as the FFmpeg tools. */
      warn: "<strong>请完全重启 ComfyUI</strong>：API 配置接口是后端新增路由，" +
            "仅刷新浏览器无效。重启后重新打开本弹窗即可。",
      build(body) { buildUI(body); },
      onClose() {
        clearTimeout(messageTimer);
        ui = null;
      },
    });
    /* FloatingWindow: width="92vw" height="86vh", centered, head + body only. */
    ui.panel.style.width = "92vw";
    ui.panel.style.height = "86vh";
    ui.panel.style.maxWidth = "96vw";
    ui.panel.style.maxHeight = "92vh";
    const foot = ui.panel.querySelector(".ict-foot");
    if (foot) foot.style.display = "none";
    probeBackend();
    loadWorkflows();
  }

  function close() { if (ui?.close) ui.close(); }

  NS.apiConfig = { open, close, isOpen: () => !!ui?.mask?.isConnected };
})();
