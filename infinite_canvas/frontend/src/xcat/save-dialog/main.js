/**
 * 「保存画布」对话框挂载桥接层（阶段 11 batch 2）。
 *
 * 主 chunk 的 03 块现在只剩 xcatShowSaveDialog(prefill, cb) 一段桥接，它调用
 * window.__xcatSaveDialog.open()。这里提供这个全局入口，并把状态交给
 * XcatSaveDialog.vue 的官方 Dialog 渲染。
 *
 * 为什么懒挂载：xcat-panels.js 是 defer 脚本，可能在主 chunk 的
 * createApp(...).mount("#app") 之前执行；Vue 挂载会清空 #app.innerHTML，
 * 提前塞进去的容器会被删掉。改成第一次 open() 时才创建（那时用户已经能按
 * Ctrl+S，Vue 必然挂载完毕）。
 *
 * Portal 目标也单独开一个 .xcat-sd-portal，挂在 #app 内 —— 既继承 --cg-*
 * 令牌，又不和主应用的节点树混在一起。
 */
import { createApp, reactive, markRaw } from "vue";
import XcatSaveDialog from "./XcatSaveDialog.vue";

const PORTAL_CLS = "xcat-sd-portal";
const ROOT_CLS = "xcat-sd-root";

let app = null;
let state = null;
let portalEl = null;

function ensure() {
  if (app && state) return state;

  const host = document.querySelector("#app") || document.body;

  portalEl = document.createElement("div");
  portalEl.className = PORTAL_CLS;
  host.appendChild(portalEl);

  const root = document.createElement("span");
  root.className = ROOT_CLS;
  host.appendChild(root);

  state = reactive({
    open: false,
    value: "",
    onConfirm: null,
    portalEl: markRaw(portalEl),
  });
  app = createApp(XcatSaveDialog, { state });
  app.mount(root);
  return state;
}

/** reka 会把焦点给 Content 内第一个可聚焦元素；这里补历史行为的「全选」。 */
function focusInput() {
  try {
    const el = portalEl && portalEl.querySelector(".xcat-sd-input");
    if (!el) return;
    el.focus();
    el.select();
  } catch (e) {
    /* noop */
  }
}

function open(prefill, cb) {
  try {
    const st = ensure();
    if (st.open) return; // 与历史一致：已打开时不重复弹
    st.value = prefill || "";
    st.onConfirm = typeof cb === "function" ? cb : null;
    st.open = true;
    setTimeout(focusInput, 60);
  } catch (e) {
    /* noop */
  }
}

function close() {
  try {
    if (state) state.open = false;
  } catch (e) {
    /* noop */
  }
}

if (!window.__xcatSaveDialogInstalled) {
  window.__xcatSaveDialogInstalled = true;
  window.__xcatSaveDialog = { open, close };
}
