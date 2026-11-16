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
  const TRACK = "rgba(255,255,255,.66)";
  /* Asset media nodes: minimum width and the fixed width used when a source
     is first loaded (height then follows the source aspect ratio). */
  const ASSET_MIN_W = 320;
  const ASSET_DEF_W = 320;

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
    play: '<path d="M7 4.5 L22 12 L7 19.5 Z" fill="currentColor"/>',
    pause: '<path d="M7 4.5 V19.5 M17 4.5 V19.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    volume: '<path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14 H4 Z" fill="currentColor"/>'
      + '<path d="M15.5 8.5 A5 5 0 0 1 15.5 15.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
      + '<path d="M18 6 A8.5 8.5 0 0 1 18 18" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    mute: '<path d="M4 9.5 H7.5 L12 5.5 V18.5 L7.5 14 H4 Z" fill="currentColor"/>'
      + '<path d="M16 9.5 L21 14.5 M21 9.5 L16 14.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    upload: '<path d="M12 15.5 V5.5 M8 9 L12 5 L16 9" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<path d="M5 15.5 V18.5 H19 V15.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    sparkles: '<path d="M12 3 L13.7 9.3 L20 11 L13.7 12.7 L12 19 L10.3 12.7 L4 11 L10.3 9.3 Z" fill="currentColor"/>'
      + '<path d="M19 16 L19.8 18.2 L22 19 L19.8 19.8 L19 22 L18.2 19.8 L16 19 L18.2 18.2 Z" fill="currentColor"/>',
    settings: '<path d="M12 15.2 A3.2 3.2 0 1 1 12 8.8 A3.2 3.2 0 1 1 12 15.2 Z" stroke="currentColor" stroke-width="1.7" fill="none"/>'
      + '<path d="M12 2.6 L13.4 4.4 L15.7 3.8 L16.4 6 L18.8 6.2 L18.4 8.5 L20.4 10 L19.2 12 L20.4 14 L18.4 15.5 L18.8 17.8 L16.4 18 L15.7 20.2 L13.4 19.6 L12 21.4 L10.6 19.6 L8.3 20.2 L7.6 18 L5.2 17.8 L5.6 15.5 L3.6 14 L4.8 12 L3.6 10 L5.6 8.5 L5.2 6.2 L7.6 6 L8.3 3.8 L10.6 4.4 Z" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
    send: '<path d="M12 20 V5 M6 11 L12 5 L18 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    /* lucide chevron-down / check — used by the Nodes 2.0 style select
       (SelectTrigger's SelectIcon + SelectItemIndicator). */
    "chevron-down": '<path d="M6 9.5 L12 15.5 L18 9.5" stroke="currentColor" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    check: '<path d="M4.5 12.5 L9.5 17.5 L19.5 6.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
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
     audio). 全能参考 needs ≥1 media asset, so it is NOT selectable on an empty
     node nor on a text-only node. 文生视频 is the pure-prompt mode: its rule
     set is EMPTY, so any wired media disables it. 首帧 = exactly 1 image;
     首尾帧 = exactly 2. This single table drives the tab-disable check
     (modeReasonFor) and the active-mode fallback. */
  const VIDEO_INPUT_RULES = {
    "全能参考": { _minMedia:1, image: {min:0,max:null}, video: {min:0,max:null}, audio: {min:0,max:null} },
    "文生视频": {},
    "首帧":     { image: {min:1,max:1} },
    "首尾帧":   { image: {min:2,max:2} },
  };
  const KIND_CN = {
    image: { label: "图片", measure: "张" },
    video: { label: "视频", measure: "个" },
    audio: { label: "音频", measure: "段" },
    text:  { label: "文本", measure: "段" },
  };
  /* Fixed slot layout of the wired-assets row; null = follow actual wires. */
  const MODE_ASSET_SLOTS = {
    "全能参考": null,
    "文生视频": [],
    "首帧":     [{ kind: "image" }],
    "首尾帧":   [{ kind: "image" }, { kind: "image" }],
  };
  function isVideoGenData(data) {
    return !!data && (data.role === "gen-video" || (data.role === "gen" && data.kind === "video"));
  }
  function assetKindOf(node) {
    const d = node?.data;
    if (!d) return null;
    return d.kind || d.asset?.kind || (d.role === "text" ? "text" : null);
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
     and caps (max) — so 1 image does NOT qualify for 首尾帧 (needs 2). */
  function modeReasonFor(mode, counts) {
    const rules = VIDEO_INPUT_RULES[mode] || VIDEO_INPUT_RULES["文生视频"];
    /* Any wired kind this mode forbids? (metadata keys start with "_") */
    for (const kind of Object.keys(counts)) {
      if (!counts[kind]) continue;
      if (!kind.startsWith("_") && !(kind in rules)) {
        const allowed = Object.keys(rules).filter((k) => !k.startsWith("_")).map((k) => KIND_CN[k]?.label || k).join("、");
        /* Empty rule set (文生视频) accepts no media at all — it's the pure
           prompt mode. */
        if (!allowed) return `「${mode}」为纯提示词模式，不接入媒体素材`;
        return `「${mode}」只能接入${allowed}`;
      }
    }
    /* Overall MEDIA lower bound (全能参考 needs ≥1 image/video/audio). Text
       alone never satisfies it. Zero counts count. */
    const minMedia = rules._minMedia || 0;
    if (minMedia) {
      let media = 0;
      for (const kind of ["image", "video", "audio"]) media += counts[kind] || 0;
      if (media < minMedia) return `「${mode}」需要至少接入 ${minMedia} 个图片/视频/音频素材，当前 ${media} 个`;
    }
    /* Required minimums and caps — STRICT: a required kind with 0 wired still
       fails (0 < min). No "empty node" exception. */
    for (const kind of Object.keys(rules)) {
      if (kind.startsWith("_")) continue;
      const { min, max } = rules[kind];
      const have = counts[kind] || 0;
      const cn = KIND_CN[kind] || { label: "素材", measure: "个" };
      if (min && have < min) {
        return `「${mode}」需要 ${min} ${cn.measure}${cn.label}，当前只有 ${have} ${cn.measure}`;
      }
      if (max !== null && have > max) {
        return `「${mode}」最多接入 ${max} ${cn.measure}${cn.label}`;
      }
    }
    return "";
  }

  /* Fallback workflow options if the backend list is unavailable. */
  const WF_FALLBACK = [
    { id: "video", name: "文生视频" },
    { id: "image", name: "文生图" },
    { id: "audio", name: "文生音频" },
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

  /* Slider geometry: the 12px knob is inset 6px at both ends of the track so it
     is never clipped at ratio 0 / 1. We drive the fill width and thumb `left`
     in px (NOT transforms) so the bar stays crisp under the viewport zoom
     transform. */
  const KNOB_INSET = 6;

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
    const muteIcon = ref("volume");
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
        timeText.value = fmtTime(media.currentTime || 0);
        durationText.value = fmtTime(total);
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
      muteIcon.value = silent ? "mute" : "volume";
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
      timeText.value = "0:00";
      durationText.value = "0:00";
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

    /* The plot is centred on the whole node, but its bottom is clamped so no bar
       can run into the play/time/volume row, which starts 60px above the node's
       bottom edge (36px offset + 24px button); 68px keeps an 8px gap. */
    const BAR_ROW_KEEPOUT = 68;
    const plotBox = (height) => {
      // Fixed *ratio* (not pixel-clamped) so the headroom stays proportional at
      // any zoom: shrinking keeps the same relative margin, and zooming in grows
      // the margin in pixels too — the waveform never crowds the edges, nor does
      // it collapse to a tiny margin when the node is enlarged.
      const margin = height * 0.14;
      const top = Math.max(8, Math.min(margin, height - BAR_ROW_KEEPOUT - 24));
      const bottom = Math.max(margin, BAR_ROW_KEEPOUT);
      return { top, bottom, h: Math.max(6, height - top - bottom) };
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
    components: { Handle, IcIcon },
    props: { id: { type: String, required: true }, data: { type: Object, required: true }, selected: Boolean },
    setup(props) {
      const data = props.data;
      /* computed: clicking "upload" on an empty node can turn it into a video
         or audio node, so the rendered branch must follow data.kind live. */
      const kind = computed(() => data.kind || "image");
      const isGen = data.role === "gen";
      /* Text nodes are their own role (neither asset nor gen): they keep the
         asset-style frameless look but also accept an input handle. */
      const isText = data.role === "text";
      /* Generate nodes NEVER accept uploaded media. Their only media source is
         the workflow RESULT stored in data.result (same shape as data.asset).
         Before a run there is no result, so hasMedia is false and the body shows
         the "选择工作流并运行…" hint — matching the reference bundle's
         xcat-gen-empty. Do NOT fall back to data.asset here: that field belongs
         to asset nodes and would let a gen node silently show an uploaded file. */
      const assetOf = computed(() => (isGen ? data.result : data.asset));
      const url = computed(() => {
        const asset = assetOf.value;
        if (!asset) return "";
        return asset.url || NS.api?.viewUrl?.(asset) || "";
      });

      const media = useMediaPlayer(() => url.value);
      const wave = useAudioWave(() => url.value, () => media.el.value, () => kind.value === "audio");
      /* A generate node's bottom strip is reserved for its parameter bar;
         playback of a generated video/audio lives on the material node that
         attachResult() spawns next to it. */
      const bar = computed(() => (kind.value === "video" || kind.value === "audio") && !!assetOf.value);
      const hasMedia = computed(() => !!assetOf.value && (kind.value === "image" || kind.value === "video" || kind.value === "audio"));

      /* Every node shares the same frameless card: data.size IS the whole
         frame (no 30px title bar). Generate nodes keep their form in the body. */
      const size = computed(() => Array.isArray(data.size) ? data.size : [320, 180]);
      const bodyH = computed(() => Math.max(80, size.value[1]));
      const rootStyle = computed(() => ({
        width: size.value[0] + "px",
        height: bodyH.value + "px",
      }));
      const handleTop = (index, count = 1) =>
        `calc(50% + ${(index - (count - 1) / 2) * SLOT_STEP}px)`;

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
        const MINW = isMediaLike ? ASSET_MIN_W : 160, MINH = 80;
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
      const setField = (key, value) => patch({ [key]: value });
      const run = () => NS.generate?.run?.(props.id);
      /* Generate-node control bar: compact selects mirroring the reference
         video-generator toolbar, wired to this node's real parameters. */
      const workflows = ["image", "video", "audio"];
      const workflowLabels = { image: "文生图", video: "文生视频", audio: "文生音频" };
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
      const isGenVideo = computed(() => isGen && kind.value === "video");
      const videoModes = ["全能参考", "文生视频", "首帧", "首尾帧"];
      const videoMode = computed(() => data.videoMode || "文生视频");
      /* Switching mode NEVER touches wires. Availability is decided by the
         assets already wired in (modeAvailable), and the tab UI disables the
         modes that don't fit. This guard only back-stops programmatic calls. */
      const setVideoMode = (mode) => {
        if (!modeAvailable(mode)) {
          NS.api?.toast?.("warning", "该模式不可选", modeReason(mode));
          return;
        }
        patch({ videoMode: mode });
      };
      /* Assets wired into this generator: follow incoming edges live so the
         thumbnail row updates when the user connects/disconnects a source. */
      const incomingAssets = computed(() => {
        if (!isGenVideo.value) return [];
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
          const srcKind = src.data?.kind || src.data?.asset?.kind || (src.data?.role === "text" ? "text" : null);
          if (srcKind === "text") continue;
          const asset = src.data?.asset;
          const url = asset ? (asset.url || NS.api?.viewUrl?.(asset) || "") : "";
          const kind = src.data?.kind || asset?.kind || "image";
          counters[kind] = (counters[kind] || 0) + 1;
          const cn = KIND_CN[kind] || { label: "素材" };
          out.push({
            id: src.id,
            kind,
            name: asset?.name || asset?.filename || src.data?.title || "素材",
            label: cn.label + counters[kind],   // 图片1 / 视频1 / 音频1
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
      /* Wired-assets row is mode-driven:
           - 全能参考: show every wired asset + a dashed "add" slot;
           - 文生视频: no asset row at all (text prompt only);
           - 首帧 / 首尾帧: fixed image slots, filled from wired images in order.
         Each slot: { key, kind, asset|null, add }. */
      const assetSlots = computed(() => {
        if (!isGenVideo.value) return [];
        const mode = videoMode.value;
        const incoming = incomingAssets.value.slice();
        const template = MODE_ASSET_SLOTS[mode];
        const slots = [];
        if (template === null) {
          /* 全能参考: every wired MEDIA asset (image/video/audio) + add slot. */
          incoming.forEach((a) => slots.push({ key: a.id, kind: a.kind, asset: a, add: false }));
        } else {
          /* Fixed image slots (首帧 1 / 首尾帧 2 / 文生视频 0) filled from
             wired images in order. Text is a prompt, never a slot. */
          const used = new Set();
          template.forEach((slot, i) => {
            const idx = incoming.findIndex((a) => a.kind === slot.kind && !used.has(a.id));
            if (idx >= 0) {
              used.add(incoming[idx].id);
              slots.push({ key: incoming[idx].id, kind: slot.kind, asset: incoming[idx], add: false });
            } else {
              slots.push({ key: "slot" + i, kind: slot.kind, asset: null, add: false });
            }
          });
        }
        return slots;
      });
      const slotHint = (kind) => (KIND_CN[kind]?.label || "素材") + "槽（连接对应素材节点）";
      /* Kick off offscreen thumbnail extraction for any newly wired video. */
      watch(incomingAssets, (assets) => {
        for (const a of assets) if (a.kind === "video" && a.url) ensureVideoThumb(a.url);
      }, { immediate: true });
      /* Hover preview: only one slot previews at a time. The floating preview
         lives INSIDE the slot wrapper, so moving the pointer from the thumbnail
         up into the preview stays within the same DOM subtree (mouseleave on
         the wrapper won't fire) — video/audio keep playing while inspected. */
      const previewKey = ref(null);
      /* Video/audio preview shows only duration + name (mirrors the reference:
         native <audio>/<video> controls are deliberately avoided — no seek bar /
         volume). The hidden player still autoplays; we read duration on metadata. */
      const previewMetaDuration = ref("0:00");
      const onPreviewMeta = (event) => {
        previewMetaDuration.value = fmtTime(event?.target?.duration);
      };
      const onAssetEnter = (slot) => {
        if (!slot?.asset) return;
        previewKey.value = slot.key;
        previewMetaDuration.value = "0:00";
      };
      const onAssetLeave = () => { previewKey.value = null; };

      /* ---- AUDIO generator panel: 4 modes / TWO prompt areas / API bar ----
         The audio generator has a different shape from image & video:
            音乐设计 / 音乐翻唱  → 提示词 + 歌词
            语音设计 / 语音克隆  → 语气   + 朗读文本
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
      const AUDIO_MODES = ["音乐设计", "音乐翻唱", "语音设计", "语音克隆"];
      const audioModes = AUDIO_MODES;
      const isGenAudio = computed(() => isGen && kind.value === "audio");
      const audioMode = computed(() => (AUDIO_MODES.indexOf(data.audioMode) >= 0
        ? data.audioMode : AUDIO_MODES[0]));
      const audioFamily = computed(() => (String(audioMode.value).indexOf("音乐") === 0 ? "music" : "voice"));
      const setAudioMode = (mode) => {
        if (AUDIO_MODES.indexOf(mode) < 0 || mode === audioMode.value) return;
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
      /* Everything else the API exposes belongs on the right of the bottom bar
         (the two text areas already stand for their own fields). */
      const apiBarFields = computed(() => {
        const slots = audioFieldSlots.value;
        const skip = {};
        for (const field of [slots.a, slots.b]) if (field) skip[fieldId(field)] = true;
        return apiFields.value.filter((field) => !skip[fieldId(field)] && BAR_FIELD_TYPES[field.type]);
      });
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
      let fieldsToken = 0;
      const loadApiFields = async () => {
        if (!isGenAudio.value) { apiFields.value = []; return; }
        const name = data.workflow || kind.value;
        const token = ++fieldsToken;
        let list = [];
        try {
          const res = await NS.backend?.call?.("/workflows/" + encodeURIComponent(name) + "/fields");
          list = Array.isArray(res?.fields) ? res.fields.filter((f) => f && f.nodeId && f.key) : [];
        } catch (error) {
          /* Route missing (un-restarted ComfyUI) or no fields file: the two text
             areas keep working through the {{prompt}} / {{lyrics}} placeholders. */
          list = [];
        }
        if (token !== fieldsToken) return;
        apiFields.value = list;
        syncAudioMap();
      };
      watch([isGenAudio, () => data.workflow], () => { loadApiFields(); }, { immediate: true });
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
        const items = mentionItems.value;
        const re = /@(图片|视频|音频)(\d+)\s?/g;
        let html = "";
        let last = 0;
        let hit;
        while ((hit = re.exec(src))) {
          html += escapeText(src.slice(last, hit.index)).replace(/\n/g, "<br>");
          const label = hit[1] + hit[2];
          const item = items.find((entry) => entry.label === label);
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
      watch(isGenVideo, (on) => { if (on) nextTick(renderPrompt); }, { immediate: true });

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
        const items = mentionItems.value;
        const re = /@(图片|视频|音频)(\d+)\s?/g;
        const frag = document.createDocumentFragment();
        let last = 0;
        let hit;
        while ((hit = re.exec(text))) {
          if (hit.index > last) frag.appendChild(document.createTextNode(text.slice(last, hit.index)));
          const label = hit[1] + hit[2];
          frag.appendChild(buildChip(items.find((entry) => entry.label === label)
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
        const item = mentionItems.value.find((entry) => entry.label === chip.dataset.ref);
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
      const toggleSel = (key) => { selOpen.value = selOpen.value === key ? null : key; };
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
      const wfValue = computed(() => data.workflow || "video");
      const wfLabel = computed(() => {
        const hit = wfList.value.find((w) => w.id === wfValue.value);
        return hit ? (hit.name || hit.id) : wfValue.value;
      });
      const sizeLabel = computed(() => {
        const hit = sizePresets.find((s) => s.value === sizeValue.value);
        return hit ? hit.label : (data.width || 512) + "×" + (data.height || 512);
      });
      const onSelOutside = (event) => {
        if (!selOpen.value) return;
        if (event.target?.closest?.(".icn__selwrap")) return;
        selOpen.value = null;
      };
      const onSelKey = (event) => {
        if (!selOpen.value) return;
        if (event.key !== "Escape" && event.key !== "Esc") return;
        /* Swallow it: Vue Flow uses Escape for its own selection handling, which
           would deselect the node and hide the panel just because a list closed. */
        event.stopPropagation();
        event.preventDefault();
        selOpen.value = null;
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
        else NS.api?.toast?.("info", "暂无生成结果");
      };

      /* Per-kind hover actions (image / video / audio / text / gen / empty).
         The tool set itself lives in js/infcanvas-tools.js and the video/audio
         handlers in js/infcanvas-media-tools.js. */
      const actions = computed(() => NS.tools?.actionsFor?.(data) || []);
      /* `button` is the hover-row element: the frame tool opens its three-way
         menu anchored to it, exactly like the reference xcat-ve-menu. */
      const onAction = (key, event) => NS.tools?.run?.(key, {
        id: props.id,
        data,
        url: url.value,
        button: event?.currentTarget || null,
      });

      /* Text nodes render Markdown but enter a source editor on double click,
         exactly like the reference xcat-text-edit.js / xcat-markdown.js pair. */
      const editing = ref(false);
      const draft = ref("");
      const editor = ref(null);
      const setEditor = (element) => { editor.value = element; };
      const textHtml = computed(() => NS.tools?.renderText?.(
        data.text || data.asset?.text || data.asset?.name || "") || "");
      /* Reference xcat-text-edit.js: double click anywhere on the node enters
         the inline textarea, caret goes to the end (not select-all); Esc /
         clicking outside / losing focus exits editing and keeps the text. */
      const startEdit = () => {
        /* Generate nodes keep the asset-node body; their parameters live in the
           panel that appears on selection, so double-click needs no extra edit. */
        if (isGen) return;
        if (kind.value !== "text" || editing.value) return;
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
      const emptyHint = computed(() => "点击上传" + (KIND_LABELS[kind.value] || "素材"));
      const onPicked = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        const fileKind = NS.api?.kindFromFile?.(file.name);
        if (!fileKind) { NS.api?.toast?.("warning", "不支持的文件类型", file.name); return; }
        if (fileKind !== kind.value) {
          NS.api?.toast?.("warning", "文件类型不匹配",
            `「${emptyHint.value}」节点仅接受${KIND_LABELS[kind.value] || kind.value}文件：${file.name}`);
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
          const labels = { image: "图像", video: "视频", audio: "音频", text: "文本" };
          patch({
            kind: nextKind,
            asset,
            text: asset.text || "",
            title: (labels[nextKind] || "素材") + " · " + asset.name,
          });
          NS.api?.toast?.("success", "素材已添加", file.name);
          await nextTick();
          media.install();
          wave.attachMedia();
        } catch (error) {
          NS.api?.toast?.("error", "上传失败", file.name + " · " + String(error));
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
        const targetH = Math.max(80, Math.round(ASSET_DEF_W * naturalH / naturalW));
        /* Auto-fit is the node's own normalisation, not an edit the user made. */
        patch({ fitKey: key, size: [ASSET_DEF_W, targetH] }, { silent: true });
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
        workflows, workflowLabels, sizePresets, sizeValue, setSize,
        isGenVideo, videoModes, videoMode, setVideoMode, modeAvailable, modeReason, incomingAssets, assetSlots, slotHint,
        isGenAudio, audioModes, audioMode, setAudioMode, audioSlots, audioFamily,
        apiFields, apiBarFields, fieldId, fieldValue, setFieldValue,
        previewKey, onAssetEnter, onAssetLeave, previewMetaDuration, onPreviewMeta, videoThumbs, wfList,
        selOpen, toggleSel, pickSel, wfValue, wfLabel, sizeLabel,
        promptEl, mention, mentionItems, closeMention, onPromptInput, hoverMention, pickMention, onPromptKeydown,
        refPreview, refMetaDuration, onRefMeta, onComposeStart, onComposeEnd, onPromptPaste, onRefOver, onRefOut,
        setFileInput, pickFile, onPicked, acceptAttr, emptyHint, onImageLoad, onVideoMeta,
        actions, onAction, editing, draft, setEditor, textHtml, startEdit, commitEdit, onEditKey,
      };
    },
    template: `
      <div class="icn" :class="['icn--' + data.role, { 'is-selected': selected }]" :style="rootStyle"
           @dblclick.stop="startEdit">
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
          </template>
          <!-- Generate nodes never upload: show the reference bundle's plain
               hint instead of a clickable upload button. -->
          <div v-else-if="isGen" class="icn__gen-empty">选择工作流并运行，生成结果会显示在这里</div>
          <button v-else class="icn__empty" type="button" :title="emptyHint" @click="pickFile">
            <IcIcon name="upload" :size="22" />
            <span class="icn__empty-line">{{ emptyHint }}或拖入文件</span>
          </button>
          <input v-if="!isGen" :ref="setFileInput" class="icn__file" type="file"
                 :accept="acceptAttr" @change="onPicked" />

          <div v-if="bar" class="icn__bar nodrag" :ref="media.bar">
            <div class="icn__bar-left">
              <button class="icn__btn icn__btn--play" type="button" @click="media.toggle()" :title="media.playing.value ? '暂停' : '播放'" :aria-label="media.playing.value ? '暂停' : '播放'">
                <IcIcon :name="media.playing.value ? 'pause' : 'play'" :size="14" />
              </button>
              <span class="icn__time">
                <b>{{ media.timeText.value }}</b><i>/</i><b>{{ media.durationText.value }}</b>
              </span>
            </div>
            <div class="icn__slider icn__seek nodrag" tabindex="0" role="slider" aria-label="进度"
                 aria-valuemin="0" aria-valuemax="100">
              <span class="icn__slider-track"></span>
              <span class="icn__slider-fill"></span>
              <span class="icn__slider-thumb"></span>
            </div>
            <span class="icn__vol-group">
              <button class="icn__btn icn__btn--vol" type="button" @click="media.toggleMute()" :title="media.muteIcon.value === 'mute' ? '取消静音' : '静音'" :aria-label="media.muteIcon.value === 'mute' ? '取消静音' : '静音'">
                <IcIcon :name="media.muteIcon.value" :size="15" />
              </button>
              <div class="icn__slider icn__vol nodrag" tabindex="0" role="slider" aria-label="音量"
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
                    :title="modeReason(m) || ('切换到' + m)" type="button"
                    @click.stop="setVideoMode(m)">{{ m }}</button>
          </div>
          <div v-if="assetSlots.length" class="icn__gpv-assets">
            <template v-for="slot in assetSlots" :key="slot.key">
              <div class="icn__gpv-slot" @mouseenter="onAssetEnter(slot)" @mouseleave="onAssetLeave">
                <div class="icn__gpv-asset" :class="{ 'icn__gpv-asset--empty': !slot.asset }"
                     :title="slot.asset ? slot.asset.name : slotHint(slot.kind)">
                  <img v-if="slot.asset && slot.kind === 'image' && slot.asset.url" :src="slot.asset.url" alt="" draggable="false" />
                  <!-- Video thumbnail (real extracted frame) with a play triangle overlaid on top.
                       Before extraction finishes only the triangle shows as a placeholder. -->
                  <template v-else-if="slot.asset && slot.kind === 'video'">
                    <img v-if="videoThumbs[slot.asset.url]" :src="videoThumbs[slot.asset.url]" alt="" draggable="false" />
                    <IcIcon class="icn__gpv-asset-play" name="play" :size="18" />
                  </template>
                  <IcIcon v-else-if="slot.asset" name="sparkles" :size="15" />
                  <IcIcon v-else name="upload" :size="14" />
                  <span v-if="slot.asset" class="icn__gpv-asset-label">{{ slot.asset.label }}</span>
                </div>
                <!-- Hover preview: 160px wide, auto height. Lives in the slot wrapper
                     so moving the pointer into it keeps mouseenter active. Media
                     auto-plays (with sound) while hovered. -->
                <div v-if="slot.asset && slot.asset.url && previewKey === slot.key"
                     class="icn__gpv-preview nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                  <img v-if="slot.kind === 'image'" class="icn__gpv-preview-media" :src="slot.asset.url" alt="" draggable="false" />
                  <!-- Video: picture autoplays (muted loop) but NO native controls.
                       Show only the slot name (视频1), no duration. -->
                  <video v-else-if="slot.kind === 'video'" class="icn__gpv-preview-media" :src="slot.asset.url"
                         autoplay loop playsinline></video>
                  <!-- Audio: hidden player autoplays, no native controls. Show label (音频1)
                       first, then duration, mirroring the reference presentation. -->
                  <template v-else-if="slot.kind === 'audio'">
                    <audio class="icn__gpv-preview-audio-hidden" :src="slot.asset.url"
                           autoplay @loadedmetadata="onPreviewMeta"></audio>
                    <div class="icn__gpv-preview-audio-meta">
                      <span class="icn__gpv-preview-audio-name">{{ slot.asset.label }}</span>
                      <span class="icn__gpv-preview-audio-time">{{ previewMetaDuration }}</span>
                    </div>
                  </template>
                  <div v-if="slot.kind === 'image' || slot.kind === 'video'" class="icn__gpv-preview-name">{{ slot.asset.label }}</div>
                </div>
              </div>
            </template>
          </div>
          <div class="icn__gpv-input">
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
                 data-placeholder="描述你想要生成的内容，并在下方调整生成参数。使用 @ 可快速引用接入的素材。"
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
            <div class="icn__selwrap">
              <button class="icn__sel" :class="{ 'is-open': selOpen === 'wf' }" type="button"
                      title="工作流" @click.stop="toggleSel('wf')">
                <span class="icn__sel-t">{{ wfLabel }}</span>
                <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
              </button>
              <div v-if="selOpen === 'wf'" class="icn__selmenu"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <button v-for="w in wfList" :key="w.id" type="button" class="icn__selitem"
                        :class="{ 'is-on': wfValue === w.id }" @click.stop="pickSel('wf', w.id)">
                  <span class="icn__selitem-t">{{ w.name || w.id }}</span>
                  <IcIcon v-if="wfValue === w.id" class="icn__selitem-check" name="check" :size="14" />
                </button>
              </div>
            </div>
            <div class="icn__selwrap">
              <button class="icn__sel" :class="{ 'is-open': selOpen === 'size' }" type="button"
                      title="生成参数（尺寸）" @click.stop="toggleSel('size')">
                <span class="icn__sel-t">{{ sizeLabel }}</span>
                <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
              </button>
              <div v-if="selOpen === 'size'" class="icn__selmenu"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <button v-for="s in sizePresets" :key="s.value" type="button" class="icn__selitem"
                        :class="{ 'is-on': sizeValue === s.value }" @click.stop="pickSel('size', s.value)">
                  <span class="icn__selitem-t">{{ s.label }}</span>
                  <IcIcon v-if="sizeValue === s.value" class="icn__selitem-check" name="check" :size="14" />
                </button>
              </div>
            </div>
            <button class="icn__gpv-send" type="button"
                    :title="data.status === 'running' ? '正在生成…' : '运行生成'"
                    :disabled="data.status === 'running'" @click.stop="run">运行</button>
          </div>
        </div>

        <!-- AUDIO generator: four modes on top, TWO prompt areas (music: 提示词 +
             歌词 / voice: 语气 + 朗读文本), then the bottom bar — API selector on
             the LEFT, the workflow's EXPOSED API fields on the RIGHT. -->
        <div v-else-if="isGenAudio" class="icn__genpanel icn__gpa nodrag nopan"
             @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="icn__gpv-modes">
            <button v-for="m in audioModes" :key="m" class="icn__gpv-mode"
                    :class="{ 'is-on': audioMode === m }" type="button"
                    :title="'切换到' + m" @click.stop="setAudioMode(m)">{{ m }}</button>
          </div>
          <div class="icn__gpa-inputs">
            <label class="icn__gpa-box">
              <span class="icn__gpa-label">{{ audioSlots.a.label }}</span>
              <textarea class="icn__gpa-area icn__gpa-area--a" :value="data.prompt"
                        :placeholder="audioSlots.a.ph" spellcheck="false"
                        @input="setField('prompt', $event.target.value)"
                        @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
            </label>
            <label class="icn__gpa-box">
              <span class="icn__gpa-label">{{ audioSlots.b.label }}</span>
              <textarea class="icn__gpa-area icn__gpa-area--b" :value="data.lyrics"
                        :placeholder="audioSlots.b.ph" spellcheck="false"
                        @input="setField('lyrics', $event.target.value)"
                        @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop></textarea>
            </label>
          </div>
          <div class="icn__gpa-bar">
            <div class="icn__selwrap">
              <button class="icn__sel" :class="{ 'is-open': selOpen === 'wf' }" type="button"
                      :title="'API（工作流）：' + wfLabel" @click.stop="toggleSel('wf')">
                <span class="icn__sel-t">{{ wfLabel }}</span>
                <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
              </button>
              <div v-if="selOpen === 'wf'" class="icn__selmenu"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <button v-for="w in wfList" :key="w.id" type="button" class="icn__selitem"
                        :class="{ 'is-on': wfValue === w.id }" @click.stop="pickSel('wf', w.id)">
                  <span class="icn__selitem-t">{{ w.name || w.id }}</span>
                  <IcIcon v-if="wfValue === w.id" class="icn__selitem-check" name="check" :size="14" />
                </button>
              </div>
            </div>
            <div class="icn__gpa-right">
              <div v-if="apiBarFields.length" class="icn__gpa-fields">
                <template v-for="f in apiBarFields" :key="fieldId(f)">
                  <div v-if="f.type === 'select'" class="icn__selwrap">
                    <button class="icn__sel icn__gpa-sel" type="button"
                            :class="{ 'is-open': selOpen === 'f:' + fieldId(f) }"
                            :title="f.label + '（当前：' + fieldValue(f) + '）'"
                            @click.stop="toggleSel('f:' + fieldId(f))">
                      <span class="icn__gpa-k">{{ f.label }}</span>
                      <span class="icn__sel-t">{{ fieldValue(f) }}</span>
                      <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
                    </button>
                    <div v-if="selOpen === 'f:' + fieldId(f)" class="icn__selmenu"
                         @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                      <button v-for="opt in (f.options || [])" :key="opt" type="button" class="icn__selitem"
                              :class="{ 'is-on': fieldValue(f) === opt }"
                              @click.stop="pickSel('f:' + fieldId(f), opt)">
                        <span class="icn__selitem-t">{{ opt }}</span>
                        <IcIcon v-if="fieldValue(f) === opt" class="icn__selitem-check" name="check" :size="14" />
                      </button>
                    </div>
                  </div>
                  <button v-else-if="f.type === 'switch'" type="button" class="icn__gpa-pill icn__gpa-sw"
                          :class="{ 'is-on': !!fieldValue(f) }" :title="f.label"
                          @click.stop="setFieldValue(f, !fieldValue(f))">
                    <span class="icn__gpa-k">{{ f.label }}</span>
                    <span class="icn__gpa-v">{{ fieldValue(f) ? '开' : '关' }}</span>
                  </button>
                  <label v-else-if="f.type === 'text' || f.type === 'textarea'"
                         class="icn__gpa-pill" :title="f.label">
                    <span class="icn__gpa-k">{{ f.label }}</span>
                    <input class="icn__gpa-in" :value="fieldValue(f)" spellcheck="false"
                           @change="setFieldValue(f, $event.target.value)"
                           @pointerdown.stop @mousedown.stop @dblclick.stop />
                  </label>
                  <label v-else class="icn__gpa-pill" :title="f.label">
                    <span class="icn__gpa-k">{{ f.label }}</span>
                    <input class="icn__gpa-in icn__gpa-in--num" type="number" :value="fieldValue(f)"
                           :min="f.min" :max="f.max" :step="f.step"
                           @change="setFieldValue(f, Number($event.target.value))"
                           @pointerdown.stop @mousedown.stop @dblclick.stop />
                  </label>
                </template>
              </div>
              <button class="icn__gp-send" type="button"
                      :title="data.status === 'running' ? '正在生成…' : '运行生成'"
                      :disabled="data.status === 'running'" @click.stop="run">运行</button>
            </div>
          </div>
        </div>

        <div v-else-if="isGen" class="icn__genpanel nodrag nopan" @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
          <div class="icn__gp-tabs">
            <button v-for="w in workflows" :key="w" class="icn__gp-tab"
                    :class="{ 'is-on': (data.workflow || kind) === w }"
                    type="button" @click.stop="setField('workflow', w)">{{ workflowLabels[w] }}</button>
          </div>
          <div class="icn__gp-input">
            <textarea :value="data.prompt" @input="setField('prompt', $event.target.value)"
                      placeholder="描述你想要生成的内容，并在下方调整生成参数。" spellcheck="false"></textarea>
            <input class="icn__gp-neg" type="text" :value="data.negative"
                   @input="setField('negative', $event.target.value)" placeholder="负面词（可选）" />
          </div>
          <div class="icn__gp-bar">
            <div class="icn__selwrap">
              <button class="icn__sel" :class="{ 'is-open': selOpen === 'gsize' }" type="button"
                      :title="'尺寸 ' + data.width + ' × ' + data.height" @click.stop="toggleSel('gsize')">
                <span class="icn__sel-t">{{ sizeLabel }}</span>
                <IcIcon class="icn__sel-caret" name="chevron-down" :size="14" />
              </button>
              <div v-if="selOpen === 'gsize'" class="icn__selmenu"
                   @pointerdown.stop @mousedown.stop @dblclick.stop @wheel.stop>
                <button v-for="s in sizePresets" :key="s.value" type="button" class="icn__selitem"
                        :class="{ 'is-on': sizeValue === s.value }" @click.stop="pickSel('gsize', s.value)">
                  <span class="icn__selitem-t">{{ s.label }}</span>
                  <IcIcon v-if="sizeValue === s.value" class="icn__selitem-check" name="check" :size="14" />
                </button>
              </div>
            </div>
            <label class="icn__gp-num" title="seed">
              <span>seed</span>
              <input type="number" :value="data.seed" @change="setField('seed', Number($event.target.value) || 0)" />
            </label>
            <label class="icn__gp-num" title="步数">
              <span>步数</span>
              <input type="number" :value="data.steps" @change="setField('steps', Number($event.target.value) || 20)" />
            </label>
            <button class="icn__gp-send" type="button"
                    :title="data.status === 'running' ? '正在生成…' : '运行生成'"
                    :disabled="data.status === 'running'" @click.stop="run">运行</button>
          </div>
        </div>

        <span class="icn__name">{{ data.title || '节点' }}</span>
        <div class="icn__tools">
          <button v-for="action in actions" :key="action.key" class="icn__tool" type="button"
                  :data-action="action.key" :class="{ 'icn__tool--danger': action.key === 'delete' }"
                  :title="action.tip || action.label" :aria-label="action.tip || action.label"
                  @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="onAction(action.key, $event)">{{ action.label }}</button>
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
        <BaseEdge :id="id" :path="path" class="ic-edge" />
        <circle class="ic-edge-dot" :cx="cx" :cy="cy" r="5"
                @pointerdown.stop @click.stop="cut"></circle>
      </g>
    `,
    components: { BaseEdge },
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
.ic-flow { background:transparent; }
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
.vue-flow__handle { width:10px; height:10px; min-width:10px; min-height:10px; border-radius:50%; background:${ACCENT}; border:0; }
.vue-flow__handle:hover { background:#fff; }
.vue-flow__edge-path.ic-edge { stroke:#7f7f8a; stroke-width:2; }
.vue-flow__edge.selected .vue-flow__edge-path.ic-edge { stroke:#9d9daa; }
/* ---- link centre marker + highlight (ComfyUI pathRenderer.drawCenterMarker /
   highlighted_links). The group is inert; only the dot takes pointer events, so
   clicking the wire itself keeps panning the canvas. ---- */
.ic-edge-g { pointer-events:none; }
.ic-edge-dot { fill:#7f7f8a; stroke:transparent; stroke-width:8; cursor:pointer;
  pointer-events:all; transition:fill .12s ease; }
.ic-edge-dot:hover { fill:#fff; }
/* ComfyUI hides the marker below 60% zoom (drawLink tests scale >= 0.6). */
.ic-flow.is-far .ic-edge-dot { display:none; }
/* Wires of a selected node turn white — same value as colors.highlighted. */
.ic-edge-g.is-hl .vue-flow__edge-path.ic-edge { stroke:#fff; }
.ic-edge-g.is-hl .ic-edge-dot { fill:#fff; }
/* Alt + drag slice preview: the wire reads red until the drag ends. */
.vue-flow__edge.is-cut .vue-flow__edge-path.ic-edge { stroke:#e5484d; }
.vue-flow__edge.is-cut .ic-edge-dot { fill:#e5484d; }
.ic-flow.is-cut-mode .vue-flow__pane { cursor:crosshair; }
/* The Alt-knife stroke: a red core with a soft halo, drawn over the wires. */
.ic-cut-trail { position:absolute; inset:0; width:100%; height:100%;
  pointer-events:none; z-index:9; overflow:visible; }
.ic-cut-trail path { fill:none; stroke:#e5484d; stroke-width:2;
  stroke-linecap:round; stroke-linejoin:round;
  filter:drop-shadow(0 0 3px rgba(229,72,77,.65)); }
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
.icn { position:relative; border-radius:12px; background:var(--ic-node-bg, #262729); color:#ddd; user-select:none;
  box-shadow:0 6px 18px rgba(0,0,0,.35); }
.icn.is-selected { box-shadow:0 0 0 3px #fff, 0 6px 18px rgba(0,0,0,.35); }
.icn__body { position:relative; overflow:hidden; background:var(--ic-node-bg, #262729); }
.icn--asset .icn__body, .icn--text .icn__body, .icn--gen .icn__body { border-radius:12px; }

.icn__name { position:absolute; left:0; bottom:calc(100% + 10px); z-index:30; box-sizing:border-box;
  display:block; height:20px; max-width:calc(100% - 76px); padding:0 8px; border-radius:6px;
  background:#202121; color:#a0a0a0; font-size:12px; line-height:20px;
  box-shadow:0 6px 18px rgba(0,0,0,.35);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; pointer-events:none;
  user-select:none; backdrop-filter:blur(4px); }

.icn__tools { position:absolute; left:0; bottom:100%; width:100%; z-index:30;
  display:flex; align-items:center; justify-content:center; gap:6px; box-sizing:border-box;
  padding:0 0 40px; pointer-events:none; opacity:0; visibility:hidden; transform:translateY(4px);
  transition:opacity .12s ease, transform .12s ease, visibility 0s linear .12s; }
/* The action row belongs to the SELECTED node only: hovering a node no longer
   pops a floating toolbar over its neighbours. Selecting is one click on the
   node itself (or a Ctrl box-select), so the row is still one click away. */
.icn.is-selected .icn__tools {
  opacity:1; visibility:visible; transform:none;
  transition:opacity .12s ease, transform .12s ease, visibility 0s; }
/* 13px matches the reference tool row: the canvas is often zoomed to ~0.7,
   where 11px becomes unreadable. Accent outline = enabled action. */
.icn__tool { pointer-events:auto; min-height:28px; padding:0 9px; border-radius:var(--icnw-r, 6px);
  border:0; background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);
  font-size:13px; line-height:1; white-space:nowrap; cursor:pointer; }
.icn__tool:hover { background:var(--icnw-hover, #3c3d42); color:var(--ic-text, #ffffff); }
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
.icn__text { position:absolute; inset:0; padding:38px 10px 8px; font-size:12px; line-height:1.5;
  color:var(--ic-text, #ffffff); overflow:auto; white-space:pre-wrap; word-break:break-word; }
.icn__text p { margin:0 0 6px; } .icn__text h1, .icn__text h2, .icn__text h3 { margin:4px 0 6px; font-size:14px; }
.icn__text ul, .icn__text ol { margin:4px 0; padding-left:18px; }
.icn__text code { padding:0 3px; border-radius:3px; background:var(--ic-hover, #313235); }
.icn__text a { color:var(--ic-brand, #0b8ce9); }
.icn__text-edit { position:absolute; inset:0; z-index:5; box-sizing:border-box; padding:38px 10px 8px;
  border:0; border-radius:var(--icnw-r, 6px); outline:none; resize:none; cursor:text;
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff); font:12px/1.5 ui-monospace, Consolas, monospace; }
.icn__text-edit:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:6px; padding:0; border:0; border-radius:12px;
  color:#a0a0a0; background:var(--ic-node-bg, #262729); font:inherit; cursor:pointer; }
.icn__file { display:none; }
.icn__empty-line { font-size:12px; white-space:nowrap; }
.icn:hover .icn__empty { color:var(--ic-text, #ffffff); }
/* Generate nodes never upload — plain centered hint (mirrors the reference
   bundle's .xcat-gen-empty). Not clickable, does not accept drop. */
.icn__gen-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  box-sizing:border-box; padding:0 20px; border-radius:12px; background:var(--ic-node-bg, #262729);
  color:#a0a0a0; font-size:13px; line-height:1.6; text-align:center;
  user-select:none; pointer-events:none; }

/* ---- control bar: 1:1 port of the native video controls ----
   This is the bar ComfyUI's Load Video node shows: it renders a plain video
   element with native controls, so everything below is pixel-sampled from a
   real one (480x270 frame at 2x DPR):
     panel    98px tall, NO background (the native black scrim was dropped on
              request: it turned the whole lower third into one dark block and
              made the audio waveform look squeezed into the top of the node)
     row 1    icon row: 24px boxes centred 48px above the bottom edge
     play     triangle 8.5 x 12px, centre x = 24.75 (row padding 12px)
     time     14px white starting at x = 48.5  => 12px gap after the button
     seek     4px capsule, x 16..464 (16px side padding), centred 22px above
              the bottom edge; unplayed rgba(255,255,255,.66), played #fff
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
  color:#fff; touch-action:none; user-select:none; }
.icn__bar-left { position:absolute; left:12px; right:12px; bottom:36px;
  height:24px; display:flex; align-items:center; gap:12px; }
.icn__btn { flex:0 0 24px; width:24px; height:24px; display:inline-flex;
  align-items:center; justify-content:center; padding:0; border:0; border-radius:50%;
  background:transparent; color:#fff; cursor:pointer;
  transition:background-color .12s ease; }
.icn__btn svg { display:block; width:14px; height:14px; color:#fff; }
.icn__btn:hover, .icn__btn:focus-visible { background:rgba(255,255,255,.15); }
/* Volume: hovering the speaker slides the slider out to its LEFT inside one
   pill. The pill is painted by ::before and reserves no layout space, so at
   rest the speaker stays flush with the row's right edge.
   The pill must read as the SAME control as the play button, so it copies its
   hover treatment verbatim: height 24px (the icon-row box height), fully
   rounded ends (radius = half the height, i.e. the same curvature as the
   button's 50%), and the same rgba(255,255,255,.15) wash.
   The left edge is anchored on the slider's leftmost knob CENTRE, not on an
   arbitrary padding: at ratio 0 the 12px knob's centre sits KNOB_INSET (6px)
   inside the slider box, and the pill's own left cap has a 12px radius (half
   the 24px pill). Making the cap concentric with that knob therefore puts the
   pill edge at -(12 - 6) = 6px to the left of the slider box. The right edge
   stops exactly at the group, i.e. 12px off the node edge -- the same inset the
   play disc has on its left. */
.icn__vol-group { position:absolute; right:12px; bottom:36px; height:24px;
  display:inline-flex; flex-direction:row-reverse; align-items:center; gap:0; }
.icn__vol-group::before { content:""; position:absolute; top:0; bottom:0;
  left:-6px; right:0; border-radius:999px; background:transparent;
  transition:background-color .12s ease; pointer-events:none; }
.icn__vol-group:hover::before,
.icn__vol-group:focus-within::before,
.icn__vol-group.is-dragging::before { background:rgba(255,255,255,.15); }
.icn__vol-group > * { position:relative; z-index:1; }
/* The pill is the highlight, so the speaker paints no disc of its own. */
.icn__vol-group .icn__btn--vol,
.icn__vol-group .icn__btn--vol:hover,
.icn__vol-group .icn__btn--vol:focus-visible { background:transparent; }
.icn__vol { width:0; opacity:0; overflow:hidden; transition:width .16s ease, opacity .16s ease; }
.icn__vol-group:hover .icn__vol, .icn__vol-group:focus-within .icn__vol,
.icn__vol:focus-visible { width:60px; opacity:1; margin-right:4px; }
/* The volume track only exists while the pill is open. If the pointer leaves
   the strip mid-drag the :hover rule collapses it back to width:0, and because
   the slider maps clientX against its own width the value would jump to 100%
   ("滑过头"). Pinning the open width for the whole gesture fixes it. */
.icn__vol.is-dragging { width:60px; opacity:1; margin-right:4px; }
.icn__time { flex:0 0 auto; display:inline-flex; align-items:center;
  font-size:13px; font-weight:400; line-height:1; color:#fff;
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.icn__time b { display:inline-block; font-weight:400; }
.icn__time i { font-style:normal; padding:0 4px; }
/* 16px hit area around the 4px visual line. */
.icn__slider { position:relative; flex:0 0 auto; height:16px; cursor:pointer;
  outline:none; touch-action:none; }
.icn__seek { position:absolute; left:16px; right:16px; bottom:14px; height:16px; }
.icn__slider-track, .icn__slider-fill, .icn__slider-thumb { pointer-events:none; }
/* 6px inset on both ends reserves room for the 12px knob, so at ratio 0 / 1 the
   knob sits fully inside the track instead of being half-clipped by the
   overflow:hidden used for the volume expand animation. */
.icn__slider-track, .icn__slider-fill { position:absolute; top:50%; left:6px; right:6px;
  height:4px; margin-top:-2px; border-radius:999px; }
.icn__slider-track { background:${TRACK}; }
/* No transform / will-change here: those promote the fill to its own
   composited layer, which the viewport's scale(zoom) then upscales as a
   bitmap — so it goes blurry when the canvas is zoomed in. */
.icn__slider-fill { background:${BAR_FILL}; right:auto; width:0; }
/* Round knob, revealed on hover / focus only. */
.icn__slider-thumb { position:absolute; top:50%; left:0; width:0; height:0;
  margin:0; border-radius:50%; background:#fff; opacity:0;
  transition:opacity .12s ease; }
.icn__seek:hover .icn__slider-thumb, .icn__seek:focus-visible .icn__slider-thumb,
.icn__vol:hover .icn__slider-thumb, .icn__vol:focus-visible .icn__slider-thumb {
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
.icn__genpanel { position:absolute; left:50%; top:calc(100% + 20px); z-index:24;
  box-sizing:border-box; width:max(100%, 420px);
  display:flex; flex-direction:column; gap:0;
  padding:8px; border-radius:var(--ic-radius, 10px); border:1px solid var(--ic-line, #494a50);
  background:var(--ic-panel, #262729); box-shadow:0 8px 28px rgba(0,0,0,.5); color:var(--ic-text, #ffffff);
  opacity:0; visibility:hidden; transform:translate(-50%, -6px);
  transition:opacity .14s ease, transform .14s ease, visibility 0s linear .14s; }
.icn--gen.is-selected .icn__genpanel { opacity:1; visibility:visible; transform:translateX(-50%);
  transition:opacity .14s ease, transform .14s ease, visibility 0s; }
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
/* Prompt input area */
.icn__gp-input { display:flex; flex-direction:column; gap:6px; margin-bottom:8px; }
.icn__gp-input textarea { box-sizing:border-box; width:100%; height:104px; padding:8px; resize:vertical;
  border:0; border-radius:var(--icnw-r, 6px); outline:none; cursor:text;
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);
  font-family:inherit; font-size:12px; line-height:1.55; text-align:left; }
.icn__gp-input textarea:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gp-input textarea:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__gp-input textarea::placeholder, .icn__gp-neg::placeholder { color:var(--ic-soft, #8a8a8a); }
.icn__gp-neg { box-sizing:border-box; width:100%; height:var(--ic-ctrl-h, 30px); padding:0 8px;
  border:0; border-radius:var(--icnw-r, 6px); outline:none; cursor:text;
  background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff); font:inherit;
  font-size:var(--ic-ctrl-fs, 12px); text-align:left; }
.icn__gp-neg:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gp-neg:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
/* Bottom parameter bar */
.icn__gp-bar { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; }
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
.icn__gp-num { display:inline-flex; align-items:center; gap:4px; height:var(--ic-ctrl-h, 30px); padding:0 8px;
  border-radius:var(--icnw-r, 6px); border:0;
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a); font-size:10px; white-space:nowrap; }
.icn__gp-num:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gp-num input { width:42px; border:0; outline:none; background:transparent; color:var(--ic-text, #ffffff);
  font:inherit; font-size:var(--ic-ctrl-fs, 12px); text-align:right; -moz-appearance:textfield; cursor:text; }
.icn__gp-num input::-webkit-inner-spin-button, .icn__gp-num input::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
.icn__gp-send { flex:0 0 auto; height:var(--ic-ctrl-h, 30px); padding:0 12px; margin-left:0;
  display:inline-flex; align-items:center; justify-content:center; border:0;
  border-radius:8px; background:var(--ic-brand, #0b8ce9); color:#fff;
  font-size:var(--ic-ctrl-fs, 12px); line-height:1; white-space:nowrap; cursor:pointer; }
.icn__gp-send:hover { background:rgba(11,140,233,.9); }
.icn__gp-send:disabled { opacity:.5; cursor:default; }

/* ---- VIDEO generator panel (reference layout) ---- */
.icn__genpanel.icn__gpv { width:max(100%, 460px); padding:10px; }
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
   each one is explicit (提示词/歌词 vs 语气/朗读文本), and the bottom bar wraps
   instead of clipping: a workflow may expose any number of parameters. */
.icn__genpanel.icn__gpa { width:max(100%, 520px); padding:10px; }
.icn__gpa-inputs { display:flex; flex-direction:column; gap:8px; margin-bottom:9px; }
.icn__gpa-box { display:flex; flex-direction:column; gap:4px; min-width:0; }
.icn__gpa-label { font-size:10px; line-height:1.4; color:var(--ic-soft, #8a8a8a); }
.icn__gpa-area { box-sizing:border-box; width:100%; padding:8px; resize:none; border:0; outline:none;
  border-radius:var(--icnw-r, 6px); background:var(--icnw-bg, #313235); color:var(--ic-text, #ffffff);
  font-family:inherit; font-size:12px; line-height:1.55; text-align:left; cursor:text; }
.icn__gpa-area:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gpa-area:focus { box-shadow:0 0 0 1px var(--icnw-ring, #8a8a8a); }
.icn__gpa-area::placeholder { color:var(--ic-soft, #8a8a8a); }
.icn__gpa-area--a { height:76px; }
.icn__gpa-area--b { height:104px; }
.icn__gpa-bar { display:flex; align-items:flex-start; gap:6px; min-width:0; }
/* The API picker never shrinks: the field group wraps instead, so a workflow
   with many parameters can never squeeze the workflow name to "音频面…". */
.icn__gpa-bar > .icn__selwrap { flex:0 0 auto; }
.icn__gpa-right { margin-left:auto; display:flex; align-items:flex-start; gap:6px; min-width:0; }
.icn__gpa-fields { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end;
  gap:6px; min-width:0; }
.icn__gpa-pill { display:inline-flex; align-items:center; gap:5px; box-sizing:border-box;
  height:var(--ic-ctrl-h, 30px); padding:0 8px; border:0; border-radius:var(--icnw-r, 6px);
  background:var(--icnw-bg, #313235); color:var(--ic-soft, #8a8a8a);
  font:inherit; font-size:10px; white-space:nowrap; cursor:text; }
.icn__gpa-pill:hover { background:var(--icnw-hover, #3c3d42); }
.icn__gpa-k { flex:0 0 auto; max-width:76px; overflow:hidden; text-overflow:ellipsis; }
.icn__gpa-in { width:64px; min-width:0; padding:0; border:0; outline:none; background:transparent;
  color:var(--ic-text, #ffffff); font:inherit; font-size:12px; text-align:right; cursor:text; }
.icn__gpa-in--num { width:52px; -moz-appearance:textfield; }
.icn__gpa-in--num::-webkit-inner-spin-button,
.icn__gpa-in--num::-webkit-outer-spin-button { -webkit-appearance:none; margin:0; }
.icn__gpa-sw { cursor:pointer; }
.icn__gpa-v { color:var(--ic-soft, #8a8a8a); font-size:12px; line-height:1; }
.icn__gpa-sw.is-on .icn__gpa-v { color:var(--ic-brand, #0b8ce9); }
/* Exposed select: label + current value (the plain .icn__sel only shows a
   value, which would be ambiguous with several dropdowns in one bar). */
.icn__gpa-sel { max-width:164px; gap:5px; }
.icn__gpa-sel .icn__sel-t { flex:0 1 auto; color:var(--ic-text, #ffffff); }
/* The API picker may carry a full workflow filename (文生音乐：MiniMax Music 3),
   so it gets a wider cap than the shared 172px — still truncated, never
   pushing the field row out of the panel. */
.icn__gpa-bar > .icn__selwrap > .icn__sel { max-width:200px; }

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

  /* -------------------------------- root app ------------------------------ */

  const Root = {
    components: { VueFlow: VueFlowComponent, MiniMap, Background },
    setup() {
      const showMinimap = ref(state.minimap.value);
      const zoomFar = ref(state.viewport.value.zoom < 0.6);   // <60% hides link dots
      const cutMode = ref(false);                             // Alt knife armed
      const mode = state.mode;
      const snap = state.snap;
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

      const onConnect = (params) => {
        /* Wires are ALWAYS accepted. The assets wired in decide which modes
           stay selectable (modeAvailable) — a mode choice never cuts a wire.
           But the SAME source→target pair is de-duplicated: dragging the same
           wire again is a no-op, so it always counts as one connection. */
        const key = String(params.source) + "→" + String(params.target);
        if (state.edges.value.some((e) => edgeKey(e) === key)) return;
        state.edges.value = state.edges.value.concat([{
          id: "e_" + Math.random().toString(36).slice(2, 10),
          source: params.source, sourceHandle: params.sourceHandle || "out",
          target: params.target, targetHandle: params.targetHandle,
          type: "ic",
        }]);
        /* If this new wire makes the generator's ACTIVE mode invalid, fall back
           to 全能参考 (accepts any asset) instead of dropping the connection. */
        const nodes = state.nodes.value;
        const targetNode = nodes.find((n) => n.id === params.target);
        if (isVideoGenData(targetNode?.data)) {
          const mode = targetNode.data.videoMode || "文生视频";
          const counts = incomingKindCounts(params.target, state.edges.value, nodes);
          if (modeReasonFor(mode, counts)) {
            NS.flow?.updateNodeData?.(params.target, { videoMode: "全能参考" });
            NS.api?.toast?.("info", "已切换到全能参考", `当前素材不符合「${mode}」，连线已保留`);
          }
        }
        NS.flow?.markDirty();
      };

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
        NS.flow?.onSelection?.(payload?.nodes || []);
      };

      watch(() => state.minimap.value, (value) => { showMinimap.value = value; });

      /* ---- Alt + left drag slices links (ComfyUI-style canvas knife) --------
         Starting the drag ON the pane means we stopPropagation, so Vue Flow
         never begins a pan and the whole gesture belongs to the knife. Every
         wire the pointer crosses is marked red and removed on release — one
         history entry for the whole slice. */
      const cut = {
        active: false, pointerId: -1, last: null,
        ids: new Set(), samples: new Map(),
        trail: [],                                  // screen-space points
      };
      /* Screen-space path of the slice, drawn while the button is down. */
      const cutTrail = ref("");
      const trailPath = (points) => {
        if (!points.length) return "";
        const [sx, sy] = points[0];
        if (points.length === 1) return `M${sx},${sy} L${sx + 0.01},${sy}`;
        let d = `M${sx},${sy}`;
        for (let i = 1; i < points.length; i += 1) {
          const [px, py] = points[i - 1];
          const [cx, cy] = points[i];
          d += ` Q${px},${py} ${(px + cx) / 2},${(py + cy) / 2}`;
        }
        const [ex, ey] = points[points.length - 1];
        return `${d} L${ex},${ey}`;
      };
      const onAltState = (event) => {
        if (event.key !== "Alt" && event.key !== "AltGraph") return;
        const down = event.type === "keydown"
          && state.mode.value === "select" && !NS.tools?.isOpen?.();
        cutMode.value = down;
        if (!down && cut.active) endCut();
      };
      const samplesOf = (pathEl) => {
        const d = pathEl.getAttribute("d") || "";
        const cached = cut.samples.get(d);
        if (cached) return cached;
        let total = 0;
        try { total = pathEl.getTotalLength(); } catch (error) { return []; }
        const steps = Math.max(8, Math.min(48, Math.round(total / 24)));
        const points = [];
        for (let i = 0; i <= steps; i += 1) {
          const point = pathEl.getPointAtLength((total * i) / steps);
          points.push([point.x, point.y]);
        }
        cut.samples.set(d, points);
        return points;
      };
      /* Squared distance from a point to the drag segment, all in flow space. */
      const segmentDistanceSq = (px, py, ax, ay, bx, by) => {
        const dx = bx - ax, dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        let t = lengthSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
        t = Math.max(0, Math.min(1, t));
        const ox = ax + dx * t - px, oy = ay + dy * t - py;
        return ox * ox + oy * oy;
      };
      const cutTargets = () => hostEl()?.querySelectorAll(".vue-flow__edge-path") || [];
      const hostEl = () => document.querySelector("#infcanvas-vueflow");
      const onCutDown = (event) => {
        if (event.button !== 0 || !event.altKey) return;
        if (state.mode.value === "drag") return;
        if (NS.tools?.isOpen?.()) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest(".vue-flow__pane, .vue-flow__transformationpane, .vue-flow__viewport, .ic-flow")) return;
        if (target.closest(".vue-flow__node, .vue-flow__handle, .ic-panel, .ic-minimap, button, input, textarea, select, [contenteditable]")) return;
        cut.active = true;
        cut.pointerId = event.pointerId;
        cut.ids = new Set();
        cut.samples = new Map();
        cut.last = state.flow?.screenToFlowCoordinate?.({ x: event.clientX, y: event.clientY })
          || { x: 0, y: 0 };
        cutMode.value = true;
        const box = hostEl()?.getBoundingClientRect();
        cut.trail = box ? [[event.clientX - box.left, event.clientY - box.top]] : [];
        cutTrail.value = trailPath(cut.trail);
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener("pointermove", onCutMove, true);
        window.addEventListener("pointerup", endCut, true);
        window.addEventListener("pointercancel", endCut, true);
      };
      const onCutMove = (event) => {
        if (!cut.active) return;
        const now = state.flow?.screenToFlowCoordinate?.({ x: event.clientX, y: event.clientY });
        if (!now) return;
        const last = cut.last || now;
        cut.last = now;
        if (last.x === now.x && last.y === now.y) return;
        /* Paint the slice trail (screen space: the canvas cannot pan while the
           knife is down, so client coords stay valid for the whole stroke). */
        const box = hostEl()?.getBoundingClientRect();
        if (box) {
          const point = [event.clientX - box.left, event.clientY - box.top];
          const tail = cut.trail[cut.trail.length - 1];
          if (!tail || Math.abs(tail[0] - point[0]) + Math.abs(tail[1] - point[1]) > 1.5) {
            cut.trail.push(point);
            cutTrail.value = trailPath(cut.trail);
          }
        }
        const zoom = state.viewport.value.zoom || 1;
        const limit = 9 / zoom;                       // ~9 screen px of slack
        const limitSq = limit * limit;
        cutTargets().forEach((pathEl) => {
          const group = pathEl.closest(".vue-flow__edge");
          const id = group?.getAttribute("data-id");
          if (!id || cut.ids.has(id)) return;
          const hit = samplesOf(pathEl).some(([x, y]) =>
            segmentDistanceSq(x, y, last.x, last.y, now.x, now.y) <= limitSq);
          if (!hit) return;
          cut.ids.add(id);
          group.classList.add("is-cut");
        });
        event.preventDefault();
      };
      function endCut() {
        if (!cut.active) return;
        cut.active = false;
        cutMode.value = false;
        window.removeEventListener("pointermove", onCutMove, true);
        window.removeEventListener("pointerup", endCut, true);
        window.removeEventListener("pointercancel", endCut, true);
        const ids = [...cut.ids];
        cut.ids = new Set();
        cut.samples = new Map();
        cut.last = null;
        cut.trail = [];
        cutTrail.value = "";
        if (ids.length) NS.flow?.removeEdges?.(ids);
      }
      const onAltBlur = () => { cutMode.value = false; };
      onMounted(() => {
        document.addEventListener("pointerdown", onCutDown, true);
        document.addEventListener("keydown", onAltState, true);
        document.addEventListener("keyup", onAltState, true);
        window.addEventListener("blur", onAltBlur);
      });
      onBeforeUnmount(() => {
        endCut();
        document.removeEventListener("pointerdown", onCutDown, true);
        document.removeEventListener("keydown", onAltState, true);
        document.removeEventListener("keyup", onAltState, true);
        window.removeEventListener("blur", onAltBlur);
      });
      /* Undo/redo snapshots are taken by a debounced watcher: any change to the
         node/edge arrays (add, delete, field edit, resize) schedules a commit;
         a drag end has to say so explicitly because Vue Flow keeps the live
         position in its own store. */
      watch([state.nodes, state.edges], () => { NS.flow?.history?.schedule?.(); }, { deep: true });

      return {
        gridCanvas, mode, showMinimap, onInit, onViewportChange, onConnect,
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
        :selection-key-code="mode === 'select' ? 'Control' : false"
        :multi-selection-key-code="['Shift', 'Control', 'Meta']"
        selection-mode="partial"
        :zoom-on-scroll="true" :zoom-on-double-click="false" :prevent-scrolling="true"
        :delete-key-code="null" :fit-view-on-init="false" :elevate-edges-on-select="false"
        :default-edge-options="{ type: 'ic' }"
        :class="['ic-flow', 'mode-' + mode, { 'is-far': zoomFar, 'is-cut-mode': cutMode }]"
        @init="onInit" @viewport-change="onViewportChange" @connect="onConnect"
        @node-drag-stop="onNodeDragStop" @node-click="onNodeClick" @selection-change="onSelectionChange"
      >
        <div v-if="showMinimap" class="ic-minimap-wrap nodrag">
          <div class="ic-minimap">
            <MiniMap :width="253" :height="200" :node-color="miniColor"
                   mask-color="rgba(0,0,0,.55)" :mask-stroke-color="'rgba(255,255,255,.92)'" :mask-stroke-width="2"
                   pannable zoomable />
            <button class="ic-minimap__close" @click="toggleMinimap" aria-label="关闭">
              <svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </VueFlow>
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
    return JSON.stringify({ nodes: state.nodes.value, edges: state.edges.value });
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

    snapshot() {
      /* Positions live in Vue Flow's store, not in our array: pull them back
         before serialising or the saved canvas reopens at the old coordinates. */
      syncLivePositions();
      return {
        nodes: JSON.parse(JSON.stringify(state.nodes.value)),
        edges: JSON.parse(JSON.stringify(state.edges.value)),
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
        if (nodes.length) api.addSelectedNodes(nodes);
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
