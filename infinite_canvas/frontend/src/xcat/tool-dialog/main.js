/**
 * 工具弹窗挂载桥接层（阶段 6）。
 *
 * 三个 xcat 脚本自建的 7 个弹窗（图像裁剪 / 宫格切分 / 镜像 / 调整，视频截取，
 * 音频截取与拼接 / 变速）共用 .xcat-ae-modal 骨架。这里不重写弹窗、不改 DOM
 * 层级，只把「通用 UI 控件」换成 shadcn-vue 官方组件，影子控件原样留在 DOM：
 *
 *   扫描 → 在每个影子控件旁插 host → 一个 Vue app 用 Teleport 把官方组件
 *   渲染过去 → CSS 收起影子 → 点击 / 改值转发回影子 → 轮询反向同步
 *   disabled / is-active / textContent / innerHTML / value。
 *
 * 不接管的专用可视化：波形 canvas、裁剪框与拖拽手柄、时间轴刻度与
 * .xcat-ve-handle、#xcat-ae-cursor（叠在波形上的透明定位 range）、图片预览。
 * 这些没有等价的官方组件，强行替换会破坏拖拽。
 *
 * 弹窗是动态 append 的，音频弹窗加载完波形还会重写 body，所以这里用
 * MutationObserver（childList）+ 定时兜底持续重扫；host 丢失就卸载重挂，
 * 避免 Teleport 目标失效或 app 泄漏。
 */
import { createApp, reactive, markRaw } from "vue";
import XcatToolDialog from "./XcatToolDialog.vue";

const MODAL_SEL = "#app .xcat-ae-modal";
const ON_CLS = "xcat-td-on";
const ROOT_CLS = "xcat-td-root";
const HOST_CLS = "xcat-td-host";

const NUMBER_SEL = ".xcat-ae-body input[type='number']";
const RANGE_SEL = ".xcat-ae-body input[type='range']";
const BUTTON_SEL = [
  ".xcat-im-ratio",
  ".xcat-im-preset",
  ".xcat-im-mirror-btn",
  ".xcat-ae-chip",
  ".xcat-ae-tools > button",
  ".xcat-ae-play",
].join(",");
const TOGGLE_SEL = ".xcat-im-ratio, .xcat-im-preset, .xcat-im-mirror-btn, .xcat-ae-chip";

function text(el) {
  return (el && (el.textContent || "").trim()) || "";
}

/* ------------------------------------------------------------ 扫描 */
function collect(modal) {
  const items = [];
  let seq = 0;

  function push(kind, el, extra) {
    const host = document.createElement("span");
    host.className = HOST_CLS + " xcat-td-host--" + kind;
    // 数字输入在隐藏前量一次宽度，隐藏后仍占住原来的格子
    if (kind === "number") {
      let w = 0;
      try { w = Math.round(el.getBoundingClientRect().width); } catch (e) { w = 0; }
      host.style.width = (w > 0 ? Math.max(48, w) : 72) + "px";
    }
    el.parentNode.insertBefore(host, el.nextSibling);
    // 影子控件专属标记：CSS 只隐藏带这个标记的元素。
    // 不能用 `input[type=number]` 这类宽泛选择器 —— 官方 Input 也是 number
    // input，会被一起藏掉（阶段 6 首轮实测踩过：host 高度塌成 0）。
    el.setAttribute("data-xcat-shadow", "");

    const item = reactive(Object.assign({
      key: "td" + (++seq),
      kind,
      el: markRaw(el),
      hostEl: markRaw(host),
      value: "",
      min: undefined,
      max: undefined,
      step: undefined,
      disabled: false,
      active: false,
      title: "",
      bodyHtml: "",
      tone: "plain",
      size: "sm",
    }, extra || {}));
    items.push(item);
    return item;
  }

  const x = modal.querySelector(".xcat-ae-head .xcat-ae-x");
  if (x) push("close", x, { title: "关闭", tone: "close" });

  modal.querySelectorAll(".xcat-ae-foot .xcat-ae-btn").forEach((el) => {
    push("button", el, {
      title: text(el),
      bodyHtml: el.innerHTML,
      tone: el.classList.contains("is-primary") ? "primary" : "plain",
      size: "default",
      disabled: !!el.disabled,
    });
  });

  modal.querySelectorAll(BUTTON_SEL).forEach((el) => {
    // 宫格预设 / 镜像按钮原本是「图标 + 标签 + 提示小字」的纵向卡片，
    // 官方 Button 默认 sm 会压成一行；用 shape=card 把布局补回来。
    const card = el.matches(".xcat-im-preset, .xcat-im-mirror-btn");
    const item = push("button", el, {
      title: text(el),
      bodyHtml: el.innerHTML,
      tone: el.classList.contains("is-danger")
        ? "danger"
        : (el.matches(TOGGLE_SEL) ? "toggle" : "plain"),
      shape: card ? "card" : "inline",
      active: el.classList.contains("is-active") ||
        el.getAttribute("aria-pressed") === "true",
      disabled: !!el.disabled,
      size: "sm",
    });
    // 镜像弹窗里「180°」占两列，host 顶替影子成为 grid item 后要接着占两列
    if (el.classList.contains("is-wide")) item.hostEl.classList.add("xcat-td-wide");
  });

  modal.querySelectorAll(NUMBER_SEL).forEach((el) => {
    push("number", el, {
      value: String(el.value == null ? "" : el.value),
      min: el.getAttribute("min") || undefined,
      max: el.getAttribute("max") || undefined,
      step: el.getAttribute("step") || undefined,
      title: el.getAttribute("aria-label") || text(el.parentElement) || "数值",
    });
  });

  modal.querySelectorAll(RANGE_SEL).forEach((el) => {
    // 波形上那根透明 range 是「点击定位游标」，带自己的坐标换算，保留原生
    if (el.id === "xcat-ae-cursor") return;
    push("range", el, {
      value: String(el.value == null ? "" : el.value),
      min: el.getAttribute("min") || "0",
      max: el.getAttribute("max") || "100",
      step: el.getAttribute("step") || "1",
      title: el.getAttribute("aria-label") || "滑块",
    });
  });

  return items;
}

/* ------------------------------------------------------------ 转发 */
const actions = {
  click(item) {
    if (item.disabled || !item.el.isConnected) return;
    item.el.dispatchEvent(new MouseEvent("click", {
      bubbles: true, cancelable: true, view: window,
    }));
  },
  setValue(item, v) {
    const s = String(v == null ? "" : v);
    if (item.value === s) return;
    item.value = s;
    const el = item.el;
    if (!el.isConnected) return;
    el.value = s;
    // 脚本里 input 与 change 两种监听都出现过，两个都派发
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  },
};

/* ------------------------------------------------------------ 反向同步 */
function sync(st) {
  let broken = false;
  for (let i = 0; i < st.items.length; i += 1) {
    const item = st.items[i];
    const el = item.el;
    if (!el.isConnected || !item.hostEl.isConnected) { broken = true; break; }
    if (item.kind === "number" || item.kind === "range") {
      const v = String(el.value == null ? "" : el.value);
      if (v !== item.value) item.value = v;
    } else {
      const d = !!el.disabled;
      if (d !== item.disabled) item.disabled = d;
      const a = el.classList.contains("is-active") ||
        el.classList.contains("is-selected") ||
        el.getAttribute("aria-pressed") === "true";
      if (a !== item.active) item.active = a;
      if (el.innerHTML !== item.bodyHtml) item.bodyHtml = el.innerHTML;
      const t = text(el);
      if (t !== item.title) item.title = t;
    }
  }
  if (broken) schedule();
}

/* ------------------------------------------------------------ 挂载 */
const mounts = new Map();

function unmount(st) {
  if (!st) return;
  try { window.clearInterval(st.timer); } catch (e) { /* noop */ }
  try { if (st.app) st.app.unmount(); } catch (e) { /* noop */ }
  try {
    for (const h of st.hosts) {
      if (h && h.parentNode) h.parentNode.removeChild(h);
    }
  } catch (e) { /* noop */ }
  try { if (st.root && st.root.parentNode) st.root.parentNode.removeChild(st.root); } catch (e) { /* noop */ }
  try { if (st.modal) st.modal.classList.remove(ON_CLS); } catch (e) { /* noop */ }
  st.app = null;
  st.items = [];
}

function mount(modal) {
  modal.classList.remove(ON_CLS); // 量宽度前先让影子可见
  const items = collect(modal);
  if (!items.length) return null;

  const root = document.createElement("span");
  root.className = ROOT_CLS;
  modal.appendChild(root);

  const state = reactive({ items });
  const app = createApp(XcatToolDialog, { state, actions });
  app.mount(root);
  modal.classList.add(ON_CLS);

  const st = {
    modal: markRaw(modal),
    root: markRaw(root),
    hosts: items.map((i) => i.hostEl),
    items,
    state,
    app,
    timer: 0,
  };
  st.timer = window.setInterval(() => sync(st), 140);
  return st;
}

function healthy(st) {
  if (!st || !st.modal.isConnected || !st.root.isConnected) return false;
  for (let i = 0; i < st.hosts.length; i += 1) {
    if (!st.hosts[i].isConnected) return false;
  }
  for (let i = 0; i < st.items.length; i += 1) {
    if (!st.items[i].el.isConnected) return false;
  }
  return true;
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
  const root = document.querySelector("#app") || document.body;
  // 只盯 childList：自己写的是 class，脚本改的是 disabled / class，
  // 都交给 sync 轮询；监听 attributes 只会自激。
  new MutationObserver(schedule).observe(root, { childList: true, subtree: true });
  window.setInterval(schedule, 600);
  schedule();
}

if (!window.__xcatToolDialogInstalled) {
  window.__xcatToolDialogInstalled = true;
  observe();
}
