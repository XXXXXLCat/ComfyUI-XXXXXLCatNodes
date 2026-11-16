/* Injected stylesheet for the embedded infinite canvas. No external assets.

   Isolation rule: in canvas mode, ComfyUI's own UI (topbar, sidebar, workflow
   tabs, graph) is hidden as a whole. Everything the user sees while in canvas
   mode lives inside #infcanvas-root, which is a sibling of #vue-app.

   Visual fidelity: the metrics below were measured from ComfyUI 0.45.0 /
   frontend 1.59.1 in a real browser (computed styles of .workflow-tabs-
   container, [data-slot=tabs-trigger], .side-bar-button, .side-bar-panel and
   .comfy-vue-side-bar-header). ComfyUI's CSS custom properties live on :root,
   so elements inside our root still inherit them; the literal fallbacks are
   the measured dark-theme values. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  NS.css = `
/* ---- 1. hide ALL of ComfyUI's UI in canvas mode -------------------------
   ComfyUI (and Reka UI dialogs) may set document.body.style.pointerEvents =
   'none' while a modal is open. Our root must opt back in explicitly, and
   tour overlays must not sit on top of the canvas. Nothing here is removed
   from the DOM, so exiting restores everything.

   Exception: .z-overlay is DialogPortal.vue's container
   ('pointer-events-none fixed inset-0 z-overlay *:pointer-events-auto
   empty:hidden') and .z-toast is the toast dock. We call ComfyUI's own
   extensionManager.dialog.confirm / .prompt / .toast, so these stay visible
   and above our root -- the dialogs ARE ComfyUI's, not a reimplementation.
   Dialogs that were already open before entering canvas mode are tagged with
   data-infcanvas-suppressed and stay hidden (see infcanvas-core.js). */
html.infcanvas-mode body > div:not(#infcanvas-root):not(#splash-loader):not(.litemenu):not(.graphdialog):not(.litegraph-contextmenu):not(.z-overlay) {
  visibility: hidden !important;
  pointer-events: none !important;
}
html.infcanvas-mode body > div.z-overlay {
  visibility: visible !important;
  z-index: 2147483000 !important;
}
html.infcanvas-mode body > div.z-overlay > [data-infcanvas-suppressed] {
  visibility: hidden !important;
  pointer-events: none !important;
}
html.infcanvas-mode .z-toast {
  visibility: visible !important;
  z-index: 2147483000 !important;
}
html.infcanvas-mode .z-toast * { visibility: visible !important; }
html.infcanvas-mode .litemenu,
html.infcanvas-mode .graphdialog,
html.infcanvas-mode .litegraph-contextmenu {
  visibility: visible !important;
  pointer-events: auto !important;
  z-index: 2147483000 !important;
}

/* ---- 2. canvas mode root (fully owned by this extension) ---------------- */
#infcanvas-root {
  position: fixed; inset: 0; z-index: 20000;
  pointer-events: auto !important;
  display: flex; flex-direction: column;
  background: var(--ic-input, #171718);
  color: var(--ic-text, #ffffff);
  font-family: Inter, Arial, sans-serif;
  font-size: 16px;
  box-sizing: border-box;
}
#infcanvas-root *, #infcanvas-root *::before, #infcanvas-root *::after { box-sizing: border-box; }
#infcanvas-root button { font-family: inherit; }
/* ComfyUI's border/50 (used on the tab bar, rail and panel header) */
#infcanvas-root {
  --ic-border-50: color-mix(in srgb, var(--border, #494a50) 50%, transparent);
  --ic-shadow: 1px 1px 8px 0 rgba(0, 0, 0, .4);

  /* ---- ONE shared palette for every surface in canvas mode ----
     All aliases resolve to ComfyUI's own design tokens, so the canvas follows
     the host theme (dark/light) instead of shipping a second hardcoded theme.
     Dialogs, side panels, tool windows and node widgets all reference these. */
  /* Hairlines are translucent (ComfyUI's own border/50 pattern). A solid
     #494a50 1px line around EVERY control reads as a spreadsheet, not a UI. */
  --ic-line: color-mix(in srgb, var(--border, #494a50) 42%, transparent);
  --ic-panel: var(--secondary-background, #262729);
  --ic-input: var(--background, #171718);
  --ic-text: var(--base-foreground, #ffffff);
  --ic-soft: var(--muted-foreground, #8a8a8a);
  --ic-brand: var(--primary, #0b8ce9);
  --ic-danger: var(--destructive, #b33a3a);
  --ic-hover: color-mix(in srgb, var(--muted, #3c3d42) 55%, transparent);
  --ic-brand-soft: color-mix(in srgb, var(--primary, #0b8ce9) 14%, transparent);
  --ic-brand-ring: color-mix(in srgb, var(--primary, #0b8ce9) 26%, transparent);
  --ic-danger-soft: color-mix(in srgb, var(--destructive, #b33a3a) 16%, transparent);

  /* Flat panels need a hint of depth: a 1px top highlight + a soft shadow. */
  --ic-hi: inset 0 1px 0 rgba(255,255,255,.045);
  --ic-shadow-card: 0 8px 26px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.035);
  --ic-shadow-pop: 0 18px 48px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.05);

  /* ---- ONE shared control spec ---- */
  --ic-ctrl-h: 30px;       /* buttons, inputs, selects, chips */
  --ic-ctrl-r: 8px;        /* control corner radius */
  --ic-ctrl-fs: 12px;      /* control font size */
  --ic-radius: 12px;       /* cards / blocks (matches the 12px node card) */
  --ic-radius-lg: 16px;    /* dialog shells */
}
@supports not (color: color-mix(in srgb, red 50%, transparent)) {
  #infcanvas-root { --ic-border-50: rgba(73, 74, 80, .5); }
}

/* ---- 3. workflow-style tab bar ------------------------------------------
   ComfyUI: .workflow-tabs-container = h 38px, bg-background, border-b
   border/50, shadow-md; inner flex gap 4px px 4px. TabsTrigger = full height,
   radius 8px, no border, padding 8px 8px 8px 12px, gap 8px, 14px text,
   active bg-secondary + text-foreground, inactive text-muted-foreground. */
#infcanvas-tabbar {
  display: flex; align-items: center; flex: 0 0 auto;
  height: var(--workflow-tabs-height, 2.375rem);
  padding: 0 4px; gap: 4px;
  background: var(--ic-input, #171718);
  border-bottom: 1px solid var(--ic-border-50);
  box-shadow: var(--ic-shadow);
  overflow: hidden;
}
#infcanvas-tabs { display: flex; align-items: center; gap: 4px; height: 100%; flex: 1 1 auto; min-width: 0; overflow: hidden; }
.ic-tab-strip { display: flex; align-items: center; gap: 4px; height: 100%; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
/* WorkflowTab.vue: active tab is shrink-0 and shows the full label; inactive
   tabs shrink to a fixed width and truncate. The label is followed by a
   size-4 shrink-0 status slot; the close button is absolutely positioned
   over that slot (right-2), so it never covers the label text. */
.ic-tab {
  position: relative; display: inline-flex; align-items: center; gap: 8px;
  height: 100%; min-width: 90px; width: 160px; flex: 0 1 160px;
  padding: 8px 8px 8px 12px;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--ic-soft, #8a8a8a);
  font-family: Inter, sans-serif; font-size: 14px; font-weight: 400;
  line-height: 1; white-space: nowrap;
  transition: all .2s cubic-bezier(.4, 0, .2, 1);
  cursor: pointer; user-select: none;
}
.ic-tab:hover { background: color-mix(in srgb, var(--ic-panel, #262729) 50%, transparent); }
.ic-tab.is-active {
  flex: 0 0 auto; width: auto; min-width: 90px;
  background: var(--ic-panel, #262729); color: var(--ic-text, #ffffff);
}
.ic-tab .ic-label {
  display: inline-block; flex: 1 1 auto; min-width: 0; max-width: 150px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: Inter, sans-serif; font-size: 14px; font-weight: 400; line-height: 1;
}
.ic-tab.is-active .ic-label { flex: 0 0 auto; max-width: none; }
.ic-status {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; flex: 0 0 16px;
}
.ic-tab .ic-dot {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--ic-soft, #8a8a8a);
}
.ic-tab.is-active .ic-dot { background: var(--ic-text, #ffffff); }
.ic-tab:hover .ic-status, .ic-tab:focus-within .ic-status { visibility: hidden; }
.ic-tab .ic-close {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; padding: 0; border: 0; border-radius: 0;
  background: transparent; color: var(--ic-soft, #8a8a8a);
  font-size: 14px; opacity: 0; cursor: pointer;
}
.ic-tab .ic-close i { font-size: 14px; }
/* closeButtonVisibility: active + no status dot is always visible; otherwise
   hover/focus hides the dot and reveals the close button. */
.ic-tab.is-active:not(.has-status) .ic-close,
.ic-tab:hover .ic-close,
.ic-tab:focus-within .ic-close { opacity: 1; }
.ic-tab .ic-close:hover { color: var(--ic-text, #ffffff); }
.ic-tab-add {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex: 0 0 auto;
  border: 0; border-radius: 8px; background: transparent;
  color: var(--ic-soft, #8a8a8a); font-size: 14px; cursor: pointer;
  transition: background-color .1s cubic-bezier(.4, 0, .2, 1), color .1s cubic-bezier(.4, 0, .2, 1);
}
.ic-tab-add i { font-size: 14px; }
.ic-tab-add:hover { background: var(--ic-hover, #313235); color: var(--ic-text, #ffffff); }

#infcanvas-body { display: flex; flex: 1 1 auto; min-height: 0; position: relative; }

/* ---- 4. left rail: SideToolbar.vue / SidebarIcon.vue --------------------
   The rail and its buttons carry ComfyUI's own class names, so button
   variants, --sidebar-* tokens, hover and .side-bar-button-selected all come
   from the host stylesheet. Only the flex geometry belongs to us. */
#infcanvas-sidebar {
  flex: 0 0 var(--sidebar-width, 56px);
  width: var(--sidebar-width, 56px);
  display: flex; flex-direction: column; align-items: center;
  padding: var(--sidebar-padding, 4px) 0;
  background: var(--ic-input, #171718);
  border-right: 1px solid var(--ic-border-50);
  box-shadow: var(--ic-shadow);
  overflow: hidden; z-index: 2;
}
.ic-side-btn { position: relative; }
.ic-tip {
  position: absolute; left: calc(100% + 10px); top: 50%; transform: translateY(-50%);
  padding: 6px 10px; border-radius: 8px; border: 1px solid var(--ic-border-50);
  background: var(--ic-panel, #262729); color: var(--ic-text, #ffffff);
  font-size: 12px; line-height: 16px; white-space: nowrap;
  opacity: 0; pointer-events: none; transition: opacity .15s ease;
  box-shadow: var(--ic-shadow); z-index: 30;
}
.ic-side-btn:hover .ic-tip { opacity: 1; }

/* ---- 5. drawer: LiteGraphCanvasSplitterOverlay.vue ----------------------
   Measured in a real browser: .side-bar-panel has transition-duration 0s and
   getAnimations() == 0 -- the width changes instantly (reka-ui splitter sets
   flex: 20.4 1 0 => 311.5px at 1600px, right of the 56px rail). The only
   animation is .sidebar-content-container's opacity over 200ms ease-in-out.
   Header/body classes come from SidebarTabTemplate.vue.

   Layout: GraphCanvas.vue renders <canvas id="graph-canvas"
   class="absolute inset-0 size-full"> and the whole splitter tree as a
   SEPARATE absolute overlay (LiteGraphCanvasSplitterOverlay.vue root =
   "pointer-events-none absolute top-0 left-0 z-999 flex size-full").
   Measured in 1.59.1: opening the panel leaves #graph-canvas at exactly
   the same rect (0,0,1584,849). So the panel overlays the canvas instead of
   shrinking it. Our stage/panel/handle mirror that relationship: the stage
   is absolutely positioned and never resized by the panel. */
#infcanvas-panel {
  position: absolute; top: 0; bottom: 0;
  left: var(--sidebar-width, 56px);
  width: var(--infcanvas-panel-width, 312px);
  display: none; overflow: hidden;
  background: var(--ic-input, #171718);
  z-index: 3;
}
/* --infcanvas-panel-width is set on #infcanvas-root by attachPanelResizer():
   the pixel width restored from localStorage / clamped while dragging. */
#infcanvas-root.has-panel #infcanvas-panel { display: block; }
#infcanvas-panel > .sidebar-content-container { opacity: 0; }
#infcanvas-root.has-panel #infcanvas-panel > .sidebar-content-container { opacity: 1; }
#infcanvas-panel-body { min-height: 0; }

/* SplitterResizeHandle.vue: 1px w-px line + 4px ::after hit area rendered by
   the host's own Tailwind classes. Hidden while no side panel is mounted,
   exactly like :disabled="!firstPanelRendered" + 'hidden' in the overlay.
   It sits on the overlay too, at the panel's right edge. */
#infcanvas-panel-resize-handle {
  position: absolute; top: 0; bottom: 0;
  left: calc(var(--sidebar-width, 56px) + var(--infcanvas-panel-width, 312px));
  width: 1px; display: none; z-index: 4;
}
#infcanvas-root.has-panel #infcanvas-panel-resize-handle { display: flex; }
/* reka-ui injects a global '*{cursor:ew-resize!important}' style during drag;
   keeping it inside our root avoids leaking into ComfyUI's own UI. */
#infcanvas-root.is-resizing,
#infcanvas-root.is-resizing * { cursor: ew-resize !important; }

/* #graph-canvas equivalent: absolutely positioned, full height, and NOT part
   of the panel's flex row, so opening/closing/resizing a side panel never
   changes its rect (nor triggers resizeSurface / shifts graph coordinates). */
#infcanvas-stage {
  position: absolute; top: 0; right: 0; bottom: 0;
  left: var(--sidebar-width, 56px);
  overflow: hidden;
}
/* The graph surface itself is Vue Flow (#infcanvas-vueflow); its layout and the
   node chrome live in js/infcanvas-flow.js, next to the components they style. */

/* ---- 6. panel content: ComfyUI palette for list / asset grid ------------ */
.ic-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px 0 16px; color: var(--ic-text, #ffffff); font-size: 14px; }
.ic-hint { color: var(--ic-soft, #8a8a8a); font-size: 12px; line-height: 1.6; padding: 0 16px; }
.ic-section {
  display: flex; align-items: center; gap: 8px; min-height: 32px;
  padding: 0 16px; color: var(--ic-soft, #8a8a8a);
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
}
.ic-row { display: flex; align-items: center; gap: 8px; padding: 0 16px; }
.ic-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: var(--ic-ctrl-h, 30px); padding: 0 12px;
  border: 1px solid var(--ic-line, #494a50); border-radius: var(--ic-ctrl-r, 7px);
  background: var(--ic-panel, #262729); color: var(--ic-text, #ffffff);
  font-size: var(--ic-ctrl-fs, 12px); font-weight: 400; white-space: nowrap; cursor: pointer;
  transition: background-color .1s cubic-bezier(.4, 0, .2, 1), color .1s cubic-bezier(.4, 0, .2, 1);
}
.ic-btn:hover:not(:disabled) { border-color: var(--ic-brand, #0b8ce9); color: var(--ic-brand, #0b8ce9); }
.ic-btn:disabled { opacity: .45; cursor: default; }
.ic-btn i { font-size: 14px; }
.ic-btn.danger:hover:not(:disabled) {
  border-color: var(--ic-danger, #b33a3a); background: var(--ic-danger-soft, rgba(179,58,58,.16));
  color: var(--ic-danger, #b33a3a);
}
.ic-btn.tiny { width: var(--ic-ctrl-h, 30px); height: var(--ic-ctrl-h, 30px); padding: 0; font-size: var(--ic-ctrl-fs, 12px); }
.ic-list { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
.ic-item {
  display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px;
  padding: 8px; border: 0; border-radius: var(--ic-ctrl-r, 7px); background: transparent;
  color: var(--ic-text, #ffffff); text-align: left; font-size: 14px; cursor: pointer;
  transition: background-color .1s cubic-bezier(.4, 0, .2, 1);
}
.ic-item:hover { background: var(--ic-hover, #313235); }
.ic-item .ic-item-title { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ic-item .ic-item-desc { color: var(--ic-soft, #8a8a8a); font-size: 12px; white-space: nowrap; }
.ic-item i { width: 16px; text-align: center; font-size: 14px; color: var(--ic-soft, #8a8a8a); }
.ic-item .ic-btn { margin-left: auto; }
.ic-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 8px 16px 0; }
.ic-card {
  position: relative; border: 1px solid var(--ic-line, #494a50); border-radius: var(--ic-radius, 10px);
  overflow: hidden; background: var(--ic-panel, #262729); cursor: grab;
}
.ic-card:hover { border-color: var(--ic-brand, #0b8ce9); }
.ic-card .ic-thumb { width: 100%; aspect-ratio: 1 / 1; object-fit: cover; display: block; background: var(--ic-input, #171718); }
.ic-card .ic-thumb-icon { display: flex; align-items: center; justify-content: center; aspect-ratio: 1 / 1; font-size: 24px; color: var(--ic-soft, #8a8a8a); }
.ic-card .ic-thumb-icon i { font-size: 24px; }
.ic-card .ic-card-label { display: block; padding: 6px 8px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ic-empty { padding: 24px 16px; color: var(--ic-soft, #8a8a8a); text-align: center; line-height: 1.6; font-size: 14px; }
/* ---- 7. tab context menu: ComfyUI menu surface ------------------------- */
/* menuStyles.ts: menuContentClass = min-w-48 rounded-lg border bg-background
   p-1 text-foreground shadow-lg (WorkflowTab.vue adds min-w-56 = 224px);
   menuItemClass = flex min-h-8 items-center gap-2 rounded-md px-3 py-1.5
   text-sm; MenuSeparator.vue = my-1 h-px bg-border/50. */
.ic-menu {
  position: fixed; z-index: 2400; min-width: 224px; padding: 4px;
  border-radius: 8px; border: 1px solid var(--ic-border-50);
  background: var(--ic-input, #171718);
  color: var(--ic-text, #ffffff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .45);
  font-family: Inter, Arial, sans-serif; font-size: 14px; font-weight: 400;
}
.ic-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  min-height: var(--ic-ctrl-h, 30px); padding: 6px 12px; border: 0; border-radius: var(--ic-ctrl-r, 7px);
  background: transparent; color: var(--ic-text, #ffffff);
  text-align: left; font-family: inherit; font-size: 14px; font-weight: 400;
  line-height: 1; cursor: pointer;
}
.ic-menu-item:hover:not(:disabled), .ic-menu-item:focus-visible:not(:disabled) { background: var(--ic-hover, #313235); }
.ic-menu-item:disabled { opacity: .5; cursor: default; }
.ic-menu-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: 0 0 16px; }
.ic-menu-icon > i:first-child { font-size: 14px; }
.ic-menu-subicon { position: absolute; right: -3px; bottom: -3px; font-size: 8px; line-height: 1; }
.ic-menu-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ic-menu-sep { height: 1px; margin: 4px 0; background: var(--ic-border-50); }
/* Double-click node menu (#infcanvas-node-menu): MenuLabel.vue's caption --
   12px, muted, 500 weight, px-2 -- plus a narrower width than the tab menu. */
.ic-node-menu { min-width: 176px; }
.ic-menu-section {
  padding: 4px 12px 2px; color: var(--ic-soft, #8a8a8a);
  font-size: 12px; font-weight: 500; line-height: 16px;
}

/* ---- 8. bottom-right canvas controls -----------------------------------
   Zero local rules: .floating-panel (radius var(--radius-xl), padding
   var(--spacing), bg-background, inset-highlight shadow) draws the tray, the
   buttons reuse the exact final class lists of button.variants.ts, the zoom
   popover's number field reuses FormNumberField.vue's classes, and the minimap
   settings panel reuses Checkbox.vue's. Everything follows the host theme. */
.ic-controls { font-family: Inter, Arial, sans-serif; }
`;
})();
