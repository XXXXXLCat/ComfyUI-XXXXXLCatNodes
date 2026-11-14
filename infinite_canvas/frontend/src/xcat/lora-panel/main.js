/**
 * 画布「LoRA 栈」面板 —— 挂载桥接层（阶段 4）。
 *
 * 旧 assets/xcat-lora.js 不改动：它继续维护 data.loras 的签名 / 撤销栈，并提供
 * 运行时必需的 window.__xcatLorasFor()。这里新建一个同样带 .xcat-lora-body 的
 * 兄弟容器（多加 .xcat-lora-vue），把官方组件挂进去；旧容器由 CSS 收起。
 * 节点高度改用 --xcat-lora-vh，避免被旧脚本的 fitHeight() 覆盖回 270。
 */
import { createApp, reactive } from "vue";
import XcatLoraPanel from "./XcatLoraPanel.vue";

const HOST_CLASS = "xcat-lora-body xcat-lora-vue nopan";
const MAX_ROWS = 20;
const MIN_H = 270;

function flow() {
  try { return window.__xcatFlow || null; } catch (e) { return null; }
}
function nodeById(id) {
  const f = flow();
  if (!f || !f.getNodes) return null;
  return (f.getNodes.value || []).find((n) => String(n.id) === String(id)) || null;
}
function role(node) {
  try { return (window.__xcatRole ? window.__xcatRole(node.data) : "") || ""; }
  catch (e) { return ""; }
}
function loraList(node) {
  if (!node || !node.data) return [];
  if (!Array.isArray(node.data.loras)) node.data.loras = [];
  return node.data.loras;
}
function clone(rows) {
  return JSON.parse(JSON.stringify(rows));
}
function clamp(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return Math.max(-100, Math.min(100, Math.round(n * 100) / 100));
}

const mounts = new Map();   // nodeId -> mount state

function unmount(st) {
  if (!st) return;
  try { if (st.app) st.app.unmount(); } catch (e) { /* noop */ }
  if (st.host && st.host.parentNode) st.host.parentNode.removeChild(st.host);
  st.app = null;
  st.host = null;
}

/* 节点高度跟着行数长：临时把绝对定位的面板设为 height:auto 量出自然高度 */
function fit(st) {
  const host = st.host;
  if (!host || !host.isConnected) return;
  const demo = host.parentElement && host.parentElement.querySelector(".demo-node");
  if (!demo) return;
  host.style.height = "auto";
  const natural = host.offsetHeight;
  host.style.height = "";
  const h = Math.max(MIN_H, Math.round(natural) || MIN_H);
  demo.style.setProperty("--xcat-lora-vh", `${h}px`);
}

function save(st, refit) {
  const node = nodeById(st.id);
  if (!node) return;
  const rows = clone(st.state.rows);
  const f = flow();
  try {
    if (f && f.updateNodeData) f.updateNodeData(st.id, { loras: rows });
  } catch (e) { /* 节点刚被删除 */ }
  st.sig = JSON.stringify(rows);
  if (refit) window.setTimeout(() => fit(st), 0);
}

function makeActions(st) {
  const s = st.state;
  return {
    add() {
      if (s.rows.length >= MAX_ROWS) return;
      s.rows.push({ name: "", strength: 1, enabled: true });
      save(st, true);
    },
    remove(i) {
      if (i < 0 || i >= s.rows.length) return;
      s.rows.splice(i, 1);
      save(st, true);
    },
    setName(i, name) {
      const row = s.rows[i];
      if (!row) return;
      row.name = String(name || "");
      save(st, false);
    },
    setEnabled(i, on) {
      const row = s.rows[i];
      if (!row) return;
      row.enabled = !!on;
      save(st, false);
    },
    setStrength(i, v) {
      const row = s.rows[i];
      if (!row) return;
      row.strength = clamp(v);
      save(st, false);
    },
    stepStrength(i, delta) {
      const row = s.rows[i];
      if (!row) return;
      row.strength = clamp(Number(row.strength || 0) + delta);
      save(st, false);
    },
  };
}

async function loadOptions(st) {
  st.state.loading = true;
  try {
    // 旧脚本暴露的 load() 带缓存，和 ComfyUI 自己的下拉同源
    const list = window.__xcatLoraNode && window.__xcatLoraNode.load
      ? await window.__xcatLoraNode.load()
      : await fetch("/object_info/LoraLoaderModelOnly")
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const info = d && d.LoraLoaderModelOnly;
            const opts = info && info.input && info.input.required && info.input.required.lora_name;
            return (opts && opts[0]) || [];
          });
    st.state.options = Array.isArray(list) ? list.slice() : [];
  } catch (e) {
    st.state.options = [];
  } finally {
    st.state.loading = false;
  }
}

function mount(nodeEl, id) {
  const node = nodeById(id);
  if (!node) return;
  const host = document.createElement("div");
  host.className = HOST_CLASS;
  nodeEl.appendChild(host);

  const state = reactive({
    rows: clone(loraList(node)),
    options: [],
    loading: false,
    maxRows: MAX_ROWS,
  });
  const st = { id, host, app: null, state, sig: JSON.stringify(state.rows) };
  st.actions = makeActions(st);
  st.app = createApp(XcatLoraPanel, { state, actions: st.actions });
  st.app.mount(host);
  mounts.set(id, st);
  loadOptions(st);
  window.setTimeout(() => fit(st), 60);
}

function sync(st) {
  const node = nodeById(st.id);
  if (!node || !st.host) return;
  const rows = clone(loraList(node));
  const sig = JSON.stringify(rows);
  if (sig !== st.sig) {
    st.sig = sig;
    // 外部改动（撤销 / 加载画布 / 粘贴）才整体替换，编辑中的输入不打断
    if (!st.host.contains(document.activeElement)) {
      st.state.rows.splice(0, st.state.rows.length, ...rows);
      window.setTimeout(() => fit(st), 0);
    }
  }
}

function sweep() {
  const nodes = document.querySelectorAll("#app .vue-flow__node");
  const alive = new Set();
  for (let i = 0; i < nodes.length; i += 1) {
    const el = nodes[i];
    const id = el.getAttribute("data-id");
    if (!id) continue;
    const node = nodeById(id);
    if (!node || role(node) !== "lora") continue;
    alive.add(id);
    if (!el.querySelector(":scope > .xcat-lora-vue")) mount(el, id);
    else sync(mounts.get(id));
  }
  for (const [id, st] of mounts) {
    if (!alive.has(id)) { unmount(st); mounts.delete(id); }
  }
}

function observe() {
  const root = document.querySelector("#app .vue-flow") || document.querySelector(".vue-flow");
  if (!root) { window.setTimeout(observe, 300); return; }
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    window.setTimeout(() => { pending = false; sweep(); }, 0);
  };
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  window.setInterval(sweep, 500);
  sweep();
}

if (!window.__xcatLoraPanelVueInstalled) {
  window.__xcatLoraPanelVueInstalled = true;
  observe();
}
