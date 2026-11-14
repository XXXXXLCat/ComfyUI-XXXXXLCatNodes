/**
 * 资产弹层侧栏 —— 挂载桥接层（阶段 5）。
 *
 * 上游 NodeActions.vue 把编辑弹层 Teleport 到 body，所以它不在 #app 里，
 * 也不受节点面板那套挂载器管辖。这里单独盯 body：
 *   - .asset-panel 右上角的 .asset-close → 官方 Button(ghost/icon-sm) + X 图标
 *   - .side-tools 里 6 枚 .tool-btn    → 官方 Button(ghost|secondary) + lucide 图标
 *
 * 原生按钮保留为影子控件，点击转发回它们；模式切换 / 预览 / 下载等业务
 * 完全走上游 Vue。参数区 .side-controls 与编辑器 Teleport 目标一律不碰
 * （它有 :empty 规则，插 host 会让空态凭空多一个框）。
 */
import { createApp, reactive } from "vue";
import XcatAssetDialog from "./XcatAssetDialog.vue";

const mounts = new Map();

function unmount(st) {
  if (!st) return;
  try { if (st.app) st.app.unmount(); } catch (e) { /* noop */ }
  if (st.host && st.host.parentNode) st.host.parentNode.removeChild(st.host);
  st.app = null;
  st.host = null;
}

function mountOn(container, mode) {
  const host = document.createElement("div");
  host.className = mode === "close" ? "xcat-ad-close-host" : "xcat-ad-tools-host";
  container.appendChild(host);

  const st = {
    container, host, mode, app: null,
    shadow: new Map(),
    state: reactive({ tools: [] }),
  };
  st.actions = {
    onClick(e) {
      const t = e.target && e.target.closest ? e.target.closest("[data-key]") : null;
      if (!t || !host.contains(t)) return;
      const el = st.shadow.get(t.getAttribute("data-key"));
      if (!el || !el.isConnected) return;
      el.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, view: window,
      }));
    },
  };
  st.app = createApp(XcatAssetDialog, { mode, state: st.state, actions: st.actions });
  st.app.mount(host);
  return st;
}

function toolsOf(box) {
  const els = box.querySelectorAll(":scope > .tool-btn");
  const shadow = new Map();
  const rows = [];
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i];
    const label = ((el.textContent || "").trim() || el.getAttribute("title") || "").trim();
    if (!label) continue;
    const key = label + "|" + i;
    shadow.set(key, el);
    rows.push({
      key,
      label,
      disabled: !!el.disabled,
      active: el.classList.contains("is-active"),
    });
  }
  return { shadow, rows };
}

function closeOf(panel) {
  const el = panel.querySelector(":scope > .asset-close");
  return { shadow: new Map([["__close", el]]), rows: [] };
}

function ensure(container, mode, scan) {
  if (!container.isConnected) return;
  let st = mounts.get(container);
  if (!st || !st.host || !st.host.isConnected) {
    if (st) unmount(st);
    st = mountOn(container, mode);
    mounts.set(container, st);
  }
  const data = scan();
  st.shadow = data.shadow;
  st.state.tools = data.rows;
  container.classList.add(mode === "close" ? "xcat-ad-close-on" : "xcat-ad-tools-on");
}

function sweep() {
  const mask = document.querySelector(".asset-mask");
  for (const [container, st] of mounts) {
    if (!mask || !container.isConnected || !mask.contains(container)) {
      unmount(st);
      mounts.delete(container);
    }
  }
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  window.setTimeout(() => {
    pending = false;
    sweep();
    const mask = document.querySelector(".asset-mask");
    if (!mask) return;
    const panel = mask.querySelector(".asset-panel");
    if (!panel) return;
    try { ensure(panel, "close", () => closeOf(panel)); } catch (e) { /* noop */ }
    const tools = panel.querySelector(".side-tools");
    if (tools) {
      try { ensure(tools, "tools", () => toolsOf(tools)); } catch (e) { /* noop */ }
    }
  }, 0);
}

function observe() {
  // 只盯 childList：自己往容器写的是 class，监听 class 会自激。
  // .tool-btn 的 is-active 是 class 变化，靠下面的定时重扫同步。
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.setInterval(schedule, 300);
  schedule();
}

if (!window.__xcatAssetDialogInstalled) {
  window.__xcatAssetDialogInstalled = true;
  observe();
}
