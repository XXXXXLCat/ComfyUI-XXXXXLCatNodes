/**
 * 节点上方操作按钮行 —— 挂载桥接层（阶段 5）。
 *
 * 目标：把 4 种 asset-* 节点（以及所有其它节点）上方那排由上游 Vue +
 * xcat 脚本拼出来的「自绘文字按钮」换成 shadcn-vue 官方组件，同时不触碰
 * 任何业务逻辑：
 *
 *   1. 扫描 .node-actions 的直接子级 .fan-btn，读 title / disabled / CSS order；
 *   2. 按 order 分成「操作 / 下载 / 删除」三组，交给 XcatAssetActions.vue
 *      用官方 Button + Separator 重画；
 *   3. 原生按钮保留在 DOM 里（CSS 收起），点击时把 MouseEvent 转发过去，
 *      预览 / 下载 / 截取 / 抽帧 / 删除等逻辑仍走各自的原实现。
 *
 * 难点：上游 NodeActions.vue 用 v-if 控制整条 .node-actions，鼠标进出节点时
 * 容器会被反复销毁重建；xcat-media-core.js / video-edit / image-tools 等脚本
 * 又会在容器里 append 自己的按钮，还会按素材类型改 inline display。所以这里
 * 用 MutationObserver + 定时兜底持续重扫，容器失联时卸载旧 app，避免泄漏。
 */
import { createApp, reactive } from "vue";
import XcatAssetActions from "./XcatAssetActions.vue";

const BAR_CLS = "xcat-aa-on";
const HOST_CLS = "xcat-aa-host";

/* ---------------------------------------------------------------- 扫描 */
function buttonsOf(bar) {
  const out = [];
  const els = bar.querySelectorAll(":scope > .fan-btn");
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i];
    // xcat-media-core.js 用 inline display 按素材类型决定按钮是否出现
    if (el.style.display === "none") continue;
    const label = (el.getAttribute("title") || (el.textContent || "").trim() || "").trim();
    if (!label) continue;
    let order = 0;
    try { order = parseInt(window.getComputedStyle(el).order, 10) || 0; } catch (e) { order = 0; }
    out.push({ key: label + "|" + i, label, order, disabled: !!el.disabled, el });
  }
  // flex order 相同则保持 DOM 顺序；Array.prototype.sort 在现代引擎是稳定的
  out.sort((a, b) => a.order - b.order);
  return out;
}

function groupsOf(buttons) {
  const main = [];
  const downloads = [];
  const danger = [];
  for (const b of buttons) {
    if (b.order >= 99) danger.push(b);
    else if (b.order >= 90) downloads.push(b);
    else main.push(b);
  }
  // 去掉空组：生成节点往往只剩「删除」一枚，不该在它前面画一条孤立分隔线
  return [main, downloads, danger].filter((g) => g.length > 0);
}

/* ---------------------------------------------------------------- 挂载 */
const mounts = new Map();

function unmount(st) {
  if (!st) return;
  try { if (st.app) st.app.unmount(); } catch (e) { /* noop */ }
  if (st.host && st.host.parentNode) st.host.parentNode.removeChild(st.host);
  st.app = null;
  st.host = null;
}

function mount(bar) {
  const host = document.createElement("div");
  host.className = HOST_CLS;
  bar.appendChild(host);

  const st = {
    bar,
    host,
    app: null,
    buttons: [],
    state: reactive({ groups: [[], [], []] }),
  };
  st.actions = {
    onClick(e) {
      const target = e.target && e.target.closest ? e.target.closest("[data-key]") : null;
      if (!target || !host.contains(target)) return;
      const key = target.getAttribute("data-key");
      const b = st.buttons.find((item) => item.key === key);
      if (!b || b.disabled || !b.el.isConnected) return;
      b.el.dispatchEvent(new MouseEvent("click", {
        bubbles: true, cancelable: true, view: window,
      }));
    },
  };
  st.app = createApp(XcatAssetActions, { state: st.state, actions: st.actions });
  st.app.mount(host);
  return st;
}

function ensure(bar) {
  if (!bar.isConnected) return;
  let st = mounts.get(bar);
  if (!st || !st.host || !st.host.isConnected) {
    if (st) unmount(st);
    st = mount(bar);
    mounts.set(bar, st);
  }
  st.buttons = buttonsOf(bar);
  st.state.groups = groupsOf(st.buttons);
  bar.classList.add(BAR_CLS);
}

function sweep() {
  // 容器被上游 v-if 卸载后，卸载对应 app，防止 Map 持有死 DOM
  for (const [bar, st] of mounts) {
    if (!bar.isConnected) {
      unmount(st);
      mounts.delete(bar);
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
    const bars = document.querySelectorAll("#app .demo-node .node-actions");
    for (let i = 0; i < bars.length; i += 1) {
      try { ensure(bars[i]); } catch (e) { /* 单条按钮行出错不影响其它节点 */ }
    }
  }, 0);
}

function observe() {
  const root = document.querySelector("#app .vue-flow") || document.querySelector(".vue-flow");
  if (!root) { window.setTimeout(observe, 300); return; }
  // 只盯 childList + style：自己写的是 class，不监听 class 可避免自激；
  // style 变化来自 xcat-media-core.js 按素材类型显隐按钮。
  new MutationObserver(schedule).observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  window.setInterval(schedule, 400);
  schedule();
}

if (!window.__xcatAssetActionsInstalled) {
  window.__xcatAssetActionsInstalled = true;
  observe();
}
