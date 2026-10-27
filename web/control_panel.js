/* Shared engine behind Group Control 🐈‍⬛ and Node Control 🐈‍⬛.

   Both nodes are the same machine pointed at a different subject: a list of
   canvas things, one switch each, plus filters, ordering and an interaction
   mode. The subject-specific half (what counts as a row, what "off" does to
   it) is passed in by the caller; everything else — persistence, node sizing,
   the settings dialog, the graph watch — lives here so the two panels can
   never drift out of sync.

   Nothing here is executed by the sampler. The panel writes `node.mode`
   directly, which is exactly what muting or bypassing a node by hand does.
*/

import { app } from "../../../scripts/app.js";
import { pick } from "./i18n.js";

/* Chrome strings for the panel itself. Subject-specific copy comes from the
   calling node as `{ zh, en }` pairs and is resolved with `pick` at render. */
const UI = {
  settings: { zh: "设置", en: "Settings" },
  closeMethod: { zh: "关闭方式", en: "Close method" },
  mode: { zh: "互斥模式", en: "Mode" },
  sort: { zh: "排序", en: "Sort" },
  reverse: { zh: "反向排序", en: "Reverse order" },
  off: { zh: "关", en: "Off" },
  on: { zh: "开", en: "On" },
  clearColors: { zh: "清除颜色筛选", en: "Clear color filter" },
  done: { zh: "完成", en: "Done" },
};

/* ---------------------------------------------------------------- constants */

export const MODE_ALWAYS = 0; // LiteGraph.ALWAYS  — node runs (row open)
export const MODE_NEVER = 2; // LiteGraph.NEVER   — node muted (row closed)
export const MODE_BYPASS = 4; // LiteGraph.BYPASS — node bypassed (row closed)

export const NODE_W = 288;
export const MIN_W = 170; // 手动拖拽时允许的最小宽度
export const ROW_H = 26;
export const FOOT_H = 32;
export const LIST_PAD = 6;

export const MODES = [
  ["free", { zh: "自由", en: "Free" }],
  ["always_one", { zh: "恒定开启一个", en: "Always one on" }],
  ["at_most_one", { zh: "最多一个开启", en: "At most one on" }],
  ["at_least_one", { zh: "至少一个开启", en: "At least one on" }],
];
export const SORTS = [
  ["name", { zh: "按名称", en: "By name" }],
  ["position", { zh: "按位置", en: "By position" }],
  ["state", { zh: "按状态", en: "By state" }],
  ["color", { zh: "按颜色", en: "By color" }],
];
export const CLOSES = [
  ["bypass", { zh: "绕过", en: "Bypass" }],
  ["mute", { zh: "禁用", en: "Mute" }],
];

const DEFAULTS = {
  keyword: "",
  colors: [],
  sort: "name",
  sortReverse: false,
  mode: "free",
  close: "bypass",
  on: null,
};

/* ------------------------------------------------------------------ helpers */

export function normColor(raw) {
  if (typeof raw === "number") return `#${raw.toString(16).padStart(6, "0")}`;
  if (typeof raw !== "string") return "";
  const c = raw.trim();
  if (!c.startsWith("#")) return "";
  if (c.length === 4) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toLowerCase();
  if (c.length >= 7) return c.slice(0, 7).toLowerCase();
  return "";
}

export function gBounds(g) {
  if (g._bounding) return [...g._bounding];
  if (g.bounding) return [...g.bounding];
  const p = g.pos || [0, 0];
  const s = g.size || [0, 0];
  return [p[0], p[1], s[0], s[1]];
}

export function nCenter(n) {
  const p = n.pos || [0, 0];
  if (n.collapsed || n._collapsed) return [p[0] + 30, p[1] + 12];
  const s = n.size || [100, 60];
  return [p[0] + s[0] / 2, p[1] + s[1] / 2];
}

export function pointIn(pt, r) {
  return pt[0] >= r[0] && pt[0] <= r[0] + r[2] && pt[1] >= r[1] && pt[1] <= r[1] + r[3];
}

export function rectIn(inner, outer) {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[0] + inner[2] <= outer[0] + outer[2] &&
    inner[1] + inner[3] <= outer[1] + outer[3]
  );
}

export function nodeActive(n) {
  return n.mode !== MODE_BYPASS && n.mode !== MODE_NEVER && !(n.flags && n.flags.disabled);
}

/* 滚轮一律转交给画布：面板不做内部滚动，缩放手势不该在列表上失效。 */
function forwardWheel(e) {
  const canvasEl = (app.canvas && app.canvas.canvas) || document.querySelector("canvas");
  if (!canvasEl) return;
  e.preventDefault();
  e.stopPropagation();
  canvasEl.dispatchEvent(
    new WheelEvent("wheel", {
      clientX: e.clientX,
      clientY: e.clientY,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      deltaMode: e.deltaMode,
      bubbles: true,
      cancelable: true,
    })
  );
}

/* Every colour below is pulled from the tokens the ComfyUI front end already
   defines, so the panel follows whatever theme is active instead of carrying its
   own palette. Each var keeps a literal fallback for older front ends. */
function cssFor(p) {
  return `
.${p} { box-sizing: border-box; font-family: inherit; font-size: 12px; line-height: 1.45;
  color: var(--node-component-slot-text, #d8d8d8);
  padding: ${LIST_PAD}px; user-select: none; overflow: hidden; }
.${p} * { box-sizing: border-box; }
.${p}-list { overflow: visible; }
.${p}-row { position: relative; display: flex; align-items: center; gap: 10px;
  height: ${ROW_H}px; padding: 0 8px 0 15px; border-radius: 6px; cursor: pointer;
  transition: background .12s ease; }
.${p}-row::before { content: ""; position: absolute; left: 6px; top: 50%;
  transform: translateY(-50%); width: 3px; height: 12px; border-radius: 2px;
  background: var(--${p}-tint, transparent); }
.${p}-row:hover { background: var(--node-component-surface-hovered, #2b2b2b); }
.${p}-name { flex: 1 1 auto; overflow: hidden; white-space: nowrap;
  text-overflow: ellipsis; font-size: 12px; }
.${p}-row.off .${p}-name { color: var(--p-text-muted-color, #8a8a8a); }
.${p}-sw { position: relative; flex: 0 0 auto; width: 32px; height: 18px;
  border-radius: 999px; background: var(--node-component-border, #4a4a4a);
  border: 1px solid var(--node-component-border, #4a4a4a);
  transition: background .15s ease, border-color .15s ease; }
.${p}-sw i { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: var(--node-component-slot-text, #e6e6e6);
  box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .15s ease; }
.${p}-sw.on { background: var(--p-primary-color, #6d9dc5);
  border-color: var(--p-primary-color, #6d9dc5); }
.${p}-sw.on i { transform: translateX(14px); background: #fff; }
.${p}-foot { display: flex; justify-content: center; align-items: center;
  height: ${FOOT_H}px; margin-top: 4px; padding-top: 6px;
  border-top: 1px solid var(--node-divider, #303030); }
.${p}-gear { width: 100%; height: 26px; display: flex; align-items: center;
  justify-content: center; gap: 6px; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 12px;
  background: var(--button-surface, #262626);
  color: var(--button-surface-contrast, #ccc);
  border: 1px solid var(--border-default, #3f3f3f);
  transition: background .12s ease, border-color .12s ease; }
.${p}-gear:hover { background: var(--button-hover-surface, #303030); }
.${p}-gear:active { background: var(--button-active-surface, #3a3a3a); }
.${p}-empty { padding: 10px; text-align: center; color: var(--p-text-muted-color, #777); }
.${p}-hint { margin: -6px 0 10px; font-size: 11px;
  color: var(--p-text-muted-color, #8a8a8a); }
.${p}-mask { position: fixed; inset: 0; z-index: 100000; backdrop-filter: blur(2px);
  background: color-mix(in srgb, #000 55%, transparent); }
.${p}-panel { position: fixed; z-index: 100001; left: 50%; top: 50%;
  transform: translate(-50%, -50%); width: 340px; max-height: 86vh; overflow-y: auto;
  padding: 16px; border-radius: 12px; background: var(--dialog-surface, #1f1f1f);
  border: 1px solid var(--border-default, #3d3d3d);
  box-shadow: 0 16px 48px rgba(0,0,0,.5); color: var(--p-text-color, #ddd);
  font-family: inherit; font-size: 12px; line-height: 1.5; }
.${p}-panel h3 { margin: 0 0 12px; font-size: 13px; font-weight: 600;
  color: var(--p-text-color, #fff); }
.${p}-field { margin-bottom: 12px; }
.${p}-field > span { display: block; margin-bottom: 6px; font-size: 11px;
  color: var(--p-text-muted-color, #9a9a9a); }
.${p}-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.${p}-segbtn { padding: 5px 0; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 12px;
  background: var(--button-surface, #262626);
  color: var(--button-surface-contrast, #bbb);
  border: 1px solid var(--border-default, #3f3f3f);
  transition: background .12s ease, color .12s ease, border-color .12s ease; }
.${p}-segbtn:hover { background: var(--button-hover-surface, #303030); }
.${p}-segbtn.sel { background: var(--p-primary-color, #3b5a75);
  border-color: var(--p-primary-color, #3b5a75); color: #fff; }
.${p}-input { width: 100%; padding: 6px 8px; border-radius: 6px; outline: none;
  font-family: inherit; font-size: 12px;
  background: var(--node-component-widget-input-surface, #141414);
  color: var(--p-text-color, #ddd);
  border: 1px solid var(--p-form-field-border-color, #3f3f3f); }
.${p}-input:focus { border-color: var(--p-primary-color, #4d7ea1);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-primary-color, #4d7ea1) 30%, transparent); }
.${p}-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.${p}-swatch { width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
  border: 1px solid var(--border-default, #3f3f3f); transition: transform .1s ease; }
.${p}-swatch:hover { transform: scale(1.08); }
.${p}-swatch.sel { outline: 2px solid var(--p-primary-color, #6d9dc5); outline-offset: 2px; }
.${p}-none { color: var(--p-text-muted-color, #777); }
.${p}-actions { display: flex; gap: 8px; margin-top: 16px; }
.${p}-actions button { flex: 1 1 0; padding: 7px 0; border-radius: 6px; cursor: pointer;
  font-family: inherit; font-size: 12px;
  border: 1px solid var(--border-default, #3f3f3f);
  background: var(--button-surface, #262626);
  color: var(--button-surface-contrast, #ccc); }
.${p}-actions button:hover { background: var(--button-hover-surface, #303030); }
.${p}-actions button.primary { background: var(--p-primary-color, #3b5a75);
  border-color: var(--p-primary-color, #3b5a75); color: #fff; }
`;
}

function injectCss(prefix) {
  const id = `${prefix}-style`;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = cssFor(prefix);
  document.head.appendChild(el);
}

/* ------------------------------------------------------------ registration */

/* Wires one backend node id to a panel built by `build`. Kept here so both
   control nodes share exactly the same lifecycle hooks. */
export function registerControl({ nodeId, name, settingsLabel, build }) {
  app.registerExtension({
    name,

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (!nodeData || nodeData.name !== nodeId) return;

      const baseCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const out = baseCreated ? baseCreated.apply(this, arguments) : undefined;
        try {
          build(this);
        } catch (err) {
          console.error(`[${name}] panel failed to build`, err);
        }
        return out;
      };

      const baseRemoved = nodeType.prototype.onRemoved;
      nodeType.prototype.onRemoved = function () {
        if (this._ctl) this._ctl.dispose();
        return baseRemoved ? baseRemoved.apply(this, arguments) : undefined;
      };

      const baseMenu = nodeType.prototype.getExtraMenuOptions;
      nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
        const out = baseMenu ? baseMenu.apply(this, arguments) : undefined;
        options.unshift({
          // Resolved here, not at module load: extensions may be imported before
          // the settings store is ready, and the menu is built on demand.
          content: typeof settingsLabel === "function" ? settingsLabel() : settingsLabel,
          callback: () => {
            if (this._ctl) this._ctl.openSettings();
          },
        });
        return out;
      };
    },
  });
}

/* ------------------------------------------------------------------- panel */

/* opts (subject-specific half). Every copy field takes `{ zh, en }` (a plain
   string still works and is shown as-is):
     store             — properties 键前缀，如 "gc" / "nc"
     prefix            — CSS 类名前缀，如 "xxlgc" / "xxlnc"
     settingsTitle     — 设置弹窗标题
     emptyIdle         — 画布上还没有可控制对象时的文案
     emptyFiltered     — 有对象但被筛选条件挡完时的文案
     emptyNoKeyword    — Name keywords 为空时的文案（不列出任何对象）
     unitHint          — (shown, total) => 弹窗提示文案
     keywordLabel      — 关键词字段标题
     keywordPlaceholder
     colorLabel        — 颜色筛选字段标题
     palette           — () => 可选颜色数组
     paletteEmpty      — 无颜色可筛选时的文案
     readAll           — () => items，item = { key, label, match?, tint, state, pos }
     applyItem         — (item, open, closeFlavor) => 写回画布            */
export function createControlPanel(node, opts) {
  const p = opts.prefix;
  injectCss(p);

  let cfg = loadCfg(node);
  let dirty = true;
  let selfEdit = false;
  let all = [];
  let shown = [];
  let alive = true;

  /* 宽度由用户说了算：node.size 随时可能被 litegraph 重算或我们的 render 重写，
     所以把「用户最后认可的宽度」单独存在 properties 里，随工作流一起存档。
     appliedW/H 记录最后一次由本面板写入的尺寸，用来区分「用户改的」和「我们自己写的」。 */
  let appliedW = 0;

  const root = document.createElement("div");
  root.className = p;
  const listEl = document.createElement("div");
  listEl.className = `${p}-list`;
  const footEl = document.createElement("div");
  footEl.className = `${p}-foot`;
  root.appendChild(listEl);
  root.appendChild(footEl);

  /* ---- persistence ---- */

  function prop(key) {
    return `${opts.store}_${key}`;
  }

  function loadCfg(target) {
    const st = target.properties || (target.properties = {});
    const next = { ...DEFAULTS };
    if (typeof st[prop("keyword")] === "string") next.keyword = st[prop("keyword")];
    if (Array.isArray(st[prop("colors")])) next.colors = st[prop("colors")].map(normColor).filter(Boolean);
    if (SORTS.some((s) => s[0] === st[prop("sort")])) next.sort = st[prop("sort")];
    if (typeof st[prop("sortReverse")] === "boolean") next.sortReverse = st[prop("sortReverse")];
    if (MODES.some((m) => m[0] === st[prop("mode")])) next.mode = st[prop("mode")];
    if (st[prop("close")] === "bypass" || st[prop("close")] === "mute") next.close = st[prop("close")];
    if (Array.isArray(st[prop("on")])) next.on = st[prop("on")].slice();
    return next;
  }

  function save() {
    const st = node.properties || (node.properties = {});
    st[prop("keyword")] = cfg.keyword;
    st[prop("colors")] = cfg.colors.slice();
    st[prop("sort")] = cfg.sort;
    st[prop("sortReverse")] = cfg.sortReverse;
    st[prop("mode")] = cfg.mode;
    st[prop("close")] = cfg.close;
    st[prop("on")] = (cfg.on || []).slice();
  }

  function reload() {
    cfg = loadCfg(node);
    dirty = true;
  }

  /* ---- filtering ---- */

  /* 关键词支持多个：仅以分号 `;` 作分隔符，任一命中即显示（OR）。 */
  function keywordList() {
    return (cfg.keyword || "")
      .split(";")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function visibleItems(src) {
    let list = src.slice();
    const kws = keywordList();
    if (kws.length) {
      list = list.filter((it) => {
        const hay = (it.match || it.label || "").toLowerCase();
        return kws.some((k) => hay.includes(k));
      });
    }
    if (cfg.colors.length) {
      const picked = new Set(cfg.colors.map((c) => c.toLowerCase()));
      list = list.filter((it) => it.tint && picked.has(it.tint.toLowerCase()));
    }
    const byName = (a, b) =>
      (a.label || "").localeCompare(b.label || "", undefined, { sensitivity: "base", numeric: true });
    const byPos = (a, b) =>
      (a.pos ? a.pos[1] : 0) - (b.pos ? b.pos[1] : 0) ||
      (a.pos ? a.pos[0] : 0) - (b.pos ? b.pos[0] : 0);
    /* By state：开（在当前 on 集合里）的浮到顶，关的沉底；同状态内按名稳定排序。 */
    const onSet = new Set(cfg.on || []);
    const byState = (a, b) => {
      const ao = onSet.has(a.key) ? 0 : 1;
      const bo = onSet.has(b.key) ? 0 : 1;
      return ao - bo || byName(a, b);
    };
    /* By color：按 tint 十六进制聚类，无颜色（透明）的排到最后；同色按名排序。 */
    const byColor = (a, b) => {
      const ca = (a.tint || "").toLowerCase();
      const cb = (b.tint || "").toLowerCase();
      if (!ca && !cb) return byName(a, b);
      if (!ca) return 1;
      if (!cb) return -1;
      return ca.localeCompare(cb) || byName(a, b);
    };
    const cmp =
      cfg.sort === "position" ? byPos :
      cfg.sort === "state" ? byState :
      cfg.sort === "color" ? byColor : byName;
    list.sort(cmp);
    if (cfg.sortReverse) list.reverse();
    return list;
  }

  /* ---- state resolution ---- */

  function syncOn(list) {
    if (cfg.on === null) {
      cfg.on = list.filter((it) => it.state !== false).map((it) => it.key);
      return true;
    }
    let changed = false;
    const keys = new Set(list.map((it) => it.key));
    const kept = cfg.on.filter((k) => keys.has(k));
    if (kept.length !== cfg.on.length) changed = true;
    cfg.on = kept;
    for (const it of list) {
      if (it.state === null) continue; // 混合状态：不猜用户的意图
      const has = cfg.on.includes(it.key);
      if (it.state === true && !has) {
        cfg.on.push(it.key);
        changed = true;
      } else if (it.state === false && has) {
        cfg.on = cfg.on.filter((k) => k !== it.key);
        changed = true;
      }
    }
    return changed;
  }

  function enforceMode(list) {
    if (cfg.mode === "always_one") {
      if (!list.length) {
        cfg.on = [];
        return;
      }
      /* 留「列表里最靠前的那一个」而不是存档顺序里碰巧第一个，
         这样排序方式一变，保留下来的行仍然是用户看到的第一行。 */
      const onSet = new Set(cfg.on || []);
      const first = list.find((it) => onSet.has(it.key)) || list[0];
      cfg.on = [first.key];
    } else if (cfg.mode === "at_most_one") {
      if (cfg.on.length > 1) {
        const onSet = new Set(cfg.on);
        const first = list.find((it) => onSet.has(it.key));
        cfg.on = [first ? first.key : cfg.on[0]];
      }
    } else if (cfg.mode === "at_least_one") {
      /* 不允许全部关掉：列表非空但 on 为空时，保留排序后最靠前的那一个。 */
      if (list.length && cfg.on.length === 0) cfg.on = [list[0].key];
    }
  }

  function wantsApply(list) {
    const onSet = new Set(cfg.on || []);
    return list.some((it) => it.state !== null && it.state !== onSet.has(it.key));
  }

  function apply(list) {
    const onSet = new Set(cfg.on || []);
    for (const it of list) {
      if (it.state === null) continue;
      const open = onSet.has(it.key);
      if (it.state === open) continue;
      opts.applyItem(it, open, cfg.close);
      it.state = open;
    }
    selfEdit = true;
    try {
      if (app.graph && app.graph.change) app.graph.change();
    } catch (_) {}
    selfEdit = false;
    markCanvas();
  }

  function markCanvas() {
    try {
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
      else if (app.canvas && app.canvas.setDirty) app.canvas.setDirty(true, true);
    } catch (_) {}
  }

  /* ---- rendering ---- */

  /* 高度交给 ComfyUI / DOM 自动：节点高度由面板 DOM 内容的实际渲染高度决定，
     本面板不进行任何 setSize 高度操作，也不把高度存进 properties，从而杜绝
     「刷新一次就涨一点」的反馈循环（强制高度与 DOM 实际高度互相覆盖并被工作流
     存档累积）。宽度仍由用户掌控（见 desiredWidth / node.onResize）。 */

  /* 宽度归用户：litegraph 随时可能重算 node.size，本面板每次 render 也会写尺寸，
     所以「用户最后认可的宽度」必须单独存档，否则一拉宽就被打回默认值。 */
  function desiredWidth() {
    const saved = (node.properties || {})[prop("w")];
    if (typeof saved === "number" && saved >= MIN_W) return saved;
    return NODE_W;
  }

  /* 只改宽度：高度一律不动，留给 ComfyUI 按 DOM 内容自动测量。 */
  function resize() {
    const w = Math.round(desiredWidth());
    if (w === appliedW) return; // 只在宽度真的变了时写，避免重绘抖动
    appliedW = w;
    if (typeof node.setSize === "function" && node.size) {
      node.setSize([w, node.size[1]]);
    } else if (node.size) {
      node.size[0] = w;
    }
    markCanvas();
  }

  function render() {
    listEl.textContent = "";
    footEl.textContent = "";

    if (!keywordList().length) {
      /* Name keywords 为空：不列出任何对象，只给一行提示。 */
      const empty = document.createElement("div");
      empty.className = `${p}-empty`;
      empty.textContent = pick(opts.emptyNoKeyword);
      listEl.appendChild(empty);
    } else if (!shown.length) {
      const empty = document.createElement("div");
      empty.className = `${p}-empty`;
      empty.textContent = all.length ? pick(opts.emptyFiltered) : pick(opts.emptyIdle);
      listEl.appendChild(empty);
    } else {
      const onSet = new Set(cfg.on || []);
      for (const it of shown) {
        const open = onSet.has(it.key);
        const row = document.createElement("div");
        row.className = `${p}-row${open ? "" : " off"}`;
        row.style.setProperty(`--${p}-tint`, it.tint || "transparent");
        row.title = it.tip || it.label;

        const name = document.createElement("div");
        name.className = `${p}-name`;
        name.textContent = it.label;

        const sw = document.createElement("div");
        sw.className = `${p}-sw${open ? " on" : ""}`;
        sw.appendChild(document.createElement("i"));

        row.appendChild(name);
        row.appendChild(sw);
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(it.key);
        });
        row.addEventListener("pointerdown", (e) => e.stopPropagation());
        listEl.appendChild(row);
      }
    }

    const gear = document.createElement("button");
    gear.className = `${p}-gear`;
    gear.type = "button";
    gear.textContent = `⚙ ${pick(UI.settings)}`;
    gear.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    });
    gear.addEventListener("pointerdown", (e) => e.stopPropagation());
    footEl.appendChild(gear);

    resize();
  }

  root.addEventListener("wheel", forwardWheel, { passive: false });

  /* ---- interaction ---- */

  function toggle(key) {
    const open = cfg.on.includes(key);
    if (cfg.mode === "always_one") {
      if (open) return; // one row must stay open
      cfg.on = [key];
    } else if (cfg.mode === "at_most_one") {
      cfg.on = open ? [] : [key];
    } else if (cfg.mode === "at_least_one") {
      if (open && cfg.on.length <= 1) return; // 必须至少留一个开着
      cfg.on = open ? cfg.on.filter((k) => k !== key) : cfg.on.concat([key]);
    } else {
      cfg.on = open ? cfg.on.filter((k) => k !== key) : cfg.on.concat([key]);
    }
    save();
    apply(shown);
    render();
  }

  function refresh(forceApply) {
    all = opts.readAll();
    shown = visibleItems(all);
    const changed = syncOn(shown);
    enforceMode(shown);
    if (changed) save();
    /* Name keywords 为空时面板不列出对象，也不再向画布写任何 mode。 */
    if (keywordList().length && (forceApply || wantsApply(shown))) apply(shown);
    render();
  }

  /* ---- settings dialog ---- */

  // Styled like the front end's own segmented button. The selected option is
  // re-marked in place, so a change never has to rebuild the dialog.
  function segmented(options, getVal, onPick) {
    const wrap = document.createElement("div");
    wrap.className = `${p}-seg`;
    const items = options.map(([val, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `${p}-segbtn`;
      btn.textContent = pick(label);
      btn.addEventListener("click", () => {
        onPick(val);
        sync();
      });
      wrap.appendChild(btn);
      return { val, btn };
    });
    const sync = () => {
      for (const { val, btn } of items) btn.classList.toggle("sel", val === getVal());
    };
    sync();
    return wrap;
  }

  function field(label, control) {
    const row = document.createElement("div");
    row.className = `${p}-field`;
    const cap = document.createElement("span");
    cap.textContent = label;
    row.appendChild(cap);
    row.appendChild(control);
    return row;
  }

  function swatchRow() {
    const wrap = document.createElement("div");
    wrap.className = `${p}-swatches`;
    const palette = [...new Set(opts.palette().map(normColor).filter(Boolean))];
    if (!palette.length) {
      const none = document.createElement("span");
      none.className = `${p}-none`;
      none.textContent = pick(opts.paletteEmpty);
      wrap.appendChild(none);
      return { el: wrap, sync: () => {} };
    }
    const chips = palette.map((color) => {
      const chip = document.createElement("div");
      chip.className = `${p}-swatch`;
      chip.style.background = color;
      chip.title = color;
      chip.addEventListener("click", () => {
        cfg.colors = cfg.colors.includes(color)
          ? cfg.colors.filter((c) => c !== color)
          : cfg.colors.concat([color]);
        sync();
        commit();
      });
      wrap.appendChild(chip);
      return { color, chip };
    });
    function sync() {
      for (const { color, chip } of chips) chip.classList.toggle("sel", cfg.colors.includes(color));
    }
    sync();
    return { el: wrap, sync };
  }

  function openSettings() {
    if (document.querySelector(`.${p}-panel`)) return;

    const mask = document.createElement("div");
    mask.className = `${p}-mask`;
    const panel = document.createElement("div");
    panel.className = `${p}-panel`;

    const title = document.createElement("h3");
    title.textContent = pick(opts.settingsTitle);
    panel.appendChild(title);

    const hint = document.createElement("div");
    hint.className = `${p}-hint`;
    panel.appendChild(hint);

    // Changes take effect at once: the node behind the dialog is refreshed while
    // the dialog stays open, so nothing steals focus mid-edit.
    const commit = () => {
      save();
      refresh(true);
      updateHint();
    };
    const updateHint = () => {
      hint.textContent = pick(opts.unitHint(shown.length, all.length));
    };

    panel.appendChild(
      field(pick(UI.closeMethod), segmented(CLOSES, () => cfg.close, (v) => { cfg.close = v; commit(); }))
    );
    panel.appendChild(
      field(pick(UI.mode), segmented(MODES, () => cfg.mode, (v) => { cfg.mode = v; commit(); }))
    );
    panel.appendChild(
      field(pick(UI.sort), segmented(SORTS, () => cfg.sort, (v) => { cfg.sort = v; commit(); }))
    );
    panel.appendChild(
      field(
        pick(UI.reverse),
        segmented(
          [["off", UI.off], ["on", UI.on]],
          () => (cfg.sortReverse ? "on" : "off"),
          (v) => { cfg.sortReverse = v === "on"; commit(); }
        )
      )
    );

    const kw = document.createElement("input");
    kw.className = `${p}-input`;
    kw.type = "text";
    kw.placeholder = pick(opts.keywordPlaceholder);
    kw.value = cfg.keyword;
    kw.addEventListener("input", () => {
      cfg.keyword = kw.value;
      commit();
    });
    // Keep ComfyUI's global shortcuts (b / m / delete …) out of the text field.
    kw.addEventListener("keydown", (e) => e.stopPropagation());
    panel.appendChild(field(pick(opts.keywordLabel), kw));

    const swatches = swatchRow();
    const colorField = field(pick(opts.colorLabel), swatches.el);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = `${p}-segbtn`;
    clear.style.marginTop = "8px";
    clear.textContent = pick(UI.clearColors);
    clear.addEventListener("click", () => {
      cfg.colors = [];
      swatches.sync();
      commit();
    });
    colorField.appendChild(clear);
    panel.appendChild(colorField);

    const actions = document.createElement("div");
    actions.className = `${p}-actions`;
    const done = document.createElement("button");
    done.type = "button";
    done.className = "primary";
    done.textContent = pick(UI.done);
    done.addEventListener("click", close);
    actions.appendChild(done);
    panel.appendChild(actions);

    function onEsc(e) {
      if (e.key === "Escape") close();
    }
    function close() {
      document.removeEventListener("keydown", onEsc, true);
      mask.remove();
      panel.remove();
    }
    mask.addEventListener("mousedown", (e) => {
      if (e.target === mask) close();
    });
    document.addEventListener("keydown", onEsc, true);
    document.body.appendChild(mask);
    document.body.appendChild(panel);
    updateHint();
    kw.focus();
  }

  /* ---- graph change watch ---- */

  const baseChange = app.graph && app.graph.change;
  if (typeof baseChange === "function") {
    app.graph.change = function () {
      if (!selfEdit) dirty = true;
      return baseChange.apply(this, arguments);
    };
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && ["b", "m", "B", "M"].includes(e.key)) {
      setTimeout(() => {
        dirty = true;
      }, 120);
    }
  }
  function onVis() {
    if (!document.hidden) dirty = true;
  }
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVis);

  const timer = setInterval(() => {
    if (!alive) return;
    if (!node.graph) {
      dispose();
      return;
    }
    if (document.hidden || !dirty) return;
    dirty = false;
    try {
      refresh(false);
    } catch (err) {
      console.error(`[${p}] refresh failed`, err);
    }
  }, 450);

  function dispose() {
    alive = false;
    clearInterval(timer);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVis);
    if (typeof baseChange === "function" && app.graph && app.graph.change !== baseChange) {
      app.graph.change = baseChange;
    }
  }

  /* ---- mount ---- */

  const domWidget = node.addDOMWidget(`${opts.store}_panel`, "custom", root, {
    serialize: false,
    hideOnZoom: false,
  });
  /* 不覆盖 computeSize：让 DOM widget 走 ComfyUI 默认测量（高度跟随内容，由
     _arrangeWidgets 基于 DOM 实际渲染高度决定）——即「交给 ComfyUI 自动控制」。 */

  const hadSaved = Array.isArray((node.properties || {})[prop("on")]);

  /* 手动拖拽节点角落时，litegraph 走 setSize() 并回调 onResize：
     把用户拖出来的宽度记进 properties，下次 render 就用它而不是默认宽度。
     注意必须包住已有实现（addDOMWidget 之类可能也挂了 onResize）。 */
  const baseOnResize = node.onResize;
  node.onResize = function (sz) {
    if (typeof baseOnResize === "function") {
      try {
        baseOnResize.call(this, sz);
      } catch (_) {}
    }
    /* 只记录用户拖出来的宽度；高度交给 ComfyUI 自动，不读不存不回写。 */
    const raw = sz && Math.round(sz[0]);
    if (raw > 0) {
      const w = Math.max(MIN_W, raw);
      if (w !== appliedW) {
        node.properties = node.properties || {};
        node.properties[prop("w")] = w;
        appliedW = 0; // 让下一次 render 把（可能被夹到 MIN_W 的）宽度写回去
        dirty = true;
      }
    }
  };

  /* 载入工作流时 litegraph 在 onNodeCreated 之后才还原 properties 与 node.size，
     所以补一次 configure 钩子：既采信存档尺寸（兼容本次更新之前保存的旧工作流），
     也重新读一遍配置——否则面板会一直用着建节点那一刻的默认值。 */
  const baseConfigure = node.onConfigure;
  node.onConfigure = function (info) {
    if (typeof baseConfigure === "function") {
      try {
        baseConfigure.call(this, info);
      } catch (_) {}
    }
    // 只认存档里显式写下的 size（新建节点没有），避免把 litegraph 的默认值当成用户意图
    const restored = info && info.size && info.size[0];
    if (restored >= MIN_W && typeof node.properties[prop("w")] !== "number") {
      node.properties[prop("w")] = Math.round(restored);
      appliedW = 0;
    }
    reload();
    dirty = true;
  };

  refresh(hadSaved);
  dirty = false;

  // 右键菜单 / 移除节点等生命周期钩子通过这里回到面板实例。
  const api = {
    dispose,
    reload,
    openSettings,
    refresh,
    get cfg() {
      return cfg;
    },
  };
  node._ctl = api;
  return api;
}
