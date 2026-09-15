/* Group Control 🐈‍⬛ — front end for the 🐈‍⬛GroupControl node.

   The backend node is a pass-through shell; this script is where the node
   actually earns its place. It lists every canvas group, lets the user open or
   close each one with a single switch, and keeps the whole setup (filters,
   ordering, mode, close flavour) inside node properties so it travels with the
   workflow.

   Only the "what is a group" half lives here — panel mechanics, sizing and the
   settings dialog come from ./control_panel.js, shared with Node Control 🐈‍⬛.
   Nothing here is executed by the sampler: the panel writes `node.mode`
   directly, which is exactly what muting or bypassing by hand does.
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
  rectIn,
  nodeActive,
} from "./control_panel.js";

/* ---------------------------------------------------------------- constants */

// Built from escapes so the mark survives any re-encoding of this file.
const BRAND = "\u{1F408}\u200D\u2B1B";
const NODE_ID = `${BRAND}GroupControl`;
const P = "xxlgc";
const STORE = "gc";

/* ------------------------------------------------------------------- reading */

function readGroups() {
  const g = app.graph;
  const raw = (g && (g._groups || g.groups)) || [];
  return raw.map((gr) => ({
    ref: gr,
    title: (gr.title || "").trim() || "Untitled group",
    bounds: gBounds(gr),
    color: normColor(gr.color),
  }));
}

/* 成员判定：Nodes 2.0 里 group.nodes 常为空，用包围盒中心包含判定；
   整组落在自己内部的子组也算进来，嵌套组才能一起开合。 */
function membersOf(grp, all, self) {
  const g = app.graph;
  if (!g || !g._nodes) return [];
  const rects = [grp.bounds];
  for (const other of all) {
    if (other.ref !== grp.ref && rectIn(other.bounds, grp.bounds)) rects.push(other.bounds);
  }
  return g._nodes.filter((n) => {
    if (n === self) return false; // never switch itself off
    const c = nCenter(n);
    return rects.some((r) => pointIn(c, r));
  });
}

/* true = 全开，false = 全关，null = 混合（不猜用户意图，交给用户点开关）。 */
function stateOf(nodes) {
  if (!nodes.length) return null;
  const active = nodes.filter(nodeActive).length;
  if (active === nodes.length) return true;
  if (active === 0) return false;
  return null;
}

/* ------------------------------------------------------------ registration */

registerControl({
  nodeId: NODE_ID,
  name: "XXXXXLCat.GroupControl",
  settingsLabel: `${BRAND} Group Control Settings`,
  build(node) {
    return createControlPanel(node, {
      store: STORE,
      prefix: P,
      settingsTitle: "Group Control Settings",
      emptyIdle: "No groups on the canvas",
      emptyFiltered: "No matching groups",
      emptyNoKeyword: "Type a name keyword to list groups",
      unitHint: (shown, total) => `Showing ${shown} / ${total} groups`,
      keywordLabel: "Name keywords (semicolon-separated, any match)",
      keywordPlaceholder: "Separate names with ; e.g. character; background; LORA",
      colorLabel: "Color filter (multi-select)",
      paletteEmpty: "No groups on the canvas have a color set",

      palette: () => readGroups().map((g) => g.color).filter(Boolean),

      readAll() {
        const groups = readGroups();
        return groups
          .map((g) => {
            const members = membersOf(g, groups, node);
            return {
              key: g.title,
              label: g.title,
              tip: g.title,
              tint: g.color,
              pos: [g.bounds[0], g.bounds[1]],
              state: stateOf(members),
              members,
            };
          })
          .filter((it) => it.members.length > 0); // 空组没有可开合的东西
      },

      /* 关闭一个组 = 把组内每个节点都推到同一种 mode；开启则统一恢复。 */
      applyItem(item, open, closeFlavor) {
        const mode = open ? MODE_ALWAYS : closeFlavor === "mute" ? MODE_NEVER : MODE_BYPASS;
        for (const n of item.members) {
          n.mode = mode;
          if (open && n.flags) n.flags.disabled = false;
        }
      },
    });
  },
});
