/* Shared engine behind the LoRA stack nodes.

   Both stacks are the same machine pointed at a different subject: rows of a
   LoRA plus its strengths plus an on/off switch, where only the rows in use are
   shown and the rest stay hidden. The node modules keep the half that is about
   their subject (which backend node, and therefore which row fields); everything
   else — the visible-count bookkeeping, adding and collapsing rows, the height
   correction, the buttons — lives here so the two stacks can never drift apart.

   A row is described by a field list whose names must match the backend schema
   ids: the model-only stack is ["lora", "strength", "on"], the model+CLIP stack
   is ["lora", "strength_model", "strength_clip", "on"]. That list is the whole
   contract between the two halves.

   Nothing here carries data: the rows are the declared inputs of the backend
   node, so a workflow, the API format and a pasted node all behave the same with
   or without this script, and a browser that never ran it simply shows every row
   instead of only the used ones.
*/

import { app } from "../../../scripts/app.js";

const P = "ls"; // properties key prefix (per node, so both can share it)
const MAX_ROWS = 12; // must match MAX_ROWS in nodes/lora_rows.py
const DEFAULT_ROWS = 4;
const EMPTY = "None"; // must match EMPTY in nodes/lora_rows.py
const ADD = "Add LoRA";
const REMOVE = "Remove empty rows";

const slotOf = (index) => String(index).padStart(2, "0");

/* The value a row field falls back to when a row is emptied out. */
function defaultFor(field) {
  if (field === "lora") return EMPTY;
  if (field === "on") return true;
  return 1; // any "strength..." field
}

/* ------------------------------------------------------------ registration */

/* Wires one backend node id to the row behaviour.
     nodeId — backend node id (must equal the schema's node_id)
     name   — extension name, used in log messages
     fields — a row's widget names, in order; must match the backend schema ids */
export function registerLoraRows({ nodeId, name, fields }) {
  const widgetOf = (node, wname) =>
    node.widgets ? node.widgets.find((w) => w && w.name === wname) : null;

  /* Every widget of one row, in field order. */
  const rowWidgets = (node, index) => {
    const s = slotOf(index);
    return fields.map((field) => widgetOf(node, `${field}_${s}`)).filter(Boolean);
  };

  function widgetValue(node, wname, fallback) {
    const w = widgetOf(node, wname);
    return w && w.value !== undefined ? w.value : fallback;
  }

  function setWidgetValue(node, wname, value) {
    const w = widgetOf(node, wname);
    if (!w || w.value === value) return;
    w.value = value;
    // Let the front end know the widget moved under it, so the rendered control
    // follows the value instead of waiting for an unrelated redraw.
    try {
      if (typeof w.callback === "function") w.callback(value);
    } catch (_) {}
  }

  /* One row field, read by slot. */
  const rowField = (node, index, field) =>
    widgetValue(node, `${field}_${slotOf(index)}`, defaultFor(field));

  const rowHasLora = (node, index) => {
    const value = rowField(node, index, "lora");
    return !!value && value !== EMPTY;
  };

  /* Hide a row.
     `hidden` is the state the current front end filters on when it lays widgets
     out (getLayoutWidgets), and it is honoured both on the widget and inside its
     options because the two are watched in different places. computeSize is
     collapsed as well and the original is put back on the way out, so an older
     front end that only knows the canvas layout collapses the row instead of
     leaving it on screen. */
  function setRowHidden(node, index, hidden) {
    for (const w of rowWidgets(node, index)) {
      if (w.__lsSize === undefined) w.__lsSize = w.computeSize;
      try {
        w.hidden = hidden;
        if (w.options) w.options.hidden = hidden;
      } catch (_) {}
      w.computeSize = hidden ? () => [0, -4] : w.__lsSize;
    }
  }

  /* ---- visible count ---- */

  function storedCount(node) {
    const raw = (node.properties || {})[`${P}_rows`];
    if (!Number.isInteger(raw)) return DEFAULT_ROWS;
    return Math.min(MAX_ROWS, Math.max(1, raw));
  }

  /* Highest row that actually holds a LoRA. A filled row always outranks the
     stored count, so a row can never be hidden while still being applied. */
  function filledRows(node) {
    let top = 1;
    for (let i = 1; i <= MAX_ROWS; i++) {
      if (rowHasLora(node, i)) top = i;
    }
    return top;
  }

  const visibleCount = (node) => Math.max(storedCount(node), filledRows(node));

  function markDirty(node, notify) {
    try {
      if (node.setDirtyCanvas) node.setDirtyCanvas(true, true);
      else if (app.canvas && app.canvas.setDirty) app.canvas.setDirty(true, true);
    } catch (_) {}
    if (!notify) return;
    try {
      if (app.graph && app.graph.change) app.graph.change();
    } catch (_) {}
  }

  /* LiteGraph sizes a node the moment it is built, before this script has had a
     chance to hide anything, so a freshly added stack is born as tall as all
     twelve rows — and hiding a widget later does not make the node measure
     itself again (verified: 946px created, 370px of content). Re-measure once
     right after the visibility flip so the node opens at the height of the rows
     it actually shows. Only ever called from create / add / collapse — never
     from a render path — so it cannot feed back into a resize loop. */
  function fitHeight(node) {
    if (!node || !node.size || typeof node.computeSize !== "function") return;
    try {
      const h = Math.round(node.computeSize()[1]);
      if (h > 0 && h !== Math.round(node.size[1])) node.setSize([node.size[0], h]);
    } catch (_) {}
  }

  function applyRows(node, notify, fit) {
    const count = visibleCount(node);
    for (let i = 1; i <= MAX_ROWS; i++) setRowHidden(node, i, i > count);
    if (fit) fitHeight(node);
    markDirty(node, notify);
  }

  /* ---- add / remove ---- */

  function addRow(node) {
    const count = visibleCount(node);
    if (count >= MAX_ROWS) return;
    node.properties = node.properties || {};
    node.properties[`${P}_rows`] = count + 1;
    applyRows(node, true, true);
  }

  /* Collapse every empty row in one go.
     Rows that hold a LoRA are kept in order and moved up to close the gaps, so
     the stack is always a solid block with no numbered holes; each kept row
     brings all of its fields (strengths and switch included) along. With nothing
     selected at all, a single empty row is left as a place to start. */
  function removeEmptyRows(node) {
    const kept = [];
    for (let i = 1; i <= MAX_ROWS; i++) {
      if (!rowHasLora(node, i)) continue;
      const row = {};
      for (const field of fields) row[field] = rowField(node, i, field);
      kept.push(row);
    }

    // Rewriting every slot also guarantees that no hidden row keeps a value.
    for (let i = 1; i <= MAX_ROWS; i++) {
      const s = slotOf(i);
      const row = kept[i - 1];
      for (const field of fields) {
        setWidgetValue(node, `${field}_${s}`, row ? row[field] : defaultFor(field));
      }
    }

    node.properties = node.properties || {};
    node.properties[`${P}_rows`] = Math.max(1, kept.length);
    applyRows(node, true, true);
  }

  function addButtons(node) {
    if (widgetOf(node, ADD)) return;
    node.addWidget("button", ADD, null, () => addRow(node));
    node.addWidget("button", REMOVE, null, () => removeEmptyRows(node));
  }

  /* ---- lifecycle ---- */

  app.registerExtension({
    name,

    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (!nodeData || nodeData.name !== nodeId) return;

      /* fit = true only for a brand-new node: a workflow's own saved size must
         win when it is loaded, otherwise the node fights the size the user set. */
      const setup = (node, fit) => {
        addButtons(node);
        applyRows(node, false, fit);
      };

      const baseCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const out = baseCreated ? baseCreated.apply(this, arguments) : undefined;
        try {
          setup(this, true);
        } catch (err) {
          console.error(`[${name}] setup failed`, err);
        }
        return out;
      };

      /* Loading a workflow restores properties, widget values and the node's own
         size *after* onNodeCreated, so the count has to be read once more here —
         without touching the height the workflow asked for. */
      const baseConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function (info) {
        if (typeof baseConfigure === "function") {
          try {
            baseConfigure.call(this, info);
          } catch (_) {}
        }
        try {
          setup(this, false);
        } catch (err) {
          console.error(`[${name}] configure failed`, err);
        }
      };
    },
  });
}
