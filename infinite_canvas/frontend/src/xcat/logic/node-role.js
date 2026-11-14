/**
 * 节点角色判定的可读真源（原 #21 / 05 块，阶段 11）。
 *
 * 运行时代码固化在 src/xcat/app/canvas-app.js 的 05 块里，内容由本文件剥掉
 * 行首 `export ` 后生成；这里是可读参考与契约基准。xcat/verify-source-logic.mjs
 * 与 .workbuddy/tmp/verify-p21-runtime.js 共同防止两者行为漂移。
 * 要改运行时行为，改 canvas-app.js 的对应函数，并同步本文件。
 *
 * ⚠️ 本文件不能有任何模块级 const/let 运行时状态：#21 的 `mount("#app")` 位于
 *    04 块末尾，早于 05/06 块执行；挂载时 Vue 会同步渲染工作流列表并调用这些
 *    函数，若函数体引用尚未初始化的顶层 const 会触发 TDZ ReferenceError。
 *    因此所有常量一律用「函数声明返回字面量」表达（函数声明会 hoisting）。
 *
 * 九种 data.role（见项目记忆「画布定论」）：
 *   asset-{image,video,audio,text} / gen-{image,video,audio,text} / lora
 */

/** 所有合法的角色标识，顺序与画布右侧「新建节点」菜单一致。 */
export function xcatNodeRoles() {
  return [
    "asset-image",
    "asset-video",
    "asset-audio",
    "asset-text",
    "gen-image",
    "gen-video",
    "gen-audio",
    "gen-text",
    "lora",
  ];
}

/**
 * 返回节点的角色。
 *
 * 优先读 data.role；老画布（没有 role 字段）则按第一个媒体附件的 kind 回退，
 * 未知 kind 一律当成 image，保证老工作流免迁移。
 *
 * @param {{role?: string, media?: Array<{kind?: string}>}} data 节点 data
 * @returns {string} 九种角色之一
 */
export function xcatRole(data) {
  const role = data && data.role;
  if (xcatNodeRoles().indexOf(role) >= 0) return role;

  const kind =
    (data && data.media && data.media[0] && data.media[0].kind) || "image";
  const known = ["image", "video", "audio"];
  return "asset-" + (known.indexOf(kind) >= 0 ? kind : "image");
}

/** 是否为生成节点（gen-*）。 */
export function xcatIsGen(data) {
  return xcatRole(data).indexOf("gen-") === 0;
}

/** 是否为纯文本节点（素材文本 / 生成文本）。 */
export function xcatIsText(data) {
  const role = xcatRole(data);
  return role === "asset-text" || role === "gen-text";
}

/**
 * 按节点 id 查角色。读 Vue Flow store 的 `window.__xcatFlow`，
 * 查不到或抛错一律返回空串（画布未就绪时不能炸）。
 *
 * @param {string} id 节点 id
 * @returns {string} 角色，或空串
 */
export function xcatNodeRole(id, flow = globalThis.window?.__xcatFlow) {
  try {
    if (!flow || !flow.getNodes) return "";
    const node = flow.getNodes.value.find((n) => n.id === id);
    return node ? xcatRole(node.data) : "";
  } catch {
    return "";
  }
}

/**
 * 文本节点输入写回：先改 node.data.text 让界面立即响应，再用 400ms 防抖
 * 调用 updateNodeData 落盘。
 *
 * ⚠️ 项目记忆里的坑：updateNodeData 会换掉 data 副本，所以这里必须重新从
 *    n.data.text 取值；同一节点连续输入时靠 __xcatTextSaving 只调度一次。
 */
export function xcatTextInput(node, value, options = {}) {
  const flow = options.flow ?? globalThis.window?.__xcatFlow;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  try {
    if (!node || !node.data) return;
    node.data.text = value;
    if (node.__xcatTextSaving) return;
    node.__xcatTextSaving = 1;
    schedule(() => {
      node.__xcatTextSaving = 0;
      try {
        if (flow && flow.updateNodeData) {
          flow.updateNodeData(node.id, { text: node.data.text });
        }
      } catch {
        /* store 尚未就绪，忽略 */
      }
    }, 400);
  } catch {
    /* 节点已删除等竞态，忽略 */
  }
}

/** 挂到 window 的两个全局入口（供 xcat 脚本跨作用域调用）。 */
export function installNodeRoleGlobals(win = globalThis.window) {
  if (!win) return;
  win.__xcatRole = xcatRole;
  win.__xcatIsText = xcatIsText;
}
