/**
 * #21 / 02 块适配层（与 canvas-tabs.js 一起注入主 chunk 顶层）。
 *
 * 历史调用点按「无参顶层函数名」引用这些函数，且 store / busy 是主 chunk
 * 模块作用域内的压缩别名（qt / canvasTabBusy，由 #20 片段定义，位置在 02 块
 * 之前）。这里只做名字绑定，不含逻辑；逻辑全在 canvas-tabs.js 的可读真源里。
 *
 * 所有依赖都在函数体内求值，不在顶层立即读取 canvasTabBusy 等 ref，避免
 * 04 块末尾 mount("#app") 之前的 TDZ / 初始化顺序问题。
 */
function xcatFlush() {
  return xcatFlushImpl(qt);
}

function xcatPick(id) {
  return xcatPickImpl(qt, canvasTabBusy, id);
}

function xcatAdd() {
  return xcatAddImpl(qt, canvasTabBusy);
}

function xcatWheel(ev) {
  return xcatWheelImpl(ev);
}

function xcatSaveCurrent() {
  return xcatSaveCurrentImpl(qt, xcatShowSaveDialog);
}

try {
  installCanvasTabs(qt, xcatSaveCurrent);
} catch (e) {
  // 注入环境缺 qt 时（例如单测沙箱）不阻断其余片段。
}
