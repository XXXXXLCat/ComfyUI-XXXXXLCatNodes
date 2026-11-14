/**
 * 七类工作流分类的可读真源（原 #21 / 06 块，阶段 11）。
 *
 * 运行时代码固化在 src/xcat/app/canvas-app.js 的 06 块里，内容由本文件剥掉
 * 行首 `export ` 后生成；这里是可读参考与契约基准。
 * xcat/verify-source-logic.mjs 与 .workbuddy/tmp/verify-p21-runtime.js 防漂移。
 *
 * ⚠️ 与 node-role.js 同理：**不能有任何模块级 const/let 运行时状态**。
 *    `mount("#app")` 早于本块执行，顶层 const 会触发 TDZ。所有常量一律用
 *    函数声明返回字面量表达。
 *
 * 工作流分类共**七类**（2026-11-14 增补「文生音乐」；历史片段注释里写的
 * 「六类」是笔误，此处按实际行为修正）。类别只影响列表分组与生成节点的
 * 可选范围，**不改工作流 JSON**；后端 `_detect_workflow_category()` 会在没存过
 * 类别时现场推断，所以老流程免迁移。
 *
 * 分类缓存 `window.__xcatWfCats` 由 /workflows 响应写入，节点药丸按它分段。
 */

/** 七个工作流类别，顺序即左栏分组顺序。每次返回新数组。 */
export function xcatWFCats() {
  return [
    "文生图像",
    "图像编辑",
    "文生视频",
    "参考生视频",
    "图像放大",
    "图像反推",
    "文生音乐",
  ];
}

/** 查某个工作流的当前类别。后端返回非法/缺省值时回落到「文生图像」。 */
export function xcatWFCatOf(list, name) {
  const hit = (list || []).find((item) => item && item.name === name);
  const category = hit && hit.category;
  return xcatWFCats().indexOf(category) >= 0 ? category : xcatWFCats()[0];
}

/**
 * 把 /workflows 的扁平列表摊成「组标题 + 组内条目」，供左栏 v-for 渲染。
 * 组头带 group:true，点击会被 xcatWFItemClick 吞掉。
 */
export function xcatWFGrouped(list) {
  const cats = xcatWFCats();
  const buckets = {};
  const out = [];
  (list || []).forEach((item) => {
    let category = item && item.category;
    if (cats.indexOf(category) < 0) category = cats[0];
    (buckets[category] || (buckets[category] = [])).push(item);
  });
  cats.forEach((category) => {
    const arr = buckets[category];
    if (!arr || !arr.length) return;
    out.push({
      key: "#g:" + category,
      group: true,
      name: category,
      category,
      nodes: arr.length,
    });
    arr.forEach((item) => out.push(item));
  });
  return out;
}

/** 组标题不是可选项，点击直接吞掉。 */
export function xcatWFItemClick(item, select) {
  if (item && !item.group) select(item.name);
}

/**
 * 把 /workflows 响应里的 name→category 记进缓存。
 * cache 可注入以便单测；默认取 window.__xcatWfCats。
 */
export function xcatWFRemember(items, cache) {
  const map = cache || globalThis.window?.__xcatWfCats || {};
  (items || []).forEach((item) => {
    if (item && item.name) map[item.name] = item.category || xcatWFCats()[0];
  });
  return map;
}

/** 生成节点的接入范围；非生成节点返回 null（不限）。 */
export function xcatWFScope(role) {
  if (role === "gen-image") return ["文生图像", "图像编辑"];
  if (role === "gen-video") return ["文生视频", "参考生视频"];
  if (role === "gen-audio") return ["文生音乐"];
  return null;
}

/** 某类别是否在指定角色可接入范围内。 */
export function xcatWFInScope(role, category) {
  const scope = xcatWFScope(role);
  return !scope || scope.indexOf(category) >= 0;
}

/**
 * 新建生成节点时的默认工作流：优先取该角色范围内第一个，范围外一律不选。
 * 不限类别的角色取列表首项。
 */
export function xcatWFDefaultFor(list, role) {
  if (!list || !list.length) return "";
  const scope = xcatWFScope(role);
  if (!scope) return list[0].name || "";
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (item && scope.indexOf(item.category) >= 0) return item.name || "";
  }
  return "";
}

/**
 * 节点工作流选择器的分段药丸：按类别分组、按角色范围过滤，越类的当前项
 * 置顶并标 off:true（灰虚线），不隐藏。
 */
export function xcatWFPills(names, role, current, cache) {
  const cats = xcatWFCats();
  const map = cache || globalThis.window?.__xcatWfCats || {};
  const buckets = {};
  const out = [];
  (names || []).forEach((name) => {
    let category = map[name];
    if (cats.indexOf(category) < 0) category = cats[0];
    if (!xcatWFInScope(role, category)) return;
    (buckets[category] || (buckets[category] = [])).push(name);
  });
  cats.forEach((category) => {
    const arr = buckets[category];
    if (!arr || !arr.length) return;
    out.push({ g: true, name: category });
    arr.forEach((name) => out.push({ name }));
  });
  if (current && !out.some((item) => item.name === current)) {
    out.unshift({ name: current, off: true });
  }
  return out;
}

/** 药丸点击：组标题不是可选项。 */
export function xcatWFPillClick(item, select) {
  if (item && !item.g) select(item.name);
}

/** 挂到 window 的缓存与范围查询入口。 */
export function installWorkflowGlobals(win = globalThis.window) {
  if (!win) return;
  win.__xcatWfCats = win.__xcatWfCats || {};
  win.__xcatWFScopeFor = xcatWFScope;
}
