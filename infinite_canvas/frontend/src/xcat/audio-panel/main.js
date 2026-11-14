/**
 * 生成音频节点面板 —— 挂载桥接层（阶段 3）。
 *
 * 为什么是「独立 Vue app」而不是主应用里的子组件：
 * 画布应用主体 src/xcat/app/canvas-app.js 是上游 v0.1.3 的固化模块，与
 * src/components/ 下的参考 SFC 不在同一棵组件树里。新面板用
 * vite.panel.config.js 单独打成 IIFE，由 index.html 以 <script defer> 引入，
 * 通过影子控件桥接读写上游 DOM，自带一份 Vue runtime，与主体零耦合。
 * 阶段 11 / batch 5 后补丁插件已退役，但这层隔离依然保留：面板可以独立
 * 迭代、独立构建，不必改动固化应用。
 *
 * 与上游状态的连接沿用「影子控件」：.node-panel 里原有的 .panel-prompt /
 * .panel-fields / .panel-workflows / .panel-row 由 xcat-overrides.css 隐藏（DOM 不销毁），
 * 交互时把值写回这些控件并派发 input / change / click，Vue Flow 会当成真实用户输入；
 * 上游状态变化（切工作流、种子刷新、运行按钮文案）由 400ms 轮询同步回 reactive state。
 * 注意：DOM 引用一律放在 st.refs（普通对象），绝不塞进 reactive state —— Vue 会深度
 * 代理普通对象，DOM 元素被代理后 dispatchEvent 会因 Illegal invocation 抛错。
 */
import { createApp, reactive } from "vue";
import XcatAudioPanel from "./XcatAudioPanel.vue";

const PANEL_CLS = "xcat-audio";

function flow() {
  try { return window.__xcatFlow || null; } catch (e) { return null; }
}

function nodeOf(el) {
  const host = el.closest && el.closest(".vue-flow__node");
  if (!host) return null;
  const f = flow();
  if (!f || !f.getNodes) return null;
  const id = host.getAttribute("data-id");
  const list = f.getNodes.value || [];
  for (let i = 0; i < list.length; i += 1) {
    if (String(list[i].id) === id) return list[i];
  }
  return null;
}

function roleOf(el) {
  const node = nodeOf(el);
  if (!node) return "";
  try {
    return (window.__xcatRole ? window.__xcatRole(node.data) : "") || "";
  } catch (e) { return ""; }
}

/* ------------------------------------------------------------ 影子控件写入 */
function fire(el, type) {
  if (!el) return;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}
function click(el) {
  if (!el) return;
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
}
function writeText(src, value) {
  if (!src) return;
  const text = String(value == null ? "" : value);
  if (src.value === text) return;
  src.value = text;
  fire(src, "input");
}
function writeSelect(src, value) {
  if (!src) return;
  const text = String(value == null ? "" : value);
  if (src.value === text) return;
  src.value = text;
  fire(src, "change");
}

/* ------------------------------------------------------------ 字段 / 工作流扫描 */
function readField(el) {
  const labelEl = el.querySelector(".panel-field-label");
  const title = (labelEl && labelEl.getAttribute("title")) || "";
  const parts = title.split(" ");
  const key = parts.length > 1 ? parts[parts.length - 1] : "";
  const label = labelEl ? (labelEl.textContent || "").trim() : key;
  let kind = "number";
  let ctrl = null;
  const text = el.querySelector(":scope > textarea.panel-text");
  if (text) {
    kind = "text";
    ctrl = text;
  } else if ((ctrl = el.querySelector(":scope > .panel-random"))) {
    kind = "random";
  } else if ((ctrl = el.querySelector(":scope > select.panel-select"))) {
    kind = "select";
  } else if ((ctrl = el.querySelector(":scope > .panel-switch"))) {
    kind = "switch";
  } else if ((ctrl = el.querySelector(":scope > input.panel-input-wide"))) {
    kind = "text";
  } else if ((ctrl = el.querySelector(":scope > input.panel-input"))) {
    kind = "number";
  }
  return { el, key, label, kind, ctrl };
}

function fieldsOf(panel) {
  const box = panel.querySelector(":scope > .panel-fields");
  const out = [];
  if (!box) return out;
  for (let i = 0; i < box.children.length; i += 1) {
    const el = box.children[i];
    if (el.classList && el.classList.contains("panel-field")) out.push(readField(el));
  }
  return out;
}

function pillsOf(panel) {
  const box = panel.querySelector(".panel-workflows");
  const out = [];
  if (!box) return out;
  let group = "";
  for (let i = 0; i < box.children.length; i += 1) {
    const el = box.children[i];
    if (!el.classList || !el.classList.contains("wf-pill")) continue;
    const name = (el.textContent || "").trim();
    if (el.classList.contains("xcat-wf-pill-g")) { group = name; continue; }
    out.push({ name, group, active: el.classList.contains("is-active"), el });
  }
  return out;
}

function splitOptions(options) {
  const formats = [];
  const byFormat = {};
  (options || []).forEach((raw) => {
    const value = String(raw);
    const at = value.indexOf(":");
    const format = at < 0 ? value : value.slice(0, at);
    const quality = at < 0 ? "" : value.slice(at + 1);
    if (!byFormat[format]) { byFormat[format] = []; formats.push(format); }
    if (quality) byFormat[format].push(quality);
  });
  return { formats, byFormat };
}

function shortName(name, group) {
  if (group && name.indexOf(group + "-") === 0) return name.slice(group.length + 1);
  return name;
}

function signature(panel, fields) {
  return JSON.stringify({
    keys: fields.map((f) => `${f.key}:${f.kind}:${f.label}`),
    prompt: !!panel.querySelector(":scope > .panel-prompt > textarea"),
  });
}

/* ------------------------------------------------------------ 状态构造 */
function collect(panel) {
  const fields = fieldsOf(panel);
  let lyrics = null;
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].kind === "text") { lyrics = fields[i]; break; }
  }
  const settings = fields.filter((f) => f !== lyrics);
  const rowRank = { max_duration: 0, seed: 1, format: 2 };
  settings.sort((a, b) => {
    const ra = rowRank[a.key] == null ? 9 : rowRank[a.key];
    const rb = rowRank[b.key] == null ? 9 : rowRank[b.key];
    return ra - rb;
  });

  const refs = {
    styleSrc: panel.querySelector(":scope > .panel-prompt > textarea"),
    lyricsSrc: lyrics ? lyrics.ctrl : null,
    runSrc: null,
    settingMap: new Map(),
  };

  const state = reactive({
    styleText: "",
    lyricsText: "",
    hasLyrics: !!lyrics,
    lyricsLabel: lyrics && lyrics.label ? lyrics.label : "歌词",
    mode: "music",
    workflows: [],
    activeWorkflow: undefined,
    settings: [],
    runLabel: "运行",
    runDisabled: false,
    runStop: false,
  });

  settings.forEach((field) => {
    if (field.kind === "text") return;
    const row = {
      key: field.key,
      label: field.label || field.key,
      kind: field.kind,
      value: "",
      min: undefined,
      max: undefined,
      step: undefined,
      random: false,
      formats: [],
      qualities: [],
      fmt: "",
      quality: "",
    };
    const ref = { field, src: field.ctrl };

    if (field.kind === "random") {
      const input = field.ctrl && field.ctrl.querySelector("input");
      ref.seedInput = input;
      ref.dice = field.ctrl && field.ctrl.querySelector(".panel-dice");
      if (input) {
        row.min = input.getAttribute("min") || "0";
        row.max = input.getAttribute("max") || undefined;
        row.step = input.getAttribute("step") || "1";
      }
    } else if (field.kind === "select") {
      const values = [];
      const src = field.ctrl;
      if (src) for (let i = 0; i < src.options.length; i += 1) values.push(src.options[i].value);
      const split = splitOptions(values);
      ref.split = split;
      row.kind = "format";
      row.formats = split.formats.slice();
    } else if (field.kind === "switch") {
      ref.check = field.ctrl && field.ctrl.querySelector("input[type=checkbox]");
    } else {
      const src = field.ctrl;
      if (src) {
        ["min", "max", "step"].forEach((attr) => {
          const v = src.getAttribute(attr);
          if (v != null) row[attr] = v;
        });
      }
    }

    refs.settingMap.set(field.key, ref);
    state.settings.push(row);
  });

  return { fields, refs, state, sig: signature(panel, fields) };
}

/* ------------------------------------------------------------ 交互 → 影子控件 */
function makeActions(st) {
  const s = st.state;
  const r = st.refs;
  return {
    setEditing(field, on) {
      st.editing = on ? field : (st.editing === field ? "" : st.editing);
    },
    setStyle(v) {
      s.styleText = v == null ? "" : String(v);
      writeText(r.styleSrc, s.styleText);
    },
    setLyrics(v) {
      s.lyricsText = v == null ? "" : String(v);
      writeText(r.lyricsSrc, s.lyricsText);
    },
    setMode(m) {
      const mode = m === "voice" ? "voice" : "music";
      s.mode = mode;
      const node = nodeOf(st.panel);
      if (!node) return;
      try {
        if (node.data) node.data.audioMode = mode;
        const f = flow();
        if (f && f.updateNodeData) f.updateNodeData(node.id, { audioMode: mode });
      } catch (e) { /* 节点刚被删除时忽略 */ }
    },
    pickWorkflow(name) {
      if (!name) return;
      const pill = pillsOf(st.panel).find((p) => p.name === name);
      if (!pill) return;
      click(pill.el);
      window.setTimeout(() => sync(st, true), 80);
    },
    setNumber(row, v) {
      row.value = v == null ? "" : String(v);
      const ref = r.settingMap.get(row.key);
      if (ref) writeText(ref.src, row.value);
    },
    setSeed(row, v) {
      row.value = v == null ? "" : String(v);
      if (row.random) return;
      const ref = r.settingMap.get(row.key);
      if (ref) writeText(ref.seedInput, row.value);
    },
    toggleRandom(row) {
      const ref = r.settingMap.get(row.key);
      if (!ref || !ref.dice) return;
      click(ref.dice);
      window.setTimeout(() => sync(st, true), 60);
    },
    setFormat(row, fmt) {
      row.fmt = fmt;
      const ref = r.settingMap.get(row.key);
      const list = ref && ref.split ? (ref.split.byFormat[fmt] || []) : [];
      row.qualities = list.slice();
      row.quality = row.qualities[0] || "";
      if (ref) writeSelect(ref.src, row.quality ? `${row.fmt}:${row.quality}` : row.fmt);
    },
    setQuality(row, q) {
      row.quality = q;
      const ref = r.settingMap.get(row.key);
      if (ref) writeSelect(ref.src, q ? `${row.fmt}:${q}` : row.fmt);
    },
    setSwitch(row, v) {
      row.value = !!v;
      const ref = r.settingMap.get(row.key);
      if (!ref || !ref.check) return;
      if (ref.check.checked !== row.value) {
        ref.check.checked = row.value;
        fire(ref.check, "change");
      }
    },
    run() {
      const btn = st.panel.querySelector(":scope > .panel-row > .panel-run");
      if (btn && !btn.disabled) click(btn);
    },
  };
}

/* ------------------------------------------------------------ 上游状态 → state */
function sync(st) {
  const panel = st.panel;
  if (!panel || !panel.isConnected || !st.app) return;
  const s = st.state;
  const r = st.refs;

  if (st.editing !== "style" && r.styleSrc) s.styleText = r.styleSrc.value || "";
  if (st.editing !== "lyrics" && r.lyricsSrc) s.lyricsText = r.lyricsSrc.value || "";

  const node = nodeOf(panel);
  s.mode = (node && node.data && node.data.audioMode) === "voice" ? "voice" : "music";

  const pills = pillsOf(panel);
  s.workflows = pills.map((p) => ({
    name: p.name,
    label: shortName(p.name, p.group),
    group: p.group,
  }));
  s.activeWorkflow = (pills.find((p) => p.active) || {}).name;

  const runSrc = panel.querySelector(":scope > .panel-row > .panel-run");
  r.runSrc = runSrc;
  if (runSrc) {
    s.runLabel = (runSrc.textContent || "").trim() || "运行";
    s.runDisabled = !!runSrc.disabled;
    s.runStop = runSrc.classList.contains("is-stop");
  }

  s.settings.forEach((row) => {
    const ref = r.settingMap.get(row.key);
    if (!ref) return;
    if (row.kind === "random") {
      const input = ref.seedInput;
      const dice = ref.dice;
      row.random = !!(dice && dice.classList.contains("is-on"));
      if (st.editing !== row.key) row.value = input ? String(input.value || "") : "";
      row.readOnly = !!(input && input.readOnly);
    } else if (row.kind === "format") {
      const src = ref.src;
      const value = (src && src.value) || "";
      const at = value.indexOf(":");
      row.fmt = at < 0 ? value : value.slice(0, at);
      const q = at < 0 ? "" : value.slice(at + 1);
      row.qualities = ref.split ? (ref.split.byFormat[row.fmt] || []).slice() : [];
      row.quality = q || row.qualities[0] || "";
    } else if (row.kind === "switch") {
      row.value = !!(ref.check && ref.check.checked);
    } else {
      if (st.editing !== row.key) row.value = ref.src ? String(ref.src.value || "") : "";
    }
  });
}

/* ------------------------------------------------------------ 挂载 / 卸载 */
const mounts = new WeakMap();

function unmount(st) {
  if (!st) return;
  try { if (st.app) st.app.unmount(); } catch (e) { /* noop */ }
  if (st.host && st.host.parentNode) st.host.parentNode.removeChild(st.host);
  st.app = null;
  st.host = null;
}

function mount(panel, old) {
  const data = collect(panel);
  if (old) unmount(old);

  const host = document.createElement("div");
  host.className = "xcat-ap-host";
  panel.appendChild(host);

  const st = {
    panel,
    host,
    app: null,
    refs: data.refs,
    state: data.state,
    sig: data.sig,
    editing: "",
  };
  st.actions = makeActions(st);

  const app = createApp(XcatAudioPanel, { state: st.state, actions: st.actions });
  app.mount(host);
  st.app = app;
  mounts.set(panel, st);
  sync(st);
  return st;
}

function ensure(panel) {
  const role = roleOf(panel);
  const st = mounts.get(panel);
  if (role !== "gen-audio") {
    unmount(st);
    panel.classList.remove(PANEL_CLS);
    mounts.delete(panel);
    return;
  }
  panel.classList.add(PANEL_CLS);
  const fields = fieldsOf(panel);
  const sig = signature(panel, fields);
  const editing = st && st.editing;
  if (!st || !st.host || !st.host.isConnected || (!editing && sig !== st.sig)) {
    if (!editing) { mount(panel, st); return; }
  }
  sync(st);
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  window.setTimeout(() => {
    pending = false;
    const list = document.querySelectorAll("#app .node-panel");
    for (let i = 0; i < list.length; i += 1) {
      try { ensure(list[i]); } catch (e) { /* 单个面板出错不影响其它 */ }
    }
  }, 0);
}

function observe() {
  const host = document.querySelector("#app .vue-flow") || document.querySelector(".vue-flow");
  if (!host) { window.setTimeout(observe, 300); return; }
  new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
  window.setInterval(schedule, 400);
  schedule();
}

if (!window.__xcatAudioPanelInstalled) {
  window.__xcatAudioPanelInstalled = true;
  observe();
}
