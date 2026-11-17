/* Canvas engine: Vue Flow.

   The canvas used to be a private LiteGraph instance painting into a <canvas>.
   Everything visible now lives in real DOM, driven by Vue Flow: nodes are Vue
   components, media are real <img>/<video>/<audio> elements, panning and zooming
   come from d3-zoom. ComfyUI never exposes window.Vue and the extension cannot
   resolve npm modules, so Vue and Vue Flow are compiled into
   ./vendor/vueflow.bundle.mjs (see tools/build/entry.js).

   Asset nodes now follow E:/Workspace/Workspace-XXXXXLCatNodes/infinite_canvas
   (the "infinite_canvas" frontend) numerically, not approximately:
     frame 480x270, radius 12, border/padding 0, no title bar; node name is a
     22px capsule at (8,8); white 3px selection ring (ComfyUI's
     NODE_BOX_OUTLINE_COLOR at LGraphCanvas.connections_width); media fills the
     frame with `contain` over #1D1D1F and is pointer-inert; hover tool row above
     the frame (download / delete).
     control bar 35px (7 / 36 / 8 / 10 padding, gap 8, 20px buttons with 14px
     glyphs, time in 22+9+22 fixed segments, 3px track inset 4.5px, 9px thumb,
     accent #0b8ce9, volume 60px); sliders are transform-driven, keyboard
     nudgeable and shield all pointer/wheel/dblclick events.
     audio waveform #232428 / #8b929e / #4a9eff with a #3d9cff playhead,
     rounded bars, top/bottom plot headroom, and a hover/drag grab capsule.
   Generate nodes keep the 30px form header, so their frame is 30px taller.
   The canvas background is a verbatim port of LGraphCanvas.drawBackCanvas
   (frontend LGraphCanvas.ts:5732-5770): the SAME 100x100 PNG tile as
   DEFAULT_BACKGROUND_IMAGE becomes a CanvasPattern in world coordinates,
   drawn with imageSmoothingEnabled = false (nearest neighbour), so zooming
   in keeps hard-edged lines instead of interpolating them into a blur.
   The pattern is skipped below scale 0.5, exactly like the original. */
import {
  Vue as VueNS, VueFlow as FlowNS, MiniMap, Background, VUEFLOW_CSS,
} from "./vendor/vueflow.bundle.mjs";

(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const { createApp, ref, computed, reactive, watch, onMounted, onBeforeUnmount, nextTick } = VueNS;
  const { VueFlow: VueFlowComponent, Handle, Position, BaseEdge, getBezierPath } = FlowNS;
  /* i18n loads after this file (alphabetical flow < i18n), so resolve t lazily
     at call time; every call site runs after the app is mounted. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);

  /* ------------------------------ geometry ------------------------------ */

  const SLOT_STEP = 20;            // LiteGraph.NODE_SLOT_HEIGHT
  /* Zoom range in plain scale factors: 10% .. 1000%. The upper bound matches
     ComfyUI's own ZoomControlsModal (aria-valuemax 1000) and the toolbar's
     MAX_SCALE, so the popup, the wheel and the percentage field all agree. */
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 10;

  /* Default glyph size for IcIcon. The control bar itself no longer uses
     layout tokens: its metrics come straight from ComfyUI's AudioPreviewPlayer
     (64 / 16 / 16 / 8 / 24 / 2 px), see the .icn__bar block below. */
  const ICON = 14;
  /* README.md "节点内强调色 #F2FF59 → #0B8CE9": this azure is the reference
     project's --accent-yellow override (xcat-overrides.css:4946). */
  const ACCENT = "#0b8ce9";
  /* Measured from the browser's own <video controls>, i.e. exactly what
     ComfyUI's Load Video node draws at the bottom of its preview (pixel
     sampled from a native control bar at 2x: unplayed track reads 173/255 on
     pure black => rgba(255,255,255,.66), played part is solid white).
     Both sliders (seek AND volume) share these two values so they can never
     drift apart. */
  const BAR_FILL = "#ffffff";
  const TRACK = "rgba(255,255,255,.2)";
  /* Asset media nodes: minimum width and the fixed width used when a source
     is first loaded (height then follows the source aspect ratio). */
  const ASSET_MIN_W = 320;
  const ASSET_DEF_W = 320;
  /* Node header strip — the darker band at the top of every card. ComfyUI 2.0
     builds it from LGraphNode.vue (.node-inner-wrapper = bg-node-header) plus a
     NodeHeader.vue child (p-1 around an icon-sm control), then paints the body
     with bg-node on top; the two greys are --node-header = charcoal-700
     #202121 and --node = --card = charcoal-600 #262729 (read out of the shipped
     main-*.css). HEAD_H is 28, MEASURED on a live node (NodeHeader = p-1 (4px)
     around an icon-sm Button = size-5 (20px), title text-xs): 4+20+4. It is part
     of data.size — the body gets whatever is left. */
  const HEAD_H = 28;
  const NODE_HEAD_BG = "#202121";
  const NODE_BODY_BG = "#262729";

  const WAVE_BG = "#232428";
  const WAVE_BAR = "#8b929e";
  const WAVE_PLAYED = "#4a9eff";
  const WAVE_HEAD = "#3d9cff";
  const WAVE_PAD_X = 14;
  const WAVE_UNIT = 5;
  const WAVE_PEAKS_RES = 1600;
  const WAVE_HEAD_HIT = 9;
  const WAVE_HEAD_PAD_Y = 12;

  /* Byte-identical to LGraphCanvas.DEFAULT_BACKGROUND_IMAGE (verified against
     the frontend sourcemap). Do not replace with gradients: the tile's minor
     and major line weights are part of the canvas' look. */
  const GRID_TILE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAQBJREFUeNrs1rEKwjAUhlETUkj3vP9rdmr1Ysammk2w5wdxuLgcMHyptfawuZX4pJSWZTnfnu/lnIe/jNNxHHGNn//HNbbv+4dr6V+11uF527arU7+u63qfa/bnmh8sWLBgwYJlqRf8MEptXPBXJXa37BSl3ixYsGDBMliwFLyCV/DeLIMFCxYsWLBMwSt4Be/NggXLYMGCBUvBK3iNruC9WbBgwYJlsGApeAWv4L1ZBgsWLFiwYJmCV/AK3psFC5bBggULloJX8BpdwXuzYMGCBctgwVLwCl7Be7MMFixYsGDBsu8FH1FaSmExVfAxBa/gvVmwYMGCZbBg/W4vAQYA5tRF9QYlv/QAAAAASUVORK5CYII=";
  /* LGraphCanvas.ts:1358 clear_background_color */
  const GRID_CLEAR = "#222222";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const total = Math.floor(seconds);
    return Math.floor(total / 60) + ":" + pad2(total % 60);
  };
  /* Media controls use a fixed two-digit minute clock (00:17 / 00:25), so the
     text never changes width while playing. The short form stays for the
     generic duration labels on generator panels. */
  const fmtClock = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const total = Math.floor(seconds);
    return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
  };

  /* --------------------- video thumbnail (offscreen seek) ---------------- */
  /* Mirrors the reference project's xcat-video-edit.js buildThumbs: an offscreen
     <video> seeks to an early frame and a canvas snapshots it to a data URL.
     Module-level so every generator node shares one cache / decode per url. */
  const videoThumbCache = new Map();     // url -> dataURL | null (null = failed, don't retry)
  const videoThumbBusy = new Set();      // urls currently decoding
  const videoThumbs = reactive({});      // url -> dataURL, reactive store read by templates
  const ensureVideoThumb = (url) => {
    if (!url) return;
    if (videoThumbCache.has(url)) {
      const d = videoThumbCache.get(url);
      if (d) videoThumbs[url] = d;
      return;
    }
    if (videoThumbBusy.has(url)) return;
    videoThumbBusy.add(url);
    const v = document.createElement("video");
    let finished = false;
    const finish = (dataUrl) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      v.onloadeddata = v.onseeked = v.onerror = null;
      try { v.removeAttribute("src"); v.load(); } catch (e) { /* optional */ }
      videoThumbBusy.delete(url);
      videoThumbCache.set(url, dataUrl || null);
      if (dataUrl) videoThumbs[url] = dataUrl;
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.muted = true; v.preload = "auto"; v.playsInline = true;
    v.onloadeddata = () => {
      try {
        const d = v.duration;
        v.currentTime = Number.isFinite(d) && d > 0.2 ? 0.1 : 0;
      } catch (e) { finish(null); }
    };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = v.videoWidth || 160;
        c.height = v.videoHeight || 90;
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        finish(c.toDataURL("image/jpeg", 0.72));
      } catch (e) { finish(null); }
    };
    v.onerror = () => finish(null);
    v.src = url;
  };

  /* ------------------------------- state -------------------------------- */

  const state = {
    app: null,
    host: null,
    flow: null,                       // useVueFlow() instance
    mounted: false,
    nodes: ref([]),
    edges: ref([]),
    /* ComfyUI-style visual groups: { id, title, x, y, w, h } in graph units.
       Rendered behind nodes and saved with the canvas. */
    groups: ref([]),
    groupEditing: ref(null),          // { id, value } while a group title is being renamed
    selectedGroupId: ref(null),       // groups are selected independently of nodes
    viewport: ref({ x: 0, y: 0, zoom: 1 }),
    mode: ref("select"),              // "select" | "drag"
    minimap: ref(false),
    snap: ref(false),                 // grid snap (10px) toggle
    /* Ids of the currently selected nodes. Kept here (not in an edge component)
       so every edge can turn white when either of its endpoints is selected —
       ComfyUI's LGraphCanvas.highlighted_links, derived from the selection. */
    selectedIds: ref([]),
    onDirty: null,                    // set by core
  };

  /* --------------------------- audio waveform ---------------------------- */

  const peakCache = new Map();
  let audioCtx = null;

  function hashOf(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /* mulberry32, same PRNG as xcat-audio-wave.js::rng() */
  function rngOf(seed) {
    let value = seed || 1;
    return () => {
      value |= 0;
      value = (value + 0x6D2B79F5) | 0;
      let t = Math.imul(value ^ (value >>> 15), 1 | value);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* While decodeAudioData runs, draw a deterministic placeholder so the node
     never flashes an empty block. Mirrors the reference fakePeaks(): tapered
     ends, nine Gaussian bursts and a slow tremolo. */
  function fakePeaks(seed, count) {
    const random = rngOf(hashOf(seed || "xcat"));
    const out = new Float32Array(count);
    const bursts = [];
    for (let i = 0; i < 9; i += 1) {
      bursts.push({
        c: (i + 0.5) / 9 + (random() - 0.5) * 0.05,
        w: 0.035 + random() * 0.055,
        g: 0.30 + random() * 0.70,
      });
    }
    for (let i = 0; i < count; i += 1) {
      const t = i / (count - 1);
      const edge = Math.pow(Math.sin(Math.PI * t), 0.42);
      let gain = 0.10;
      for (const burst of bursts) {
        const d = (t - burst.c) / burst.w;
        gain = Math.max(gain, burst.g * Math.exp(-d * d * 2.1));
      }
      const tremolo = 0.80 + 0.20 * Math.sin(t * 79);
      out[i] = clamp(edge * gain * tremolo * (0.62 + 0.38 * random()), 0.03, 1);
    }
    return out;
  }

  function computePeaks(buffer, count) {
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c += 1) channels.push(buffer.getChannelData(c));
    const length = channels[0].length;
    const out = new Float32Array(count);
    let max = 0;
    for (let i = 0; i < count; i += 1) {
      const start = Math.floor((i * length) / count);
      const end = Math.max(start + 1, Math.floor(((i + 1) * length) / count));
      const stride = Math.max(1, Math.floor((end - start) / 48));
      let peak = 0;
      for (let j = start; j < end; j += stride) {
        for (let k = 0; k < channels.length; k += 1) {
          const value = Math.abs(channels[k][j]);
          if (value > peak) peak = value;
        }
      }
      out[i] = peak;
      if (peak > max) max = peak;
    }
    if (max > 0) {
      for (let i = 0; i < count; i += 1) out[i] = clamp(Math.pow(out[i] / max, 1.15), 0.03, 1);
    }
    return out;
  }

  /* One fetch/decode per URL, shared by every node showing the same asset.
     onReady fires with the decoded peaks so each waveform can repaint. */
  function peaksFor(url, onReady) {
    if (!url) return null;
    let record = peakCache.get(url);
    if (!record) {
      record = { state: "loading", data: fakePeaks(url, WAVE_PEAKS_RES), waiters: [] };
      peakCache.set(url, record);
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        record.state = "failed";
      } else {
        audioCtx = audioCtx || new AudioCtx();
        fetch(url)
          .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("fetch"))))
          .then((buffer) => audioCtx.decodeAudioData(buffer))
          .then((audio) => {
            record.state = "ready";
            record.data = computePeaks(audio, WAVE_PEAKS_RES);
            for (const waiter of record.waiters) waiter(record.data);
            record.waiters.length = 0;
          })
          .catch(() => { record.state = "failed"; record.waiters.length = 0; });
      }
    }
    if (onReady) {
      if (record.state === "ready") onReady(record.data);
      else if (record.state === "loading") record.waiters.push(onReady);
    }
    return record;
  }

  /* -------------------------------- icons -------------------------------- */

  const ICONS = {
    /* lucide play / pause (official 24x24 paths) for the media control bar. */
    play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    pause: '<rect x="14" y="3" width="5" height="18" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>'
      + '<rect x="5" y="3" width="5" height="18" rx="1" stroke="currentColor" stroke-width="2" fill="none"/>',
    volume: '<path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14 H4 Z" fill="currentColor"/>'
      + '<path d="M15.5 8.5 A5 5 0 0 1 15.5 15.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 6 A8.5 8.5 0 0 1 18 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    mute: '<path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14 H4 Z" fill="currentColor"/>'
      + '<path d="M16 9.5 L21 14.5 M21 9.5 L16 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    upload: '<path d="M12 15.5 V5.5 M8 9 L12 5 L16 9" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M5 15.5 V18.5 H19 V15.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    sparkles: '<path d="M12 3 L13.7 9.3 L20 11 L13.7 12.7 L12 19 L10.3 12.7 L4 11 L10.3 9.3 Z" fill="currentColor"/>'
      + '<path d="M19 16 L19.8 18.2 L22 19 L19.8 19.8 L19 22 L18.2 19.8 L16 19 L18.2 18.2 Z" fill="currentColor"/>',
    /* lucide `settings` (v1.34) verbatim: eight-lobed cog + centre hole. The
       hand-drawn gear this replaces read as a jagged star at 14px. */
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" fill="none"/>',
    send: '<path d="M12 20 V5 M6 11 L12 5 L18 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide chevron-down / check — used by the Nodes 2.0 style select
       (SelectTrigger's SelectIcon + SelectItemIndicator). */
    "chevron-down": '<path d="M6 9.5 L12 15.5 L18 9.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide chevron-up / settings-2 — the 显示·隐藏高级输入 footer of the
       settings popover. ComfyUI's NodeFooter.vue pairs chevron-up with the
       expanded state and settings-2 with the collapsed one; kept identical. */
    "chevron-up": '<path d="M6 14.5 L12 8.5 L18 14.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "settings-2": '<path d="M14 17 H5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
      + '<path d="M19 7 H10" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
      + '<circle cx="17" cy="17" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/>'
      + '<circle cx="7" cy="7" r="3" stroke="currentColor" stroke-width="1.7" fill="none"/>',
    check: '<path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide minus / plus — ScrubableNumberInput's decrement & increment */
    minus: '<path d="M5 12 H19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    plus: '<path d="M12 5 V19 M5 12 H19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    /* lucide image / video / audio-lines / text-pen — the big glyph a generator
       node shows in place of its former "run a workflow" caption, one per
       medium. Stroked at 1.6 (not lucide's default 2) because these are drawn
       at ~56px, where a 2px stroke reads as heavy. */
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" stroke-width="1.6" fill="none"/>'
      + '<circle cx="9" cy="9" r="2" stroke="currentColor" stroke-width="1.6" fill="none"/>'
      + '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<rect x="2" y="6" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/>',
    "volume-2": '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M16 9a5 5 0 0 1 0 6" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M19.364 18.364a9 9 0 0 0 0-12.728" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    /* lucide volume-x — the muted state of the control-bar speaker. */
    "volume-x": '<path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m16.5 14.5 5-5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="m16.5 9.5 5 5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    /* lucide audio-lines — the six vertical bars used for an empty audio node
       and the audio entry in the add-node menu. */
    "audio-lines": '<path d="M2 10v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M6 6v11" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M10 3v18" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M14 8v7" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 5v13" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M22 10v3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    "text-pen": '<path d="M12 12H3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M21 5H3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
      + '<path d="M21.377 14.626a1 1 0 10-3.004-3.004l-5.01 5.012a2 2 0 00-.506.854l-.837 2.87a.5.5 0 00.62.62l2.87-.837a2 2 0 00.854-.506z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M8 19H3" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
    /* lucide shuffle — the value-control badge (ValueControlButton randomize) */
    shuffle: '<path d="M18 14 L22 18 L18 22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M18 2 L22 6 L18 10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M2 18 H3.97 A4 4 0 0 0 7.27 16.3 L12.72 7.7 A4 4 0 0 1 16.02 6 H22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M2 6 H3.97 A4 4 0 0 1 7.57 8.2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M22 18 H15.96 A4 4 0 0 1 12.66 16.2 L12.3 15.75" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide pencil-off — ValueControlButton's glyph for the "fixed" mode */
    "pencil-off": '<path d="M10 10 L3.843 16.162 A2 2 0 0 0 3.343 16.995 L2.021 21.355 A0.5 0.5 0 0 0 2.643 21.979 L7.001 20.656 A2 2 0 0 0 7.831 20.156 L14 13.982" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M12.829 7.172 L17.188 2.826 A1 1 0 1 1 21.174 6.812 L16.821 11.165" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M15 5 L19 9" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'
      + '<path d="M2 2 L22 22" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>',
    /* Lucide glyphs for the node action toolbar. Stroked at 1.8 so the 14px
       rendering stays legible next to 12px labels. Names are stable internal
       ids from TOOL_ICONS; the visible tool label is the localised one. */
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M18 22V8a2 2 0 0 0-2-2H2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "grid-3x3": '<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M9 3v18M15 3v18M3 9h18M3 15h18" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    "rotate-cw": '<path d="M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M21 3v6h-6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide rotate-3d — the 旋转 tool's 3D orbit glyph. */
    "rotate-3d": '<path d="m15.194 13.707 3.814 1.86-1.86 3.814" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M16.47214 7.52786 A 5 10 0 1 0 13 21.79796" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M21.79796 11 A 10 5 0 1 0 19 15.57071" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    rewind: '<path d="M12 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 12 18z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M22 6a2 2 0 0 0-3.414-1.414l-6 6a2 2 0 0 0 0 2.828l6 6A2 2 0 0 0 22 18z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide aperture (verbatim official 24x24): outer ring r=10 + six
       independent blade paths. Keep the original coordinates — do not merge
       into one d attribute (two segments used to be mis-transcribed and drew outside
       the viewBox, showing a stray tail). */
    aperture: '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>'
      + '<path d="m14.31 8 5.74 9.94" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M9.69 8h11.48" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m7.38 12 5.74-9.94" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M9.69 16 3.95 6.06" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M14.31 16H2.83" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="m16.62 12-5.74 9.94" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "music-2": '<circle cx="9" cy="18" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M9 18V5l12-2v13" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="21" cy="16" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    "audio-split": '<path d="M2 10v3M6 6v11M10 3v18M14 7v9M18 5v13M22 10v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    /* lucide audio-lines-off — the 音频分离 tool: audio bars crossed out. */
    "audio-lines-off": '<path d="M10 10v11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M10 3v1.35" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M14 14v1" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M14 8v.35" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 5v7.35" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M2 10v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="m2 2 20 20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M22 10v3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M6 6v11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    scissors: '<circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>'
      + '<path d="M20 4 8.1 15.9M8.1 8.1 20 20" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="1.8" fill="none"/>',
    gauge: '<path d="m12 14 4-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M3.34 19a10 10 0 1 1 17.32 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 21h16" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    "trash-2": '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m5 5v6m4-6v6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  };

  /* ---- video-generator input rules ----------------------------------
     Contract for what a VIDEO generator node may take in through wired ASSET
     nodes, per mode. TEXT IS NOT AN ASSET — a wired text node supplies the
     PROMPT, so it never appears in these rules, never fills a slot and never
     counts toward any mode's availability. Each media kind is { min, max }:
       - a kind absent from a mode is NOT ACCEPTED at all;
       - min = required count (mode is NOT selectable while under it);
       - max = cap (mode is NOT selectable while over it), null = unlimited.
     `_minMedia` is an overall lower bound counting ONLY media (image/video/
     audio). 参考生视频 needs ≥1 media asset, so it is NOT selectable on an empty
     node nor on a text-only node. 文生视频 is the pure-prompt mode: its rule
     set is EMPTY, so any wired media disables it. 图生视频 = exactly 1 image;
     首尾帧视频 = exactly 2. This single table drives the tab-disable check
     (modeReasonFor) and the active-mode fallback. */
  const VIDEO_INPUT_RULES = {
    "参考生视频": { _minMedia:1, image: {min:0,max:null}, video: {min:0,max:null}, audio: {min:0,max:null} },
    "文生视频": {},
    "图生视频":     { image: {min:1,max:1} },
    "首尾帧视频":   { image: {min:2,max:2} },
  };
  const KIND_CN = {
    image: { label: "图片", measure: "张" },
    video: { label: "视频", measure: "个" },
    audio: { label: "音频", measure: "段" },
    text:  { label: "文本", measure: "段" },
  };
  /* Fixed slot layout of the wired-assets row; null = follow actual wires. */
  const MODE_ASSET_SLOTS = {
    "参考生视频": null,
    "文生视频": [],
    "图生视频":     [{ kind: "image" }],
    "首尾帧视频":   [{ kind: "image" }, { kind: "image" }],
  };
  /* The same table for the other two generators, keyed by their own mode names.
     文生图 / 文生音乐 / 语音合成 are pure-prompt modes, so they own no slot.
     图像编辑 follows the actual wires (it may take more than one reference
     image); every other media mode pins ONE slot, so an empty node still shows
     which kind of material the active mode is waiting for. */
  const IMAGE_MODE_ASSET_SLOTS = {
    "文生图": [],
    "图像编辑": null,
    "图像放大": [{ kind: "image" }],
    "背景移除": [{ kind: "image" }],
  };
  const AUDIO_MODE_ASSET_SLOTS = {
    "文生音乐": [],
    "音乐翻唱": [{ kind: "audio" }],
    "语音合成": [],
    "语音克隆": [{ kind: "audio" }],
  };
  /* Text generator: LLM shows every wired picture / clip (it may take many
     stills), 语音转录 pins the single audio slot it consumes. */
  const TEXT_MODE_ASSET_SLOTS = {
    "智能对话":      null,
    "语音转录": [{ kind: "audio" }],
  };
  /* Audio generator accepts AUDIO + TEXT only — images and videos are refused
     at connect time (isValidConnection + onConnect), not merely mode-blocked.
     Audio belongs to the two reference-based modes (音乐翻唱 / 语音克隆) and to
     exactly ONE clip, so those tabs stay locked until a clip is wired; the two
     pure-prompt modes take no media at all (and go dark once audio arrives).
     A wired text node is a PROMPT, never a media asset: it feeds the FIRST
     area (提示词 / 语气), never 歌词 / 朗读文本. */
  const AUDIO_INPUT_RULES = {
    "文生音乐": {},
    "音乐翻唱": { audio: { min: 1, max: 1 } },
    "语音合成": {},
    "语音克隆": { audio: { min: 1, max: 1 } },
  };
  const AUDIO_MODES = Object.keys(AUDIO_INPUT_RULES);
  /* Image generator: three of its four modes CONSUME a source picture, so they
     are unselectable until one is wired. 图像编辑 takes any number of reference
     images; 图像放大 / 背景移除 upscale or cut out a SINGLE picture, so they go
     dark at two or more. 文生图 is the pure-prompt mode and refuses media. */
  const IMAGE_MODES = ["文生图", "图像编辑", "图像放大", "背景移除"];
  const IMAGE_INPUT_RULES = {
    "文生图": {},
    "图像编辑": { image: { min: 1, max: null } },
    "图像放大": { image: { min: 1, max: 1 } },
    "背景移除": { image: { min: 1, max: 1 } },
  };
  /* Text generator: LLM takes pictures, video AND audio in the same call — the
     caps mirror TextGenerateV2's autogrow template exactly (image1..50,
     video1..100, audio1..100), so the wire gate can never offer an input the
     node cannot declare. 语音转录 needs exactly one audio clip (and nothing
     else). A wired text node is the prompt and is always legal, so it never
     appears in either rule set. */
  const TEXT_INPUT_RULES = {
    "智能对话":      { image: { min: 0, max: 50 }, video: { min: 0, max: 100 }, audio: { min: 0, max: 100 } },
    "语音转录": { audio: { min: 1, max: 1 } },
  };
  /* Hard per-kind cap enforced at CONNECT time, derived from the LLM rule row so
     the gate and the tab check can never disagree. */
  const TEXT_WIRE_CAPS = {
    image: TEXT_INPUT_RULES["智能对话"].image.max,
    video: TEXT_INPUT_RULES["智能对话"].video.max,
    audio: TEXT_INPUT_RULES["智能对话"].audio.max,
  };
  /* Text node's two generator modes. They select which workflow category the
     API dropdown filters to (see activeCategory); the actual generation uses
     the same generate.run path as every other generator. */
  const TEXT_MODES = ["智能对话", "语音转录"];
  /* Which SOURCE kinds each generator kind accepts, on the node-type level.
     This is the same contract audioWireReason / imageWireReason enforce, in
     table form: the wire-release menu reads it to list only the node types
     that could legally receive the wire being dragged. `text` is a prompt and
     is accepted everywhere; the video generator takes every media kind and
     lets the ACTIVE MODE constrain (modeReasonFor) instead. */
  const GEN_ACCEPTS = {
    image: ["image", "text"],
    video: ["image", "video", "audio", "text"],
    audio: ["audio", "text"],
    text:  ["image", "video", "audio", "text"],
  };
  const acceptsKind = (genKind, srcKind) => (GEN_ACCEPTS[genKind] || []).indexOf(srcKind) >= 0;
  /* A media node is a generator only while it has no material of its own.
     Dropping a file on it sets data.asset and it becomes a material node for
     good, so every "does this accept input" question goes through here. */
  function isGenState(data) {
    return !!data && data.role === "media" && !data.asset;
  }
  function isAudioGenData(data) { return isGenState(data) && data.kind === "audio"; }
  function isVideoGenData(data) { return isGenState(data) && data.kind === "video"; }
  function isImageGenData(data) { return isGenState(data) && data.kind === "image"; }
  /* An EMPTY text node is a generator too (it owns the LLM / 语音转录 panel).
     Unlike the media nodes, incoming wires do NOT turn it into a material node:
     its whole point is to consume an image / video / audio clip. Only content
     of its own (typed text, an upload, a result) makes it material. */
  function isTextGenData(data) {
    return !!data && data.role === "text" && !data.asset && !data.result
      && !String(data.text || "").trim();
  }
  /* Music vs voice is decided by an explicit set, not a "音乐" prefix test:
     the renamed 文生音乐 no longer starts with 音乐, while 音乐翻唱 still does. */
  const MUSIC_MODES = ["文生音乐", "音乐翻唱"];
  const isMusicMode = (mode) => MUSIC_MODES.indexOf(String(mode || "")) >= 0;
  /* The reference modes that own the audio input, per family. */
  function audioRefMode(mode) {
    return isMusicMode(mode) ? "音乐翻唱" : "语音克隆";
  }
  /* Which text mode the wired media implies: a single audio clip and NOTHING
     else is transcription; every other combination is a prompt-fed LLM call
     (the node passes pictures, video and audio to the same tokenize() call, so
     mixing them is legal now). */
  function textAutoMode(counts) {
    const media = (counts.image || 0) + (counts.video || 0);
    if (counts.audio === 1 && !media) return "语音转录";
    return "智能对话";
  }
  /* What medium this node hands downstream: a material node emits its own
     file, a generator emits its declared medium (its result, once it has run,
     is that same medium). Text is a prompt but callers still key off "text". */
  function assetKindOf(node) {
    const d = node?.data;
    if (!d) return null;
    if (d.role === "text") return "text";
    return d.asset?.kind || d.result?.kind || d.kind || null;
  }
  /* Count currently wired MEDIA assets per kind, optionally ignoring one edge.
     Text nodes are prompts, not assets — they are excluded so a text wire
     never affects mode availability. */
  function incomingKindCounts(targetId, edges, nodes, exceptEdgeId) {
    const counts = {};
    for (const edge of edges) {
      if (edge.target !== targetId || edge.id === exceptEdgeId) continue;
      const kind = assetKindOf(nodes.find((n) => n.id === edge.source));
      if (!kind || kind === "text") continue;
      counts[kind] = (counts[kind] || 0) + 1;
    }
    return counts;
  }
  /* One source node wired into one target node counts as a SINGLE connection,
     no matter how many times the user drags the same wire. The pair identity
     is (source, target); handles are fixed ("out" -> "in"), so this is enough.
     Used both at connect time (reject duplicates) and at load time (collapse
     duplicates already present in a saved canvas). */
  function edgeKey(edge) { return String(edge.source) + "→" + String(edge.target); }
  function dedupeEdges(edges) {
    const seen = new Set();
    return (edges || []).filter((edge) => {
      const key = edgeKey(edge);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  /* Single source of truth: given the counts of wired assets per kind, decide
     whether `mode` is selectable. Returns "" when OK, else the reason.
     Checks BOTH bounds: kinds the mode doesn't allow, required counts (min)
     and caps (max) — so 1 image does NOT qualify for 首尾帧视频 (needs 2).
     `table` picks the rule set (video / audio generator); an unknown mode falls
     back to an EMPTY rule set = pure-prompt mode. `denyText` lets the caller
     word the "kind not accepted here" case per node type. */
  function modeReasonFor(mode, counts, table = VIDEO_INPUT_RULES, denyText = null) {
    const rules = table[mode] || {};
    /* Any wired kind this mode forbids? (metadata keys start with "_") */
    for (const kind of Object.keys(counts)) {
      if (!counts[kind]) continue;
      if (!kind.startsWith("_") && !(kind in rules)) {
        if (denyText) return denyText(kind, mode);
        const allowed = Object.keys(rules).filter((k) => !k.startsWith("_")).map((k) => KIND_CN[k]?.label || k).join("、");
        /* Empty rule set (文生视频) accepts no media at all — it's the pure
           prompt mode. */
        if (!allowed) return t("「{mode}」为纯提示词模式，不接入媒体素材", { mode: t(mode) });
        return t("「{mode}」只能接入{allowed}", { mode, allowed });
      }
    }
    /* Overall MEDIA lower bound (参考生视频 needs ≥1 image/video/audio). Text
       alone never satisfies it. Zero counts count. */
    const minMedia = rules._minMedia || 0;
    if (minMedia) {
      let media = 0;
      for (const kind of ["image", "video", "audio"]) media += counts[kind] || 0;
      if (media < minMedia) return t("「{mode}」需要至少接入 {min} 个图片/视频/音频素材，当前 {have} 个", { mode: t(mode), min: minMedia, have: media });
    }
    /* Required minimums and caps — STRICT: a required kind with 0 wired still
       fails (0 < min). No "empty node" exception. */
    for (const kind of Object.keys(rules)) {
      if (kind.startsWith("_")) continue;
      const { min, max } = rules[kind];
      const have = counts[kind] || 0;
      const cn = KIND_CN[kind] || { label: "素材", measure: "个" };
      if (min && have < min) {
        return t("「{mode}」需要 {min} {measure}{label}，当前只有 {have} {measure}", { mode: t(mode), min, measure: t(cn.measure), label: t(cn.label), have });
      }
      if (max !== null && have > max) {
        return t("「{mode}」最多接入 {max} {measure}{label}", { mode: t(mode), max, measure: t(cn.measure), label: t(cn.label) });
      }
    }
    return "";
  }

  /* Fallback workflow options if the backend list is unavailable. */
  const WF_FALLBACK = [
    { id: "video", name: "文生视频" },
    { id: "image", name: "文生图" },
    { id: "audio", name: "文生音频" },
    { id: "text", name: "生成文本" },
  ];

  /* Shared workflow list for the bottom-left selector of every generate node.
     The API 配置 dialog (js/infcanvas-api-config.js) dispatches
     "infcanvas:workflows-changed" after upload / reorder / delete — this is
     the same wiring as the reference project's
     "infinite-canvas:workflows-changed" -> useGraph.loadWorkflowNames(true).
     One module-level listener keeps all node selectors in sync. */
  const SHARED_WF_LIST = ref([]);
  const loadWorkflows = (force = false) => {
    if (!force && SHARED_WF_LIST.value.length && SHARED_WF_LIST.value !== WF_FALLBACK) return;
    Promise.resolve(NS.backend?.workflows?.())
      .then((res) => {
        const list = Array.isArray(res?.workflows) ? res.workflows : [];
        SHARED_WF_LIST.value = list.length ? list : WF_FALLBACK;
      })
      .catch(() => { SHARED_WF_LIST.value = WF_FALLBACK; });
  };
  window.addEventListener("infcanvas:workflows-changed", () => loadWorkflows(true));

  const IcIcon = {
    props: { name: { type: String, required: true }, size: { type: Number, default: ICON } },
    setup(props) {
      return () => VueNS.h("svg", {
        viewBox: "0 0 24 24",
        width: props.size,
        height: props.size,
        innerHTML: ICONS[props.name] || "",
      });
    },
  };

  /* --------------------- wired-asset row (shared) ------------------------
     The video generator's thumbnail row, extracted verbatim so the image and
     audio generators get the SAME 40px slot, the SAME extracted video frame
     and the SAME hover preview instead of two hand-drawn lookalikes. Owns its
     own hover state: one preview at a time, and the preview lives INSIDE the
     slot wrapper, so moving the pointer from the thumbnail up into the player
     stays within the same DOM subtree and the media keeps playing. */
  const MediaSlots = {
    name: "MediaSlots",
    components: { IcIcon },
    props: { slots: { type: Array, default: () => [] } },
    setup(props) {
      const previewKey = ref(null);
      const duration = ref("0:00");
      const enter = (slot) => {
        if (!slot || !slot.asset) return;
        previewKey.value = slot.key;
        duration.value = "0:00";
      };
      const leave = () => { previewKey.value = null; };
      const meta = (event) => { duration.value = fmtTime(event && event.target && event.target.duration); };
      /* Empty slot title doubles as the hint: it names the kind the mode needs. */
      const title = (slot) => {
        if (slot.asset) return slot.asset.name;
        return (KIND_CN[slot.kind] ? KIND_CN[slot.kind].label : "素材") + "槽（连接对应素材节点）";
      };
      return { previewKey, duration, enter, leave, meta, title, videoThumbs };
    },
    template: `
      <div v-if="slots.length" class="icn__gpv-assets">
        <template v-for="slot in slots" :key="slot.key">
          <div class="icn__gpv-slot" @mouseenter="enter(slot)" @mouseleave="leave">
            <div class="icn__gpv-asset" :class="{ 'icn__gpv-asset--empty': !slot.asset }"
                 :title="title(slot)">
              <img v-if="slot.asset && slot.kind === 'image' && slot.asset.url" :src="slot.asset.url" alt="" draggable="false" />
              <template v-else-if="slot.asset && slot.kind === 'video'">
                <img v-if="videoThumbs[slot.asset.url]" :src="videoThumbs[slot.asset.url]" alt="" draggable="false" />
                <IcIcon class="icn__gpv-asset-play" name="play" :size="18" />
              </template>
              <IcIcon v-else-if="slot.asset" :name="slot.kind === 'audio' ? 'volume' : 'sparkles'" :size="15" />
              <IcIcon v-else name="upload" :size="14" />
              <span v-if="slot.asset" class="icn__gpv-asset-label">{{ slot.asset.label }}</span>
            </div>
            <div v-if="slot.asset && slot.asset.url && previewKey === slot.key"
                 class="icn__gpv-preview nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
              <img v-if="slot.kind === 'image'" class="icn__gpv-preview-media" :src="slot.asset.url" alt="" draggable="false" />
              <video v-else-if="slot.kind === 'video'" class="icn__gpv-preview-media" :src="slot.asset.url"
                     autoplay loop playsinline></video>
              <template v-else-if="slot.kind === 'audio'">
                <audio class="icn__gpv-preview-audio-hidden" :src="slot.asset.url"
                       autoplay @loadedmetadata="meta"></audio>
                <div class="icn__gpv-preview-audio-meta">
                  <span class="icn__gpv-preview-audio-name">{{ slot.asset.label }}</span>
                  <span class="icn__gpv-preview-audio-time">{{ duration }}</span>
                </div>
              </template>
              <div v-if="slot.kind === 'image' || slot.kind === 'video'" class="icn__gpv-preview-name">{{ slot.asset.label }}</div>
            </div>
          </div>
        </template>
      </div>`,
  };

  /* --------------------------- media elements ---------------------------- */

  /* The three asset nodes are a DOM port of the reference project's
     xcat-media-controls.js / xcat-audio-wave.js / VideoPlayer.vue:
       - media elements are inert (pointer-events:none), so dragging the node
         and clicking the canvas keep working
       - one control bar for video AND audio: transform-driven sliders
         (scaleX / translate3d, never layout), three fixed-width time segments,
         rAF painting, pointer capture, keyboard nudges, full event shield
       - audio waveform: decodeAudioData peaks, rounded bars, plot box with
         top/bottom headroom, a playhead that turns into a grab capsule on hover
         and is the ONLY thing that can seek
     Sources:
       frontend/public/assets/xcat-media-controls.js  (mkSlider / buildBar)
       frontend/public/assets/xcat-audio-wave.js      (plotBox / draw / hitHead)
       frontend/src/styles/xcat-overrides.css         (.xcat-mbar / --xw-*)
       frontend/src/components/Node/VideoPlayer.vue  (icons / .vp-video)      */
  const STOP_EVENTS = ["mousedown", "mouseup", "click", "pointerdown", "pointerup",
    "touchstart", "wheel", "dblclick"];

  /* Slider geometry: the track leaves 10px at BOTH ends of the slider box, so
     the visible line is inset 10px from the card edge and the 12px hover knob
     (radius 6) stays fully inside it even at ratio 0 / 1. Fill width and thumb
     left are driven in px, not transforms, so zoom never blurs the line. */
  const KNOB_INSET = 10;

  function makeSlider(root, onInput) {
    const fill = root.querySelector(".icn__slider-fill");
    const thumb = root.querySelector(".icn__slider-thumb");
    let ratio = 0, dragging = false, spanPx = 0, lastPct = -1;
    const measure = () => {
      spanPx = Math.max(0, root.clientWidth - KNOB_INSET * 2);
    };
    const paint = () => {
      const travel = spanPx || Math.max(0, root.clientWidth - KNOB_INSET * 2);
      const px = ratio * travel;
      fill.style.width = px + "px";
      thumb.style.left = (KNOB_INSET + px) + "px";
      const pct = Math.round(ratio * 100);
      if (pct !== lastPct) { lastPct = pct; root.setAttribute("aria-valuenow", String(pct)); }
    };
    const at = (clientX) => {
      const box = root.getBoundingClientRect();
      const travel = box.width - KNOB_INSET * 2;
      return clamp(travel > 0 ? (clientX - box.left - KNOB_INSET) / travel : 0, 0, 1);
    };
    const apply = (value, fire) => {
      ratio = clamp(value, 0, 1);
      paint();
      if (fire) onInput(ratio);
    };
    const onDown = (event) => {
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      dragging = true;
      /* Pin the expandable volume track open for the whole gesture, otherwise
         leaving the 84px strip collapses it to width:0 and the next pointermove
         maps against zero width -> value snaps to 100% (the "slider overshoots"
         bug). The class is also mirrored on the group so the pill keeps its
         background while the pointer is outside it. */
      root.classList.add("is-dragging");
      root.parentElement?.classList.add("is-dragging");
      try { root.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      measure();
      apply(at(event.clientX), true);
    };
    const onMove = (event) => {
      if (!dragging) return;
      event.stopPropagation();
      apply(at(event.clientX), true);
    };
    const onUp = (event) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove("is-dragging");
      root.parentElement?.classList.remove("is-dragging");
      try { root.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
    };
    const onKey = (event) => {
      const step = event.key === "ArrowRight" || event.key === "ArrowUp" ? 0.02
        : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -0.02 : 0;
      if (!step) return;
      event.preventDefault();
      event.stopPropagation();
      apply(ratio + step, true);
    };
    root.addEventListener("pointerdown", onDown);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
    root.addEventListener("pointercancel", onUp);
    root.addEventListener("keydown", onKey);
    const ro = window.ResizeObserver ? new ResizeObserver(() => { measure(); paint(); }) : null;
    if (ro) ro.observe(root);
    measure();
    paint();
    return {
      set: (value) => apply(value, false),
      destroy() {
        root.removeEventListener("pointerdown", onDown);
        root.removeEventListener("pointermove", onMove);
        root.removeEventListener("pointerup", onUp);
        root.removeEventListener("pointercancel", onUp);
        root.removeEventListener("keydown", onKey);
        if (ro) ro.disconnect();
      },
    };
  }

  function useMediaPlayer(getUrl) {
    const el = ref(null);                 // <video> / <audio>
    const bar = ref(null);                // .icn__bar
    const playing = ref(false);
    const timeText = ref("0:00");
    const durationText = ref("0:00");
    const muteIcon = ref("volume-2");
    let raf = 0, lastSec = -1, seek = null, vol = null;
    let boundMedia = null, boundRoot = null;
    const listeners = [];

    const duration = () => {
      const value = el.value?.duration;
      return value && Number.isFinite(value) && value > 0 ? value : 0;
    };
    const repaint = () => {
      const media = el.value;
      if (!media || !seek) return;
      const total = duration();
      seek.set(total ? clamp((media.currentTime || 0) / total, 0, 1) : 0);
      const second = Math.floor(media.currentTime || 0);
      if (second !== lastSec) {
        lastSec = second;
        timeText.value = fmtClock(media.currentTime || 0);
        durationText.value = fmtClock(total);
      }
    };
    const frame = () => {
      if (!playing.value) return;
      repaint();
      raf = requestAnimationFrame(frame);
    };
    const syncVol = () => {
      const media = el.value;
      if (!media) return;
      const silent = media.muted || media.volume === 0;
      if (vol) vol.set(silent ? 0 : media.volume);
      muteIcon.value = silent ? "volume-x" : "volume-2";
    };
    const toggle = () => {
      const media = el.value;
      if (!media || !media.getAttribute("src")) return;
      if (media.paused) {
        const promise = media.play();
        if (promise?.catch) promise.catch(() => { playing.value = false; });
      } else media.pause();
    };
    const toggleMute = () => {
      const media = el.value;
      if (!media) return;
      media.muted = !media.muted;
      if (!media.muted && media.volume === 0) media.volume = 0.5;
      syncVol();
    };
    const onLoaded = () => {
      const media = el.value;
      if (!media) return;
      /* preload="metadata" leaves the first frame undecoded: nudge the decoder
         so the video poster is not black. */
      if (!media.videoWidth && media.readyState >= 1) {
        try { media.currentTime = Math.min(0.05, (media.duration || 1) / 100); } catch (error) { /* optional */ }
      }
      lastSec = -1;
      repaint();
    };
    const onPlayEvent = () => {
      playing.value = true;
      cancelAnimationFrame(raf);
      frame();
    };
    const onPauseEvent = () => {
      playing.value = false;
      cancelAnimationFrame(raf);
      lastSec = -1;
      repaint();
    };
    const onTimeUpdate = () => { if (!playing.value) { lastSec = -1; repaint(); } };

    const listen = (target, type, fn) => {
      target.addEventListener(type, fn);
      listeners.push([target, type, fn]);
    };
    const teardown = () => {
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      listeners.length = 0;
      seek?.destroy(); vol?.destroy();
      seek = null; vol = null;
      cancelAnimationFrame(raf);
      boundMedia = null; boundRoot = null;
    };

    /* Called on mount and whenever a node acquires a media element. Rebinding
       is idempotent, so switching a node's asset never duplicates listeners. */
    function install() {
      const root = bar.value, media = el.value;
      if (!root || !media) return;
      if (boundMedia === media && boundRoot === root) return;
      teardown();
      boundMedia = media; boundRoot = root;
      const seekRoot = root.querySelector(".icn__seek");
      const volRoot = root.querySelector(".icn__vol");
      if (!seekRoot) return;

      seek = makeSlider(seekRoot, (ratio) => {
        const total = duration();
        if (!total) return;
        try { media.currentTime = ratio * total; } catch (error) { /* optional */ }
        lastSec = -1;
        repaint();
      });
      /* Volume slider (native-control behaviour): hover the speaker to reveal
         it; dragging adjusts volume, not just mute. */
      if (volRoot) vol = makeSlider(volRoot, (ratio) => {
        media.volume = ratio;
        if (ratio > 0 && media.muted) media.muted = false;
        syncVol();
      });

      /* The bar must never reach Vue Flow's node drag handler, the pane's
         dblclick menu, or the canvas wheel zoom. */
      for (const type of STOP_EVENTS) {
        listen(root, type, (event) => event.stopPropagation());
      }
      listen(media, "loadedmetadata", onLoaded);
      listen(media, "durationchange", () => { lastSec = -1; repaint(); });
      listen(media, "timeupdate", onTimeUpdate);
      listen(media, "seeked", () => { lastSec = -1; repaint(); });
      listen(media, "play", onPlayEvent);
      listen(media, "pause", onPauseEvent);
      listen(media, "ended", onPauseEvent);
      listen(media, "volumechange", syncVol);
      syncVol();
      lastSec = -1;
      repaint();
    }

    onMounted(() => nextTick(install));
    /* Uploading a different kind of file replaces <video> with <audio> (or
       vice versa); the bar must follow the new element. */
    watch(el, () => nextTick(install));
    onBeforeUnmount(() => {
      teardown();
      const media = el.value;
      if (media) {
        try { media.pause(); media.removeAttribute("src"); media.load(); } catch (error) { /* optional */ }
      }
    });
    watch(getUrl, () => {
      playing.value = false;
      timeText.value = "00:00";
      durationText.value = "00:00";
      lastSec = -1;
      repaint();
    });

    return { el, bar, playing, timeText, durationText, muteIcon, toggle, toggleMute, onLoaded, install };
  }

  /* ---------------------------- audio waveform --------------------------- */

  function capsule(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function useAudioWave(getUrl, getMedia, isEnabled) {
    const host = ref(null);
    const canvas = ref(null);
    const inst = {
      w: 0, h: 0, progress: 0, peaks: null, raf: 0, dead: false,
      playing: false, dragging: false, hoverHead: false, dragDX: 0,
      lastX: null, lastY: null,
    };
    let ro = null;

    /* Centre the waveform on the WHOLE node: identical headroom above and
       below, with no allowance for the title strip or the control row. */
    const plotBox = (height) => {
      const margin = Math.max(8, height * 0.2);
      return { top: margin, bottom: margin, h: Math.max(6, height - margin * 2) };
    };
    const plotW = () => Math.max(1, inst.w - WAVE_PAD_X * 2);
    const headX = () => WAVE_PAD_X + clamp(inst.progress, 0, 1) * plotW();
    const hitHead = (clientX, clientY) => {
      const element = host.value;
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      const box = plotBox(inst.h);
      return Math.abs(x - headX()) <= WAVE_HEAD_HIT &&
        y >= box.top - WAVE_HEAD_PAD_Y && y <= box.top + box.h + WAVE_HEAD_PAD_Y;
    };
    const colors = () => {
      const element = host.value;
      const style = element ? getComputedStyle(element) : null;
      const read = (name, fallback) => (style?.getPropertyValue(name) || "").trim() || fallback;
      return {
        bar: read("--icw-bar", WAVE_BAR),
        played: read("--icw-played", WAVE_PLAYED),
        head: read("--icw-head", WAVE_HEAD),
        headFg: read("--icw-head-fg", "#ffffff"),
        bg: read("--icw-bg", WAVE_BG),
      };
    };
    const resample = (peaks, count) => {
      const out = new Float32Array(count);
      if (!peaks?.length) return out;
      for (let i = 0; i < count; i += 1) {
        const start = Math.floor((i * peaks.length) / count);
        const end = Math.max(start + 1, Math.floor(((i + 1) * peaks.length) / count));
        let value = 0;
        for (let j = start; j < end && j < peaks.length; j += 1) value = Math.max(value, peaks[j]);
        out[i] = value;
      }
      return out;
    };

    const measure = () => {
      const rect = host.value?.getBoundingClientRect();
      inst.w = rect ? Math.max(1, Math.round(rect.width)) : 1;
      inst.h = rect ? Math.max(1, Math.round(rect.height)) : 1;
    };

    const draw = () => {
      const element = canvas.value;
      if (!element || !inst.w || !inst.h || inst.dead) return;
      const width = inst.w, height = inst.h;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelW = Math.round(width * dpr), pixelH = Math.round(height * dpr);
      if (element.width !== pixelW || element.height !== pixelH) {
        element.width = pixelW;
        element.height = pixelH;
      }
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const col = colors();
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, width, height);

      const span = plotW();
      const box = plotBox(height);
      const count = Math.max(12, Math.min(260, Math.floor(span / WAVE_UNIT)));
      const peaks = resample(inst.peaks, count);
      const middle = box.top + box.h / 2;
      const step = span / count;
      const lineWidth = Math.max(1.5, Math.min(3, step * 0.58));
      const hx = headX();
      const grabbed = inst.hoverHead || inst.dragging;

      ctx.lineCap = "round";
      for (let i = 0; i < count; i += 1) {
        const x = WAVE_PAD_X + (i + 0.5) * step;
        const barH = Math.max(2, peaks[i] * box.h);
        ctx.strokeStyle = x <= hx ? col.played : col.bar;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x, middle - barH / 2);
        ctx.lineTo(x, middle + barH / 2);
        ctx.stroke();
      }

      ctx.strokeStyle = col.head;
      ctx.lineWidth = grabbed ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(hx + 0.5, box.top);
      ctx.lineTo(hx + 0.5, box.top + box.h);
      ctx.stroke();

      if (!grabbed) {
        ctx.fillStyle = col.head;
        ctx.beginPath();
        ctx.arc(hx, box.top, 5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const capX = clamp(hx - 16, 1, Math.max(1, width - 33));
        const centre = capX + 16;
        ctx.fillStyle = col.head;
        capsule(ctx, capX, box.top - 9, 32, 18, 9);
        ctx.fill();
        ctx.strokeStyle = col.headFg;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(centre - 6, box.top - 3.5);
        ctx.lineTo(centre - 9.5, box.top);
        ctx.lineTo(centre - 6, box.top + 3.5);
        ctx.moveTo(centre + 6, box.top - 3.5);
        ctx.lineTo(centre + 9.5, box.top);
        ctx.lineTo(centre + 6, box.top + 3.5);
        ctx.stroke();
      }
    };

    const sync = () => {
      const media = getMedia();
      if (media && Number.isFinite(media.duration) && media.duration > 0) {
        inst.progress = clamp((media.currentTime || 0) / media.duration, 0, 1);
      }
      /* The playhead moves while playing; re-evaluate hover even if the mouse
         is still, or the grab capsule drifts away from the blue line. */
      if (!inst.dragging && inst.lastX != null) {
        const over = hitHead(inst.lastX, inst.lastY);
        if (over !== inst.hoverHead) {
          inst.hoverHead = over;
          if (host.value) host.value.style.cursor = over ? "ew-resize" : "";
        }
      }
    };
    const loop = () => {
      if (inst.dead || !inst.playing) return;
      if (!inst.dragging) sync();
      draw();
      inst.raf = requestAnimationFrame(loop);
    };
    const seekAt = (clientX) => {
      const rect = host.value?.getBoundingClientRect();
      if (!rect) return;
      const ratio = clamp((clientX - rect.left - WAVE_PAD_X) / plotW(), 0, 1);
      const media = getMedia();
      if (media && Number.isFinite(media.duration) && media.duration > 0) {
        try { media.currentTime = ratio * media.duration; } catch (error) { /* optional */ }
      }
      inst.progress = ratio;
      draw();
    };

    const onDown = (event) => {
      if (!hitHead(event.clientX, event.clientY)) return;  // blank: drag the node
      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      const rect = host.value.getBoundingClientRect();
      inst.dragDX = event.clientX - (rect.left + headX());
      inst.dragging = true;
      inst.hoverHead = true;
      host.value.style.cursor = "ew-resize";
      try { host.value.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      draw();
    };
    /* d3-drag listens on mousedown in the bubble phase; the waveform is a
       descendant, so stopping here is early enough to keep the node still. */
    const onMouseDown = (event) => {
      if (hitHead(event.clientX, event.clientY)) {
        event.stopPropagation();
        if (event.cancelable) event.preventDefault();
      }
    };
    const onMove = (event) => {
      inst.lastX = event.clientX;
      inst.lastY = event.clientY;
      if (inst.dragging) { seekAt(event.clientX - inst.dragDX); return; }
      const over = hitHead(event.clientX, event.clientY);
      if (over !== inst.hoverHead) {
        inst.hoverHead = over;
        host.value.style.cursor = over ? "ew-resize" : "";
        draw();
      }
    };
    const onUp = (event) => {
      if (!inst.dragging) return;
      inst.dragging = false;
      try { host.value.releasePointerCapture(event.pointerId); } catch (error) { /* optional */ }
      inst.hoverHead = event.clientX != null ? hitHead(event.clientX, event.clientY) : false;
      host.value.style.cursor = inst.hoverHead ? "ew-resize" : "";
      draw();
    };
    const onLeave = () => {
      if (inst.dragging) return;
      inst.lastX = inst.lastY = null;
      inst.hoverHead = false;
      if (host.value) host.value.style.cursor = "";
      draw();
    };

    const loadPeaks = () => {
      const url = getUrl();
      const record = peaksFor(url, (data) => { inst.peaks = data; draw(); });
      inst.peaks = record?.data || fakePeaks(url, WAVE_PEAKS_RES);
      draw();
    };

    const attachMedia = () => {
      const media = getMedia();
      if (!media || media.dataset.icwBound === "1") return;
      media.dataset.icwBound = "1";
      media.addEventListener("play", () => {
        inst.playing = true;
        cancelAnimationFrame(inst.raf);
        loop();
      });
      media.addEventListener("pause", () => {
        inst.playing = false;
        cancelAnimationFrame(inst.raf);
        sync(); draw();
      });
      media.addEventListener("timeupdate", () => { if (!inst.dragging) { sync(); draw(); } });
      media.addEventListener("loadedmetadata", () => { sync(); draw(); });
      media.addEventListener("ended", () => { inst.playing = false; inst.progress = 0; draw(); });
    };

    const ensureObservers = () => {
      if (ro || !window.ResizeObserver || !host.value) return;
      ro = new ResizeObserver(() => { measure(); draw(); });
      ro.observe(host.value);
    };
    const activate = () => {
      measure();
      attachMedia();
      loadPeaks();
      ensureObservers();
      draw();
    };
    onMounted(() => {
      if (!isEnabled()) return;   // image / video / text nodes need no decode
      activate();
      /* The media element can appear a tick later when an asset is attached to
         an existing empty node. */
      nextTick(attachMedia);
    });
    watch(getUrl, () => {
      if (!isEnabled()) return;
      inst.progress = 0;
      inst.hoverHead = false;
      inst.dragging = false;
      nextTick(activate);
    });
    /* The waveform canvas is sized from getBoundingClientRect(), which already
       includes the viewport's scale(zoom). A ResizeObserver only fires on layout
       changes — not on zoom — so without this the backing store stays sized for
       the old zoom and the canvas is upscaled as a blurry bitmap when zoomed in.
       Re-measure + redraw on every zoom change to keep it pixel-crisp. */
    watch(() => state.viewport.value.zoom, () => {
      if (!isEnabled()) return;
      /* Defer so the viewport transform is already applied to the DOM before we
         read getBoundingClientRect() — otherwise we may measure the old size. */
      nextTick(() => { measure(); draw(); });
    });
    onBeforeUnmount(() => {
      inst.dead = true;
      cancelAnimationFrame(inst.raf);
      if (ro) ro.disconnect();
    });

    return { host, canvas, onDown, onMouseDown, onMove, onUp, onLeave, draw, attachMedia };
  }

  /* ------------------------------ node view ------------------------------ */

  const IcNode = {
    name: "IcNode",
    components: { Handle, IcIcon, MediaSlots },
    props: { id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean },
    setup(props) {
      const data = props.data;
      /* computed: clicking "upload" on an empty node can turn it into a video
         or audio node, so the rendered branch must follow data.kind live. */
      const kind = computed(() => data.kind || "image");
      /* ONE node type per medium. `isGen` means "this media node is still a
         generator": no material of its own yet, so it owns the input handle and
         the parameter panel. Dropping a file on it sets data.asset and it turns
         into a material node — a final state, hence computed: the flip has to
         re-render this very node in place. */
      const isMedia = data.role === "media";
      const isGen = computed(() => isMedia && !data.asset);
      /* Text nodes are their own role (neither media nor generator): they keep
         the asset-style frameless look but also accept an input handle. */
      const isText = data.role === "text";
      /* A material node shows its material; a generator shows its last result.
         Material wins: once a node flips to material it never flips back, so a
         stale result can never shadow the file the user dropped on it. */
      const assetOf = computed(() => data.asset || data.result || null);
      const url = computed(() => {
        const asset = assetOf.value;
        if (!asset) return "";
        return asset.url || NS.api?.viewUrl?.(asset) || "";
      });
      /* Does a text node hold anything at all? Drives both its empty-state
         glyph and whether its upload slot is still available. */
      const hasText = computed(() =>
        !!(data.text || data.asset?.text || data.asset?.name || "").trim());

      /* Is anything wired into this node's input? Live, so the upload action
         appears/disappears the moment a wire is connected or cut. */
      const hasIncoming = computed(() => {
        const edges = NS.flow?.edgesOf?.() || [];
        return edges.some((edge) => edge.target === props.id);
      });
      /* An EMPTY text node is a generator: it shows the same bottom panel as
         the media generators, with two modes (LLM / 语音转录). Incoming WIRES
         do NOT turn it into material — the point of an LLM node is to read the
         picture / video wired into it, and 语音转录 reads the wired clip. Only
         content of its own (typed text, an uploaded file, a result) makes it a
         material node and retires the panel, the same one-way rule the media
         nodes follow. */
      /* 生成结果回显在节点自己身上（data.result），所以它有 result 时仍然是
         生成器：面板留在这儿才能再次运行，正文把结果文本显示出来。 */
      const isGenText = computed(() => isText && !data.asset && !hasText.value);
      const textModes = TEXT_MODES;
      const textMode = computed(() => (TEXT_MODES.indexOf(data.textMode) >= 0
        ? data.textMode : TEXT_MODES[0]));
      /* The guard mirrors setVideoMode: wires decide modes, so a mode the wired
         media cannot satisfy is refused with its reason instead of silently
         being selected. */
      const setTextMode = (mode) => {
        if (TEXT_MODES.indexOf(mode) < 0 || mode === textMode.value) return;
        const reason = textModeReason(mode);
        if (reason) {
          NS.api?.toast?.("warning", t("该模式不可选"), reason);
          return;
        }
        patch({ textMode: mode });
      };
      /* Which nodes own a bottom generator panel: all media generators plus an
         empty text node. Kept separate from isGen because the text node still
         renders its body as editable text / upload slot, not as media. */

      const media = useMediaPlayer(() => url.value);
      const wave = useAudioWave(() => url.value, () => media.el.value, () => kind.value === "audio");
      /* A generate node's bottom strip is reserved for its parameter bar;
         playback of a generated video/audio lives in the node's own body, which
         shows the result it keeps in data.result. */
      const bar = computed(() => (kind.value === "video" || kind.value === "audio") && !!assetOf.value);
      const hasMedia = computed(() => !!assetOf.value && (kind.value === "image" || kind.value === "video" || kind.value === "audio"));

      /* Every node shares the same card: data.size IS the whole frame, the
         header strip eats the top HEAD_H and the body gets the rest. */
      const size = computed(() => Array.isArray(data.size) ? data.size : [320, 180]);
      const bodyH = computed(() => Math.max(80, size.value[1] - HEAD_H));
      const rootStyle = computed(() => ({
        width: size.value[0] + "px",
        height: bodyH.value + HEAD_H + "px",
      }));
      /* Ports sit on the body, not on the card: keep them centred on the content
         area so a wire never lands on the header edge. */
      const handleTop = (index, count = 1) =>
        `calc(50% + ${HEAD_H / 2 + (index - (count - 1) / 2) * SLOT_STEP}px)`;

      /* ---- resize (four corners) ---- */
      /* `corner` is a compass label: "nw" | "ne" | "sw" | "se". Each handle
         keeps the OPPOSITE edges fixed and only moves its own two edges, so
         resizing from any corner behaves like ComfyUI's corner grips. */
      const resizing = ref("");
      const onResizeDown = (event, corner = "se") => {
        event.preventDefault();
        event.stopPropagation();
        /* The node's CSS width/height live in canvas/logical pixels, but the
           viewport applies a `zoom` transform. Mouse movement is in screen
           pixels, so divide by the live zoom — otherwise, at any zoom other
           than 100%, the handle drifts away from the cursor while resizing. */
        const zoom = NS.flow?.getViewport?.().zoom || 1;
        const startX = event.clientX;
        const startY = event.clientY;
        const live = NS.flow?.findNode?.(props.id);
        const x0 = live?.position?.x ?? 0;
        const y0 = live?.position?.y ?? 0;
        const [w0, h0] = size.value;
        const west = corner.indexOf("w") >= 0;     // left edge moves
        const north = corner.indexOf("n") >= 0;   // top edge moves
        const snapped = () => !!NS.flow?.snap?.enabled?.();
        const snap10 = (v) => Math.round(v / 10) * 10;
        /* Asset media, generated media and text nodes all use the frameless
           320px-minimum card; only the legacy unknown kinds keep 160. */
        const isMediaLike = kind.value === "image" || kind.value === "video" || kind.value === "audio" || kind.value === "text";
        const MINW = isMediaLike ? ASSET_MIN_W : 160, MINH = HEAD_H + 80;
        resizing.value = corner;
        const move = (ev) => {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          let w = w0 + (west ? -dx : dx);
          let h = h0 + (north ? -dy : dy);
          let x = x0 + (west ? dx : 0);   // fixed right edge when dragging left
          let y = y0 + (north ? dy : 0);  // fixed bottom edge when dragging top
          /* Min size: clamp, then re-pin the fixed edge so the opposite side
             never creeps while the dragged side hits the limit. */
          if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
          if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
          /* Grid snap: align the MOVING edge to the nearest 10px cell (the
             canvas grid tile is 100x100 with a 10px minor square), keeping
             the opposite edge pinned. Same step as node-move snapping. */
          if (snapped()) {
            if (west) { x = snap10(x); w = (x0 + w0) - x; }
            else { w = snap10(x0 + w) - x0; }
            if (north) { y = snap10(y); h = (y0 + h0) - y; }
            else { h = snap10(y0 + h) - y0; }
            if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
            if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
          }
          w = Math.round(w); h = Math.round(h);
          x = Math.round(x); y = Math.round(y);
          patch({ size: [w, h] });
          NS.flow?.setNodePosition?.(props.id, { x, y });
        };
        const up = () => {
          resizing.value = "";
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
      };

      /* Vue Flow's parseNode() copies each node into its own store. The node
         component edits that copy, while the document (and therefore `save`)
         holds the source array. Every mutation must touch both. */
      const patch = (fields, options) => {
        for (const [key, value] of Object.entries(fields)) data[key] = value;
        NS.flow?.updateNodeData?.(props.id, fields);
        /* `silent` = derived/normalised write, not a user edit: keep it out of
           the undo stack (see historyAbsorb). */
        if (options?.silent) NS.flow?.history?.absorb?.();
        NS.flow?.markDirty?.();
      };
      /* Typing in the prompt box (rich editor or plain textarea) marks the
         value as the user's own, so a later API-default fetch never overwrites
         it. Other fields keep the plain write. */
      const setField = (key, value) => patch(
        key === "prompt" ? { prompt: value, promptEdited: true } : { [key]: value }
      );
      const run = () => NS.generate?.run?.(props.id);
      /* Generate-node control bar: compact selects mirroring the reference
         video-generator toolbar, wired to this node's real parameters. */
      /* Image generator has two categories mirroring the API workflow
         categories; its API selector is filtered to the active one below. */
      const imageModes = IMAGE_MODES;
      const isGenImage = computed(() => isGen.value && kind.value === "image");
      const imageMode = computed(() => (imageModes.indexOf(data.imageMode) >= 0
        ? data.imageMode : imageModes[0]));
      /* Same contract as setVideoMode / setTextMode: the wired pictures decide
         which modes can be entered (see IMAGE_INPUT_RULES). */
      const setImageMode = (mode) => {
        if (imageModes.indexOf(mode) < 0 || mode === imageMode.value) return;
        const reason = imageModeReason(mode);
        if (reason) {
          NS.api?.toast?.("warning", t("该模式不可选"), reason);
          return;
        }
        patch({ imageMode: mode });
      };
      const sizePresets = [
        { value: "512x512", label: "512×512" },
        { value: "512x768", label: "512×768" },
        { value: "768x512", label: "768×512" },
        { value: "768x768", label: "768×768" },
        { value: "1024x1024", label: "1024×1024" },
        { value: "1024x576", label: "1024×576" },
        { value: "1280x720", label: "1280×720" },
        { value: "1920x1080", label: "1920×1080" },
      ];
      const sizeValue = computed(() => (data.width || 512) + "x" + (data.height || 512));
      const setSize = (value) => {
        const [w, h] = String(value).split("x").map(Number);
        if (w > 0 && h > 0) patch({ width: w, height: h });
      };
      /* ---- video-generator panel data (reference video node layout) ----
         Only the VIDEO generator uses the four-mode / wired-assets panel;
         image & audio generators keep the original compact panel. */
      const isGenVideo = computed(() => isGen.value && kind.value === "video");
      const videoModes = ["参考生视频", "文生视频", "图生视频", "首尾帧视频"];
      const videoMode = computed(() => data.videoMode || "文生视频");
      /* Switching mode NEVER touches wires. Availability is decided by the
         assets already wired in (modeAvailable), and the tab UI disables the
         modes that don't fit. This guard only back-stops programmatic calls. */
      const setVideoMode = (mode) => {
        if (!modeAvailable(mode)) {
          NS.api?.toast?.("warning", t("该模式不可选"), modeReason(mode));
          return;
        }
        patch({ videoMode: mode });
      };
      /* Assets wired into ANY generator: follow incoming edges live so the
         thumbnail row updates when the user connects/disconnects a source.
         Shared by the video, image and audio panels — the text generator takes
         no media at all, and a wired text node is a PROMPT, never an asset. */
      const incomingAssets = computed(() => {
        if (!isGen.value && !isGenText.value) return [];
        const nodes = NS.flow?.nodesOf?.() || [];
        const edges = NS.flow?.edgesOf?.() || [];
        const out = [];
        /* Per-kind running counters so each slot gets a label like 图片1 /
           视频1 / 音频1 — the same kind increments independently in wire order. */
        const counters = {};
        for (const edge of edges) {
          if (edge.target !== props.id) continue;
          const src = nodes.find((n) => n.id === edge.source);
          if (!src) continue;
          /* Text nodes supply the PROMPT, not a media asset — never show them
             in the wired-assets row nor count them as an asset. */
          const assetKind = assetKindOf(src);
          if (assetKind === "text") continue;
          /* 生成器的结果就回显在节点自己身上（data.result），没有独立的结果
             节点；这张回显图同样能当下游的素材，所以两种都读。 */
          const asset = src.data?.asset || src.data?.result;
          const url = asset ? (asset.url || NS.api?.viewUrl?.(asset) || "") : "";
          const kind = src.data?.kind || asset?.kind || "image";
          counters[kind] = (counters[kind] || 0) + 1;
          const cn = KIND_CN[kind] || { label: "素材" };
          out.push({
            id: src.id,
            kind,
            name: asset?.name || asset?.filename || src.data?.title || "素材",
            /* The @ reference label is stored in the prompt as plain text, so it
               follows the UI language at insert time: 图片1 / 视频1 in Chinese,
               Image1 / Video1 in English. The parser accepts both spellings. */
            label: t(cn.label) + counters[kind],   // 图片1 / 视频1 / Image1 / Video1
            url,
          });
        }
        return out;
      });
      /* ---- mode availability: WIRED ASSETS are the cause, SELECTABLE MODES
         the effect (never the reverse). A mode is selectable only when it can
         accommodate every asset currently feeding this node. Returns "" when
         selectable, otherwise a human-readable reason for the disabled tab. */
      const modeReason = (mode) => {
        const counts = {};
        for (const a of incomingAssets.value) counts[a.kind] = (counts[a.kind] || 0) + 1;
        return modeReasonFor(mode, counts);
      };
      const modeAvailable = (mode) => !modeReason(mode);
      /* Same contract for the image generator: 图像编辑 / 图像放大 / 背景移除 all
         consume an input picture (so they are locked until one is wired), and
         the two single-image modes go dark once a SECOND picture arrives. */
      const imageModeReason = (mode) => {
        const counts = {};
        for (const a of incomingAssets.value) counts[a.kind] = (counts[a.kind] || 0) + 1;
        return modeReasonFor(mode, counts, IMAGE_INPUT_RULES,
          (badKind, target) => t("「{target}」不接入{bad}", { target: t(target), bad: t(KIND_CN[badKind]?.label || "媒体素材") }));
      };
      const imageModeAvailable = (mode) => !imageModeReason(mode);
      /* Text generator: LLM reads pictures + ONE video, 语音转录 exactly one
         audio clip. The two families never coexist, so the deny text names the
         wire that has to be cut first. */
      const textModeReason = (mode) => {
        const counts = {};
        for (const a of incomingAssets.value) counts[a.kind] = (counts[a.kind] || 0) + 1;
        return modeReasonFor(mode, counts, TEXT_INPUT_RULES, (badKind, target) => (target === "语音转录"
          ? "「语音转录」只处理纯音频，不能同时接入图片/视频"
          : t("「{target}」不接入{bad}", { target: t("智能对话"), bad: t(KIND_CN[badKind]?.label || badKind) })));
      };
      const textModeAvailable = (mode) => !textModeReason(mode);
      /* Wired-assets row is mode-driven, for EVERY generator that can take
         media. Which table applies follows the node kind:
           - a null entry follows the actual wires (视频 参考生视频 / 图像编辑 /
             LLM);
           - an empty entry means the mode takes no media at all (文生视频 /
             文生图 / 文生音乐 / 语音合成), so the whole row disappears;
           - the rest pin fixed slots, filled from wired assets IN ORDER.
         Each slot: { key, kind, asset|null }. */
      const assetSlots = computed(() => {
        if (!isGen.value && !isGenText.value) return [];
        const mode = isGenImage.value ? imageMode.value
          : isGenAudio.value ? audioMode.value
            : isGenVideo.value ? videoMode.value
              : isGenText.value ? textMode.value : "";
        const table = isGenImage.value ? IMAGE_MODE_ASSET_SLOTS
          : isGenAudio.value ? AUDIO_MODE_ASSET_SLOTS
            : isGenVideo.value ? MODE_ASSET_SLOTS
              : isGenText.value ? TEXT_MODE_ASSET_SLOTS : null;
        if (!table || !(mode in table)) return [];
        const incoming = incomingAssets.value.slice();
        const template = table[mode];
        const slots = [];
        if (template === null) {
          /* Follow the wires: every wired MEDIA asset (image/video/audio)
             becomes one slot, in wire order. */
          incoming.forEach((a) => slots.push({ key: a.id, kind: a.kind, asset: a }));
        } else {
          /* Fixed image slots (图生视频 1 / 首尾帧视频 2 / 文生视频 0) filled from
             wired images in order. Text is a prompt, never a slot. */
          const used = new Set();
          template.forEach((slot, i) => {
            const idx = incoming.findIndex((a) => a.kind === slot.kind && !used.has(a.id));
            if (idx >= 0) {
              used.add(incoming[idx].id);
              slots.push({ key: incoming[idx].id, kind: slot.kind, asset: incoming[idx] });
            } else {
              slots.push({ key: "slot" + i, kind: slot.kind, asset: null });
            }
          });
        }
        return slots;
      });
      /* Slot titles / hover preview now live in the shared MediaSlots component
         (one instance per panel), so an empty slot and a filled one look and
         behave identically on the video, image and audio generators. */
      /* Kick off offscreen thumbnail extraction for any newly wired video. */
      watch(incomingAssets, (assets) => {
        for (const a of assets) if (a.kind === "video" && a.url) ensureVideoThumb(a.url);
      }, { immediate: true });

      /* ---- AUDIO generator panel: 4 modes / TWO prompt areas / API bar ----
         The audio generator has a different shape from image & video:
            文生音乐 / 音乐翻唱  → 提示词 + 歌词
            语音合成 / 语音克隆  → 语气   + 朗读文本
         The bottom bar is [API ▾] on the LEFT and, on the RIGHT, widgets built
         from the workflow's EXPOSED FIELDS — the very list the API 配置 dialog
         edits (<name>.fields.json), read through
         GET /infcanvas/workflows/{name}/fields.
         Each text area is bound to the matching exposed TEXT field (keyword
         match first, remaining fields in wire order) and the pair is stored in
         `audioMap`, so js/infcanvas-core.js can write both values — plus every
         right-hand widget — into the workflow's REAL node inputs at run time.
         Templates that carry no {{placeholders}} (MiniMax music, voice design)
         therefore still receive what the user typed. */
      /* AUDIO_MODES / AUDIO_INPUT_RULES live at module level: the same table
         gates the tabs here and the wires in onConnect. */
      const audioModes = AUDIO_MODES;
      const isGenAudio = computed(() => isGen.value && kind.value === "audio");
      const audioMode = computed(() => (AUDIO_MODES.indexOf(data.audioMode) >= 0
        ? data.audioMode : AUDIO_MODES[0]));
      const audioFamily = computed(() => (isMusicMode(audioMode.value) ? "music" : "voice"));
      /* Wired inputs of the audio generator: audio clips (max 1) and text nodes
         (prompts). Read straight from the edge store so the tabs react the
         moment a wire is added or removed. */
      const audioWired = computed(() => {
        const out = { audio: [], text: [] };
        if (!isGenAudio.value) return out;
        const nodes = NS.flow?.nodesOf?.() || [];
        const edges = NS.flow?.edgesOf?.() || [];
        const seen = new Set();
        for (const edge of edges) {
          if (edge.target !== props.id || seen.has(edge.source)) continue;
          seen.add(edge.source);
          const src = nodes.find((n) => n.id === edge.source);
          const srcKind = assetKindOf(src);
          if (srcKind === "audio") out.audio.push(src);
          else if (srcKind === "text") out.text.push(src);
        }
        return out;
      });
      const wiredAudio = computed(() => audioWired.value.audio);
      const wiredTextNodes = computed(() => audioWired.value.text);
      /* Every wired text node's content, joined. Feeds the FIRST area
         (提示词 / 语气) at run time — never 歌词 / 朗读文本. */
      const wiredText = computed(() => wiredTextNodes.value
        .map((n) => String(n.data?.text || "").trim()).filter(Boolean).join("\n\n"));
      const audioCounts = computed(() => (wiredAudio.value.length ? { audio: wiredAudio.value.length } : {}));
      const audioModeReason = (mode) => modeReasonFor(mode, audioCounts.value, AUDIO_INPUT_RULES,
        (badKind, target) => (badKind === "audio"
          ? t("「{target}」不接入音频，请切换到音乐翻唱或语音克隆", { target })
          : t("「{target}」不接入{bad}", { target: t(target), bad: t(KIND_CN[badKind]?.label || "媒体素材") })));
      const audioModeAvailable = (mode) => !audioModeReason(mode);
      const setAudioMode = (mode) => {
        if (AUDIO_MODES.indexOf(mode) < 0 || mode === audioMode.value) return;
        const reason = audioModeReason(mode);
        if (reason) {
          NS.api?.toast?.("warning", t("该模式不可选"), reason);
          return;
        }
        patch({ audioMode: mode });
      };
      const audioSlots = computed(() => (audioFamily.value === "music"
        ? {
          a: { label: "提示词", ph: "描述你想要的音乐：曲风、情绪、乐器、速度…" },
          b: { label: "歌词", ph: "按行分段填写歌词，可用 [Verse] / [Chorus] 标注段落" },
        }
        : {
          a: { label: "语气", ph: "描述说话的语气：温柔、缓慢、略带笑意…" },
          b: { label: "朗读文本", ph: "输入需要朗读的文本" },
        }));
      /* ---- exposed API fields (the workflow's own parameters) ---- */
      const BAR_FIELD_TYPES = { number: 1, slider: 1, random: 1, select: 1, switch: 1, text: 1, textarea: 1 };
      const apiFields = ref([]);
      const fieldId = (field) => String(field?.nodeId || "") + ":" + String(field?.key || "");
      const apiValues = computed(() => data.apiValues || {});
      /* Literal {{prompt}} / {{text}} templates do not expose a prompt row in
         fields.json. The backend reports them once with the field list; keep
         that bit on the node (inside fieldSnapshot) so a finished node freezes
         both halves of the prompt entry, not just the exposed rows. */
      const promptSlot = ref(false);
      const fieldValue = (field) => {
        const stored = apiValues.value[fieldId(field)];
        return stored === undefined || stored === null ? (field?.default ?? "") : stored;
      };
      const setFieldValue = (field, value) => {
        if (!field) return;
        patch({ apiValues: { ...apiValues.value, [fieldId(field)]: value } });
      };
      /* Which exposed text field each area writes to. Keywords first, then the
         remaining text fields in wire order, so a workflow that names them
         differently still ends up with two usable areas. */
      const SLOT_KEYWORDS = {
        music: { a: /caption|prompt|style|desc|风格|提示|描述|曲风/i, b: /lyric|歌词/i },
        voice: { a: /tone|emotion|mood|style|语气|情感|情绪|风格/i, b: /speech|text|content|script|朗读|文本|台词|内容/i },
      };
      const isTextField = (field) => field?.type === "text" || field?.type === "textarea";
      /* The prompt is edited in the node's OWN text area (the panel's 提示词 box,
         the video editor, the text generator's area), so its exposed field is
         not a settings row -- it is bound to that area instead (syncPromptMap)
         and written into the workflow's real input at run time. */
      const promptField = computed(() => {
        if (isGenAudio.value) return null;   /* audio binds its two areas itself */
        const textFields = apiFields.value.filter(isTextField);
        return textFields.find((field) => /^(提示词|prompt)$/i.test(String(field.label || "").trim()))
          || textFields.find((field) => !/negative|负面/i.test(String(field.label || ""))
            && /^(prompt|positive|positive_prompt|prompt_text|caption)$/i.test(String(field.key || "")))
          || null;
      });
      const audioFieldSlots = computed(() => {
        const textFields = apiFields.value.filter(isTextField);
        const used = {};
        const take = (pattern) => {
          const hit = textFields.find((field) => !used[fieldId(field)]
            && (pattern.test(String(field.key || "")) || pattern.test(String(field.label || ""))));
          if (hit) used[fieldId(hit)] = true;
          return hit || null;
        };
        const keywords = SLOT_KEYWORDS[audioFamily.value];
        return { a: take(keywords.a) || take(/.+/), b: take(keywords.b) || take(/.+/) };
      });
      /* One source of truth for the on-screen prompt area. A workflow takes
         prompts either through an exposed text field bound to the area or
         through a literal placeholder in the template. With neither, drawing
         the box would promise an input the workflow cannot receive. */
      const hasPromptArea = computed(() => promptSlot.value
        || (isGenAudio.value ? !!(audioFieldSlots.value.a || audioFieldSlots.value.b)
          : !!promptField.value));
      /* Everything else the API exposes belongs in the settings popover (the
         prompt and the audio areas are already on screen). */
      const apiBarFields = computed(() => {
        const skip = {};
        const mark = (field) => { if (field) skip[fieldId(field)] = true; };
        /* The prompt has its own text area in every generator panel. */
        mark(promptField.value);
        /* The audio generator excludes the two text areas of its main panel. */
        if (isGenAudio.value) {
          mark(audioFieldSlots.value.a); mark(audioFieldSlots.value.b);
        }
        return apiFields.value.filter((field) => !skip[fieldId(field)] && BAR_FIELD_TYPES[field.type]);
      });
      /* Advanced vs basic: ComfyUI folds everything a node does not need for a
         first run behind its footer toggle (nodeFooter's showAdvanced). The
         split is decided where the parameter is EXPOSED — the「高级」checkbox in
         API 配置 (fields.json `advanced`) — and only falls back to this label
         table for files written before that flag existed. 提示词 is in the list
         even though its row lives in the node's own text area: the label keeps a
         manually re-exposed prompt out of the advanced bucket. */
      const BASIC_LABELS = ["提示词优化", "提示词", "高宽比", "百万像素", "放大倍数", "种子"];
      const isAdvancedField = (field) => (typeof field?.advanced === "boolean"
        ? field.advanced
        : !BASIC_LABELS.includes(String(field?.label || "").trim()));
      const advancedCount = computed(() => apiBarFields.value.filter(isAdvancedField).length);
      const visibleBarFields = computed(() => (data.showAdvanced
        ? apiBarFields.value
        : apiBarFields.value.filter((field) => !isAdvancedField(field))));
      /* Per node, like ComfyUI's node.showAdvanced: collapsed by default. */
      const toggleAdvanced = () => patch({ showAdvanced: !data.showAdvanced });

      /* ---- settings popover: the exposed API parameters -------------------
         Rendering every parameter inline turned the 30px bar into a wrapping
         mess on a workflow with 6+ params (and squeezed the API selector), so
         they now sit behind a gear button. Each row is a port of ComfyUI's
         Nodes 2.0 widget line, which is what the user pointed at:
           WidgetLayoutField  label left (muted, truncated), control right;
           ScrubableNumberInput  − value [control badge] + inside one bg-input
                              pill; a bg-primary/15 fill behind them when the
                              range is small enough to draw one;
           Switch             36×20 track + 16px thumb, bg-primary when on. */
      /* A value edit re-renders the node, which can recreate this component's
         subtree -- the open flag therefore lives outside the instance, keyed by
         node id, so the card does not slam shut under the pointer. */
      const cardUi = (NS.icCardUi = NS.icCardUi || new Map());
      const setOpen = ref(!!(cardUi.get(props.id) || {}).open);
      watch(setOpen, (open) => {
        cardUi.set(props.id, { ...(cardUi.get(props.id) || {}), open });
      });
      /* The card is 348px wide and hangs off the gear, which now sits to the
         right of the API picker: aligning the card's left edge to the gear would
         push it past the node. Anchor it to the gear, then slide it back inside
         the node (8px inset) whenever it would overflow. */
      const popStyle = ref({});
      const placePop = (event) => {
        const wrap = event?.currentTarget?.parentElement;
        /* Measure against the generator panel (460/520px), not the node card:
           the panel hangs below the node and is wider than it. */
        const box = wrap?.closest?.(".icn__genpanel") || wrap?.closest?.(".icn");
        if (!wrap || !box) return;
        const rr = box.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const scale = box.offsetWidth ? rr.width / box.offsetWidth : 1;
        const boxW = box.offsetWidth;
        const CARD_W = 348;
        const gearLeft = (wr.left - rr.left) / scale;
        let left = gearLeft;
        if (left + CARD_W > boxW - 8) left = boxW - 8 - CARD_W;
        if (left < 8) left = 8;
        popStyle.value = { left: Math.round(left - gearLeft) + "px" };
      };
      const toggleSet = (event) => {
        if (noWorkflow.value) return;
        setOpen.value = !setOpen.value;
        if (setOpen.value) {
          selOpen.value = null;
          placePop(event);
        }
        closeModes();
      };
      const fieldStep = (field) => {
        const step = Number(field?.step);
        return Number.isFinite(step) && step > 0 ? step : 1;
      };
      const fieldMin = (field) => (Number.isFinite(Number(field?.min))
        ? Number(field.min) : Number.MIN_SAFE_INTEGER);
      const fieldMax = (field) => (Number.isFinite(Number(field?.max))
        ? Number(field.max) : Number.MAX_SAFE_INTEGER);
      const fieldNum = (field) => {
        const value = Number(fieldValue(field));
        return Number.isFinite(value) ? value : 0;
      };
      const decimalsOf = (step) => {
        const text = String(step);
        const dot = text.indexOf(".");
        return dot < 0 ? 0 : text.length - dot - 1;
      };
      /* Display only — 0.1 + 0.2 must still read "0.3", not 0.30000000000000004. */
      const fieldText = (field) => {
        const value = fieldValue(field);
        if (value === "" || value === null || value === undefined) return "";
        const num = Number(value);
        if (!Number.isFinite(num)) return String(value);
        const own = field?.precision;
        const digits = own === undefined || own === null || own === ""
          ? decimalsOf(fieldStep(field)) : Number(own);
        return Number.isFinite(digits) && digits > 0 ? num.toFixed(Math.min(digits, 6)) : String(num);
      };
      const fieldFill = (field) => {
        const min = Number(field?.min), max = Number(field?.max), step = Number(field?.step);
        if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) return 0;
        if (max <= min || (max - min) / step >= 100) return 0;
        return Math.max(0, Math.min(1, (fieldNum(field) - min) / (max - min))) * 100;
      };
      const clampField = (field, value) => Math.min(fieldMax(field), Math.max(fieldMin(field), value));
      const bumpField = (field, dir) => {
        const next = fieldNum(field) + dir * fieldStep(field);
        setFieldValue(field, clampField(field, Number(next.toFixed(6))));
      };
      const commitFieldNum = (field, event) => {
        const element = event?.target || null;
        const raw = String(element?.value ?? "").trim();
        const num = Number(raw);
        if (raw === "" || !Number.isFinite(num)) {
          /* Garbage or empty: snap the field back instead of writing NaN in. */
          if (element) element.value = fieldText(field);
          return;
        }
        setFieldValue(field, clampField(field, Number(num.toFixed(6))));
        if (element) element.value = fieldText(field);
        editingField.value = "";
      };
      const stepField = (field, dir) => {
        setFieldValue(field, clampField(field,
          Number((fieldNum(field) + dir * fieldStep(field)).toFixed(6))));
      };
      /* ScrubableNumberInput disables − / + at the field's own bounds
         (canDecrement / canIncrement in the host component). */
      const canFieldDec = (field) => fieldNum(field) > fieldMin(field);
      const canFieldInc = (field) => fieldNum(field) < fieldMax(field);
      /* The value is covered by a transparent swipe layer (cursor:ew-resize):
         a horizontal drag scrubs 1 step per 10px -- right increases, left
         decreases, which is what the host does -- and a plain click switches the
         value into edit mode, focused with the text selected. */
      const editingField = ref("");
      const scrub = { field: null, startX: 0, applied: 0, moved: false };
      const scrubStart = (field, event) => {
        scrub.field = field;
        scrub.startX = event.clientX;
        scrub.applied = 0;
        scrub.moved = false;
      };
      const scrubMove = (event) => {
        if (!scrub.field) return;
        const delta = Math.trunc((event.clientX - scrub.startX) / 10);
        if (!delta || delta === scrub.applied) return;
        const diff = delta - scrub.applied;
        scrub.applied = delta;
        scrub.moved = true;
        stepField(scrub.field, diff);
      };
      const scrubCancel = () => { scrub.field = null; };
      const scrubEnd = (field, event) => {
        const moved = scrub.moved;
        scrub.field = null;
        if (moved) return;
        editingField.value = fieldId(field);
        const input = event?.currentTarget?.parentElement?.querySelector("input");
        if (input) { input.focus(); input.select(); }
      };
      /* A field has the value-control badge because it IS a 随机数 -- the API
         config dialog exposes 种子 with type "random" (随机数). Nothing here
         keys off a widget name; a plain number stays a plain number. */
      const isRandomField = (field) => field?.type === "random";

      /* ---- value control: ValueControlButton + ValueControlPopover ---------
         The badge is NOT a "randomize now" button. It picks what happens to the
         value each time the workflow runs, exactly like the host. Modes and
         wording are copied from packages/design-system/button.variants.ts +
         locales/zh/main.json:
           固定值  数值不变                    fixed
           递增值  数值+1或切换到下一个选项     increment
           递减值  数值-1或切换到上一个选项     decrement
           随机值  每次运行后随机化该值        randomize */
      const CONTROL_MODES = [
        { mode: "fixed", icon: "pencil-off", title: t("固定值"), desc: t("数值不变") },
        { mode: "increment", text: "+1", title: t("递增值"), desc: t("数值+1或切换到下一个选项") },
        { mode: "decrement", text: "-1", title: t("递减值"), desc: t("数值-1或切换到上一个选项") },
        { mode: "randomize", icon: "shuffle", title: t("随机值"), desc: t("每次运行后随机化该值") },
      ];
      /* Host default: addValueControlWidget(..., 'randomize'). */
      const fieldMode = (field) => (data.fieldModes || {})[fieldId(field)] || "randomize";
      const modeTitle = (field) => {
        const mode = fieldMode(field);
        const entry = CONTROL_MODES.find((item) => item.mode === mode);
        return entry ? entry.title + t("：点击切换控制方式") : t("点击切换控制方式");
      };
      const setFieldMode = (field, mode) => patch({
        fieldModes: { ...(data.fieldModes || {}), [fieldId(field)]: mode },
      });
      const modeOpen = ref("");
      const modeField = ref(null);
      const modeStyle = ref({});
      const closeModes = () => { modeOpen.value = ""; modeField.value = null; };
      /* The settings card scrolls (overflow-y:auto), so a chooser nested inside
         it would be clipped. This one hangs off the node root and is placed in
         the node's own layout units, so it stays aligned at any canvas zoom. */
      const openModes = async (field, event) => {
        const badge = event?.currentTarget;
        const card = badge?.closest(".icn__gpa-pop");
        const root = badge?.closest(".icn");
        if (!badge || !card || !root) return;
        if (modeOpen.value === fieldId(field)) { closeModes(); return; }
        const rr = root.getBoundingClientRect();
        const scale = root.offsetWidth ? rr.width / root.offsetWidth : 1;
        const cr = card.getBoundingClientRect();
        const br = badge.getBoundingClientRect();
        const cardTop = (cr.top - rr.top) / scale;
        const cardBottom = (cr.bottom - rr.top) / scale;
        const badgeTop = (br.top - rr.top) / scale;
        /* The chooser is the card's own width (348px, see .icn__gpa-modes), so it
           hangs flush with the card's right edge. Vertically it opens on the
           badge it came from; when the card has less room left below that row
           than the list is tall, it flips to sit above the card instead of
           spilling over the bottom bar. Last step keeps it on screen. */
        const RIGHT = Math.round((rr.right - cr.right) / scale) + "px";
        const place = (top) => { modeStyle.value = { right: RIGHT, top: Math.round(top) + "px" }; };
        place(badgeTop);
        selOpen.value = null;
        modeField.value = field;
        modeOpen.value = fieldId(field);
        await nextTick();
        const el = root.querySelector(".icn__gpa-modes");
        if (!el) return;
        const h = el.offsetHeight;
        let top = badgeTop;
        /* Slide up inside the card; only flip above it when the card has no room
           at all (short card, e.g. 4 basic rows). */
        const maxTop = cardBottom - 6 - h;
        if (top > maxTop) top = maxTop;
        if (top < cardTop) top = cardTop - 6 - h;
        const vh = window.innerHeight;
        const gapTop = (8 - (rr.top + top * scale)) / scale;
        if (gapTop > 0) top += gapTop;
        const over = rr.top + (top + h) * scale - (vh - 8);
        if (over > 0) top -= over / scale;
        place(top);
      };
      const pickMode = (mode) => {
        if (modeField.value) setFieldMode(modeField.value, mode);
        closeModes();
      };
      const syncAudioMap = () => {
        if (!isGenAudio.value) return;
        const slots = audioFieldSlots.value;
        const next = {};
        if (slots.a) next.a = fieldId(slots.a);
        if (slots.b) next.b = fieldId(slots.b);
        const prev = data.audioMap || {};
        if (prev.a === next.a && prev.b === next.b) return;
        /* Derived wiring, not a user edit — keep it out of the undo stack. */
        patch({ audioMap: next }, { silent: true });
      };
      /* Bind the panel's text area to the exposed prompt field (image / video /
         text generators). Stored on the node so core can write the typed text —
         and any wired text node — into the workflow's REAL input: these
         templates carry no {{placeholders}}, so nothing else would deliver it. */
      const syncPromptMap = () => {
        const next = promptField.value ? fieldId(promptField.value) : "";
        if ((data.promptMap || "") !== next) patch({ promptMap: next }, { silent: true });
        /* Text an older build let the user type into the gear row is migrated
           into the prompt area once, so hiding that row drops nothing. */
        const stored = next ? (data.apiValues || {})[next] : undefined;
        if (typeof stored === "string" && stored.trim() && !String(data.prompt || "").trim()) {
          patch({ prompt: stored, promptEdited: true }, { silent: true });
        }
      };
      /* Show the API workflow's configured prompt default in the prompt box.
         Only nodes that have NOT produced output follow the template; a finished
         node is frozen and keeps whatever it generated with. The default is
         written once into data.prompt (which the box renders), but never over
         text the user typed — promptEdited is set by setField("prompt"). Re-runs
         on a never-run node re-read the latest default, so saving a new default
         in API 配置 reaches that node. For {{prompt}} templates there is no
         exposed field, so nothing is seeded and the box stays as authored. */
      const seedPromptDefault = () => {
        if (hasOutput() || data.promptEdited) return;
        const field = isGenAudio.value ? audioFieldSlots.value.a : promptField.value;
        if (!field || field.default === undefined || field.default === null) return;
        const def = String(field.default);
        if (def && def !== String(data.prompt || "")) patch({ prompt: def }, { silent: true });
      };
      /* ---- parameter snapshot ------------------------------------------
         API 配置 edits the workflow TEMPLATE, not the node. A node that has
         already produced something therefore keeps the parameter set it was
         built with: rows must not appear/disappear, a default must not silently
         move, 高级 must not re-bucket, just because the template was re-saved
         later. New / never-run nodes are the opposite — they follow whatever
         the template says right now, so a freshly configured parameter shows up
         immediately.
         So: every successful fetch writes `data.fieldSnapshot`; a node that has
         a result renders FROM the snapshot instead of asking the backend again.
         Renaming a workflow keeps the same fields (the file just moved), hence
         renameWorkflowRefs retargets the snapshot instead of dropping it. A
         DELETED workflow is the other half of the same rule: an already-finished
         node keeps the reference (see frozenWf / adoptDefaultWorkflow), while a
         node that has not produced anything loses it like any other option. */
      /* 已产出过内容 = 老节点（冻结）。未生成的、新拖出来的都算新节点。 */
      const hasOutput = () => Boolean(data.result);
      /* Value-control ranges travel with the node because the run loop (core)
         has no access to fields.json. Kept as a separate write so both the
         fresh fetch and the frozen snapshot path feed it identically. */
      const syncFieldSpecs = (list) => {
        const specs = {};
        for (const field of list) {
          if (isRandomField(field)) {
            specs[fieldId(field)] = {
              min: field.min, max: field.max, step: field.step, default: field.default,
            };
          }
        }
        const prevSpecs = data.fieldSpecs || {};
        if (JSON.stringify(specs) !== JSON.stringify(prevSpecs)) {
          patch({ fieldSpecs: specs }, { silent: true });
        }
      };
      let fieldsToken = 0;
      const loadApiFields = async () => {
        if (!isGen.value && !isGenText.value) { apiFields.value = []; return; }
        const name = data.workflow || kind.value;
        /* Frozen: already generated. Render the stored parameter set and skip
           the request entirely — a later template edit must not reach it. */
        const snap = data.fieldSnapshot;
        const frozen = hasOutput() && snap?.workflow === name && Array.isArray(snap.list)
          ? snap.list : null;
        if (frozen) {
          apiFields.value = frozen;
          promptSlot.value = !!snap.promptSlot;
          syncFieldSpecs(frozen);
          syncAudioMap();
          syncPromptMap();
          /* Frozen node: never re-seed from the template — keep the text it
             generated with (promptEdited is irrelevant here). */
          return;
        }
        const token = ++fieldsToken;
        let list = [];
        let slot = false;
        try {
          const res = await NS.backend?.call?.("/workflows/" + encodeURIComponent(name) + "/fields");
          list = Array.isArray(res?.fields) ? res.fields.filter((f) => f && f.nodeId && f.key) : [];
          slot = Boolean(res?.prompt_placeholder);
        } catch (error) {
          /* Route missing (un-restarted ComfyUI) or no fields file: the node's
             own inputs keep working through the {{prompt}} placeholders. */
          list = [];
        }
        if (token !== fieldsToken) return;
        apiFields.value = list;
        promptSlot.value = slot;
        syncFieldSpecs(list);
        /* Freeze what this node was configured with. Written on EVERY fetch so
           the last look at the template before the first result is the one that
           sticks — and so a never-run node keeps overwriting it with the newest
           config until it actually produces something. */
        const snapName = (() => {
          const hit = SHARED_WF_LIST.value.find((w) => w.id === name);
          return hit ? (hit.name || hit.id) : name;
        })();
        const prevSnap = data.fieldSnapshot;
        if (!prevSnap || prevSnap.workflow !== name
          || JSON.stringify(prevSnap.list) !== JSON.stringify(list)
          || prevSnap.name !== snapName || Boolean(prevSnap.promptSlot) !== slot) {
          patch({ fieldSnapshot: { workflow: name, name: snapName, promptSlot: slot, list } }, { silent: true });
        }
        syncAudioMap();
        syncPromptMap();
        seedPromptDefault();
      };
      watch([() => data.workflow, isGenText], () => { loadApiFields(); }, { immediate: true });
      watch(audioFamily, () => { syncAudioMap(); });
      const onWorkflowsChanged = () => { loadApiFields(); };
      onMounted(() => window.addEventListener("infcanvas:workflows-changed", onWorkflowsChanged));
      onBeforeUnmount(() => window.removeEventListener("infcanvas:workflows-changed", onWorkflowsChanged));

      /* ---- "@" quick reference (atomic chips) ----------------------------
         The prompt is a contenteditable surface, not a textarea: a reference
         has to read as ONE object — thumbnail + highlighted "@图片1" — that
         the caret cannot enter and that deletes in a single backspace. The
         stored value stays PLAIN TEXT ("... @图片1 ..."), so saves, the
         backend and the chip rendering all agree; a parse pass turns every
         @kind+number token back into a chip on load.
         Typing "@" at a line start / after whitespace opens the picker over
         the assets wired into this node; ↑/↓ moves, Enter/Tab or a click
         inserts the chip, Esc closes. Typing "@" mid-word never triggers. */
      const promptEl = ref(null);
      const mention = ref(null);            // { query, deleteCount, items, index }
      const refPreview = ref(null);         // hover preview of a chip
      let composing = false;                // IME guard: never open a picker mid-composition
      let lastSynced = null;                // last text we wrote, so external writes can re-render
      /* Candidates come from EVERY wired asset, not from the active mode's slots:
         "@" should stay usable while the user is still deciding on a mode. */
      const mentionItems = computed(() =>
        incomingAssets.value.map((asset) => ({
          key: asset.id,
          label: asset.label,
          name: asset.name,
          kind: asset.kind,
          url: asset.url || "",
          thumb: asset.kind === "image"
            ? asset.url
            : asset.kind === "video" ? (videoThumbs[asset.url] || "") : "",
        })));

      const escapeText = (value) => String(value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const escapeAttr = (value) => escapeText(value).replace(/"/g, "&quot;");
      /* A token written in one language must still find its asset after a
         language switch: @图片1 and @Image1 address the same first image. */
      const MENTION_KIND = {
        "图片": "image", "视频": "video", "音频": "audio",
        "image": "image", "video": "video", "audio": "audio",
      };
      const MENTION_RE = /@(图片|视频|音频|Image|Video|Audio)(\d+)\s?/gi;
      const mentionItem = (ref) => {
        const hit = /^(.+?)(\d+)$/.exec(String(ref || ""));
        if (hit) {
          const kind = MENTION_KIND[hit[1]] || MENTION_KIND[hit[1].toLowerCase()];
          if (kind) {
            const sameKind = mentionItems.value.filter((entry) => entry.kind === kind);
            const found = sameKind[Number(hit[2]) - 1];
            if (found) return found;
          }
        }
        return mentionItems.value.find((entry) => entry.label === ref);
      };
      const chipHtml = (item) => '<span class="icn__gpv-ref" contenteditable="false"'
        + ' data-ref="' + escapeAttr(item.label) + '" data-kind="' + escapeAttr(item.kind || "image") + '"'
        + ' title="' + escapeAttr(item.name || item.label) + '">'
        + (item.thumb ? '<img class="icn__gpv-ref-img" src="' + escapeAttr(item.thumb) + '" alt="" draggable="false">' : "")
        + '<span class="icn__gpv-ref-t">@' + escapeText(item.label) + "</span></span>";
      /* Live chip element, used when inserting (Enter or paste). */
      const buildChip = (item) => {
        const chip = document.createElement("span");
        chip.className = "icn__gpv-ref";
        chip.contentEditable = "false";
        chip.dataset.ref = item.label;
        chip.dataset.kind = item.kind || "image";
        chip.title = item.name || item.label;
        if (item.thumb) {
          const img = document.createElement("img");
          img.className = "icn__gpv-ref-img";
          img.src = item.thumb;
          img.alt = "";
          img.draggable = false;
          chip.appendChild(img);
        }
        const label = document.createElement("span");
        label.className = "icn__gpv-ref-t";
        label.textContent = "@" + item.label;
        chip.appendChild(label);
        return chip;
      };
      /* Plain text -> rich markup. The separator space after a token is kept as
         a real text node (NOT inside the chip) so selecting and copying the
         prompt yields exactly the same string that gets stored. */
      const toRich = (text) => {
        const src = String(text || "");
        MENTION_RE.lastIndex = 0;
        let html = "";
        let last = 0;
        let hit;
        while ((hit = MENTION_RE.exec(src))) {
          html += escapeText(src.slice(last, hit.index)).replace(/\n/g, "<br>");
          const label = hit[1] + hit[2];
          const item = mentionItem(label);
          html += chipHtml(item || { label, kind: "image", name: label, thumb: "" }) + " ";
          last = hit.index + hit[0].length;
        }
        return html + escapeText(src.slice(last)).replace(/\n/g, "<br>");
      };
      /* Rich markup -> plain text. Chips become "@图片1 " again. */
      const fromRich = (node) => {
        let out = "";
        const walk = (parent) => {
          for (const child of parent.childNodes) {
            if (child.nodeType === 3) { out += child.data; continue; }
            if (child.nodeType !== 1) continue;
            const ref = child.dataset?.ref;
            if (ref) { out += "@" + ref; continue; }
            if (child.tagName === "BR") { out += "\n"; continue; }
            const block = child.tagName === "DIV" || child.tagName === "P";
            if (block && out && !out.endsWith("\n")) out += "\n";
            walk(child);
          }
        };
        walk(node);
        return out.replace(/\n$/, "");
      };
      const renderPrompt = () => {
        const el = promptEl.value;
        if (!el) return;
        const text = data.prompt || "";
        el.innerHTML = toRich(text);
        lastSynced = text;
      };
      const syncPrompt = () => {
        const el = promptEl.value;
        if (!el) return;
        const text = fromRich(el);
        lastSynced = text;
        setField("prompt", text);
      };
      /* Re-render only when the value changed from OUTSIDE (load / undo), so
         typing never has its DOM rewritten underneath the caret. */
      watch(() => data.prompt, (value) => {
        if (value === lastSynced) return;
        lastSynced = value;
        renderPrompt();
      });
      /* Both rich-prompt owners (video and image) paint stored chips once their
         box exists; the audio/text generators keep plain text areas. */
      watch(() => isGenVideo.value || isGenImage.value, (on) => {
        if (on) nextTick(renderPrompt);
      }, { immediate: true });

      const closeMention = () => { mention.value = null; };
      /* Plain text up to the caret, but only when the caret is inside the box. */
      const caretBefore = () => {
        const el = promptEl.value;
        const sel = window.getSelection();
        if (!el || !sel || !sel.rangeCount) return null;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return null;
        const pre = range.cloneRange();
        pre.selectNodeContents(el);
        pre.setEnd(range.startContainer, range.startOffset);
        return { text: fromRich(pre.cloneContents()), range };
      };
      /* The "@token" run that ends at the caret — "@" must start a line or follow
         whitespace, and no whitespace may sit between it and the caret (else the
         user is just writing prose). Returns null when there is no live token. */
      const mentionAtCaret = (before) => {
        const at = before.lastIndexOf("@");
        if (at < 0) return null;
        if (at > 0 && !/[\s\u3000]/.test(before.charAt(at - 1))) return null;
        const query = before.slice(at + 1);
        if (/[\s\u3000]/.test(query)) return null;
        return { query, deleteCount: 1 + query.length };
      };
      const openMention = () => {
        if (composing) return;
        const ctx = caretBefore();
        if (!ctx) { closeMention(); return; }
        const hit = mentionAtCaret(ctx.text);
        if (!hit) { closeMention(); return; }
        const q = hit.query.toLowerCase();
        const items = mentionItems.value.filter((item) =>
          !q
          || item.label.toLowerCase().includes(q)
          || String(item.name || "").toLowerCase().includes(q));
        if (!items.length) { closeMention(); return; }
        mention.value = { query: hit.query, deleteCount: hit.deleteCount, items, index: 0 };
      };
      const onPromptInput = () => {
        /* contenteditable=false only blocks the caret; a selection that covers a
           chip's label can still be typed over. Restore the label text. */
        const el = promptEl.value;
        el?.querySelectorAll(".icn__gpv-ref").forEach((chip) => {
          const want = "@" + (chip.dataset.ref || "");
          const label = chip.querySelector(".icn__gpv-ref-t");
          if (label && label.textContent !== want) label.textContent = want;
        });
        syncPrompt();
        openMention();
      };
      const onComposeStart = () => { composing = true; };
      const onComposeEnd = () => {
        composing = false;
        syncPrompt();
        openMention();
      };
      /* Paste is normalized exactly like typing: a copied prompt keeps its chips
         instead of degrading to literal "@图片1" text. The clipboard string is
         split on tokens and inserted as text nodes + chips, so the caret lands
         right after the last inserted node. */
      const insertRichText = (text) => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return false;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        MENTION_RE.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let hit;
        while ((hit = MENTION_RE.exec(text))) {
          if (hit.index > last) frag.appendChild(document.createTextNode(text.slice(last, hit.index)));
          const label = hit[1] + hit[2];
          frag.appendChild(buildChip(mentionItem(label)
            || { label, kind: "image", name: label, thumb: "" }));
          frag.appendChild(document.createTextNode(" "));
          last = hit.index + hit[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        const anchor = document.createTextNode("");
        frag.appendChild(anchor);
        range.insertNode(frag);
        const after = document.createRange();
        after.setStart(anchor, 0);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
        return true;
      };
      const onPromptPaste = (event) => {
        const text = event.clipboardData?.getData("text") || "";
        if (!text) return;
        if (!insertRichText(text)) {
          try { document.execCommand("insertText", false, text); }
          catch (error) { /* older browsers: ignore */ }
        }
        syncPrompt();
        openMention();
      };
      const hoverMention = (index) => {
        if (mention.value) mention.value = { ...mention.value, index };
      };
      /* Replace the live "@query" run with a chip and park the caret after it. */
      const pickMention = (item) => {
        const state = mention.value;
        const el = promptEl.value;
        const sel = window.getSelection();
        if (!state || !item || !el || !sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) { closeMention(); return; }
        const chip = buildChip(item);

        const container = range.startContainer;
        /* A trailing space goes AFTER the chip as a plain text node, so the
           copied / stored string reads "... @图片1 女玩家" like normal prose. */
        const space = document.createTextNode(" ");
        if (container.nodeType === 3) {
          const offset = range.startOffset;
          const start = Math.max(0, offset - state.deleteCount);
          container.deleteData(start, offset - start);
          const tail = container.splitText(start);
          tail.parentNode.insertBefore(chip, tail);
          chip.parentNode.insertBefore(space, tail);
        } else {
          range.insertNode(chip);
          chip.parentNode.insertBefore(space, chip.nextSibling);
        }
        const after = document.createRange();
        after.setStart(space, 1);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
        closeMention();
        syncPrompt();
        el.focus();
      };
      /* Deleting a chip also swallows the separator space we inserted behind it,
         so a removed reference never leaves a double space in the sentence. */
      const eatChipBehind = (event) => {
        if (event.key !== "Backspace") return false;
        const sel = window.getSelection();
        const el = promptEl.value;
        if (!sel || !sel.rangeCount || !sel.isCollapsed || !el) return false;
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType !== 3 || !el.contains(node) || range.startOffset !== 0) return false;
        const prev = node.previousSibling;
        if (!prev || prev.nodeType !== 1 || !prev.classList.contains("icn__gpv-ref")) return false;
        event.preventDefault();
        if (node.data.startsWith(" ")) node.deleteData(0, 1);
        prev.parentNode.removeChild(prev);
        const after = document.createRange();
        after.setStart(node, 0);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
        syncPrompt();
        return true;
      };
      const onPromptKeydown = (event) => {
        const state = mention.value;
        if (!state) { eatChipBehind(event); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          const total = state.items.length;
          hoverMention((state.index + step + total) % total);
        } else if (event.key === "Enter" || event.key === "Tab") {
          if (composing) return;
          event.preventDefault();
          pickMention(state.items[state.index]);
        } else if (event.key === "Escape" || event.key === "Esc") {
          event.preventDefault();
          event.stopPropagation();
          closeMention();
        }
      };
      /* Hover preview for an inserted chip: SAME card as the slot thumbnails
         (160px, same surface / radius / name strip, media autoplays), only the
         anchoring differs — a chip lives inside a scrolling text run, so the
         card is teleported to the canvas root and pinned above the chip. */
      const refMetaDuration = ref("0:00");
      const onRefMeta = (event) => {
        refMetaDuration.value = fmtTime(event?.target?.duration);
      };
      const onRefOver = (event) => {
        const chip = event.target?.closest?.(".icn__gpv-ref");
        if (!chip) return;
        const item = mentionItem(chip.dataset.ref);
        if (!item) return;
        if (refPreview.value?.label === item.label) return;   // same chip: keep the player alive
        const box = chip.getBoundingClientRect();
        const half = 84;                                      // card half width + viewport margin
        const center = box.left + box.width / 2;
        const left = Math.round(Math.min(Math.max(center, half), window.innerWidth - half));
        const top = Math.round(box.top);
        if (refPreview.value?.left === left && refPreview.value?.top === top) return; // same chip: keep the player alive
        refMetaDuration.value = "0:00";
        refPreview.value = { ...item, left, top };
      };
      const onRefOut = (event) => {
        /* Keep the card only while the pointer is still inside SOME chip: moving
           between the thumbnail and the label must not flicker, everything else
           (including leaving the editor, where relatedTarget may be null) closes
           it. Do NOT require the outgoing target to be a chip — the DOM is
           rebuilt on every re-render, so the element under the pointer can be
           gone by the time mouseout fires and the card used to be left behind. */
        if (event.relatedTarget?.closest?.(".icn__gpv-ref")) return;
        refPreview.value = null;
      };
      /* Deselecting hides the panel without firing mouseout on the chip. */
      watch(() => props.selected, (on) => {
        if (on) return;
        closeMention();
        refPreview.value = null;
        selOpen.value = null;
        setOpen.value = false;
        closeModes();
      });
      /* Backend workflow list for the bottom-left selector: shared module-level
         ref so the API 配置 dialog can refresh it via the changed event. */
      const wfList = SHARED_WF_LIST;
      loadWorkflows();
      /* ---- Nodes 2.0 select (ComfyUI src/components/ui/select) -----------
         A native <select> popup is painted by the OS and cannot be themed, so
         the trigger is a plain button and the list is our own popover:
           trigger  SelectTrigger size="md" — bg-secondary surface, rounded-lg,
                    bg-accent on hover/open, chevron-down in muted-foreground;
           content  SelectContent — bg-background #171718, rounded-lg, p-2,
                    8px below the trigger, border + shadow;
           item     SelectItem — rounded-sm, accent on hover, muted + check
                    when it is the current value.
         Only one list may be open; Escape / an outside press closes it. */
      const selOpen = ref(null);                       // "wf" | "size" | "gsize" | "f:nodeId:key"
      /* The exposed-parameter listbox cannot live inside the settings card: that
         card scrolls, so an absolutely positioned menu inside it is clipped (and
         its clicks land on the wrong element). Like the value-control chooser it
         hangs off the node root and is placed in the node's layout units. */
      const selStyle = ref({});
      const toggleSel = (key, event) => {
        if (key === "wf" && noWorkflow.value) return;
        const wasOpen = selOpen.value === key;
        selOpen.value = wasOpen ? null : key;
        if (wasOpen || String(key).indexOf("f:") !== 0) return;
        const rowEl = event?.currentTarget?.closest?.("[data-widget-name]");
        const anchor = rowEl?.querySelector('[role="combobox"]')?.parentElement;
        const root = anchor?.closest(".icn");
        if (!anchor || !root) return;
        const rr = root.getBoundingClientRect();
        const scale = root.offsetWidth ? rr.width / root.offsetWidth : 1;
        const ar = anchor.getBoundingClientRect();
        selStyle.value = {
          left: Math.round((ar.left - rr.left) / scale) + "px",
          top: Math.round((ar.bottom - rr.top) / scale + 4) + "px",
          width: Math.round(ar.width / scale) + "px",
        };
      };
      const selField = computed(() => {
        const key = selOpen.value;
        if (!key || String(key).indexOf("f:") !== 0) return null;
        return apiFields.value.find((field) => "f:" + fieldId(field) === key) || null;
      });
      const pickSel = (key, value) => {
        if (key === "wf") setField("workflow", value);
        else if (key === "size" || key === "gsize") setSize(value);
        else if (String(key).indexOf("f:") === 0) {
          /* API-exposed select: the key carries the field identity. */
          const target = apiFields.value.find((field) => "f:" + fieldId(field) === key);
          if (target) setFieldValue(target, value);
        }
        selOpen.value = null;
      };
      /* Workflows are tagged with a category in the API dialog. Each generator
         shows only the workflows matching its active mode: image -> 文生图/
         图像编辑/图像放大/背景移除, video -> the 4 video modes, audio -> the 4
         audio modes. */
      const activeCategory = computed(() => {
        if (isGenImage.value) return imageMode.value;
        if (isGenVideo.value) return videoMode.value;
        if (isGenAudio.value) return audioMode.value;
        if (isGenText.value) return textMode.value;
        return "";
      });
      const filteredWfList = computed(() => {
        const cat = activeCategory.value;
        if (!cat) return wfList.value;
        return wfList.value.filter((w) => w.category === cat);
      });
      /* A node that already produced something keeps pointing at its template
         even after that template is deleted: the API list is live and no longer
         contains it, so the option is put back from the node's own snapshot and
         pinned to the top of the menu. Never-run nodes just lose the option. */
      const frozenWf = computed(() => {
        const id = data.workflow || "";
        if (!id || !data.result) return null;
        if (wfList.value.some((w) => w.id === id)) return null;
        const snap = data.fieldSnapshot;
        const name = (snap && snap.workflow === id && snap.name) || id;
        return { id, name, category: activeCategory.value, is_default: false, missing: true };
      });
      const wfOptions = computed(() => {
        const frozen = frozenWf.value;
        const list = filteredWfList.value.filter((w) => !frozen || w.id !== frozen.id);
        return frozen ? [frozen, ...list] : list;
      });
      /* Empty category = the mode has no API at all. The picker itself becomes
         a static label (not an openable dropdown) and the settings gear is
         disabled: showing the previous mode's workflow here would be a lie, and
         its parameters have nothing to write into. A finished node keeps its
         own deleted-template option, so that case is not "no workflow". */
      const noWorkflow = computed(() => !!activeCategory.value && !wfOptions.value.length);
      watch(noWorkflow, (empty) => {
        if (empty) { setOpen.value = false; selOpen.value = null; }
      });
      /* Default template follows the node's medium, so a fresh text generator
         offers 生成文本 rather than a leftover video workflow. */
      const WF_DEFAULT = { image: "image", video: "video", audio: "audio", text: "text" };
      /* ---- category default workflow --------------------------------
         The API dialog pins one workflow per category (the list endpoint marks
         it `is_default`, falling back to the category's first entry). ONLY a
         node that has no usable workflow of its own adopts it -- a fresh node
         still carrying the legacy "image"/"video" stem, or one whose template
         was deleted/renamed. Nodes already on the canvas keep their pick when
         the pin changes; adopting happens once, never as a live follow. */
      const wfPool = computed(() => {
        const cat = activeCategory.value;
        const pool = cat ? wfList.value.filter((w) => w.category === cat) : wfList.value;
        return pool.length ? pool : wfList.value;
      });
      const defaultWfId = computed(() => {
        const hit = wfPool.value.find((w) => w.is_default);
        return hit ? hit.id : (wfPool.value[0] ? wfPool.value[0].id : "");
      });
      const adoptDefaultWorkflow = () => {
        if (renamingWorkflows) return;
        if (!wfList.value.length) return;
        const cur = data.workflow || "";
        /* Only a pick from the ACTIVE category is usable: the API selector is
           filtered by the mode's category, so a 文生图 graph left behind when
           the user switches to 图像放大 would be invisible in the dropdown and
           would fail at run time. wfPool falls back to the whole list when the
           category is empty, which keeps modes without templates unaffected. */
        if (cur && wfPool.value.some((w) => w.id === cur)) return;
        /* 已产出过内容的节点：模板被删了也不换走。它已经是一条成品，留着原来的
           引用（下拉里继续显示这一项）比悄悄换一个工作流、跑出另一张图要好。
           未产出过的节点没有这个豁免：它的模板真没了就得落到分类默认上。 */
        if (cur && data.result && !wfList.value.some((w) => w.id === cur)) return;
        const target = defaultWfId.value;
        if (target && target !== cur) patch({ workflow: target }, { silent: true });
      };
      /* Keyed on the category pool, not the whole list: a mode switch must move
         the node onto that mode's template, while a DEFAULT-pin change inside
         the same category must not (already-created nodes keep their pick). */
      watch([wfPool, () => data.workflow], adoptDefaultWorkflow, { immediate: true });
      const wfValue = computed(() => data.workflow || defaultWfId.value
        || WF_DEFAULT[kind.value] || "video");
      const wfLabel = computed(() => {
        const hit = wfList.value.find((w) => w.id === wfValue.value);
        if (hit) return hit.name || hit.id;
        if (frozenWf.value && frozenWf.value.id === wfValue.value) return frozenWf.value.name;
        return wfValue.value;
      });
      const sizeLabel = computed(() => {
        const hit = sizePresets.find((s) => s.value === sizeValue.value);
        return hit ? hit.label : (data.width || 512) + "×" + (data.height || 512);
      });
      const onSelOutside = (event) => {
        /* The settings popover is its own layer: a press anywhere outside the
           gear wrapper (canvas, another node, the API picker) closes it. */
        /* The value-control chooser and the parameter listbox are popovers OF the
           settings card, but they hang off the node root: pressing inside either
           must not count as an outside press for the card itself. */
        if (setOpen.value && !event.target?.closest?.(".icn__gpa-setwrap")
          && !event.target?.closest?.(".icn__gpa-modes")
          && !event.target?.closest?.(".icn__gpa-fsel")) setOpen.value = false;
        /* The chooser hangs off the node root, not off the badge, so it needs
           its own outside test. A press on the badge itself is handled by its
           click handler (which toggles), hence the badge exemption. */
        if (modeOpen.value && !event.target?.closest?.(".icn__gpa-modes")
          && !event.target?.closest?.("[data-vc-badge]")) closeModes();
        if (!selOpen.value) return;
        if (event.target?.closest?.(".icn__selwrap")) return;
        /* The parameter listbox and its trigger are outside the card but still
           "inside" the control, so a press there must not count as outside. */
        if (event.target?.closest?.(".icn__gpa-fsel")) return;
        if (event.target?.closest?.("[data-widget-name]")) return;
        selOpen.value = null;
      };
      const onSelKey = (event) => {
        if (!selOpen.value && !setOpen.value && !modeOpen.value) return;
        if (event.key !== "Escape" && event.key !== "Esc") return;
        /* Swallow it: Vue Flow uses Escape for its own selection handling, which
           would deselect the node and hide the panel just because a list closed. */
        event.stopPropagation();
        event.preventDefault();
        selOpen.value = null;
        setOpen.value = false;
        closeModes();
      };
      onMounted(() => {
        document.addEventListener("pointerdown", onSelOutside, true);
        document.addEventListener("keydown", onSelKey, true);
      });
      onBeforeUnmount(() => {
        document.removeEventListener("pointerdown", onSelOutside, true);
        document.removeEventListener("keydown", onSelKey, true);
      });
      const openResult = () => {
        const result = data.result;
        if (result?.url) window.open(result.url, "_blank");
        else NS.api?.toast?.("info", t("暂无生成结果"));
      };

      /* Per-kind hover actions (image / video / audio / text / gen / empty).
         The tool set itself lives in js/infcanvas-tools.js and the video/audio
         handlers in js/infcanvas-media-tools.js. */
      /* A generator with a FREE input can be fed straight from the disk. Once a
         wire is connected the material comes from upstream instead, so there is
         deliberately no upload button — a node holding both its own file and a
         live input would have two contradictory identities. A text node takes a
         .txt/.md/.json/.csv the same way, as long as it is still empty: whatever
         is already there (typed text, an uploaded file, a generated result) is
         the node's content, and its upload slot is spent. */
      const canUpload = computed(() => {
        if (hasIncoming.value || data.result) return false;
        if (isText) return !data.asset && !hasText.value;
        return isGen.value;
      });

      /* Big centred glyph for a generator that has produced nothing yet. */
      const EMPTY_ICONS = { image: "image", video: "video", audio: "audio-lines", text: "text-pen" };
      const emptyIcon = computed(() => EMPTY_ICONS[kind.value] || "image");
      /* Scales with the frame (a resized node keeps its proportions) but never
         smaller than a legible glyph nor larger than a tasteful watermark. */
      const emptyIconSize = computed(() =>
        Math.max(32, Math.min(72, Math.round(bodyH.value * 0.3))));

      const actions = computed(() => NS.tools?.actionsFor?.(data, {
        canUpload: canUpload.value,
      }) || []);
      /* `button` is the hover-row element: the frame tool opens its three-way
         menu anchored to it, exactly like the reference xcat-ve-menu. */
      const onAction = (key, event) => NS.tools?.run?.(key, {
        id: props.id,
        data,
        url: url.value,
        button: event?.currentTarget || null,
        pickFile,
      });

      /* Text nodes render Markdown but enter a source editor on double click,
         exactly like the reference xcat-text-edit.js / xcat-markdown.js pair. */
      const editing = ref(false);
      const draft = ref("");
      const editor = ref(null);
      const setEditor = (element) => { editor.value = element; };
      const textHtml = computed(() => NS.tools?.renderText?.(
        data.text || data.asset?.text || data.result?.text || data.asset?.name || "") || "");
      /* Reference xcat-text-edit.js: double click anywhere on the node enters
         the inline textarea, caret goes to the end (not select-all); Esc /
         clicking outside / losing focus exits editing and keeps the text. */
      const startEdit = () => {
        /* Generate nodes keep the asset-node body; their parameters live in the
           panel that appears on selection, so double-click needs no extra edit. */
        if (isGen.value) return;
        if (kind.value !== "text" || editing.value) return;
        /* A text node with a wired input is a locked consumer: it reads the
           incoming text/media and must NOT be edited by hand (mirrors the
           upload rule — canUpload also refuses while hasIncoming). Only a free
           text node may be double-clicked into the editor. */
        if (hasIncoming.value) return;
        draft.value = data.text || data.asset?.text || data.asset?.name || "";
        editing.value = true;
        nextTick(() => {
          const area = editor.value;
          if (!area) return;
          area.focus({ preventScroll: true });
          const end = (area.value || "").length;
          try { area.setSelectionRange(end, end); } catch (error) { /* optional */ }
        });
      };
      const commitEdit = () => {
        if (!editing.value) return;
        editing.value = false;
        patch({ text: draft.value });
      };
      const onEditKey = (event) => {
        if (event.key === "Escape" || event.key === "Esc") {
          event.preventDefault();
          commitEdit();
        }
        event.stopPropagation();
      };
      /* If a wire lands while the editor is open, leave edit mode at once: a
         wired text node is a locked consumer, no manual textarea. Discard the
         draft (do NOT commit) — the incoming asset is now the text source. */
      watch(hasIncoming, (wired) => { if (wired && editing.value) editing.value = false; });

      /* ---- node name (double click the capsule) ----
         The name is the only free-form label a node has: it defaults to the
         medium ("图像"), becomes the file name when material is dropped in, and
         can be renamed here. contenteditable rather than <input>: the capsule is
         inline-block and must grow with the text instead of being pinned to a
         guessed width. */
      const DEFAULT_TITLE = { image: "图像", video: "视频", audio: "音频", text: "文本" };
      /* Titles are persisted as the Chinese medium name (an internal key, same
         as the category keys), but the capsule must read Text / Image / Video /
         Audio in English. Both spellings map back to the key on rename so a
         language switch never turns a default title into a "custom" one. */
      const TITLE_KEYS = {
        "图像": "image", "Image": "image", "视频": "video", "Video": "video",
        "音频": "audio", "Audio": "audio", "文本": "text", "Text": "text",
        "节点": "node", "Node": "node",
      };
      const canonicalTitle = (name) => {
        const key = TITLE_KEYS[name];
        return key ? (DEFAULT_TITLE[key] || "节点") : name;
      };
      const displayTitle = computed(() => {
        const raw = data.title || "节点";
        const key = TITLE_KEYS[raw];
        return key ? t(DEFAULT_TITLE[key] || "节点") : raw;
      });
      const renaming = ref(false);
      const nameBox = ref(null);
      const setNameBox = (element) => { nameBox.value = element; };
      const startRename = () => {
        if (renaming.value) return;
        renaming.value = true;
        nextTick(() => {
          const box = nameBox.value;
          if (!box) return;
          box.textContent = displayTitle.value;
          box.focus({ preventScroll: true });
          /* Select the whole name so typing replaces it, like a file rename. */
          try {
            const range = document.createRange();
            range.selectNodeContents(box);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
          } catch (error) { /* optional */ }
        });
      };
      const commitRename = () => {
        if (!renaming.value) return;
        renaming.value = false;
        /* textContent, never innerHTML: a paste can carry markup that would
           otherwise end up rendered inside the capsule. */
        const next = String(nameBox.value?.textContent || "").replace(/\s+/g, " ").trim();
        const title = canonicalTitle(next) || DEFAULT_TITLE[kind.value] || "节点";
        if (title !== data.title) patch({ title });
      };
      const cancelRename = () => { renaming.value = false; };
      const onNameKey = (event) => {
        if (event.key === "Enter") { event.preventDefault(); commitRename(); }
        else if (event.key === "Escape" || event.key === "Esc") { event.preventDefault(); cancelRename(); }
        event.stopPropagation();
      };
      const onNamePaste = (event) => {
        event.preventDefault();
        const text = String(event.clipboardData?.getData("text/plain") || "").replace(/\s+/g, " ");
        try { document.execCommand("insertText", false, text); } catch (error) { /* optional */ }
      };

      /* Kept for extensions written against the earlier two-button build. */
      const download = () => onAction("download");
      const remove = () => onAction("delete");

      /* Empty asset nodes are one big upload hit area, like the reference
         .node-upload. Uploading turns this very node into the matching media
         node instead of creating a second one. */
      const fileInput = ref(null);
      /* A top-level ref is auto-unwrapped in templates, so bind it through a
         function ref (nested refs such as media.el can be passed directly). */
      const setFileInput = (element) => { fileInput.value = element; };
      const pickFile = () => fileInput.value?.click();
      /* Each asset node has a FIXED kind from the spec that created it. An
         image node only ever accepts images, a video node only videos, etc.
         The old code re-derived the kind from the file name here, which let an
         image node silently morph into a video/audio node — reject mismatches. */
      const ACCEPT_BY_KIND = {
        image: "image/*",
        video: "video/*",
        audio: "audio/*",
        text: ".txt,.md,.json,.csv",
      };
      const KIND_LABELS = { image: "图片", video: "视频", audio: "音频", text: "文本" };
      const acceptAttr = computed(() => ACCEPT_BY_KIND[kind.value] || "image/*");
      /* Already translated here: the template binds :title directly, and the
         mismatch toast below reports the same wording the button shows. */
      const emptyHint = computed(() => t("点击上传{kind}", { kind: t(KIND_LABELS[kind.value] || "素材") }));
      const onPicked = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const fileKind = NS.api?.kindFromFile?.(file.name);
        if (!fileKind) { NS.api?.toast?.("warning", t("不支持的文件类型"), file.name); return; }
        if (fileKind !== kind.value) {
          NS.api?.toast?.("warning", t("文件类型不匹配"),
            t("「{title}」节点仅接受{kind}文件：{file}", { title: emptyHint.value, kind: t(KIND_LABELS[kind.value] || kind.value), file: file.name }));
          return;
        }
        const nextKind = kind.value;
        try {
          const asset = await NS.backend.upload(file);
          asset.kind = nextKind;
          asset.name = asset.name || file.name;
          asset.url = asset.url || NS.api?.viewUrl?.(asset) || "";
          if (nextKind === "text") {
            try { asset.text = (await (NS.api?.readTextFile || ((f) => f.text()))(file)).slice(0, 4000); } catch (error) { /* binary */ }
          }
          patch({
            kind: nextKind,
            asset,
            text: asset.text || "",
            /* Material in = named after the file the user picked, matching the
               drop path (not the timestamped store name). */
            title: file.name,
          });
          NS.api?.toast?.("success", t("素材已添加"), file.name);
          await nextTick();
          media.install();
          wave.attachMedia();
        } catch (error) {
          NS.api?.toast?.("error", t("上传失败"), file.name + " · " + String(error));
        }
      };

      /* Asset media nodes fit their frame to the source aspect ratio on load:
         width is pinned to 320 and height follows the source. `fitKey` remembers
         which asset we already auto-fitted, so re-entering the canvas (which
         re-fires img/video load) never clobbers a size the user resized by hand.
         Only a genuinely new asset (different filename/url) re-triggers the fit. */
      const fitToAsset = (naturalW, naturalH) => {
        if (!(naturalW > 0) || !(naturalH > 0) || !hasMedia.value) return;
        const asset = assetOf.value;
        const key = asset?.filename || asset?.url || url.value;
        if (!key || data.fitKey === key) return;
        const bodyTarget = Math.max(80, Math.round(ASSET_DEF_W * naturalH / naturalW));
        /* Auto-fit is the node's own normalisation, not an edit the user made.
           The header is added on top so the media keeps its own aspect ratio. */
        patch({ fitKey: key, size: [ASSET_DEF_W, bodyTarget + HEAD_H] }, { silent: true });
      };
      const onImageLoad = (event) => {
        const img = event?.target;
        fitToAsset(img?.naturalWidth, img?.naturalHeight);
      };
      const onVideoMeta = (event) => {
        media.onLoaded();
        const video = event?.target;
        fitToAsset(video?.videoWidth, video?.videoHeight);
      };

      onMounted(() => nextTick(() => media.install()));
      watch(bar, (visible) => { if (visible) nextTick(() => media.install()); });

      return {
        data, isGen, isText, kind, url, hasMedia, bar, size, bodyH, rootStyle, handleTop,
        media, wave, onResizeDown, resizing, setField, run, openResult, download, remove,
        imageModes, imageMode, setImageMode, isGenImage, imageModeReason, imageModeAvailable,
        sizePresets, sizeValue, setSize,
        isGenVideo, videoModes, videoMode, setVideoMode, modeAvailable, modeReason, incomingAssets, assetSlots,
        isGenAudio, audioModes, audioMode, setAudioMode, audioSlots, audioFamily,
        isGenText, textModes, textMode, setTextMode, textModeReason, textModeAvailable,
        audioModeReason, audioModeAvailable, wiredAudio, wiredTextNodes, wiredText,
        apiFields, hasPromptArea, apiBarFields, visibleBarFields, advancedCount, toggleAdvanced,
        fieldId, fieldValue, setFieldValue,
        setOpen, toggleSet, popStyle, fieldText, fieldFill, bumpField, commitFieldNum,
        stepField, canFieldDec, canFieldInc, editingField,
        scrubStart, scrubMove, scrubEnd, scrubCancel,
        isRandomField, CONTROL_MODES, fieldMode, modeTitle, openModes, modeOpen,
        modeField, modeStyle, pickMode, closeModes, selField, selStyle,
        refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut,
        wfList, filteredWfList, wfOptions, noWorkflow,
        selOpen, toggleSel, pickSel, wfValue, wfLabel, sizeLabel,
        promptEl, mention, mentionItems, closeMention, onPromptInput, hoverMention, pickMention, onPromptKeydown,
        refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut,
        setFileInput, pickFile, onPicked, acceptAttr, emptyHint, onImageLoad, onVideoMeta,
        emptyIcon, emptyIconSize, canUpload, hasIncoming,
        actions, onAction, editing, draft, setEditor, textHtml, startEdit, commitEdit, onEditKey,
        renaming, setNameBox, startRename, commitRename, cancelRename, onNameKey, onNamePaste, displayTitle,
        hasText,
      };
    },
    template: `
      <div class="icn" :class="['icn--' + data.role, { 'is-selected': selected }]" :style="rootStyle"
           @dblclick.stop="startEdit">
        <div class="icn__head" :title="$t('双击标题可重命名')">
          <span v-if="renaming" :ref="setNameBox" class="icn__name icn__name--edit nodrag"
                contenteditable="true" spellcheck="false"
                @keydown="onNameKey" @paste="onNamePaste" @blur="commitRename"
                @dblclick.stop @pointerdown.stop @mousedown.stop></span>
          <span v-else class="icn__name" @dblclick.stop="startRename"
          >{{ displayTitle }}</span>
        </div>
        <div class="icn__body" :style="{ height: bodyH + 'px' }">
          <img v-if="hasMedia && kind === 'image'" class="icn__media" :src="url" alt="" draggable="false"
               @load="onImageLoad" />
          <video
            v-else-if="hasMedia && kind === 'video'"
            :ref="media.el" class="icn__media" :src="url" preload="metadata" playsinline
            @loadedmetadata="onVideoMeta"
          ></video>
          <template v-else-if="hasMedia && kind === 'audio'">
            <audio :ref="media.el" class="icn__wave-audio" :src="url" preload="metadata"></audio>
            <div class="icn__wave-host" :ref="wave.host"
                 @pointerdown="wave.onDown($event)" @mousedown="wave.onMouseDown($event)"
                 @pointermove="wave.onMove($event)" @pointerup="wave.onUp($event)"
                 @pointercancel="wave.onUp($event)" @pointerleave="wave.onLeave($event)">
              <canvas :ref="wave.canvas" class="icn__wave"></canvas>
            </div>
          </template>
          <template v-else-if="kind === 'text' && !isGen">
            <textarea v-if="editing" :ref="setEditor" v-model="draft"
                      class="icn__text-edit nodrag nopan" spellcheck="false"
                      @dblclick.stop @blur="commitEdit" @keydown="onEditKey"
                      @pointerdown.stop @mousedown.stop @wheel.stop></textarea>
            <div v-else class="icn__text" @dblclick.stop="startEdit" v-html="textHtml"></div>
            <div v-if="!editing && !hasText" class="icn__gen-empty icn__gen-empty--ghost">
              <IcIcon :name="emptyIcon" :size="emptyIconSize" />
            </div>
          </template>
          <!-- Generate nodes never upload from the body: until they have a
               result they show only the glyph of their medium. Feeding one from
               the disk is the hover-row upload action (visible only while the
               input is free). -->
          <div v-else-if="isGen" class="icn__gen-empty">
            <IcIcon :name="emptyIcon" :size="emptyIconSize" />
          </div>
          <button v-else class="icn__empty" type="button" :title="emptyHint" @click="pickFile">
            <IcIcon name="upload" :size="22" />
            <span class="icn__empty-line">{{ emptyHint }}{{$t('或拖入文件')}}</span>
          </button>
          <input v-if="!isGen || canUpload" :ref="setFileInput" class="icn__file" type="file"
                 :accept="acceptAttr" @change="onPicked" />

          <div v-if="bar" class="icn__bar nodrag" :ref="media.bar">
            <div class="icn__bar-left">
              <button class="icn__btn icn__btn--play" type="button" @click="media.toggle()" :title="media.playing.value ? $t('暂停') : $t('播放')" :aria-label="media.playing.value ? $t('暂停') : $t('播放')">
                <IcIcon :name="media.playing.value ? 'pause' : 'play'" :size="18" />
              </button>
              <span class="icn__time">
                <b>{{ media.timeText.value }}</b><i>/</i><b>{{ media.durationText.value }}</b>
              </span>
            </div>
            <div class="icn__slider icn__seek nodrag" tabindex="0" role="slider" :aria-label="$t('进度')"
                 aria-valuemin="0" aria-valuemax="100">
              <span class="icn__slider-track"></span>
              <span class="icn__slider-fill"></span>
              <span class="icn__slider-thumb"></span>
            </div>
            <span class="icn__vol-group">
              <button class="icn__btn icn__btn--vol" type="button" @click="media.toggleMute()" :title="media.muteIcon.value === 'volume-x' ? $t('取消静音') : $t('静音')" :aria-label="media.muteIcon.value === 'volume-x' ? $t('取消静音') : $t('静音')">
                <IcIcon :name="media.muteIcon.value" :size="17" />
              </button>
              <div class="icn__slider icn__vol nodrag" tabindex="0" role="slider" :aria-label="$t('音量')"
                   aria-valuemin="0" aria-valuemax="100">
                <span class="icn__slider-track"></span>
                <span class="icn__slider-fill"></span>
                <span class="icn__slider-thumb"></span>
              </div>
            </span>
          </div>
        </div>

        <!-- Generate node: the body above is IDENTICAL to an asset node (media
             fills the frame, upload placeholder, corner grips, ports). Only when
             the node is selected does this full parameter PANEL appear BELOW the
             body — mirroring the reference video-generator node: a tab row, a
             prompt input area, and a compact bottom parameter bar with a round
             send button. It lives outside .icn__body so overflow:hidden can't
             clip it. -->
        <!-- VIDEO generator: reference layout (modes / wired assets / prompt /
             bottom bar with workflow + params + run). Other generators keep
             the compact panel below. Lives outside .icn__body so it isn't clipped. -->
        <div v-if="isGenVideo" class="icn__genpanel icn__gpv nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="icn__gpv-modes">
            <button v-for="m in videoModes" :key="m" class="icn__gpv-mode"
                    :class="{ 'is-on': videoMode === m, 'is-disabled': !modeAvailable(m) }"
                    :title="modeReason(m) || ($t('切换到') + $t(m))" type="button"
                    @click.stop="setVideoMode(m)">{{ $cat(m) }}</button>
          </div>
          <!-- Wired assets: shared row (shared with the image & audio panels). -->
          <MediaSlots :slots="assetSlots" />
          <div v-if="hasPromptArea" class="icn__gpv-input">
            <!-- "@" picker: floats above the prompt box so it never fights the
                 bottom parameter bar. mousedown is prevented on purpose — the
                 textarea must keep focus while a suggestion is clicked. -->
            <div v-if="mention" class="icn__gpv-atmenu"
                 @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
              <button v-for="(item, i) in mention.items" :key="item.key" type="button"
                      class="icn__gpv-atitem" :class="{ 'is-on': i === mention.index }"
                      @mouseenter="hoverMention(i)" @mousedown.prevent @click.stop="pickMention(item)">
                <span class="icn__gpv-atthumb">
                  <img v-if="item.thumb" :src="item.thumb" alt="" draggable="false" />
                  <IcIcon v-else :name="item.kind === 'audio' ? 'volume' : 'play'" :size="12" />
                </span>
                <span class="icn__gpv-atlabel">@{{ item.label }}</span>
                <span class="icn__gpv-atname">{{ item.name }}</span>
              </button>
            </div>
            <div ref="promptEl" class="icn__gpv-rich" contenteditable="true" spellcheck="false"
                 :data-placeholder="$t('描述你想要生成的内容，并在下方调整生成参数。使用 @ 可快速引用接入的素材。')"
                 @input="onPromptInput" @keydown="onPromptKeydown" @blur="closeMention"
                 @compositionstart="onComposeStart" @compositionend="onComposeEnd"
                 @paste.prevent="onPromptPaste"
                 @mouseover="onRefOver" @mouseout="onRefOut" @mouseleave="onRefOut"
                 @pointerdown.stop @mousedown.stop @dblclick.stop></div>
            <!-- hover card for an inserted reference chip: exactly the slot
                 thumbnail preview (same box, same media, same name strip),
                 teleported into the canvas root because the panel is a
                 transformed + clipped ancestor. -->
            <Teleport to="#infcanvas-root">
              <div v-if="refPreview" class="icn__gpv-preview icn__gpv-refprev"
                   :style="{ left: refPreview.left + 'px', top: refPreview.top + 'px' }"
                   @pointerdown.stop @mousedown.stop @wheel.stop>
                <img v-if="refPreview.kind === 'image' && refPreview.url"
                     class="icn__gpv-preview-media" :src="refPreview.url" alt="" draggable="false" />
                <video v-else-if="refPreview.kind === 'video' && refPreview.url"
                       class="icn__gpv-preview-media" :src="refPreview.url" autoplay loop playsinline></video>
                <template v-else-if="refPreview.kind === 'audio' && refPreview.url">
                  <audio class="icn__gpv-preview-audio-hidden" :src="refPreview.url"
                         autoplay @loadedmetadata="onRefMeta"></audio>
                  <div class="icn__gpv-preview-audio-meta">
                    <span class="icn__gpv-preview-audio-name">{{ refPreview.label }}</span>
                    <span class="icn__gpv-preview-audio-time">{{ refMetaDuration }}</span>
                  </div>
                </template>
                <!-- media not reachable yet (thumb pending / asset removed) -->
                <img v-else-if="refPreview.thumb"
                     class="icn__gpv-preview-media" :src="refPreview.thumb" alt="" draggable="false" />
                <div v-else class="icn__gpv-preview-media icn__gpv-refprev-ph">{{ refPreview.label }}</div>
                <div v-if="refPreview.kind !== 'audio'" class="icn__gpv-preview-name">{{ refPreview.label }}</div>
              </div>
            </Teleport>
          </div>
          <div class="icn__gpv-bar">
            <!-- Workflow (API) picker first, settings gear right beside it; the
                 exposed params live behind that gear, drawn as Nodes 2.0 widget
                 rows instead of a cramped wrapping row. -->
            <div class="icn__selwrap">
              <div v-if="noWorkflow" class="icn__sel icn__sel--empty" :title="$t('该分类下暂无工作流')">
                <span class="icn__sel-t">{{$t('该分类下暂无工作流')}}</span>
              </div>
              <template v-else>
                <button class="icn__sel" :class="{ 'is-open': selOpen === 'wf' }" type="button"
                        :title="$t('工作流')" @click.stop="toggleSel('wf')">
                  <span class="icn__sel-t">{{ wfLabel }}</span>
                  <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
                </button>
                <div v-if="selOpen === 'wf'" class="icn__selmenu"
                     @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                  <button v-for="w in wfOptions" :key="w.id" type="button" class="icn__selitem"
                          :class="{ 'is-on': wfValue === w.id }" @click.stop="pickSel('wf', w.id)">
                    <span class="icn__selitem-t">{{ w.name || w.id }}</span>
                    <IcIcon v-if="wfValue === w.id" class="icn__selitem-check" name="check" :size="14" />
                  </button>
                </div>
              </template>
            </div>
            <div class="icn__gpa-setwrap">
              <button class="icn__gpa-set" :class="{ 'is-open': setOpen, 'is-disabled': noWorkflow }"
                      type="button" :disabled="noWorkflow"
                      :title="noWorkflow ? $t('该分类下暂无工作流')
                        : (apiBarFields.length
                        ? $t('API 参数（{n} 项）', { n: visibleBarFields.length })
                        : $t('API 参数（当前 API 未暴露参数）'))"
                      @click.stop="toggleSet($event)">
                <IcIcon name="settings" :size="14" />
                <span v-if="apiBarFields.length && !setOpen" class="icn__gpa-setdot"></span>
              </button>
              <div v-if="setOpen" class="icn__gpa-pop" :style="popStyle"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <div class="icn__gpa-pophead">
                  <span class="icn__gpa-popt">{{$t('API 参数')}}</span>
                  <span v-if="apiBarFields.length" class="icn__gpa-popcnt">{{ visibleBarFields.length }}</span>
                </div>
                <div v-if="!apiBarFields.length" class="icn__gpa-popempty">
                  {{ $t('当前 API 未暴露参数，可在 API 配置里勾选要显示的输入项') }}
                </div>
                <!-- Nodes 2.0 WidgetGrid: the class string is WidgetGrid.vue verbatim
                     (12px slot | minmax(80px,min-content) label | minmax(125px,1fr)
                     control, 4px row gap, 12px right gutter), so every control gets
                     its width from the shared column instead of a hand-set px. -->
                <div v-else
                     class="icn__gpa-body lg-node-widgets grid grid-cols-[min-content_minmax(80px,min-content)_minmax(125px,1fr)] gap-y-1 bg-node pt-4 pr-3 pb-3 text-xs text-node-foreground rounded-b-xl">
                  <div v-for="f in visibleBarFields" :key="fieldId(f)"
                       :data-widget-name="fieldId(f)"
                       class="group col-span-full grid grid-cols-subgrid items-stretch">
                    <div class="z-10 flex items-stretch w-3"></div>
                    <!-- WidgetLayoutField -->
                    <div class="col-span-2 grid min-w-0 grid-cols-subgrid justify-between gap-2">
                      <div class="content-center-safe truncate" :title="f.label || fieldId(f)">{{ f.label || fieldId(f) }}</div>
                      <div class="relative min-w-0 flex-1">
                        <div class="min-w-0 cursor-default rounded-md transition-all focus-within:ring focus-within:ring-ring"
                             @pointerdown.stop @pointermove.stop @pointerup.stop>

                          <!-- ScrubableNumberInput (WidgetInputNumberInput.vue) -->
                          <div v-if="f.type === 'number' || f.type === 'slider' || f.type === 'random'"
                               class="relative flex w-full items-stretch overflow-hidden rounded-md bg-input text-xs text-foreground h-6">
                            <span class="pointer-events-none absolute inset-0 overflow-clip rounded-md">
                              <span class="block size-full bg-primary/15" :style="{ width: fieldFill(f) + '%' }"></span>
                            </span>
                            <button type="button" :title="$t('减少')" :disabled="!canFieldDec(f)"
                                    class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                    @click.stop="bumpField(f, -1)">
                              <IcIcon name="minus" class="size-4" />
                            </button>
                            <div class="relative my-0.25 min-w-[4ch] flex-1 py-1.5">
                              <input class="absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0"
                                     :value="fieldText(f)" inputmode="decimal"
                                     autocomplete="off" autocorrect="off" spellcheck="false"
                                     @blur="commitFieldNum(f, $event)"
                                     @keydown.enter.prevent="commitFieldNum(f, $event)"
                                     @keydown.up.prevent="stepField(f, 1)"
                                     @keydown.down.prevent="stepField(f, -1)"
                                     @keydown.page-up.prevent="stepField(f, 10)"
                                     @keydown.page-down.prevent="stepField(f, -10)"
                                     @pointerdown.stop @mousedown.stop @dblclick.stop />
                              <div class="absolute inset-0 z-10 cursor-ew-resize touch-pan-y"
                                   :class="editingField === fieldId(f) && 'pointer-events-none hidden'"
                                   @pointerdown.stop="scrubStart(f, $event)"
                                   @pointermove.stop="scrubMove($event)"
                                   @pointerup.stop="scrubEnd(f, $event)"
                                   @pointercancel="scrubCancel"
                                   @dblclick.stop></div>
                            </div>
                            <!-- ValueControlButton (WidgetWithControl slot) -->
                            <button v-if="isRandomField(f)" type="button" :title="modeTitle(f)"
                                    data-vc-badge="1"
                                    class="mr-1 flex h-4.5 w-8 shrink-0 cursor-pointer items-center justify-center self-center rounded-full border-none"
                                    :class="fieldMode(f) === 'fixed'
                                      ? 'bg-transparent text-muted-foreground hover:bg-accent'
                                      : 'bg-primary/30 text-primary hover:bg-primary/27'"
                                    @click.stop="openModes(f, $event)">
                              <IcIcon v-if="fieldMode(f) === 'fixed'" name="pencil-off" class="size-3" />
                              <IcIcon v-else-if="fieldMode(f) === 'randomize'" name="shuffle" class="size-3" />
                              <span v-else class="text-xs font-normal">{{ fieldMode(f) === 'increment' ? '+1' : '-1' }}</span>
                            </button>
                            <button type="button" :title="$t('增加')" :disabled="!canFieldInc(f)"
                                    class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                    @click.stop="bumpField(f, 1)">
                              <IcIcon name="plus" class="size-4" />
                            </button>
                          </div>

                          <!-- WidgetSelectDefault (combobox trigger) -->
                          <div v-else-if="f.type === 'select'"
                               class="flex w-full min-w-0 items-center overflow-hidden rounded-md bg-input text-foreground h-6 hover:bg-accent">
                            <button type="button" role="combobox"
                                    class="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden border-none bg-transparent p-0 outline-none"
                                    :title="(f.label || '') + '（当前：' + fieldValue(f) + '）'"
                                    @click.stop="toggleSel('f:' + fieldId(f), $event)">
                              <span class="min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs">{{ fieldValue(f) }}</span>
                            </button>
                            <button type="button" tabindex="-1"
                                    class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none"
                                    @click.stop="toggleSel('f:' + fieldId(f), $event)">
                              <IcIcon name="chevron-down" class="size-4 text-muted-foreground" />
                            </button>
                          </div>

                          <!-- Switch (WidgetToggleSwitch.vue, no on/off labels) -->
                          <div v-else-if="f.type === 'switch'"
                               class="-m-1 ml-auto flex w-fit items-center gap-2 rounded-full p-1">
                            <button type="button" :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                    class="group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                                    :title="(f.label || $t('开关')) + '：' + (fieldValue(f) ? $t('开') : $t('关'))"
                                    @click.stop="setFieldValue(f, !fieldValue(f))">
                              <span class="pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary">
                                <span :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                      class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"></span>
                              </span>
                            </button>
                          </div>

                          <!-- WidgetInputText -->
                          <label v-else class="relative flex w-full min-w-0 items-center">
                            <input class="flex w-full min-w-0 appearance-none rounded-md border-none bg-input px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                   :value="fieldValue(f)" spellcheck="false" autocomplete="off"
                                   :title="f.label || ''"
                                   @change="setFieldValue(f, $event.target.value)"
                                   @pointerdown.stop @mousedown.stop @dblclick.stop />
                          </label>

                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- NodeFooter.vue Case 4, host class strings verbatim.
                     Nothing inside this block is drawn by hand: height (h-11),
                     band colour (bg-node-header), radius (rounded-b-xl), type
                     (text-xs font-normal) and the pt-8/pb-3 padding all come
                     from the host's own recipe. Upstream the band is h-11 but
                     -mt-5 tucks its top 20px under the node body, so only 24px
                     is ever visible (measured: 100px at 2.27x zoom, label
                     32px from the band top). With no body to hide behind, that
                     is folded to h-6 + py-0 -- the same 24px band with the
                     label centred -- instead of drawing a 44px stripe. The
                     bleed is the host's own trick (-mx-1 -mb-2
                     w-[calc(100%+8px)] in its error branch), scaled to 16px
                     because this card pads 8px. -->
                <div v-if="advancedCount"
                     class="icn__gpa-more isolate -z-1 -mt-5 box-border flex w-full">
                  <button type="button"
                          class="pointer-events-auto relative inline-flex box-border h-11 w-full cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 rounded-none rounded-b-xl border-none bg-node-header p-2 pt-8 pb-3 font-inter text-xs font-normal whitespace-nowrap text-node-foreground transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                          :title="(data.showAdvanced ? $t('隐藏高级输入') : $t('显示高级输入')) + '（' + advancedCount + ' ' + $t('项') + '）'"
                          @click.stop="toggleAdvanced">
                    <div class="flex size-full items-center justify-center gap-2">
                      <span class="truncate">{{ data.showAdvanced ? $t('隐藏高级输入') : $t('显示高级输入') }}</span>
                      <IcIcon :name="data.showAdvanced ? 'chevron-up' : 'settings-2'" :size="16" class="shrink-0" />
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <button class="icn__gpv-send" type="button"
                    :title="data.status === 'running' ? $t('正在生成…') : $t('运行生成')"
                    :disabled="data.status === 'running'" @click.stop="run">{{$t('运行')}}</button>
          </div>
        </div>

        <!-- AUDIO / TEXT generator: modes on top, prompt area(s), then the bottom
             bar — API selector on the LEFT, exposed API fields on the RIGHT. Both
             share this panel; only the mode row and the input areas differ. -->
        <div v-else-if="isGenAudio || isGenText" class="icn__genpanel icn__gpa nodrag nopan"
             @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="icn__gpv-modes">
            <button v-for="m in (isGenText ? textModes : audioModes)" :key="m" class="icn__gpv-mode"
                    :class="{ 'is-on': isGenText ? textMode === m : audioMode === m,
                              'is-disabled': isGenText ? !textModeAvailable(m) : !audioModeAvailable(m) }"
                    :title="isGenText ? (textModeReason(m) || ($t('切换到') + $t(m)))
                      : (audioModeReason(m) || ($t('切换到') + $t(m)))"
                    type="button" @click.stop="isGenText ? setTextMode(m) : setAudioMode(m)">{{ $cat(m) }}</button>
          </div>
          <!-- Wired assets (音频 only: 音乐翻唱 / 语音克隆 wait for one clip; the
               pure-prompt modes render nothing). Same row as the other two. -->
          <MediaSlots :slots="assetSlots" />
          <div v-if="isGenText && hasPromptArea" class="icn__gpa-inputs">
            <label class="icn__gpa-box">
              <span class="icn__gpa-label">{{ textMode === '语音转录' ? $t('转写提示') : $t('提示词') }}
                <span v-if="wiredTextNodes.length" class="icn__gpa-wired"
                      :title="wiredText">· {{$t('文本节点已接入')}}</span>
              </span>
              <textarea class="icn__gpa-area icn__gpa-area--a" :value="data.prompt"
                        :placeholder="wiredText || (textMode === '语音转录'
                          ? $t('可选：说明转写语言、领域词等；音频由上游节点接入')
                          : $t('描述你想要生成的内容…'))" spellcheck="false"
                        @input="setField('prompt', $event.target.value)"
                        @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
            </label>
          </div>
          <div v-else-if="hasPromptArea" class="icn__gpa-inputs">
            <label class="icn__gpa-box">
              <span class="icn__gpa-label">{{ $t(audioSlots.a.label) }}
                <span v-if="wiredTextNodes.length" class="icn__gpa-wired"
                      :title="wiredText">· {{$t('文本节点已接入')}}</span>
              </span>
              <textarea class="icn__gpa-area icn__gpa-area--a" :value="data.prompt"
                        :placeholder="wiredText || $t(audioSlots.a.ph)" spellcheck="false"
                        @input="setField('prompt', $event.target.value)"
                        @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
            </label>
            <label class="icn__gpa-box">
              <span class="icn__gpa-label">{{ $t(audioSlots.b.label) }}</span>
              <textarea class="icn__gpa-area icn__gpa-area--b" :value="data.lyrics"
                        :placeholder="$t(audioSlots.b.ph)" spellcheck="false"
                        @input="setField('lyrics', $event.target.value)"
                        @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
            </label>
          </div>
          <div class="icn__gpa-bar">
            <!-- Workflow (API) picker first, settings gear right beside it; the
                 exposed params live behind that gear, drawn as Nodes 2.0 widget
                 rows instead of a cramped wrapping row. -->
            <div class="icn__selwrap">
              <div v-if="noWorkflow" class="icn__sel icn__sel--empty" :title="$t('该分类下暂无工作流')">
                <span class="icn__sel-t">{{$t('该分类下暂无工作流')}}</span>
              </div>
              <template v-else>
                <button class="icn__sel" :class="{ 'is-open': selOpen === 'wf' }" type="button"
                        :title="$t('API（工作流）：') + wfLabel" @click.stop="toggleSel('wf')">
                  <span class="icn__sel-t">{{ wfLabel }}</span>
                  <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
                </button>
                <div v-if="selOpen === 'wf'" class="icn__selmenu"
                     @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                  <button v-for="w in wfOptions" :key="w.id" type="button" class="icn__selitem"
                          :class="{ 'is-on': wfValue === w.id }" @click.stop="pickSel('wf', w.id)">
                    <span class="icn__selitem-t">{{ w.name || w.id }}</span>
                    <IcIcon v-if="wfValue === w.id" class="icn__selitem-check" name="check" :size="14" />
                  </button>
                </div>
              </template>
            </div>
            <div class="icn__gpa-setwrap">
              <button class="icn__gpa-set" :class="{ 'is-open': setOpen, 'is-disabled': noWorkflow }"
                      type="button" :disabled="noWorkflow"
                      :title="noWorkflow ? $t('该分类下暂无工作流')
                        : (apiBarFields.length
                        ? $t('API 参数（{n} 项）', { n: visibleBarFields.length })
                        : $t('API 参数（当前 API 未暴露参数）'))"
                      @click.stop="toggleSet($event)">
                <IcIcon name="settings" :size="14" />
                <span v-if="apiBarFields.length && !setOpen" class="icn__gpa-setdot"></span>
              </button>
              <div v-if="setOpen" class="icn__gpa-pop" :style="popStyle"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <div class="icn__gpa-pophead">
                  <span class="icn__gpa-popt">{{$t('API 参数')}}</span>
                  <span v-if="apiBarFields.length" class="icn__gpa-popcnt">{{ visibleBarFields.length }}</span>
                </div>
                <div v-if="!apiBarFields.length" class="icn__gpa-popempty">
                  {{ $t('当前 API 未暴露参数，可在 API 配置里勾选要显示的输入项') }}
                </div>
                <!-- Nodes 2.0 WidgetGrid: the class string is WidgetGrid.vue verbatim
                     (12px slot | minmax(80px,min-content) label | minmax(125px,1fr)
                     control, 4px row gap, 12px right gutter), so every control gets
                     its width from the shared column instead of a hand-set px. -->
                <div v-else
                     class="icn__gpa-body lg-node-widgets grid grid-cols-[min-content_minmax(80px,min-content)_minmax(125px,1fr)] gap-y-1 bg-node pt-4 pr-3 pb-3 text-xs text-node-foreground rounded-b-xl">
                  <div v-for="f in visibleBarFields" :key="fieldId(f)"
                       :data-widget-name="fieldId(f)"
                       class="group col-span-full grid grid-cols-subgrid items-stretch">
                    <div class="z-10 flex items-stretch w-3"></div>
                    <!-- WidgetLayoutField -->
                    <div class="col-span-2 grid min-w-0 grid-cols-subgrid justify-between gap-2">
                      <div class="content-center-safe truncate" :title="f.label || fieldId(f)">{{ f.label || fieldId(f) }}</div>
                      <div class="relative min-w-0 flex-1">
                        <div class="min-w-0 cursor-default rounded-md transition-all focus-within:ring focus-within:ring-ring"
                             @pointerdown.stop @pointermove.stop @pointerup.stop>

                          <!-- ScrubableNumberInput (WidgetInputNumberInput.vue) -->
                          <div v-if="f.type === 'number' || f.type === 'slider' || f.type === 'random'"
                               class="relative flex w-full items-stretch overflow-hidden rounded-md bg-input text-xs text-foreground h-6">
                            <span class="pointer-events-none absolute inset-0 overflow-clip rounded-md">
                              <span class="block size-full bg-primary/15" :style="{ width: fieldFill(f) + '%' }"></span>
                            </span>
                            <button type="button" :title="$t('减少')" :disabled="!canFieldDec(f)"
                                    class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                    @click.stop="bumpField(f, -1)">
                              <IcIcon name="minus" class="size-4" />
                            </button>
                            <div class="relative my-0.25 min-w-[4ch] flex-1 py-1.5">
                              <input class="absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0"
                                     :value="fieldText(f)" inputmode="decimal"
                                     autocomplete="off" autocorrect="off" spellcheck="false"
                                     @blur="commitFieldNum(f, $event)"
                                     @keydown.enter.prevent="commitFieldNum(f, $event)"
                                     @keydown.up.prevent="stepField(f, 1)"
                                     @keydown.down.prevent="stepField(f, -1)"
                                     @keydown.page-up.prevent="stepField(f, 10)"
                                     @keydown.page-down.prevent="stepField(f, -10)"
                                     @pointerdown.stop @mousedown.stop @dblclick.stop />
                              <div class="absolute inset-0 z-10 cursor-ew-resize touch-pan-y"
                                   :class="editingField === fieldId(f) && 'pointer-events-none hidden'"
                                   @pointerdown.stop="scrubStart(f, $event)"
                                   @pointermove.stop="scrubMove($event)"
                                   @pointerup.stop="scrubEnd(f, $event)"
                                   @pointercancel="scrubCancel"
                                   @dblclick.stop></div>
                            </div>
                            <!-- ValueControlButton (WidgetWithControl slot) -->
                            <button v-if="isRandomField(f)" type="button" :title="modeTitle(f)"
                                    data-vc-badge="1"
                                    class="mr-1 flex h-4.5 w-8 shrink-0 cursor-pointer items-center justify-center self-center rounded-full border-none"
                                    :class="fieldMode(f) === 'fixed'
                                      ? 'bg-transparent text-muted-foreground hover:bg-accent'
                                      : 'bg-primary/30 text-primary hover:bg-primary/27'"
                                    @click.stop="openModes(f, $event)">
                              <IcIcon v-if="fieldMode(f) === 'fixed'" name="pencil-off" class="size-3" />
                              <IcIcon v-else-if="fieldMode(f) === 'randomize'" name="shuffle" class="size-3" />
                              <span v-else class="text-xs font-normal">{{ fieldMode(f) === 'increment' ? '+1' : '-1' }}</span>
                            </button>
                            <button type="button" :title="$t('增加')" :disabled="!canFieldInc(f)"
                                    class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                    @click.stop="bumpField(f, 1)">
                              <IcIcon name="plus" class="size-4" />
                            </button>
                          </div>

                          <!-- WidgetSelectDefault (combobox trigger) -->
                          <div v-else-if="f.type === 'select'"
                               class="flex w-full min-w-0 items-center overflow-hidden rounded-md bg-input text-foreground h-6 hover:bg-accent">
                            <button type="button" role="combobox"
                                    class="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden border-none bg-transparent p-0 outline-none"
                                    :title="(f.label || '') + '（当前：' + fieldValue(f) + '）'"
                                    @click.stop="toggleSel('f:' + fieldId(f), $event)">
                              <span class="min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs">{{ fieldValue(f) }}</span>
                            </button>
                            <button type="button" tabindex="-1"
                                    class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none"
                                    @click.stop="toggleSel('f:' + fieldId(f), $event)">
                              <IcIcon name="chevron-down" class="size-4 text-muted-foreground" />
                            </button>
                          </div>

                          <!-- Switch (WidgetToggleSwitch.vue, no on/off labels) -->
                          <div v-else-if="f.type === 'switch'"
                               class="-m-1 ml-auto flex w-fit items-center gap-2 rounded-full p-1">
                            <button type="button" :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                    class="group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                                    :title="(f.label || $t('开关')) + '：' + (fieldValue(f) ? $t('开') : $t('关'))"
                                    @click.stop="setFieldValue(f, !fieldValue(f))">
                              <span class="pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary">
                                <span :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                      class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"></span>
                              </span>
                            </button>
                          </div>

                          <!-- WidgetInputText -->
                          <label v-else class="relative flex w-full min-w-0 items-center">
                            <input class="flex w-full min-w-0 appearance-none rounded-md border-none bg-input px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                   :value="fieldValue(f)" spellcheck="false" autocomplete="off"
                                   :title="f.label || ''"
                                   @change="setFieldValue(f, $event.target.value)"
                                   @pointerdown.stop @mousedown.stop @dblclick.stop />
                          </label>

                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- NodeFooter.vue Case 4, host class strings verbatim.
                     Nothing inside this block is drawn by hand: height (h-11),
                     band colour (bg-node-header), radius (rounded-b-xl), type
                     (text-xs font-normal) and the pt-8/pb-3 padding all come
                     from the host's own recipe. Upstream the band is h-11 but
                     -mt-5 tucks its top 20px under the node body, so only 24px
                     is ever visible (measured: 100px at 2.27x zoom, label
                     32px from the band top). With no body to hide behind, that
                     is folded to h-6 + py-0 -- the same 24px band with the
                     label centred -- instead of drawing a 44px stripe. The
                     bleed is the host's own trick (-mx-1 -mb-2
                     w-[calc(100%+8px)] in its error branch), scaled to 16px
                     because this card pads 8px. -->
                <div v-if="advancedCount"
                     class="icn__gpa-more isolate -z-1 -mt-5 box-border flex w-full">
                  <button type="button"
                          class="pointer-events-auto relative inline-flex box-border h-11 w-full cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 rounded-none rounded-b-xl border-none bg-node-header p-2 pt-8 pb-3 font-inter text-xs font-normal whitespace-nowrap text-node-foreground transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                          :title="(data.showAdvanced ? $t('隐藏高级输入') : $t('显示高级输入')) + '（' + advancedCount + ' ' + $t('项') + '）'"
                          @click.stop="toggleAdvanced">
                    <div class="flex size-full items-center justify-center gap-2">
                      <span class="truncate">{{ data.showAdvanced ? $t('隐藏高级输入') : $t('显示高级输入') }}</span>
                      <IcIcon :name="data.showAdvanced ? 'chevron-up' : 'settings-2'" :size="16" class="shrink-0" />
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <button class="icn__gp-send icn__gpa-send" type="button"
                    :title="data.status === 'running' ? $t('正在生成…') : $t('运行生成')"
                    :disabled="data.status === 'running'" @click.stop="run">{{$t('运行')}}</button>
          </div>
        </div>

        <div v-else-if="isGen" class="icn__genpanel nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="icn__gpv-modes">
            <button v-for="m in imageModes" :key="m" class="icn__gpv-mode"
                    :class="{ 'is-on': imageMode === m, 'is-disabled': !imageModeAvailable(m) }"
                    :title="imageModeReason(m) || ($t('切换到') + $t(m))" type="button"
                    @click.stop="setImageMode(m)">{{ $cat(m) }}</button>
          </div>
          <!-- Wired assets: the SAME row the video generator uses, so a node in
               图像编辑 / 图像放大 / 背景移除 shows WHICH image is feeding it
               instead of leaving the user to read the wire on the canvas. -->
          <MediaSlots :slots="assetSlots" />
          <div v-if="hasPromptArea" class="icn__gpv-input">
            <!-- "@" picker + rich prompt box: identical to the video generator
                 (same markup, same handlers, same chip hover card). -->
            <div v-if="mention" class="icn__gpv-atmenu"
                 @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
              <button v-for="(item, i) in mention.items" :key="item.key" type="button"
                      class="icn__gpv-atitem" :class="{ 'is-on': i === mention.index }"
                      @mouseenter="hoverMention(i)" @mousedown.prevent @click.stop="pickMention(item)">
                <span class="icn__gpv-atthumb">
                  <img v-if="item.thumb" :src="item.thumb" alt="" draggable="false" />
                  <IcIcon v-else :name="item.kind === 'audio' ? 'volume' : 'play'" :size="12" />
                </span>
                <span class="icn__gpv-atlabel">@{{ item.label }}</span>
                <span class="icn__gpv-atname">{{ item.name }}</span>
              </button>
            </div>
            <div ref="promptEl" class="icn__gpv-rich" contenteditable="true" spellcheck="false"
                 :data-placeholder="$t('描述你想要生成的内容，并在下方调整生成参数。使用 @ 可快速引用接入的素材。')"
                 @input="onPromptInput" @keydown="onPromptKeydown" @blur="closeMention"
                 @compositionstart="onComposeStart" @compositionend="onComposeEnd"
                 @paste.prevent="onPromptPaste"
                 @mouseover="onRefOver" @mouseout="onRefOut" @mouseleave="onRefOut"
                 @pointerdown.stop @mousedown.stop @dblclick.stop></div>
            <Teleport to="#infcanvas-root">
              <div v-if="refPreview" class="icn__gpv-preview icn__gpv-refprev"
                   :style="{ left: refPreview.left + 'px', top: refPreview.top + 'px' }"
                   @pointerdown.stop @mousedown.stop @wheel.stop>
                <img v-if="refPreview.kind === 'image' && refPreview.url"
                     class="icn__gpv-preview-media" :src="refPreview.url" alt="" draggable="false" />
                <video v-else-if="refPreview.kind === 'video' && refPreview.url"
                       class="icn__gpv-preview-media" :src="refPreview.url" autoplay loop playsinline></video>
                <template v-else-if="refPreview.kind === 'audio' && refPreview.url">
                  <audio class="icn__gpv-preview-audio-hidden" :src="refPreview.url"
                         autoplay @loadedmetadata="onRefMeta"></audio>
                  <div class="icn__gpv-preview-audio-meta">
                    <span class="icn__gpv-preview-audio-name">{{ refPreview.label }}</span>
                    <span class="icn__gpv-preview-audio-time">{{ refMetaDuration }}</span>
                  </div>
                </template>
                <img v-else-if="refPreview.thumb"
                     class="icn__gpv-preview-media" :src="refPreview.thumb" alt="" draggable="false" />
                <div v-else class="icn__gpv-preview-media icn__gpv-refprev-ph">{{ refPreview.label }}</div>
                <div v-if="refPreview.kind !== 'audio'" class="icn__gpv-preview-name">{{ refPreview.label }}</div>
              </div>
            </Teleport>
          </div>
          <div class="icn__gp-bar">
            <!-- Workflow (API) picker first, settings gear right beside it; the
                 exposed params live behind that gear, drawn as Nodes 2.0 widget
                 rows instead of a cramped wrapping row. -->
            <div class="icn__selwrap">
              <div v-if="noWorkflow" class="icn__sel icn__sel--empty" :title="$t('该分类下暂无工作流')">
                <span class="icn__sel-t">{{$t('该分类下暂无工作流')}}</span>
              </div>
              <template v-else>
                <button class="icn__sel" :class="{ 'is-open': selOpen === 'wf' }" type="button"
                        :title="$t('API（工作流）：') + wfLabel" @click.stop="toggleSel('wf')">
                  <span class="icn__sel-t">{{ wfLabel }}</span>
                  <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
                </button>
                <div v-if="selOpen === 'wf'" class="icn__selmenu"
                     @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                  <button v-for="w in wfOptions" :key="w.id" type="button" class="icn__selitem"
                          :class="{ 'is-on': wfValue === w.id }" @click.stop="pickSel('wf', w.id)">
                    <span class="icn__selitem-t">{{ w.name || w.id }}</span>
                    <IcIcon v-if="wfValue === w.id" class="icn__selitem-check" name="check" :size="14" />
                  </button>
                </div>
              </template>
            </div>
            <div class="icn__gpa-setwrap">
              <button class="icn__gpa-set" :class="{ 'is-open': setOpen, 'is-disabled': noWorkflow }"
                      type="button" :disabled="noWorkflow"
                      :title="noWorkflow ? $t('该分类下暂无工作流')
                        : (apiBarFields.length
                        ? $t('API 参数（{n} 项）', { n: visibleBarFields.length })
                        : $t('API 参数（当前 API 未暴露参数）'))"
                      @click.stop="toggleSet($event)">
                <IcIcon name="settings" :size="14" />
                <span v-if="apiBarFields.length && !setOpen" class="icn__gpa-setdot"></span>
              </button>
              <div v-if="setOpen" class="icn__gpa-pop" :style="popStyle"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <div class="icn__gpa-pophead">
                  <span class="icn__gpa-popt">{{$t('API 参数')}}</span>
                  <span v-if="apiBarFields.length" class="icn__gpa-popcnt">{{ visibleBarFields.length }}</span>
                </div>
                <div v-if="!apiBarFields.length" class="icn__gpa-popempty">
                  {{ $t('当前 API 未暴露参数，可在 API 配置里勾选要显示的输入项') }}
                </div>
                <!-- Nodes 2.0 WidgetGrid: the class string is WidgetGrid.vue verbatim
                     (12px slot | minmax(80px,min-content) label | minmax(125px,1fr)
                     control, 4px row gap, 12px right gutter), so every control gets
                     its width from the shared column instead of a hand-set px. -->
                <div v-else
                     class="icn__gpa-body lg-node-widgets grid grid-cols-[min-content_minmax(80px,min-content)_minmax(125px,1fr)] gap-y-1 bg-node pt-4 pr-3 pb-3 text-xs text-node-foreground rounded-b-xl">
                  <div v-for="f in visibleBarFields" :key="fieldId(f)"
                       :data-widget-name="fieldId(f)"
                       class="group col-span-full grid grid-cols-subgrid items-stretch">
                    <div class="z-10 flex items-stretch w-3"></div>
                    <!-- WidgetLayoutField -->
                    <div class="col-span-2 grid min-w-0 grid-cols-subgrid justify-between gap-2">
                      <div class="content-center-safe truncate" :title="f.label || fieldId(f)">{{ f.label || fieldId(f) }}</div>
                      <div class="relative min-w-0 flex-1">
                        <div class="min-w-0 cursor-default rounded-md transition-all focus-within:ring focus-within:ring-ring"
                             @pointerdown.stop @pointermove.stop @pointerup.stop>

                          <!-- ScrubableNumberInput (WidgetInputNumberInput.vue) -->
                          <div v-if="f.type === 'number' || f.type === 'slider' || f.type === 'random'"
                               class="relative flex w-full items-stretch overflow-hidden rounded-md bg-input text-xs text-foreground h-6">
                            <span class="pointer-events-none absolute inset-0 overflow-clip rounded-md">
                              <span class="block size-full bg-primary/15" :style="{ width: fieldFill(f) + '%' }"></span>
                            </span>
                            <button type="button" :title="$t('减少')" :disabled="!canFieldDec(f)"
                                    class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                    @click.stop="bumpField(f, -1)">
                              <IcIcon name="minus" class="size-4" />
                            </button>
                            <div class="relative my-0.25 min-w-[4ch] flex-1 py-1.5">
                              <input class="absolute inset-0 truncate border-0 bg-transparent p-1 text-left text-xs focus:outline-0"
                                     :value="fieldText(f)" inputmode="decimal"
                                     autocomplete="off" autocorrect="off" spellcheck="false"
                                     @blur="commitFieldNum(f, $event)"
                                     @keydown.enter.prevent="commitFieldNum(f, $event)"
                                     @keydown.up.prevent="stepField(f, 1)"
                                     @keydown.down.prevent="stepField(f, -1)"
                                     @keydown.page-up.prevent="stepField(f, 10)"
                                     @keydown.page-down.prevent="stepField(f, -10)"
                                     @pointerdown.stop @mousedown.stop @dblclick.stop />
                              <div class="absolute inset-0 z-10 cursor-ew-resize touch-pan-y"
                                   :class="editingField === fieldId(f) && 'pointer-events-none hidden'"
                                   @pointerdown.stop="scrubStart(f, $event)"
                                   @pointermove.stop="scrubMove($event)"
                                   @pointerup.stop="scrubEnd(f, $event)"
                                   @pointercancel="scrubCancel"
                                   @dblclick.stop></div>
                            </div>
                            <!-- ValueControlButton (WidgetWithControl slot) -->
                            <button v-if="isRandomField(f)" type="button" :title="modeTitle(f)"
                                    data-vc-badge="1"
                                    class="mr-1 flex h-4.5 w-8 shrink-0 cursor-pointer items-center justify-center self-center rounded-full border-none"
                                    :class="fieldMode(f) === 'fixed'
                                      ? 'bg-transparent text-muted-foreground hover:bg-accent'
                                      : 'bg-primary/30 text-primary hover:bg-primary/27'"
                                    @click.stop="openModes(f, $event)">
                              <IcIcon v-if="fieldMode(f) === 'fixed'" name="pencil-off" class="size-3" />
                              <IcIcon v-else-if="fieldMode(f) === 'randomize'" name="shuffle" class="size-3" />
                              <span v-else class="text-xs font-normal">{{ fieldMode(f) === 'increment' ? '+1' : '-1' }}</span>
                            </button>
                            <button type="button" :title="$t('增加')" :disabled="!canFieldInc(f)"
                                    class="relative flex shrink-0 cursor-pointer items-center justify-center border-none aspect-square h-full rounded-none bg-transparent p-0 text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
                                    @click.stop="bumpField(f, 1)">
                              <IcIcon name="plus" class="size-4" />
                            </button>
                          </div>

                          <!-- WidgetSelectDefault (combobox trigger) -->
                          <div v-else-if="f.type === 'select'"
                               class="flex w-full min-w-0 items-center overflow-hidden rounded-md bg-input text-foreground h-6 hover:bg-accent">
                            <button type="button" role="combobox"
                                    class="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden border-none bg-transparent p-0 outline-none"
                                    :title="(f.label || '') + '（当前：' + fieldValue(f) + '）'"
                                    @click.stop="toggleSel('f:' + fieldId(f), $event)">
                              <span class="min-w-[4ch] flex-1 truncate pr-1 pl-2 text-left text-xs">{{ fieldValue(f) }}</span>
                            </button>
                            <button type="button" tabindex="-1"
                                    class="flex h-full w-6 shrink-0 cursor-pointer items-center justify-center border-none bg-transparent outline-none"
                                    @click.stop="toggleSel('f:' + fieldId(f), $event)">
                              <IcIcon name="chevron-down" class="size-4 text-muted-foreground" />
                            </button>
                          </div>

                          <!-- Switch (WidgetToggleSwitch.vue, no on/off labels) -->
                          <div v-else-if="f.type === 'switch'"
                               class="-m-1 ml-auto flex w-fit items-center gap-2 rounded-full p-1">
                            <button type="button" :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                    class="group inline-flex h-6 w-10 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full border-0 bg-transparent p-0 outline-none transition-shadow focus-visible:ring-1 focus-visible:ring-ring"
                                    :title="(f.label || $t('开关')) + '：' + (fieldValue(f) ? $t('开') : $t('关'))"
                                    @click.stop="setFieldValue(f, !fieldValue(f))">
                              <span class="pointer-events-none inline-flex h-5 w-9 items-center rounded-full border border-transparent bg-border px-0.5 transition-colors group-data-[state=checked]:bg-primary">
                                <span :data-state="fieldValue(f) ? 'checked' : 'unchecked'"
                                      class="pointer-events-none block size-4 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-3.5 data-[state=unchecked]:translate-x-0"></span>
                              </span>
                            </button>
                          </div>

                          <!-- WidgetInputText -->
                          <label v-else class="relative flex w-full min-w-0 items-center">
                            <input class="flex w-full min-w-0 appearance-none rounded-md border-none bg-input px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                                   :value="fieldValue(f)" spellcheck="false" autocomplete="off"
                                   :title="f.label || ''"
                                   @change="setFieldValue(f, $event.target.value)"
                                   @pointerdown.stop @mousedown.stop @dblclick.stop />
                          </label>

                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <!-- NodeFooter.vue Case 4, host class strings verbatim.
                     Nothing inside this block is drawn by hand: height (h-11),
                     band colour (bg-node-header), radius (rounded-b-xl), type
                     (text-xs font-normal) and the pt-8/pb-3 padding all come
                     from the host's own recipe. Upstream the band is h-11 but
                     -mt-5 tucks its top 20px under the node body, so only 24px
                     is ever visible (measured: 100px at 2.27x zoom, label
                     32px from the band top). With no body to hide behind, that
                     is folded to h-6 + py-0 -- the same 24px band with the
                     label centred -- instead of drawing a 44px stripe. The
                     bleed is the host's own trick (-mx-1 -mb-2
                     w-[calc(100%+8px)] in its error branch), scaled to 16px
                     because this card pads 8px. -->
                <div v-if="advancedCount"
                     class="icn__gpa-more isolate -z-1 -mt-5 box-border flex w-full">
                  <button type="button"
                          class="pointer-events-auto relative inline-flex box-border h-11 w-full cursor-pointer touch-manipulation appearance-none items-center justify-center gap-2 rounded-none rounded-b-xl border-none bg-node-header p-2 pt-8 pb-3 font-inter text-xs font-normal whitespace-nowrap text-node-foreground transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0"
                          :title="(data.showAdvanced ? $t('隐藏高级输入') : $t('显示高级输入')) + '（' + advancedCount + ' ' + $t('项') + '）'"
                          @click.stop="toggleAdvanced">
                    <div class="flex size-full items-center justify-center gap-2">
                      <span class="truncate">{{ data.showAdvanced ? $t('隐藏高级输入') : $t('显示高级输入') }}</span>
                      <IcIcon :name="data.showAdvanced ? 'chevron-up' : 'settings-2'" :size="16" class="shrink-0" />
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <button class="icn__gp-send" type="button"
                    :title="data.status === 'running' ? $t('正在生成…') : $t('运行生成')"
                    :disabled="data.status === 'running'" @click.stop="run">{{$t('运行')}}</button>
          </div>
        </div>

        <!-- WidgetSelectDefault's listbox: same classes as the host's combobox
             content, hung off the node root because the settings card scrolls. -->
        <div v-if="selField" class="icn__gpa-fsel" :style="selStyle"
             @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="max-h-56 overflow-y-auto p-1 text-xs">
            <button v-for="opt in (selField.options || [])" :key="opt" type="button"
                    class="flex h-8 w-full cursor-pointer items-center justify-between gap-3 rounded-sm border-0 bg-transparent p-2 text-left outline-none select-none hover:bg-secondary"
                    :class="fieldValue(selField) === opt && 'bg-primary/20 hover:bg-primary/20'"
                    @click.stop="pickSel('f:' + fieldId(selField), opt)">
              <span class="truncate">{{ opt }}</span>
              <IcIcon v-if="fieldValue(selField) === opt" name="check" class="size-3.5 shrink-0" />
            </button>
          </div>
        </div>

        <!-- ValueControlPopover (ComfyUI): what happens to a 随机数 each run.
             Lives outside .icn__gpa-pop because that card scrolls, and a
             popover nested in it would be clipped at the card's edge. -->
        <div v-if="modeOpen" class="icn__gpa-modes" :style="modeStyle"
             @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="w-full space-y-2 p-2">
            <div class="px-1 pb-0.5 text-xs/tight text-muted-foreground">{{ $t('自动更新该值') }}
              <span class="font-medium text-foreground">{{ $t('之后') }}</span> {{ $t('正在运行工作流：') }}</div>
            <div class="flex flex-col gap-0.5">
              <div v-for="opt in CONTROL_MODES" :key="opt.mode"
                   class="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1.5 text-left">
                <button type="button"
                        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-wrap"
                        @click.stop="pickMode(opt.mode)">
                  <span class="flex size-6 shrink-0 items-center justify-center rounded-md border border-solid border-border/50 bg-secondary">
                    <IcIcon v-if="opt.icon" :name="opt.icon" :size="14" class="text-foreground" />
                    <span v-else class="text-xs font-normal text-foreground">{{ opt.text }}</span>
                  </span>
                  <span class="flex min-w-0 flex-1 flex-col text-xs/tight font-normal">
                    <span class="text-foreground">{{ opt.title }}</span>
                    <span class="text-muted-foreground">{{ opt.desc }}</span>
                  </span>
                </button>
                <button type="button"
                        class="inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-solid bg-transparent outline-none"
                        :class="modeField && fieldMode(modeField) === opt.mode ? 'border-primary' : 'border-border'"
                        @click.stop="pickMode(opt.mode)">
                  <span v-if="modeField && fieldMode(modeField) === opt.mode"
                        class="block size-1.5 rounded-full bg-primary"></span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="icn__tools">
          <button v-for="action in actions" :key="action.key" class="icn__tool" type="button"
                  :data-action="action.key" :class="{ 'icn__tool--danger': action.key === 'delete' }"
                  :title="action.tip || action.label" :aria-label="action.tip || action.label"
                  @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="onAction(action.key, $event)"><IcIcon v-if="action.icon" class="icn__tool-icon" :name="action.icon" :size="14" /><span>{{ action.label }}</span></button>
        </div>

        <Handle v-if="isGen" id="in" type="target" :position="'left'" :style="{ top: handleTop(0) }" />
        <Handle v-if="isText" id="text" type="target" :position="'left'" :style="{ top: handleTop(0) }" />
        <Handle id="out" type="source" :position="'right'" :style="{ top: handleTop(0) }" />

        <div class="icn__rz icn__rz--nw nodrag" @pointerdown="onResizeDown($event, 'nw')" :class="{ 'is-active': resizing === 'nw' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
        <div class="icn__rz icn__rz--ne nodrag" @pointerdown="onResizeDown($event, 'ne')" :class="{ 'is-active': resizing === 'ne' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
        <div class="icn__rz icn__rz--sw nodrag" @pointerdown="onResizeDown($event, 'sw')" :class="{ 'is-active': resizing === 'sw' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
        <div class="icn__rz icn__rz--se nodrag" @pointerdown="onResizeDown($event, 'se')" :class="{ 'is-active': resizing === 'se' }"><svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg></div>
      </div>
    `,
  };

  /* ------------------------------- edge view ----------------------------- */

  /* Mirrors ComfyUI's link rendering (renderer/core/canvas/pathRenderer.ts):
     the bezier itself plus a CENTRE MARKER — a filled circle of radius 5 at the
     curve's t=0.5 point, drawn in the link colour (drawCenterMarker), hidden
     once the canvas is zoomed below 60% (`scale >= 0.6`). ComfyUI opens a link
     menu when that marker is clicked; here a click simply disconnects the wire.
     Highlight: LGraphCanvas.highlighted_links collects every link attached to a
     SELECTED node and renders them with colors.highlighted = '#FFF'. */
  const IcEdge = {
    name: "IcEdge",
    props: ["id", "source", "target", "sourceX", "sourceY", "targetX", "targetY",
            "sourcePosition", "targetPosition", "selected"],
    setup(props) {
      const bezier = computed(() => getBezierPath({
        sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition,
        targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
      }));
      const path = computed(() => bezier.value[0]);
      /* getBezierPath's label point IS the exact t=0.5 sample of the cubic
         (weights .125/.375/.375/.125), i.e. the same point ComfyUI stores as
         link._pos for its centre marker. */
      const cx = computed(() => bezier.value[1]);
      const cy = computed(() => bezier.value[2]);
      const highlighted = computed(() => {
        const ids = state.selectedIds.value;
        return ids.length > 0 && (ids.includes(props.source) || ids.includes(props.target));
      });
      const cut = (event) => {
        event.preventDefault();
        event.stopPropagation();
        NS.flow?.removeEdges?.([props.id]);
      };
      return { path, cx, cy, highlighted, cut };
    },
    template: `
      <g class="ic-edge-g" :class="{ 'is-hl': highlighted }">
        <path :d="path" class="ic-edge-border" />
        <BaseEdge :id="id" :path="path" class="ic-edge" />
        <g class="ic-edge-dot-hit" @pointerdown.stop @click.stop="cut">
          <circle class="ic-edge-dot-halo" :cx="cx" :cy="cy" r="9"></circle>
          <circle class="ic-edge-dot ic-edge-dot-core" :cx="cx" :cy="cy" r="5"></circle>
          <circle class="ic-edge-dot-center" :cx="cx" :cy="cy" r="3"></circle>
        </g>
      </g>
    `,
    components: { BaseEdge },
  };

  /* Dragging a new wire from a slot: green #AAFFAA line + 8px green dot at
     the source handle, 12px amber #FFCC00 dot at the cursor (user spec). Graph
     coords (auto-scaled by the pane). Colours are literal hex, not UI text.
     Vue Flow anchors sourceX/Y at the handle's OUTER EDGE, but our visible slot
     dot is centred on the 6px handle element -> the anchor is half a handle
     (3px) off. Pull it back by half a handle so the drag dot sits exactly on
     the slot centre ("圆心对着圆心"); do the same for the path start. */
  const IcConnectionLine = {
    name: "IcConnectionLine",
    props: ["sourceX", "sourceY", "sourcePosition", "targetX", "targetY", "targetPosition"],
    setup(props) {
      const HALF = 3; // half of the 6px handle (graph units)
      const src = computed(() => {
        const p = String(props.sourcePosition || '').toLowerCase();
        let dx = 0, dy = 0;
        if (p.includes('right')) dx = -HALF;
        else if (p.includes('left')) dx = HALF;
        else if (p.includes('top')) dy = HALF;
        else if (p.includes('bottom')) dy = -HALF;
        else dx = -HALF; // drag always starts from an output (right) handle
        return { x: props.sourceX + dx, y: props.sourceY + dy };
      });
      const path = computed(() => getBezierPath({
        sourceX: src.value.x, sourceY: src.value.y, sourcePosition: props.sourcePosition,
        targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition,
      })[0]);
      return { path, src };
    },
    template: `
      <g class="ic-connline">
        <path :d="path" fill="none" stroke="#AAFFAA" stroke-width="3" />
        <circle :cx="src.x" :cy="src.y" r="4" fill="#AAFFAA" />
        <circle :cx="targetX" :cy="targetY" r="6" fill="#FFCC00" />
      </g>
    `,
  };

  /* -------------------------------- styles ------------------------------- */

  const CSS = `
#infcanvas-vueflow { position:absolute; inset:0; overflow:hidden; background:#1d1d1d;
  --icw-bg:#232428; --icw-bar:#8b929e; --icw-played:#4a9eff;
  --icw-head:#3d9cff; --icw-head-fg:#ffffff;
  /* Node cards are dark by design (reference fidelity). Pin the shared control
     palette to the measured dark-theme values here, so node widgets use the
     SAME variables as dialogs/panels without turning white in the light theme. */
  --ic-line:#494a50; --ic-panel:#262729; --ic-input:#171718; --ic-node-bg:#262729;
  /* Node card = header band + body, exactly the two greys ComfyUI 2.0 uses:
     --node-header = charcoal-700 #202121, --node = --card = charcoal-600. */
  --ic-head-bg:#202121; --ic-head-h:28px;
  --ic-text:#ffffff; --ic-soft:#8a8a8a; --ic-brand:#0b8ce9; --ic-danger:#b33a3a;
  --ic-hover:#313235; --ic-brand-soft:rgba(11,140,233,.15);
  --ic-danger-soft:rgba(179,58,58,.16);
  /* ComfyUI Nodes 2.0 widget tokens (dark theme, measured from source):
     bg-input = --accent = #313235 (ONE step brighter than node bg #262729),
     hover:bg-muted = #3c3d42, focus ring = --ring = --muted-foreground #8a8a8a.
     Widgets are border-none + rounded-md(6px); do NOT reuse --ic-input (#171718)
     here — that is a darker dialog surface, the opposite of node widgets. */
  --icnw-bg:#313235; --icnw-hover:#3c3d42; --icnw-ring:#8a8a8a; --icnw-r:6px;
  --icnw-r-sm:4px; --icnw-panel:#262729; }
.ic-canvas-grid { position:absolute; inset:0; display:block; width:100%; height:100%;
  pointer-events:none; z-index:0; }
/* Groups render before VueFlow in DOM order; this z-index keeps every node
   above their tinted backdrop, exactly like LGraphCanvas.drawGroups. */
.ic-flow { background:transparent; position:relative; z-index:2; }
/* Cursor contract mirrors ComfyUI LGraphCanvas._updateCursorStyle (see the
   reference's xcat-overrides.css "可编辑/抓手模式的光标" block). */
.vue-flow__pane { cursor:default; }
/* Ctrl/Cmd-drag marquee selection: crosshair, not Vue Flow's default pointer. */
.vue-flow__pane.selection { cursor:crosshair; }
/* Dragging the canvas itself: grabbing hand. */
.vue-flow__pane.dragging { cursor:grabbing; }
/* Hand (read-only) mode: pane + viewport are a grab hand everywhere. */
.ic-flow.mode-drag .vue-flow__pane, .ic-flow.mode-drag .vue-flow__viewport { cursor:grab; }
.ic-flow.mode-drag .vue-flow__pane.dragging, .ic-flow.mode-drag .vue-flow__viewport.dragging { cursor:grabbing; }
.vue-flow__node { font-family:Inter,Arial,sans-serif; }
/* Input/output slot (handle) — two-tone dot per user spec (NOT plain fill):
   idle    : centre #AAAAAA 6px (r3), ring #B2B2B2 1px
   active  : centre #AAAAAA 7px (r3.5), ring #D4D4D4 1.5px (visual)
   On highlight BOTH rings grow 0.5px outwards. The dot is pinned to the handle
   centre by a FIXED -3px margin and grown with transform:scale() around
   transform-origin:center — scale cannot move the centre (one composited
   property, no interpolation desync). DO NOT animate width+margin together:
   their sub-pixel rounding differs mid-transition and the centre jitters even
   though both steady states compute equal. box-shadow spread is pre-divided by
   the scale (1.5 / (7/6) = 1.286px) so it renders 1.5px when active.
   ::after = 20px invisible hit area (getSlotInPosition ±10). */
.vue-flow__handle { width:6px; height:6px; min-width:6px; min-height:6px;
  border-radius:50%; background:transparent; border:0; }
.vue-flow__handle::before { content:""; position:absolute; left:50%; top:50%;
  width:6px; height:6px; margin-left:-3px; margin-top:-3px;
  transform:scale(1); transform-origin:center center;
  border-radius:50%; background:#aaa;
  box-shadow:0 0 0 1px #b2b2b2;
  transition:transform .1s, box-shadow .1s; }
.vue-flow__handle::after { content:""; position:absolute; width:20px; height:20px;
  left:50%; top:50%; transform:translate(-50%,-50%); border-radius:50%; }
.vue-flow__handle:hover::before, .vue-flow__handle.connectingto::before,
.vue-flow__handle.vue-flow__handle-connecting::before,
.vue-flow__handle.vue-flow__handle-valid::before { transform:scale(1.166667);
  box-shadow:0 0 0 1.286px #d4d4d4; }
.vue-flow__edge-path.ic-edge { stroke:#9a9; stroke-width:3; }
/* In-flight link is drawn by the #connection-line slot (IcConnectionLine:
   #AAFFAA line + green/amber endpoint dots). This rule is only a fallback if
   the slot ever misses; bundle default is grey #b1b1b7 1px. */
.vue-flow__connection-path { stroke:#AAFFAA; stroke-width:3; fill:none; }
/* Vue Flow adds .updating to edges during recompute and its CSS forces #777
   grey at equal specificity, overriding .ic-edge -> a wire flashes grey. Pin
   our green for that state only; leave .selected/.focus feedback untouched. */
.vue-flow__edge.updating .vue-flow__edge-path.ic-edge { stroke:#9a9; }
.ic-edge-border { fill:none; stroke:rgba(0,0,0,.5); stroke-width:7; stroke-linecap:round; }
.vue-flow__edge.selected .vue-flow__edge-path.ic-edge { stroke:#b3c9b3; }
.ic-edge-g { pointer-events:none; }
.ic-edge-dot-hit { pointer-events:all; cursor:pointer; }
.ic-edge-dot-halo { fill:transparent; }
.ic-edge-dot-core { fill:#9a9; }              /* fixed r=5 outer size, never grows */
/* Active marker = centre r=3 turns black INSIDE the fixed r=5 core, leaving a
   2px #9a9 outer ring (user spec: 中心黑 + 保留外圈2px). core size never changes. */
.ic-edge-dot-center { fill:transparent; pointer-events:none; transition:fill .1s ease; }
.ic-edge-dot-hit:hover .ic-edge-dot-center { fill:#000; }
.ic-flow.is-far .ic-edge-dot-hit { display:none; }
.ic-flow.is-far .ic-edge-dot { display:none; }   /* legacy check_edges.js reads .ic-edge-dot display */
.ic-edge-g.is-hl .vue-flow__edge-path.ic-edge { stroke:#fff; }
.ic-edge-g.is-hl .ic-edge-dot-core { fill:#fff; }
/* On cut-highlight only the wire core turns white; the dark outline
   (.ic-edge-border) keeps its original rgba(0,0,0,.5) so the wire stays
   legible against the white stroke. */
.vue-flow__edge.is-cut .vue-flow__edge-path.ic-edge { stroke:#fff; }
.vue-flow__edge.is-cut .ic-edge-dot-core { fill:#fff; }
.ic-flow.is-cut-mode .vue-flow__pane { cursor:crosshair; }
/* The Alt-knife stroke: a white core with a soft halo, drawn over the wires. */
.ic-cut-trail { position:absolute; inset:0; width:100%; height:100%;
  pointer-events:none; z-index:9; overflow:visible; }
.ic-cut-trail path { fill:none; stroke:#fff; stroke-width:2;
  stroke-linecap:round; stroke-linejoin:round;
  filter:drop-shadow(0 0 3px rgba(255,255,255,.65)); }
/* Multi-selection outline, mirroring ComfyUI's Comfy.SelectionBorder:
   host --border colour, 2px dashes at 5/5, 8px corners, never interactive. */
.ic-selection-border { position:absolute; inset:0; width:100%; height:100%;
  pointer-events:none; z-index:10; overflow:visible; }
/* Groups live INSIDE VueFlow's transformation pane (the zoom-pane slot), in
   graph units, so the 12px radius / 1px border / 20px grips scale with the
   viewport exactly like a node card. The pane is its own stacking context:
   nodes are z=0, so the translucent backdrop sits at z=-1 and the interactive
   strip/grips layer sits above them. All metrics below are GRAPH pixels. */
/* Group uses the host's two-pass fill pattern (box, then title strip over it),
   but at 10% white each: 1-0.9^2 = ~19% over the title, 10% on the body.
   Border is 50% white, text at 82% white. */
.ic-group { position:absolute; z-index:-1; pointer-events:none; box-sizing:border-box;
  border:1px solid rgba(255,255,255,.5); border-radius:12px;
  background:rgba(255,255,255,.10); color:rgba(255,255,255,.82); overflow:visible;
  font-size:20px; }
.ic-group.is-selected { border-color:rgba(255,255,255,.85);
  outline:1px solid rgba(255,255,255,.8); outline-offset:var(--ic-group-sel-pad, 6px); }
/* The layer itself is inert (the pane already is); only its children take
   pointers, and z-index keeps them clickable above the node cards. */
.ic-group-ui { position:absolute; z-index:3; pointer-events:none; box-sizing:border-box;
  font-size:20px; }
.ic-group-ui.is-selected .ic-group-title { color:#fff; }
.ic-group-title { display:flex; align-items:center; box-sizing:border-box;
  width:100%; height:var(--ic-group-title-h, 30px); padding:0 10px;
  border-radius:12px 12px 0 0; background:rgba(255,255,255,.10);
  color:inherit; white-space:nowrap; pointer-events:auto; cursor:move; user-select:none; }
.ic-group-title-input { display:block; box-sizing:border-box; width:100%;
  height:var(--ic-group-title-h, 30px); padding:0 10px; border:1px solid rgba(255,255,255,.5);
  border-radius:12px 12px 0 0; outline:none; background:rgba(38,39,41,.92);
  color:#fff; font:inherit; line-height:1; pointer-events:auto; }
/* Corner grips: same 20px box / 8px glyph / upstream SVG path as node resize. */
.ic-group__rz { position:absolute; width:20px; height:20px; z-index:2;
  opacity:0; transition:opacity .12s ease; pointer-events:auto; }
.ic-group-ui:hover .ic-group__rz, .ic-group-ui.is-selected .ic-group__rz,
.ic-group__rz.is-active { opacity:1; }
.ic-group__rz svg { position:absolute; width:40%; height:40%; }
.ic-group__rz svg path { fill:none; stroke:var(--color-muted-foreground, rgba(255,255,255,.62));
  stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.ic-group__rz:hover svg path, .ic-group__rz.is-active svg path { stroke:${ACCENT}; }
.ic-group__rz--se { right:-4px; bottom:-4px; cursor:se-resize; }
.ic-group__rz--se svg { top:4px; left:4px; }
.ic-group__rz--ne { right:-4px; top:-4px; cursor:ne-resize; }
.ic-group__rz--ne svg { bottom:4px; left:4px; transform:scaleY(-1); }
.ic-group__rz--sw { left:-4px; bottom:-4px; cursor:sw-resize; }
.ic-group__rz--sw svg { top:4px; right:4px; transform:scaleX(-1); }
.ic-group__rz--nw { left:-4px; top:-4px; cursor:nw-resize; }
.ic-group__rz--nw svg { bottom:4px; right:4px; transform:scale(-1,-1); }
/* Selection toolbox: host floating-panel look, centred 10px above the box. */
.ic-selection-tools { position:absolute; z-index:11; display:flex; align-items:center;
  gap:2px; height:32px; padding:2px; box-sizing:border-box; white-space:nowrap;
  transform:translate(-50%, -100%); pointer-events:auto;
  border:1px solid var(--border, #494a50); border-radius:8px;
  background:var(--ic-panel, #262729); box-shadow:0 6px 20px rgba(0,0,0,.45); }
.ic-selection-tools button { display:inline-flex; align-items:center; gap:5px;
  height:26px; padding:0 8px; border:0; border-radius:6px; background:transparent;
  color:var(--ic-text, #ffffff); font:inherit; font-size:12px; line-height:1;
  cursor:pointer; }
.ic-selection-tools button:hover { background:var(--accent, #3c3d42); }
.ic-selection-tools button i { width:14px; text-align:center; font-size:13px; }
.vue-flow__selection { background:rgba(74,158,255,.08); border:1px solid rgba(74,158,255,.6); }
/* Vue Flow renders a full-box NodesSelection rect on top of multi-selected
   nodes (pointer-events:all by default). It swallows every click, so a plain
   click can no longer replace the selection and Shift/Ctrl+click cannot toggle
   individual nodes -- the exact "selection feels broken" symptom. LiteGraph
   has no such overlay: clicking a node selects it, dragging any selected node
   moves the whole group, and the empty space between nodes belongs to the
   pane. Let the rect be visual only; group dragging still works via nodes. */
.vue-flow__nodesselection-rect { pointer-events:none!important; background:transparent; border:0; }
.ic-hide-edges .vue-flow__edge { display:none; }

/* ---- asset node shell: reference .demo-node (border:0 / padding:0 / radius 12),
   selected ring = ComfyUI's NODE_BOX_OUTLINE_COLOR (#FFF) at
   LGraphCanvas.connections_width (3). The node name is a top-left capsule
   instead of a 30px title bar; the hover tool row sits above the frame. ---- */
/* Node shadow mirrors host Nodes 2.0 LGraphNode.vue: the root carries the
   Tailwind drop-shadow-lg filter = drop-shadow(0 9px 7px var(--shadow-color)),
   and --shadow-color is #0006 (rgba(0,0,0,.4)). It is a FILTER, not a
   box-shadow: it follows the card's rounded/transparent silhouette. The node
   lives in the zoom pane, so these px are graph units and scale with it.
   The 3px white selection ring is a separate box-shadow (host outline). */
.icn { position:relative; border-radius:12px; background:var(--ic-head-bg, #202121); color:#ddd; user-select:none;
  filter:drop-shadow(0 9px 7px rgba(0,0,0,.4)); }
.icn.is-selected { box-shadow:0 0 0 3px #fff; }
.icn__body { position:relative; overflow:hidden; background:var(--ic-node-bg, #262729); }
/* Only the BOTTOM corners round: the header above owns the top ones, so a
   rounded top here would let the darker card colour show through the seam. */
.icn--media .icn__body, .icn--text .icn__body { border-radius:0 0 12px 12px; }

/* ComfyUI 2.0 node header: a REAL strip at the top of the card, not an overlay.
   LGraphNode.vue wraps everything in bg-node-header (charcoal-700 #202121) and
   paints the body bg-node (charcoal-600 #262729) underneath it, so the title
   band reads as a darker block — that is the whole trick. NodeHeader.vue is
   p-1 (4px) around an icon-sm control with a truncating title at text-xs.
   The collapse chevron is intentionally omitted (we have no collapse). */
.icn__head { position:relative; z-index:6; box-sizing:border-box;
  height:var(--ic-head-h, 28px); padding:0 10px; display:flex; align-items:center;
  border-radius:12px 12px 0 0; background:var(--ic-head-bg, #202121);
  pointer-events:none; }
/* ComfyUI draws the title as BARE TEXT inside the header band (NodeHeader.vue
   wraps an EditableText, whose resting state is a plain span and whose editing
   state is a borderless input: rounded-none, zero padding, no focus ring).
   No capsule, no chip, no hover plate — the darker band IS the affordance. */
.icn__name { display:inline-block; max-width:100%; box-sizing:border-box;
  padding:0; border-radius:0; background:transparent;
  color:#cdcdcd; font-size:12px; line-height:1;
  font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  user-select:none; pointer-events:auto; cursor:default; }
.icn__name--edit { min-width:60px; max-width:260px; overflow:hidden; text-overflow:clip;
  background:transparent; outline:none; box-shadow:none;
  cursor:text; user-select:text; }

/* Single-node action row mirrors the multi-select toolbox (.ic-selection-tools):
   one dark floating panel with a border/radius/shadow, transparent buttons that
   highlight on hover. Centred above the node via left:50% + translate, which
   also carries the show/hide slide so the transform never fights for both. */
.icn__tools { position:absolute; left:50%; bottom:calc(100% + 10px); width:max-content; z-index:30;
  display:flex; align-items:center; gap:2px; height:32px; padding:2px; box-sizing:border-box;
  white-space:nowrap; pointer-events:none; opacity:0; visibility:hidden;
  transform:translate(-50%, 4px);
  transition:opacity .12s ease, transform .12s ease, visibility 0s linear .12s;
  border:1px solid var(--border, #494a50); border-radius:8px;
  background:var(--ic-panel, #262729); box-shadow:0 6px 20px rgba(0,0,0,.45); }
/* The panel belongs to the SELECTED node only: hovering a node no longer pops
   a floating toolbar over its neighbours. Selecting is one click on the node
   itself (or a Ctrl box-select), so the row is still one click away. */
.icn.is-selected .icn__tools {
  opacity:1; visibility:visible; transform:translate(-50%, 0);
  transition:opacity .12s ease, transform .12s ease, visibility 0s; }
.icn__tool { pointer-events:auto; display:inline-flex; align-items:center; gap:5px;
  height:26px; padding:0 8px; border:0; border-radius:6px; background:transparent;
  color:var(--ic-text, #ffffff); font:inherit; font-size:12px; line-height:1;
  white-space:nowrap; cursor:pointer; }
.icn__tool-icon { flex:0 0 auto; display:block; opacity:.9; }
.icn__tool:hover .icn__tool-icon { opacity:1; }
.icn__tool:hover { background:var(--accent, #3c3d42); color:var(--ic-text, #ffffff); }
.icn__tool--danger:hover { background:var(--ic-danger, #b33a3a); color:var(--ic-text, #ffffff); }

/* Media fills the whole card; media elements are inert so dragging the node
   and clicking the canvas behave exactly like the reference .vp-video. */
.icn__media { position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
  background:var(--ic-node-bg, #262729); display:block; pointer-events:none; }
.icn__wave-audio { display:none; }
/* The waveform owns the whole node: the control bar is a transparent overlay,
   so reserving its 98px left a dead band under the bars and made the wave look
   jammed against the top edge. plotBox() keeps the bars clear of the button row
   instead. */
.icn__wave-host { position:absolute; inset:0; overflow:hidden; background:var(--icw-bg);
  cursor:inherit; touch-action:none; user-select:none; }
.icn__wave { display:block; width:100%; height:100%; pointer-events:none; }
/* The name capsule floats at top-left (top:8, height:22). Reserve space above
   the text so the first line is never hidden behind it. */
.icn__text { position:absolute; inset:0; padding:8px 10px; font-size:12px; line-height:1.5;
  color:var(--ic-text, #ffffff); overflow:auto; white-space:pre-wrap; word-break:break-word; }
.icn__text p { margin:0 0 6px; } .icn__text h1, .icn__text h2, .icn__text h3 { margin:4px 0 6px; font-size:14px; }
.icn__text ul, .icn__text ol { margin:4px 0; padding-left:18px; }
.icn__text code { padding:0 3px; border-radius:3px; background:var(--ic-hover, #313235); }
.icn__text a { color:var(--ic-brand, #0b8ce9); }
.icn__text-edit { position:absolute; inset:0; z-index:5; box-sizing:border-box; padding:8px 10px;
  border:0; border-radius:var(--icnw-r, 6px); outline:none; resize:none; cursor:text;
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff); font:12px/1.5 ui-monospace, Consolas, monospace; }
.icn__text-edit:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:6px; padding:0; border:0; border-radius:12px;
  color:#a0a0a0; background:var(--ic-node-bg, #262729); font:inherit; cursor:pointer; }
.icn__file { display:none; }
.icn__empty-line { font-size:12px; white-space:nowrap; }
.icn:hover .icn__empty { color:var(--ic-text, #ffffff); }
/* Generate nodes never upload from the body — a centred glyph of the medium
   stands in for the result until one exists. Kept low-contrast so the node
   frame still reads as empty rather than as a button. */
.icn__gen-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  box-sizing:border-box; border-radius:12px; background:var(--ic-node-bg, #262729);
  color:#5c5d63; user-select:none; pointer-events:none; }
.icn__gen-empty svg { display:block; }
.icn:hover .icn__gen-empty { color:#787980; }
.icn.is-selected .icn__gen-empty { color:#8b8c93; }
/* Text nodes keep their own background (the empty editor underneath), so the
   glyph layer must not paint over it. */
.icn__gen-empty--ghost { background:transparent; }

/* ---- control bar: 1:1 port of the native video controls ----
   This is the bar ComfyUI's Load Video node shows: it renders a plain video
   element with native controls, so everything below is pixel-sampled from a
   real one (480x270 frame at 2x DPR):
     panel    98px tall, NO background (the native black scrim was dropped on
              request: it turned the whole lower third into one dark block and
              made the audio waveform look squeezed into the top of the node)
     seek     full-width 4px capsule, centred 32px above the bottom edge and
              ABOVE the icon row (native control-bar order); x 16..464;
              unplayed rgba(255,255,255,.66), played #fff
     row 2    icon row: 24px boxes centred 16px above the bottom edge;
              equal 16px gaps from the seek centre above and the node edge below
     play     triangle 8.5 x 12px, centre x = 24.75 (row padding 12px)
     time     14px white starting at x = 48.5  => 12px gap after the button
     volume   speaker 14.5px tall, same row, flush with the right padding
   The fullscreen key and the three-dot overflow menu are NOT reproduced --
   they were explicitly dropped from this node.
   Never write backticks inside this CSS string. ---- */
.icn__bar { position:absolute; left:0; right:0; bottom:0; z-index:4;
  box-sizing:border-box; height:98px;
  /* No scrim: the black gradient made the whole lower third read as one dark
     block, which visually pushed the audio waveform into the top of the node.
     Controls sit directly on the media/waveform instead. */
  background:transparent;
  color:#fff; touch-action:none; user-select:none;
  /* Hover-only overlay, like a native player: at rest nothing is drawn over the
     media. The strip itself NEVER takes the pointer -- only the real controls do
     (--ic-bar-hit), so a drag started anywhere in the lower third still moves
     the node instead of dying on empty bar space. */
  opacity:0; pointer-events:none; --ic-bar-hit:none;
  transition:opacity .16s ease; }
/* Revealed by hovering ANYWHERE on the card (not just the invisible strip,
   which cannot be hovered while inert), by KEYBOARD focus inside the bar
   (:focus-visible only -- a plain :focus-within kept the bar pinned after any
   mouse click on play), and for the whole duration of a slider drag: pointer
   capture keeps that gesture alive after the pointer leaves the card. The custom property
   inherits into the controls, which is the only place we switch hit-testing on. */
.icn:hover .icn__bar,
.icn__bar:has(:focus-visible),
.icn__bar.is-dragging,
.icn__bar:has(.is-dragging) { opacity:1; --ic-bar-hit:auto; }
.icn__bar .icn__btn,
.icn__bar .icn__slider,
.icn__bar .icn__vol-group { pointer-events:var(--ic-bar-hit, none); }
.icn__bar-left { position:absolute; left:12px; right:12px; bottom:4px;
  height:24px; display:flex; align-items:center; gap:12px; }
.icn__btn { flex:0 0 24px; width:24px; height:24px; display:inline-flex;
  align-items:center; justify-content:center; padding:0; border:0; border-radius:50%;
  background:transparent; color:#fff; cursor:pointer; }
.icn__btn svg { display:block; width:18px; height:18px; color:#fff; }
.icn__btn--vol svg { width:17px; height:17px; }
/* No capsule/wash under the icons, not even on hover: the reference draws the
   bare glyph directly on the media. */
/* Reference layout: the speaker and its bar sit side by side, both fully
   visible for as long as the (hover-only) control bar is shown. No expanding
   pill and no second hover needed to reach the volume. */
.icn__vol-group { position:absolute; right:12px; bottom:4px; height:24px;
  display:inline-flex; flex-direction:row-reverse; align-items:center; gap:4px; }
.icn__vol-group > * { position:relative; z-index:1; }
.icn__vol { width:56px; opacity:1; }
.icn__time { flex:0 0 auto; display:inline-flex; align-items:center;
  font-size:12px; font-weight:400; line-height:1; color:#fff;
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.icn__time b { display:inline-block; font-weight:400; }
.icn__time i { font-style:normal; padding:0 5px; }
/* 16px hit area around the 4px visual line. */
.icn__slider { position:relative; flex:0 0 auto; height:16px; cursor:pointer;
  outline:none; touch-action:none; }
.icn__seek { position:absolute; left:0; right:0; bottom:24px; height:16px; }
.icn__slider-track, .icn__slider-fill, .icn__slider-thumb { pointer-events:none; }
/* KNOB_INSET (10px) is both the visible margin and the travel margin:
   makeSlider maps the pointer against width - 2*KNOB_INSET so ratio 0 / 1 land
   exactly on the ends of the line. */
.icn__slider-track, .icn__slider-fill { position:absolute; top:50%; left:${KNOB_INSET}px; right:${KNOB_INSET}px;
  height:4px; margin-top:-2px; border-radius:999px; }
.icn__slider-track { background:${TRACK}; }
/* No transform / will-change here: those promote the fill to its own
   composited layer, which the viewport's scale(zoom) then upscales as a
   bitmap — so it goes blurry when the canvas is zoomed in. */
.icn__slider-fill { background:${BAR_FILL}; right:auto; width:0; }
/* Hover knobs: 12px plain white discs, centred on the 4px line. No border and
   no shadow. They only exist while that slider is hovered, focused or dragged. */
.icn__slider-thumb { position:absolute; top:50%; left:0; width:0; height:0;
  margin:0; border-radius:50%; background:#fff; opacity:0;
  transition:opacity .12s ease; }
.icn__seek:hover .icn__slider-thumb, .icn__seek:focus-visible .icn__slider-thumb,
.icn__seek.is-dragging .icn__slider-thumb,
.icn__vol:hover .icn__slider-thumb, .icn__vol:focus-visible .icn__slider-thumb,
.icn__vol.is-dragging .icn__slider-thumb {
  width:12px; height:12px; margin:-6px 0 0 -6px; opacity:1; }
.icn__slider:focus-visible .icn__slider-fill { box-shadow:0 0 0 2px rgba(255,255,255,.45); }

.icn__form { position:absolute; inset:0; display:flex; flex-direction:column; gap:4px; padding:38px 10px 10px; font-size:var(--ic-ctrl-fs, 12px); overflow:auto; }
.icn__row { display:flex; align-items:center; gap:6px; }
.icn__label { flex:0 0 42px; color:var(--ic-soft, #8a8a8a); font-size:10px; }
.icn__input { flex:1 1 0; min-width:0; height:var(--ic-ctrl-h, 30px); padding:0 8px;
  border-radius:var(--icnw-r, 6px); border:0;
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);
  font-size:var(--ic-ctrl-fs, 12px); outline:none; cursor:text; }
.icn__input:hover { background:var(--icnw-hover, #3c3d42); }
.icn__input:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__actions { display:flex; gap:6px; margin-top:2px; }
.icn__action { flex:1 1 0; height:var(--ic-ctrl-h, 30px); border-radius:var(--icnw-r, 6px);
  border:0; background:var(--icnw-bg, #313235);
  color:var(--ic-text, #ffffff); font-size:var(--ic-ctrl-fs, 12px); cursor:pointer; }
.icn__action--ghost { background:transparent; }
.icn__action:hover { background:var(--icnw-hover, #3c3d42); }
.icn__status { display:flex; align-items:center; gap:6px; margin-top:auto; color:var(--ic-soft, #8a8a8a); }
.icn__dot { width:6px; height:6px; border-radius:50%; background:var(--ic-soft, #8a8a8a); }
.icn__status.is-running .icn__dot { background:#e0b34a; }
.icn__status.is-done .icn__dot { background:#5dcaa5; }
.icn__status.is-error .icn__dot { background:var(--ic-danger, #b33a3a); }

/* ---- generate-node parameter PANEL: the body above is an asset-identical
   media card; this whole block appears BELOW it only when the node is selected.
   Three zones mirroring the reference: mode tabs / prompt input / bottom bar
   with a round send button. Sits outside .icn__body so overflow can't clip it. ---- */
/* z-index 32 clears the selected node's action row (z-index 30): the settings
   popover grows UPWARD out of the panel, and a workflow with a dozen exposed
   parameters makes it tall enough to reach the 上传/删除 buttons — at 24 those
   buttons' labels showed through the popover's rows. */
.icn__genpanel { position:absolute; left:50%; top:calc(100% + 20px); z-index:32;
  box-sizing:border-box; width:max(100%, 420px);
  display:flex; flex-direction:column; gap:0;
  padding:8px; border-radius:var(--ic-radius, 10px); border:1px solid var(--ic-line, #494a50);
  background:var(--ic-panel, #262729); box-shadow:0 8px 28px rgba(0,0,0,.5); color:var(--ic-text, #ffffff);
  opacity:0; visibility:hidden; transform:translate(-50%, -6px);
  transition:opacity .14s ease, transform .14s ease, visibility 0s linear .14s; }
.icn--media.is-selected .icn__genpanel,
.icn--text.is-selected .icn__genpanel { opacity:1; visibility:visible; transform:translateX(-50%);
  transition:opacity .14s ease, transform .14s ease, visibility 0s; }
/* Ctrl/Shift multi-selection is a bulk gesture (move / delete), not an edit
   session: the per-node action row and parameter panel would overlap every
   other selected card, so both stay away until only one node remains. */
.ic-flow.is-multi-select .icn__tools,
.ic-flow.is-multi-select .icn__genpanel { display:none !important; }
/* Workflow switch — same Nodes 2.0 segmented control as .icn__gpv-modes.
   px is 10px instead of the source's px-5: workflow names are arbitrary length
   and this row holds 3-6 tabs, so the extra padding would truncate every label. */
.icn__gp-tabs { display:flex; align-items:center; justify-content:center; gap:4px;
  margin-bottom:8px; padding:4px; border-radius:6px; background:var(--icnw-bg, #313235); }
.icn__gp-tab { display:inline-flex; align-items:center; justify-content:center;
  flex:1 1 0; min-width:0; height:24px; padding:0 10px; border:0;
  border-radius:var(--icnw-r-sm, 4px); background:transparent;
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:12px; font-weight:400; line-height:1;
  text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;
  transition:background-color .15s ease, color .15s ease; }
.icn__gp-tab:hover { background:rgba(38,39,41,.5); }
.icn__gp-tab.is-on { background:var(--icnw-panel, #262729); color:var(--ic-text, #ffffff); }
/* Prompt input area: every generator now paints the SAME rich box
   (.icn__gpv-rich) so the @ picker and its chips work on all of them. */
/* Bottom parameter bar */
.icn__gp-bar { display:flex; align-items:center; gap:6px; min-width:0; }
/* ---- Nodes 2.0 select (ComfyUI src/components/ui/select) ----------------
   Native <select> popups are painted by the OS and cannot be themed, so the
   trigger is a button and the list is our own popover:
     trigger  SelectTrigger size="md"  → rounded-lg, bg-secondary, hover/open
              bg-accent, leading label + chevron-down in muted-foreground;
     content  SelectContent            → bg-background #171718, rounded-lg,
              p-2, 8px below the trigger, 1px border + shadow, scrolls;
     item     SelectItem               → rounded-sm, accent on hover, muted
              surface + check glyph for the current value.
   Height stays 30px so it lines up with seed / 步数 / 运行. The menu may
   overflow the panel on purpose: .icn does not clip, .icn__body does. */
.icn__selwrap { position:relative; display:inline-flex; min-width:0; }
.icn__sel { display:inline-flex; align-items:center; gap:6px; height:var(--ic-ctrl-h, 30px);
  padding:0 8px 0 10px; border:0; border-radius:8px; background:var(--icnw-bg, #313235);
  color:var(--ic-text, #ffffff); font:inherit; font-size:12px; line-height:1;
  max-width:172px; min-width:0; cursor:pointer; transition:background-color .15s ease; }
.icn__sel:hover, .icn__sel.is-open { background:var(--icnw-hover, #3c3d42); }
/* Empty category: the picker is a plain box, no caret and no hover affordance. */
.icn__sel--empty { cursor:default; color:var(--ic-soft, #8a8a8a); }
.icn__sel--empty:hover { background:var(--icnw-bg, #313235); }
.icn__sel-t { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.icn__sel-caret { flex:0 0 auto; color:var(--ic-soft, #8a8a8a); }
.icn__selmenu { position:absolute; left:0; top:calc(100% + 8px); z-index:60;
  box-sizing:border-box; min-width:max(100%, 148px); max-height:240px; overflow:auto;
  display:flex; flex-direction:column; padding:8px; border-radius:8px;
  background:#171718; border:1px solid var(--ic-line, #494a50);
  box-shadow:0 10px 30px rgba(0,0,0,.55); }
.icn__selitem { display:flex; align-items:center; justify-content:space-between; gap:10px;
  width:100%; padding:7px 8px; border:0; border-radius:4px; background:transparent;
  color:var(--ic-text, #ffffff); font:inherit; font-size:12px; line-height:1.2;
  text-align:left; white-space:nowrap; cursor:pointer; }
.icn__selitem:hover { background:var(--icnw-bg, #313235); }
.icn__selitem.is-on { background:var(--icnw-hover, #3c3d42); }
.icn__selitem-t { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.icn__selitem-check { flex:0 0 auto; color:var(--ic-text, #ffffff); }
.icn__selitem--hint { color:var(--ic-soft, #8a8a8a); cursor:default; }
.icn__selitem--hint:hover { background:transparent; }
.icn__gp-num { display:inline-flex; align-items:center; gap:4px; height:var(--ic-ctrl-h, 30px); padding:0 8px;
  border-radius:var(--icnw-r, 6px); border:0;
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); font-size:10px; white-space:nowrap; }
.icn__gp-num:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gp-num input { width:42px; border:0; outline:none; background:transparent; color:var(--ic-text, #ffffff);
  font:inherit; font-size:var(--ic-ctrl-fs, 12px); text-align:right; -moz-appearance:textfield; cursor:text; }
.icn__gp-num input::-webkit-inner-spin-button, .icn__gp-num input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
.icn__gp-send { flex:0 0 auto; height:var(--ic-ctrl-h, 30px); padding:0 12px; margin-left:auto;
  display:inline-flex; align-items:center; justify-content:center; border:0;
  border-radius:8px; background:var(--ic-brand, #0b8ce9); color:#fff;
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; white-space:nowrap; cursor:pointer; }
.icn__gp-send:hover { background:rgba(11,140,233,.9); }
.icn__gp-send:disabled { opacity:.5; cursor:default; }

/* ---- VIDEO generator panel (reference layout) ---- */
.icn__genpanel.icn__gpv, .icn__genpanel:not(.icn__gpv):not(.icn__gpa) { width:max(100%, 460px); padding:10px; }
/* Mode switch = Nodes 2.0 WidgetToggleSwitch (a labelled BOOLEAN widget):
   ToggleGroup gets WidgetInputBaseClass + "flex w-full gap-1 p-1" (bg-input
   #313235 / rounded-md / 4px padding & gap), each ToggleGroupItem is size sm
   (h-6 px-5 text-xs / rounded-sm / flex-1 truncate), inactive is transparent
   muted-foreground hover:bg-secondary/50, active is bg-secondary + foreground. */
.icn__gpv-modes { display:flex; align-items:center; justify-content:center; gap:4px;
  margin-bottom:8px; padding:4px; border-radius:6px; background:var(--icnw-bg, #313235); }
.icn__gpv-mode { display:inline-flex; align-items:center; justify-content:center;
  flex:1 1 0; min-width:0; height:24px; padding:0 20px; border:0;
  border-radius:var(--icnw-r-sm, 4px); background:transparent;
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:12px; font-weight:400; line-height:1;
  text-align:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer;
  transition:background-color .15s ease, color .15s ease; }
/* hover only shifts the background (hover:bg-secondary/50); muted-foreground
   text stays put — only the active item turns white. */
.icn__gpv-mode:hover { background:rgba(38,39,41,.5); }
.icn__gpv-mode.is-on { background:var(--icnw-panel, #262729); color:var(--ic-text, #ffffff); }
/* Kept pointer-events on (the source uses disabled:pointer-events-none) so the
   disabled tab still surfaces its modeReason() tooltip on hover. */
.icn__gpv-mode.is-disabled { opacity:.5; cursor:not-allowed; }
.icn__gpv-mode.is-disabled:hover { background:transparent; color:var(--ic-soft, #8a8a8a); }
/* Wired-assets row: incoming thumbnails */
.icn__gpv-assets { display:flex; align-items:center; gap:6px; margin-bottom:9px; min-height:40px; }
/* Wrapper is the positioning + hover context for the floating preview. It has
   NO overflow clip so the 160px preview can escape the small thumbnail. */
.icn__gpv-slot { position:relative; flex:0 0 40px; width:40px; height:40px; cursor:pointer; }
.icn__gpv-asset { position:relative; box-sizing:border-box; width:40px; height:40px; flex:0 0 40px;
  border-radius:var(--ic-ctrl-r, 7px); border:1px solid var(--ic-line, #494a50);
  background:var(--ic-input, #171718); overflow:hidden;
  display:inline-flex; align-items:center; justify-content:center; color:var(--ic-soft, #8a8a8a); }
.icn__gpv-asset img { width:100%; height:100%; object-fit:cover; display:block; }
/* Play triangle overlaid on a video's extracted thumbnail (and shown alone
   before extraction completes). Dark disc keeps it legible on bright frames. */
.icn__gpv-asset-play { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); z-index:1;
  box-sizing:content-box; padding:5px 4px 5px 6px; border-radius:50%; color:#fff;
  background:rgba(0,0,0,.5); display:inline-flex; align-items:center; justify-content:center;
  pointer-events:none; }
.icn__gpv-asset--empty { border-style:dashed; border-color:var(--ic-line, #494a50);
  background:transparent; color:var(--ic-soft, #8a8a8a); cursor:default; }
/* Per-slot name label (图片1 / 视频1 / 音频1) pinned to the bottom edge. */
.icn__gpv-asset-label { position:absolute; left:0; right:0; bottom:0; z-index:2;
  padding:2px 0 1px; text-align:center; font-size:9px; line-height:1.1; color:#fff;
  background:linear-gradient(transparent, rgba(0,0,0,.78)); pointer-events:none;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
/* Hover preview popover: 160px wide, height follows media aspect ratio. Anchored
   above the thumbnail; a transparent bottom pad bridges the gap so the pointer
   can travel from thumbnail into popover without leaving the wrapper. */
.icn__gpv-preview { position:absolute; left:50%; bottom:calc(100% + 10px); transform:translateX(-50%);
  z-index:80; box-sizing:border-box; width:160px; padding:0; border-radius:var(--ic-radius, 10px);
  cursor:default; background:var(--ic-panel, #262729); border:1px solid var(--ic-line, #494a50);
  box-shadow:0 8px 28px rgba(0,0,0,.6); }
/* Transparent bridge below the popover covers the 10px gap up to the wrapper so
   the pointer can travel into the preview without firing mouseleave. */
.icn__gpv-preview::after { content:""; position:absolute; left:0; right:0; top:100%; height:12px; }
/* Media fills the CONTENT box (the card is border-box, so 160px minus the 2px
   border) and its top corners are the card radius minus that border — otherwise
   the image bleeds over the 1px frame and the corners read as a double curve. */
.icn__gpv-preview-media { display:block; width:100%; height:auto; max-height:360px; object-fit:contain;
  background:#000; border-radius:calc(var(--ic-radius, 10px) - 1px) calc(var(--ic-radius, 10px) - 1px) 0 0; }
/* Audio preview: no native controls. Hidden player autoplays; only duration +
   name are shown, matching the reference's restrained audio presentation. */
.icn__gpv-preview-audio-hidden { display:block; width:0; height:0; opacity:0; pointer-events:none; }
.icn__gpv-preview-audio-meta { display:flex; align-items:center; gap:8px; min-width:0;
  padding:7px 8px; background:var(--ic-input, #171718);
  border-radius:calc(var(--ic-radius, 10px) - 1px); }
/* Label (音频1) comes first and takes the remaining space; duration trails on
   the right as a small muted capsule. */
.icn__gpv-preview-audio-name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; font-size:10px; color:var(--ic-text, #ffffff); font-weight:600; }
.icn__gpv-preview-audio-time { flex:0 0 auto; padding:1px 4px; border-radius:4px;
  background:var(--ic-hover, #313235); color:var(--ic-soft, #8a8a8a); font-size:10px;
  font-variant-numeric:tabular-nums; }
.icn__gpv-preview-name { padding:3px 6px 4px; font-size:10px; color:var(--ic-soft, #8a8a8a);
  background:var(--ic-input, #171718);
  border-radius:0 0 calc(var(--ic-radius, 10px) - 1px) calc(var(--ic-radius, 10px) - 1px); }
/* Prompt textarea */
/* Prompt box + the "@" quick-reference picker. The picker is a Nodes 2.0
   popover: secondary surface, 8px radius, 12px label, accent hover,
   20px thumbnail. It floats ABOVE the box so it never fights the param bar. */
.icn__gpv-input { position:relative; margin-bottom:9px; }
.icn__gpv-atmenu { position:absolute; left:0; right:0; bottom:calc(100% + 6px); z-index:8;
  display:flex; flex-direction:column; gap:2px; padding:4px; max-height:132px; overflow:auto;
  border-radius:8px; border:1px solid rgba(255,255,255,.09);
  background:var(--icnw-panel, #262729); box-shadow:0 12px 32px rgba(0,0,0,.55); }
.icn__gpv-atitem { display:flex; align-items:center; gap:8px; width:100%; min-height:28px;
  padding:0 6px; border:0; border-radius:4px; background:transparent;
  color:var(--ic-soft, #8a8a8a); font:inherit; font-size:12px; font-weight:400; line-height:1;
  text-align:left; white-space:nowrap; cursor:pointer; }
.icn__gpv-atitem.is-on { background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff); }
.icn__gpv-atthumb { flex:0 0 20px; width:20px; height:20px; display:inline-flex;
  align-items:center; justify-content:center; overflow:hidden; border-radius:4px;
  background:#1c1d1f; color:var(--ic-soft, #8a8a8a); }
.icn__gpv-atthumb img { display:block; width:100%; height:100%; object-fit:cover; }
.icn__gpv-atlabel { flex:0 0 auto; color:inherit; font-weight:500; }
.icn__gpv-atname { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap; color:var(--ic-soft, #8a8a8a); font-size:10px; }
.icn__gpv-atitem.is-on .icn__gpv-atname { color:rgba(255,255,255,.62); }
/* Prompt EDITOR: contenteditable, so a reference can be an atomic chip.
   Same box as the other prompt areas (input surface) and the SAME type as the
   rest of the node: inherited sans, 12px, 1.55 — no monospace. 104px ≈ 5 lines
   at that leading, so a multi-clause prompt is readable without scrolling. */
.icn__gpv-rich { box-sizing:border-box; width:100%; height:104px; padding:8px; overflow:auto;
  border-radius:var(--icnw-r, 6px); outline:none;
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);
  font-family:inherit; font-size:12px; line-height:1.55; text-align:left; cursor:text;
  white-space:pre-wrap; word-break:break-word; }
.icn__gpv-rich:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gpv-rich:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__gpv-rich:empty::before { content:attr(data-placeholder); color:var(--ic-soft, #8a8a8a);
  pointer-events:none; }
/* Reference chip: thumbnail + highlighted "@图片1" as ONE unit — the caret
   cannot enter it (contenteditable=false) and one backspace removes it.
   display:inline (NOT inline-flex) on purpose: Chrome treats a flex container
   as a block when serialising the selection, which would inject line breaks
   into a copied prompt. Inline keeps it inside the running text. */
.icn__gpv-ref { display:inline; padding:0 2px; border-radius:3px;
  vertical-align:baseline; user-select:text; cursor:default; }
.icn__gpv-ref:hover { background:rgba(200,241,105,.12); }
.icn__gpv-ref-img { display:inline-block; width:14px; height:14px; margin-right:3px;
  border-radius:3px; object-fit:cover; vertical-align:-3px;
  user-select:none; pointer-events:none; }
.icn__gpv-ref-t { color:var(--icnw-ref, #c8f169); font-weight:500; }
/* Hover card for a chip. It reuses .icn__gpv-preview wholesale (surface,
   radius, media sizing, name strip); only the anchoring is overridden — a chip
   sits in a scrolling text run, so the card is fixed, horizontally centred on
   the chip and lifted 8px above it (clamped into the viewport by the caller). */
.icn__gpv-refprev { position:fixed; left:0; top:0; right:auto; bottom:auto; z-index:3000;
  /* the card lives in the canvas root, where --ic-line is a 42% tint; pin it to
     the node-local value so it matches the slot thumbnail card exactly. */
  --ic-line:#494a50;
  transform:translate(-50%, calc(-100% - 8px)); pointer-events:none; }
.icn__gpv-refprev .icn__gpv-preview-media { max-height:min(360px, 62vh); }
/* Placeholder frame when the media itself is unreachable (e.g. the chip was
   restored from saved text but its asset node is gone). */
.icn__gpv-refprev-ph { display:flex; align-items:center; justify-content:center;
  height:64px; border-radius:calc(var(--ic-radius, 10px) - 1px) calc(var(--ic-radius, 10px) - 1px) 0 0;
  background:#000; color:var(--ic-soft, #8a8a8a); font-size:11px; }
/* Bottom bar: workflow select + param select + round send button */
.icn__gpv-bar { display:flex; align-items:center; gap:6px; min-width:0; }
.icn__gpv-send { margin-left:auto; flex:0 0 auto; height:var(--ic-ctrl-h, 30px); padding:0 12px;
  display:inline-flex; align-items:center; justify-content:center; border:0;
  border-radius:8px; background:var(--ic-brand, #0b8ce9); color:#fff;
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; white-space:nowrap; cursor:pointer; }
.icn__gpv-send:hover { background:rgba(11,140,233,.9); }
.icn__gpv-send:disabled { opacity:.5; cursor:default; }

/* ---- AUDIO generator panel -------------------------------------------
   Same Nodes 2.0 surfaces as the video panel (mode row / input surface /
   30px bottom bar). The two prompt areas are labelled boxes so the meaning of
   each one is explicit (提示词/歌词 vs 语气/朗读文本); the workflow's exposed
   API parameters live behind the gear button on the left of the API picker. */
.icn__genpanel.icn__gpa { width:max(100%, 520px); padding:10px; }
.icn__gpa-inputs { display:flex; flex-direction:column; gap:8px; margin-bottom:9px; }
.icn__gpa-box { display:flex; flex-direction:column; gap:4px; min-width:0; }
.icn__gpa-label { font-size:10px; line-height:1.4; color:var(--ic-soft, #8a8a8a); }
/* Wired text node marker: the text is a PROMPT, it feeds this first area at
   run time (never the lyrics / reading-text area below). */
.icn__gpa-wired { color:var(--ic-brand, #0b8ce9); white-space:nowrap; }
.icn__gpa-area { box-sizing:border-box; width:100%; padding:8px; resize:none; border:0; outline:none;
  border-radius:var(--icnw-r, 6px); background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);
  font-family:inherit; font-size:12px; line-height:1.55; text-align:left; cursor:text; }
.icn__gpa-area:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gpa-area:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__gpa-area::placeholder { color:var(--ic-soft, #8a8a8a); }
.icn__gpa-area--a { height:76px; }
.icn__gpa-area--b { height:104px; }
.icn__gpa-bar { display:flex; align-items:center; gap:6px; min-width:0; }
/* Both pickers keep their intrinsic width; only the run button eats the slack,
   so a long workflow name can never be squeezed to "音频面…". */
.icn__gpa-bar > .icn__selwrap, .icn__gpa-setwrap { flex:0 0 auto; }
.icn__gpa-send { margin-left:auto; }
/* The video/image bars share the audio settings gear + API picker. Keep both
   at intrinsic width and cap the picker so a long workflow name truncates
   rather than squeezing the run button off the row. */
.icn__gpv-bar > .icn__selwrap, .icn__gp-bar > .icn__selwrap { flex:0 0 auto; }
.icn__gpv-bar > .icn__selwrap > .icn__sel, .icn__gp-bar > .icn__selwrap > .icn__sel { max-width:220px; }
/* The API picker may carry a full workflow filename (文生音乐：MiniMax Music 3),
   so it gets a wider cap than the shared 172px — still truncated. */
.icn__gpa-bar > .icn__selwrap > .icn__sel { max-width:220px; }

/* ---- API params popover ----------------------------------------------
   Every row used to be hand-drawn in pixels, which is what made the card look
   stitched together: a 164px numeric pill sat next to a 152px select next to a
   40px switch, at two different heights, so no two right edges lined up.
   The rows are now ComfyUI's Nodes 2.0 widget grid -- the markup copies
   WidgetGrid.vue / WidgetLayoutField.vue / ScrubableNumberInput.vue /
   WidgetSelectDefault.vue / WidgetToggleSwitch.vue class for class, and the
   host's own Tailwind build supplies the measurements (24px controls, 4px row
   gap, 12px port gutter, minmax(80px,min-content) label, minmax(125px,1fr)
   control). Only the card chrome and the popover anchoring live here. */
.icn__gpa-setwrap { position:relative; display:inline-flex; }
.icn__gpa-set { position:relative; display:inline-flex; align-items:center; justify-content:center;
  width:var(--ic-ctrl-h, 30px); height:var(--ic-ctrl-h, 30px); padding:0; border:0; border-radius:8px;
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); cursor:pointer;
  transition:background-color .15s ease, color .15s ease; }
.icn__gpa-set:hover, .icn__gpa-set.is-open {
  background:var(--icnw-hover, #3c3d42); color:var(--ic-text, #ffffff); }
.icn__gpa-set:disabled, .icn__gpa-set.is-disabled { opacity:.45; cursor:not-allowed; }
.icn__gpa-set:disabled:hover, .icn__gpa-set.is-disabled:hover {
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); }
/* Dot = "this API has parameters behind the gear" (they are no longer inline). */
.icn__gpa-setdot { position:absolute; top:5px; right:5px; width:5px; height:5px;
  border-radius:50%; background:var(--ic-brand, #0b8ce9); }
/* The left offset here is only the fallback: placePop() measures the gear and
   pins the card inside the panel (it hangs off the gear, sliding left when the
   card would run past the panel's right edge). */
/* Nodes 2.0 node body is --card (#262729), NOT --background (#171718). The
   footer band uses the host's bg-node-header (#202121), which is DARKER than
   the body -- on a #171718 card the same band reads as a bright stripe, i.e.
   the opposite of the real node. */
/* Nodes 2.0 node shell, layer for layer (measured on the real ResolutionSelector:
   270x192 node, inner wrapper #202121 / radius 12, body #262729 / pt-1 pb-3 /
   rounded-b-xl, footer band #202121 full width). The card therefore has NO padding
   of its own: the 12px left gutter is the grid's slot column and the 12px right
   gutter is the grid's own pr-3 -- the same two numbers the host uses. */
.icn__gpa-pop { position:absolute; left:0; bottom:calc(100% + 8px); z-index:62;
  box-sizing:border-box; width:348px; padding:0;
  /* A workflow can expose 20+ parameters; without a cap the popover runs off the
     top of the viewport. 12 rows still fit, so nothing scrolls in practice. */
  max-height:min(70vh, 460px); overflow-y:auto; overscroll-behavior:contain;
  /* The card is a left-aligned sheet; the canvas centres its empty states, and
     that centring would otherwise leak into the widget values. */
  text-align:left;
  border-radius:12px; background:var(--ic-head-bg, #202121); border:0;
  box-shadow:0 10px 30px rgba(0,0,0,.55); }
/* NodeHeader.vue is p-1 around a 20px control row -> a 28px band. */
.icn__gpa-pophead { display:flex; align-items:center; gap:6px; box-sizing:border-box;
  height:28px; padding:0 12px; }
.icn__gpa-popt { font-size:12px; line-height:1.35; color:#a0a0a0; }
/* The host tucks the band under the body with wrapper -z-1. Our card sits in a
   scroll container, where a negative-z child is not reliably painted first -- so
   the body states the same order positively: it covers the band's top 20px, the
   band only shows the 24px under it (exactly like LGraphNode + NodeFooter). */
.icn__gpa-body { position:relative; z-index:1; }
.icn__gpa-popcnt { padding:0 5px; border-radius:999px; background:var(--icnw-bg, #313235);
  color:var(--ic-text, #ffffff); font-size:10px; line-height:14px; }
.icn__gpa-popempty { padding:4px 12px 12px; font-size:12px; line-height:1.5;
  color:#a0a0a0; }
/* The exposed-parameter listbox: same card skin as the settings popover. */
.icn__gpa-fsel { position:absolute; z-index:66; box-sizing:border-box;
  display:flex; flex-direction:column; overflow:hidden; text-align:left;
  border-radius:8px; background:var(--card, #262729); border:1px solid var(--ic-line, #494a50);
  box-shadow:0 10px 30px rgba(0,0,0,.55); }
/* ValueControlPopover is w-113 (452px) upstream, but next to a 348px settings
   card that reads as a blown-up dialog for four rows. The chooser is the card's
   own size, so it looks like the card grew a section rather than a second window. */
.icn__gpa-modes { position:absolute; z-index:66; box-sizing:border-box;
  width:348px; overflow:hidden; text-align:left; border-radius:10px; background:var(--card, #262729);
  border:1px solid var(--ic-line, #494a50); box-shadow:0 10px 30px rgba(0,0,0,.55); }

/* Four corner resize grips — verbatim port of ComfyUI's vueNodes renderer
   (LGraphNode.vue + resize/resizeHandleConfig.ts). The glyph is the upstream
   SVG path "M11 1L1 11M11 6L6 11" in a 12x12 viewBox: one long + one short
   parallel diagonal. Container is h-5 w-5 (20px), SVG is size-2/5 (8px),
   stroke uses the host token var(--color-muted-foreground), width 2, round
   caps/joins. The four corners FLIP the SVG via scale (not rotate the box),
   exactly like upstream. Grips stay hidden until the node is hovered. */
.icn__rz { position:absolute; width:20px; height:20px; z-index:21;
  opacity:0; transition:opacity .12s ease; }
.icn:hover .icn__rz, .icn__rz.is-active { opacity:1; }
.icn__rz svg { position:absolute; width:40%; height:40%; }
.icn__rz svg path { fill:none; stroke:var(--color-muted-foreground, rgba(255,255,255,.62));
  stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
.icn__rz:hover svg path, .icn__rz.is-active svg path { stroke:${ACCENT}; }
/* Corners are offset -1 (-4px) so the glyph straddles the node edge, exactly
   as ComfyUI's -right-1/-bottom-1 etc. positionClasses do. */
.icn__rz--se { right:-4px; bottom:-4px; cursor:se-resize; }
.icn__rz--se svg { top:4px; left:4px; }
.icn__rz--ne { right:-4px; top:-4px; cursor:ne-resize; }
.icn__rz--ne svg { bottom:4px; left:4px; transform:scaleY(-1); }
.icn__rz--sw { left:-4px; bottom:-4px; cursor:sw-resize; }
.icn__rz--sw svg { top:4px; right:4px; transform:scaleX(-1); }
.icn__rz--nw { left:-4px; top:-4px; cursor:nw-resize; }
.icn__rz--nw svg { bottom:4px; right:4px; transform:scale(-1,-1); }

.ic-minimap-wrap { position:absolute; right:8px; bottom:54px; z-index:1000; display:flex; flex-direction:row; }
.ic-minimap { position:relative; width:253px; height:200px; border:1px solid var(--border,#333);
  border-radius:8px; background:var(--background,#1a1a1a); box-shadow:0 4px 12px rgba(0,0,0,.35); overflow:hidden; }
.ic-minimap .vue-flow__minimap { background:transparent!important; width:100%; height:100%; }
.ic-minimap .vue-flow__minimap svg { display:block; }
.ic-minimap__close { position:absolute; top:0; right:0; z-index:10; width:32px; height:32px; display:flex;
  align-items:center; justify-content:center; border:0; background:transparent; color:var(--muted-foreground,#999); cursor:pointer; border-radius:6px; }
.ic-minimap__close:hover { background:rgba(255,255,255,.08); color:#fff; }
`;

  function injectStyles() {
    if (document.getElementById("infcanvas-vueflow-style")) return;
    const style = document.createElement("style");
    style.id = "infcanvas-vueflow-style";
    style.textContent = VUEFLOW_CSS + "\n" + CSS;
    document.head.appendChild(style);
  }

  /* A text wire is only a prompt. If the chosen workflow exposes no text
     field and carries no {{prompt}} / {{text}} placeholder, the node hides
     its prompt area — accepting the wire here would silently drop it. Read
     the node's own snapshot so this gate follows the same frozen/new rule
     as the panel; an old node with no snapshot keeps the old behaviour. */
  const PROMPT_KEY_RE = /^(prompt|positive|positive_prompt|prompt_text|caption)$/i;
  function workflowAcceptsText(data) {
    if (!data) return true;
    const snap = data.fieldSnapshot;
    const list = Array.isArray(snap?.list) ? snap.list : null;
    if ((snap ? Boolean(snap.promptSlot) : Boolean(data.promptSlot)) || data.promptMap) return true;
    if (isAudioGenData(data)) {
      if (data.audioMap?.a || data.audioMap?.b) return true;
      return list ? list.some((f) => f?.type === "text" || f?.type === "textarea") : true;
    }
    if (!isImageGenData(data) && !isVideoGenData(data) && !isTextGenData(data)) return true;
    if (!list) return true;
    return list.some((f) => {
      if (f?.type !== "text" && f?.type !== "textarea") return false;
      const label = String(f.label || "").trim();
      if (/^(提示词|prompt)$/i.test(label)) return true;
      return !/negative|负面/i.test(label) && PROMPT_KEY_RE.test(String(f.key || ""));
    });
  }

  /* -------------------------------- root app ------------------------------ */

  const Root = {
    components: { VueFlow: VueFlowComponent, MiniMap, Background, IcConnectionLine },
    setup() {
      const showMinimap = ref(state.minimap.value);
      const zoomFar = ref(state.viewport.value.zoom < 0.6);   // <60% hides link dots
      const cutMode = ref(false);                             // Alt knife armed
      const mode = state.mode;
      const snap = state.snap;
      const groups = state.groups;
      const groupEditing = state.groupEditing;
      const selectedGroupId = state.selectedGroupId;
      /* Interaction map is ComfyUI's default, Comfy.Canvas.NavigationMode =
         "legacy" / Drag Navigation (coreSettings.ts):
           - left drag on the pane pans, exactly like the reference canvas
           - a marquee needs Ctrl/Cmd held; LGraphCanvas.ts:2826 only starts
             _setupNodeSelectionDrag when ctrlOrMeta is pressed
           - clicking with Shift/Ctrl/Meta toggles a node in the selection
           - marquee picks any node it overlaps (partial), see _getItemsInRect
             which uses overlapBounding rather than containment
         Do not turn this into "left drag selects" -- that is the "standard"
         navigation mode, which is not what ComfyUI ships. */

      /* Verbatim port of LGraphCanvas.drawBackCanvas's background pass.
         ComfyUI's canvas does NOT stretch a CSS background: it fills a
         CanvasPattern in world coordinates with imageSmoothingEnabled off,
         which is why native zooming never blurs. See LGraphCanvas.ts:5732. */
      const gridCanvas = ref(null);
      let gridImage = null, gridPattern = null, gridPatternCtx = null, gridRO = null;

      const drawGrid = (viewport) => {
        const canvas = gridCanvas.value;
        if (!canvas) return;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
        if (canvas.width !== pw || canvas.height !== ph) {
          canvas.width = pw; canvas.height = ph;
          gridPattern = null;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, pw, ph);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = GRID_CLEAR;
        ctx.fillRect(0, 0, w, h);

        const zoom = viewport?.zoom || 1;
        if (!gridImage || zoom <= 0.5) return;
        if (!gridPattern || gridPatternCtx !== ctx) {
          gridPattern = ctx.createPattern(gridImage, "repeat");
          gridPatternCtx = ctx;
        }
        if (!gridPattern) return;
        const x = viewport?.x || 0, y = viewport?.y || 0;
        ctx.save();
        /* LGraphCanvas.ts:5715 ds.toCanvasContext() = scale(scale) +
           translate(offset). VueFlow's screen = world * zoom + [x, y], so
           offset = [x, y] / zoom and visible_area is [-x/zoom, -y/zoom,
           w/zoom, h/zoom] (DragAndScale.ts:101-123). */
        ctx.imageSmoothingEnabled = false;
        /* zoom_modify_alpha is true by default (LGraphCanvas.ts:1327), so at
           100% the grid is only 50% opaque and firms up as you zoom in. */
        ctx.globalAlpha = 1 - 0.5 / zoom;
        ctx.scale(zoom, zoom);
        ctx.translate(x / zoom, y / zoom);
        ctx.fillStyle = gridPattern;
        ctx.fillRect(-x / zoom, -y / zoom, w / zoom, h / zoom);
        ctx.restore();
      };

      const gridTile = new Image();
      gridTile.onload = () => { gridImage = gridTile; drawGrid(state.viewport.value); };
      gridTile.src = GRID_TILE;

      const onGridResize = () => drawGrid(state.viewport.value);
      onMounted(() => {
        drawGrid(state.viewport.value);
        if (window.ResizeObserver && gridCanvas.value) {
          gridRO = new ResizeObserver(onGridResize);
          gridRO.observe(gridCanvas.value);
        }
        window.addEventListener("resize", onGridResize);
      });
      onBeforeUnmount(() => {
        gridRO?.disconnect(); gridRO = null;
        window.removeEventListener("resize", onGridResize);
      });

      const onInit = (instance) => {
        state.flow = instance;
        state.mounted = true;
        const vp = state.viewport.value;
        instance.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom }, { duration: 0 });
        drawGrid(vp);
        /* Selection is Vue Flow's own state (click, Ctrl+click, marquee,
           Ctrl+A, node deletion). Mirror it into state.selectedIds so every
           edge can tell whether one of its endpoints is selected — the same
           relationship ComfyUI's highlighted_links derives from the selection. */
        watch(() => (instance.getSelectedNodes?.value || []).map((node) => node.id),
          (ids) => { state.selectedIds.value = ids; }, { immediate: true, deep: true });
        NS.flow?.onReady?.();
      };

      const onViewportChange = (viewport) => {
        state.viewport.value = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
        drawGrid(viewport);
        /* Link centre markers disappear below 60% zoom, like ComfyUI. */
        zoomFar.value = (viewport.zoom || 1) < 0.6;
        NS.flow?.onViewport?.(viewport);
      };

      /* Audio generator gate, shared by the drag-time visual check and the
         authoritative onConnect check. Returns "" when the wire is allowed. */
      const audioWireReason = (targetId, sourceId) => {
        const nodes = state.nodes.value;
        const source = nodes.find((n) => n.id === sourceId);
        const srcKind = assetKindOf(source);
        if (srcKind === "text" && !workflowAcceptsText(nodes.find((n) => n.id === targetId)?.data)) {
          return t("当前工作流没有提示词输入，无法接入文本素材");
        }
        if (!acceptsKind("audio", srcKind)) {
          return t("音频生成节点只能接入音频或文本素材");
        }
        if (srcKind === "text") return "";
        const wired = state.edges.value.filter((e) => e.target === targetId
          && assetKindOf(nodes.find((n) => n.id === e.source)) === "audio");
        if (wired.some((e) => e.source === sourceId)) return "";
        if (wired.length >= 1) return t("音频只能接入 1 个，请先断开已连接的音频");
        return "";
      };
      /* Image generator gate: it has no video/audio input at all, only images
         and prompts. Checked at BOTH drag time and drop time so a generator
         output can never be wired into an incompatible generator. */
      const imageWireReason = (targetId, sourceId) => {
        const nodes = state.nodes.value;
        const srcKind = assetKindOf(nodes.find((n) => n.id === sourceId));
        if (srcKind === "text" && !workflowAcceptsText(nodes.find((n) => n.id === targetId)?.data)) {
          return t("当前工作流没有提示词输入，无法接入文本素材");
        }
        if (acceptsKind("image", srcKind)) return "";
        if (srcKind === "video") return "文生图节点不能接入视频素材";
        if (srcKind === "audio") return "文生图节点不能接入音频素材";
        return t("文生图节点只能接入图片或文本素材");
      };
      /* Text generator gate: one cap per source kind, taken from the LLM rule
         row (50 pictures / 100 videos / 100 audio clips). The old two-family
         exclusion is gone — the node hands pictures, video and audio to the
         SAME tokenize() call, so mixing them is legal; wiring a picture into a
         语音转录 node simply makes that mode unavailable and the mode migrates
         to LLM instead of the wire being dropped. A wired text node is the
         PROMPT and is always accepted. */
      const textWireReason = (targetId, sourceId) => {
        const nodes = state.nodes.value;
        const srcKind = assetKindOf(nodes.find((n) => n.id === sourceId));
        if (srcKind === "text") {
          return workflowAcceptsText(nodes.find((n) => n.id === targetId)?.data)
            ? "" : "当前工作流没有提示词输入，无法接入文本素材";
        }
        if (!acceptsKind("text", srcKind)) return t("文本生成节点只能接入图片、视频、音频或文本素材");
        const cap = TEXT_WIRE_CAPS[srcKind];
        if (!cap) return "";
        let have = 0;
        for (const edge of state.edges.value) {
          if (edge.target !== targetId || edge.source === sourceId) continue;
          if (assetKindOf(nodes.find((n) => n.id === edge.source)) === srcKind) have += 1;
        }
        if (have < cap) return "";
        const cn = KIND_CN[srcKind] || { label: "素材", measure: "个" };
        return t("「{mode}」最多接入 {max} {measure}{label}", { mode: t("智能对话"), max: cap, measure: cn.measure, label: cn.label });
      };
      /* One gate for every generator that restricts its input kinds. Video
         generators are not in here: they take all three kinds and let the
         active mode decide (modeReasonFor). */
      const genWireReason = (targetId, sourceId) => {
        const target = state.nodes.value.find((n) => n.id === targetId);
        if (isAudioGenData(target?.data)) return audioWireReason(targetId, sourceId);
        if (isImageGenData(target?.data)) return imageWireReason(targetId, sourceId);
        if (isTextGenData(target?.data)) return textWireReason(targetId, sourceId);
        return "";
      };
      /* Reject invalid drops at DRAG time so the handle turns invalid instead of
         silently swallowing the wire. onConnect re-checks — this prop is UX
         only (drops, restores and loaded canvases bypass it). */
      const isValidConnection = (conn) => {
        const targetId = conn?.target?.id ?? conn?.target;
        const sourceId = conn?.source?.id ?? conn?.source;
        /* Strict mode enforces output→input but DROPS Loose's self-link guard
           (`P!==o`), so a node could wire its own output back into its own
           input. Forbid same-node links in either drag direction. */
        if (sourceId != null && targetId != null && String(sourceId) === String(targetId)) return false;
        const target = state.nodes.value.find((n) => n.id === targetId);
        if (!isAudioGenData(target?.data) && !isImageGenData(target?.data)
          && !isTextGenData(target?.data)) return true;
        return !genWireReason(targetId, sourceId);
      };

      /* ---- wire released over empty canvas (LiteGraph's link-release menu) ----
         Dragging out of a handle and letting go over empty canvas opens a list
         of the node types that can legally take that wire; picking one creates
         the node where the pointer landed and connects the two.

         Three cases must NOT open it:
           1. the drag actually connected (connect fires before connectEnd);
           2. the pointer was released over a handle — the type gate refused it,
              and ComfyUI stays silent there;
           3. the pointer barely moved — that is a click on the handle, which
              Vue Flow turns into its own click-to-connect flow. */
      let connectOrigin = null;
      let connectSettled = false;
      const CLICK_SLOP = 6;

      const onConnectStart = (payload) => {
        connectSettled = false;
        const event = payload?.event;
        connectOrigin = payload?.nodeId
          ? {
            nodeId: payload.nodeId, handleId: payload.handleId, handleType: payload.handleType,
            x: event?.clientX ?? 0, y: event?.clientY ?? 0,
          }
          : null;
      };
      /* Candidate node types for this wire, computed from the SAME table the
         connect gate enforces — the menu can never offer an illegal wire.
         The text node sits on BOTH ends of that table: its output feeds every
         generator (text is the universal prompt), and its own input takes any
         node's output. */
      const connectCandidates = (origin) => {
        const from = state.nodes.value.find((n) => n.id === origin.nodeId);
        if (!from) return [];
        const specs = NS.SPECS || [];
        /* NOTE: no "exclude the origin's own type" rule. Same-type wiring is
           legitimate (a video generator feeding another video generator in
           参考生视频, an image generator feeding an image generator for img2img),
           and every entry here creates a NEW node, so it can never wire to
           itself. */
        if (origin.handleType === "source") {
          const kind = assetKindOf(from);
          if (!kind) return [];
          return specs.filter((spec) => (spec.role === "text"
            ? true
            : spec.role === "media" && acceptsKind(spec.kind, kind)));
        }
        /* Drag started on an INPUT handle: offer the types that can feed it.
           A text node accepts every kind, so its menu lists all of them. */
        if (from.data?.role === "text") return specs.slice();
        if (from.data?.role !== "media") return [];
        const accepts = GEN_ACCEPTS[from.data.kind] || [];
        return specs.filter((spec) => accepts.indexOf(spec.kind) >= 0);
      };

      /* Create the picked node at the drop point and land the wire on it, using
         the same handle ids a manual drag would produce ("out" -> "in"). */
      const createAndConnect = (spec, origin, point) => {
        const spot = NS.api?.freeSpot?.([point.x, point.y], spec.size, spec.role)
          || [point.x, point.y];
        const created = NS.api?.addNodeByType?.(spec.type, spot);
        if (!created) return;
        const fromSource = origin.handleType === "source";
        /* A text node exposes one target handle named "text", every media node
           names its own "in" — land the wire on whichever the created node
           actually renders, or the edge would point at a handle that is not
           there and Vue Flow would silently drop the line. */
        NS.flow?.addEdge?.({
          id: "e_" + Math.random().toString(36).slice(2, 10),
          source: fromSource ? origin.nodeId : created.id,
          sourceHandle: "out",
          target: fromSource ? created.id : origin.nodeId,
          targetHandle: fromSource
            ? (created.data?.role === "text" ? "text" : "in")
            : (origin.handleId || "in"),
          type: "ic",
        });
        NS.flow?.selectNodes?.([created.id]);
        /* A brand new generator sits on its pure-prompt mode, which takes no
           media — the wire we just landed would leave it on an unavailable
           mode. Same rule as onConnect: switch instead of dropping the wire. */
        if (fromSource) {
          const target = created;
          const srcKind = assetKindOf(state.nodes.value.find((n) => n.id === origin.nodeId));
          if (isVideoGenData(target.data)) {
            const counts = incomingKindCounts(target.id, state.edges.value, state.nodes.value);
            if (modeReasonFor(target.data.videoMode || "文生视频", counts)) {
              NS.flow?.updateNodeData?.(target.id, { videoMode: "参考生视频" });
            }
          } else if (isAudioGenData(target.data) && srcKind === "audio") {
            const audioMode = target.data.audioMode || AUDIO_MODES[0];
            if (!AUDIO_INPUT_RULES[audioMode]?.audio) {
              NS.flow?.updateNodeData?.(target.id, { audioMode: audioRefMode(audioMode) });
            }
          }
        }
        NS.api?.markDirty?.();
      };

      const onConnectEnd = (event) => {
        const origin = connectOrigin;
        const settled = connectSettled;
        connectOrigin = null;
        connectSettled = false;
        if (!origin || settled) return;
        if (!event || !Number.isFinite(event.clientX)) return;
        /* Released on a handle: the gate refused the wire. Stay silent only when
           there is no reason to give; the input rules are fine-grained enough
           now (2nd video, audio mixed with pictures, 2+ pictures in 图像放大)
           that a silent refusal reads as a broken drop. */
        const handleEl = event.target?.closest?.(".vue-flow__handle");
        if (handleEl) {
          if (origin.handleType === "source") {
            const targetId = handleEl.closest(".vue-flow__node")?.getAttribute("data-id");
            const reason = targetId ? genWireReason(targetId, origin.nodeId) : "";
            if (reason) NS.api?.toast?.("warning", "无法接入", reason);
          }
          return;
        }
        if (!event.target?.closest?.(".vue-flow")) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < CLICK_SLOP) return;
        if (mode.value !== "select") return;
        const specs = connectCandidates(origin);
        if (!specs.length) return;
        const point = state.flow?.screenToFlowCoordinate
          ? state.flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
          : { x: 0, y: 0 };
        NS.ui?.showConnectNodeMenu?.({
          clientX: event.clientX, clientY: event.clientY, world: [point.x, point.y],
          specs,
          onPick: (spec) => createAndConnect(spec, origin, point),
        });
      };

      const onConnect = (params) => {
        /* A real connection landed; connectEnd must not also open the menu. */
        connectSettled = true;
        /* Authoritative guard: isValidConnection is UX-only and is bypassed by
           programmatic addEdge / restored canvases. Never let a node feed itself. */
        if (params.source != null && params.target != null
          && String(params.source) === String(params.target)) return;
        /* Wires are ALWAYS accepted. The assets wired in decide which modes
           stay selectable (modeAvailable) — a mode choice never cuts a wire.
           But the SAME source→target pair is de-duplicated: dragging the same
           wire again is a no-op, so it always counts as one connection. */
        const key = String(params.source) + "→" + String(params.target);
        if (state.edges.value.some((e) => edgeKey(e) === key)) return;
        const nodes = state.nodes.value;
        const targetNode = nodes.find((n) => n.id === params.target);
        /* Generators with a fixed input vocabulary (image / audio) refuse the
           kinds they have no input for — never silently swallow the wire. */
        const denied = genWireReason(params.target, params.source);
        if (denied) {
          NS.api?.toast?.("warning", "无法接入", denied);
          return;
        }
        /* Audio generator: audio only lives in the two reference modes — switch
           there instead of dropping the wire the user just drew. */
        if (isAudioGenData(targetNode?.data)) {
          const srcKind = assetKindOf(nodes.find((n) => n.id === params.source));
          if (srcKind === "audio") {
            const mode = targetNode.data.audioMode || AUDIO_MODES[0];
            if (!AUDIO_INPUT_RULES[mode]?.audio) {
              const next = audioRefMode(mode);
              NS.flow?.updateNodeData?.(params.target, { audioMode: next });
              NS.api?.toast?.("info", t("已切换到") + next, t("「{mode}」不接入音频，连线已保留", { mode }));
            }
          }
        }
        state.edges.value = state.edges.value.concat([{
          id: "e_" + Math.random().toString(36).slice(2, 10),
          source: params.source, sourceHandle: params.sourceHandle || "out",
          target: params.target, targetHandle: params.targetHandle,
          type: "ic",
        }]);
        /* If this new wire makes the generator's ACTIVE mode invalid, fall back
           to a mode that fits instead of dropping the connection. */
        if (isVideoGenData(targetNode?.data)) {
          const mode = targetNode.data.videoMode || "文生视频";
          const counts = incomingKindCounts(params.target, state.edges.value, nodes);
          if (modeReasonFor(mode, counts)) {
            NS.flow?.updateNodeData?.(params.target, { videoMode: "参考生视频" });
            NS.api?.toast?.("info", t("已切换到{mode}", { mode: t("参考生视频") }), t("当前素材不符合「{mode}」，连线已保留", { mode }));
          }
        }
        /* Image generator: a picture just arrived. 图像编辑 is the widest
           picture-consuming mode, so that is where a pure-prompt (or now
           over-filled) mode steps aside to. */
        if (isImageGenData(targetNode?.data)) {
          const mode = targetNode.data.imageMode || IMAGE_MODES[0];
          const counts = incomingKindCounts(params.target, state.edges.value, nodes);
          if (modeReasonFor(mode, counts, IMAGE_INPUT_RULES)) {
            const next = modeReasonFor("图像编辑", counts, IMAGE_INPUT_RULES) ? "文生图" : "图像编辑";
            if (next !== mode) {
              NS.flow?.updateNodeData?.(params.target, { imageMode: next });
              NS.api?.toast?.("info", t("已切换到") + next, t("当前素材不符合「{mode}」，连线已保留", { mode }));
            }
          }
        }
        /* Text generator: the wired medium decides the mode. A lone audio clip
           -> 语音转录; any picture/video, or audio mixed with them -> LLM. */
        if (isTextGenData(targetNode?.data)) {
          const counts = incomingKindCounts(params.target, state.edges.value, nodes);
          const next = textAutoMode(counts);
          const mode = targetNode.data.textMode || TEXT_MODES[0];
          if (next !== mode && !modeReasonFor(next, counts, TEXT_INPUT_RULES)) {
            NS.flow?.updateNodeData?.(params.target, { textMode: next });
            NS.api?.toast?.("info", t("已切换到") + next, t("当前素材不符合「{mode}」，连线已保留", { mode }));
          }
        }
        NS.flow?.markDirty();
      };

      /* Wires decide modes, never the reverse — so cutting a wire must also
         release a mode that no longer fits, otherwise the tab stays selected
         and disabled and the node is stuck in a mode its inputs cannot serve.
         Runs AFTER onConnect (flush:"post") so a freshly added wire has already
         been reconciled by the block above; only misfits are touched. */
      const reconcileModes = () => {
        const nodes = state.nodes.value;
        const edges = state.edges.value;
        for (const node of nodes) {
          const data = node.data;
          if (!data) continue;
          const kind = data.role === "text" ? "text"
            : (data.role === "media" && !data.asset ? data.kind : "");
          if (kind !== "image" && kind !== "audio" && kind !== "text") continue;
          const table = kind === "image" ? IMAGE_INPUT_RULES
            : kind === "audio" ? AUDIO_INPUT_RULES : TEXT_INPUT_RULES;
          const modes = kind === "image" ? IMAGE_MODES
            : kind === "audio" ? AUDIO_MODES : TEXT_MODES;
          const field = kind === "image" ? "imageMode"
            : kind === "audio" ? "audioMode" : "textMode";
          const current = data[field] || modes[0];
          const counts = incomingKindCounts(node.id, edges, nodes);
          if (!modeReasonFor(current, counts, table)) continue;
          /* Audio stays inside its family (音乐翻唱 -> 文生音乐, 语音克隆 ->
             语音合成) instead of jumping to the first legal tab; the others
             take the first mode that fits. */
          const next = kind === "audio"
            ? (counts.audio ? audioRefMode(current)
              : (isMusicMode(current) ? "文生音乐" : "语音合成"))
            : modes.find((mode) => !modeReasonFor(mode, counts, table));
          if (!next || next === current) continue;
          if (modeReasonFor(next, counts, table)) continue;
          /* Write BOTH copies (Vue Flow's store and the document array) without
             markDirty: this is a DERIVED correction, and doing it through
             updateNodeData on a freshly LOADED canvas would flag the document
             dirty and autosave it before the user touched anything. */
          data[field] = next;
          const live = state.flow?.findNode?.(node.id);
          if (live?.data && live.data !== data) live.data[field] = next;
        }
      };
      watch(() => state.edges.value.map((edge) => edge.id + ">" + edge.source).join("|"),
        reconcileModes, { flush: "post" });

      /* Vue Flow's own handleNodeClick runs *before* it emits node-click, so by
         the time we see the event the selection has already been toggled. Take
         a snapshot in the capture phase of pointerdown, which is strictly
         earlier than d3-drag's bubble-phase handlers. */
      let clickBaseline = null;
      const capturePointerDown = (event) => {
        const nodeEl = event.target?.closest?.(".vue-flow__node");
        if (!nodeEl || !event.target.closest?.("#infcanvas-vueflow")) {
          clickBaseline = null;
          return;
        }
        /* Resizing from a corner grip must not perturb the click selection
           baseline — a drag there is not a node click. */
        if (event.target.closest?.(".icn__rz, .nodrag")) {
          clickBaseline = null;
          return;
        }
        clickBaseline = {
          id: nodeEl.getAttribute("data-id"),
          selected: (NS.flow?.selectedNodes?.() || []).map((entry) => entry.id),
        };
      };
      onMounted(() => document.addEventListener("pointerdown", capturePointerDown, true));
      onBeforeUnmount(() => document.removeEventListener("pointerdown", capturePointerDown, true));

      let lastDragStopAt = -Infinity;
      const onNodeDragStop = () => {
        /* d3-drag emits a click after some drags; that click must not collapse
           a multi-selection that was just moved as a group. */
        lastDragStopAt = performance.now();
        syncLivePositions();
        NS.flow?.markDirty();
        /* Vue Flow owns the live position, so the deep watcher never saw this
           move — make it an undo step explicitly. */
        NS.flow?.history?.schedule?.();
      };

      /* LiteGraph's resolveClickSelection (selectionIntent.ts) is explicit:
           plain click on a node -> 'replace' (even if it is already selected)
           Shift / Ctrl / Meta + click -> 'add' when unselected, 'remove' when
           selected
         Vue Flow instead keeps the old selection and *adds* the clicked node;
         clicking an already selected node does nothing. Its built-in
         handleNodeClick runs just before this emit, so setting the final
         selection here overrides whatever it did. */
      const onNodeClick = ({ event, node }) => {
        if (!node || state.mode.value === "drag") return;
        const baseline = clickBaseline;
        clickBaseline = null;
        if (performance.now() - lastDragStopAt < 250) return;
        /* Fall back to the live selection only if the pointerdown was missed. */
        const current = baseline && baseline.id === node.id
          ? baseline.selected
          : (NS.flow?.selectedNodes?.().map((entry) => entry.id) || []);
        const toggling = event && (event.shiftKey || event.ctrlKey || event.metaKey);
        let next;
        if (toggling) {
          next = current.includes(node.id)
            ? current.filter((id) => id !== node.id)
            : current.concat(node.id);
        } else {
          next = [node.id];
        }
        if (next.length === current.length && next.every((id, i) => id === current[i])) return;
        NS.flow?.selectNodes?.(next);
      };
      const onSelectionChange = (payload) => {
        state.selectedIds.value = (payload?.nodes || []).map((node) => node.id);
        /* Nodes and groups are mutually exclusive selections, matching
           ComfyUI's shared selectedItems set. */
        if (state.selectedIds.value.length) state.selectedGroupId.value = null;
        NS.flow?.onSelection?.(payload?.nodes || []);
      };

      watch(() => state.minimap.value, (value) => { showMinimap.value = value; });

      /* ---- Alt + left drag slices links (ComfyUI-style canvas knife) --------
         Starting the drag ON the pane means we stopPropagation, so Vue Flow
         never begins a pan and the whole gesture belongs to the knife. Every
         wire the pointer crosses is marked red and removed on release — one
         history entry for the whole slice. */
      /* ---- Alt + left drag slices links (ComfyUI-style canvas knife) --------
         Ported from the reference front-end (infinite_canvas/App.vue), which is
         more complete than the earlier flow-space version: a wire is cut by
         DRAGGING ACROSS it, never by clicking a midpoint. Alt+left on empty
         canvas starts a knife stroke; every wire the red trail sweeps is marked
         and removed on release in one history entry.
         KEY DIFFERENCES from the old version (which silently failed to cut):
           * all hit-testing in SCREEN space (old mixed screenToFlowCoordinate
             flow coords with getPointAtLength path-local coords -> never matched)
           * getBBox broad-phase, sample lazily only for boxes the stroke crosses
           * pointerdown AND mousedown captured: Vue Flow pans via d3-zoom's
             mousedown, which pointerdown alone cannot stop
           * getCoalescedEvents + rAF batching, Escape cancels, Alt suppresses
             the context menu (mac). */
      let cutRect = { left: 0, top: 0 };
      let cutFrame = 0;
      let cutPending = [];
      let cutSamples = [];
      let markedGroups = new Set();
      let cutting = false;
      const CUT_THRESHOLD = 6;                        // screen px of slack
      const cutPoints = ref([]);
      const cutTrail = ref("");
      const trailPath = (points) => {
        if (!points.length) return "";
        if (points.length === 1) return `M${points[0].x},${points[0].y} L${points[0].x + 0.01},${points[0].y}`;
        let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
        for (let i = 1; i < points.length - 1; i += 1) {
          const midX = (points[i].x + points[i + 1].x) / 2;
          const midY = (points[i].y + points[i + 1].y) / 2;
          d += ` Q${points[i].x.toFixed(1)},${points[i].y.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)}`;
        }
        const last = points[points.length - 1];
        return `${d} L${last.x.toFixed(1)},${last.y.toFixed(1)}`;
      };
      const onAltState = (event) => {
        if (event.key !== "Alt" && event.key !== "AltGraph") return;
        const down = event.type === "keydown"
          && state.mode.value === "select" && !NS.tools?.isOpen?.();
        cutMode.value = down;
        if (!down && cutting) resetCut();
      };
      /* Nodes / panels / form controls never start a knife stroke. */
      const isCutBlocked = (target) => {
        if (!(target instanceof Element)) return true;
        return !!target.closest(
          ".vue-flow__node, .vue-flow__handle, .ic-panel, .ic-minimap, button, input, textarea, select, [contenteditable]"
        );
      };
      /* Broad phase: one getBBox per wire at pointerdown, converted to screen
         space. Sampling getPointAtLength for every edge on every move was O(n²)
         and stalled with many wires; now only boxes the stroke touches are
         sampled, and the result is cached for the stroke. */
      const buildCutSamples = () => {
        const entries = [];
        const host = hostEl();
        if (!host) return entries;
        const vp = state.viewport.value || {};
        const zoom = vp.zoom || 1, offsetX = vp.x || 0, offsetY = vp.y || 0;
        for (const path of host.querySelectorAll(".vue-flow__edge-path")) {
          const group = path.closest(".vue-flow__edge");
          if (!group || !path.getBBox) continue;
          let box;
          try { box = path.getBBox(); } catch (error) { continue; }
          if (!box.width && !box.height) continue;
          entries.push({
            group, path,
            minX: box.x * zoom + offsetX, minY: box.y * zoom + offsetY,
            maxX: (box.x + box.width) * zoom + offsetX,
            maxY: (box.y + box.height) * zoom + offsetY,
            points: null,
          });
        }
        return entries;
      };
      const sampleEntry = (entry) => {
        if (entry.points) return entry.points;
        const vp = state.viewport.value || {};
        const zoom = vp.zoom || 1, offsetX = vp.x || 0, offsetY = vp.y || 0;
        const step = Math.max(5 / zoom, 2);
        const total = entry.path.getTotalLength ? entry.path.getTotalLength() : 0;
        const points = [];
        for (let length = 0; length < total; length += step) {
          const point = entry.path.getPointAtLength(length);
          points.push({ x: point.x * zoom + offsetX, y: point.y * zoom + offsetY });
        }
        if (total) {
          const point = entry.path.getPointAtLength(total);
          points.push({ x: point.x * zoom + offsetX, y: point.y * zoom + offsetY });
        }
        entry.points = points;
        return points;
      };
      const distanceToSegment = (point, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
        if (!lengthSq) return Math.hypot(point.x - a.x, point.y - a.y);
        let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
        t = Math.min(1, Math.max(0, t));
        return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
      };
      /* A fresh slice segment vs every unmarked wire: box cull first, sample
         only on overlap, mark red once (stays marked for the whole stroke). */
      const testCutSegment = (a, b) => {
        const minX = Math.min(a.x, b.x) - CUT_THRESHOLD;
        const minY = Math.min(a.y, b.y) - CUT_THRESHOLD;
        const maxX = Math.max(a.x, b.x) + CUT_THRESHOLD;
        const maxY = Math.max(a.y, b.y) + CUT_THRESHOLD;
        for (const entry of cutSamples) {
          if (markedGroups.has(entry.group)) continue;
          if (entry.maxX < minX || entry.minX > maxX ||
              entry.maxY < minY || entry.minY > maxY) continue;
          for (const point of sampleEntry(entry)) {
            if (distanceToSegment(point, a, b) <= CUT_THRESHOLD) {
              entry.group.classList.add("is-cut");
              markedGroups.add(entry.group);
              break;
            }
          }
        }
      };
      const hostEl = () => document.querySelector("#infcanvas-vueflow");
      const onCutPointerDown = (event) => {
        if (event.button !== 0 || !event.altKey) return;
        if (state.mode.value === "drag" || NS.tools?.isOpen?.()) return;
        if (isCutBlocked(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const host = hostEl();
        if (!host) return;
        cutRect = host.getBoundingClientRect();
        cutPoints.value = [{ x: event.clientX - cutRect.left, y: event.clientY - cutRect.top }];
        cutTrail.value = trailPath(cutPoints.value);
        cutting = true;
        cutMode.value = true;
        cutPending = [];
        cutSamples = buildCutSamples();
        markedGroups = new Set();
        document.body.style.cursor = "crosshair";
        window.addEventListener("pointermove", onCutPointerMove, true);
        window.addEventListener("pointerup", onCutPointerUp, true);
        window.addEventListener("pointercancel", resetCut, true);
        window.addEventListener("keydown", onCutKeyDown, true);
        window.addEventListener("blur", resetCut);
      };
      const onCutPointerMove = (event) => {
        if (!cutting) return;
        const batch = event.getCoalescedEvents?.() || [];
        for (const item of (batch.length ? batch : [event])) {
          const x = item.clientX - cutRect.left;
          const y = item.clientY - cutRect.top;
          const last = cutPending[cutPending.length - 1] || cutPoints.value[cutPoints.value.length - 1];
          if (!last) continue;
          if (Math.abs(x - last.x) < 1.5 && Math.abs(y - last.y) < 1.5) continue;
          cutPending.push({ x, y });
        }
        if (!cutPending.length) return;
        if (!cutFrame) cutFrame = requestAnimationFrame(flushCut);
      };
      const flushCut = () => {
        cutFrame = 0;
        if (!cutPending.length) return;
        const pending = cutPending;
        cutPending = [];
        let from = cutPoints.value[cutPoints.value.length - 1];
        cutPoints.value = cutPoints.value.concat(pending);
        cutTrail.value = trailPath(cutPoints.value);
        for (const point of pending) {
          if (from) testCutSegment(from, point);
          from = point;
        }
      };
      function stopCutListeners() {
        window.removeEventListener("pointermove", onCutPointerMove, true);
        window.removeEventListener("pointerup", onCutPointerUp, true);
        window.removeEventListener("pointercancel", resetCut, true);
        window.removeEventListener("keydown", onCutKeyDown, true);
        window.removeEventListener("blur", resetCut);
        if (cutFrame) { cancelAnimationFrame(cutFrame); cutFrame = 0; }
      }
      function resetCut() {
        if (!cutting) return;
        stopCutListeners();
        for (const group of markedGroups) group.classList.remove("is-cut");
        markedGroups = new Set();
        cutSamples = [];
        cutPending = [];
        cutting = false;
        cutMode.value = false;
        cutPoints.value = [];
        cutTrail.value = "";
        document.body.style.cursor = "";
      }
      const onCutPointerUp = (event) => {
        if (cutPending.length) flushCut();
        stopCutListeners();
        if (event.button === 0) {
          const ids = [...markedGroups]
            .map((group) => group.getAttribute("data-id"))
            .filter(Boolean);
          if (ids.length) NS.flow?.removeEdges?.(ids);
        }
        resetCut();
      };
      const onCutKeyDown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        resetCut();
      };
      /* Vue Flow's pane pans on d3-zoom's mousedown, which pointerdown cannot
         stop — capture mousedown too so the stroke never drags the canvas. */
      const onCutMouseDown = (event) => {
        if (event.button !== 0 || !event.altKey) return;
        if (isCutBlocked(event.target)) return;
        event.preventDefault();
        event.stopPropagation();
      };
      /* macOS turns Ctrl/Alt+left into a context menu; suppress it mid-slice. */
      const onCutContextMenu = (event) => { if (event.altKey) event.preventDefault(); };
      const onAltBlur = () => { cutMode.value = false; };
      onMounted(() => {
        const host = hostEl();
        host?.addEventListener("pointerdown", onCutPointerDown, true);
        host?.addEventListener("mousedown", onCutMouseDown, true);
        host?.addEventListener("contextmenu", onCutContextMenu, true);
        document.addEventListener("keydown", onAltState, true);
        document.addEventListener("keyup", onAltState, true);
        window.addEventListener("blur", onAltBlur);
      });
      onBeforeUnmount(() => {
        resetCut();
        const host = hostEl();
        host?.removeEventListener("pointerdown", onCutPointerDown, true);
        host?.removeEventListener("mousedown", onCutMouseDown, true);
        host?.removeEventListener("contextmenu", onCutContextMenu, true);
        document.removeEventListener("keydown", onAltState, true);
        document.removeEventListener("keyup", onAltState, true);
        window.removeEventListener("blur", onAltBlur);
      });
      /* Undo/redo snapshots are taken by a debounced watcher: any change to the
         node/edge arrays (add, delete, field edit, resize) schedules a commit;
         a drag end has to say so explicitly because Vue Flow keeps the live
         position in its own store. */
      watch([state.nodes, state.edges], () => { NS.flow?.history?.schedule?.(); }, { deep: true });
      /* A bulk selection is for moving/deleting nodes, not for editing one.
         Hide every node's top action row and bottom parameter panel while
         more than one node is selected so they don't cover the neighbours. */
      const multiSelect = computed(() => state.selectedIds.value.length > 1);

      /* ComfyUI's Comfy.SelectionBorder extension draws a dashed round-rect
         around every selected item once there are 2+. Mirror it in screen
         space: padding is 10 world px (so it scales with zoom), while the
         2px stroke / 5px dashes / 8px radius stay pixel-constant like the
         host's 2/scale, 5/scale, 8/scale canvas values. */
      const selectionRect = ref(null);
      let selectionRaf = 0;
      const measureSelectionRect = () => {
        if (!multiSelect.value) { selectionRect.value = null; return; }
        const host = document.querySelector("#infcanvas-vueflow");
        if (!host) return;
        const hostBox = host.getBoundingClientRect();
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const id of state.selectedIds.value) {
          const el = host.querySelector('.vue-flow__node[data-id="' + id + '"]');
          if (!el) continue;
          const box = el.getBoundingClientRect();
          minX = Math.min(minX, box.left - hostBox.left);
          minY = Math.min(minY, box.top - hostBox.top);
          maxX = Math.max(maxX, box.right - hostBox.left);
          maxY = Math.max(maxY, box.bottom - hostBox.top);
        }
        if (!Number.isFinite(minX)) { selectionRect.value = null; return; }
        const pad = 10 * (state.viewport.value.zoom || 1);
        const next = {
          x: minX - pad, y: minY - pad,
          w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad,
        };
        const prev = selectionRect.value;
        if (!prev || Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5
          || Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5) {
          selectionRect.value = next;
        }
      };
      const selectionTick = () => { measureSelectionRect(); selectionRaf = requestAnimationFrame(selectionTick); };
      watch(multiSelect, (on) => {
        cancelAnimationFrame(selectionRaf);
        if (on) { measureSelectionRect(); selectionRaf = requestAnimationFrame(selectionTick); }
        else selectionRect.value = null;
      });
      onBeforeUnmount(() => { cancelAnimationFrame(selectionRaf); });

      /* ---- multi-selection toolbox actions ------------------------------ */
      /* Boxes are in graph units. Vue Flow keeps the authoritative position
         and measured size in its live node; fall back to the DOM (or the
         node's declared size) when a freshly added node has not measured yet. */
      const selectedBoxes = () => {
        syncLivePositions();
        const zoom = state.viewport.value.zoom || 1;
        return state.selectedIds.value.map((id) => {
          const src = state.nodes.value.find((node) => node.id === id);
          if (!src) return null;
          const live = state.flow?.findNode?.(id);
          let w = live?.dimensions?.width;
          let h = live?.dimensions?.height;
          if (!Number.isFinite(w) || !Number.isFinite(h)) {
            const el = document.querySelector('.vue-flow__node[data-id="' + id + '"]');
            if (el) {
              const rect = el.getBoundingClientRect();
              w = rect.width / zoom;
              h = rect.height / zoom;
            }
          }
          if (!Number.isFinite(w)) w = 480;
          if (!Number.isFinite(h)) h = 270;
          return { id, x: src.position.x, y: src.position.y, w, h };
        }).filter(Boolean);
      };

      /* ComfyUI's Add Group For Selected Nodes: createBounds(selected, 10),
         then lift the top by NODE_TITLE_HEIGHT (30) for the title strip.
         The group itself is visual only — it never rewires or reflows nodes. */
      const createGroup = () => {
        const boxes = selectedBoxes();
        if (boxes.length < 2) return;
        const pad = 10, titleHeight = 30;
        const minX = Math.min(...boxes.map((box) => box.x));
        const minY = Math.min(...boxes.map((box) => box.y));
        const maxX = Math.max(...boxes.map((box) => box.x + box.w));
        const maxY = Math.max(...boxes.map((box) => box.y + box.h));
        state.groups.value = state.groups.value.concat([{
          id: "grp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: t("分组"),
          x: minX - pad,
          y: minY - pad - titleHeight,
          w: maxX - minX + 2 * pad,
          h: maxY - minY + 2 * pad + titleHeight,
          nodes: boxes.map((box) => box.id),
        }]);
        NS.api?.markDirty?.();
        NS.flow?.history?.schedule?.();
        NS.api?.toast?.("success", t("已创建分组"),
          t("已把选中的 {count} 个节点放入分组", { count: boxes.length }));
      };

      /* ComfyUI's processSelect(group): clicking the title strip selects the
         group rectangle itself. Children stay unselected by default —
         LiteGraph.Group.SelectChildrenOnClick defaults to false. */
      const selectGroup = (id) => {
        if (state.groupEditing.value) commitGroupRename();
        state.selectedGroupId.value = id;
        const api = state.flow;
        const current = api?.getSelectedNodes?.value || [];
        if (current.length) api?.removeSelectedNodes?.(current);
        state.selectedIds.value = [];
      };
      /* Drag the 30px title strip: LGraphGroup.move(dx, dy) shifts the group
         AND every child node by the same amount. Screen pixels are converted
         with the live zoom, exactly like node dragging. */
      const GROUP_CORNERS = ["nw", "ne", "sw", "se"];
      const startGroupDrag = (event, group) => {
        if (event.button !== 0 || state.groupEditing.value || !NS.api?.isActive?.()) return;
        event.stopPropagation();
        selectGroup(group.id);
        const zoom = state.viewport.value.zoom || 1;
        const startX = event.clientX, startY = event.clientY;
        const x0 = group.x, y0 = group.y;
        const members = (Array.isArray(group.nodes) ? group.nodes : []).map((id) => {
          const node = state.nodes.value.find((entry) => entry.id === id);
          return node ? { id, x: node.position.x, y: node.position.y } : null;
        }).filter(Boolean);
        let moved = false;
        /* Same 10px grid as node dragging. Snap the GROUP first, then move
           every child by the group's ACTUAL (snapped) delta — not the raw dx.
           Rounding only the group while children kept the fractional dx made
           them drift apart at non-integer zoom. */
        const snap10 = (v) => Math.round(v / 10) * 10;
        const move = (ev) => {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / zoom) return;
          moved = true;
          let nx = x0 + dx, ny = y0 + dy;
          if (state.snap.value) { nx = snap10(nx); ny = snap10(ny); }
          else { nx = Math.round(nx); ny = Math.round(ny); }
          const actualDx = nx - x0, actualDy = ny - y0;
          group.x = nx;
          group.y = ny;
          for (const member of members) {
            NS.flow?.setNodePosition?.(member.id, { x: member.x + actualDx, y: member.y + actualDy });
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
          if (moved) { NS.api?.markDirty?.(); NS.flow?.history?.schedule?.(); }
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
      };
      /* Four grips like node resize: the opposite edges stay pinned, and the
         child nodes are left alone (LGraphGroup.resize only changes its box). */
      const startGroupResize = (event, group, corner) => {
        if (event.button !== 0 || !NS.api?.isActive?.()) return;
        event.preventDefault();
        event.stopPropagation();
        selectGroup(group.id);
        const zoom = state.viewport.value.zoom || 1;
        const startX = event.clientX, startY = event.clientY;
        const x0 = group.x, y0 = group.y, w0 = group.w, h0 = group.h;
        const west = corner.indexOf("w") >= 0, north = corner.indexOf("n") >= 0;
        const MINW = 80, MINH = 60;
        const move = (ev) => {
          const dx = (ev.clientX - startX) / zoom;
          const dy = (ev.clientY - startY) / zoom;
          let x = x0 + (west ? dx : 0), y = y0 + (north ? dy : 0);
          let w = w0 + (west ? -dx : dx), h = h0 + (north ? -dy : dy);
          if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
          if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
          /* Same moving-edge snap as node resize, opposite edge pinned. */
          if (state.snap.value) {
            const snap10 = (v) => Math.round(v / 10) * 10;
            if (west) { x = snap10(x); w = (x0 + w0) - x; }
            else { w = snap10(x0 + w) - x0; }
            if (north) { y = snap10(y); h = (y0 + h0) - y; }
            else { h = snap10(y0 + h) - y0; }
            if (w < MINW) { w = MINW; if (west) x = x0 + w0 - MINW; }
            if (h < MINH) { h = MINH; if (north) y = y0 + h0 - MINH; }
          }
          group.x = Math.round(x); group.y = Math.round(y);
          group.w = Math.round(w); group.h = Math.round(h);
        };
        const up = () => {
          window.removeEventListener("pointermove", move, true);
          window.removeEventListener("pointerup", up, true);
          NS.api?.markDirty?.();
          NS.flow?.history?.schedule?.();
        };
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerup", up, true);
      };
      /* Groups render behind Vue Flow and are pointer-transparent except for
         the title, so a press on the empty pane inside a rectangle has to be
         hit-tested here (graph units) and claimed before the pane handler. */
      const groupAtScreen = (clientX, clientY) => {
        const point = NS.flow?.screenToFlow?.(clientX, clientY);
        if (!point) return null;
        const list = state.groups.value;
        for (let i = list.length - 1; i >= 0; i -= 1) {
          const group = list[i];
          if (point.x >= group.x && point.x <= group.x + group.w &&
              point.y >= group.y && point.y <= group.y + group.h) return group.id;
        }
        return null;
      };
      let suppressPaneClick = false;
      const onGroupPointerDown = (event) => {
        suppressPaneClick = false;
        if (!NS.api?.isActive?.()) return;
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".vue-flow__node, .ic-group, .ic-group-ui, .ic-selection-tools, .ict-menu, .ic-menu, input, textarea, [contenteditable]")) return;
        const id = groupAtScreen(event.clientX, event.clientY);
        if (!id) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressPaneClick = true;   /* the matching click is still a group hit */
        selectGroup(id);
      };
      /* A real pane click (outside every group) deselects the group. */
      const onPaneClick = () => {
        if (suppressPaneClick) { suppressPaneClick = false; return; }
        state.selectedGroupId.value = null;
      };
      onMounted(() => document.addEventListener("pointerdown", onGroupPointerDown, true));
      onBeforeUnmount(() => document.removeEventListener("pointerdown", onGroupPointerDown, true));

      /* Group title editing mirrors ComfyUI's TitleEditor.vue: double-click
       the title strip to edit in place, Enter or blur commits a trimmed
       non-empty value, Escape cancels. A renamed title is user data and is
       never passed through the translator again. */
      const startGroupRename = (group) => {
        state.groupEditing.value = { id: group.id, value: group.title };
        nextTick(() => {
          const input = document.querySelector(".ic-group-title-input");
          if (!input) return;
          input.focus();
          input.select();
        });
      };
      const commitGroupRename = () => {
        const edit = state.groupEditing.value;
        if (!edit) return;
        const value = String(edit.value || "").trim();
        if (value) {
          const target = state.groups.value.find((group) => group.id === edit.id);
          if (target && target.title !== value) {
            target.title = value;
            NS.api?.markDirty?.();
            NS.flow?.history?.schedule?.();
          }
        }
        state.groupEditing.value = null;
      };
      const cancelGroupRename = () => { state.groupEditing.value = null; };

      /* ComfyUI's group "Remove" deletes the group rectangle only — the
       nodes it contained stay exactly where they are. */
      const deleteGroup = (id) => {
        const before = state.groups.value.length;
        state.groups.value = state.groups.value.filter((group) => group.id !== id);
        if (state.groups.value.length === before) return;
        state.groupEditing.value = null;
        if (state.selectedGroupId.value === id) state.selectedGroupId.value = null;
        NS.api?.markDirty?.();
        NS.flow?.history?.schedule?.();
        NS.api?.toast?.("success", t("已删除分组"));
      };

      /* Right-clicking the title strip exposes the two group actions from
       LGraphGroup.getMenuOptions(): Title (rename) and Remove (delete group). */
      const openGroupMenu = (event, group) => {
        NS.tools?.openMenu?.(event.currentTarget, [
          { label: t("重命名"), onPick: () => startGroupRename(group) },
          { label: t("删除组"), onPick: () => deleteGroup(group.id) },
        ]);
      };
      /* Let core.js's single keydown handler reuse this setup-scoped action. */
      state.groupActions = { createGroup, deleteGroup, selectGroup };
      onBeforeUnmount(() => { state.groupActions = null; });

      /* Same three layouts and 12px default gap as ComfyUI's
         useArrangeNodes.ts; our cards already include their header in the
         measured size, so their titleHeight term is zero. */
      const arrangeSelected = (layout) => {
        const boxes = selectedBoxes();
        if (boxes.length < 2) return;
        const gap = 12;
        const anchor = boxes.reduce((best, box) =>
          box.x + box.y < best.x + best.y ? box : best, boxes[0]);
        let updates;
        if (layout === "vertical") {
          const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
          let cursor = anchor.y;
          updates = sorted.map((box) => {
            const update = { id: box.id, x: anchor.x, y: cursor };
            cursor += box.h + gap;
            return update;
          });
        } else if (layout === "horizontal") {
          const sorted = [...boxes].sort((a, b) => a.x - b.x || a.y - b.y);
          let cursor = anchor.x;
          updates = sorted.map((box) => {
            const update = { id: box.id, x: cursor, y: anchor.y };
            cursor += box.w + gap;
            return update;
          });
        } else {
          const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
          const cols = Math.ceil(Math.sqrt(sorted.length));
          const rows = Math.ceil(sorted.length / cols);
          const widths = Array(cols).fill(0), heights = Array(rows).fill(0);
          sorted.forEach((box, index) => {
            const col = index % cols, row = Math.floor(index / cols);
            widths[col] = Math.max(widths[col], box.w);
            heights[row] = Math.max(heights[row], box.h);
          });
          const colX = [anchor.x], rowY = [anchor.y];
          for (let i = 1; i < cols; i += 1) colX.push(colX[i - 1] + widths[i - 1] + gap);
          for (let i = 1; i < rows; i += 1) rowY.push(rowY[i - 1] + heights[i - 1] + gap);
          updates = sorted.map((box, index) => ({
            id: box.id, x: colX[index % cols], y: rowY[Math.floor(index / cols)],
          }));
        }
        for (const update of updates) NS.flow?.setNodePosition?.(update.id, { x: update.x, y: update.y });
        NS.flow?.history?.schedule?.();
        const label = layout === "vertical" ? t("垂直排列")
          : layout === "horizontal" ? t("水平排列") : t("网格排列");
        NS.api?.toast?.("success", t("排列完成"),
          t("已按{layout}排列 {count} 个节点", { layout: label, count: boxes.length }));
      };

      const openArrangeMenu = (event) => {
        NS.tools?.openMenu?.(event.currentTarget, [
          { label: t("垂直排列"), onPick: () => arrangeSelected("vertical") },
          { label: t("水平排列"), onPick: () => arrangeSelected("horizontal") },
          { label: t("网格排列"), onPick: () => arrangeSelected("grid") },
        ]);
      };

      const batchDownload = async () => {
        const ids = new Set(state.selectedIds.value);
        const nodes = state.nodes.value.filter((node) => ids.has(node.id));
        let count = 0;
        for (const node of nodes) {
          const asset = node.data?.result || node.data?.asset;
          const url = asset?.url || (asset && NS.api?.viewUrl?.(asset));
          if (url) {
            try {
              await NS.tools?.registry?.download?.({ id: node.id, data: node.data, url });
              count += 1;
              continue;
            } catch (error) { console.warn("[InfCanvas] batch download failed", error); }
          }
          const text = node.data?.text ?? node.data?.asset?.text ?? node.data?.result?.text;
          if (text != null) {
            const blob = new Blob([String(text)], { type: "text/plain;charset=utf-8" });
            NS.tools?.helpers?.saveBlob?.(blob, (node.data?.title || "text") + ".txt");
            count += 1;
          }
        }
        NS.api?.toast?.(count ? "success" : "info",
          count ? t("已下载 {count} 个素材", { count }) : t("没有可下载的素材"));
      };

      const batchDelete = () => {
        const ids = state.selectedIds.value.slice();
        if (ids.length < 2) return;
        const gone = new Set(ids);
        state.groups.value = state.groups.value.filter((group) =>
          !Array.isArray(group.nodes) || group.nodes.some((id) => !gone.has(id)));
        NS.flow?.selectNodes?.([]);
        NS.flow?.removeNodes?.(ids);
        NS.api?.markDirty?.();
        NS.flow?.history?.schedule?.();
        NS.api?.toast?.("success", t("已删除 {count} 个节点", { count: ids.length }));
      };

      /* Groups and the toolbox live in VueFlow's transformation pane, so all
         of these are GRAPH units now — the pane's translate+scale does the
         same work it does for node cards, which keeps the 12px radius, 1px
         border and 20px grips visually identical to a node at every zoom. */
      const groupStyle = (group) => ({
        left: group.x + "px",
        top: group.y + "px",
        width: group.w + "px",
        height: group.h + "px",
      });

      /* The toolbox is graph-positioned too: convert the screen-space
         selection box back into graph units, then keep it 10 graph px above
         the box (matching the group's 10px create padding). */
      const toolStyle = () => {
        const rect = selectionRect.value;
        if (!rect) return {};
        const vp = state.viewport.value;
        const zoom = vp.zoom || 1;
        return {
          left: ((rect.x + rect.w / 2 - vp.x) / zoom) + "px",
          top: ((rect.y - vp.y) / zoom - 10) + "px",
        };
      };

      return {
        gridCanvas, mode, showMinimap, multiSelect, selectionRect, groupEditing, selectedGroupId,
        groups, createGroup, selectGroup, onPaneClick, GROUP_CORNERS,
        startGroupRename, commitGroupRename, cancelGroupRename, startGroupDrag, startGroupResize,
        openGroupMenu, openArrangeMenu, batchDownload, batchDelete,
        groupStyle, toolStyle,
        onInit, onViewportChange, onConnect, isValidConnection,
        onConnectStart, onConnectEnd,
        onNodeDragStop, onNodeClick, onSelectionChange,
        zoomFar, cutMode, cutTrail,
        /* Vue Flow clamps d3-zoom's scaleExtent from these two props; leaving
           them at the library default (0.5 .. 2) would cap the wheel at 200%. */
        minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM,
        snap, snapGrid: [10, 10],
        nodes: state.nodes, edges: state.edges,
        nodeTypes: VueNS.markRaw({ ic: IcNode }),
        edgeTypes: VueNS.markRaw({ ic: IcEdge }),
        toggleMinimap: () => NS.flow?.minimap.toggle(),
        miniColor: () => "#4a9eff",
      };
    },
    template: `
      <canvas class="ic-canvas-grid" ref="gridCanvas"></canvas>
      <VueFlow
        :nodes="nodes" :edges="edges" :node-types="nodeTypes" :edge-types="edgeTypes"
        :min-zoom="minZoom" :max-zoom="maxZoom"
        :snap-to-grid="snap" :snap-grid="snapGrid"
        :pan-on-drag="true"
        :nodes-draggable="mode === 'select'" :elements-selectable="mode === 'select'"
        :nodes-connectable="mode === 'select'" :edges-updatable="mode === 'select'"
        connection-mode="strict"
        :selection-key-code="mode === 'select' ? 'Control' : false"
        :multi-selection-key-code="['Shift', 'Control', 'Meta']"
        selection-mode="partial"
        :zoom-on-scroll="true" :zoom-on-double-click="false" :prevent-scrolling="true"
        :delete-key-code="null" :fit-view-on-init="false" :elevate-edges-on-select="false"
        :default-edge-options="{ type: 'ic' }"
        :class="['ic-flow', 'mode-' + mode, { 'is-far': zoomFar, 'is-cut-mode': cutMode, 'is-multi-select': multiSelect }]"
        @init="onInit" @viewport-change="onViewportChange" @connect="onConnect"
        @pane-click="onPaneClick"
        @connect-start="onConnectStart" @connect-end="onConnectEnd"
        :is-valid-connection="isValidConnection"
        @node-drag-stop="onNodeDragStop" @node-click="onNodeClick" @selection-change="onSelectionChange"
      >
        <template #connection-line="slotProps">
          <IcConnectionLine v-bind="slotProps" />
        </template>
        <!-- zoom-pane is the slot VueFlow renders INSIDE the transformation
             pane, so these use graph units and scale exactly like nodes. The
             backdrop is below the nodes; only the strip/grips/toolbar take
             pointers (the pane itself is pointer-events:none). -->
        <template #zoom-pane>
          <div v-for="group in groups" :key="group.id" class="ic-group"
               :class="{ 'is-selected': selectedGroupId === group.id }" :style="groupStyle(group)"></div>
          <div v-for="group in groups" :key="'ui-' + group.id" class="ic-group-ui"
               :class="{ 'is-selected': selectedGroupId === group.id }" :style="groupStyle(group)">
            <input v-if="groupEditing && groupEditing.id === group.id"
                   class="ic-group-title-input" v-model="groupEditing.value"
                   @keydown.enter.prevent="commitGroupRename" @keydown.esc.prevent="cancelGroupRename"
                   @blur="commitGroupRename" @pointerdown.stop @mousedown.stop
                   @dblclick.stop @wheel.stop @contextmenu.stop.prevent />
            <div v-else class="ic-group-title nopan nodrag" :title="$t('双击标题改名')"
                 @pointerdown="startGroupDrag($event, group)" @mousedown.stop
                 @dblclick.stop.prevent="startGroupRename(group)"
                 @contextmenu.prevent.stop="openGroupMenu($event, group)">{{ group.title }}</div>
            <div v-for="corner in GROUP_CORNERS" :key="corner" class="ic-group__rz nopan nodrag"
                 :class="'ic-group__rz--' + corner"
                 @pointerdown="startGroupResize($event, group, corner)" @mousedown.stop>
              <svg viewBox="0 0 12 12"><path d="M11 1L1 11M11 6L6 11" /></svg>
            </div>
          </div>
          <div v-if="selectionRect && multiSelect" class="ic-selection-tools" :style="toolStyle()"
               @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @wheel.stop>
            <button type="button" :title="$t('打组')" @click="createGroup">
              <i class="icon-[lucide--frame]"></i><span>{{ $t('打组') }}</span>
            </button>
            <button type="button" :title="$t('排列')" @click="openArrangeMenu">
              <i class="icon-[lucide--layout-grid]"></i><span>{{ $t('排列') }}</span>
            </button>
            <button type="button" :title="$t('批量下载')" @click="batchDownload">
              <i class="icon-[lucide--download]"></i><span>{{ $t('批量下载') }}</span>
            </button>
            <button type="button" :title="$t('批量删除')" @click="batchDelete">
              <i class="icon-[lucide--trash-2]"></i><span>{{ $t('批量删除') }}</span>
            </button>
          </div>
        </template>
        <div v-if="showMinimap" class="ic-minimap-wrap nodrag">
          <div class="ic-minimap">
            <MiniMap :width="253" :height="200" :node-color="miniColor"
                   mask-color="rgba(0,0,0,.55)" :mask-stroke-color="'rgba(255,255,255,.92)'" :mask-stroke-width="2"
                   pannable zoomable />
            <button class="ic-minimap__close" @click="toggleMinimap" :aria-label="$t('关闭')">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </VueFlow>
      <!-- ComfyUI Comfy.SelectionBorder equivalent: dashed round-rect around
           all selected nodes, measured in screen space above. -->
      <svg v-if="selectionRect" class="ic-selection-border" aria-hidden="true">
        <rect :x="selectionRect.x" :y="selectionRect.y" :width="selectionRect.w" :height="selectionRect.h"
              rx="8" ry="8" fill="none" stroke="var(--border, #ffffff66)" stroke-width="2"
              stroke-dasharray="5 5" />
      </svg>
      <!-- Alt slice: the stroke the pointer actually travels, so the user sees
           which wires the knife is about to take. -->
      <svg v-if="cutTrail" class="ic-cut-trail" aria-hidden="true">
        <path :d="cutTrail"></path>
      </svg>
    `,
  };

  /* ------------------------------ controller ----------------------------- */

  /* Vue Flow's parseNode() copies every node it receives, so dragging updates
     the copy inside its own store while our source array keeps the old
     position -- serialising that array would save the position the node started
     at. Copy the live positions back after a drag and again before saving. */
  function syncLivePositions() {
    const api = state.flow;
    if (!api) return;
    for (const src of state.nodes.value) {
      const live = api.findNode?.(src.id);
      const x = live?.position?.x;
      const y = live?.position?.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x !== src.position.x || y !== src.position.y) src.position = { x, y };
    }
  }

  /* -------------------------------- history ------------------------------- */

  /* Undo / redo the way ComfyUI's ChangeTracker does it: a stack of graph
     snapshots, coalesced by a debounce so a burst of edits (or a whole drag)
     collapses into one step. The VIEWPORT is deliberately excluded — panning
     and zooming are not edits in ComfyUI either. */
  const HISTORY_LIMIT = 60;
  /* MERGE_WINDOW: a change that lands shortly after the previous commit is the
     tail of the same gesture (a wire connect is followed by the node's own
     auto-fit size write, typing pauses every few hundred ms), so it EXTENDS the
     step instead of pushing a second one. Without this an undo of "connect"
     would only undo the auto-fit. */
  const HISTORY_MERGE_MS = 500;
  const history = { past: [], future: [], last: null, lastAt: 0, timer: 0, settle: 0, applying: false };

  function historySignature() {
    /* Positions live in Vue Flow's store; pull them back first or an undone
       move would restore the coordinates the node started at. */
    syncLivePositions();
    return JSON.stringify({ nodes: state.nodes.value, edges: state.edges.value, groups: state.groups.value });
  }

  function historyCommit() {
    if (history.applying) return;
    if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
    let now;
    try { now = historySignature(); } catch (error) { return; }
    if (history.last === null) { history.last = now; history.lastAt = Date.now(); return; }
    if (now === history.last) return;
    const merge = history.lastAt > 0 && Date.now() - history.lastAt < HISTORY_MERGE_MS;
    if (!merge) {
      history.past.push(history.last);
      if (history.past.length > HISTORY_LIMIT) history.past.shift();
    }
    history.last = now;
    history.lastAt = Date.now();
    history.future.length = 0;
  }

  /* Absorb a write that is NOT a user edit (an asset auto-fitting its frame,
     a generation's status flipping to running) by moving the baseline over it
     instead of recording a step — ComfyUI never puts that kind of state into
     the undo stack either. */
  function historyAbsorb() {
    if (history.applying || history.last === null) return;
    /* Drop a queued commit: it would carry this derived write into its own
       step, which is exactly the dead undo step we are avoiding. */
    if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
    try { history.last = historySignature(); } catch (error) { return; }
    history.lastAt = 0;
  }

  function historySchedule() {
    if (history.applying) return;
    if (history.timer) clearTimeout(history.timer);
    history.timer = setTimeout(historyCommit, 350);
  }

  function historyApply(text) {
    let doc = null;
    try { doc = JSON.parse(text); } catch (error) { return false; }
    history.applying = true;
    state.nodes.value = doc.nodes || [];
    state.edges.value = dedupeEdges(doc.edges || []);
    state.groups.value = Array.isArray(doc.groups) ? doc.groups : [];
    nextTick(() => {
      /* Restoring can drop nodes; re-read the live selection so the edge
         highlight never points at something that no longer exists. */
      state.selectedIds.value = (state.flow?.getSelectedNodes?.value || []).map((n) => n.id);
      NS.api?.markDirty?.();
    });
    /* Node components may write normalised fields while they remount, which is
       not a user edit: absorb those writes by re-baselining instead of pushing
       a step. Otherwise the follow-up commit would wipe the redo stack. */
    if (history.settle) clearTimeout(history.settle);
    history.settle = setTimeout(() => {
      history.settle = 0;
      if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
      try { history.last = historySignature(); } catch (error) { /* optional */ }
      /* The restored state is a step of its own: never merge the next user
         edit into it. */
      history.lastAt = 0;
      history.applying = false;
    }, 400);
    return true;
  }

  function historyUndo() {
    historyCommit();                       // fold a pending edit into a step
    if (!history.past.length) return false;
    const previous = history.past.pop();
    history.future.push(history.last);
    history.last = previous;
    return historyApply(previous);
  }

  function historyRedo() {
    historyCommit();
    if (!history.future.length) return false;
    const next = history.future.pop();
    history.past.push(history.last);
    history.last = next;
    return historyApply(next);
  }

  /* Called whenever a different document is loaded: the new graph is the new
     baseline, so nothing older can be undone into. */
  function historyReset() {
    if (history.timer) { clearTimeout(history.timer); history.timer = 0; }
    if (history.settle) { clearTimeout(history.settle); history.settle = 0; }
    history.applying = false;
    history.past = [];
    history.future = [];
    history.last = null;
    nextTick(() => {
      if (history.last !== null) return;
      try { history.last = historySignature(); } catch (error) { /* optional */ }
    });
  }

  /* Set while the API dialog renames a workflow. The template name is the
     workflow id, so for a moment every node that referenced the old stem points
     at something the shared list no longer has -- the "adopt the category
     default" watcher would then rewrite all of them to the default and the
     rename would be lost. Suppressing it for the duration keeps the refs that
     renameWorkflowRefs just wrote. */
  let renamingWorkflows = false;

  const flow = NS.flow = {
    state,
    init(stage) {
      injectStyles();
      if (!this.host) {
        const host = document.createElement("div");
        host.id = "infcanvas-vueflow";
        this.host = host;
      }
      stage.appendChild(this.host);
      if (!state.app) {
        state.app = createApp(Root);
        /* Expose reactive $t to every node template; switching language
           updates the shared lang ref and re-renders all template text. */
        if (NS.i18n) {
          state.app.config.globalProperties.$t = NS.i18n.t;
          state.app.config.globalProperties.$cat = NS.i18n.cat;
        }
        state.app.mount(this.host);
      }
      return this.host;
    },

    unmount() {
      if (this.host?.parentElement) this.host.parentElement.removeChild(this.host);
    },

    /* ---- docs ---- */
    load(doc) {
      state.nodes.value = doc.nodes || [];
      state.groups.value = Array.isArray(doc.groups) ? doc.groups : [];
      state.selectedGroupId.value = null;
      /* Collapse any duplicate source→target wires already present in an old
         save so every downstream count sees one connection per node pair. */
      state.edges.value = dedupeEdges(doc.edges);
      const viewport = doc.viewport || { x: 0, y: 0, zoom: 1 };
      state.viewport.value = { x: viewport.x || 0, y: viewport.y || 0, zoom: viewport.zoom || 1 };
      nextTick(() => {
        try { state.flow?.setViewport(state.viewport.value, { duration: 0 }); } catch (error) { /* optional */ }
      });
      /* A freshly opened document is the undo baseline. */
      historyReset();
    },

    /* ---- undo / redo (Ctrl+Z / Ctrl+Y) ---- */
    history: {
      schedule: historySchedule,
      commit: historyCommit,
      reset: historyReset,
      undo: historyUndo,
      redo: historyRedo,
      canUndo: () => history.past.length > 0,
      canRedo: () => history.future.length > 0,
      absorb: historyAbsorb,
      /* Stack depth — handy for the live checks and a future toolbar state. */
      size: () => ({ past: history.past.length, future: history.future.length, ready: !!history.last }),
    },

    /* Workflow templates are referenced by their file stem (node.data.workflow),
       so renaming one in the API dialog would leave every existing node pointing
       at a name that no longer exists. Retarget them in place; the reactive data
       object re-renders the node's API selector and its fields request. */
    /** Mute the category-default adoption while a rename is in flight. */
    setRenaming(on) { renamingWorkflows = !!on; },

    /** Same prompt gate the canvas uses, exposed for live checks. */
    acceptsText(nodeId) {
      return workflowAcceptsText(state.nodes.value.find((n) => n.id === nodeId)?.data);
    },

    renameWorkflowRefs(from, to) {
      if (!from || !to || from === to) return 0;
      let changed = 0;
      for (const node of state.nodes.value) {
        const data = node && node.data;
        if (!data || data.workflow !== from) continue;
        data.workflow = to;
        /* The frozen parameter set belongs to the same graph — only the file
           name moved. Retarget it so a finished node does not refetch (and lose
           its frozen config) just because the template was renamed. */
        if (data.fieldSnapshot && data.fieldSnapshot.workflow === from) {
          data.fieldSnapshot.workflow = to;
          if (data.fieldSnapshot.name === from) data.fieldSnapshot.name = to;
        }
        changed += 1;
      }
      return changed;
    },

    snapshot() {
      /* Positions live in Vue Flow's store, not in our array: pull them back
         before serialising or the saved canvas reopens at the old coordinates. */
      syncLivePositions();
      return {
        nodes: JSON.parse(JSON.stringify(state.nodes.value)),
        edges: JSON.parse(JSON.stringify(state.edges.value)),
        groups: JSON.parse(JSON.stringify(state.groups.value)),
        viewport: { ...state.viewport.value },
      };
    },

    /* ---- viewport ---- */
    getViewport() { return state.flow?.getViewport?.() || { ...state.viewport.value }; },
    setViewport(vp) {
      const value = { x: vp.x || 0, y: vp.y || 0, zoom: vp.zoom || 1 };
      state.viewport.value = value;
      state.flow?.setViewport(value, { duration: 0 });
    },
    screenToFlow(clientX, clientY) {
      const box = this.host?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      return state.flow.screenToFlowCoordinate({ x: clientX, y: clientY });
    },
    flowToScreen(x, y) {
      const p = state.flow.flowToScreenCoordinate({ x, y });
      return { x: p.x, y: p.y };
    },
    zoomIn() { state.flow?.zoomIn({ duration: 120 }); },
    zoomOut() { state.flow?.zoomOut({ duration: 120 }); },
    /* One setViewport call only: Vue Flow applies it asynchronously, so calling
       setViewport twice (once to zoom, once to re-centre) lets the second write
       race back to the old zoom. Compute the final transform here instead. */
    setZoom(zoom) {
      const target = clamp(Number(zoom) || 1, MIN_ZOOM, MAX_ZOOM);
      const vp = this.getViewport();
      const box = this.host?.getBoundingClientRect();
      if (!box) { state.flow?.setViewport({ ...vp, zoom: target }, { duration: 0 }); return; }
      const cx = (box.width / 2 - vp.x) / (vp.zoom || 1);
      const cy = (box.height / 2 - vp.y) / (vp.zoom || 1);
      state.flow?.setViewport({
        x: box.width / 2 - cx * target,
        y: box.height / 2 - cy * target,
        zoom: target,
      }, { duration: 0 });
    },
    viewportCenter() {
      const vp = this.getViewport();
      const box = this.host?.getBoundingClientRect();
      const width = box?.width || 1;
      const height = box?.height || 1;
      return {
        x: (width / 2 - vp.x) / vp.zoom,
        y: (height / 2 - vp.y) / vp.zoom,
        width, height,
      };
    },
    centerOn(x, y, zoom = null) {
      const box = this.host?.getBoundingClientRect();
      const scale = zoom || this.getViewport().zoom;
      state.flow?.setViewport({
        x: (box?.width || 1) / 2 - x * scale,
        y: (box?.height || 1) / 2 - y * scale,
        zoom: scale,
      }, { duration: 0 });
    },
    panBy(dx, dy) {
      const vp = this.getViewport();
      state.flow?.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom }, { duration: 0 });
    },
    /* ComfyUI's Comfy.Canvas.FitView -> LGraphCanvas.fitViewToSelectionAnimated()
       -> DragAndScale.animateToBounds(), ported 1:1:
         - selected nodes win; with nothing selected the whole graph is used
         - fill ratio 0.75 (animateToBounds' `zoom` option), not a jump
         - each axis divides by max(bounds, 300) so a single small node is not
           blown up to the 1000% ceiling
         - scale is capped by max_scale and eased over 350ms
       Vue Flow maps graph -> screen as screen = graph * zoom + offset, while
       LiteGraph uses one extra *scale, hence x = centre - graphCentre * zoom. */
    fitView(fill = 0.75) {
      const selected = this.selectedNodes();
      const pool = selected.length ? selected : state.nodes.value;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const node of pool) {
        const size = node.data?.size || [200, 150];
        const x = node.position?.x ?? 0;
        const y = node.position?.y ?? 0;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + (size[0] || 200));
        /* Every node is a plain size[1]-tall card (no 30px gen header). */
        maxY = Math.max(maxY, y + (size[1] || 150));
      }
      const box = this.host?.getBoundingClientRect();
      if (!Number.isFinite(minX) || !box) return false;
      /* Fit into what the user can actually see: a docked panel covers the
         left edge, which is ComfyUI's visibleCanvasViewport(). */
      const left = this.visibleLeft();
      const vw = Math.max(1, box.width - left);
      const vh = Math.max(1, box.height);
      const bw = maxX - minX;
      const bh = maxY - minY;
      const zoom = clamp(
        Math.min((fill * vw) / Math.max(bw, 300), (fill * vh) / Math.max(bh, 300)),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      state.flow?.setViewport({
        x: left + vw / 2 - (minX + bw / 2) * zoom,
        y: vh / 2 - (minY + bh / 2) * zoom,
        zoom,
      }, { duration: 350 });
      return true;
    },
    /* Width of the left dock that covers the canvas right now (screen px). */
    visibleLeft() {
      const box = this.host?.getBoundingClientRect();
      const panel = document.querySelector("#infcanvas-panel");
      if (!box || !panel) return 0;
      const p = panel.getBoundingClientRect();
      if (!(p.width > 0)) return 0;
      return Math.max(0, Math.min(box.width, p.right - box.left));
    },
    setMode(mode) { state.mode.value = mode === "drag" ? "drag" : "select"; },
    /* ---- grid snap (10px cells, matches the canvas background grid) ---- */
    snap: {
      enabled() { return !!state.snap.value; },
      set(value) { state.snap.value = !!value; },
      toggle() { state.snap.value = !state.snap.value; return state.snap.value; },
    },
    /* Called before serialising: Vue Flow owns the live node positions. */
    syncPositions() { syncLivePositions(); },

    /* ---- nodes / edges ---- */
    addNode(node) {
      state.nodes.value = state.nodes.value.concat([node]);
      return node;
    },
    removeNodes(ids) {
      const set = new Set(ids);
      state.nodes.value = state.nodes.value.filter((node) => !set.has(node.id));
      state.edges.value = state.edges.value.filter((edge) => !set.has(edge.source) && !set.has(edge.target));
    },
    removeEdges(ids) {
      const set = new Set(ids);
      state.edges.value = state.edges.value.filter((edge) => !set.has(edge.id));
      NS.api?.markDirty?.();
    },
    addEdge(edge) { state.edges.value = state.edges.value.concat([edge]); },
    nodesOf() { return state.nodes.value; },
    edgesOf() { return state.edges.value; },
    /* Expose the live (Vue Flow store) node: its position is authoritative
       while the source array may still hold the pre-drag coordinates. */
    findNode(id) {
      return state.flow?.findNode?.(id) || state.nodes.value.find((node) => node.id === id) || null;
    },
    /* Keep the serialised source array in sync with the reactive copy Vue Flow
       hands to node components (generated params, text edits, resize, uploads). */
    updateNodeData(id, fields) {
      const src = state.nodes.value.find((node) => node.id === id);
      const live = state.flow?.findNode?.(id);
      for (const [key, value] of Object.entries(fields)) {
        if (src) src.data[key] = value;
        if (live?.data && live.data !== src?.data) live.data[key] = value;
      }
      NS.api?.markDirty?.();
    },
    /* Corner-resize moves the node's top-left as well as its size. Vue Flow
       owns the live (reactive) position in its store — dragging itself writes
       node.position directly — so do the same here, and mirror into the source
       array so serialising (and syncLivePositions) sees the new coordinates. */
    setNodePosition(id, position) {
      const pos = { x: position.x, y: position.y };
      const src = state.nodes.value.find((node) => node.id === id);
      const live = state.flow?.findNode?.(id);
      if (src) src.position = { ...pos };
      if (live) live.position = pos;
      NS.api?.markDirty?.();
    },
    revealNode(node) { NS.api?.revealNode?.(node); },
    selectedNodes() { return state.flow?.getSelectedNodes?.value || []; },
    /* Selection lives in Vue Flow's own store, so go through its API instead of
       flipping `node.selected` on our plain objects (they are not the same). */
    selectNodes(ids) {
      const api = state.flow;
      if (!api) return;
      try {
        const current = api.getSelectedNodes?.value || [];
        if (current.length) api.removeSelectedNodes(current);
        const nodes = ids.map((id) => api.findNode(id)).filter(Boolean);
        if (nodes.length) {
          api.addSelectedNodes(nodes);
          state.selectedGroupId.value = null;
        }
        /* Mirror immediately so the edge highlight does not wait a tick. */
        state.selectedIds.value = nodes.map((node) => node.id);
      } catch (error) { console.warn("[InfCanvas] select failed", error); }
    },

    /* ---- minimap ---- */
    minimap: {
      toggle() {
        state.minimap.value = !state.minimap.value;
        NS.controls?.syncMapButton?.();
        return state.minimap.value;
      },
      set(visible) {
        state.minimap.value = !!visible;
        NS.controls?.syncMapButton?.();
      },
      visible() { return state.minimap.value; },
    },

    pauseAll() {
      for (const media of this.host?.querySelectorAll("video, audio") || []) {
        try { media.pause(); } catch (error) { /* optional */ }
      }
    },

    markDirty() { state.onDirty?.(); },
    onReady() { /* replaced by core */ },
    onViewport() { /* replaced by core */ },
    onSelection() { /* replaced by core */ },
  };
})();
