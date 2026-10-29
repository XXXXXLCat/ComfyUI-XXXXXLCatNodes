/* Keeps the built-in resolution preview honest for 🐈‍⬛FitImageToSize.

   The preview that ships with ComfyUI derives a size from three widgets: a
   ratio string, a megapixel target and a multiple. "16:9 (Widescreen)" is good
   enough for it — the ratio is read off the front — but this node's default
   option is "Auto (from image)", which is not a ratio at all, so the preview
   would show a dash on a freshly dropped node.

   Rather than drawing a second preview, this script feeds the existing one: the
   node declares two socketless inputs, `preview_ratio` and
   `preview_megapixels`, the preview is pointed at them, and this script keeps
   them filled with what the node is actually going to output.

   - Fixed ratio: the option text itself, which the preview parses directly.
   - Auto: the source image's pixel size, e.g. "1365:768". That is exactly the
     pair the node computes with, and the preview's own arithmetic (scale to the
     megapixel target, snap to the multiple) reproduces the node's result
     verbatim — using the raw pixel size rather than a reduced ratio is what
     makes it exact.

   When Auto is selected and the source size is not knowable yet (nothing wired
   up, or an upstream node whose output is not an image the browser can load),
   the ratio feed is left empty, so the preview shows the same dash it would
   show on its own rather than a made-up number.

   Nothing here carries data: without this script the node still computes and
   outputs the same size — the preview simply shows a dash.
*/

import { app } from "../../scripts/app.js";

const NODE_ID = "🐈‍⬛FitImageToSize";
const NAME = "XXXXXLCat.FitImageToSize";

const IMAGE_INPUT = "image";
const COMBO = "aspect_ratio";
const AUTO = "Auto (from image)";
const MEGAPIXELS = "megapixels";
const MULTIPLE = "multiple";
const FEED_RATIO = "preview_ratio";
const FEED_MEGAPIXELS = "preview_megapixels";

const DEFAULT_MULTIPLE = 32; // must match multiple in the schema
const DEFAULT_MEGAPIXELS = 1.0; // must match megapixels in the schema

const widgetOf = (node, name) =>
  node && node.widgets ? node.widgets.find((w) => w && w.name === name) ?? null : null;

function numberValue(node, name, fallback) {
  const value = Number(widgetOf(node, name)?.value);
  return Number.isFinite(value) ? value : fallback;
}

/* Hide a widget the official, cross-renderer way. We still flip `hidden` and
   collapse computeSize — litegraph's canvas layout measures widgets by `hidden`
   and the two flags are consulted in different places by core — but we also
   declare the widget absent from every *surface* (canvas / vueNode / panel) so
   it disappears under the VueNodes renderer too, not just litegraph. */
function setHidden(widget, hidden) {
  if (!widget) return;
  if (widget.__fsSize === undefined) {
    widget.__fsSize = typeof widget.computeSize === "function" ? widget.computeSize : null;
    widget.__fsSurfaces = widget.surfaces;
  }
  try {
    widget.hidden = hidden;
    if (widget.options) widget.options.hidden = hidden;
    widget.surfaces =
      hidden
        ? { canvas: "never", vueNode: "never", panel: "never" }
        : widget.__fsSurfaces;
  } catch (_) {}
  if (widget.__fsSize) widget.computeSize = hidden ? () => [0, -4] : widget.__fsSize;
}

/* Run our turn after whatever the widget was already doing. The Vue widgets
   call `widget.callback` on every edit, so this is what keeps the preview in
   step with the user. */
function chainCallback(widget, fn) {
  if (!widget || widget.__fsChained) return;
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
  widget.__fsChained = true;
}

/* ------------------------------------------------------------------ *
 * Source image size
 *
 * Auto mode needs the size of whatever feeds the `image` input. There is no
 * single API for that across node types, so the following are tried in order
 * and the first hit wins.
 * ------------------------------------------------------------------ */

const sizeCache = new Map(); // url -> [w, h] | null while unknown
const pendingUrls = new Set();

function linkOf(graph, id) {
  const links = graph?.links;
  if (!links) return null;
  if (typeof links.get === "function") return links.get(id) ?? null;
  return links[id] ?? null;
}

function upstreamNode(node) {
  const input = Array.isArray(node?.inputs)
    ? node.inputs.find((i) => i && i.name === IMAGE_INPUT)
    : null;
  if (!input || input.link == null) return null;
  const graph = node.graph;
  const link = linkOf(graph, input.link);
  if (!link) return null;
  const originId = Array.isArray(link) ? link[1] : link.origin_id;
  return graph?.getNodeById?.(originId) ?? null;
}

/* Nodes that already loaded an image keep the <img> elements around: the
   official LoadImage does it for its own preview, and so do most loaders. */
function sizeFromElements(node) {
  const lists = [node?.imgs, node?.images, node?.previews];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const item = list[i];
      const width = Number(item?.naturalWidth ?? item?.width);
      const height = Number(item?.naturalHeight ?? item?.height);
      if (width > 0 && height > 0) return [width, height];
    }
  }
  return null;
}

/* Loaders that name their file in a widget can be asked for the image
   directly, which works before the graph has ever run. */
function urlFromLoaderWidget(node) {
  const widget = widgetOf(node, "image") ?? widgetOf(node, "file");
  const value = widget?.value;
  if (typeof value !== "string" || !value) return null;
  const slash = value.lastIndexOf("/");
  const subfolder = slash >= 0 ? value.slice(0, slash) : "";
  const filename = slash >= 0 ? value.slice(slash + 1) : value;
  const api = app.api;
  const path =
    `/view?filename=${encodeURIComponent(filename)}` +
    `&subfolder=${encodeURIComponent(subfolder)}&type=input`;
  return typeof api?.apiURL === "function" ? api.apiURL(path) : path;
}

/* Anything that ran and reported an image (a decode node, a save node…) leaves
   its output list behind; those entries carry enough to build a view URL. */
function urlFromOutputs(node) {
  // 内部 API：app.nodeOutputs 是 ComfyUI 前端内部属性（非公共契约），
  // 前端大版本升级时可能变动；升级后需回测本预览取值逻辑。
  const images = app.nodeOutputs?.[node?.id]?.images;
  if (!Array.isArray(images) || !images.length) return null;
  const item = images[images.length - 1];
  if (!item || typeof item.filename !== "string") return null;
  const api = app.api;
  const path =
    `/view?filename=${encodeURIComponent(item.filename)}` +
    `&subfolder=${encodeURIComponent(item.subfolder ?? "")}` +
    `&type=${encodeURIComponent(item.type ?? "output")}`;
  return typeof api?.apiURL === "function" ? api.apiURL(path) : path;
}

function sizeFromUrl(url, onReady) {
  if (sizeCache.has(url)) return sizeCache.get(url);
  if (pendingUrls.has(url)) return null;
  pendingUrls.add(url);
  const image = new Image();
  image.onload = () => {
    pendingUrls.delete(url);
    sizeCache.set(url, [image.naturalWidth, image.naturalHeight]);
    onReady();
  };
  image.onerror = () => {
    pendingUrls.delete(url);
    sizeCache.set(url, null);
    onReady();
  };
  image.src = url;
  return null;
}

function sourceSize(node, onReady) {
  const source = upstreamNode(node);
  if (!source) return null;

  // A loader only reloads its preview after the user picks a new file, which
  // does not touch our widgets — so return the favour and follow its file
  // widget. The <img> it swaps in is decoded asynchronously, hence the second
  // look a moment later.
  for (const name of ["image", "file"]) {
    const widget = widgetOf(source, name);
    if (widget) chainCallback(widget, refreshSoon);
  }

  const elements = sizeFromElements(source);
  if (elements) return elements;

  const url = urlFromLoaderWidget(source) ?? urlFromOutputs(source);
  return url ? sizeFromUrl(url, onReady) : null;
}

/* ------------------------------------------------------------------ */

function sync(node) {
  if (!node) return;
  const combo = widgetOf(node, COMBO);
  if (!combo) return;

  chainCallback(combo, () => sync(node));
  chainCallback(widgetOf(node, MEGAPIXELS), () => sync(node));

  const feedRatio = widgetOf(node, FEED_RATIO);
  const feedMegapixels = widgetOf(node, FEED_MEGAPIXELS);

  const selected = combo.value;
  let ratio = selected;
  const target = numberValue(node, MEGAPIXELS, DEFAULT_MEGAPIXELS);

  if (selected === AUTO) {
    const size = sourceSize(node, () => sync(node));
    ratio = size ? `${size[0]}:${size[1]}` : "";
  }

  if (feedRatio && feedRatio.value !== ratio) feedRatio.value = ratio;
  if (feedMegapixels && feedMegapixels.value !== target) feedMegapixels.value = target;

  setHidden(feedRatio, true);
  setHidden(feedMegapixels, true);
}

function syncAll() {
  const nodes = app.graph?._nodes ?? [];
  for (const node of nodes) {
    if (node?.type !== NODE_ID) continue;
    try {
      sync(node);
    } catch (err) {
      console.error(`[${NAME}] sync failed`, err);
    }
  }
}

/* Upstream previews land a frame or two after the widget fires, so look again
   once the decoder is done rather than chasing it with a poll. */
function refreshSoon() {
  syncAll();
  setTimeout(syncAll, 150);
  setTimeout(syncAll, 600);
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

    /* Widget values are restored after the node is built, so the feeds have to
       be recomputed once more here. */
    const baseConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      if (typeof baseConfigure === "function") {
        try {
          baseConfigure.call(this, info);
        } catch (_) {}
      }
      setup(this);
    };

    /* A different upstream image means a different Auto ratio. */
    const baseConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const out =
        typeof baseConnections === "function"
          ? baseConnections.apply(this, arguments)
          : undefined;
      setup(this);
      return out;
    };
  },

  /* An upstream decode only reports its image once the graph has run, and a
     loader only swaps its image when the user picks a new file. Re-check after
     every execution so Auto catches up without polling. */
  async setup() {
    const api = app.api;
    if (!api || typeof api.addEventListener !== "function") return;
    api.addEventListener("executed", () => refreshSoon());
  },
});
