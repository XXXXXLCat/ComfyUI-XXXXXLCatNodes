/**
 * 通用生成节点面板 —— 挂载桥接层（阶段 4）。
 *
 * 单独 IIFE 的原因与 audio-panel/main.js 相同：主 chunk 必须保持与上游 v0.1.3
 * 基线逐字节一致，补丁插件才会放行。所以这里用 createApp() 把官方组件挂到每个
 * 有内容的 .node-panel，原上游控件保留在 DOM 里但由 CSS 收起（影子控件），
 * 交互写回它们并派发 input / change / click，Vue Flow 会当成真实用户输入。
 *
 * 覆盖范围：所有 role !== "gen-audio" 且 .node-panel 里有 .panel-prompt /
 * .panel-fields 的节点。asset-* 的空面板与 lora 栈（各自另有面板）都跳过。
 */
import { createApp, reactive } from "vue";
import XcatNodePanel from "./XcatNodePanel.vue";

const PANEL_CLS = "xcat-np";

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
  try { return (window.__xcatRole ? window.__xcatRole(node.data) : "") || ""; }
  catch (e) { return ""; }
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
  const row = { el, key, label, type: "number", min: undefined, max: undefined, step: undefined };

  let ctrl = null;
  if ((ctrl = el.querySelector(":scope > textarea.panel-text"))) {
    row.type = "textarea";
  } else if ((ctrl = el.querySelector(":scope > input.panel-input-wide"))) {
    row.type = "text";
  } else if ((ctrl = el.querySelector(":scope > .panel-slider"))) {
    row.type = "slider";
    ctrl = ctrl.querySelector("input[type=range]");
  } else if ((ctrl = el.querySelector(":scope > select.panel-select"))) {
    row.type = "select";
    row.options = [];
    for (let i = 0; i < ctrl.options.length; i += 1) row.options.push(ctrl.options[i].value);
  } else if ((ctrl = el.querySelector(":scope > .panel-switch"))) {
    row.type = "switch";
    ctrl = ctrl.querySelector("input[type=checkbox]");
  } else if ((ctrl = el.querySelector(":scope > .panel-random"))) {
    row.type = "random";
    row.dice = ctrl.querySelector(".panel-dice");
    ctrl = ctrl.querySelector("input.panel-input");
  } else {
    ctrl = el.querySelector(":scope > input.panel-input");
  }
  row.ctrl = ctrl;
  if (ctrl) {
    ["min", "max", "step"].forEach((attr) => {
      const v = ctrl.getAttribute(attr);
      if (v != null) row[attr] = v;
    });
  }
  return row;
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
  const box = panel.querySelector(":scope > .panel-workflows");
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
function shortName(name, group) {
  if (group && name.indexOf(group + "-") === 0) return name.slice(group.length + 1);
  return name;
}
function signature(panel, fields) {
  return JSON.stringify({
    keys: fields.map((f) => `${f.key}:${f.type}:${f.label}`),
    prompt: !!panel.querySelector(":scope > .panel-prompt > textarea"),
  });
}

/* ------------------------------------------------------------ 状态构造 */
function collect(panel) {
  const fields = fieldsOf(panel);
  const rows = fields.map((f) => ({
    key: f.key,
    label: f.label || f.key,
    type: f.type,
    value: f.type === "switch" ? !!(f.ctrl && f.ctrl.checked) : String((f.ctrl && f.ctrl.value) || ""),
    options: f.options || [],
    min: f.min, max: f.max, step: f.step,
    random: !!(f.dice && f.dice.classList.contains("is-on")),
  }));

  const state = reactive({
    promptText: "",
    promptReadonly: false,
    fields: rows,
    hint: null,
    workflows: [],
    activeWorkflow: undefined,
    runLabel: "运行",
    runDisabled: false,
    runStop: false,
    error: "",
  });

  const refs = { map: new Map() };
  fields.forEach((f, i) => refs.map.set(rows[i].key, { field: f, ctrl: f.ctrl, dice: f.dice }));

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
    setPrompt(v) {
      s.promptText = v == null ? "" : String(v);
      const src = st.panel.querySelector(":scope > .panel-prompt > textarea.panel-text");
      writeText(src, s.promptText);
    },
    setField(row, v) {
      const ref = r.map.get(row.key);
      if (!ref) return;
      if (row.type === "switch") {
        row.value = !!v;
        if (ref.ctrl) {
          ref.ctrl.checked = row.value;
          fire(ref.ctrl, "change");
        }
        return;
      }
      row.value = v == null ? "" : String(v);
      if (row.type === "random" && row.random) return;
      writeText(ref.ctrl, row.value);
      if (row.type === "select") writeSelect(ref.ctrl, row.value);
    },
    toggleRandom(row) {
      const ref = r.map.get(row.key);
      if (!ref || !ref.dice) return;
      click(ref.dice);
      window.setTimeout(() => sync(st), 60);
    },
    pickWorkflow(name) {
      if (!name) return;
      const pill = pillsOf(st.panel).find((p) => p.name === name);
      if (!pill) return;
      click(pill.el);
      window.setTimeout(() => sync(st), 80);
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

  const prompt = panel.querySelector(":scope > .panel-prompt > textarea.panel-text");
  if (st.editing !== "prompt" && prompt) s.promptText = prompt.value || "";
  if (prompt) s.promptReadonly = !!prompt.readOnly;

  const pills = pillsOf(panel);
  s.workflows = pills.map((p) => ({ name: p.name, label: shortName(p.name, p.group), group: p.group }));
  s.activeWorkflow = (pills.find((p) => p.active) || {}).name;

  const hint = panel.querySelector(":scope > .panel-hint");
  s.hint = hint ? (hint.textContent || "").trim() : null;
  const err = panel.querySelector(":scope > .panel-error");
  s.error = err ? (err.textContent || "").trim() : "";

  const run = panel.querySelector(":scope > .panel-row > .panel-run");
  if (run) {
    s.runLabel = (run.textContent || "").trim() || "运行";
    s.runDisabled = !!run.disabled;
    s.runStop = run.classList.contains("is-stop");
  }

  s.fields.forEach((row) => {
    const ref = r.map.get(row.key);
    if (!ref || !ref.ctrl) return;
    if (row.type === "switch") {
      row.value = !!ref.ctrl.checked;
    } else if (row.type === "random") {
      row.random = !!(ref.dice && ref.dice.classList.contains("is-on"));
      if (st.editing !== row.key) row.value = String(ref.ctrl.value || "");
    } else if (st.editing !== row.key) {
      row.value = String(ref.ctrl.value || "");
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
  host.className = "xcat-np-host";
  panel.appendChild(host);
  const st = {
    panel, host, app: null,
    refs: data.refs, state: data.state, sig: data.sig, editing: "",
  };
  st.actions = makeActions(st);
  st.app = createApp(XcatNodePanel, { state: st.state, actions: st.actions });
  st.app.mount(host);
  mounts.set(panel, st);
  sync(st);
  return st;
}
function ensure(panel) {
  const role = roleOf(panel);
  const hasControls = !!(
    panel.querySelector(":scope > .panel-prompt > textarea.panel-text") ||
    panel.querySelector(":scope > .panel-fields")
  );
  const st = mounts.get(panel);
  // gen-audio 由专门的音频面板接管；空面板（asset-* / lora）不挂
  if (role === "gen-audio" || !role || !hasControls) {
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

if (!window.__xcatNodePanelInstalled) {
  window.__xcatNodePanelInstalled = true;
  observe();
}
