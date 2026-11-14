/**
 * #21 / 03-save-dialog.js.txt 的可读真源（阶段 11 batch 2）。
 *
 * 历史 03 块是 3345 B 的手写 DOM 拼装：自己 createElement 遮罩 / 卡片 /
 * 标题 / input / 按钮，再手绑 ESC、Enter、焦点全选、遮罩点击。这一版把 UI
 * 整个交给 xcat-panels.js 里的 shadcn-vue 官方 Dialog（见
 * src/xcat/save-dialog/），主 chunk 只留这段桥接。
 *
 * 唯一调用点是 02 块的 xcatSaveCurrent()：
 *     xcatShowSaveDialog(prefill, async function (name) { ... })
 * 契约不变：确认时把输入框当前值交给 cb；× / ESC / 点遮罩只关闭、不回调。
 *
 * ⚠️ 与 05/06 真源同理：不能有模块级 const/let 运行时状态。`mount("#app")`
 *    在 04 块末尾、早于 05/06 执行，顶层常量会 TDZ；本文件只有函数声明。
 */
export function xcatShowSaveDialog(prefill, cb) {
  try {
    var win = globalThis.window;
    var api = win && win.__xcatSaveDialog;
    if (api && typeof api.open === "function") {
      api.open(prefill, cb);
      return;
    }

    // xcat-panels.js 是独立的 defer 脚本，理论上晚于主 chunk 就绪；保存对话框
    // 只在用户按 Ctrl+S 时打开。这里仍留一段短重试，避免组件尚未加载时
    // 「点了保存却没反应」。
    var tries = 0;
    (function wait() {
      var w = globalThis.window;
      var a = w && w.__xcatSaveDialog;
      if (a && typeof a.open === "function") {
        a.open(prefill, cb);
        return;
      }
      if (tries++ < 40) setTimeout(wait, 50);
    })();
  } catch (e) {
    /* 画布未就绪或组件缺失都不该让 Ctrl+S 抛错 */
  }
}
