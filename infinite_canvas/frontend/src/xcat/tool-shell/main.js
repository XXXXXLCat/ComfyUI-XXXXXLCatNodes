/**
 * 工具弹窗外壳挂载桥接层（阶段 7）。
 *
 * 三个 xcat 脚本（image-tools / video-edit / audio-edit）用 shell() 把
 * .xcat-ae-modal append 到 #app，随后 q('#id', modal) 往下绑定事件、读值，
 * close() 直接 modal.remove()。这一层不改脚本、不改控件，只做三件事：
 *
 *   1. 发现新 modal → 在它内部挂一个 Vue app，用官方 Dialog 组件渲染遮罩 /
 *      容器 / 标题栏（XcatToolShell.vue）；
 *   2. 把原 .xcat-ae-dialog 整体 appendChild 进官方 Content 的空槽 —— 只是
 *      在 modal 内换了一层父节点，脚本持有的节点引用、q(id, modal)、
 *      .xcat-im-dialog .xcat-ae-body 这类后代选择器全部保持成立；
 *   3. 同步脚本动态写入的 #xcat-ae-sub / #xcat-ve-sub 文本到官方
 *      DialogDescription，并在 modal 被 remove 时 unmount，避免 app 泄漏。
 *
 * 与阶段 6 的 tool-dialog/ 互不干扰：那个挂载器盯的是 body / foot 里的控件，
 * 它的 host 随 dialog 一起移动，isConnected 仍为 true，不会重新挂载。
 */
import { createApp, reactive, markRaw } from "vue";
import XcatToolShell from "./XcatToolShell.vue";

const MODAL_SEL = "#app > .xcat-ae-modal";
const ON_CLS = "xcat-ts-on";
const ROOT_CLS = "xcat-ts-root";
const mounts = new Map();

function titleOf(modal) {
  const el = modal.querySelector(".xcat-ae-head .xcat-ae-title");
  return el ? (el.textContent || "").trim() : "";
}

function subOf(modal) {
  const el = modal.querySelector(".xcat-ae-head .xcat-ae-sub");
  return el ? (el.textContent || "").trim() : "";
}

function unmount(st) {
  if (!st) return;
  try { if (st.subObserver) st.subObserver.disconnect(); } catch (e) { /* noop */ }
  try { window.clearInterval(st.placeTimer); } catch (e) { /* noop */ }
  try { if (st.app) st.app.unmount(); } catch (e) { /* noop */ }
  try { if (st.root && st.root.parentNode) st.root.parentNode.removeChild(st.root); } catch (e) { /* noop */ }
  try { if (st.modal) st.modal.classList.remove(ON_CLS); } catch (e) { /* noop */ }
  st.app = null;
}

/** reka 的 Presence 可能在下一个 tick 才落地 Content，用 setTimeout 重试兜底 */
function placeDialog(st) {
  let tries = 0;
  const tick = () => {
    if (!st.app || !st.modal.isConnected) return;
    const slot = st.modal.querySelector(".xcat-ts-slot");
    if (slot) {
      if (st.dialog.parentNode !== slot) slot.appendChild(st.dialog);
      st.modal.classList.add(ON_CLS);
      window.clearInterval(st.placeTimer);
      st.placeTimer = 0;
      return;
    }
    tries += 1;
    if (tries >= 20) window.clearInterval(st.placeTimer);
  };
  tick();
  st.placeTimer = window.setInterval(tick, 60);
}

function mount(modal) {
  const dialog = modal.querySelector(".xcat-ae-dialog");
  const head = modal.querySelector(".xcat-ae-head");
  if (!dialog || !head) return null;

  const root = document.createElement("span");
  root.className = ROOT_CLS;
  modal.appendChild(root);

  const state = reactive({
    modalEl: markRaw(modal),
    headEl: markRaw(head),
    title: titleOf(modal),
    sub: subOf(modal),
  });

  const app = createApp(XcatToolShell, { state });
  app.mount(root);

  const st = {
    modal: markRaw(modal),
    head: markRaw(head),
    dialog: markRaw(dialog),
    root: markRaw(root),
    app,
    state,
    placeTimer: 0,
    subObserver: null,
  };

  // 脚本会动态写副标题（「正在读取音频…」→ 波形信息），官方 Description 要跟上
  const subEl = head.querySelector(".xcat-ae-sub");
  if (subEl) {
    const syncSub = () => {
      state.sub = (subEl.textContent || "").trim();
      state.title = titleOf(modal);
    };
    const ob = new MutationObserver(syncSub);
    ob.observe(subEl, { childList: true, characterData: true, subtree: true });
    st.subObserver = ob;
  }

  placeDialog(st);
  return st;
}

function healthy(st) {
  if (!st || !st.modal.isConnected || !st.root.isConnected || !st.dialog.isConnected) return false;
  return !!st.modal.querySelector(".xcat-ts-slot");
}

function ensure(modal) {
  let st = mounts.get(modal);
  if (st && healthy(st)) return;
  if (st) { unmount(st); mounts.delete(modal); }
  try {
    const next = mount(modal);
    if (next) mounts.set(modal, next);
  } catch (e) { /* 单个弹窗失败不影响其它，也不该让画布报错 */ }
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  window.setTimeout(() => {
    pending = false;
    for (const [modal, st] of mounts) {
      if (!modal.isConnected) { unmount(st); mounts.delete(modal); }
    }
    const modals = document.querySelectorAll(MODAL_SEL);
    for (let i = 0; i < modals.length; i += 1) ensure(modals[i]);
  }, 60);
}

function observe() {
  const app = document.querySelector("#app") || document.body;
  // 只盯 #app 的直接子节点：modal 就是 shell() append 进去的。
  // 不能 subtree:true —— 搬运 dialog 会制造大量 childList 变化，自己激自己。
  new MutationObserver(schedule).observe(app, { childList: true });
  window.setInterval(schedule, 600);
  schedule();
}

if (!window.__xcatToolShellInstalled) {
  window.__xcatToolShellInstalled = true;
  observe();
}
