/* Node Control 🐈‍⬛ — front end for the 🐈‍⬛NodeControl node.

   Same machine as Group Control 🐈‍⬛, pointed one level down: instead of whole
   groups it lists individual canvas nodes, one switch each, so a handful of
   scattered nodes can be opened or closed without hunting them down one by one.

   Only the "what is a node" half lives here — panel mechanics, sizing and the
   settings dialog come from ./control_panel.js. Nothing here is executed by the
   sampler: the panel writes `node.mode` directly, which is exactly what muting
   or bypassing a node by hand does.
*/

import { app } from "../../../scripts/app.js";
import {
  createControlPanel,
  registerControl,
  MODE_ALWAYS,
  MODE_NEVER,
  MODE_BYPASS,
  normColor,
  gBounds,
  nCenter,
  pointIn,
  nodeActive,
} from "./control_panel.js";
import { pick } from "./i18n.js";

/* ---------------------------------------------------------------- constants */

// Built from escapes so the mark survives any re-encoding of this file.
const BRAND = "\u{1F408}\u200D\u2B1B";
const NODE_ID = `${BRAND}NodeControl`;
const P = "xxlnc";
const STORE = "nc";

/* 这些类型没有「跑不跑」的语义，列出来只会让开关看起来失灵：
   便签是纯文本，路由节点靠连线转发，原语节点只负责供给控件。 */
const SKIP_TYPES = new Set(["Note", "Reroute", "PrimitiveNode"]);

/* ------------------------------------------------------------------- reading */

function readGroups() {
  const g = app.graph;
  const raw = (g && (g._groups || g.groups)) || [];
  return raw.map((gr) => ({
    title: (gr.title || "").trim(),
    bounds: gBounds(gr),
    color: normColor(gr.color),
  }));
}

/* 节点自己上过色就用它；否则沿用所在组的颜色（取最小的那个组，嵌套时才不会串色），
   这样按颜色筛选也能一把捞起某个彩色组里的所有节点。 */
function groupTint(n, groups) {
  const c = nCenter(n);
  let best = null;
  let bestArea = Infinity;
  for (const g of groups) {
    if (!g.color || !pointIn(c, g.bounds)) continue;
    const area = g.bounds[2] * g.bounds[3];
    if (area < bestArea) {
      bestArea = area;
      best = g;
    }
  }
  return best ? best.color : "";
}

/* ------------------------------------------------------------ registration */

registerControl({
  nodeId: NODE_ID,
  name: "XXXXXLCat.NodeControl",
  settingsLabel: pick({ zh: `${BRAND} 节点控制设置`, en: `${BRAND} Node Control Settings` }),
  build(node) {
    return createControlPanel(node, {
      store: STORE,
      prefix: P,
      settingsTitle: { zh: "节点控制设置", en: "Node Control Settings" },
      emptyIdle: { zh: "画布上还没有可控节点", en: "No controllable nodes on the canvas" },
      emptyFiltered: { zh: "没有符合筛选条件的节点", en: "No matching nodes" },
      emptyNoKeyword: { zh: "输入名称关键词以列出节点", en: "Type a name keyword to list nodes" },
      unitHint: (shown, total) => ({
        zh: `显示 ${shown} / ${total} 个节点`,
        en: `Showing ${shown} / ${total} nodes`,
      }),
      keywordLabel: {
        zh: "名称 / 类型关键词（分号分隔，任一命中）",
        en: "Name / type keywords (semicolon-separated, any match)",
      },
      keywordPlaceholder: {
        zh: "用 ; 分隔多个关键词，例如 KSampler; 采样; LORA",
        en: "Separate keywords with ; e.g. KSampler; sampling; LORA",
      },
      colorLabel: {
        zh: "颜色筛选（可多选；未上色的节点沿用所在组的颜色）",
        en: "Color filter (multi-select; uncolored nodes inherit their group's color)",
      },
      paletteEmpty: { zh: "画布上没有节点或组设置过颜色", en: "No nodes or groups on the canvas have a color set" },

      palette() {
        const groups = readGroups();
        return app.graph._nodes.map((n) => normColor(n.color) || normColor(n.bgcolor) || groupTint(n, groups)).filter(Boolean);
      },

      readAll() {
        const g = app.graph;
        if (!g || !g._nodes) return [];
        const groups = readGroups();
        const out = [];
        for (const n of g._nodes) {
          if (n === node) continue; // never switch itself off
          if (SKIP_TYPES.has(n.type)) continue;
          const title =
            (n.title || "").trim() || (n.type || "").trim() || pick({ zh: "未命名节点", en: "Untitled node" });
          const type = (n.type || "").trim();
          out.push({
            key: String(n.id != null ? n.id : title),
            label: title,
            match: type && type !== title ? `${title} ${type}` : title,
            tip: type && type !== title ? `${title} · ${type}` : title,
            tint: normColor(n.color) || normColor(n.bgcolor) || groupTint(n, groups),
            pos: [n.pos ? n.pos[0] : 0, n.pos ? n.pos[1] : 0],
            state: nodeActive(n),
            ref: n,
          });
        }
        return out;
      },

      /* 关闭一个节点 = 绕过或禁用它；开启则恢复运行并清掉可能的禁用标记。 */
      applyItem(item, open, closeFlavor) {
        const n = item.ref;
        if (!n) return;
        n.mode = open ? MODE_ALWAYS : closeFlavor === "mute" ? MODE_NEVER : MODE_BYPASS;
        if (open && n.flags) n.flags.disabled = false;
      },
    });
  },
});
