/* API 配置弹窗.

   A 1:1 port of the reference project's "工作流配置" dialog:
     frontend/src/components/dialogs/WorkflowConfig.vue
     frontend/src/components/FloatingWindow/index.vue
     frontend/src/components/WorkflowPreview/index.vue
     frontend/src/components/WorkflowPreview/PreviewNode.vue
     frontend/src/components/WorkflowPreview/NodeFields.vue

   The rail entry (labelled "API", see infcanvas-ui.js) opens this dialog;
   the dialog title is "API 配置" (renamed from 工作流配置 as requested).
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
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* Category display: normalise legacy backend names, then translate. */
  const cat = (name) => (NS.i18n?.cat ? NS.i18n.cat(name) : t(name || "未分类"));

  const CSS = `
/* The dialog shell is composed from the host's own class strings
   (BaseModalLayout: rounded-2xl / bg-background, bg-card left panel, h-18
   headers; NavItem; buttonVariants), so nothing below re-draws a surface.
   What remains is the graph-preview canvas and the overlay masks, which have
   no host equivalent. */
.ac-config, .ac-config * { box-sizing:border-box; }
.ac-config { display:flex; height:100%; min-height:0; }
/* The host sheet does NOT make [hidden] win over a utility like .flex (it lost
   to inline-flex on the save button and to .flex on the field mask), so the
   attribute is restored here for the whole dialog. */
.ac-host [hidden], .ac-config [hidden] { display:none !important; }
/* Category dropdown. The panel's sections clip their children, so the menu is
   position:fixed and placed from the trigger rect (same trick as the widget
   dropdown in infcanvas-flow.js). Everything else comes from the host's
   menuContentClass string. */
.ac-catmenu { position:fixed; z-index:10005; max-height:min(60vh, 460px); overflow-y:auto; }

/* ---------------- graph preview ---------------- */
.ac-preview { position:relative; flex:1 1 auto; min-height:0; overflow:hidden; }
.ac-viewport { position:absolute; inset:0; overflow:hidden; cursor:grab;
  background-color:#0F0F0F;
  background-image:radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px);
  background-size:18px 18px; }
.ac-viewport.is-panning { cursor:grabbing; }
/* No will-change here: promoting the scaled scene to a compositor layer makes
   the browser rasterise text at 1x then stretch it, so zoomed nodes look
   blurry. Without it, text is re-rasterised at the current scale. */
.ac-scene { position:absolute; left:0; top:0; transform-origin:0 0; }
.ac-edges { position:absolute; left:0; top:0; overflow:visible; pointer-events:none; z-index:0; }
.ac-edge { fill:none; stroke:#8a8a8a; stroke-width:1.2; opacity:.55; }
.ac-node { position:absolute; z-index:1; width:168px; padding:6px 9px;
  border:1px solid hsl(var(--n-hue) 42% 55% / .55); border-radius:6px;
  background:var(--card, #262729); box-shadow:0 4px 12px rgba(0,0,0,.45);
  cursor:pointer; transition:border-color .15s ease, box-shadow .15s ease; }
.ac-node:hover { border-color:hsl(var(--n-hue) 55% 70%); }
/* Configured nodes: just a thicker white edge; no glow. Unconfigured nodes
   keep their original type hue. */
.ac-node.is-configurable { border:2px solid #ffffff; }
.ac-node.is-configurable:hover { border-color:#ffffff; }
.ac-node-title { display:flex; align-items:baseline; justify-content:space-between; gap:6px;
  font-size:11px; font-weight:600; color:var(--text-color, #fff); white-space:nowrap; overflow:hidden; }
.ac-node-id { flex:0 0 auto; font-weight:400; font-size:10px; color:hsl(var(--n-hue) 55% 72%); }
.ac-node-type { display:flex; align-items:center; gap:4px; margin-top:2px; font-size:10px;
  color:var(--muted-foreground, #8a8a8a); white-space:nowrap; overflow:hidden; }
.ac-node-count { margin-left:auto; flex:0 0 auto; color:var(--primary, #0b8ce9); }
/* Option B: "N 已用" as a solid blue pill with white text. */
.ac-exposed { display:inline-flex; align-items:center; padding:0 5px; border-radius:9999px;
  background:var(--primary, #0b8ce9); color:#ffffff; font-size:10px;
  font-weight:600; line-height:14px; }
.ac-handle { position:absolute; top:50%; width:6px; height:6px; margin-top:-3px; border-radius:50%;
  background:hsl(var(--n-hue) 45% 60% / .7); }
.ac-handle--in { left:-4px; }
.ac-handle--out { right:-4px; }
.ac-empty { position:absolute; inset:0; display:grid; place-items:center; font-size:12px;
  color:var(--muted-foreground, #8a8a8a); pointer-events:none; }
.ac-empty.is-tip { inset:auto 0 14px; font-size:11px; }
/* Drag feedback only: the resting look of a row is NavItem's own class string. */
.ac-item.is-dragging { opacity:.45; }
.ac-item.is-drop { box-shadow:inset 0 0 0 1px var(--primary, #0b8ce9); }

/* ---------------- exposed-parameter order panel ---------------- */
/* Sits to the right of the graph preview inside content. Fixed width; the
   preview keeps flex-1. Rows reuse the node settings popover's OWN class
   strings (WidgetGrid) so every control looks exactly like the screenshot. */
/* Right-hand API 参数 panel. The card itself REUSES the node settings popover's
   own class strings (.icn__gpa-pop / pophead / popt / popcnt / body / more), so
   its look is 1:1 with the node — same host utility classes, same CSS. We only
   override the popover's absolute anchoring into an in-flow card, and lay the
   two footer buttons out side by side. */
.ac-params { display:flex; flex-direction:column; flex:0 0 348px; min-height:0; gap:10px;
  overflow-y:auto; }
.ac-params .icn__gpa-inputs { margin-bottom:0; flex:0 0 auto; }
/* Prompt grows with its text; no fixed 76px band stealing the column height. */
.ac-params .icn__gpa-area--a { height:auto; min-height:56px; field-sizing:content; }
/* Card takes only its content height — no flex:1 stretching. Otherwise the
   leftover column space piles up under the 隐藏高级输入 band and makes it huge. */
.ac-params .icn__gpa-pop { position:static; bottom:auto; left:auto; width:100%;
  max-height:none; flex:0 0 auto; overflow:visible; }
.ac-params .icn__gpa-more { flex:0 0 auto; }
.ac-params-list { position:relative; min-height:0; }
/* Drag feedback + grip. The grip keeps its 12px column even when hidden so the
   rows line up with the native WidgetGrid (which has an empty w-3 first cell). */
.ac-prow-grip { display:flex; visibility:hidden; align-items:center; justify-content:center;
  width:12px; color:var(--muted-foreground, #8a8a8a); cursor:grab; }
.ac-params.is-sorting .ac-prow-grip { visibility:visible; }
.ac-params.is-sorting .ac-prow { cursor:grab; }
.ac-prow.is-dragging { opacity:.45; }
.ac-prow.is-drop { box-shadow:inset 0 0 0 1px var(--primary, #0b8ce9); }
/* Standalone text boxes reorder alongside the card rows. The grip column is
   reserved even when hidden so boxes don't shift when sort mode toggles. */
.ac-prompt-row { display:flex; align-items:stretch; gap:0; }
.ac-prompt-row > .icn__gpa-box { flex:1; min-width:0; }
.ac-params.is-sorting .ac-prompt-row { cursor:grab; }
.ac-prompt-row.is-dragging { opacity:.45; }
.ac-prompt-row.is-drop .icn__gpa-box { box-shadow:inset 0 0 0 1px var(--primary, #0b8ce9); }
/* Widget popups (field dropdown / value-control chooser). Skin is the node's
   OWN listbox / chooser (icn__gpa-fsel / icn__gpa-modes, see infcanvas-flow.js)
   so the menus are pixel-identical. Only re-anchored to the viewport because
   the API 参数 card scrolls and would clip an in-flow menu. */
.ac-widget-menu { position:fixed !important; z-index:10006 !important; }
.icn__gpa-fsel.ac-widget-menu { display:flex; flex-direction:column; overflow:hidden;
  text-align:left; border-radius:8px; background:var(--card, #262729);
  border:1px solid var(--ic-line, #494a50); box-shadow:0 10px 30px rgba(0,0,0,.55); }
.icn__gpa-fsel.ac-widget-menu > .icn__sel-search { margin:5px 5px 4px; }
.icn__sel-search { position:sticky; top:0; z-index:1; display:flex; align-items:center; gap:6px;
  flex:0 0 auto; height:28px; padding:0 8px; border-radius:6px;
  background:var(--muted, #3c3d42); color:var(--ic-soft, #8a8a8a); }
.icn__sel-searchinput { flex:1 1 auto; min-width:0; height:100%; padding:0; border:0; outline:none;
  background:transparent; color:var(--ic-text, #ffffff); font:inherit; font-size:12px; }
.icn__sel-searchinput::placeholder { color:var(--ic-soft, #8a8a8a); }
.icn__gpa-modes.ac-widget-menu { overflow:hidden; text-align:left; border-radius:10px;
  background:var(--card, #262729); border:1px solid var(--ic-line, #494a50);
  box-shadow:0 10px 30px rgba(0,0,0,.55); }
`;

  /* --------------------------- constants --------------------------- */

  /* This module loads BEFORE infcanvas-i18n.js, so t() at module scope would
     freeze every label to Chinese. Keep the Chinese source keys here and
     translate at the render site (and again on language change). The first
     element of each pair is the stored type identifier and stays as-is. */
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
  /* ComfyUI's own seed upper bound: object_info reports 2^64-1 for INT seeds
     (18446744073709552000 once serialised). Doubles cannot tell neighbouring
     values apart up there, which is exactly how the host behaves too. */
  const SEED_MAX = 18446744073709552000;

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

  /* lucide icons inlined as SVG markup (the host sheet only ships icons the
     host itself uses, so icon-[lucide--*] classes would resolve to nothing).
     These reproduce the node settings popover's controls 1:1. */
  const ICO = {
    minus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    shuffle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M18 14 L22 18 L18 22"/>'
      + '<path d="M18 2 L22 6 L18 10"/>'
      + '<path d="M2 18 H3.97 A4 4 0 0 0 7.27 16.3 L12.72 7.7 A4 4 0 0 1 16.02 6 H22"/>'
      + '<path d="M2 6 H3.97 A4 4 0 0 1 7.57 8.2"/>'
      + '<path d="M22 18 H15.96 A4 4 0 0 1 12.66 16.2 L12.3 15.75"/></svg>',
    grip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
      + '<circle cx="9" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/>'
      + '<circle cx="15" cy="6" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    chevronUp: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
    settings2: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M20 7h-4M4 7h4M10 7h10M14 17H4M20 17h-4M8 17H6"/>'
      + '<circle cx="12" cy="7" r="2"/><circle cx="12" cy="17" r="2"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M20 6 9 17l-5-5"/></svg>',
    pencilOff: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M10 10 L3.843 16.162 A2 2 0 0 0 3.343 16.995 L2.021 21.355 A0.5 0.5 0 0 0 2.643 21.979 L7.001 20.656 A2 2 0 0 0 7.831 20.156 L14 13.982"/>'
      + '<path d="M12.829 7.172 L17.188 2.826 A1 1 0 1 1 21.174 6.812 L16.821 11.165"/>'
      + '<path d="M15 5 L19 9"/>'
      + '<path d="M2 2 L22 22"/></svg>',
  };

  /* lucide `tag`, inlined: the host's Tailwind sheet only ships the icons the
     host itself uses, so `icon-[lucide--tag]` would resolve to nothing. */
  const TAG_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 '
    + '.586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 '
    + '0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></svg>';

  /* lucide `chevron-down`, inlined. Rotated -90deg when collapsed so the arrow
     points right, 0deg when expanded (down), matching a tree disclosure.
     Drawn at 18px (ComfyUI's native disclosure arrow reads ~10x6px; at 14px
     the lucide path inside its 24-unit viewBox was visibly too small). */
  const CHEVRON_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true">'
    + '<path d="m6 9 6 6 6-6"/></svg>';

  /* Category glyphs: the same four lucide icons the add-node menu uses for
     Text / Image / Video / Audio (infcanvas-flow.js ICONS: text-pen, image,
     video, audio-lines), drawn at tree-header size. Paths are copied verbatim
     so both surfaces stay in sync. 未分类 uses a fifth glyph, lucide
     file-question-mark, matching the "unknown bucket" semantics. */
  const CAT_SVG_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" '
    + 'stroke-linejoin="round" aria-hidden="true">';
  const CAT_ICONS = {
    text: CAT_SVG_OPEN
      + '<path d="M12 12H3"/><path d="M21 5H3"/>'
      + '<path d="M21.377 14.626a1 1 0 10-3.004-3.004l-5.01 5.012a2 2 0 00-.506.854l-.837 2.87a.5.5 0 00.62.62l2.87-.837a2 2 0 00.854-.506z"/>'
      + '<path d="M8 19H3"/></svg>',
    image: CAT_SVG_OPEN
      + '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>'
      + '<circle cx="9" cy="9" r="2"/>'
      + '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
    video: CAT_SVG_OPEN
      + '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>'
      + '<rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
    audio: CAT_SVG_OPEN
      + '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/>'
      + '<path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>',
    /* lucide file-question-mark — the 未分类 (uncategorised) bucket. */
    fileQuestion: CAT_SVG_OPEN
      + '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>'
      + '<path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5"/>'
      + '<path d="M12 17h.01"/></svg>',
  };
  /* Keyed by the internal (Chinese) category name; legacy aliases are
     normalised first, so an old backend still gets the right glyph. */
  const CAT_ICON_GROUPS = {
    fileQuestion: ["未分类"],
    text: ["智能对话"],
    image: ["文生图", "图像编辑", "图像放大", "背景移除", "图像反推", "图像重打光",
      "图像多角度", "局部重绘", "全景图", "扩图", "去水印", "抠图"],
    video: ["参考生视频", "文生视频", "图生视频", "首尾帧视频", "视频反推",
      "视频插帧", "视频编辑", "视频放大"],
    audio: ["文生音乐", "音乐翻唱", "语音合成", "语音克隆", "语音转录", "文生音效"],
  };
  function catIcon(title) {
    const key = NS.i18n?.normalizeCategory ? NS.i18n.normalizeCategory(title) : String(title || "");
    if (!key) return "";
    for (const [icon, names] of Object.entries(CAT_ICON_GROUPS)) {
      if (names.includes(key)) return CAT_ICONS[icon];
    }
    return "";
  }

  /* Every real category starts COLLAPSED; 未分类 starts EXPANDED so its
     workflows are visible immediately. Track the expanded internal keys so a
     user toggle survives renderList() rebuilds (select / drag / language
     switch). Seeded from DEFAULT_EXPANDED; keyed by the raw category title,
     never the translated label. */
  const DEFAULT_EXPANDED = new Set(["未分类"]);
  const expandedGroups = new Set(DEFAULT_EXPANDED);

  /* buttonVariants() verbatim, minus the two classes each size overrides
     (base says rounded-md / text-sm, size md says rounded-lg / text-xs -- the
     host resolves that with cn(), we pick the winning value by hand). */
  const BTN = "relative inline-flex cursor-pointer touch-manipulation appearance-none "
    + "items-center justify-center gap-2 border-none font-inter font-medium "
    + "whitespace-nowrap transition-colors focus-visible:ring-1 focus-visible:ring-ring "
    + "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
  const BTN_MD = BTN + " h-8 rounded-lg p-2 text-xs";
  const BTN_LG = BTN + " h-10 rounded-lg px-4 py-2 text-sm";
  const BTN_SECONDARY = BTN_MD + " bg-secondary text-foreground hover:bg-accent";
  const BTN_PRIMARY = BTN_MD + " bg-primary text-foreground hover:bg-primary/90";
  const BTN_MUTED = BTN_MD + " bg-transparent text-muted-foreground hover:bg-accent";
  const BTN_ICON = BTN + " size-8 rounded-lg bg-transparent text-muted-foreground hover:bg-accent";
  /* BaseModalLayout's close button: <Button size="lg" class="w-10"
     variant="textonly">, measured at 40x40 / rounded-lg with a 16px
     `pi pi-times` glyph. */
  const BTN_CLOSE = BTN + " h-10 w-10 rounded-lg px-4 py-2 text-sm "
    + "bg-transparent text-foreground hover:bg-accent";

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
    if (!response.ok) throw new Error((data && data.error) || t("请求失败（{status}）", { status: response.status }));
    if (data === null) throw new Error(t("接口无响应，请完全重启 ComfyUI"));
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
  const toNum = (raw) => {
    if (raw === "" || raw === null || raw === undefined) return undefined;
    const num = Number(raw);
    return Number.isFinite(num) ? num : undefined;
  };
  const clampZoom = (z) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

  /* 「高级参数」的老规矩（字段还没有 advanced 布尔值时用）：这几个标签留在
     明面上，其余折进节点的「显示高级输入」。和 js/infcanvas-flow.js 的
     BASIC_LABELS 是同一张表——那边是节点面板的运行时兜底，这里是配置弹窗里
     勾选框的初始状态，两边不一致就会出现「勾选框没勾、节点里却藏着」。
     用户的勾选一旦落到 fields.json，就以文件里的布尔值为准。 */
  const LEGACY_BASIC_LABELS = ["提示词优化", "提示词", "高宽比", "百万像素", "放大倍数", "种子"];
  const defaultAdvanced = (label) => !LEGACY_BASIC_LABELS.includes(String(label || "").trim());
  /* This project's list returns `name` as a display label and `filename`/`id`
     as the actual file stem; every REST path must use the stem. */
  const wfKey = (item) => item.filename || item.id || item.name;

  /* --------------------- default parameter detection ---------------------

     Almost every API workflow of a medium exposes the same handful of inputs,
     and ticking each one plus typing a label / picking a widget type by hand is
     busywork. These rules recognise the well-known ones by input key — or, when
     the key is generic (`value`), by the node's own title — and pre-fill the
     inspector row: Chinese label, widget type, combo options and number range.

     Order matters, first match wins: 提示词优化 sits before 提示词 because both
     its key and its title mention "prompt". */
  const AUTO_RULES = [
    {
      label: "提示词优化",
      type: (value) => (typeof value === "boolean" ? "switch" : "textarea"),
      match: ({ key, title }) =>
        /(prompt|提示词)/i.test(title)
        && /(refine|enhance|optimi[sz]e|rewrite|expand|improve|优化|润色|扩写)/i.test(title)
        || /(prompt_?(refine|enhance|optimi[sz]e|rewrite|expand|improve)|(refine|enhance|optimi[sz]e|rewrite)_?prompt)/i.test(key),
    },
    {
      label: "提示词", type: "textarea",
      match: ({ key, value, title }) => {
        if (typeof value !== "string") return false;
        /* Titles that say "this is NOT the user's prompt": a negative prompt
           (often on a plain `text` key, so the key match alone would mislabel
           it) and the workflow's own instruction templates (system / task
           prompt). Without this the gear ends up with two rows both named
           提示词 and the typed text would be routed to the wrong node. */
        if (/(negative|负面|system|系统|task[\s_-]?prompt)/i.test(title)) return false;
        return /^(prompt|positive|positive_prompt|prompt_text|text|caption|instruction)$/i.test(key)
          || /(prompt|提示词)/i.test(title);
      },
    },
    { label: "高宽比", type: "select", match: ({ key }) => /^(aspect_?ratio|ratio)$/i.test(key) },
    { label: "百万像素", type: "number", match: ({ key }) => /^(mega_?pixels?|mp)$/i.test(key) },
    { label: "倍数", type: "number", match: ({ key }) => /^(multiple|multiple_of|round_to|align(ment)?)$/i.test(key) },
    /* A widget group (`sampling_mode.seed`) is a different seed from the
       sampler's own; name it after its group so two rows never read the same. */
    {
      label: ({ key }) => (key.includes(".") ? "采样种子" : "种子"),
      type: "random", match: ({ key }) => /(^|\.)seed$/i.test(key),
    },
    { label: "最大长度", type: "number", match: ({ key }) => /^max_?(length|tokens|new_tokens)$/i.test(key) },
    { label: "思考模式", type: "switch", match: ({ key }) => /^(thinking|thinking_mode|enable_thinking|think)$/i.test(key) },
    { label: "步数", type: "slider", match: ({ key }) => /^(steps|num_steps|sample_steps|sampling_steps)$/i.test(key) },
    { label: "CFG", type: "slider", match: ({ key }) => /^(cfg|cfg_scale|guidance_scale)$/i.test(key) },
    { label: "采样器", type: "select", match: ({ key }) => /^(sampler_name|sampler)$/i.test(key) },
    { label: "调度器", type: "select", match: ({ key }) => /^(scheduler|scheduler_name|noise_scheduler)$/i.test(key) },
  ];

  /* object_info is the only place a combo's option list and a number's range
     live — a workflow JSON just stores the CURRENT value. Fetched once per
     session (ComfyUI caches it server-side as well). */
  let defsPromise = null;
  function nodeDefs() {
    if (!defsPromise) {
      defsPromise = (async () => {
        try {
          const api = window.comfyAPI?.api?.api;
          return (api?.getNodeDefs ? await api.getNodeDefs() : null) || {};
        } catch (_) {
          return {};
        }
      })();
    }
    return defsPromise;
  }
  /* Newer ComfyUI ships combos as ["COMBO", {options:[...]}]; older ones inline
     the option array as the type. Both are handled. */
  function inputSpec(defs, classType, key) {
    const input = defs?.[classType]?.input;
    const raw = input?.required?.[key] || input?.optional?.[key];
    if (!Array.isArray(raw)) return {};
    const [type, options] = raw;
    if (Array.isArray(type)) return { kind: "COMBO", options: type.filter((v) => typeof v === "string") };
    const spec = { kind: String(type || "") };
    if (options && typeof options === "object") {
      if (Array.isArray(options.options)) spec.options = options.options.filter((v) => typeof v === "string");
      for (const numeric of ["min", "max", "step"]) {
        if (typeof options[numeric] === "number" && Number.isFinite(options[numeric])) spec[numeric] = options[numeric];
      }
    }
    return spec;
  }

  /* Per-workflow memory of the auto rows the user explicitly unticked, so the
     defaults never fight with a deliberate removal. */
  const OFF_KEY = "infcanvas:auto-fields-off";
  function offFields(name) {
    try {
      const all = JSON.parse(localStorage.getItem(OFF_KEY) || "{}");
      return new Set(Array.isArray(all?.[name]) ? all[name] : []);
    } catch (_) { return new Set(); }
  }
  function setOffField(name, id, off) {
    if (!name) return;
    let all = {};
    try { all = JSON.parse(localStorage.getItem(OFF_KEY) || "{}") || {}; } catch (_) { all = {}; }
    const list = new Set(Array.isArray(all[name]) ? all[name] : []);
    if (off) list.add(id); else list.delete(id);
    writeOffFields(name, list, all);
  }
  function writeOffFields(name, list, all) {
    let store = all;
    if (!store) {
      try { store = JSON.parse(localStorage.getItem(OFF_KEY) || "{}") || {}; } catch (_) { store = {}; }
    }
    store[name] = [...list];
    try { localStorage.setItem(OFF_KEY, JSON.stringify(store)); } catch (_) { /* private mode */ }
  }

  /* ------------------------------ state ------------------------------ */

  let ui = null;
  const D = {};                 // DOM refs
  let entries = [];             // NodeFields inspector rows
  let inspectorSnapshot = null; // state before the inspector was opened (for 取消)
  let catDocDown = null;        // document handlers while the category menu is open
  let catDocKey = null;
  let panDrag = null;

  const S = {
    workflows: [], currentName: "", currentWorkflow: null,
    dragIndex: -1, dropIndex: -1,
    fields: [], fieldsDirty: false, inspecting: "",
    /* Baseline copy of S.fields as last loaded/saved. The right-hand panel's
       「保存为默认参数」stays disabled until the live fields differ from this
       snapshot; 「取消」(the revert button, NOT the sort-mode cancel) restores
       it. Deep-compared so every edit entry point (setFieldDefault, control
       mode, inspector) is covered without a fragile per-entry dirty flag. */
    paramSnapshot: null,
    /* Exposed-parameter order editing (right panel). */
    orderEditing: false, orderSnapshot: null, orderDrag: -1, orderDrop: -1,
    /* The 1:1 screenshot shows all 11 fields expanded ("隐藏高级输入" footer
       with the ⌄ dropdowns visible), so the right panel starts expanded too. */
    paramsShowAdvanced: true,
    autoAdded: 0, autoKeys: new Set(),
    category: "", categories: [],
    zoom: 1, panX: 0, panY: 0,
  };

  const nodeCount = () => Object.keys(apiNodes(S.currentWorkflow)).length;
  const inspectNode = () => apiNodes(S.currentWorkflow)[S.inspecting] || null;
  const inspectFields = () => S.fields.filter((f) => String(f.nodeId) === S.inspecting);
  const fieldKey = (nodeId, key) => String(nodeId) + ":" + String(key);

  /* Inputs the default-parameter pass must LEAVE ALONE. A text-generation node
     (TextGenerate / TextGenerateV2) carries its own LLM decode seed in
     `sampling_mode.seed`; that belongs to the model's sampling setup, not to
     the image's noise, so auto-exposing it would only add a second, meaningless
     随机种子 next to the KSampler's. It is only skipped by the DETECTOR -- the
     node inspector still lists it, so the user can tick it by hand when a
     particular workflow actually wants it. */
  function autoExcluded({ key, classType }) {
    return /^TextGenerate/i.test(classType || "") && /(^|\.)seed$/i.test(key || "");
  }

  /* Literal inputs of the open workflow that match AUTO_RULES and are not
     exposed yet. Links (arrays) and nested objects cannot be edited in a form,
     and rows the user unticked earlier are skipped. */
  function autoCandidates() {
    const nodes = apiNodes(S.currentWorkflow);
    const taken = new Set(S.fields.map((field) => fieldKey(field.nodeId, field.key)));
    const off = offFields(S.currentName);
    const out = [];
    for (const [nodeId, node] of Object.entries(nodes)) {
      const title = node._meta?.title || "";
      const classType = node.class_type || "";
      for (const [key, value] of Object.entries(node.inputs || {})) {
        if (Array.isArray(value) || (value !== null && typeof value === "object")) continue;
        if (taken.has(fieldKey(nodeId, key)) || off.has(fieldKey(nodeId, key))) continue;
        if (autoExcluded({ key, classType })) continue;
        const rule = AUTO_RULES.find((item) => item.match({ key, value, title, classType }));
        if (rule) out.push({ nodeId, key, value, classType, rule });
      }
    }
    return out;
  }

  /* Turn the candidates into persisted field rows, pulling options / ranges
     from the node definition. */
  async function detectFields() {
    const candidates = autoCandidates();
    if (!candidates.length) return [];
    const defs = await nodeDefs();
    return candidates.map(({ nodeId, key, value, classType, rule }) => {
      const type = typeof rule.type === "function" ? rule.type(value) : rule.type;
      const label = typeof rule.label === "function"
        ? rule.label({ key, value, title: defs?.[classType]?._meta?.title })
        : rule.label;
      const spec = inputSpec(defs, classType, key);
      const field = { nodeId, key, type, label, advanced: defaultAdvanced(label) };
      if (type === "select") {
        const options = spec.options?.length ? spec.options
          : (typeof value === "string" && value ? [value] : []);
        if (options.length) field.options = options;
      }
      if (type === "number" || type === "slider" || type === "random") {
        let { min, max, step } = spec;
        /* Seeds are 64-bit upstream: object_info reports 2^64-1 and the workflow
           templates already carry values like 4.4e14. Keep that range -- forcing
           32 bits made a scrub jump five orders of magnitude on open. */
        if (type === "random") {
          if (!Number.isFinite(min) || min < 0) min = 0;
          if (!Number.isFinite(max) || max <= min) max = SEED_MAX;
          step = 1;
        }
        if (typeof min === "number") field.min = min;
        if (typeof max === "number") field.max = max;
        /* object_info omits `step` for plain INT/FLOAT inputs; the panel's
           scrubber needs one regardless. */
        field.step = typeof step === "number" ? step : (spec.kind === "FLOAT" ? 0.01 : 1);
      }
      return field;
    });
  }

  /* Feedback goes to the HOST toast dock, not to a line of text under the
     sidebar: the host renders it as the standard card (status icon + title +
     optional description + close button) and we hand it a 3 s life so it
     disappears by itself. `notify(text, true)` is an error toast; the second
     argument may also be a detail line. */
  function notify(text, opts) {
    const isError = opts === true || (opts && opts.error === true);
    const detail = opts && typeof opts === "object" ? (opts.detail || "") : "";
    NS.api?.toast?.(isError ? "error" : "success", text, detail);
  }

  /* --------------------------- dialog shell ---------------------------

     Shell = ComfyUI's BaseModalLayout, class for class: the card is
     rounded-2xl + bg-background, the left panel is bg-card with a h-18 header
     (LeftPanelHeader) holding an icon + text-base font-semibold title, its rows
     are NavItem (rounded-md px-4 py-3 text-sm, active bg-muted / hover
     bg-accent) and every button carries buttonVariants' own string. Nothing in
     this function invents a surface. */

  function buildUI(body) {
    body.classList.add("ac-host");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.overflow = "hidden";
    body.style.padding = "0";
    body.style.minHeight = "0";

    const config = el("div", "ac-config");
    const left = el("nav", "flex h-full shrink-0 flex-col overflow-hidden bg-card");
    /* BaseModalLayout defaults its panel to 14rem; workflow names need 15rem. */
    left.style.width = "15rem";
    const right = el("section", "relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background");
    config.append(left, right);
    body.appendChild(config);

    /* ---- left: panel title (BaseModalLayout #leftPanelHeaderTitle) ---- */
    const listHead = el("header", "flex h-18 w-full shrink-0 items-center-safe gap-2 pr-3 pl-6");
    /* lucide `sliders-horizontal` (v1.34 path data) inlined: iconify classes only
       resolve if that exact utility was generated into the host stylesheet. */
    const brand = el("i", "flex size-5 shrink-0 items-center justify-center text-foreground");
    brand.setAttribute("aria-hidden", "true");
    brand.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M10 5H3M12 19H3M14 3v4M16 17v4M21 12h-9M21 19h-5M21 5h-7M8 10v4M8 12H3"/></svg>';
    listHead.append(brand, el("h2", "text-base font-semibold text-foreground", t("API 配置")));
    left.appendChild(listHead);

    /* ---- left: upload action, directly under the "API 配置" header ----
       Mirrors the right action row: same top edge (both headers are h-18) and
       the same 32px button height (BTN_MD / h-8), with the left panel's own
       px-4 gutter. The file input is hidden and rides along in this row. */
    const listAction = el("div", "flex shrink-0 items-center px-4 pb-2");
    D.upload = el("button", BTN_MD + " w-full bg-primary text-foreground hover:bg-primary/90", t("上传工作流"));
    D.upload.type = "button";
    D.upload.addEventListener("click", () => D.fileInput.click());
    listAction.appendChild(D.upload);
    D.fileInput = document.createElement("input");
    D.fileInput.type = "file";
    D.fileInput.accept = ".json,application/json";
    D.fileInput.multiple = true;
    D.fileInput.hidden = true;
    D.fileInput.addEventListener("change", onFiles);
    listAction.appendChild(D.fileInput);
    left.appendChild(listAction);

    /* ---- left: workflow list (LeftSidePanel + NavItem) ----
       ComfyUI 插件直接跑在 ComfyUI 内部，没有可填的后端地址；参考项目的
       「COMFYUI 后端地址」是 import.meta.env.DEV 才显示的调试项，上线形态省略。 */
    D.list = el("div", "scrollbar-hide flex min-h-0 w-full flex-auto flex-col gap-1 overflow-y-auto bg-card px-4 pb-2");
    left.appendChild(D.list);

    /* ---- right: header, BaseModalLayout #header (h-18 px-6, items-center-safe).
       Title sits at the left edge of headerContentClass; the close button is the
       last child and gets pushed to the far right by justify-between. ---- */
    const head = el("header", "flex h-18 w-full shrink-0 items-center-safe justify-between gap-2 px-6");
    /* headerContentClass = flex min-w-0 flex-1 gap-2. min-w-0 on both text items
       is what lets `truncate` kick in instead of pushing the close button out. */
    const headInfo = el("div", "flex min-w-0 flex-1 items-center gap-2");
    D.name = el("div", "min-w-0 shrink truncate text-base font-medium text-foreground", t("未选择工作流"));
    D.sub = el("div", "min-w-0 truncate text-xs text-muted-foreground");
    headInfo.append(D.name, D.sub);
    /* The action row is its own line under the header, not part of it. */
    const actions = el("div", "flex shrink-0 items-center gap-2 px-6 pb-2");
    /* Rename edits the title, which IS the workflow's file stem, so the dialog
       owns this action here. Field edits are saved inside their own inspector
       now (保存 / 取消); there is no dialog-wide save button any more. */
    D.rename = el("button", BTN_SECONDARY, t("重命名"));
    D.rename.type = "button";
    D.rename.title = t("重命名工作流（所有引用它的节点会一起更新）");
    D.rename.addEventListener("click", renameWorkflow);
    /* One default workflow per category. The list response already resolves the
       fallback (first workflow of the category), so this only pins a choice. */
    D.favorite = el("button", BTN_SECONDARY, t("设为默认"));
    D.favorite.type = "button";
    D.favorite.title = t("把当前工作流设为所在分类的默认工作流");
    /* Solid secondary surface (--secondary #262729) reads clearly against the
       header's --background #171718 -- the same look as the host's 应用 button. */
    D.danger = el("button", BTN_SECONDARY, t("删除"));
    D.danger.type = "button";
    D.danger.addEventListener("click", removeWorkflow);
    D.favorite.addEventListener("click", setDefaultWorkflow);
    /* Templates dialog dropdown: selectTriggerVariants() with size md + the
       dialog's own trigger-class, conflicts resolved the way cn() would have:
       border-[2.5px] -> border, border-transparent -> border-border/50,
       bg-secondary -> bg-transparent. */
    D.catBtn = el("button", "relative inline-flex cursor-pointer items-center "
      + "rounded-lg border border-solid bg-transparent text-foreground "
      + "transition-all duration-200 ease-in-out outline-none select-none "
      + "hover:bg-accent h-8 border-border/50 min-w-0 shrink basis-40 "
      + "data-[state=open]:border-border");
    D.catBtn.type = "button";
    D.catBtn.dataset.state = "closed";
    D.catBtn.title = t("工作流分类（决定节点 API 下拉框显示在哪类节点）");
    /* MultiSelectTrigger markup: text column + chevron column (pl-3). */
    const catText = el("div", "flex flex-1 items-center overflow-hidden py-2 pl-2 whitespace-nowrap");
    D.catLabel = el("span", "text-xs", t("未分类"));
    catText.appendChild(D.catLabel);
    const catChev = el("div", "flex shrink-0 cursor-pointer items-center justify-center pl-3");
    const catChevIcon = el("i", "flex size-4 items-center justify-center text-muted-foreground");
    catChevIcon.setAttribute("aria-hidden", "true");
    catChevIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="m6 9 6 6 6-6"/></svg>';
    catChev.appendChild(catChevIcon);
    D.catBtn.append(catText, catChev);
    D.catBtn.setAttribute("aria-haspopup", "menu");
    D.catBtn.setAttribute("aria-expanded", "false");
    D.catBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (D.catMenu.hidden) openCatMenu(); else closeCatMenu();
    });

    /* selectContentClass (host) without the enter/leave animations: fixed so it
       escapes the panel's overflow, and the height cap lives in .ac-catmenu. */
    D.catMenu = el("div", "ac-catmenu z-overlay rounded-lg p-2 bg-background "
      + "text-foreground border border-solid shadow-md outline-none");
    D.catMenu.setAttribute("role", "menu");
    D.catMenu.hidden = true;
    /* Fixed-positioned, so it is not clipped by the panel; kept inside the
       dialog so the [hidden] rule above applies. */
    config.appendChild(D.catMenu);
    /* Host close button: 40x40, textonly, pi pi-times, last child of the header. */
    const closeBtn = el("button", BTN_CLOSE);
    closeBtn.type = "button";
    closeBtn.title = t("关闭");
    closeBtn.setAttribute("aria-label", t("关闭"));
    const closeGlyph = el("i", "pi pi-times");
    closeGlyph.setAttribute("aria-hidden", "true");
    closeBtn.appendChild(closeGlyph);
    closeBtn.addEventListener("click", () => close());
    head.append(headInfo, closeBtn);
    right.appendChild(head);
    /* Two groups on one toolbar row: the workflow actions (重命名/设为默认/删除)
       hug the LEFT; the param actions (保存为默认参数/调整顺序) hug the RIGHT.
       A flex-1 spacer between the two groups creates the gap. */
    const actionsSpacer = el("div", "min-w-4 flex-1");
    actions.append(D.catBtn, D.rename, D.favorite, D.danger, actionsSpacer);
    right.appendChild(actions);

    /* ---- right: content (BaseModalLayout #content, px-6 pb-10) ----
       pb is matched to the horizontal px (24px each) so the preview frame
       sits with equal right/bottom breathing room instead of floating high. */
    const content = el("main", "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6");
    right.appendChild(content);

    /* Graph preview on the left, exposed-parameter order panel on the right. */
    const contentRow = el("div", "flex min-h-0 flex-1 flex-row gap-3");
    content.appendChild(contentRow);

    const preview = el("div", "ac-preview flex-1 rounded-lg border border-border/50 bg-card");
    preview.style.minHeight = "320px";
    D.viewport = el("div", "ac-viewport");
    D.scene = el("div", "ac-scene");
    D.viewport.appendChild(D.scene);
    preview.appendChild(D.viewport);

    const tools = el("div", "absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border bg-card/90 p-1 backdrop-blur");
    const zoomOut = el("button", BTN_ICON, "−");
    zoomOut.type = "button"; zoomOut.title = t("缩小");
    zoomOut.addEventListener("click", () => zoomTo(S.zoom - 0.2));
    D.zoomLabel = el("span", "min-w-10 text-center text-xs text-muted-foreground", "100%");
    const zoomIn = el("button", BTN_ICON, "+");
    zoomIn.type = "button"; zoomIn.title = t("放大");
    zoomIn.addEventListener("click", () => zoomTo(S.zoom + 0.2));
    const fitBtn = el("button", BTN_MUTED, t("适应"));
    fitBtn.type = "button"; fitBtn.title = t("适应画布");
    fitBtn.addEventListener("click", fit);
    tools.append(zoomOut, D.zoomLabel, zoomIn, fitBtn);
    preview.appendChild(tools);

    D.empty = el("div", "ac-empty", t("选择左侧工作流查看预览"));
    D.tip = el("div", "ac-empty is-tip", t("点击节点配置可暴露给画布的参数"));
    D.tip.hidden = true;
    preview.append(D.empty, D.tip);
    contentRow.appendChild(preview);

    /* ---- API 参数 panel (right of the preview) ----
       1:1 port of the node settings popover card: same .icn__gpa-pop / pophead /
       popt / popcnt / body / more class strings, so the header, badge, widget
       grid and the 隐藏/显示高级输入 footer are pixel-identical to the node.
       Only the popover's absolute anchoring is replaced by an in-flow card.
       Below the card sit two buttons: 保存为默认参数 (left) / 调整顺序 (right). */
    D.params = el("div", "ac-params");
    D.paramsCard = el("div", "icn__gpa-pop");
    const paramsHead = el("div", "icn__gpa-pophead");
    paramsHead.append(
      el("span", "icn__gpa-popt", t("API 参数")),
      D.paramsCount = el("span", "icn__gpa-popcnt", ""),
    );
    D.paramsList = el("div", "ac-params-list");
    D.paramsEmpty = el("div", "icn__gpa-popempty",
      t("当前 API 未暴露参数，可在 API 配置里勾选要显示的输入项"));
    D.paramsList.appendChild(D.paramsEmpty);
    /* NodeFooter footer band, class for class (h-11 / bg-node-header /
       rounded-b-xl / pt-8 pb-3 / text-xs font-normal). -mt-5 is dropped: with
       no popover body to tuck under, the full band would be too tall. */
    D.paramsMore = el("div", "icn__gpa-more box-border flex w-full");
    D.paramsMoreBtn = el("button", "pointer-events-auto relative inline-flex box-border h-6 w-full "
      + "cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 "
      + "rounded-none rounded-b-xl border-none bg-node-header p-2 font-inter text-xs font-normal "
      + "whitespace-nowrap text-node-foreground transition-colors hover:bg-accent "
      + "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none "
      + "disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0");
    D.paramsMoreBtn.type = "button";
    D.paramsMoreBtn.addEventListener("click", toggleParamsAdvanced);
    D.paramsMoreLabel = el("span", "truncate", "");
    D.paramsMoreIcon = el("span", "icn__gpa-more-icon shrink-0");
    const moreInner = el("div", "flex size-full items-center justify-center gap-2");
    moreInner.append(D.paramsMoreLabel, D.paramsMoreIcon);
    D.paramsMoreBtn.appendChild(moreInner);
    D.paramsMore.appendChild(D.paramsMoreBtn);
    D.paramsCard.append(paramsHead, D.paramsList, D.paramsMore);

    /* The prompt is the node's OWN main text area, not a row inside the API
       参数 card — the node's apiBarFields explicitly skips it. Mirror that:
       a standalone textarea BELOW the card, with the node's exact box classes. */
    D.promptBox = el("div", "icn__gpa-inputs");
    D.promptBox.hidden = true;

    /* Right-hand group of the toolbar: 取消修改(恢复参数) + 保存为默认参数 + 调整顺序.
       取消修改 sits immediately LEFT of 保存为默认参数 and only appears once a
       parameter has been edited; clicking it restores the saved baseline.
       In sort mode these swap to 确定顺序 + 取消 (visibility driven by
       syncParamActions() / renderParamOrder()). */
    D.paramsRevert = el("button", BTN_SECONDARY, t("取消修改"));
    D.paramsRevert.type = "button";
    D.paramsRevert.hidden = true;
    D.paramsRevert.title = t("恢复上次保存的默认参数");
    D.paramsRevert.addEventListener("click", revertDefaultParams);
    D.paramsSave = el("button", BTN_SECONDARY, t("保存为默认参数"));
    D.paramsSave.type = "button";
    D.paramsSave.disabled = true;
    D.paramsSave.addEventListener("click", saveDefaultParams);
    D.paramsEdit = el("button", BTN_SECONDARY, t("调整顺序"));
    D.paramsEdit.type = "button";
    D.paramsEdit.addEventListener("click", toggleParamOrder);
    D.paramsConfirm = el("button", BTN_PRIMARY, t("确定顺序"));
    D.paramsConfirm.type = "button";
    D.paramsConfirm.addEventListener("click", confirmParamOrder);
    D.paramsCancel = el("button", BTN_SECONDARY, t("取消"));
    D.paramsCancel.type = "button";
    D.paramsCancel.title = t("取消调整顺序");
    D.paramsCancel.addEventListener("click", cancelParamOrder);
    actions.append(D.paramsRevert, D.paramsSave, D.paramsEdit, D.paramsConfirm, D.paramsCancel);
    D.params.append(D.paramsCard, D.promptBox);
    contentRow.appendChild(D.params);

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

    /* ---- node fields inspector: a dialog on top of the dialog ----
       Same surface as BaseModalLayout (rounded-2xl / border / bg-background) and
       the same Button recipes, so it reads as one more host dialog. */
    D.nfMask = el("div", "absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6");
    D.nfMask.hidden = true;
    D.nfCard = el("div", "flex max-h-full max-w-full flex-col overflow-hidden rounded-2xl border bg-background shadow-lg");
    /* w-[520px] is an arbitrary value the host never emits, so it is not in the
       prebuilt sheet; the width is set inline instead. */
    D.nfCard.style.width = "520px";
    D.nfCard.dataset.nfCard = "1";
    const nfHead = el("header", "flex items-start justify-between gap-2 px-6 pt-5 pb-3");
    const nfHeadText = el("div", "flex min-w-0 flex-1 flex-col gap-1");
    D.nfTitle = el("div", "flex items-center gap-2 text-base font-semibold text-foreground");
    D.nfTitleDot = el("i", "size-2 rounded-sm bg-primary");
    D.nfTitleText = el("span", "truncate", "");
    D.nfTitle.append(D.nfTitleDot, D.nfTitleText);
    D.nfSub = el("div", "truncate text-xs text-muted-foreground");
    nfHeadText.append(D.nfTitle, D.nfSub);
    const nfClose = el("button", BTN_ICON, "✕");
    nfClose.type = "button"; nfClose.title = t("关闭");
    nfClose.addEventListener("click", cancelNodeFields);
    nfHead.append(nfHeadText, nfClose);
    D.nfList = el("div", "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-4");
    const nfFoot = el("footer", "flex items-center justify-between gap-2 border-t px-6 py-3");
    D.nfCount = el("span", "text-xs text-muted-foreground", t("已启用 0 个字段"));
    /* Save lives INSIDE the inspector now: the dialog no longer has a global
       保存配置 button. 取消 rolls the field table back to what it was when this
       inspector opened, including the localStorage memory of unticked auto rows. */
    const nfActions = el("div", "flex items-center gap-2");
    const nfSave = el("button", BTN_PRIMARY, t("保存"));
    nfSave.type = "button";
    nfSave.addEventListener("click", () => { saveFields().then((ok) => { if (ok) closeNodeFields(); }); });
    const nfCancel = el("button", BTN_SECONDARY, t("取消"));
    nfCancel.type = "button";
    nfCancel.addEventListener("click", cancelNodeFields);
    nfActions.append(nfSave, nfCancel);
    nfFoot.append(D.nfCount, nfActions);
    D.nfCard.append(nfHead, D.nfList, nfFoot);
    D.nfMask.appendChild(D.nfCard);
    /* Over the WHOLE dialog, not just the right column: a mask that leaves the
       left panel bright reads as two unrelated surfaces. */
    body.appendChild(D.nfMask);

    renderList();
    renderHead();
    renderPreview();
  }

  /* --------------------------- backend readiness --------------------------- */

  /* 插件运行在 ComfyUI 内部，请求天然发往当前 ComfyUI，没有后端地址可配。
     保留 GET /settings 只作为「新增 Python 路由是否已加载」的探针：未完全
     重启 ComfyUI 时会 404，弹窗据此显示重启横幅。返回值一律忽略。 */
  async function probeBackend() {
    try {
      await request("/settings");
    } catch (error) {
      if (/404|No API response|Request failed|无响应|请求失败/.test(String(error?.message || "")) && ui?.setApiReady) ui.setApiReady(false);
      notify(error.message, true);
    }
  }

  /* --------------------------- workflow list --------------------------- */

  async function loadWorkflows() {
    try {
      const data = await request("/workflows");
      S.workflows = data.workflows || [];
      if (Array.isArray(data.categories)) S.categories = data.categories;
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
      if (/404|No API response|Request failed|无响应|请求失败/.test(String(error?.message || "")) && ui?.setApiReady) ui.setApiReady(false);
      notify(error.message, true);
    }
  }

  function renderList() {
    if (!D.list) return;
    D.list.replaceChildren();
    /* List EVERY backend category (27), not only those that already hold a
       workflow: empty categories get a row with a count of 0. The early "no
       workflows" bail-out is gone so a fresh setup still shows the full tree. */
    /* Group workflows by their category. Built from real workflows for
       drag/drop addressing; expanded to the full category list below. */
    const groups = new Map();
    S.workflows.forEach((item, index) => {
      const key = (item.category || "").trim() || "未分类";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ item, index });
    });
    /* Group titles follow the canonical category order from the backend; within
       each group the workflows are sorted by name. `index` stays the item's
       index in S.workflows so drag/drop keeps addressing the real array. */
    const byName = (a, b) => String(a.item.name || wfKey(a.item))
      .localeCompare(String(b.item.name || wfKey(b.item)), "zh-Hans-CN");
    for (const entries of groups.values()) entries.sort(byName);
    const catRank = (title) => {
      if (title === "未分类") return -1;
      const at = S.categories.indexOf(title);
      return at < 0 ? S.categories.length : at;
    };
    /* Start from the full backend category table; keep any stray category that
       a workflow carries but the backend list omits (sorted to the end), so no
       workflow silently disappears. 未分类 always sorts FIRST. */
    const keys = [];
    for (const c of S.categories) if (!keys.includes(c)) keys.push(c);
    for (const key of groups.keys()) if (!keys.includes(key)) keys.push(key);
    const ordered = keys.sort((a, b) => catRank(a) - catRank(b));
    for (const title of ordered) {
      const entries = groups.get(title) || [];
      const group = el("div", "flex flex-col gap-1");
      /* Clickable disclosure head. NavTitle.vue type scale (text-xs font-bold
         uppercase, muted) at the tree's level-1 indent; the chevron sits at the
         trailing edge (justify-between) so every group's arrow lines up right.
         pt-2 keeps collapsed group titles compact (was pt-4, too airy). */
      const head = el("div", "m-0 flex w-full cursor-pointer items-center justify-between gap-2 pt-2 pr-2");
      head.style.paddingLeft = "8px";
      /* Title + a small count badge share the left side; the chevron stays at
         the trailing edge. The count is a SIBLING of h3 (not its text) so the
         group title stays a clean category name for sorting / a11y checks. */
      const headLeft = el("div", "flex min-w-0 items-center gap-1.5");
      /* One glyph for every group so all titles stay aligned: the four medium
         icons, plus file-question-mark for 未分类. */
      const iconWrap = el("span", "flex size-4 shrink-0 items-center justify-center text-muted-foreground");
      iconWrap.innerHTML = catIcon(title);
      headLeft.appendChild(iconWrap);
      headLeft.appendChild(el("h3", "text-xs font-bold text-muted-foreground uppercase", cat(title)));
      const count = el("span", "shrink-0 leading-none text-muted-foreground",
        String(entries.length));
      /* Inline styles: the host's Tailwind is prebuilt, so arbitrary-value
         classes like text-[10px] resolve to nothing. Use host CSS vars. */
      count.style.cssText = "font-size:10px;font-weight:600;line-height:1;"
        + "padding:2px 6px;border-radius:9999px;background:var(--muted,#3a3b3d);";
      count.setAttribute("aria-label", entries.length + t("个工作流"));
      headLeft.appendChild(count);
      head.appendChild(headLeft);
      const caretWrap = el("span", "flex size-5 shrink-0 items-center justify-center text-muted-foreground");
      caretWrap.innerHTML = CHEVRON_SVG;
      head.appendChild(caretWrap);
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      group.appendChild(head);

      /* Workflow rows live in their own container so the disclosure can show /
         hide them without rebuilding the DOM (keeps drag state and scroll). */
      const items = el("div", "flex flex-col gap-2");

      for (const { item, index } of entries) {
        /* NavItem.vue verbatim: rounded-md px-4 py-3 text-sm, active bg-muted,
           hover bg-accent. "ac-item" is kept as the drag marker so the drag
           handlers can toggle classes without rebuilding the list. */
        /* treeStyles.ts treeItemClass (rounded-lg / py-3 / pr-2 / hover:bg-accent),
           no leading icon: the workflow name is the whole row, so the text starts
           at the group label's indent. A <button> would paint the UA buttonface on
           top of these classes, so the row is a div with role="button". */
        const button = el("div", "ac-item group/tree-node flex w-full min-w-0 cursor-pointer "
          + "items-center rounded-lg py-3 pr-2 text-left text-sm text-foreground "
          + "outline-none select-none transition-colors hover:bg-accent");
        button.style.paddingLeft = "16px";
        button.setAttribute("role", "button");
        button.draggable = true;
        button.dataset.index = String(index);
        /* Name + optional 默认 tag. The tag is per-row state from the list
           endpoint: `is_default` is true for the pinned workflow, or for the
           first workflow of the category while nothing is pinned. */
        const label = el("div", "flex min-w-0 flex-1 items-center gap-1.5");
        label.appendChild(el("span", "min-w-0 truncate", item.name || wfKey(item)));
        button.appendChild(label);
        /* The tag sits at the row's trailing edge, not next to the name: the
           label above is flex-1, so a sibling appended after it is pushed to the
           right (button's own pr-2 sets the inset). */
        if (item.is_default) {
          const tag = el("i", "ml-2 flex size-4 shrink-0 items-center justify-center text-primary");
          tag.innerHTML = TAG_SVG;
          tag.setAttribute("role", "img");
          tag.setAttribute("aria-label", item.default_pinned ? t("默认工作流") : t("未指定默认时的首个工作流"));
          tag.title = item.default_pinned
            ? t("该分类的默认工作流")
            : t("该分类还没指定默认，自动使用第一个工作流");
          button.appendChild(tag);
        }
        button.title = (item.name || wfKey(item)) + " · " + cat(item.category)
          + " · " + (item.nodes ?? 0) + t(" 个节点");        button.classList.toggle("bg-muted", wfKey(item) === S.currentName);
        button.classList.toggle("is-dragging", S.dragIndex === index);
        button.classList.toggle("is-drop", S.dropIndex === index && S.dragIndex !== index);
        button.addEventListener("click", () => selectWorkflow(wfKey(item)));
        button.addEventListener("dragstart", (event) => onDragStart(event, index));
        button.addEventListener("dragover", (event) => onDragOver(event, index));
        button.addEventListener("drop", (event) => onDrop(event, index));
        button.addEventListener("dragend", onDragEnd);
        items.appendChild(button);
      }

      /* Disclosure state. Default collapsed; apply() is the single place that
         syncs the caret rotation, items visibility and a11y title together. */
      const apply = () => {
        const open = expandedGroups.has(title);
        items.style.display = open ? "flex" : "none";
        caretWrap.firstElementChild.style.transform = open ? "rotate(0deg)" : "rotate(-90deg)";
        head.setAttribute("aria-expanded", open ? "true" : "false");
        head.title = (open ? t("折叠分类") : t("展开分类")) + " · " + cat(title);
      };
      const toggle = () => {
        if (expandedGroups.has(title)) expandedGroups.delete(title);
        else expandedGroups.add(title);
        apply();
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); }
      });
      apply();
      group.appendChild(items);
      D.list.appendChild(group);
    }
  }

  /* Drag state must only toggle classes. Rebuilding the list here would remove
     the very element being dragged and cancel the HTML5 drag immediately. */
  function updateDragClasses() {
    if (!D.list) return;
    D.list.querySelectorAll(".ac-item").forEach((item) => {
      const index = Number(item.dataset.index);
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
      notify(t("顺序已保存"));
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
    const workflow = S.currentWorkflow;
    try {
      const data = await request("/workflows/" + encodeURIComponent(name) + "/fields");
      S.fields = data.fields || [];
      S.category = data.category || "";
      if (Array.isArray(data.categories)) S.categories = data.categories;
    } catch (_) {
      S.fields = [];
      S.category = "";
    }
    S.fieldsDirty = false;
    S.autoAdded = 0;
    S.autoKeys = new Set();

    /* Auto-expose the well-known parameters (提示词 / 种子 / 步数 / CFG /
       采样器 …). They are persisted right away: the point of the defaults is
       that the node's settings popover already shows them, without the user
       having to tick a dozen rows first. Nothing is written into apiValues, so
       a workflow that nobody edits keeps generating exactly as before. */
    const added = await detectFields();
    if (S.currentWorkflow !== workflow) return;   /* user switched mid-load */
    if (!added.length) { snapshotParams(); return; }
    S.fields = [...S.fields, ...added];
    S.autoKeys = new Set(added.map((field) => fieldKey(field.nodeId, field.key)));
    try {
      const saved = await request("/workflows/" + encodeURIComponent(name) + "/fields",
        jsonOptions("PUT", { fields: S.fields }));
      S.fields = saved.fields || S.fields;
      S.autoAdded = added.length;
      notify(t("已自动识别 {n} 个常用参数", { n: added.length }));
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
    } catch (_) {
      /* Route missing (un-restarted ComfyUI): keep the rows visible and let the
         user save them once the backend is up. */
      S.fieldsDirty = true;
    }
    /* Baseline = freshly loaded (and possibly auto-saved) fields. Nothing in
       here counts as a user edit, so 保存为默认参数 starts disabled. */
    snapshotParams();
  }

  function renderHead() {
    if (!D.name) return;
    D.name.textContent = S.currentName || t("未选择工作流");
    D.sub.textContent = S.currentName
      ? t("{n} 个节点 · 已暴露 {f} 个字段", { n: nodeCount(), f: S.fields.length })
        + (S.autoAdded ? t("（自动识别 {n} 个）", { n: S.autoAdded }) : "")
      : "";
    D.favorite.hidden = !S.currentName;
    D.rename.hidden = !S.currentName;
    D.danger.hidden = !S.currentName;
    if (D.catBtn) {
      D.catBtn.disabled = !S.currentName;
      D.catLabel.textContent = cat(S.category);
      if (D.catMenu && !D.catMenu.hidden) openCatMenu();
    }
    renderParamOrder();
  }

  /* ------------------------- category dropdown ------------------------- */

  function openCatMenu() {
    if (!D.catMenu || !D.catBtn) return;
    /* menuContentClass (host) + min-h-8 px-3 py-1.5 text-sm; the checked entry
       uses menuStyles' selectedMenuButtonClass. */
    D.catMenu.replaceChildren();
    const entry = (label, value) => {
      const active = (S.category || "") === value;
      /* selectItemVariants({ layout: 'single' }) verbatim; `<button>` brings the
         UA text-align:center with it, so text-left is spelled out. */
      const item = el("button", "relative flex w-full cursor-pointer items-center "
        + "justify-between gap-3 rounded-sm border-0 px-2 py-3 text-left text-sm "
        + "select-none outline-none focus:bg-accent "
        + (active ? "bg-muted hover:bg-muted" : "bg-transparent hover:bg-accent"), label);
      item.type = "button";
      item.dataset.state = active ? "checked" : "unchecked";
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-checked", active ? "true" : "false");
      if (active) {
        const check = el("i", "flex size-4 shrink-0 items-center justify-center text-foreground");
        check.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" '
          + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
          + '<path d="M20 6 9 17l-5-5"/></svg>';
        item.appendChild(check);
      }
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        closeCatMenu();
        if (!active) saveCategory(value);
      });
      D.catMenu.appendChild(item);
    };
    entry(cat(""), "");
    for (const c of S.categories) entry(cat(c), c);

    D.catMenu.hidden = false;
    D.catBtn.setAttribute("aria-expanded", "true");
    D.catBtn.dataset.state = "open";
    if (!catDocDown) {
      /* Outside-click / Escape close, bound only while the menu is open so a
         closed dialog leaves nothing listening on document. */
      catDocDown = (event) => {
        if (D.catMenu.hidden) return;
        if (D.catMenu.contains(event.target) || D.catBtn.contains(event.target)) return;
        closeCatMenu();
      };
      catDocKey = (event) => {
        if (event.key !== "Escape" || D.catMenu.hidden) return;
        /* Capture on window: the modal listens for Escape on window/document too,
           and a later-registered document listener never gets the first word. */
        event.stopImmediatePropagation(); event.preventDefault();
        closeCatMenu();
      };
      document.addEventListener("pointerdown", catDocDown, true);
      window.addEventListener("keydown", catDocKey, true);
    }
    const r = D.catBtn.getBoundingClientRect();
    const w = Math.max(Math.round(r.width), 192);
    const h = D.catMenu.offsetHeight;
    D.catMenu.style.width = w + "px";
    /* Right-aligned to the trigger: the list is wider than the button, and
       growing rightwards pushed it past the panel edge. */
    D.catMenu.style.left = Math.round(Math.min(Math.max(8, r.right - w), innerWidth - w - 8)) + "px";
    /* Flip above the trigger when the list would run off the bottom. */
    D.catMenu.style.top = (r.bottom + h > innerHeight - 8
      ? Math.max(8, Math.round(r.top - h - 6))
      : Math.round(r.bottom + 6)) + "px";
  }

  function closeCatMenu() {
    if (!D.catMenu) return;
    D.catMenu.hidden = true;
    if (D.catBtn) {
      D.catBtn.setAttribute("aria-expanded", "false");
      D.catBtn.dataset.state = "closed";
    }
    if (catDocDown) {
      document.removeEventListener("pointerdown", catDocDown, true);
      window.removeEventListener("keydown", catDocKey, true);
      catDocDown = null; catDocKey = null;
    }
  }

  async function saveCategory(category) {
    if (!S.currentName) return;
    try {
      await request("/workflows/" + encodeURIComponent(S.currentName) + "/category",
        jsonOptions("PUT", { category }));
      S.category = category;
      await loadWorkflows();
      renderList(); renderHead();
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
      notify(category ? t("分类已设为「{category}」", { category: cat(category) }) : t("已清除分类"));
    } catch (error) {
      notify(error.message, true);
      renderHead();
    }
  }

  async function saveFields() {
    if (!S.currentName) return false;
    try {
      const data = await request("/workflows/" + encodeURIComponent(S.currentName) + "/fields",
        jsonOptions("PUT", { fields: S.fields }));
      S.fields = data.fields || [];
      S.fieldsDirty = false;
      /* Saved state becomes the new baseline: 保存为默认参数 disables again
         and the left 取消(revert) hides until the next edit. */
      snapshotParams();
      /* 默认值可能被后端夹进 min/max（或者解析成了别的写法），以落盘值为准
         回填，免得输入框还显示一个早就被改掉的数。 */
      for (const entry of entries) {
        const hit = S.fields.find((field) => String(field.nodeId) === String(S.inspecting)
          && String(field.key) === entry.key);
        if (!hit) continue;
        entry.original = hit.default;
        entry.draft = hit.default === null || hit.default === undefined ? "" : String(hit.default);
      }
      if (entries.length) paintNodeFields();
      renderHead(); updateExposedCounts();
      /* 画布上已建的节点要重新取一次字段表，才会显示新的默认值。 */
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
      /* Title + description is the host toast's own two-line form: the title
         says what happened, the second line says to what. */
      notify(t("配置已保存"), { detail: S.currentName });
      return true;
    } catch (error) {
      notify(error.message, true);
      return false;
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
        catch (_) { throw new Error(t("{name} 不是合法 JSON", { name: file.name })); }
        if (!isApiWorkflow(workflow)) throw new Error(t("{name} 不是 ComfyUI API 格式工作流", { name: file.name }));
        const name = file.name.replace(/\.json$/i, "");
        const saved = await request("/workflows", jsonOptions("POST", { name, workflow }));
        await loadWorkflows();
        await selectWorkflow(saved.name);
        notify(t("已保存 {name}", { name: saved.name }));
      } catch (error) {
        notify(error.message, true);
      }
    }
  }

  /* ------------------------------ rename ------------------------------

     The title is the workflow's file stem. Renaming moves <name>.json and
     <name>.fields.json on the backend; nodes hold the same stem, so they are
     retargeted here (NS.flow.renameWorkflowRefs) before the shared list is
     refreshed — that event is also what makes every API selector show the new
     label without a reload. */

  const WF_NAME_RE = /^[^/\\:*?"<>|]{1,120}$/;

  function checkWorkflowName(name) {
    if (!name) return t("名称不能为空");
    if (!WF_NAME_RE.test(name)) return t("名称不能包含 / \\ : * ? \" < > |");
    if (name === "." || name === ".." || name.includes("..")) return t("名称不能包含 ..");
    if (name.toLowerCase().endsWith(".fields")) return t("名称不能以 .fields 结尾");
    return "";
  }

  /* ---------------------------- default workflow ----------------------------

     api_settings.json keeps one pinned default per category; the list endpoint
     resolves the fallback (first workflow of the category in drag order) when
     nothing is pinned, so `is_default` is always present on the rows. Pinning
     only writes that map -- the node selectors keep their own behaviour. */

  async function setDefaultWorkflow() {
    if (!S.currentName) return;
    const category = (S.category || "").trim();
    if (!category) { notify(t("请先给这个工作流设置分类"), true); return; }
    const current = S.workflows.find((item) => wfKey(item) === S.currentName);
    if (current && current.default_pinned) {
      notify(t("它已经是「{category}」的默认工作流", { category: cat(category) }));
      return;
    }
    try {
      const data = await request(
        "/workflows/" + encodeURIComponent(S.currentName) + "/default",
        jsonOptions("POST", {}));
      if (data && Array.isArray(data.workflows)) S.workflows = data.workflows;
      renderList(); renderHead();
      /* The generate nodes mirror this list: the event is what makes every node
         that still follows its category default switch to the new one. */
      window.dispatchEvent(new CustomEvent("infcanvas:workflows-changed"));
      notify(t("已设为默认工作流"), { detail: t("{name} · 分类「{category}」", { name: S.currentName, category: cat(category) }) });
    } catch (error) {
      notify(error.message, true);
    }
  }

  async function renameWorkflow() {
    if (!S.currentName) return;
    const from = S.currentName;
    const answer = await NS.api?.promptDialog?.({
      title: t("重命名工作流"),
      message: "新的工作流名称（所有引用它的节点会一起更新）",
      defaultValue: from,
    });
    if (answer === null || answer === undefined) return;
    const to = String(answer).trim();
    if (!to || to === from) return;
    const invalid = checkWorkflowName(to);
    if (invalid) { notify(invalid, true); return; }
    try {
      await request("/workflows/" + encodeURIComponent(from) + "/rename",
        jsonOptions("POST", { to }));
    } catch (error) {
      notify(error.message, true);
      return;
    }
    /* The template name IS the workflow id, so between the API call and the list
       refresh every referencing node holds a name the list does not know yet.
       Mute the nodes' "adopt the category default" watcher for that window or it
       rewrites all of them to the default and the rename silently disappears. */
    S.currentName = to;
    NS.flow?.setRenaming?.(true);
    let changed = 0;
    try {
      changed = NS.flow?.renameWorkflowRefs?.(from, to) || 0;
      await loadWorkflows();
    } finally {
      /* loadWorkflows already awaited, so the pending watchers have flushed. */
      NS.flow?.setRenaming?.(false);
    }
    renderHead();
    notify(t("已重命名"), { detail: changed ? t("{to} · {n} 个节点已更新", { to, n: changed }) : to });
  }

  async function removeWorkflow() {
    if (!S.currentName) return;
    const ok = await NS.api?.confirmDialog?.({
      title: t("删除工作流"),
      message: t("您确定要删除此工作流吗？"),
      itemList: [S.currentName],
      type: "delete", key: "infcanvas-delete-workflow",
    });
    if (!ok) return;
    const name = S.currentName;
    try {
      await request("/workflows/" + encodeURIComponent(name), { method: "DELETE" });
      S.currentName = ""; S.currentWorkflow = null; S.fields = []; S.fieldsDirty = false;
      closeNodeFields();
      await loadWorkflows();
      renderHead(); renderPreview();
      notify(t("已删除工作流"), { detail: name });
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

  /* ---------------- exposed-parameter order panel ---------------- */

  /* One row per exposed field, in S.fields order (= fields.json = the node's
     settings popover order). Each row is a verbatim port of the node popover's
     WidgetGrid row, so the controls here look EXACTLY like the node's
     「API 参数」panel (number steppers / combobox / switch / text input). The
     only extra is the grip column, revealed while reordering. */
  const FIELD_VALUE = (field) => (field && field.default !== undefined && field.default !== null
    ? field.default : (field?.options?.[0] ?? ""));

  /* ---- default-parameter baseline / dirty tracking --------------------
     The right panel edits S.fields in place (default values, control modes,
     label/type via the inspector). We keep a deep snapshot of the last
     loaded/saved state so 「保存为默认参数」can stay disabled until something
     actually changed, and 「取消」can restore the exact prior parameters.

     Only the persisted field attributes matter for "changed"; React-style
     render churn never enters S.fields, so a plain structural JSON compare is
     both cheap (tens of rows) and exact. */
  function snapshotParams() {
    S.paramSnapshot = JSON.parse(JSON.stringify(S.fields));
  }
  function paramsChanged() {
    if (!S.paramSnapshot) return false;
    try {
      return JSON.stringify(S.fields) !== JSON.stringify(S.paramSnapshot);
    } catch (_) { return false; }
  }
  /* Restore the last loaded/saved parameter baseline. Returns true if a
     snapshot existed (so callers know a revert actually happened). */
  function revertDefaultParams() {
    if (!S.paramSnapshot) return false;
    S.fields = JSON.parse(JSON.stringify(S.paramSnapshot));
    S.fieldsDirty = false;
    /* renderHead() -> renderParamOrder() -> renderPromptArea() rebuilds every
       control (including the prompt textarea) from the restored fields. */
    renderHead();
    updateExposedCounts();
    return true;
  }

  /* Mutating a field object in place would also mutate orderSnapshot's shallow
     copy (see toggleParamOrder) and lose the ability to cancel. So every edit
     REPLACES the array slot with a new object carrying the new default. */
  const setFieldDefault = (index, value, silent) => {
    const field = S.fields[index];
    if (!field) return;
    const next = S.fields.slice();
    next[index] = { ...field, default: value };
    S.fields = next;
    S.fieldsDirty = true;
    /* The prompt textarea edits while typing — rebuilding the list here would
       steal focus on every keystroke. Its value is already in the DOM; only the
       action buttons need refreshing (save enabled, revert visible). */
    if (!silent) renderParamOrder();
    else syncParamActions();
  };
  /* Numeric controls step by the field's own step, clamped to min/max. */
  const stepFieldNum = (field, dir) => {
    const cur = Number(FIELD_VALUE(field));
    const step = Number(field?.step) > 0 ? Number(field.step) : 1;
    let value = (Number.isFinite(cur) ? cur : 0) + dir * step;
    const min = Number(field?.min), max = Number(field?.max);
    if (Number.isFinite(min)) value = Math.max(min, value);
    if (Number.isFinite(max)) value = Math.min(max, value);
    /* Match the current value's integer/float nature (seed is an int). */
    const base = FIELD_VALUE(field);
    if (typeof base === "number" && Number.isInteger(base)) value = Math.round(value);
    return value;
  };

  function fieldTextLocal(field) {
    const value = FIELD_VALUE(field);
    if (typeof value === "boolean") return value ? t("开") : t("关");
    if (value === "" || value === null || value === undefined) return "";
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    const step = String(field?.step ?? "");
    const dot = step.indexOf(".");
    const digits = dot < 0 ? 0 : step.length - dot - 1;
    return digits > 0 ? num.toFixed(Math.min(digits, 6)) : String(num);
  }
  function fieldFillLocal(field) {
    const min = Number(field?.min), max = Number(field?.max), step = Number(field?.step);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return 0;
    if (max <= min || (max - min) / step >= 100) return 0;
    return Math.max(0, Math.min(1, (Number(FIELD_VALUE(field)) - min) / (max - min))) * 100;
  }

  /* ---------------- widget popups (field dropdown / control chooser) ------
     The node's combobox and the 随机 button both OPEN a menu hosted on the
     node root (the settings card scrolls, so an in-menu child would be
     clipped). Do the same here: one menu at a time, mounted on the dialog's
     panel, positioned from the trigger rect, closed by outside press / Escape.
     Skins are the node's own class strings — 1:1 with the node. */
  let widgetMenu = null, widgetAnchor = null, widgetDocDown = null, widgetDocKey = null;
  function closeWidgetMenu() {
    if (widgetMenu) { widgetMenu.remove(); widgetMenu = null; }
    if (widgetAnchor) { delete widgetAnchor.dataset.acOpen; widgetAnchor = null; }
    if (widgetDocDown) {
      document.removeEventListener("pointerdown", widgetDocDown, true);
      widgetDocDown = null;
    }
    if (widgetDocKey) {
      window.removeEventListener("keydown", widgetDocKey, true);
      widgetDocKey = null;
    }
  }
  function openWidgetMenu(anchor, menu) {
    const reopening = widgetAnchor === anchor && widgetMenu && widgetMenu.className === menu.className;
    closeWidgetMenu();
    if (reopening) return null;
    (ui?.panel || document.body).appendChild(menu);
    widgetMenu = menu; widgetAnchor = anchor; anchor.dataset.acOpen = "1";
    /* Keep gestures inside the menu off the dialog (mask / Escape / close). */
    ["pointerdown", "mousedown", "dblclick", "wheel"].forEach((kind) =>
      menu.addEventListener(kind, (event) => event.stopPropagation()));
    widgetDocDown = (event) => {
      if (menu.contains(event.target) || anchor.contains(event.target)) return;
      closeWidgetMenu();
    };
    widgetDocKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation(); event.preventDefault();
      closeWidgetMenu();
    };
    document.addEventListener("pointerdown", widgetDocDown, true);
    window.addEventListener("keydown", widgetDocKey, true);
    /* Flush into layout before measuring so the menu has its real size. */
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.round(Math.min(Math.max(8, r.left), innerWidth - mw - 8)) + "px";
    menu.style.top = (r.bottom + mh > innerHeight - 8
      ? Math.max(8, Math.round(r.top - mh - 4))
      : Math.round(r.bottom + 4)) + "px";
    return menu;
  }
  /* The node's searchable combobox listbox, verbatim classes. */
  function openSelectMenu(anchor, field, index) {
    const menu = el("div", "icn__gpa-fsel ac-widget-menu");
    const searchRow = el("div", "icn__sel-search");
    const searchIcon = el("span", "shrink-0"); searchIcon.innerHTML = ICO.search;
    const search = el("input", "icn__sel-searchinput");
    search.type = "text"; search.placeholder = t("搜索选项…"); search.spellcheck = false;
    searchRow.append(searchIcon, search);
    const list = el("div", "max-h-56 overflow-y-auto p-1 text-xs");
    menu.append(searchRow, list);
    if (!openWidgetMenu(anchor, menu)) return;
    const opts = (S.fields[index]?.options || []).map(String);
    const paint = () => {
      list.replaceChildren();
      const q = String(search.value || "").trim().toLowerCase();
      const hits = q ? opts.filter((o) => o.toLowerCase().includes(q)) : opts;
      hits.forEach((opt) => {
        const current = String(FIELD_VALUE(S.fields[index]) ?? "") === opt;
        const item = el("button", "flex h-8 w-full cursor-pointer items-center justify-between gap-3 "
          + "rounded-sm border-0 bg-transparent p-2 text-left outline-none select-none hover:bg-secondary "
          + (current ? "bg-primary/20 hover:bg-primary/20" : ""));
        item.type = "button";
        item.appendChild(el("span", "truncate", opt));
        if (current) { const tick = el("span", "size-3.5 shrink-0"); tick.innerHTML = ICO.check; item.appendChild(tick); }
        item.addEventListener("click", (event) => {
          event.stopPropagation(); closeWidgetMenu();
          setFieldDefault(index, opt);
        });
        list.appendChild(item);
      });
      if (!hits.length) list.appendChild(el("div", "p-2 text-xs text-muted-foreground", t("未找到匹配的选项")));
    };
    search.addEventListener("input", paint);
    paint();
    search.focus();
  }
  /* The node's ValueControlPopover: what happens to this 随机数 each run.
     The chosen mode is stored on the exposed field and saved with fields.json. */
  const CONTROL_MODES = [
    { mode: "fixed", icon: "pencilOff", title: "固定值", desc: "数值不变" },
    { mode: "increment", text: "+1", title: "递增值", desc: "数值+1或切换到下一个选项" },
    { mode: "decrement", text: "-1", title: "递减值", desc: "数值-1或切换到上一个选项" },
    { mode: "randomize", icon: "shuffle", title: "随机值", desc: "每次运行后随机化该值" },
  ];
  const fieldMode = (field) => field?.controlMode || "randomize";
  function openControlMenu(anchor, field, index) {
    const menu = el("div", "icn__gpa-modes ac-widget-menu");
    const inner = el("div", "w-full space-y-2 p-2");
    const intro = el("div", "px-1 pb-0.5 text-xs/tight text-muted-foreground");
    intro.append(document.createTextNode(t("自动更新该值") + " "),
      el("span", "font-medium text-foreground", t("之后")),
      document.createTextNode(" " + t("正在运行工作流：")));
    const group = el("div", "flex flex-col gap-0.5");
    inner.append(intro, group); menu.appendChild(inner);
    if (!openWidgetMenu(anchor, menu)) return;
    CONTROL_MODES.forEach((entry) => {
      const active = fieldMode(S.fields[index]) === entry.mode;
      const row = el("div", "flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left");
      const main = el("button", "flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 "
        + "bg-transparent p-0 text-left text-wrap");
      const tile = el("span", "flex size-6 shrink-0 items-center justify-center rounded-md border "
        + "border-solid border-border/50 bg-secondary");
      if (entry.icon) tile.innerHTML = ICO[entry.icon];
      else tile.appendChild(el("span", "text-xs font-normal text-foreground", entry.text));
      const copy = el("span", "flex min-w-0 flex-1 flex-col text-xs/tight font-normal");
      copy.append(el("span", "text-foreground", t(entry.title)), el("span", "text-muted-foreground", t(entry.desc)));
      main.append(tile, copy);
      const radio = el("button", "inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center "
        + "rounded-full border border-solid bg-transparent outline-none "
        + (active ? "border-primary" : "border-border"));
      if (active) radio.appendChild(el("span", "block size-1.5 rounded-full bg-primary"));
      const pick = (event) => {
        event.stopPropagation(); closeWidgetMenu();
        const next = S.fields.slice();
        next[index] = { ...next[index], controlMode: entry.mode };
        S.fields = next; S.fieldsDirty = true;
        renderParamOrder();
      };
      main.addEventListener("click", pick); radio.addEventListener("click", pick);
      row.append(main, radio); group.appendChild(row);
    });
  }

  /* Build the control cell exactly as the node popover does — but LIVE: every
     control writes its edited value back to field.default via setFieldDefault.
     The index is needed because that helper replaces the array slot. */
  function buildFieldControl(field, index) {
    const iconBtn = (glyph, title, onClick) => {
      const b = el("button", "relative flex shrink-0 cursor-pointer items-center justify-center "
        + "border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground "
        + "hover:bg-accent disabled:pointer-events-none disabled:opacity-30");
      b.type = "button"; b.title = t(title); b.innerHTML = glyph;
      b.tabIndex = -1;
      if (onClick) b.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
      return b;
    };
    const type = field?.type;
    if (type === "number" || type === "slider" || type === "random") {
      const box = el("div", "relative flex w-full items-stretch overflow-hidden rounded-md "
        + "bg-input text-xs text-foreground h-6");
      const clip = el("span", "pointer-events-none absolute inset-0 overflow-clip rounded-md");
      const fill = el("span", "block size-full bg-primary/15");
      fill.style.width = fieldFillLocal(field) + "%";
      clip.appendChild(fill);
      const numWrap = el("div", "relative my-0.25 min-w-[4ch] flex-1 py-1.5");
      const input = el("input", "absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0");
      input.type = "text"; input.inputMode = "decimal";
      input.value = fieldTextLocal(field);
      input.spellcheck = false;
      const commit = () => {
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed)) { input.value = fieldTextLocal(S.fields[index]); return; }
        setFieldDefault(index, parsed);
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "ArrowUp") { event.preventDefault(); setFieldDefault(index, stepFieldNum(S.fields[index], 1)); }
        if (event.key === "ArrowDown") { event.preventDefault(); setFieldDefault(index, stepFieldNum(S.fields[index], -1)); }
      });
      numWrap.appendChild(input);
      box.append(clip,
        iconBtn(ICO.minus, "减少", () => setFieldDefault(index, stepFieldNum(S.fields[index], -1))),
        numWrap);
      if (type === "random") {
        const modeEntry = CONTROL_MODES.find((m) => m.mode === fieldMode(field)) || CONTROL_MODES[3];
        /* Match the node's ValueControlButton: 固定值 = transparent/grey glyph,
           every other mode = blue capsule. Glyph size-3 (12px), not 16px. */
        const badge = el("button", "mr-1 flex h-4.5 w-8 shrink-0 cursor-pointer items-center "
          + "justify-center self-center rounded-full border-none "
          + (modeEntry.mode === "fixed"
            ? "bg-transparent text-muted-foreground hover:bg-accent"
            : "bg-primary/30 text-primary hover:bg-primary/27"));
        badge.type = "button"; badge.tabIndex = -1;
        badge.title = t(modeEntry.title) + t("：点击切换控制方式");
        if (modeEntry.icon) {
          badge.innerHTML = ICO[modeEntry.icon].replace('width="16" height="16"', 'width="12" height="12"');
        } else badge.appendChild(el("span", "text-xs font-normal", modeEntry.text));
        /* The badge is NOT "randomize now" — it OPENS the value-control chooser,
           exactly like the host's ValueControlButton. */
        badge.addEventListener("click", (event) => {
          event.stopPropagation(); openControlMenu(badge, field, index);
        });
        box.appendChild(badge);
      }
      box.appendChild(iconBtn(ICO.plus, "增加", () => setFieldDefault(index, stepFieldNum(S.fields[index], 1))));
      return box;
    }
    if (type === "select") {
      const box = el("div", "flex w-full min-w-0 items-center overflow-hidden rounded-md "
        + "bg-input text-foreground h-6 hover:bg-accent");
      const btn = el("button", "flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden "
        + "border-none bg-transparent p-0 outline-none");
      btn.type = "button";
      const label = el("span", "min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs",
        String(FIELD_VALUE(field) ?? ""));
      btn.appendChild(label);
      const chev = el("button", "flex h-full w-6 shrink-0 cursor-pointer items-center justify-center "
        + "border-none bg-transparent outline-none");
      chev.type = "button"; chev.innerHTML = ICO.chevron;
      /* Host WidgetSelectDefault: click OPENS a searchable listbox (never a
         silent cycle), with the same classes as the node's own dropdown. */
      const pick = (event) => { event.stopPropagation(); openSelectMenu(box, field, index); };
      btn.setAttribute("role", "combobox");
      btn.addEventListener("click", pick);
      chev.addEventListener("click", pick);
      box.append(btn, chev);
      return box;
    }
    if (type === "switch") {
      const wrap = el("div", "-m-1 ml-auto flex w-fit items-center gap-2 rounded-full p-1");
      const on = FIELD_VALUE(field) === true || FIELD_VALUE(field) === "true";
      const btn = el("button", "group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation "
        + "items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none "
        + "transition-shadow focus-visible:ring-1 focus-visible:ring-ring");
      btn.type = "button"; btn.dataset.state = on ? "checked" : "unchecked";
      const track = el("span", "pointer-events-none inline-flex h-5 w-9 items-center rounded-full "
        + "border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary");
      const knob = el("span", "pointer-events-none block size-4 rounded-full bg-background shadow-sm "
        + "transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0");
      knob.dataset.state = on ? "checked" : "unchecked";
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        setFieldDefault(index, !(FIELD_VALUE(S.fields[index]) === true || FIELD_VALUE(S.fields[index]) === "true"));
      });
      track.appendChild(knob); btn.appendChild(track); wrap.appendChild(btn);
      return wrap;
    }
    /* text / textarea / fallback */
    const input = el("input", "flex w-full min-w-0 appearance-none rounded-md border-none bg-input "
      + "px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 "
      + "focus-visible:ring-ring focus-visible:outline-none");
    input.value = String(FIELD_VALUE(field) ?? "");
    input.spellcheck = false;
    input.addEventListener("change", (event) => setFieldDefault(index, event.target.value));
    return input;
  }

  /* Same advanced/basic split as infcanvas-flow.js: an explicit `advanced`
     flag wins; legacy fields fall back to the basic-label whitelist. */
  const BASIC_LABELS = ["提示词优化", "提示词", "高宽比", "百万像素", "放大倍数", "种子"];
  const isAdvancedField = (field) => (typeof field?.advanced === "boolean"
    ? field.advanced
    : !BASIC_LABELS.includes(String(field?.label || "").trim()));

  /* EVERY exposed multiline-text field gets its own large standalone box — we
     no longer pick just one. Whatever the user exposes (by type text/textarea)
     is rendered below the card, in S.fields order, each bound to its own index.
     Names are irrelevant (no 提示词 lock), so 风格描述 / 歌词 / 描述 all work,
     and re-ordering the boxes re-orders the underlying fields. Returns
     [{ field, index }] for every text/textarea field.
     NOTE: infcanvas-flow.js has its own promptField() with the old single-box
     name lock; keep the two in sync if that one is changed too. */
  function findPromptFields() {
    const isText = (f) => f?.type === "text" || f?.type === "textarea";
    return S.fields.map((field, index) => ({ field, index })).filter((e) => isText(e.field));
  }

  /* Standalone textareas below the card, one per exposed text/textarea field,
     using the node panel's exact classes (icn__gpa-inputs/box/label/area) so
     each is pixel-identical. In sort mode each row grows a grip and joins the
     SAME global-index drag reordering the card rows use. */
  function renderPromptArea() {
    if (!D.promptBox) return;
    const hits = findPromptFields();
    D.promptBox.replaceChildren();
    if (!hits.length) { D.promptBox.hidden = true; return; }
    D.promptBox.hidden = false;
    const editing = S.orderEditing;
    hits.forEach(({ field, index }) => {
      const row = el("div", "ac-prompt-row"
        + (!editing && S.orderDrag === index ? " is-dragging" : "")
        + (editing && S.orderDrop === index && S.orderDrag !== index ? " is-drop" : ""));
      row.dataset.index = String(index);
      const grip = el("div", "ac-prow-grip");
      grip.innerHTML = ICO.grip;
      row.appendChild(grip);
      const box = el("label", "icn__gpa-box");
      box.appendChild(el("span", "icn__gpa-label", field.label || t("提示词")));
      const area = el("textarea", "icn__gpa-area icn__gpa-area--a");
      area.value = String(FIELD_VALUE(field) ?? "");
      area.spellcheck = false;
      area.placeholder = t("描述你想要生成的内容…");
      area.addEventListener("input", (event) => setFieldDefault(index, event.target.value, true));
      box.appendChild(area);
      row.appendChild(box);
      if (editing) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => onOrderDragStart(event, index));
        row.addEventListener("dragover", (event) => onOrderDragOver(event, index));
        row.addEventListener("drop", (event) => onOrderDrop(event, index));
        row.addEventListener("dragend", onOrderDragEnd);
      }
      D.promptBox.appendChild(row);
    });
  }

  function toggleParamsAdvanced() {
    S.paramsShowAdvanced = !S.paramsShowAdvanced;
    renderParamOrder();
  }

  /* Refresh just the parameter action buttons without rebuilding the field
     rows (used on every keystroke of the prompt textarea, where a full render
     would steal focus). Sort mode wins: while sorting only 确定顺序/取消顺序
     are shown. Otherwise 保存为默认参数 is enabled only when params actually
     differ from the baseline, and 取消(恢复参数) mirrors that state on its left. */
  function syncParamActions() {
    if (!D.paramsSave || !D.paramsRevert) return;
    const editing = S.orderEditing;
    const changed = paramsChanged() && !!S.fields.length;
    D.paramsRevert.hidden = editing || !changed;
    D.paramsSave.hidden = editing;
    D.paramsSave.disabled = !changed;
    D.paramsEdit.hidden = editing || !S.fields.length;
    D.paramsEdit.disabled = !S.fields.length;
    D.paramsConfirm.hidden = !editing;
    D.paramsCancel.hidden = !editing;
  }

  function renderParamOrder() {
    if (!D.paramsList) return;
    const editing = S.orderEditing;
    D.params.classList.toggle("is-sorting", editing);

    /* Every exposed text/textarea field is rendered as its own textarea below
       the card — never a settings row. Exclude ALL of them from the card (list,
       badge, ordering); they are handled by renderPromptArea instead. */
    renderPromptArea();
    const promptSet = new Set(findPromptFields().map((e) => e.field));
    const cardFields = S.fields.filter((f) => !promptSet.has(f));
    /* Node's widget split: visible fields = all when expanded, else basics. */
    const advanced = cardFields.filter(isAdvancedField);
    const visible = S.paramsShowAdvanced ? cardFields : cardFields.filter((f) => !isAdvancedField(f));
    /* Badge shows the VISIBLE count, exactly like the node's popcnt. */
    D.paramsCount.textContent = visible.length ? String(visible.length) : "";

    /* Normal mode: 保存为默认参数 (enabled only when params changed) + its left
       取消(revert) + reorder entry. Sort mode: confirm/cancel. */
    syncParamActions();

    /* NodeFooter band: only when there are advanced fields, and its label/icon
       mirror the node (隐藏/显示高级输入 + chevron-up / settings-2). */
    D.paramsMore.hidden = !advanced.length;
    if (advanced.length) {
      D.paramsMoreLabel.textContent = t(S.paramsShowAdvanced ? "隐藏高级输入" : "显示高级输入");
      D.paramsMoreIcon.innerHTML = S.paramsShowAdvanced ? ICO.chevronUp : ICO.settings2;
      D.paramsMoreBtn.title = (D.paramsMoreLabel.textContent) + "（" + advanced.length + " " + t("项") + "）";
    }

    /* The node popover's body: WidgetGrid + host bg/text classes verbatim. */
    const grid = el("div", "icn__gpa-body lg-node-widgets grid "
      + "grid-cols-[min-content_minmax(80px,min-content)_minmax(125px,1fr)] gap-y-1 "
      + "bg-node pt-4 pr-3 pb-3 text-xs text-node-foreground rounded-b-xl");
    D.paramsList.replaceChildren();
    if (!cardFields.length) {
      D.paramsEmpty.hidden = false;
      D.paramsList.appendChild(D.paramsEmpty);
      return;
    }
    D.paramsEmpty.hidden = true;
    /* Iterate visible fields but keep the ORIGINAL index for drag + edits. */
    visible.forEach((field) => {
      const index = S.fields.indexOf(field);
      const row = el("div", "group col-span-full grid grid-cols-subgrid items-stretch ac-prow"
        + (!editing && S.orderDrag === index ? " is-dragging" : "")
        + (editing && S.orderDrop === index && S.orderDrag !== index ? " is-drop" : ""));
      row.dataset.index = String(index);
      /* native WidgetGrid has an empty w-3 first cell; the grip lives there. */
      const grip = el("div", "ac-prow-grip z-10 flex items-stretch w-3");
      grip.innerHTML = ICO.grip;
      const wrap = el("div", "col-span-2 grid min-w-0 grid-cols-subgrid justify-between gap-2");
      const label = el("div", "content-center-safe truncate", field.label || fieldKey(field.nodeId, field.key));
      label.title = field.label || fieldKey(field.nodeId, field.key);
      const cell = el("div", "relative min-w-0 flex-1");
      const inner = el("div", "min-w-0 cursor-default rounded-md transition-all");
      inner.appendChild(buildFieldControl(field, index));
      cell.appendChild(inner);
      wrap.append(label, cell);
      row.append(grip, wrap);
      if (editing) {
        row.draggable = true;
        row.addEventListener("dragstart", (event) => onOrderDragStart(event, index));
        row.addEventListener("dragover", (event) => onOrderDragOver(event, index));
        row.addEventListener("drop", (event) => onOrderDrop(event, index));
        row.addEventListener("dragend", onOrderDragEnd);
      }
      grid.appendChild(row);
    });
    D.paramsList.appendChild(grid);
  }

  function toggleParamOrder() {
    if (!S.fields.length) return;
    S.orderEditing = true;
    S.orderSnapshot = S.fields.slice();
    S.orderDrag = -1; S.orderDrop = -1;
    renderParamOrder();
  }

  function restoreOrderClasses() {
    /* Both the card rows and the standalone text boxes share the same global
       S.fields index, so highlight them together during a drag. */
    const rows = [
      ...(D.paramsList ? D.paramsList.querySelectorAll(".ac-prow") : []),
      ...(D.promptBox ? D.promptBox.querySelectorAll(".ac-prompt-row") : [])
    ];
    rows.forEach((row) => {
      const index = Number(row.dataset.index);
      row.classList.toggle("is-dragging", S.orderDrag === index);
      row.classList.toggle("is-drop", S.orderDrop === index && S.orderDrag !== index);
    });
  }
  function onOrderDragStart(event, index) {
    S.orderDrag = index;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    }
    restoreOrderClasses();
  }
  function onOrderDragOver(event, index) {
    if (S.orderDrag < 0) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (S.orderDrop !== index) { S.orderDrop = index; restoreOrderClasses(); }
  }
  function onOrderDrop(event, index) {
    event.preventDefault();
    const from = S.orderDrag;
    S.orderDrag = -1; S.orderDrop = -1;
    if (from < 0 || from === index) { renderParamOrder(); return; }
    const list = [...S.fields];
    const [moved] = list.splice(from, 1);
    list.splice(index, 0, moved);
    S.fields = list;
    renderParamOrder();
  }
  function onOrderDragEnd() {
    S.orderDrag = -1; S.orderDrop = -1;
    restoreOrderClasses();
  }

  /* Save the default values edited in the right-hand panel (S.fields carries
     the new defaults). saveFields() persists both the defaults and the current
     row order to the workflow; the editor stays in normal mode. */
  async function saveDefaultParams() {
    if (S.orderEditing || !S.fields.length) return;
    const ok = await saveFields();
    if (ok) notify(t("默认参数已保存"));
  }

  async function confirmParamOrder() {
    if (!S.orderEditing) return;
    const ok = await saveFields();
    if (!ok) return;                       /* save failed: stay in edit mode */
    S.orderEditing = false;
    S.orderSnapshot = null;
    S.orderDrag = -1; S.orderDrop = -1;
    renderParamOrder();
    notify(t("参数顺序已保存"));
  }

  function cancelParamOrder() {
    if (S.orderSnapshot) S.fields = S.orderSnapshot.slice();
    S.orderEditing = false;
    S.orderSnapshot = null;
    S.orderDrag = -1; S.orderDrop = -1;
    renderParamOrder();
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
      if (node.exposed) type.appendChild(el("span", "ac-node-count ac-exposed", node.exposed + t(" 已用")));
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
      if (count) type.appendChild(el("span", "ac-node-count ac-exposed", count + t(" 已用")));
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
    inspectorSnapshot = {
      name: S.currentName,
      nodeId: String(nodeId),
      fields: JSON.parse(JSON.stringify(S.fields)),
      fieldsDirty: S.fieldsDirty,
      autoKeys: new Set(S.autoKeys),
      off: offFields(S.currentName),
    };
    S.inspecting = String(nodeId);
    renderNodeFields();
  }
  function closeNodeFields() {
    inspectorSnapshot = null;
    S.inspecting = "";
    if (D.nfMask) D.nfMask.hidden = true;
  }
  /* 取消 = 把这次打开面板后的所有改动丢掉：字段表、脏标记、自动识别集合，
     以及取消勾选自动字段时写进 localStorage 的「不再自动暴露」名单。 */
  function cancelNodeFields() {
    const snap = inspectorSnapshot;
    if (snap && snap.name === S.currentName) {
      S.fields = JSON.parse(JSON.stringify(snap.fields));
      S.fieldsDirty = snap.fieldsDirty;
      S.autoKeys = new Set(snap.autoKeys);
      writeOffFields(snap.name, snap.off);
    }
    closeNodeFields();
    renderHead();
    updateExposedCounts();
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
      /* 默认值优先取 S.fields 里的那份：它可能是刚改过、还没保存的值。直接读
         模板 `value` 会让「改 → 完成 → 再打开」又跳回模板里的旧数，看起来像
         没有改成功。 */
      const shown = field && field.default !== undefined ? field.default : value;
      entries.push({
        key, enabled: !!field,
        /* Filled by the default-parameter pass, not by the user: unticking it
           has to be remembered or the next open would resurrect it. */
        auto: S.autoKeys.has(fieldKey(S.inspecting, key)),
        type: field?.type || guessType(value, key),
        label: field?.label || "", options,
        /* 高级参数。文件里写了布尔值就以它为准；老文件没有这个键，按标签
           白名单兜底——这样勾选框显示的状态和节点里「显不显示」是一致的。
           还没暴露的参数默认算普通，用户刚勾上就应当看得见。 */
        advanced: field
          ? (typeof field.advanced === "boolean" ? field.advanced : defaultAdvanced(field.label))
          : false,
        min: field?.min ?? "", max: field?.max ?? "", step: field?.step ?? "",
        /* 默认值 = 模板里这个输入自己存的值，改它就是改模板（保存时写回）。
           `original` 留着做类型判断：后端要按它的类型把文本解析回去，否则
           INT 字段会写成 "20"，ComfyUI 直接拒。`draft` 是输入框里的文本。 */
        original: shown,
        draft: shown === null || shown === undefined ? "" : String(shown),
        /* {{image}} / {{prompt}} 这类占位符在运行时由连线或节点内容填，
           改它会破坏替换，所以这一行禁用编辑。 */
        placeholder: typeof value === "string" && value.includes("{{"),
      });
    }
    paintNodeFields();
  }

  /* Checkbox.vue's string, with our own data-state: the host drives it with
     reka-ui, we write the same attribute from the change handler. Shared by the
     「启用」and the「高级」box so the two can never drift apart. */
  function checkboxEl(checked) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "inline-flex size-4 shrink-0 cursor-pointer appearance-none items-center "
      + "justify-center rounded-sm border bg-transparent text-background outline-none "
      + "focus-visible:ring-1 focus-visible:ring-ring "
      + "data-[state=checked]:border-primary data-[state=checked]:bg-primary";
    box.checked = checked;
    box.setAttribute("data-state", checked ? "checked" : "unchecked");
    return box;
  }

  function paintNodeFields() {
    D.nfList.replaceChildren();
    if (!entries.length) {
      D.nfList.appendChild(el("div", "rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground",
        t("这个节点没有可直接修改的参数（连线字段不可暴露）")));
    }
    for (const entry of entries) {
      const item = el("div", "rounded-lg border bg-card px-3 py-2.5");
      const head = el("div", "flex items-center gap-2");
      const enable = el("label", "flex min-w-0 flex-1 cursor-pointer items-center gap-2");
      const check = checkboxEl(entry.enabled);
      const tick = el("i", "icon-[lucide--check] size-3 text-background");
      tick.hidden = !entry.enabled;
      check.addEventListener("change", () => {
        entry.enabled = check.checked;
        check.setAttribute("data-state", check.checked ? "checked" : "unchecked");
        tick.hidden = !check.checked;
        if (entry.auto) {
          const id = fieldKey(S.inspecting, entry.key);
          setOffField(S.currentName, id, !check.checked);
          if (!check.checked) S.autoKeys.delete(id);
        }
        paintNodeFields(); syncNodeFields();
      });
      const checkWrap = el("span", "relative flex size-4 shrink-0 items-center justify-center");
      checkWrap.append(check, tick);
      const key = el("span", "min-w-0 truncate text-sm text-foreground", entry.key);
      key.title = entry.key;
      enable.append(checkWrap, key);
      head.appendChild(enable);

      /* 高级参数：勾上的在节点面板里折进「显示高级输入」，不勾的直接摆在
         底栏齿轮里。只有「已启用」才出现——没暴露的参数谈不上高级，而勾选
         状态留在 entry 上，所以取消再勾回来不会丢。 */
      if (entry.enabled) {
        const advLabel = el("label", "ml-2 flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground");
        advLabel.title = t("勾选后，这个参数在节点里收进「显示高级输入」");
        const adv = checkboxEl(entry.advanced);
        const advTick = el("i", "icon-[lucide--check] size-3 text-background");
        advTick.hidden = !entry.advanced;
        adv.addEventListener("change", () => {
          entry.advanced = adv.checked;
          adv.setAttribute("data-state", adv.checked ? "checked" : "unchecked");
          advTick.hidden = !adv.checked;
          syncNodeFields();
        });
        const advWrap = el("span", "relative flex size-4 shrink-0 items-center justify-center");
        advWrap.append(adv, advTick);
        advLabel.append(advWrap, el("span", "", t("高级")));
        head.appendChild(advLabel);
      }

      /* Default value is edited ONLY in the right-hand API 参数 panel now;
         the inspector no longer shows an inline default row. */
      item.appendChild(head);

      const detail = el("div", "mt-2 flex flex-col gap-2 border-t pt-2");
      detail.hidden = !entry.enabled;
      if (entry.enabled) {
        const row = el("div", "flex gap-2");
        const select = el("select", "h-6 w-28 shrink-0 cursor-pointer rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
        for (const [value, label] of TYPE_OPTIONS) {
          const option = document.createElement("option");
          option.value = value; option.textContent = t(label);
          if (value === entry.type) option.selected = true;
          select.appendChild(option);
        }
        select.addEventListener("change", () => {
          entry.type = select.value;
          paintNodeFields(); syncNodeFields();
        });
        const labelInput = el("input", "h-6 min-w-0 flex-1 rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
        labelInput.placeholder = t("显示名");
        labelInput.spellcheck = false;
        labelInput.value = entry.label;
        labelInput.addEventListener("input", () => { entry.label = labelInput.value; syncNodeFields(); });
        row.append(select, labelInput);
        detail.appendChild(row);

        /* Default value is edited in the right-hand API 参数 panel, not here. */
        if (entry.type === "select") {
          const options = el("div", "flex flex-col gap-2");
          entry.options.forEach((value, index) => {
            const optionRow = el("div", "flex gap-2");
            const input = el("input", "h-6 min-w-0 flex-1 rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
            input.placeholder = t("选项 {n}", { n: index + 1 });
            input.spellcheck = false;
            input.value = value;
            input.addEventListener("input", () => { entry.options[index] = input.value; syncNodeFields(); });
            const remove = el("button", "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-muted-foreground hover:bg-accent", "×");
            remove.type = "button"; remove.title = t("删除这个选项");
            remove.addEventListener("click", () => {
              entry.options.splice(index, 1); paintNodeFields(); syncNodeFields();
            });
            optionRow.append(input, remove);
            options.appendChild(optionRow);
          });
          const add = el("button", "" + BTN_SECONDARY + " w-full", t("+ 添加选项"));
          add.type = "button";
          add.addEventListener("click", () => {
            entry.options.push(""); paintNodeFields(); syncNodeFields();
          });
          options.appendChild(add);
          detail.appendChild(options);
        }

        if (["slider", "number", "random"].includes(entry.type)) {
          const nums = el("div", "flex gap-2");
          for (const [prop, text] of [["min", t("最小")], ["max", t("最大")], ["step", t("步长")]]) {
            const wrap = el("label", "flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground", text);
            const input = el("input", "h-6 min-w-0 flex-1 rounded-md border-0 bg-input px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring");
            input.type = "number"; input.value = entry[prop];
            input.addEventListener("input", () => { entry[prop] = input.value; syncNodeFields(); });
            wrap.appendChild(input);
            nums.appendChild(wrap);
          }
          detail.appendChild(nums);
        }

        if (MEDIA_LABELS[entry.type]) {
          detail.appendChild(el("div", "rounded-md bg-muted px-2 py-1.5 text-xs leading-relaxed text-muted-foreground",
            t("运行时自动取节点上的{label}，优先上游、其次自身，这里不用填。",
              { label: t(MEDIA_LABELS[entry.type]) })));
        }
      }
      item.appendChild(detail);
      D.nfList.appendChild(item);
    }
    D.nfCount.textContent = countText(entries.filter((e) => e.enabled));
  }

  /* 底栏一句话：启用几个、其中几个是高级（高级的在节点里折进「显示高级输入」）。
     有未保存的改动时补一句——默认值就在这一层里改，按「取消」会整表回滚，
     按「保存」才落到工作流文件。 */
  function countText(list) {
    const advanced = list.filter((entry) => entry.advanced).length;
    const base = t("已启用 {n} 个字段", { n: list.length })
      + (advanced ? t("（{n} 个高级）", { n: advanced }) : "");
    return S.fieldsDirty ? base + t(" · 未保存") : base;
  }

  /* NodeFields.collect(): emit the full field table for the inspected node. */
  function collectNodeFields() {
    return entries.filter((entry) => entry.enabled).map((entry) => {
      const field = {
        nodeId: S.inspecting, key: entry.key, type: entry.type,
        label: entry.label.trim() || entry.key,
        /* 一律写明确的布尔值：以后改了节点面板的兜底表也不会把已经定好的
           参数悄悄挪到另一边。 */
        advanced: !!entry.advanced,
      };
      /* 默认值以文本回传，由后端按模板现有值的类型解析回去（int / float /
         bool / str）。没改过时传的就是原值，后端比对后不会重复写。占位符
         字段整行禁用，不参与。 */
      if (!entry.placeholder) field.default = entry.draft;
      if (entry.type === "select") {
        field.options = entry.options.map((item) => String(item).trim()).filter(Boolean);
      }
      if (entry.type === "number" || entry.type === "slider" || entry.type === "random") {
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
    D.nfCount.textContent = countText(list);
  }

  /* ------------------------------- open ------------------------------- */

  function open() {
    injectStyles();
    /* Subscribe on first open: i18n.js loads after this module alphabetically,
       so a top-level subscription would be skipped. */
    if (!NS._i18nApiCfgSubscribed && NS.i18n?.onChange) {
      NS.i18n.onChange(() => {
        if (ui?.mask?.isConnected) {
          const keep = S.currentName;
          close();
          open();
          if (keep) setTimeout(() => { try { selectWorkflow(keep); } catch (e) {} }, 400);
        }
      });
      NS._i18nApiCfgSubscribed = true;
    }
    close();
    const host = document.getElementById("infcanvas-root") || document.body;
    /* DialogOverlay + BaseModalLayout size "md", class for class. The dialog is
       NOT built on NS.tools.openModal any more: that shell carries the tools'
       own ict-* skin (14px radius, #494a50 border, 15px head), which is exactly
       what this rewrite is getting rid of. */
    const mask = el("div", "fixed inset-0 flex items-center justify-center bg-black/70 p-6");
    mask.style.zIndex = "9999";
    const panel = el("div", "relative flex h-[80vh] w-[90vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border bg-background shadow-lg");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", t("API 配置"));
    mask.appendChild(panel);

    const banner = el("div", "shrink-0 border-b bg-destructive/10 px-6 py-2 text-xs leading-relaxed text-destructive");
    banner.textContent = t("请完全重启 ComfyUI：API 配置接口是后端新增路由，仅刷新浏览器无效。")
      + t("重启后重新打开本弹窗即可。");
    banner.hidden = true;
    panel.appendChild(banner);

    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (!D.nfMask?.hidden) { cancelNodeFields(); return; }
      close();
    };
    document.addEventListener("keydown", onKey, true);
    const onMaskDown = (event) => { if (event.target === mask) close(); };
    mask.addEventListener("pointerdown", onMaskDown);

    buildUI(panel);
    host.appendChild(mask);

    ui = {
      mask, panel,
      setApiReady(ready) { banner.hidden = ready !== false; },
      close() {
        closeWidgetMenu();
        closeCatMenu && closeCatMenu();
        document.removeEventListener("keydown", onKey, true);
        mask.remove();
        ui = null;
      },
    };
    probeBackend();
    loadWorkflows();
  }

  function close() { ui?.close?.(); }

  /* Rebuild the open dialog on language change so its commandeered host-class
     strings are re-created with the new language. The selected workflow is kept
     in S and reselected by open()->loadWorkflows. */
  NS.apiConfig = { open, close, isOpen: () => !!ui?.mask?.isConnected };
})();
