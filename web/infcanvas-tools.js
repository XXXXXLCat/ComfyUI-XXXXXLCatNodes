/* Node tools for the embedded infinite canvas.

   Each asset kind gets its own hover action row, mirroring the reference
   project's per-kind tool set (NodeActions.vue + xcat-image-tools.js /
   xcat-video-edit.js / xcat-audio-edit.js):

     image : crop / grid split / mirror / adjust / download / delete
     video : split audio / trim / grab frame / download / delete
     audio : clip / speed / download / delete
     text  : download / delete (+ double click to edit)
     gen   : delete
     empty : delete

   Image tools stay browser-side (Canvas 2D) and write PNGs through the existing
   /infcanvas/upload endpoint. Video/audio tools are implemented in
   infcanvas-media-tools.js and call the FFmpeg endpoints in server_routes.py;
   those need a real ComfyUI restart, hence the readiness probe/banner. The
   image adjustment kernel is ported from the reference project's
   xcat-image-adjust-core.js (itself MIT, derived from @xdadda/mini-gl shaders)
   with the same constants and order.

   Modals are mounted inside #infcanvas-root, NOT document.body: in canvas mode
   ComfyUI hides every body child except our root. ComfyUI's own
   dialog/toast portals stay above us. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* Shared, load-order-independent registry. infcanvas-media-tools.js writes
     the video/audio handlers into the same object. */
  const R = (NS.icRegistry = NS.icRegistry || {});

  const CSS = `
.ict-mask { position:fixed; inset:0; z-index:9999; display:flex; align-items:center;
  justify-content:center; padding:24px; box-sizing:border-box; background:rgba(0,0,0,.66); }
.ict-panel { display:flex; flex-direction:column; max-width:100%; max-height:calc(100vh - 48px);
  box-sizing:border-box; border:1px solid var(--ic-line, #494a50); border-radius:var(--ic-radius-lg, 14px);
  /* Nodes 2.0 tokens, straight from design-system/button.variants.ts + the
     theme vars: the dialog card is bg-background #171718, a secondary button
     is --secondary #262729, its hover is --accent #313235, muted copy is
     --muted-foreground #8a8a8a. --primary-background is ComfyUI's ACCENT,
     not a surface; the shared --ic-brand alias resolves to var(--primary). */
  --icn2-bg:#171718; --icn2-secondary:#262729; --icn2-accent:#313235;
  --icn2-input:#313235; --icn2-fg:#ffffff; --icn2-muted:#8a8a8a;
  --icn2-mutedbg:#3c3d42;
  --icn2-primary:#0b8ce9; --icn2-ring:#8a8a8a; --icn2-r:4px; --icn2-r-md:6px;
  background:var(--icn2-bg); color:var(--ic-text, #ffffff);
  box-shadow:0 24px 70px rgba(0,0,0,.6); font-size:13px; overflow:hidden; }
.ict-head { flex:0 0 auto; display:flex; align-items:baseline; gap:10px; padding:14px 16px 10px;
  border-bottom:1px solid var(--ic-line, #494a50); }
.ict-head h3 { margin:0; font-size:15px; font-weight:600; }
.ict-sub { color:var(--ic-soft, #8a8a8a); font-size:var(--ic-ctrl-fs, 12px); }
.ict-x { margin-left:auto; width:32px; height:32px; border:0; border-radius:8px;
  background:transparent; color:var(--icn2-muted, #8a8a8a); font-size:16px; line-height:1; cursor:pointer;
  transition:background-color .12s ease, color .12s ease; }
.ict-x:hover { background:var(--icn2-accent, #313235); color:var(--icn2-fg, #ffffff); }
.ict-body { flex:1 1 auto; min-height:0; overflow:auto; padding:14px 16px; }
.ict-foot { flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:10px 16px 14px;
  border-top:1px solid var(--ic-line, #494a50); }
.ict-status { flex:1; min-width:0; color:var(--ic-soft, #8a8a8a); font-size:var(--ic-ctrl-fs, 12px);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ict-actions { display:flex; gap:8px; }
/* Nodes 2.0 button = design-system buttonVariants size md (the default used by
   ConfirmationDialogContent / PromptDialogContent): h-8 / rounded-lg / p-2 /
   text-xs / bg-secondary / hover:bg-accent, no border. Footer buttons keep the
   size lg of ConfirmFooter.vue. */
.ict-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px;
  height:32px; padding:0 8px; box-sizing:border-box; border:0; border-radius:8px;
  background:var(--icn2-secondary, #262729); color:var(--icn2-fg, #ffffff);
  font-family:inherit; font-size:12px; font-weight:500; line-height:1; white-space:nowrap;
  cursor:pointer; transition:background-color .12s ease, color .12s ease; }
.ict-btn:hover:not(:disabled) { background:var(--icn2-accent, #313235); }
.ict-btn:focus-visible { outline:none; box-shadow:0 0 0 1px var(--icn2-ring, #8a8a8a); }
.ict-btn:disabled { opacity:.5; cursor:not-allowed; pointer-events:none; }
.ict-btn--primary { background:var(--icn2-primary, #0b8ce9); }
.ict-btn--primary:hover:not(:disabled) { background:rgba(11,140,233,.9); }
.ict-btn.is-active { background:var(--icn2-accent, #313235); color:var(--icn2-fg, #ffffff); }
/* Dialog footer = ConfirmFooter.vue: size lg + variant textonly / muted-textonly,
   the primary action keeps the filled --primary look. */
.ict-actions .ict-btn { height:40px; padding:0 16px; border-radius:var(--ic-radius, 10px);
  background:transparent; color:var(--icn2-muted, #8a8a8a); font-size:14px; }
.ict-actions .ict-btn:hover:not(:disabled) { background:var(--icn2-accent, #313235); }
.ict-actions .ict-btn--primary { background:var(--icn2-primary, #0b8ce9); color:#fff; }
.ict-actions .ict-btn--primary:hover:not(:disabled) { background:rgba(11,140,233,.9); color:#fff; }
/* Body copy = text-xs 12px / muted-foreground; micro copy = text-2xs 10px. */
.ict-hint { margin:8px 0 0; color:var(--icn2-muted, #8a8a8a); font-size:12px; line-height:1.5; }
.ict-label { margin:0 0 6px; color:var(--icn2-muted, #8a8a8a); font-size:12px; }
.ict-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.ict-summary { margin:0; font-size:12px; color:var(--icn2-muted, #8a8a8a); }
.ict-chips { display:flex; flex-wrap:wrap; gap:4px; }
/* Chip = same box as the number field (h 24 / r6 / bg-input #313235 / 12px)
   so a chip row and a number row read as one system; selected goes one step
   brighter (--muted #3c3d42) plus a hairline ring. */
.ict-chip { display:inline-flex; align-items:center; justify-content:center; height:24px; padding:0 8px;
  box-sizing:border-box; border:0; border-radius:var(--icn2-r-md, 6px); background:var(--icn2-input, #313235);
  color:var(--icn2-fg, #ffffff); font-family:inherit; font-size:12px; font-weight:400; line-height:1;
  cursor:pointer; transition:background-color .12s ease, color .12s ease, box-shadow .12s ease; }
.ict-chip:hover { background:var(--icn2-mutedbg, #3c3d42); }
.ict-chip.is-active { background:var(--icn2-mutedbg, #3c3d42);
  box-shadow:inset 0 0 0 1px var(--icn2-ring, #8a8a8a); }
/* Crop ratio chips: equal-width grid so 原图 / 16:9 / 21:9 etc. all align. */
.ict-ratios { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px; }
.ict-ratio { padding:0 4px; text-align:center; box-sizing:border-box; }
/* Nodes 2.0 WidgetInputBaseClass: not-disabled:bg-input (= --accent #313235),
   border-none, rounded-md (6px), text-foreground; height comes from
   useWidgetHeight() which defaults to h-6 (24px). */
.ict-input { height:24px; padding:0 8px; box-sizing:border-box; border:0;
  border-radius:var(--icn2-r-md, 6px); background:var(--icn2-input, #313235); color:var(--icn2-fg, #ffffff);
  font-family:inherit; font-size:12px; line-height:1; }
.ict-input:focus { outline:none; box-shadow:0 0 0 1px var(--icn2-ring, #8a8a8a); }
/* Number field = ComfyUI ScrubableNumberInput (the Nodes 2.0 number widget):
   flex row h-6 overflow-hidden rounded-md bg-input, square aspect-square -/+
   buttons (variant muted-textonly, hover:bg-muted), left aligned 12px input
   with a ew-resize overlay that scrubs the value by drag and selects the text
   on a plain click. */
.ict-num { display:flex; overflow:hidden; height:24px; box-sizing:border-box;
  border-radius:var(--icn2-r-md, 6px); background:var(--icn2-input, #313235);
  color:var(--icn2-fg, #ffffff); font-size:12px; }
.ict-num > button { flex:0 0 auto; width:24px; height:24px; display:inline-flex;
  align-items:center; justify-content:center; padding:0; border:0; border-radius:0;
  background:transparent; color:var(--icn2-muted, #8a8a8a); cursor:pointer;
  transition:background-color .12s ease; }
.ict-num > button:hover:not(:disabled) { background:var(--icn2-mutedbg, #3c3d42); }
.ict-num > button:disabled { opacity:.3; cursor:default; pointer-events:none; }
.ict-num > button svg { display:block; width:16px; height:16px; }
.ict-num > .ict-num-cell { position:relative; flex:1 1 auto; min-width:4ch;
  margin:1px 0; padding:6px 0; }
.ict-num > .ict-num-cell > input { position:absolute; inset:0; width:100%; height:100%;
  margin:0; padding:4px; box-sizing:border-box; border:0; background:transparent;
  color:inherit; text-align:left; font-family:inherit; font-size:12px; line-height:1;
  font-variant-numeric:tabular-nums; outline:none; }
.ict-num > .ict-num-cell > input::-webkit-outer-spin-button,
.ict-num > .ict-num-cell > input::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
.ict-num > .ict-num-cell > input[type=number] { -moz-appearance:textfield; }
.ict-num > .ict-num-cell > input:focus { box-shadow:none; outline:none; }
.ict-num > .ict-num-cell > .ict-num-swipe { position:absolute; inset:0; z-index:1;
  cursor:ew-resize; touch-action:pan-y; }
.ict-num.is-editing > .ict-num-cell > .ict-num-swipe { display:none; }
/* Widget row: slider + number field side by side, exactly like InputSlider.vue
   (Slider w-20 + FormNumberField w-32, flex items-center gap-2). */
.ict-slider-field { display:flex; align-items:center; gap:8px; }
.ict-slider-field input[type=range] { flex:1 1 auto; min-width:0; }
.ict-slider-field .ict-input { flex:0 0 auto; width:112px; }
/* ComfyUI ui/slider: 2px pill track (muted-foreground/20), --muted-foreground
   fill + 14px round thumb. --ict-p is painted from the current value. */
.ict-body input[type=range] { -webkit-appearance:none; appearance:none; width:100%;
  height:14px; margin:0; background:transparent; cursor:pointer; }
.ict-body input[type=range]::-webkit-slider-runnable-track { height:2px; border-radius:999px;
  background:linear-gradient(to right, var(--icn2-muted, #8a8a8a) 0 var(--ict-p, 0%),
    rgba(138,138,138,.2) var(--ict-p, 0%) 100%); }
.ict-body input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:14px; height:14px;
  margin-top:-6px; border:0; border-radius:50%; background:var(--icn2-muted, #8a8a8a);
  box-shadow:0 1px 2px rgba(0,0,0,.35); }
.ict-body input[type=range]:focus-visible { outline:none; }
.ict-body input[type=range]:focus-visible::-webkit-slider-thumb { box-shadow:0 0 0 2px rgba(255,255,255,.22); }
.ict-body input[type=range]::-moz-range-track { height:2px; border-radius:999px; background:rgba(138,138,138,.2); }
.ict-body input[type=range]::-moz-range-progress { height:2px; border-radius:999px; background:var(--icn2-muted, #8a8a8a); }
.ict-body input[type=range]::-moz-range-thumb { width:14px; height:14px; border:0; border-radius:50%;
  background:var(--icn2-muted, #8a8a8a); }
.ict-split { display:grid; grid-template-columns:minmax(0,1fr) 240px; gap:14px; align-items:start; }
.ict-preview { display:flex; align-items:center; justify-content:center; min-height:220px;
  border-radius:var(--ic-radius, 10px); background:#000; overflow:hidden; aspect-ratio:1; }
.ict-preview img { display:block; max-width:100%; max-height:100%; object-fit:contain; }
.ict-preview canvas { display:block; width:100%; height:100%; object-fit:contain; }
.ict-side { display:flex; flex-direction:column; gap:10px; }
.ict-crop-stage { position:relative; display:inline-block; line-height:0; max-width:100%; max-height:100%;
  background:#000; user-select:none; touch-action:none; overflow:hidden; }
.ict-crop-stage img { display:block; max-width:100%; pointer-events:none; }
.ict-crop-frame { position:absolute; box-sizing:border-box; border:1px solid #fff;
  box-shadow:0 0 0 9999px rgba(0,0,0,.55); cursor:move; }
.ict-crop-frame::before { content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(to right, transparent 33.2%, rgba(255,255,255,.35) 33.2%, rgba(255,255,255,.35) 33.5%, transparent 33.5%, transparent 66.4%, rgba(255,255,255,.35) 66.4%, rgba(255,255,255,.35) 66.7%, transparent 66.7%),
             linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,.35) 33.2%, rgba(255,255,255,.35) 33.5%, transparent 33.5%, transparent 66.4%, rgba(255,255,255,.35) 66.4%, rgba(255,255,255,.35) 66.7%, transparent 66.7%); }
.ict-handle { position:absolute; width:9px; height:9px; border:1px solid #fff; border-radius:2px;
  background:var(--ic-brand, #0b8ce9); }
.ict-h-nw { left:-5px; top:-5px; cursor:nwse-resize; } .ict-h-n { left:calc(50% - 5px); top:-5px; cursor:ns-resize; }
.ict-h-ne { right:-5px; top:-5px; cursor:nesw-resize; } .ict-h-e { right:-5px; top:calc(50% - 5px); cursor:ew-resize; }
.ict-h-se { right:-5px; bottom:-5px; cursor:nwse-resize; } .ict-h-s { left:calc(50% - 5px); bottom:-5px; cursor:ns-resize; }
.ict-h-sw { left:-5px; bottom:-5px; cursor:nesw-resize; } .ict-h-w { left:-5px; top:calc(50% - 5px); cursor:ew-resize; }
.ict-grid-overlay { position:absolute; inset:0; pointer-events:none; }
.ict-cell { position:absolute; box-sizing:border-box; border:1px dashed rgba(255,255,255,.7);
  color:#fff; font-size:11px; line-height:1; padding:3px; text-shadow:0 1px 3px #000; }
.ict-4 { display:grid; grid-template-columns:1fr; gap:8px; }
.ict-4 label { display:flex; align-items:center; gap:6px; font-size:12px;
  color:var(--icn2-muted, #8a8a8a); }
.ict-4 .ict-input { width:100%; min-width:0; }
.ict-adjust { display:grid; grid-template-columns:minmax(0,1fr) 240px; gap:14px; align-items:start; }
.ict-slider { display:grid; grid-template-columns:74px minmax(0,1fr) 44px; align-items:center; gap:8px;
  font-size:12px; color:var(--icn2-muted, #8a8a8a); }
.ict-slider output { text-align:right; font-variant-numeric:tabular-nums; color:var(--icn2-fg, #ffffff); }
.ict-slider output.is-changed { color:var(--icn2-primary, #0b8ce9); }
.ict-wave { display:block; width:100%; height:150px; border-radius:var(--ic-radius, 10px); background:#232428; }
.ict-seg { display:grid; grid-template-columns:1fr 1fr auto; gap:6px; align-items:center; margin-top:6px; }
.ict-seg .ict-input { width:100%; }
.ict-media-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
.ict-time-row { display:grid; grid-template-columns:70px minmax(0,1fr) 70px; align-items:center; gap:8px; margin:10px 0; }
.ict-time-row input[type=range] { width:100%; }
.ict-list { max-height:190px; overflow:auto; display:flex; flex-direction:column; gap:6px; }
/* ---- backend readiness / progress / anchored menu (reference: core.createProbe,
   progressModal, xcat-ve-menu) ---- */
.ict-warn { margin:10px 16px 0; padding:9px 11px; border-radius:var(--ic-radius, 10px); font-size:var(--ic-ctrl-fs, 12px); line-height:1.6;
  border:1px solid var(--ic-danger, #b33a3a); background:var(--ic-danger-soft, rgba(179,58,58,.16));
  color:var(--ic-danger, #b33a3a); }
.ict-warn[hidden] { display:none; }
.ict-warn strong { font-weight:700; }
.ict-status.is-error { color:var(--ic-danger, #b33a3a); }
.ict-progress { min-width:320px; min-height:112px; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:14px; }
.ict-spinner { width:28px; height:28px; box-sizing:border-box; border-radius:50%;
  border:3px solid rgba(255,255,255,.18); border-top-color:var(--ic-brand, #0b8ce9);
  animation:ict-spin .8s linear infinite; }
@keyframes ict-spin { to { transform:rotate(360deg); } }
.ict-progress-text { font-size:var(--ic-ctrl-fs, 12px); color:var(--ic-soft, #8a8a8a); }
/* ---- video trim: preview + 10 thumbs + two handles + ruler ---- */
.ict-video-preview { display:flex; justify-content:center; padding:8px; border-radius:var(--ic-radius, 10px); background:#000; }
.ict-video-preview video { display:block; max-width:100%; max-height:280px; }
.ict-tl { margin-top:12px; }
.ict-tl-head { display:flex; justify-content:space-between; margin-bottom:6px; font-size:12px;
  color:var(--icn2-muted, #8a8a8a); }
.ict-track { position:relative; height:64px; border:0;
  border-radius:var(--icn2-r-md, 6px); overflow:hidden; background:#111; touch-action:none; user-select:none; cursor:pointer; }
.ict-strip { position:absolute; inset:0; display:flex; }
.ict-strip img { flex:1 1 0; width:0; min-width:0; height:100%; object-fit:cover; opacity:.85; }
.ict-strip i { flex:1 1 0; background:var(--ic-panel, #262729); }
.ict-tl-mask { position:absolute; top:0; bottom:0; background:rgba(0,0,0,.6); pointer-events:none; }
.ict-tl-sel { position:absolute; top:0; bottom:0; box-sizing:border-box; border:1px solid var(--ic-brand, #0b8ce9);
  pointer-events:none; }
.ict-tl-playhead { position:absolute; top:0; bottom:0; width:2px; background:#fff; pointer-events:none; }
.ict-tl-handle { position:absolute; top:0; bottom:0; width:12px; margin-left:-6px; padding:0; border:0;
  background:transparent; cursor:ew-resize; z-index:2; }
.ict-tl-handle span { position:absolute; top:50%; left:2px; width:8px; height:26px;
  transform:translateY(-50%); border-radius:4px; background:var(--ic-brand, #0b8ce9); border:1px solid #fff; }
.ict-tl-ruler { display:flex; justify-content:space-between; margin-top:5px; font-size:10px;
  font-variant-numeric:tabular-nums; color:var(--icn2-muted, #8a8a8a); }
.ict-times { display:flex; gap:12px; align-items:center; margin-top:12px; font-size:12px;
  color:var(--icn2-muted, #8a8a8a); }
.ict-times label { display:flex; align-items:center; gap:6px; }
.ict-times .ict-input { width:112px; }
.ict-times .ict-length { margin-left:auto; }
/* ---- audio clip: waveform + segment editor ---- */
.ict-clip-tl { position:relative; }
.ict-clip-stage { position:relative; }
.ict-clip-wave { display:block; width:100%; height:120px; border-radius:var(--ic-radius, 10px) 8px 0 0; background:#232428; }
.ict-clip-ruler { position:relative; height:16px; font-size:10px; line-height:16px;
  color:var(--icn2-muted, #8a8a8a); font-variant-numeric:tabular-nums; }
.ict-clip-ruler span { position:absolute; transform:translateX(-50%); }
/* End labels stay inside the frame instead of hanging over the padding. */
.ict-clip-ruler span:first-child { transform:none; }
.ict-clip-ruler span:last-child { transform:translateX(-100%); }
.ict-clip-track { position:relative; height:34px; border-radius:0 0 6px 6px;
  background:rgba(255,255,255,.05); overflow:hidden; }
/* Segment buttons follow the same Nodes 2.0 secondary contract: flat #262729
   chip, hover --accent, selected = filled --primary. */
.ict-clip-seg { position:absolute; top:3px; bottom:3px; box-sizing:border-box; border:0;
  border-radius:var(--icn2-r, 4px); background:var(--icn2-secondary, #262729);
  color:var(--icn2-muted, #8a8a8a); font-family:inherit; font-size:10px; font-weight:500;
  padding:0 6px; overflow:hidden; text-align:left; white-space:nowrap; text-overflow:ellipsis;
  cursor:pointer; transition:background-color .12s ease, color .12s ease; }
.ict-clip-seg:hover { background:var(--icn2-accent, #313235); color:var(--icn2-fg, #ffffff); }
.ict-clip-seg.is-selected { background:var(--icn2-primary, #0b8ce9); color:#fff; }
/* The white playhead line is itself the drag handle: hovering it shows the
   left/right arrows (ew-resize), pressing and dragging it scrubs the playhead
   along the waveform — exactly like the reference clip editor. */
.ict-clip-head { position:absolute; top:0; bottom:0; width:2px; background:#fff;
  pointer-events:auto; cursor:ew-resize; z-index:3; }
.ict-clip-head::after { content:""; position:absolute; left:-7px; right:-7px; top:-2px; bottom:-2px; }
.ict-clip-head::before { content:"\u2039  \u203A"; position:absolute; top:2px; left:50%;
  transform:translateX(-50%); background:#fff; color:#111; font-size:9px; line-height:14px;
  padding:0 5px; border-radius:var(--ic-ctrl-r, 7px); white-space:nowrap; opacity:0; pointer-events:none;
  transition:opacity .1s ease; }
.ict-clip-head:hover::before, .ict-clip-head.dragging::before,
.ict-clip-stage.is-scrubbing .ict-clip-head::before { opacity:1; }
.ict-clip-stage.is-scrubbing { cursor:ew-resize; }
.ict-toolrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px; }
.ict-toolrow .ict-sep { width:1px; height:20px; background:var(--ic-line, #494a50); }
.ict-toolrow .ict-hint { margin:0 0 0 auto; font-size:10px; }
.ict-player { display:flex; align-items:center; gap:10px; margin-top:10px; font-size:12px; }
.ict-player .ict-play { width:32px; padding:0; font-size:12px; }
.ict-player time { font-variant-numeric:tabular-nums; color:var(--icn2-muted, #8a8a8a); }
.ict-player time b { color:var(--icn2-fg, #ffffff); font-weight:500; }
.ict-player .ict-hint { margin:0; }
/* ---- grid presets / mirror buttons ---- */
/* Tile / list buttons: secondary surface #262729, hover --accent #313235,
   selected = accent + 1px --ring inset (ComfyUI toggle group look). */
.ict-grid-presets { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:8px; }
.ict-grid-preset { display:flex; flex-direction:column; align-items:center; gap:4px; padding:8px 4px;
  border:0; border-radius:var(--icn2-r-md, 6px); background:transparent;
  color:var(--icn2-muted, #8a8a8a); font-family:inherit; font-size:12px; cursor:pointer;
  transition:background-color .12s ease, color .12s ease; }
.ict-grid-preset:hover { background:rgba(38,39,41,.5); color:var(--icn2-fg, #ffffff); }
.ict-grid-preset.is-active { background:var(--icn2-secondary, #262729); color:var(--icn2-fg, #ffffff); }
.ict-grid-preset i { display:grid; gap:2px; width:30px; height:30px; }
.ict-grid-preset i b { border-radius:1px; background:currentColor; opacity:.7; }
.ict-grid-custom-btn { display:flex; align-items:center; justify-content:center; width:100%; height:32px; margin-top:8px;
  border:0; border-radius:8px; background:var(--icn2-secondary, #262729);
  color:var(--icn2-fg, #ffffff); font-family:inherit; font-size:12px; font-weight:500; cursor:pointer;
  transition:background-color .12s ease, color .12s ease; }
.ict-grid-custom-btn:hover { background:var(--icn2-accent, #313235); }
.ict-grid-custom-btn.is-active { background:var(--icn2-accent, #313235); }
.ict-grid-custom { display:flex; flex-direction:column; gap:10px; margin-top:10px; }
.ict-grid-custom[hidden] { display:none; }
.ict-grid-slider-row { display:grid; grid-template-columns:32px minmax(0,1fr) 22px; align-items:center; gap:8px;
  font-size:12px; color:var(--icn2-muted, #8a8a8a); }
.ict-grid-slider-row input[type=range] { width:100%; }
.ict-grid-slider-row output { text-align:center; font-variant-numeric:tabular-nums; color:var(--icn2-fg, #ffffff); }
.ict-mirror-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px; }
.ict-mirror-btn { display:flex; align-items:center; gap:8px; height:32px; padding:0 10px;
  box-sizing:border-box; border:0; border-radius:var(--icn2-r-md, 6px); background:var(--icn2-secondary, #262729);
  color:var(--icn2-fg, #ffffff); font-family:inherit; font-size:12px; cursor:pointer; text-align:left;
  transition:background-color .12s ease; }
.ict-mirror-btn:hover, .ict-mirror-btn:focus-visible { background:var(--icn2-accent, #313235); outline:none; }
.ict-mirror-btn.is-wide { grid-column:span 2; }
.ict-mirror-btn svg { flex:0 0 auto; }
.ict-mirror-preview img { max-height:100%; transition:transform .15s ease; }
.ict-lut-block { margin-top:2px; padding-top:12px; border-top:1px solid var(--ic-line, #494a50);
  display:flex; flex-direction:column; gap:8px; }
.ict-lut-file { display:flex; align-items:center; gap:6px; }
.ict-lut-file input[type=file] { display:none; }
.ict-lut-name { margin:0; font-size:12px; color:var(--icn2-fg, #ffffff); overflow-wrap:anywhere; }
.ict-lut-name.is-empty { color:var(--icn2-muted, #8a8a8a); }
.ict-lut-strength { display:grid; grid-template-columns:40px minmax(0,1fr) 40px; align-items:center;
  gap:8px; font-size:12px; color:var(--icn2-muted, #8a8a8a); }
.ict-lut-strength input[type=range] { width:100%; }
.ict-lut-strength output { text-align:right; font-variant-numeric:tabular-nums; color:var(--icn2-fg, #ffffff); }
.ict-lut-detail { display:flex; flex-direction:column; gap:8px; }
.ict-lut-detail[hidden] { display:none; }
`;

  function injectStyles() {
    if (document.querySelector("#infcanvas-tools-style")) return;
    const style = document.createElement("style");
    style.id = "infcanvas-tools-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const toast = (kind, summary, detail = "") => {
    if (NS.api?.toast) NS.api.toast(kind, summary, detail);
    else console.log("[InfCanvas tools]", kind, summary, detail);
  };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = (v) => clamp(v, 0, 1);
  /* Nodes 2.0 sliders draw a filled track; a bare range input cannot, so the
     current value is written into --ict-p and the track gradient uses it. */
  const paintRange = (input) => {
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const value = Number(input.value || 0);
    const ratio = max > min ? clamp01((value - min) / (max - min)) : 0;
    input.style.setProperty("--ict-p", (ratio * 100).toFixed(2) + "%");
  };
  const paintRanges = (root) => {
    root?.querySelectorAll?.('input[type="range"]').forEach(paintRange);
  };
  /* ComfyUI Nodes 2.0 的数字控件是 ScrubableNumberInput：一条 24px 高的
     bg-input 行，左右是 aspect-square 的正方形按钮（hover 才浮出 --muted），
     中间是左对齐的 12px 输入框，上面盖一层 ew-resize 的拖动层——
     拖动按 10px 一格改值，单击不拖则全选文本。这里把普通 number 输入
     就地包装成同样的结构，模板不必重复写三件套。 */
  const STEP_ICONS = {
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  };
  function decorateNumberFields(root) {
    root?.querySelectorAll?.('input[type="number"]').forEach((input) => {
      if (input.closest(".ict-num")) return;
      const width = Math.round(input.getBoundingClientRect().width);
      const step = () => Number(input.step) || 1;
      const precision = () => String(input.step || "1").split(".")[1]?.length || 0;
      const value = () => {
        const n = Number(input.value);
        return Number.isFinite(n) ? n : 0;
      };
      const format = (n) => {
        const prec = precision();
        return prec > 0 ? n.toFixed(prec) : String(n);
      };
      const write = (next, quiet) => {
        const lo = input.min === "" ? -Infinity : Number(input.min);
        const hi = input.max === "" ? Infinity : Number(input.max);
        input.value = format(Math.min(hi, Math.max(lo, next)));
        if (quiet) return;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const wrap = document.createElement("span");
      wrap.className = "ict-num";
      wrap.style.width = (width > 0 ? width : 112) + "px";

      const makeButton = (dir, label, icon) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ict-num-" + (dir < 0 ? "dec" : "inc");
        btn.setAttribute("aria-label", label);
        btn.tabIndex = -1;
        btn.innerHTML = icon;
        btn.addEventListener("click", () => {
          if (input.disabled) return;
          write(value() + dir * step());
        });
        return btn;
      };

      const cell = document.createElement("span");
      cell.className = "ict-num-cell";
      const swipe = document.createElement("span");
      swipe.className = "ict-num-swipe";

      let startX = 0, startValue = 0, ticks = 0, moved = false, active = false;
      swipe.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || input.disabled) return;
        active = true; moved = false; ticks = 0;
        startX = event.clientX; startValue = value();
        try { swipe.setPointerCapture(event.pointerId); } catch (e) { /* optional */ }
      });
      swipe.addEventListener("pointermove", (event) => {
        if (!active) return;
        const dx = event.clientX - startX;
        if (!moved && Math.abs(dx) < 3) return;
        moved = true;
        /* ComfyUI: delta = (distanceX - dragDelta) / 10, value - delta * step */
        const next = Math.trunc(dx / 10);
        if (next === ticks) return;
        ticks = next;
        write(startValue - ticks * step());
      });
      const finishSwipe = () => {
        if (!active) return;
        active = false;
        if (moved) return;
        wrap.classList.add("is-editing");
        input.focus();
        input.select();
      };
      swipe.addEventListener("pointerup", finishSwipe);
      swipe.addEventListener("pointercancel", () => { active = false; });

      let last = input.value;
      input.addEventListener("blur", () => {
        wrap.classList.remove("is-editing");
        const raw = input.value.trim();
        if (raw === "" || !Number.isFinite(Number(raw))) { input.value = last; return; }
        write(Number(raw), true);
        last = input.value;
      });

      input.replaceWith(wrap);
      cell.append(input, swipe);
      wrap.append(makeButton(-1, t("减小"), STEP_ICONS.minus), cell,
        makeButton(1, t("增大"), STEP_ICONS.plus));
    });
  }
  const fmtTime = (seconds) => {
    const s = Math.max(0, Number(seconds) || 0);
    return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  };
  const stemOf = (name) => String(name || "asset").replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "asset";

  function canvasBlob(canvas, type = "image/png") {
    return new Promise((resolve, reject) => canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob 失败"))), type));
  }
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片加载失败：" + url));
      img.src = url;
    });
  }
  function drawToCanvas(img, w = img.naturalWidth, h = img.naturalHeight) {
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas;
  }

  /* ------------------------------- modal -------------------------------- */

  let modal = null;
  let menu = null;

  function closeMenu() {
    if (!menu) return;
    if (menu.raf) cancelAnimationFrame(menu.raf);
    menu.el.remove();
    document.removeEventListener("pointerdown", onMenuOutside, true);
    document.removeEventListener("keydown", onMenuKey, true);
    menu = null;
  }
  function onMenuOutside(event) {
    if (menu && !menu.el.contains(event.target)) closeMenu();
  }
  function onMenuKey(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
  }
  /* Anchored dropdown (node/group context menu, selection arrange, frame menu).
     Shares the EXACT `.ic-menu` surface the double-click add-node menu uses:
     same classes, same ComfyUI tokens, same 14px type, and it lives on the
     screen-space layer OUTSIDE the scaled pane. Unlike the old `.ict-menu` it
     never scales with canvas zoom, so every menu in the canvas looks identical.
     Closes on outside pointerdown / Escape, never on a backdrop click. */
  function openMenu(anchor, items) {
    closeMenu();
    const host = document.getElementById("infcanvas-root") || document.body;
    const el = document.createElement("div");
    el.className = "ic-menu";
    el.setAttribute("role", "menu");
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "ic-menu-sep";
        el.appendChild(sep);
        continue;
      }
      if (item.section) {
        const section = document.createElement("div");
        section.className = "ic-menu-section";
        section.textContent = item.section;
        el.appendChild(section);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ic-menu-item";
      button.setAttribute("role", "menuitem");
      if (item.disabled) { button.disabled = true; button.setAttribute("aria-disabled", "true"); }
      const label = document.createElement("span");
      label.className = "ic-menu-label";
      label.textContent = item.label;
      button.appendChild(label);
      if (item.value) {
        const value = document.createElement("span");
        value.className = "ic-menu-value";
        value.textContent = item.value;
        button.appendChild(value);
      }
      button.addEventListener("click", () => { const pick = item.onPick; closeMenu(); if (!item.disabled) pick?.(); });
      el.appendChild(button);
    }
    host.appendChild(el);
    /* Screen-space fixed: no zoom transform, so glyphs stay 14px like every
       other `.ic-menu`. Anchoring follows the button's live screen rect so the
       menu still tracks pan/zoom while open. */
    menu = { el, raf: 0 };
    const place = () => {
      if (!menu || menu.el !== el) return;
      const box = anchor.getBoundingClientRect();
      const width = el.offsetWidth || 192;
      el.style.left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8)) + "px";
      el.style.top = (box.bottom + 6) + "px";
      menu.raf = requestAnimationFrame(place);
    };
    place();
    for (const type of ["pointerdown", "mousedown", "dblclick", "click", "wheel", "contextmenu"]) {
      el.addEventListener(type, (event) => event.stopPropagation());
    }
    setTimeout(() => {
      if (!menu) return;
      document.addEventListener("pointerdown", onMenuOutside, true);
      document.addEventListener("keydown", onMenuKey, true);
    }, 0);
    return el;
  }

  function closeModal() {
    closeMenu();
    if (!modal) return;
    const { mask, onClose } = modal;
    modal = null;
    if (mask?.parentElement) mask.parentElement.removeChild(mask);
    try { onClose?.(); } catch (error) { /* optional */ }
  }

  /* options:
       title/sub/width, warn (HTML), progress (spinner dialog),
       applyLabel (null = no apply button), cancelLabel, extraFoot[],
       build(body, ui), onApply(ui), run(ui) (start immediately), onClose().
     ui: setStatus / setBusy / setApplyEnabled / setWarn / apply / close / signal.
     Mirrors the reference .xcat-ae-modal shell: head + optional readiness
     banner + body + status/actions footer. */
  function openModal(options = {}) {
    closeModal();
    const host = document.getElementById("infcanvas-root") || document.body;
    const mask = document.createElement("div");
    mask.className = "ict-mask";
    const panel = document.createElement("div");
    panel.className = "ict-panel";
    panel.style.width = (options.width || 760) + "px";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", options.title || t("工具"));

    const head = document.createElement("div");
    head.className = "ict-head";
    head.innerHTML = `<h3></h3><span class="ict-sub"></span><button class="ict-x" type="button" title="${t("关闭")}">×</button>`;
    head.querySelector("h3").textContent = options.title || t("工具");
    head.querySelector(".ict-sub").textContent = options.sub || "";

    let warnEl = null;
    if (options.warn) {
      warnEl = document.createElement("div");
      warnEl.className = "ict-warn";
      warnEl.innerHTML = options.warn;
      warnEl.hidden = true;
    }

    const body = document.createElement("div");
    body.className = "ict-body" + (options.progress ? " ict-progress" : "");
    let progressText = null;
    if (options.progress) {
      body.innerHTML = `<div class="ict-spinner"></div><div class="ict-progress-text"></div>`;
      progressText = body.querySelector(".ict-progress-text");
      progressText.textContent = options.progressText || t("正在处理，请稍候…");
    }

    const foot = document.createElement("div");
    foot.className = "ict-foot";
    const status = document.createElement("span");
    status.className = "ict-status";
    const actions = document.createElement("div");
    actions.className = "ict-actions";
    const extraButtons = [];
    for (const item of options.extraFoot || []) {
      const button = document.createElement("button");
      button.className = "ict-btn" + (item.className ? " " + item.className : "");
      button.type = "button";
      button.textContent = item.label;
      button.addEventListener("click", () => item.onClick?.(ui));
      extraButtons.push(button);
      actions.appendChild(button);
    }
    const cancelLabel = options.cancelLabel || t("取消");
    const applyLabel = options.applyLabel === null ? null : (options.applyLabel || t("应用"));
    const cancel = document.createElement("button");
    cancel.className = "ict-btn"; cancel.type = "button"; cancel.textContent = cancelLabel;
    actions.appendChild(cancel);
    let apply = null;
    if (applyLabel && !options.progress) {
      apply = document.createElement("button");
      apply.className = "ict-btn ict-btn--primary"; apply.type = "button";
      apply.textContent = applyLabel;
      if (options.applyDisabled) apply.disabled = true;
      actions.appendChild(apply);
    }
    foot.append(status, actions);
    panel.append(head, ...(warnEl ? [warnEl] : []), body, foot);
    mask.appendChild(panel);
    host.appendChild(mask);

    const controller = new AbortController();
    let busy = false;
    /* The reference keeps an apiReady flag and ANDs it into every render pass
       (`run.disabled = !valid() || busy || !apiReady`). Keeping it in the shell
       means a later paint()/render() cannot re-enable Apply behind the
       "backend not restarted" banner, and no tool has to remember it. */
    let apiReady = true;
    let applyEnabled = options.applyDisabled ? false : true;
    const refreshApply = () => {
      if (apply && !busy) apply.disabled = !applyEnabled || !apiReady;
    };
    const ui = {
      body, panel, mask, signal: controller.signal,
      setStatus(text, isError = false) {
        /* `loadedmetadata` clears the status after preflight; keep the
           readiness error visible when the backend is still an old process. */
        if (!text && !apiReady && status.classList.contains("is-error")) return;
        status.textContent = text || "";
        status.classList.toggle("is-error", !!isError);
      },
      setBusy(value) {
        busy = !!value;
        if (apply) {
          apply.disabled = busy || !applyEnabled || !apiReady;
          apply.textContent = busy ? t("处理中…") : applyLabel;
        }
        cancel.textContent = busy ? t("取消处理") : cancelLabel;
        for (const button of extraButtons) button.disabled = busy;
      },
      setApplyEnabled(enabled) { applyEnabled = !!enabled; refreshApply(); },
      setApiReady(ready) {
        apiReady = !!ready;
        if (warnEl) warnEl.hidden = apiReady;
        refreshApply();
      },
      setWarn(ready) { if (warnEl) warnEl.hidden = !!ready; },
      setProgressText(text) { if (progressText) progressText.textContent = text; },
      /* Lets a tool repaint the slider fills after it moves a range in JS. */
      paintRanges() { paintRanges(body); },
      abort() { controller.abort(); },
      close: closeModal,
    };
    modal = { mask, onClose: options.onClose };

    head.querySelector(".ict-x").addEventListener("click", () => {
      if (busy) controller.abort();
      closeModal();
    });
    cancel.addEventListener("click", () => {
      if (busy) controller.abort();
      closeModal();
    });

    async function doApply() {
      if (!options.onApply || busy) return;
      ui.setBusy(true);
      try {
        await options.onApply(ui);
        closeModal();
      } catch (error) {
        if (error?.name === "AbortError") { closeModal(); return; }
        console.error("[InfCanvas tools]", error);
        toast("error", t("操作失败"), String(error?.message || error));
        ui.setStatus(String(error?.message || error), true);
        ui.setBusy(false);
      }
    }
    ui.apply = doApply;
    apply?.addEventListener("click", doApply);

    /* The canvas owns document-level keydown (capture) and Vue Flow owns
       wheel/dblclick. Keep every modal gesture local. Backdrop clicks do NOT
       close (the reference avoids a second click landing on the canvas). */
    const swallow = (event) => event.stopPropagation();
    for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick",
                        "wheel", "contextmenu", "pointermove", "keydown", "keyup",
                        "paste", "drop", "dragover"]) {
      mask.addEventListener(type, swallow, false);
    }
    mask.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeModal(); }
    });
    try { options.build?.(body, ui); } catch (error) { console.error("[InfCanvas tools] build", error); }
    /* ComfyUI's Slider paints its fill with a range element, we have no
       SliderRange node, so the value is mirrored into --ict-p for the track
       gradient. Sliders are created by build(), hence the paint here. */
    decorateNumberFields(body);
    paintRanges(body);
    body.addEventListener("input", (event) => {
      if (event.target?.type === "range") paintRange(event.target);
    });
    body.addEventListener("change", (event) => {
      if (event.target?.type === "range") paintRange(event.target);
    });
    if (options.run) Promise.resolve().then(() => options.run(ui));
    if (!options.progress) {
      const focus = body.querySelector("input, textarea, button");
      focus?.focus?.();
    }
    return ui;
  }

  /* --------------------------- result plumbing --------------------------- */

  /* Place a result next to the source node, but always inside the visible
     area (the reference buildResultNodes/placeClear rule: off-screen nodes get
     dropped by Vue Flow). core.freeSpot() does exactly that search. */
  function resultPosition(ctx, index = 0) {
    const src = NS.flow?.findNode?.(ctx.id);
    const width = Number(src?.data?.size?.[0]) || 480;
    const desired = src ? [src.position.x + width + 80, src.position.y + index * 40] : null;
    if (!desired) return null;
    return NS.api?.freeSpot ? NS.api.freeSpot(desired, [480, 270], "asset") : desired;
  }

  function commitAsset(asset, ctx, index = 0) {
    const node = NS.api.addNodeByType(NS.TYPE_BY_KIND[asset.kind], resultPosition(ctx, index), asset);
    NS.ui?.refreshPanels?.();
    NS.api?.markDirty?.();
    return node;
  }

  async function spawn(blob, filename, ctx, index = 0) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    const asset = await NS.backend.upload(file);
    return commitAsset(asset, ctx, index);
  }

  /* FFmpeg endpoints return asset descriptors directly (no upload needed). */
  function spawnRefs(files, ctx) {
    return (files || []).map((asset, index) => commitAsset(asset, ctx, index));
  }

  function refOf(ctx) {
    const asset = ctx.data?.asset || {};
    if (asset.filename) {
      return { filename: String(asset.filename), subfolder: String(asset.subfolder || ""),
               type: String(asset.type || "input") };
    }
    try {
      const url = new URL(ctx.url, location.origin);
      return { filename: url.searchParams.get("filename") || "",
               subfolder: url.searchParams.get("subfolder") || "",
               type: url.searchParams.get("type") || "input" };
    } catch (error) {
      return { filename: "", subfolder: "", type: "input" };
    }
  }

  const API_AUDIO = "/api/infcanvas/audio/process";
  const API_VIDEO = "/api/infcanvas/video/process";
  const API_HEALTH = "/api/infcanvas/media/health";
  const NOT_READY = "媒体处理接口未就绪：请完全重启 ComfyUI（只刷新浏览器无效）";
  /* Built at call time so the active language is honoured (module loads before
     i18n). t() returns a plain string; escape the highlighted phrase as HTML. */
  function warnHtml() {
    return t("媒体处理接口未就绪：后端 Python 尚未重启。请{strong}完全重启 ComfyUI{/strong}（只刷新浏览器无效），然后重新操作。")
      .replace("{strong}", "<strong>").replace("{/strong}", "</strong>");
  }
  /* Legacy getter kept for compatibility; prefer warnHtml() so the language
     is resolved at call time, not module load. */
  const WARN_HTML = "媒体处理接口未就绪：后端 Python 尚未重启。请<strong>完全重启 ComfyUI</strong>" +
    "（只刷新浏览器无效），然后重新操作。";

  /* A Python route change needs a real ComfyUI restart. An old process answers
     with plain text 404/405, which res.json() would report as a parse error. */
  function createProbe() {
    let ready = false, checked = false;
    return {
      invalidate() { ready = false; checked = false; },
      async check() {
        if (checked) return ready;
        try {
          const res = await fetch(API_HEALTH, { cache: "no-store" });
          const raw = await res.text();
          let ok = false;
          try { ok = res.ok && /json/i.test(res.headers.get("content-type") || "") && !!JSON.parse(raw).ok; }
          catch (error) { ok = false; }
          ready = ok; checked = ok;
        } catch (error) { ready = false; checked = false; }
        return ready;
      },
    };
  }

  async function request(api, payload, signal) {
    const res = await fetch(api, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: signal || undefined,
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (error) {
      throw new Error(t("媒体处理接口未就绪（HTTP {status}）：后端 Python 尚未重启，请完全重启 ComfyUI 后重试（只刷新浏览器无效）", { status: res.status }));
    }
    if (!res.ok) {
      const detail = data?.detail;
      let msg = data?.error || ("HTTP " + res.status);
      if (detail && detail.ref) {
        const r = detail.ref;
        msg += `（${r.filename} @ ${r.subfolder || "/"}/${r.type}）`;
      }
      throw new Error(msg);
    }
    return data;
  }

  /* mm:ss.cc, same as the reference video/audio editors' formatTime. */
  const fmtPrecise = (value) => {
    const t = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 100);
    return String(Math.floor(t / 6000)).padStart(2, "0") + ":" +
      ((t % 6000) / 100).toFixed(2).padStart(5, "0");
  };

  function saveBlob(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /* ---------------------- image adjustment kernel ----------------------- */
  /* Ported verbatim (constants and pass order) from the reference project's
     xcat-image-adjust-core.js. Pixels are converted to linear light, held in a
     Float32Array and encoded back; 8-bit in-place maths loses dark detail. */

  const ADJUST_FIELDS = [
    { key: "brightness", label: t("亮度"), min: -1, max: 1 },
    { key: "exposure", label: t("曝光"), min: -1, max: 1 },
    { key: "contrast", label: t("对比度"), min: -1, max: 1 },
    { key: "highlights", label: t("高光"), min: -1, max: 1 },
    { key: "shadows", label: t("阴影"), min: -1, max: 1 },
    { key: "saturation", label: t("饱和度"), min: -1, max: 1 },
    { key: "vibrance", label: t("自然饱和度"), min: -1, max: 1 },
    { key: "temperature", label: t("暖色"), min: -1, max: 1 },
    { key: "tint", label: t("淡色"), min: -1, max: 1 },
    { key: "clarity", label: t("清晰度"), min: -1, max: 1 },
    { key: "vignette", label: t("晕影"), min: 0, max: 1 },
  ];
  const defaultParams = () => Object.fromEntries(ADJUST_FIELDS.map((f) => [f.key, 0]));
  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

  function multiplyMatrix(left, right) {
    const out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += left[row][k] * right[k][col];
        out[row][col] = sum;
      }
    }
    return out;
  }
  function buildColorMatrix(p) {
    const brightness = p.brightness / 4;
    const contrast = (p.contrast + 1) / 2 + 0.5;
    const saturation = p.saturation + 1;
    const exposure = ((p.exposure > 0 ? p.exposure * 3 : p.exposure * 1.5) + 1) / 2 + 0.5;
    const x = p.temperature * 2, tint = p.tint * 2;
    const B = { matrix: IDENTITY, offset: [brightness, brightness, brightness, 0] };
    const C = { matrix: [[contrast, 0, 0, 0], [0, contrast, 0, 0], [0, 0, contrast, 0], [0, 0, 0, 1]],
                offset: [0.5 * (1 - contrast), 0.5 * (1 - contrast), 0.5 * (1 - contrast), 0] };
    const S = { matrix: [
      [0.213 + 0.787 * saturation, 0.715 - 0.715 * saturation, 0.072 - 0.072 * saturation, 0],
      [0.213 - 0.213 * saturation, 0.715 + 0.285 * saturation, 0.072 - 0.072 * saturation, 0],
      [0.213 - 0.213 * saturation, 0.715 - 0.715 * saturation, 0.072 + 0.928 * saturation, 0],
      [0, 0, 0, 1]] };
    const E = { matrix: [[exposure, 0, 0, 0], [0, exposure, 0, 0], [0, 0, exposure, 0], [0, 0, 0, 1]] };
    const T = { matrix: x > 0
      ? [[1 + 0.1 * x, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1 - 0.1 * x, 0], [0, 0, 0, 1]]
      : [[1 + 0.15 * x, 0, 0, 0], [0, 1 + 0.05 * x, 0, 0], [0, 0, 1 - 0.15 * x, 0], [0, 0, 0, 1]] };
    const I = { matrix: [[1, 0, 0, 0], [0, 1 + 0.1 * tint, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]] };
    let matrix = IDENTITY;
    const offset = [0, 0, 0, 0];
    for (const step of [B, C, S, E, T, I]) {
      matrix = multiplyMatrix(matrix, step.matrix);
      if (step.offset) for (let j = 0; j < 4; j += 1) offset[j] += step.offset[j];
    }
    return { matrix, offset };
  }
  function pick(source, width, height, x, y, channel) {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return source[(cy * width + cx) * 3 + channel];
  }
  function applyClarity(buffer, width, height, clarity) {
    const f = clarity;
    const kernel = f >= 0
      ? [0, -f, 0, -f, 1 + 4 * f, -f, 0, -f, 0]
      : [-f, -2 * f, -f, -2 * f, 1 - 3 * f, -2 * f, -f, -2 * f, -f];
    let weight = kernel.reduce((sum, v) => sum + v, 0);
    if (weight <= 0) weight = 1;
    const snapshot = Float32Array.from(buffer);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky += 1) {
            for (let kx = -1; kx <= 1; kx += 1) {
              sum += pick(snapshot, width, height, x + kx, y + ky, channel) * kernel[(ky + 1) * 3 + (kx + 1)];
            }
          }
          buffer[target + channel] = clamp01(sum / weight);
        }
      }
    }
  }
  function applyHighlightsShadows(buffer, highlights, shadows) {
    const uHighlights = highlights + 1, uShadows = shadows / 2 + 1;
    const whiteTarget = clamp(uHighlights, 0, 2) - 1;
    const blackTarget = 1 - clamp(uShadows, 0, 1);
    const shadowPower = 1 / uShadows;
    const highlightPower1 = 1 / (2 - uHighlights), highlightPower2 = 2 / (2 - uHighlights);
    for (let index = 0; index < buffer.length; index += 3) {
      const r = buffer[index], g = buffer[index + 1], b = buffer[index + 2];
      const luminance = 0.2125 * r + 0.7154 * g + 0.0721 * b;
      if (luminance <= 0) continue;
      const shadow = clamp((Math.pow(luminance, shadowPower) + -0.76 * Math.pow(luminance, 2 / uShadows)) - luminance, 0, 1);
      const highlight = clamp((1 - (Math.pow(1 - luminance, highlightPower1) + -0.8 * Math.pow(1 - luminance, highlightPower2))) - luminance, -1, 0);
      const scale = (luminance + shadow + highlight) / luminance;
      const contrasted = (luminance - 0.5) * 1.5 + 0.5;
      const whiteInterp = contrasted * contrasted * contrasted;
      const inverse = 1 - contrasted;
      const blackInterp = inverse * inverse * inverse;
      const whiteBlend = whiteInterp * whiteTarget;
      const blackBlend = blackInterp * blackTarget;
      buffer[index] = (r * scale + (1 - r * scale) * whiteBlend) * (1 - blackBlend);
      buffer[index + 1] = (g * scale + (1 - g * scale) * whiteBlend) * (1 - blackBlend);
      buffer[index + 2] = (b * scale + (1 - b * scale) * whiteBlend) * (1 - blackBlend);
    }
  }
  function applyImageAdjust(image, params) {
    const width = image.width, height = image.height, data = image.data;
    if (ADJUST_FIELDS.every((f) => params[f.key] === 0)) return image;
    const count = width * height;
    const buffer = new Float32Array(count * 3);
    for (let pixel = 0, s = 0, d = 0; pixel < count; pixel += 1, s += 4, d += 3) {
      buffer[d] = srgbToLinear(data[s] / 255);
      buffer[d + 1] = srgbToLinear(data[s + 1] / 255);
      buffer[d + 2] = srgbToLinear(data[s + 2] / 255);
    }
    if (params.highlights !== 0 || params.shadows !== 0) applyHighlightsShadows(buffer, params.highlights, params.shadows);
    if (params.clarity !== 0) applyClarity(buffer, width, height, params.clarity);
    const { matrix, offset } = buildColorMatrix(params);
    const [m00, m01, m02] = matrix[0], [m10, m11, m12] = matrix[1], [m20, m21, m22] = matrix[2];
    const vibrance = params.vibrance, vignette = params.vignette;
    for (let y = 0; y < height; y += 1) {
      const ny = (y + 0.5) * 2 / height - 1;
      for (let x = 0; x < width; x += 1) {
        const target = (y * width + x) * 3;
        let r = buffer[target], g = buffer[target + 1], b = buffer[target + 2];
        if (vibrance !== 0) {
          const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
          const average = (r + g + b) / 3;
          const amount = Math.abs(max - average) * 2 * -vibrance;
          if (r !== max) r += (max - r) * amount;
          if (g !== max) g += (max - g) * amount;
          if (b !== max) b += (max - b) * amount;
        }
        const nr = clamp01(m00 * r + m01 * g + m02 * b + offset[0]);
        const ng = clamp01(m10 * r + m11 * g + m12 * b + offset[1]);
        const nb = clamp01(m20 * r + m21 * g + m22 * b + offset[2]);
        r = nr; g = ng; b = nb;
        if (vignette !== 0) {
          const nx = (x + 0.5) * 2 / width - 1;
          const curveX = Math.pow(Math.abs(nx), 1 / 0.65);
          const curveY = Math.pow(Math.abs(ny), 1 / 0.65);
          const edge = Math.pow(Math.sqrt(curveX * curveX + curveY * curveY), 0.65);
          const factor = 1 - vignette * smoothstep(0.20, 1.1, edge);
          r *= factor; g *= factor; b *= factor;
        }
        buffer[target] = r; buffer[target + 1] = g; buffer[target + 2] = b;
      }
    }
    for (let p = 0, s = 0, t = 0; p < count; p += 1, s += 3, t += 4) {
      data[t] = linearToSrgb(clamp01(buffer[s])) * 255;
      data[t + 1] = linearToSrgb(clamp01(buffer[s + 1])) * 255;
      data[t + 2] = linearToSrgb(clamp01(buffer[s + 2])) * 255;
    }
    return image;
  }

  /* ------------------------------------------------------------ LUT ------
     Standard Adobe .cube LUT text parser + sampler. Supports 3D tables
     (LUT_3D_SIZE, the common case) and 1D tables (LUT_1D_SIZE), with optional
     DOMAIN_MIN / DOMAIN_MAX. Cube stores red as the fastest-varying axis, so a
     sample index is r + N*(g + N*b). LUTs are display-referred (sRGB): they are
     applied AFTER the linear-light image adjustments, directly on image.data.
     Kept as pure functions and exported on helpers so they can be unit-tested. */
  function parseCubeLUT(text) {
    const lines = String(text || "").split(/\r?\n/);
    let size = 0, dim = 0, title = "";
    let dmin = [0, 0, 0], dmax = [1, 1, 1];
    const data = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.charAt(0) === "#") continue;
      const parts = line.split(/\s+/);
      const head = parts[0].toUpperCase();
      if (head === "TITLE") { title = parts.slice(1).join(" ").replace(/^"|"$/g, ""); continue; }
      if (head === "LUT_3D_SIZE") { dim = 3; size = parseInt(parts[1], 10); continue; }
      if (head === "LUT_1D_SIZE") { dim = 1; size = parseInt(parts[1], 10); continue; }
      if (head === "DOMAIN_MIN") { dmin = [ +parts[1], +parts[2], +parts[3] ]; continue; }
      if (head === "DOMAIN_MAX") { dmax = [ +parts[1], +parts[2], +parts[3] ]; continue; }
      const r = parseFloat(parts[0]), g = parseFloat(parts[1]), b = parseFloat(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) data.push(r, g, b);
    }
    const need = (dim === 3 ? size * size * size : size) * 3;
    if (!dim || !Number.isInteger(size) || size < 2 || size > 256 || data.length !== need) {
      throw new Error(t("LUT 文件无效：尺寸或数据点数量不符（需 {n} 个通道值）", { n: need }));
    }
    return { dim, size, domainMin: dmin, domainMax: dmax, title, data: new Float32Array(data) };
  }

  function sampleLUT3D(lut, r, g, b, out) {
    const n = lut.size, s = n - 1, d = lut.data, dmin = lut.domainMin, dmax = lut.domainMax;
    const fr = clamp01((r - dmin[0]) / ((dmax[0] - dmin[0]) || 1)) * s;
    const fg = clamp01((g - dmin[1]) / ((dmax[1] - dmin[1]) || 1)) * s;
    const fb = clamp01((b - dmin[2]) / ((dmax[2] - dmin[2]) || 1)) * s;
    const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
    const r1 = Math.min(r0 + 1, s), g1 = Math.min(g0 + 1, s), b1 = Math.min(b0 + 1, s);
    const tr = fr - r0, tg = fg - g0, tb = fb - b0;
    const at = (ri, gi, bi) => (ri + n * (gi + n * bi)) * 3;
    for (let c = 0; c < 3; c += 1) {
      const c000 = d[at(r0, g0, b0) + c], c100 = d[at(r1, g0, b0) + c];
      const c010 = d[at(r0, g1, b0) + c], c110 = d[at(r1, g1, b0) + c];
      const c001 = d[at(r0, g0, b1) + c], c101 = d[at(r1, g0, b1) + c];
      const c011 = d[at(r0, g1, b1) + c], c111 = d[at(r1, g1, b1) + c];
      const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
      const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
      const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
      out[c] = c0 + (c1 - c0) * tb;
    }
  }

  function sampleLUT1D(lut, r, g, b, out) {
    const n = lut.size, s = n - 1, d = lut.data, dmin = lut.domainMin, dmax = lut.domainMax;
    for (let c = 0; c < 3; c += 1) {
      const v = c === 0 ? r : (c === 1 ? g : b);
      const f = clamp01((v - dmin[c]) / ((dmax[c] - dmin[c]) || 1)) * s;
      const i0 = Math.floor(f), i1 = Math.min(i0 + 1, s), t = f - i0;
      out[c] = d[i0 * 3 + c] + (d[i1 * 3 + c] - d[i0 * 3 + c]) * t;
    }
  }

  function applyLUT(image, lut, strength) {
    if (!lut || !(strength > 0)) return image;
    const data = image.data, count = image.width * image.height, amt = clamp01(strength);
    const sample = lut.dim === 3 ? sampleLUT3D : sampleLUT1D;
    const mapped = [0, 0, 0];
    for (let p = 0, o = 0; p < count; p += 1, o += 4) {
      const r = data[o] / 255, g = data[o + 1] / 255, b = data[o + 2] / 255;
      sample(lut, r, g, b, mapped);
      data[o] = clamp01(r + (mapped[0] - r) * amt) * 255;
      data[o + 1] = clamp01(g + (mapped[1] - g) * amt) * 255;
      data[o + 2] = clamp01(b + (mapped[2] - b) * amt) * 255;
    }
    return image;
  }

  /* ------------------------------ image tools ---------------------------- */

  const RATIOS = [
    { key: "origin", label: t("原图"), value: 0 },
    { key: "1:1", label: "1:1", value: 1 },
    { key: "2:3", label: "2:3", value: 2 / 3 },
    { key: "3:2", label: "3:2", value: 3 / 2 },
    { key: "3:4", label: "3:4", value: 3 / 4 },
    { key: "4:3", label: "4:3", value: 4 / 3 },
    { key: "9:16", label: "9:16", value: 9 / 16 },
    { key: "16:9", label: "16:9", value: 16 / 9 },
    { key: "21:9", label: "21:9", value: 21 / 9 },
    { key: "free", label: t("自由"), value: null },
  ];

  /* ---------------------------------------------------------------- crop ----
     Reference xcat-image-tools.js openCrop(): selection stored in natural
     pixels; explicit preview frame size; drag-to-create, drag inside to move,
     8 resize handles, ratio locks (原图 / 1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 9:16 /
     16:9 / 21:9 / 自由), 宽/高 numeric fields, arrow-key nudging, "全选" button. */
  R.crop = async (ctx) => {
    const img = await loadImage(ctx.url);
    const W = img.naturalWidth, H = img.naturalHeight;
    const S = {
      natW: W, natH: H, scale: 1, dispW: 0, dispH: 0,
      rect: { x: Math.round(W * 0.1), y: Math.round(H * 0.1),
              w: Math.round(W * 0.8), h: Math.round(H * 0.8) },
      ratioKey: "origin", ratio: 1, drag: null, ready: false,
    };
    let stage, frame, preview, inputs = {}, uiRef = null, layoutHandler = null;

    const ratioValue = () => {
      const entry = RATIOS.find((r) => r.key === S.ratioKey);
      if (!entry) return null;
      if (entry.value === 0) return W / H;
      return entry.value;
    };
    const isValid = () => S.ready && S.rect.w >= 1 && S.rect.h >= 1 &&
      S.rect.x >= 0 && S.rect.y >= 0 &&
      S.rect.x + S.rect.w <= W + 0.6 && S.rect.y + S.rect.h <= H + 0.6;

    function layout() {
      if (!S.ready || !stage || !preview) return;
      const availW = Math.max(40, preview.clientWidth);
      const availH = Math.max(40, preview.clientHeight);
      const scale = Math.min(availW / W, availH / H);
      if (!Number.isFinite(scale) || scale <= 0) return;
      S.scale = scale;
      S.dispW = Math.max(1, Math.round(W * scale));
      S.dispH = Math.max(1, Math.round(H * scale));
      stage.style.width = S.dispW + "px";
      stage.style.height = S.dispH + "px";
      const image = stage.querySelector("img");
      if (image) {
        image.style.position = "absolute"; image.style.inset = "0";
        image.style.width = "100%"; image.style.height = "100%";
        image.style.maxWidth = "none"; image.style.maxHeight = "none";
      }
      paint();
    }

    function paint(skipInputs = false) {
      if (!frame) return;
      const c = S.rect, s = S.scale;
      frame.style.left = (c.x * s) + "px";
      frame.style.top = (c.y * s) + "px";
      frame.style.width = Math.max(1, c.w * s) + "px";
      frame.style.height = Math.max(1, c.h * s) + "px";
      if (!skipInputs) {
        for (const key of ["w", "h"]) {
          const el = inputs[key];
          if (el && document.activeElement !== el) el.value = Math.round(c[key]);
        }
      }
      /* Only the source size here: the crop size already sits in the 宽 / 高
         fields right above, so repeating it just made the line read twice. */
      const summary = document.querySelector(".ict-crop-size");
      if (summary) summary.textContent = S.ready ? t("原图") + ` ${W} × ${H}` : t("读取图片中…");
      uiRef?.setApplyEnabled?.(isValid());
    }

    function normalise() {
      const c = S.rect;
      c.w = clamp(Math.round(c.w), 1, W);
      c.h = clamp(Math.round(c.h), 1, H);
      c.x = clamp(Math.round(c.x), 0, Math.max(0, W - c.w));
      c.y = clamp(Math.round(c.y), 0, Math.max(0, H - c.h));
    }

    /* Opposite edge/corner stays fixed, ratio lock derives h from w. */
    function resizeRect(dir, p, anchor, r) {
      const hasW = dir.includes("w"), hasE = dir.includes("e");
      const hasN = dir.includes("n"), hasS = dir.includes("s");
      const x0 = anchor.x, y0 = anchor.y, x1 = x0 + anchor.w, y1 = y0 + anchor.h;
      const fx = hasW ? x1 : (hasE ? x0 : (x0 + x1) / 2);
      const fy = hasN ? y1 : (hasS ? y0 : (y0 + y1) / 2);
      const dx = hasW ? -1 : (hasE ? 1 : 0);
      const dy = hasN ? -1 : (hasS ? 1 : 0);
      let w = (hasW || hasE) ? Math.abs(p.x - fx) : anchor.w;
      let h = (hasN || hasS) ? Math.abs(p.y - fy) : anchor.h;
      if (r) { w = Math.max(w, h * r); h = w / r; }
      const availW = dx > 0 ? W - fx : (dx < 0 ? fx : Math.min(fx, W - fx) * 2);
      const availH = dy > 0 ? H - fy : (dy < 0 ? fy : Math.min(fy, H - fy) * 2);
      if (r) { const limit = Math.min(availW, availH * r); w = Math.min(w, limit); h = w / r; }
      else { w = Math.min(w, availW); h = Math.min(h, availH); }
      w = Math.max(1, Math.min(w, W));
      h = Math.max(1, Math.min(h, H));
      return {
        x: clamp(dx > 0 ? fx : (dx < 0 ? fx - w : fx - w / 2), 0, Math.max(0, W - w)),
        y: clamp(dy > 0 ? fy : (dy < 0 ? fy - h : fy - h / 2), 0, Math.max(0, H - h)),
        w, h,
      };
    }

    function setRatio(key) {
      S.ratioKey = key;
      const entry = RATIOS.find((r) => r.key === key);
      if (entry && entry.value > 0) S.ratio = entry.value;
      document.querySelectorAll(".ict-ratio").forEach((chip) => {
        const on = chip.dataset.ratio === key;
        chip.classList.toggle("is-active", on);
        chip.setAttribute("aria-pressed", String(on));
      });
      const r = ratioValue();
      if (!r || !Number.isFinite(r) || r <= 0) return paint();
      const c = S.rect, cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      const maxW = Math.min(cx, W - cx) * 2, maxH = Math.min(cy, H - cy) * 2;
      const w = Math.max(1, Math.min(Math.max(c.w, c.h * r), maxW, maxH * r));
      const h = w / r;
      S.rect = { x: clamp(cx - w / 2, 0, Math.max(0, W - w)),
                 y: clamp(cy - h / 2, 0, Math.max(0, H - h)), w, h };
      paint();
    }

    function setField(key, value) {
      const c = { ...S.rect }, r = ratioValue();
      if (key === "w" || key === "h") {
        let w = key === "w" ? value : c.w, h = key === "h" ? value : c.h;
        if (r) { if (key === "w") h = w / r; else w = h * r; }
        w = clamp(w, 1, Math.max(1, W - c.x));
        h = clamp(h, 1, Math.max(1, H - c.y));
        if (r) { const limit = Math.min(W - c.x, (H - c.y) * r);
                 w = Math.min(w, Math.max(1, limit)); h = w / r; }
        c.w = w; c.h = h;
      }
      S.rect = c;
      paint(true);
    }

    openModal({
      title: t("裁剪"), width: 860,
      applyLabel: t("裁剪并生成节点"), applyDisabled: true,
      extraFoot: [{ label: t("全选"), onClick: () => {
        const r = ratioValue();
        if (!r) S.rect = { x: 0, y: 0, w: W, h: H };
        else { const w = Math.min(W, H * r), h = w / r;
               S.rect = { x: (W - w) / 2, y: (H - h) / 2, w, h }; }
        paint();
      } }],
      build(body, ui) {
        uiRef = ui;
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview">
              <div class="ict-crop-stage">
                <img alt="${t('原图')}" />
                <div class="ict-crop-frame">
                  ${["nw", "n", "ne", "e", "se", "s", "sw", "w"].map((d) => `<i class="ict-handle ict-h-${d}" data-d="${d}"></i>`).join("")}
                </div>
              </div>
            </div>
            <aside class="ict-side">
              <div><p class="ict-label">${t('比例')}</p><div class="ict-chips ict-ratios"></div></div>
              <div class="ict-4">
                <label>${t('宽')} <input class="ict-input" type="number" data-f="w" /></label>
                <label>${t('高')} <input class="ict-input" type="number" data-f="h" /></label>
              </div>
              <p class="ict-summary ict-crop-size">${t('读取图片中…')}</p>
            </aside>
          </div>`;
        preview = body.querySelector(".ict-preview");
        stage = body.querySelector(".ict-crop-stage");
        frame = body.querySelector(".ict-crop-frame");
        const image = stage.querySelector("img");
        image.src = ctx.url;

        const chips = body.querySelector(".ict-ratios");
        for (const entry of RATIOS) {
          const chip = document.createElement("button");
          chip.type = "button"; chip.className = "ict-chip ict-ratio";
          chip.dataset.ratio = entry.key; chip.textContent = entry.label;
          chip.setAttribute("aria-pressed", String(entry.key === S.ratioKey));
          if (entry.key === S.ratioKey) chip.classList.add("is-active");
          chip.addEventListener("click", () => setRatio(entry.key));
          chips.appendChild(chip);
        }
        body.querySelectorAll(".ict-4 input[data-f]").forEach((input) => {
          inputs[input.dataset.f] = input;
          input.addEventListener("input", () => {
            const value = parseFloat(input.value);
            if (Number.isFinite(value)) setField(input.dataset.f, value);
          });
        });

        const at = (event) => {
          const box = stage.getBoundingClientRect();
          return { x: clamp((event.clientX - box.left) / S.scale, 0, W),
                   y: clamp((event.clientY - box.top) / S.scale, 0, H) };
        };
        stage.addEventListener("pointerdown", (event) => {
          if (!S.ready || event.button !== 0) return;
          event.preventDefault();
          const p = at(event);
          const handle = event.target.closest?.(".ict-handle");
          const c = S.rect;
          const inside = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
          S.drag = {
            mode: handle ? "resize" : (inside ? "move" : "new"),
            dir: handle?.dataset.d || "", anchor: p,
            rect: { ...c }, r: ratioValue(),
          };
          if (S.drag.mode === "new") S.rect = { x: p.x, y: p.y, w: 0, h: 0 };
          try { stage.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
          paint();
        });
        stage.addEventListener("pointermove", (event) => {
          const d = S.drag;
          if (!d) return;
          const p = at(event);
          if (d.mode === "move") {
            S.rect = {
              x: clamp(d.rect.x + (p.x - d.anchor.x), 0, Math.max(0, W - d.rect.w)),
              y: clamp(d.rect.y + (p.y - d.anchor.y), 0, Math.max(0, H - d.rect.h)),
              w: d.rect.w, h: d.rect.h,
            };
          } else if (d.mode === "new") {
            const dirX = p.x >= d.anchor.x ? 1 : -1, dirY = p.y >= d.anchor.y ? 1 : -1;
            let w = Math.abs(p.x - d.anchor.x), h = Math.abs(p.y - d.anchor.y);
            if (d.r) { w = Math.max(w, h * d.r); h = w / d.r; }
            const maxW = dirX > 0 ? W - d.anchor.x : d.anchor.x;
            const maxH = dirY > 0 ? H - d.anchor.y : d.anchor.y;
            if (d.r) { const limit = Math.min(maxW, maxH * d.r); w = Math.min(w, limit); h = w / d.r; }
            else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
            S.rect = { x: dirX > 0 ? d.anchor.x : d.anchor.x - w,
                       y: dirY > 0 ? d.anchor.y : d.anchor.y - h, w, h };
          } else {
            S.rect = resizeRect(d.dir, p, d.rect, d.r);
          }
          paint();
          event.preventDefault();
        });
        const stop = () => { S.drag = null; normalise(); paint(); };
        stage.addEventListener("pointerup", stop);
        stage.addEventListener("pointercancel", stop);
        body.addEventListener("keydown", (event) => {
          const tag = document.activeElement?.tagName || "";
          if (tag === "INPUT" || tag === "TEXTAREA") return;
          const step = event.shiftKey ? 10 : 1;
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                          ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
          if (!delta) return;
          event.preventDefault();
          S.rect.x += delta[0]; S.rect.y += delta[1];
          normalise(); paint();
        });

        const init = () => {
          if (S.ready) return;
          S.ready = true;
          layout();
        };
        image.addEventListener("load", init);
        if (image.complete && image.naturalWidth) init();
        layoutHandler = layout;
        window.addEventListener("resize", layoutHandler);
      },
      onClose: () => {
        if (layoutHandler) window.removeEventListener("resize", layoutHandler);
        layoutHandler = null;
      },
      onApply: async (ui) => {
        normalise();
        if (!isValid()) throw new Error(t("请选择有效的裁剪区域"));
        const c = S.rect;
        const sx = clamp(Math.round(c.x), 0, W - 1), sy = clamp(Math.round(c.y), 0, H - 1);
        const sw = clamp(Math.round(c.w), 1, W - sx), sh = clamp(Math.round(c.h), 1, H - sy);
        const canvas = document.createElement("canvas");
        canvas.width = sw; canvas.height = sh;
        canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        ui.setStatus(t("正在按原图分辨率裁切…"));
        await spawn(await canvasBlob(canvas),
          `${stemOf(ctx.data.asset?.name)}_crop_${sw}x${sh}.png`, ctx);
        toast("success", t("裁剪完成"), `${sw} × ${sh}`);
      },
    });
  };

  /* ---------------------------------------------------------------- grid ---- */
  R.grid = async (ctx) => {
    const img = await loadImage(ctx.url);
    let rows = 3, cols = 3;
    let custom = false; // true = 自定义滑块模式；false = 预设模式
    let overlay, summary, inputs = {}, outputs = {}, customBtn = null, customBox = null;
    const valid = () => Number.isInteger(rows) && Number.isInteger(cols) &&
      rows >= 1 && rows <= 10 && cols >= 1 && cols <= 10 && rows * cols > 1;
    const render = () => {
      if (inputs.rows) inputs.rows.value = rows;
      if (inputs.cols) inputs.cols.value = cols;
      if (outputs.rows) outputs.rows.textContent = String(rows);
      if (outputs.cols) outputs.cols.textContent = String(cols);
      /* render() may write the inputs itself (preset click / reset), which
         fires no input event — repaint the slider fill or the track lies. */
      if (customBox) paintRanges(customBox);
      overlay.innerHTML = "";
      const total = rows * cols;
      for (let i = 0; i < total; i += 1) {
        const cell = document.createElement("div");
        cell.className = "ict-cell";
        cell.style.left = ((i % cols) / cols * 100) + "%";
        cell.style.top = (Math.floor(i / cols) / rows * 100) + "%";
        cell.style.width = (100 / cols) + "%";
        cell.style.height = (100 / rows) + "%";
        cell.textContent = String(i + 1);
        overlay.appendChild(cell);
      }
      summary.textContent = valid() ? t("共 {n} 张图片", { n: total }) : t("请设置有效行列数");
      document.querySelectorAll(".ict-grid-preset").forEach((chip) => {
        const n = Number(chip.dataset.grid);
        chip.classList.toggle("is-active", !custom && n === rows && n === cols);
      });
      customBtn?.classList.toggle("is-active", custom);
      if (customBox) customBox.hidden = !custom;
      uiRef?.setApplyEnabled?.(valid() && img.naturalWidth >= cols && img.naturalHeight >= rows);
    };
    let uiRef = null;
    openModal({
      title: t("宫格裁剪"), width: 860,
      applyLabel: t("切分为图片节点"), applyDisabled: true,
      build(body, ui) {
        uiRef = ui;
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview"><div class="ict-crop-stage">
              <img alt="${t('原图')}" /><div class="ict-grid-overlay"></div>
            </div></div>
            <aside class="ict-side">
              <div><p class="ict-label">${t('预设')}</p><div class="ict-grid-presets"></div></div>
              <button class="ict-grid-custom-btn" type="button">${t('自定义')}</button>
              <div class="ict-grid-custom" hidden>
                <label class="ict-grid-slider-row"><span>${t('行数')}</span>
                  <input type="range" data-f="rows" min="1" max="10" step="1" value="3" />
                  <output data-o="rows">3</output></label>
                <label class="ict-grid-slider-row"><span>${t('列数')}</span>
                  <input type="range" data-f="cols" min="1" max="10" step="1" value="3" />
                  <output data-o="cols">3</output></label>
              </div>
              <p class="ict-summary"></p>
            </aside>
          </div>`;
        body.querySelector("img").src = ctx.url;
        const gridStage = body.querySelector(".ict-crop-stage");
        const gridImg = body.querySelector("img");
        const gridPreview = body.querySelector(".ict-preview");
        const layoutGrid = () => {
          if (!gridImg.naturalWidth || !gridPreview) return;
          const s = Math.min(gridPreview.clientWidth / gridImg.naturalWidth,
                             gridPreview.clientHeight / gridImg.naturalHeight);
          gridStage.style.width = Math.round(gridImg.naturalWidth * s) + "px";
          gridStage.style.height = Math.round(gridImg.naturalHeight * s) + "px";
          gridImg.style.width = "100%"; gridImg.style.height = "100%";
          gridImg.style.maxWidth = "none"; gridImg.style.maxHeight = "none";
        };
        if (gridImg.complete) layoutGrid(); else gridImg.addEventListener("load", layoutGrid);
        overlay = body.querySelector(".ict-grid-overlay");
        summary = body.querySelector(".ict-summary");
        const presets = body.querySelector(".ict-grid-presets");
        for (const n of [2, 3, 4, 5]) {
          const chip = document.createElement("button");
          chip.type = "button"; chip.className = "ict-grid-preset"; chip.dataset.grid = String(n);
          const icon = document.createElement("i");
          icon.style.gridTemplateColumns = `repeat(${n},1fr)`;
          for (let i = 0; i < n * n; i += 1) icon.appendChild(document.createElement("b"));
          const label = document.createElement("span");
          label.textContent = t("{n} 宫格", { n: n * n });
          chip.append(icon, label);
          chip.addEventListener("click", () => { rows = n; cols = n; custom = false; render(); });
          presets.appendChild(chip);
        }
        customBtn = body.querySelector(".ict-grid-custom-btn");
        customBox = body.querySelector(".ict-grid-custom");
        /* Custom mode always opens at 3 × 3. Inheriting whatever preset was
           tapped last (2 × 2, 25 宫格 …) meant the sliders started on a value
           nobody had asked for. */
        customBtn.addEventListener("click", () => {
          if (!custom) { rows = 3; cols = 3; }
          custom = true; render();
        });
        body.querySelectorAll(".ict-grid-custom output[data-o]").forEach((out) => {
          outputs[out.dataset.o] = out;
        });
        body.querySelectorAll(".ict-grid-custom input[data-f]").forEach((input) => {
          inputs[input.dataset.f] = input;
          input.addEventListener("input", () => {
            const value = parseInt(input.value, 10);
            if (Number.isFinite(value)) {
              const next = clamp(value, 1, 10);
              if (input.dataset.f === "rows") rows = next; else cols = next;
              render();
            }
          });
        });
        render();
      },
      onApply: async (ui) => {
        if (!valid()) throw new Error(t("请设置有效的行列数"));
        const W = img.naturalWidth, H = img.naturalHeight;
        if (W < cols || H < rows) throw new Error(t("图片尺寸小于切分行列数"));
        const base = stemOf(ctx.data.asset?.name);
        for (let r = 0, i = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1, i += 1) {
            const x0 = Math.floor(c * W / cols), x1 = Math.floor((c + 1) * W / cols);
            const y0 = Math.floor(r * H / rows), y1 = Math.floor((r + 1) * H / rows);
            const canvas = document.createElement("canvas");
            canvas.width = x1 - x0; canvas.height = y1 - y0;
            canvas.getContext("2d").drawImage(img, x0, y0, canvas.width, canvas.height,
              0, 0, canvas.width, canvas.height);
            ui.setStatus(t("正在生成产物 {i} / {n}…", { i: i + 1, n: rows * cols }));
            await spawn(await canvasBlob(canvas), `${base}_grid_${r + 1}-${c + 1}.png`, ctx, i);
          }
        }
        toast("success", t("宫格完成"), t("{n} 张切片", { n: rows * cols }));
      },
    });
  };

  const MIRRORS = [
    { key: "flipX", label: t("左右翻转"), css: "scaleX(-1)", swap: false },
    { key: "flipY", label: t("上下翻转"), css: "scaleY(-1)", swap: false },
    { key: "rotate90", label: t("顺时针 90°"), css: "rotate(90deg)", swap: true },
    { key: "rotate270", label: t("逆时针 90°"), css: "rotate(-90deg)", swap: true },
    { key: "rotate180", label: "180°", css: "rotate(180deg)", swap: false },
  ];
  /* rotate-*-square glyphs (lucide): a framed square whose top corner opens
     into a chevron, so the arrow reads as "this box turns". */
  const MIRROR_PATHS = {
    flipX: '<path d="M12 3v18M8 7 3 12l5 5M16 7l5 5-5 5"/>',
    flipY: '<path d="M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
    rotate90: '<path d="M12 5H6a2 2 0 0 0-2 2v3"/><path d="m9 8 3-3-3-3"/>' +
      '<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
    rotate270: '<path d="M20 9V7a2 2 0 0 0-2-2h-6"/><path d="m15 2-3 3 3 3"/>' +
      '<path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/>',
    rotate180: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  };
  const mirrorIcon = (key) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    (MIRROR_PATHS[key] || "") + "</svg>";

  /* Reference: hover/focus previews the transform, a CLICK immediately
     generates the new node. There is no "应用" button in this dialog. */
  R.mirror = async (ctx) => {
    const img = await loadImage(ctx.url);
    let current = MIRRORS[0];
    openModal({
      title: t("镜像 / 旋转"), width: 860,
      applyLabel: null, cancelLabel: t("关闭"),
      build(body, ui) {
        body.innerHTML = `
          <div class="ict-split">
            <div class="ict-preview ict-mirror-preview"><img alt="${t('镜像效果预览')}" /></div>
            <aside class="ict-side">
              <p class="ict-label">${t('变换')}</p>
              <div class="ict-mirror-grid"></div>
            </aside>
          </div>`;
        const preview = body.querySelector("img");
        preview.src = ctx.url;
        const grid = body.querySelector(".ict-mirror-grid");
        for (const item of MIRRORS) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ict-mirror-btn" + (item.key === "rotate180" ? " is-wide" : "");
          button.innerHTML = `<span class="ict-mirror-icon">${mirrorIcon(item.key)}</span>` +
            `<span class="ict-mirror-label">${item.label}</span>`;
          const show = () => { preview.style.transform = item.css; };
          const hide = () => { preview.style.transform = ""; };
          button.addEventListener("mouseenter", show);
          button.addEventListener("mouseleave", hide);
          button.addEventListener("focus", show);
          button.addEventListener("blur", hide);
          button.addEventListener("click", () => { current = item; ui.apply(); });
          grid.appendChild(button);
        }
      },
      onApply: async (ui) => {
        const W = img.naturalWidth, H = img.naturalHeight;
        const canvas = document.createElement("canvas");
        canvas.width = current.swap ? H : W;
        canvas.height = current.swap ? W : H;
        const c = canvas.getContext("2d");
        switch (current.key) {
          case "flipX": c.translate(W, 0); c.scale(-1, 1); break;
          case "flipY": c.translate(0, H); c.scale(1, -1); break;
          case "rotate90": c.translate(H, 0); c.rotate(Math.PI / 2); break;
          case "rotate270": c.translate(0, W); c.rotate(-Math.PI / 2); break;
          case "rotate180": c.translate(W, H); c.scale(-1, -1); break;
          default: break;
        }
        c.drawImage(img, 0, 0);
        ui.setStatus(t("正在处理…"));
        await spawn(await canvasBlob(canvas),
          `${stemOf(ctx.data.asset?.name)}_mirror_${current.key}.png`, ctx);
        toast("success", t("镜像完成"), t("已生成「{label}」图片节点", { label: current.label }));
      },
    });
  };

  const fmtAdjust = (value) => value === 0 ? "0"
    : (value > 0 ? "+" : "−") + Math.abs(value).toFixed(2);
  const isNoop = (params) => ADJUST_FIELDS.every((field) => params[field.key] === 0);

  R.adjust = async (ctx) => {
    const img = await loadImage(ctx.url);
    const params = defaultParams();
    let previewCanvas, raf = 0, ready = false;
    let base = null, pw = 0, ph = 0;
    let lut = null, lutStrength = 1, lutName = "";
    let uiRef = null, lutNameEl = null, lutDetailEl = null, lutFileEl = null,
        lutStrengthEl = null, lutStrengthOut = null;
    const hasChange = () => !isNoop(params) || !!lut;
    const refreshApply = (ui) => (ui || uiRef)?.setApplyEnabled?.(hasChange());
    const renderLutMeta = () => {
      if (lutNameEl) {
        lutNameEl.textContent = lut ? (lutName || lut.title || t("已加载 LUT 滤镜")) : t("未加载滤镜 · 支持 .cube / .3dl 文本 LUT");
        lutNameEl.classList.toggle("is-empty", !lut);
      }
      if (lutDetailEl) lutDetailEl.hidden = !lut;
    };
    const schedule = (ui) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (!previewCanvas) return;
        loadPreview().then(() => {
          if (!previewCanvas || !base) return;
          previewCanvas.width = pw; previewCanvas.height = ph;
          const c = previewCanvas.getContext("2d");
          const image = new ImageData(new Uint8ClampedArray(base.data), pw, ph);
          const adjusted = applyImageAdjust(image, { ...params });
          c.putImageData(applyLUT(adjusted, lut, lutStrength), 0, 0);
        }).catch((error) => ui?.setStatus(error?.message || t("预览失败"), true));
      });
    };
    function loadPreview() {
      if (ready) return Promise.resolve();
      return new Promise((resolve) => {
        const W = img.naturalWidth, H = img.naturalHeight;
        const scale = Math.min(1, 512 / Math.max(W, H));
        pw = Math.max(1, Math.round(W * scale));
        ph = Math.max(1, Math.round(H * scale));
        const canvas = document.createElement("canvas");
        canvas.width = pw; canvas.height = ph;
        canvas.getContext("2d").drawImage(img, 0, 0, pw, ph);
        base = canvas.getContext("2d").getImageData(0, 0, pw, ph);
        ready = true;
        resolve();
      });
    }
    const loadLutFile = async (file, ui) => {
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = parseCubeLUT(text);
        lut = parsed;
        lutName = file.name.replace(/\.[^.]+$/, "").slice(0, 48);
        lutStrength = 1;
        if (lutStrengthEl) lutStrengthEl.value = "100";
        if (lutStrengthOut) lutStrengthOut.textContent = "100%";
        renderLutMeta();
        refreshApply(ui);
        schedule(ui);
        toast("success", t("LUT 已加载"), `${lutName} · ${parsed.dim === 3 ? parsed.size + "³" : parsed.size + " " + t("级")} 3D/1D ${t("色彩表")}`);
      } catch (error) {
        lut = null;
        renderLutMeta();
        refreshApply(ui);
        schedule(ui);
        toast("error", t("LUT 加载失败"), String(error?.message || error));
      }
    };
    openModal({
      title: t("调色"), sub: t("参数 + 自定义 LUT 滤镜"), width: 860,
      applyLabel: t("应用"), applyDisabled: true,
      extraFoot: [{ label: t("重置"), onClick: (ui) => {
        Object.assign(params, defaultParams());
        ui.body.querySelectorAll(".ict-slider input").forEach((input) => { input.value = "0"; });
        ui.body.querySelectorAll(".ict-slider output").forEach((out) => {
          out.textContent = "0"; out.classList.remove("is-changed");
        });
        lut = null; lutStrength = 1; lutName = "";
        if (lutFileEl) lutFileEl.value = "";
        if (lutStrengthEl) lutStrengthEl.value = "100";
        if (lutStrengthOut) lutStrengthOut.textContent = "100%";
        NS.tools?.paintRanges?.(ui.body);
        renderLutMeta();
        ui.setApplyEnabled(false);
        schedule(ui);
      } }],
      build(body, ui) {
        uiRef = ui;
        body.innerHTML = `
          <div class="ict-adjust">
            <div class="ict-preview"><canvas></canvas></div>
            <aside class="ict-side">
              <div class="ict-sliders"></div>
              <div class="ict-lut-block">
                <p class="ict-label">${t('滤镜 LUT')}</p>
                <div class="ict-lut-file">
                  <button type="button" class="ict-btn ict-lut-pick">${t('加载 LUT 文件')}</button>
                  <input type="file" accept=".cube,.3dl,.txt,text/plain" />
                </div>
                <p class="ict-lut-name is-empty">${t('未加载滤镜 · 支持 .cube / .3dl 文本 LUT')}</p>
                <div class="ict-lut-detail" hidden>
                  <label class="ict-lut-strength"><span>${t('强度')}</span>
                    <input type="range" min="0" max="100" step="1" value="100" />
                    <output>100%</output></label>
                  <button type="button" class="ict-btn ict-lut-remove">${t('移除滤镜')}</button>
                </div>
              </div>
            </aside>
          </div>`;
        previewCanvas = body.querySelector("canvas");
        lutNameEl = body.querySelector(".ict-lut-name");
        lutDetailEl = body.querySelector(".ict-lut-detail");
        lutFileEl = body.querySelector(".ict-lut-file input");
        lutStrengthEl = body.querySelector(".ict-lut-strength input");
        lutStrengthOut = body.querySelector(".ict-lut-strength output");
        body.querySelector(".ict-lut-pick").addEventListener("click", () => lutFileEl.click());
        lutFileEl.addEventListener("change", () => loadLutFile(lutFileEl.files?.[0], ui));
        body.querySelector(".ict-lut-remove").addEventListener("click", () => {
          lut = null; lutStrength = 1; lutName = "";
          if (lutFileEl) lutFileEl.value = "";
          if (lutStrengthEl) lutStrengthEl.value = "100";
          if (lutStrengthOut) lutStrengthOut.textContent = "100%";
          renderLutMeta();
          refreshApply(ui);
          schedule(ui);
        });
        lutStrengthEl.addEventListener("input", () => {
          lutStrength = parseInt(lutStrengthEl.value, 10) / 100;
          lutStrengthOut.textContent = lutStrengthEl.value + "%";
          schedule(ui);
        });
        const list = body.querySelector(".ict-sliders");
        for (const field of ADJUST_FIELDS) {
          const row = document.createElement("label");
          row.className = "ict-slider";
          row.innerHTML = `<span>${field.label}</span>` +
            `<input type="range" min="${field.min}" max="${field.max}" step="0.01" value="0" />` +
            `<output>0</output>`;
          const input = row.querySelector("input"), output = row.querySelector("output");
          input.addEventListener("input", () => {
            params[field.key] = parseFloat(input.value) || 0;
            output.textContent = fmtAdjust(params[field.key]);
            output.classList.toggle("is-changed", params[field.key] !== 0);
            refreshApply(ui);
            schedule(ui);
          });
          list.appendChild(row);
        }
        renderLutMeta();
        schedule(ui);
      },
      onApply: async (ui) => {
        if (!hasChange()) throw new Error(t("请先调整参数或加载 LUT 滤镜"));
        ui.setStatus(t("正在按原图分辨率导出…"));
        const canvas = drawToCanvas(img);
        const c = canvas.getContext("2d");
        const image = c.getImageData(0, 0, canvas.width, canvas.height);
        const adjusted = applyImageAdjust(image, { ...params });
        c.putImageData(applyLUT(adjusted, lut, lutStrength), 0, 0);
        const active = ADJUST_FIELDS.filter((f) => params[f.key] !== 0).slice(0, 3)
          .map((f) => f.key).join("_") || "default";
        const summary = ADJUST_FIELDS.filter((f) => params[f.key] !== 0).slice(0, 3)
          .map((f) => f.label).join("·");
        const parts = ["adjust", active];
        if (lut) parts.push("lut_" + stemOf(lutName));
        const label = [summary || t("默认"), lut ? ("LUT " + lutName) : ""].filter(Boolean).join(" + ");
        await spawn(await canvasBlob(canvas), `${stemOf(ctx.data.asset?.name)}_${parts.join("_")}.png`, ctx);
        toast("success", t("调整完成"), t("已生成「调整 {label}」图片节点", { label }));
      },
    });
  };

  /* --------------------------- shared actions ---------------------------- */

  R.favorite = async (ctx) => {
    /* Generated nodes keep their result in data.result; asset nodes in data.asset. */
    const asset = ctx.data?.result || ctx.data?.asset;
    const kind = asset?.kind || ctx.data?.kind || "text";
    const url = ctx.url || asset?.url || (asset && NS.api?.viewUrl?.(asset));
    const text = ctx.data?.text ?? ctx.data?.asset?.text ?? ctx.data?.result?.text;
    const saved = await NS.api.addToFavorites(asset || {}, {
      url, kind,
      name: asset?.name || asset?.filename || ctx.data?.title || "asset",
      // Only text assets use data.text as the payload; media nodes carry an
      // empty data.text that must NOT shadow their fetchable file.
      text: kind === "text" && text != null ? String(text) : undefined,
    });
    toast("success", t("已添加到收藏"), t("已保存到收藏文件夹：{name}", { name: saved.filename }));
  };
  R.delete = (ctx) => NS.api?.removeNode?.(ctx.id);
  /* Feed a material file straight into the node from the disk. Only offered on
     an empty generator whose input is free (see ICanvasNode's canUpload): the
     node flips to its material state, exactly like a file dropped on it. */
  R.upload = (ctx) => ctx.pickFile?.();

  const TOOL_SETS = {
    image: [["crop", "裁剪"], ["grid", "宫格裁剪"], ["mirror", "旋转"], ["adjust", "调色"]],
    video: [["videoCrop", "裁剪"], ["videoSpeed", "变速"], ["reverse", "倒放"], ["rotate", "旋转"],
            ["extractAudio", "音频分离"], ["trim", "截取"], ["frame", "捕捉帧"]],
    audio: [["clip", "截取"], ["speed", "变速"]],
  };

  /* Lucide glyph name per tool key, rendered by IcIcon in the node toolbar.
     These are stable internal names; only the visible label is localised. */
  const TOOL_ICONS = {
    crop: "crop", grid: "layout-grid", mirror: "rotate-3d", adjust: "aperture",
    extractAudio: "audio-lines-off", trim: "scissors",
    videoCrop: "crop", videoSpeed: "gauge", reverse: "rewind", rotate: "rotate-3d",
    frame: "camera", clip: "scissors", speed: "gauge", favorite: "bookmark",
    upload: "upload", delete: "trash-2",
  };

  // Hover tooltips for the node action buttons. Each describes what the tool
  // does, what it produces, and whether the original asset is kept — unlike a
  // bare button label, this tells the user what to expect before clicking.
  const TOOL_TIPS = {
    crop:         "裁剪：拖拽框选区域、可锁定比例，生成新的图片节点，原图保留",
    grid:         "宫格裁剪：把图片切成多行多列的小图，逐块生成图片节点，原图保留",
    mirror:       "旋转：左右翻转、上下翻转或旋转 90°/180°，点击即生成新图片节点，原图保留",
    adjust:       "调色：调节亮度、对比度、饱和度等参数，可叠加 LUT 滤镜，生成新图片节点，原图保留",
    videoCrop:    "裁剪：在首帧上框选画面区域，生成新的视频节点，原视频保留",
    videoSpeed:   "变速：调整播放速度 0.1×–4×，音轨保持音调，生成新的视频节点，原视频保留",
    reverse:      "倒放：将画面与音轨倒序播放，生成新的视频节点，原视频保留",
    rotate:       "旋转：顺时针 90°、180° 或逆时针 90°，生成新的视频节点，原视频保留",
    extractAudio: "音频分离：抽取视频中的音轨，生成一个音频节点，原视频保留",
    trim:         "截取：按起止时间截取一段视频，生成新的视频节点，原视频保留",
    frame:        "捕捉帧：在指定时间点抽取一帧画面，生成一张图片节点，原视频保留",
    clip:         "截取：截取片段、可删除片段并拼接，生成新的音频节点，原音频保留",
    speed:        "变速：调整播放速度 0.1×–4×，保持音调，可试听，生成新的音频节点，原音频保留",
    favorite:     "添加到收藏：把素材保存到收藏文件夹，按 文本/图像/视频/音频 分类",
    upload:       "上传：从本地选择素材文件，直接填充当前节点（仅输入端未接入时可用）",
    delete:       "删除：从画布中移除这个节点（磁盘上的原素材文件不会被删除）",
  };

  function actionsFor(data, options) {
    /* One rule for both states: whatever the node is holding (a dropped file
       on a material node, or the result of a generator) gets the same per-kind
       tools plus 收藏. Text nodes have no tool set, so they only get 收藏 + delete. */
    const media = data.asset || data.result || null;
    const kind = media?.kind || data.kind;
    const pairs = [];
    if (media && TOOL_SETS[kind]) pairs.push(...TOOL_SETS[kind]);
    if (media) pairs.push(["favorite", t("添加到收藏")]);
    /* Upload sits just left of delete — the last slot before the destructive
       one, so the row reads "do things … fill … destroy". */
    if (options?.canUpload) pairs.push(["upload", t("上传")]);
    pairs.push(["delete", t("删除")]);
    return pairs.map(([key, label]) => ({
      key, label: t(label), tip: t(TOOL_TIPS[key] || label), icon: TOOL_ICONS[key] || "",
    }));
  }

  async function run(key, ctx) {
    const handler = R[key];
    if (!handler) { toast("warning", t("功能尚未就绪"), key); return; }
    try { await handler(ctx); }
    catch (error) {
      console.error("[InfCanvas tools]", key, error);
      toast("error", t("操作失败"), String(error?.message || error));
    }
  }

  function renderText(text) {
    const manager = NS.app?.extensionManager || window.comfyAPI?.app?.app?.extensionManager;
    const render = manager?.renderMarkdownToHtml;
    if (typeof render === "function") {
      try { return render.call(manager, text || ""); } catch (error) { /* fallback */ }
    }
    return String(text || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c])).replace(/\n/g, "<br>");
  }

  NS.tools = {
    actionsFor, run, renderText, spawn, spawnRefs, refOf, resultPosition,
    openModal, closeModal, openMenu, closeMenu, paintRanges,
    MIRROR_PATHS, mirrorIcon,
    createProbe, request, API_AUDIO, API_VIDEO, API_HEALTH, NOT_READY, WARN_HTML, warnHtml, fmtPrecise,
    isOpen: () => !!modal?.mask?.isConnected || !!menu,
    helpers: { loadImage, canvasBlob, drawToCanvas, saveBlob, clamp, clamp01, fmtTime, fmtPrecise,
               stemOf, toast, applyImageAdjust, parseCubeLUT, applyLUT },
    registry: R,
  };
  injectStyles();
})();
