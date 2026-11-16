/* Bundle entry for the embedded canvas.
   ComfyUI never exposes window.Vue, and the canvas cannot import build-time
   modules, so the Vue runtime plus Vue Flow are compiled into one local ESM
   file that the extension imports by relative path. */
import * as Vue from "vue";
import * as VueFlow from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import { Background } from "@vue-flow/background";

import coreStyle from "@vue-flow/core/dist/style.css";
import themeStyle from "@vue-flow/core/dist/theme-default.css";
import minimapStyle from "@vue-flow/minimap/dist/style.css";

export { Vue, VueFlow, MiniMap, Background };

/* Vue Flow's base layout rules are required for transforms / handles to work.
   They are injected as one <style> tag by the canvas instead of shipping a
   separate stylesheet next to the bundle. */
export const VUEFLOW_CSS = [coreStyle, themeStyle, minimapStyle].join("\n");
