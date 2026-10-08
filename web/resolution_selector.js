/* Keeps the built-in resolution preview honest for 🐈‍⬛ResolutionSelector.

   The preview that ships with ComfyUI can only derive a size from three things:
   a ratio string, a megapixel target and a multiple. That is enough for the
   eight fixed aspect ratios — their option text ("16:9 (Widescreen)") starts
   with the ratio the preview parses — but "Custom" is not a ratio, so the
   preview gives up and shows a dash, even though the node does know exactly
   what it is going to output.

   Rather than drawing a second preview, this script feeds the existing one:
   the node declares two socketless inputs, `preview_ratio` and
   `preview_megapixels`, the preview is pointed at them, and this script keeps
   them filled with whatever the node is actually doing. In Custom mode the
   ratio becomes the entered width:height and the megapixel target becomes
   width*height/1048576, which makes the preview's own scale factor exactly 1
   so it reproduces the node's rounding to the nearest multiple. The two inputs
   are hidden, so the node looks like the official one with an extra option.

   The same pass hides the megapixel input while Custom is selected, since it
   has nothing to do with the result in that mode.

   Nothing here carries data: without this script the node still computes the
   same width and height — the preview simply shows a dash in Custom mode and
   the megapixel input stays visible.
*/

import { app } from "../../../scripts/app.js";

const NODE_ID = "🐈‍⬛ResolutionSelector";
const NAME = "XXXXXLCat.ResolutionSelector";

const COMBO = "aspect_ratio";
const CUSTOM = "Custom";
const MEGAPIXELS = "megapixels";
const MULTIPLE = "multiple";
const FEED_RATIO = "preview_ratio";
const FEED_MEGAPIXELS = "preview_megapixels";
/* The DynamicCombo names the inputs of the selected option "<combo>.<input>". */
const CUSTOM_WIDTH = `${COMBO}.custom_width`;
const CUSTOM_HEIGHT = `${COMBO}.custom_height`;

const PIXELS_PER_MP = 1024 * 1024;
const DEFAULT_SIZE = 1024; // must match custom_width / custom_height in the schema
const DEFAULT_MULTIPLE = 8; // must match multiple in the schema
const DEFAULT_MEGAPIXELS = 1.0; // must match megapixels in the schema

const widgetOf = (node, name) =>
  node && node.widgets ? node.widgets.find((w) => w && w.name === name) ?? null : null;

function numberValue(node, name, fallback) {
  const value = Number(widgetOf(node, name)?.value);
  return Number.isFinite(value) ? value : fallback;
}

/* Python's round() rounds halves to even, which is what the node uses when it
   snaps to the nearest multiple. Math.round() rounds halves up, so a width of
   1012 at multiple 8 would come out 8 pixels wider than the node's output. */
function roundHalfToEven(value) {
  const floor = Math.floor(value);
  if (value - floor === 0.5) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

function snapToMultiple(value, multiple) {
  const step = Number.isFinite(multiple) && multiple > 0 ? multiple : DEFAULT_MULTIPLE;
  return roundHalfToEven(value / step) * step;
}

/* Hide a widget the way the rest of the package does: both flags, because the
   two are consulted in different places, plus a collapsed computeSize so a
   layout that measures widgets still gives back zero height. */
function setHidden(widget, hidden) {
  if (!widget) return;
  if (widget.__rsSize === undefined) {
    widget.__rsSize = typeof widget.computeSize === "function" ? widget.computeSize : null;
  }
  try {
    widget.hidden = hidden;
    if (widget.options) widget.options.hidden = hidden;
  } catch (_) {}
  if (widget.__rsSize) widget.computeSize = hidden ? () => [0, -4] : widget.__rsSize;
}

const isHidden = (widget) => !!widget && !!widget.hidden;

/* LiteGraph measures a node the moment it builds it, so a node that just lost
   or gained a widget keeps the old height until something re-measures it. Only
   called when the visibility actually changed — never from a render path. */
function fitHeight(node) {
  if (!node || !node.size || typeof node.computeSize !== "function") return;
  try {
    const height = Math.round(node.computeSize()[1]);
    if (height > 0 && height !== Math.round(node.size[1])) {
      node.setSize([node.size[0], height]);
    }
  } catch (_) {}
}

/* Run our turn after whatever the widget was already doing. The Vue widgets
   call `widget.callback` on every edit, so this is what keeps the preview in
   step with the user. */
function chainCallback(widget, fn) {
  if (!widget || widget.__rsChained) return;
  const base = typeof widget.callback === "function" ? widget.callback : null;
  widget.callback = function (...args) {
    try {
      if (base) base.apply(this, args);
    } catch (err) {
      console.error(`[${NAME}] widget callback failed`, err);
    }
    try {
      fn();
    } catch (err) {
      console.error(`[${NAME}] sync failed`, err);
    }
  };
  widget.__rsChained = true;
}

function sync(node) {
  if (!node) return;
  const combo = widgetOf(node, COMBO);
  if (!combo) return;

  /* The Custom width/height widgets only exist while Custom is selected, so
     they have to be looked up — and wired up — on every pass. */
  for (const name of [COMBO, MEGAPIXELS, CUSTOM_WIDTH, CUSTOM_HEIGHT]) {
    chainCallback(widgetOf(node, name), () => sync(node));
  }

  const feedRatio = widgetOf(node, FEED_RATIO);
  const feedMegapixels = widgetOf(node, FEED_MEGAPIXELS);
  const megapixels = widgetOf(node, MEGAPIXELS);
  const multiple = numberValue(node, MULTIPLE, DEFAULT_MULTIPLE);

  const selected = combo.value;
  let ratio = selected; // "16:9 (Widescreen)" — the preview reads "16:9" off the front
  let target = numberValue(node, MEGAPIXELS, DEFAULT_MEGAPIXELS);
  if (selected === CUSTOM) {
    const width = snapToMultiple(numberValue(node, CUSTOM_WIDTH, DEFAULT_SIZE), multiple);
    const height = snapToMultiple(numberValue(node, CUSTOM_HEIGHT, DEFAULT_SIZE), multiple);
    ratio = `${width}:${height}`;
    target = (width * height) / PIXELS_PER_MP;
  }

  if (feedRatio && feedRatio.value !== ratio) feedRatio.value = ratio;
  if (feedMegapixels && feedMegapixels.value !== target) feedMegapixels.value = target;

  setHidden(feedRatio, true);
  setHidden(feedMegapixels, true);

  const custom = selected === CUSTOM;
  const wasHidden = isHidden(megapixels);
  setHidden(megapixels, custom);
  if (wasHidden !== custom) fitHeight(node);
}

app.registerExtension({
  name: NAME,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || nodeData.name !== NODE_ID) return;

    const setup = (node) => {
      try {
        sync(node);
      } catch (err) {
        console.error(`[${NAME}] setup failed`, err);
      }
    };

    const baseCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const out = baseCreated ? baseCreated.apply(this, arguments) : undefined;
      setup(this);
      return out;
    };

    /* Widget values (and, with them, the selected aspect ratio) are restored
       after the node is built, so the feeds have to be recomputed once more
       here. The height is left alone: a workflow's own saved size wins. */
    const baseConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      if (typeof baseConfigure === "function") {
        try {
          baseConfigure.call(this, info);
        } catch (_) {}
      }
      setup(this);
    };
  },
});
