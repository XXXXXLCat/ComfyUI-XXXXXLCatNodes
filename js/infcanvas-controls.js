/* Bottom-right canvas controls: floating toolbar + minimap panel.

   Mirrors comfyui_frontend 1.59.1:
     src/components/graph/GraphCanvasMenu.vue        -> toolbar (mode selector,
       divider, fit view, zoom %, divider, minimap toggle, link visibility)
     .../CanvasModeSelector.vue                      -> select / hand popover
     .../modals/ZoomControlsModal.vue                -> zoom popup (in / out /
       fit + percentage field, press-and-hold repeats every 100ms)
     .../MiniMap.vue + MiniMapPanel.vue              -> 253x200 minimap, header
       rule, settings / close buttons, viewport outline, drag + wheel navigation
     useMinimapViewport.ts / useMinimapInteraction.ts / minimapCanvasRenderer.ts
     boundsCalculator.ts                             -> drawing + hit geometry
     design-system/button.variants.ts                 -> button class strings

   Zero CSS is copied: every surface, radius, colour and spacing comes from the
   host stylesheet (floating-panel, z-1200, size-8, bg-accent, icon-[lucide--*])
   and from :root custom properties, so light/dark themes follow ComfyUI. Only
   the number field and the "pressed" background need local rules, because the
   host renders those through Vue components. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const api = () => NS.api;

  /* Button.vue renders cn(buttonVariants({ variant: 'secondary', size: 'md' }),
     customClass). cn() is tailwind-merge: it DROPS the utilities the call site
     overrides. The strings below are therefore the final class lists ComfyUI
     itself renders (read off the live DOM of frontend 1.59.1), not a
     concatenation of base + override -- concatenating keeps both `rounded-md`
     and `rounded-lg`, both `p-2` and `p-0`, and Tailwind's stylesheet order
     decides the winner (.rounded-md is emitted after .rounded-lg, .p-2 after
     .p-0), which made the mode trigger 70px wide with 8px padding instead of
     the native 54px with none. */
  const BTN_BASE =
    "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
    "items-center justify-center gap-2 border-none font-inter " +
    "text-sm font-medium whitespace-nowrap transition-colors " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 " +
    "[&_svg:not([width]):not([height])]:size-4";
  /* size md ('h-8 rounded-lg p-2 text-xs') with the overrides already merged. */
  const BTN_ICON =
    BTN_BASE + " text-foreground hover:bg-accent rounded-lg text-xs size-8 " +
    "bg-transparent p-0";
  const BTN_ZOOM =
    BTN_BASE + " text-foreground rounded-lg text-xs h-8 w-15 bg-transparent " +
    "p-0 hover:bg-accent";
  /* CanvasModeSelector.vue: rounded-none! + hover:rounded-lg! so the trigger
     stays flush with the panel edge until hovered. */
  const BTN_MODE = BTN_BASE +
    " text-foreground h-8 rounded-lg text-xs group rounded-none! " +
    "bg-transparent p-0 transition-none! hover:rounded-lg! hover:bg-accent!";
  /* variant 'muted-textonly' + size 'icon' (MiniMap.vue's header buttons). */
  const BTN_MUTED_ICON =
    BTN_BASE + " bg-transparent text-muted-foreground hover:bg-accent " +
    "size-8 rounded-lg";
  /* GraphCanvasMenu.vue marks an engaged toggle with not-active:bg-muted
     ("muted while not pressed"); the rule is already in the host CSS. */
  const THEME_ON = "not-active:bg-muted";
  /* GraphCanvas.vue insets #graph-canvas-panel by ml/mr/mb
     var(--comfy-canvas-gutter) (= calc(.25rem * 2) = 8px), and everything that
     anchors to the canvas edge -- GraphCanvasMenu (bottom-0), MiniMap
     (bottom-[54px]), ZoomControlsModal (bottom-[62px]) -- is positioned
     against that inset panel, i.e. 8px inside the visible canvas. */
  const GUTTER = "var(--comfy-canvas-gutter, 8px)";

  const MINIMAP_WIDTH = 253;
  const MINIMAP_HEIGHT = 200;
  const ZOOM_STEP = 1.1;
  /* Must stay in sync with MIN_ZOOM / MAX_ZOOM in js/infcanvas-flow.js: the
     toolbar clamps here, Vue Flow's d3-zoom clamps there. 10 = 1000%, which is
     also the aria-valuemax of the percentage field and ComfyUI's own limit. */
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10;
  const PREF_VISIBLE = "InfCanvas.MinimapVisible";
  const PREF_LINKS_HIDDEN = "InfCanvas.LinkHidden";
  const PREF_SNAP = "InfCanvas.SnapToGrid";

  const ui = {
    stage: null,
    wrap: null,
    bar: null,
    modeBtn: null,
    modeIcon: null,
    zoomBtn: null,
    zoomLabel: null,
    mapBtn: null,
    snapBtn: null,
    snapOn: false,
    linksBtn: null,
    zoomPop: null,
    modePop: null,
    minimap: null,
    repeat: 0,
    scaleText: "",
    readOnlyIcon: null,
    linksHidden: null,
    linksReady: false,
    fieldEditing: false,
  };

  /* ------------------------------- helpers -------------------------------- */

  function el(tag, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  function icon(name, extra) {
    const glyph = el("i", "icon-[lucide--" + name + "] " + (extra || "size-4"));
    glyph.setAttribute("aria-hidden", "true");
    return glyph;
  }

  function ext() {
    return (window.comfyAPI?.app?.app || NS.app)?.extensionManager;
  }

  function setting(key, fallback) {
    try {
      const value = ext()?.setting?.get(key);
      return value === undefined || value === null ? fallback : value;
    } catch (error) { return fallback; }
  }

  function readPref(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (error) { return null; }
  }

  function writePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) { /* storage unavailable */ }
  }

  /* The canvas engine is Vue Flow. Everything below reads the flow viewport
     instead of LiteGraph's ds (offset/scale). */
  function flowApi() { return NS.flow || null; }
  function zoom() { return flowApi()?.getViewport?.().zoom || 1; }
  function hasNodes() { return (flowApi()?.nodesOf?.() || []).length > 0; }

  /* comfyui_frontend formats key sequences with
     useCommandStore().formatKeySequence(commandStore.getCommand(id)).toUpperCase().
     The extension API only exposes commandStore.execute (no getCommand, no
     formatKeySequence), so the bindings cannot be formatted at runtime. The
     strings below are what this build (frontend 1.59.1) actually renders: read
     from the native zoom popover rows ("Alt + =", "Alt + -", "."), the native
     canvas-mode menu ("V", "H") and the native toolbar aria-labels
     ("适应视图 (.)", "隐藏小地图 (ALT + SHIFT + M)"). A user rebinding these
     shortcuts in ComfyUI's settings will not be reflected here. */
  const SHORTCUTS = {
    "Comfy.Canvas.FitView": ".",
    "Comfy.Canvas.ZoomIn": "Alt + =",
    "Comfy.Canvas.ZoomOut": "Alt + -",
    "Comfy.Canvas.Unlock": "V",
    "Comfy.Canvas.Lock": "H",
    "Comfy.Canvas.ToggleMinimap": "Alt + Shift + M",
  };

  function shortcutText(id) {
    const known = SHORTCUTS[id];
    if (known) return known;
    /* Older/newer builds may expose the store method after all. */
    try {
      const store = ext()?.command;
      const format = store?.formatKeySequence;
      const command = store?.getCommand?.(id);
      if (typeof format === "function" && command) {
        return format(command) || "";
      }
    } catch (error) { /* optional */ }
    return "";
  }

  /* ------------------------------ toolbar --------------------------------- */

  /* GraphCanvasMenu.vue hands every button :style="stringifiedMinimapStyles
     .buttonStyles", i.e. { borderRadius: '8px', border: 'none' } lifted from
     the minimap container. It is inline, so it is the radius the toolbar
     actually ends up with; only the mode trigger overrides it (rounded-none! is
     !important and beats inline). Reproducing that inline pair keeps the radius
     correct no matter how Tailwind ordered its radius utilities. */
  function styledButton(className) {
    const button = el("button", className);
    button.type = "button";
    button.style.borderRadius = "8px";
    button.style.border = "none";
    return button;
  }

  function iconButton(iconName, label) {
    const button = styledButton(BTN_ICON);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.appendChild(icon(iconName));
    return button;
  }

  function divider() {
    return el("div", "h-[27px] w-px self-center bg-border");
  }

  function buildToolbar() {
    /* CanvasModeSelector.vue: rounded-none! + hover:rounded-lg! so the trigger
       stays flush with the panel edge until hovered; the current mode glyph
       sits on its own bg-muted chip and the whole 54x32 button turns accent
       (bg-accent! + group-hover:bg-accent) while hovered. */
    const mode = styledButton(BTN_MODE);
    mode.title = "画布模式";
    mode.setAttribute("aria-label", "画布模式");
    mode.setAttribute("aria-haspopup", "menu");
    mode.setAttribute("aria-expanded", "false");
    const modeInner = el("div", "flex items-center gap-1 pr-0.5");
    const chip = el("div", "rounded-lg bg-muted p-2 group-hover:bg-accent");
    const modeIcon = icon("mouse-pointer-2", "block size-4");
    chip.appendChild(modeIcon);
    modeInner.append(chip, icon("chevron-down", "block size-4 pr-1.5"));
    mode.appendChild(modeInner);

    /* GraphCanvasMenu.vue: <Button size-8 bg-transparent p-0> with
       icon-[lucide--focus] for Comfy.Canvas.FitView. Native aria-label /
       tooltip is "适应视图 (.)". */
    const fit = iconButton("focus", "适应视图 (" + shortcutText("Comfy.Canvas.FitView") + ")");

    /* Percentage trigger: h-8 w-15, the label and chevron in one text-xs row. */
    const zoom = styledButton(BTN_ZOOM);
    zoom.title = "缩放控制";
    zoom.setAttribute("aria-label", "缩放控制");
    zoom.setAttribute("data-testid", "zoom-controls-button");
    const zoomInner = el("span", "inline-flex items-center gap-1 px-2 text-xs");
    const zoomLabel = el("span");
    zoomLabel.textContent = "100%";
    zoomInner.append(zoomLabel, icon("chevron-down"));
    zoom.appendChild(zoomInner);

    const map = iconButton("map", "显示小地图");
    const snap = iconButton("grid-3x3", "网格吸附");
    const links = iconButton("route-off", "隐藏链接");

    const bar = el("div",
      "pointer-events-auto ml-auto flex max-w-full min-w-0 gap-1 " +
      "overflow-x-auto floating-panel");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "画布工具栏");
    bar.append(mode, divider(), fit, zoom, divider(), map, snap, links);
    bar.addEventListener("wheel", onToolbarWheel, { passive: false });

    ui.modeBtn = mode;
    ui.modeIcon = modeIcon;
    ui.zoomBtn = zoom;
    ui.zoomLabel = zoomLabel;
    ui.mapBtn = map;
    ui.snapBtn = snap;
    ui.linksBtn = links;
    ui.bar = bar;

    mode.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleModePop();
    });
    fit.addEventListener("click", fitView);
    zoom.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleZoomPop();
    });
    map.addEventListener("click", toggleMinimap);
    snap.addEventListener("click", toggleSnap);
    links.addEventListener("click", toggleLinks);

    return bar;
  }

  /* GraphCanvasMenu.vue puts @wheel="canvasInteractions.handleWheel" on the
     toolbar, so scrolling over it zooms the graph behind it. */
  function onToolbarWheel(event) {
    /* Forward the wheel to Vue Flow's pane so scrolling over the toolbar zooms
       the graph behind it, exactly like GraphCanvasMenu.vue does. */
    const pane = flowHost()?.querySelector(".vue-flow__pane");
    if (!pane) return;
    event.preventDefault();
    pane.dispatchEvent(new WheelEvent("wheel", {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
      clientX: event.clientX, clientY: event.clientY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey,
      bubbles: true, cancelable: true,
    }));
  }

  /* --------------------------- select / hand ------------------------------ */

  /* CanvasModeSelector.vue: a two-item radio menu (select / hand) that maps to
     Comfy.Canvas.Unlock / Comfy.Canvas.Lock, i.e. canvas.read_only. */
  function toggleModePop() {
    if (ui.modePop?.isConnected) { closePops(); return; }
    closePops();
    const readOnly = flowApi()?.state?.mode?.value === "drag";

    /* PopoverContent.vue defaults (z-overlay w-72 rounded-md p-4 shadow-md)
       merged by cn() with menuContentClass (min-w-48 rounded-lg border
       bg-background p-1 shadow-lg) and CanvasModeSelector's own
       (w-auto min-w-39 select-none, animations disabled). Net result measured
       in the browser: 156px wide, 4px padding, 8px radius, 1px border. */
    const pop = el("div",
      "absolute z-1300 w-auto min-w-39 max-w-full select-none overflow-y-auto " +
      "rounded-lg border bg-background p-1 text-foreground shadow-lg outline-none");
    pop.setAttribute("role", "menu");
    pop.setAttribute("aria-label", "画布模式");

    const items = [
      { id: "Comfy.Canvas.Unlock", icon: "mouse-pointer-2", label: "选择", active: !readOnly, readOnly: false },
      { id: "Comfy.Canvas.Lock", icon: "hand", label: "拖拽", active: readOnly, readOnly: true },
    ];
    for (const item of items) {
      /* menuButtonClass + 'justify-between' after cn(): one min-height, one
         padding, one radius, one justify. */
      const button = el("button",
        "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md " +
        "px-3 py-1.5 text-sm outline-none border-0 bg-transparent text-left " +
        "whitespace-nowrap hover:bg-accent focus-visible:bg-accent " +
        "disabled:pointer-events-none disabled:opacity-50 justify-between");
      button.type = "button";
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-checked", item.active ? "true" : "false");
      button.setAttribute("aria-label", item.label);
      button.setAttribute("tabindex", item.active ? "0" : "-1");
      const head = el("div", "flex items-center gap-2");
      head.append(icon(item.icon), el("span"));
      head.lastChild.textContent = item.label;
      button.appendChild(head);
      const hint = shortcutText(item.id);
      if (hint) {
        const span = el("span", "text-[9px] text-foreground");
        span.textContent = hint;
        span.setAttribute("data-testid", "shortcut-hint");
        button.appendChild(span);
      }
      button.addEventListener("click", () => {
        setReadOnly(item.readOnly);
        closePops();
      });
      pop.appendChild(button);
    }

    ui.modeBtn.setAttribute("aria-expanded", "true");
    ui.modePop = pop;
    placeAbove(pop, ui.modeBtn);
    dismissLater(pop, ui.modeBtn);
  }

  /* Anchored inside the stage (never <body>: canvas mode hides every body-level
     sibling of #infcanvas-root). reka-ui PopoverContent defaults to
     align="center" + side="top" + sideOffset=8 + collisionPadding=8, so the
     menu is centred on the trigger and only shifts to stay 8px inside the
     stage. */
  function placeAbove(pop, anchor) {
    ui.stage.appendChild(pop);
    const rect = anchor.getBoundingClientRect();
    const stageRect = ui.stage.getBoundingClientRect();
    const box = pop.getBoundingClientRect();
    const triggerCentre = rect.left - stageRect.left + rect.width / 2;
    const left = Math.max(8, Math.min(
      triggerCentre - box.width / 2,
      stageRect.width - box.width - 8
    ));
    pop.style.position = "absolute";
    pop.style.left = left + "px";
    pop.style.bottom = (stageRect.bottom - rect.top + 8) + "px";
  }

  function setReadOnly(value) {
    flowApi()?.setMode?.(value ? "drag" : "select");
    syncModeIcon();
  }

  function syncModeIcon() {
    const readOnly = flowApi()?.state?.mode?.value === "drag";
    if (ui.readOnlyIcon === readOnly) return;
    ui.readOnlyIcon = readOnly;
    if (!ui.modeIcon) return;
    /* CanvasModeSelector.vue keeps the trigger labelled 画布模式 in both modes;
       only the glyph (and the checkmark inside the open menu) follows. */
    ui.modeIcon.className = readOnly
      ? "icon-[lucide--hand] block size-4"
      : "icon-[lucide--mouse-pointer-2] block size-4";
    for (const item of ui.modePop?.querySelectorAll("[role=menuitemradio]") || []) {
      const isHand = item.getAttribute("aria-label") === "拖拽";
      const active = isHand === readOnly;
      item.setAttribute("aria-checked", active ? "true" : "false");
      item.setAttribute("tabindex", active ? "0" : "-1");
    }
  }

  /* ------------------------------ zoom popup ------------------------------ */

  function toggleZoomPop() {
    /* The reference can outlive the element (the stage is rebuilt on re-enter),
       so treat a detached popup as closed instead of swallowing the click. */
    if (ui.zoomPop?.isConnected) { closePops(); return; }
    closePops();

    /* ZoomControlsModal.vue: root is absolute right-0 bottom-[62px] z-1300
       flex w-[250px] justify-center border-0! bg-inherit! -- anchored to the
       gutter-inset graph canvas panel, so its right edge is 8px inside the
       canvas and it sits 62px above the panel's bottom edge (62 + gutter from
       the canvas edge). The card inside is w-4/5 (= 200px) rounded-lg border
       bg-background p-2 shadow-lg + inline
       { border: 1px solid var(--border); border-radius: 8px }. */
    const pop = el("div",
      "absolute z-1300 flex w-[250px] justify-center border-0! bg-inherit!");
    pop.style.right = GUTTER;
    pop.style.bottom = "calc(62px + " + GUTTER + ")";
    pop.setAttribute("data-testid", "zoom-controls-popup");
    const panel = el("div",
      "w-4/5 rounded-lg border bg-background p-2 text-foreground shadow-lg select-none");
    panel.style.border = "1px solid var(--border)";
    panel.style.borderRadius = "8px";
    panel.addEventListener("click", (event) => event.stopPropagation());
    const column = el("div", "flex flex-col gap-1");
    column.append(
      zoomRow("放大", "zoom-in-action", "Comfy.Canvas.ZoomIn", () => zoomBy(ZOOM_STEP), true),
      zoomRow("缩小", "zoom-out-action", "Comfy.Canvas.ZoomOut", () => zoomBy(1 / ZOOM_STEP), true),
      zoomRow("适合画面", "zoom-to-fit-action", "Comfy.Canvas.FitView", fitView, false),
      zoomField()
    );
    panel.appendChild(column);
    pop.appendChild(panel);
    ui.stage.appendChild(pop);
    ui.zoomPop = pop;
    ui.zoomBtn.classList.add(THEME_ON);
    /* watch() in ZoomControlsModal.vue focuses the number field on open. */
    const input = pop.querySelector("input");
    if (input) input.focus();
    dismissLater(pop, ui.zoomBtn);
  }

  function zoomRow(label, testId, commandId, action, repeat) {
    const row = el("div",
      "flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-sm hover:bg-accent");
    row.setAttribute("data-testid", testId);
    const text = el("span", "font-medium");
    text.textContent = label;
    row.appendChild(text);
    const hint = shortcutText(commandId);
    if (hint) {
      const span = el("span", "text-[9px]");
      span.textContent = hint;
      row.appendChild(span);
    }
    if (repeat) {
      /* ZoomControlsModal.vue: press-and-hold repeats the command every 100ms. */
      row.addEventListener("mousedown", () => {
        startRepeat(action);
        row.classList.add("bg-accent");
      });
      const stop = () => {
        stopRepeat();
        row.classList.remove("bg-accent");
      };
      row.addEventListener("mouseup", stop);
      row.addEventListener("mouseleave", stop);
    } else {
      row.addEventListener("click", () => action());
    }
    return row;
  }

  /* FormNumberField.vue as rendered inside ZoomControlsModal.vue: a 40px
     bg-secondary pill with a w-6 minus, a centred flex-1 text field, the '%'
     suffix and a w-6 plus. Stepping is 1 (the reka number field default). */
  const FIELD_GROUP =
    "flex h-10 w-full items-center rounded-lg bg-secondary text-foreground " +
    "focus-within:ring-1 focus-within:ring-ring hover:bg-accent " +
    "data-disabled:pointer-events-none data-disabled:opacity-50";
  const FIELD_STEP =
    "flex h-full w-6 shrink-0 cursor-pointer items-center justify-center " +
    "border-none bg-transparent text-muted-foreground hover:bg-accent " +
    "focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none " +
    "focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-30";

  function zoomField() {
    const group = el("div", FIELD_GROUP);
    group.setAttribute("role", "group");
    group.setAttribute("data-slot", "number-field");
    group.setAttribute("data-testid", "zoom-percentage-input");

    const step = (iconName, side, delta) => {
      const button = el("button", FIELD_STEP + " rounded-" + side + "-lg");
      button.type = "button";
      button.tabIndex = -1;
      button.setAttribute("aria-label", side === "l" ? "减小" : "增加");
      button.setAttribute("data-slot", "number-field-" +
        (side === "l" ? "decrement" : "increment"));
      button.appendChild(icon(iconName));
      button.addEventListener("click", () => setPercentage(percentage() + delta));
      return button;
    };

    const input = el("input");
    /* type=text + inputmode=numeric: the reka field hides the native spinners. */
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className =
      "min-w-0 flex-1 border-none bg-transparent text-center text-base " +
      "text-foreground focus-visible:outline-none";
    input.style.padding = "1px 2px";
    input.value = String(percentage());
    input.setAttribute("role", "spinbutton");
    input.setAttribute("aria-label", "缩放百分比");
    input.setAttribute("aria-valuemin", "1");
    input.setAttribute("aria-valuemax", "1000");
    input.setAttribute("aria-valuenow", String(percentage()));
    input.setAttribute("data-testid", "zoom-percentage-input");
    input.addEventListener("input", () => {
      const digits = input.value.replace(/[^\d]/g, "");
      if (digits !== input.value) input.value = digits;
      const value = Number(digits);
      if (!Number.isFinite(value) || value <= 0) return;
      ui.fieldEditing = true;
      setPercentage(value);
    });
    input.addEventListener("blur", () => {
      ui.fieldEditing = false;
      input.value = String(percentage());
    });
    input.addEventListener("keydown", (event) => {
      /* LiteGraph listens for keys on the document; typing must not reach it. */
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") input.blur();
      if (event.key === "ArrowUp") { event.preventDefault(); setPercentage(percentage() + 1); }
      if (event.key === "ArrowDown") { event.preventDefault(); setPercentage(percentage() - 1); }
    });

    const suffix = el("span", "shrink-0 text-sm");
    suffix.textContent = "%";

    const plus = step("plus", "r", 1);
    const minus = step("minus", "l", -1);
    group.append(minus, input, suffix, plus);
    return group;
  }

  function startRepeat(action) {
    if (ui.repeat) return;
    action();
    ui.repeat = setInterval(action, 100);
  }

  function stopRepeat() {
    if (!ui.repeat) return;
    clearInterval(ui.repeat);
    ui.repeat = 0;
  }

  /* Comfy.Canvas.ZoomIn / ZoomOut: 10% around the canvas centre. */
  function zoomBy(factor) {
    const api = flowApi();
    if (!api) return;
    api.setZoom(Math.max(MIN_SCALE, Math.min(MAX_SCALE, zoom() * factor)));
    syncZoomLabel();
  }

  /* canvasStore.setAppZoomFromPercentage(): percentage of the app scale. */
  function setPercentage(value) {
    const api = flowApi();
    if (!api) return;
    api.setZoom(Math.max(MIN_SCALE, Math.min(MAX_SCALE, value / 100)));
    syncZoomLabel();
  }

  function percentage() {
    return Math.round(zoom() * 100);
  }

  function syncZoomLabel() {
    /* Resolve the label from the live button instead of the cached reference:
       the toolbar can be rebuilt on re-enter, and a stale span would swallow
       every update while the visible one stayed at its initial value. */
    const btn = document.querySelector('#infcanvas-controls [data-testid="zoom-controls-button"]') || ui.zoomBtn;
    const labelEl = btn?.querySelector("span span") || ui.zoomLabel;
    if (!labelEl) return;
    const value = percentage();
    const next = value + "%";
    if (next !== ui.scaleText) {
      ui.scaleText = next;
      labelEl.textContent = next;
    }
    /* ZoomControlsModal.vue's FormNumberField is two-way bound to
       canvasStore.appScalePercentage, so the field follows outside zooming
       (wheel over the graph, fit view, the popup's own rows) while it is open.
       It is not overwritten while the user is typing into it. */
    const input = ui.zoomPop?.querySelector("input");
    if (!input || ui.fieldEditing) return;
    if (input.value !== String(value)) input.value = String(value);
    input.setAttribute("aria-valuenow", String(value));
  }

  /* Comfy.Canvas.FitView: fit every node with a little breathing room. */
  function fitView() {
    const api = flowApi();
    if (!api) return;
    if (!hasNodes()) {
      NS.api?.toast?.("info", "画布中没有节点");
      return;
    }
    /* 0.75 is animateToBounds' fill ratio: the bounds occupy 75% of the
       viewport, leaving the same breathing room ComfyUI's Zoom to fit has. */
    try { api.fitView(0.75); }
    catch (error) { console.warn("[InfCanvas] fit view failed", error); }
  }

  /* ------------------------- link visibility ------------------------------ */

  /* settingStore 'Comfy.LinkRenderMode' is global to ComfyUI. The canvas keeps
     its own copy so toggling here never changes the user's workflow tabs. */
  function flowHost() { return document.querySelector("#infcanvas-vueflow"); }

  function linksHidden() { return !!ui.linksHiddenState; }

  function toggleLinks() {
    ui.linksHiddenState = !ui.linksHiddenState;
    flowHost()?.classList.toggle("ic-hide-edges", ui.linksHiddenState);
    writePref(PREF_LINKS_HIDDEN, ui.linksHiddenState);
    syncLinkButton();
  }

  /* linkVisibilityLabel in GraphCanvasMenu.vue: hideLinks while the links are
     drawn, showLinks once hidden; no shortcut is appended. */
  function syncLinkButton() {
    const hidden = linksHidden();
    if (ui.linksHidden === hidden) return;
    ui.linksHidden = hidden;
    if (!ui.linksBtn) return;
    ui.linksBtn.classList.toggle(THEME_ON, hidden);
    const label = hidden ? "显示链接" : "隐藏链接";
    ui.linksBtn.title = label;
    ui.linksBtn.setAttribute("aria-label", label);
  }

  function applyInitialLinkMode() {
    const stored = readPref(PREF_LINKS_HIDDEN);
    const hidden = stored === null ? false : !!stored;
    ui.linksHiddenState = hidden;
    flowHost()?.classList.toggle("ic-hide-edges", hidden);
    ui.linksHidden = null;
    syncLinkButton();
    return true;
  }

  /* ------------------------------- minimap -------------------------------- */

  /* The minimap is rendered by Vue Flow inside #infcanvas-vueflow; this module
     only owns the toolbar toggle and its persisted preference. */
  function mountMinimap() { return null; }

  /* minimapLabel in GraphCanvasMenu.vue: "显示小地图" / "隐藏小地图" plus the
     uppercased ToggleMinimap sequence, e.g. "隐藏小地图 (ALT + SHIFT + M)". */
  function syncMapButton() {
    if (!ui.mapBtn) return;
    const visible = !!flowApi()?.minimap?.visible?.();
    ui.mapBtn.classList.toggle(THEME_ON, visible);
    const label = (visible ? "隐藏小地图" : "显示小地图") +
      " (" + shortcutText("Comfy.Canvas.ToggleMinimap").toUpperCase() + ")";
    ui.mapBtn.title = label;
    ui.mapBtn.setAttribute("aria-label", label);
  }

  function setMinimapVisible(visible, persist) {
    const api = flowApi();
    if (!api) return;
    api.minimap.set(!!visible);
    if (persist) writePref(PREF_VISIBLE, !!visible);
    syncMapButton();
  }

  function toggleMinimap() { setMinimapVisible(!flowApi()?.minimap?.visible?.(), true); }

  /* ------------------------------ grid snap ------------------------------ */

  /* Grid snap rounds node positions (Vue Flow's snapToGrid) and resize edges
     to the nearest 10px cell -- exactly one square of the 100x100/10px canvas
     background grid. The toggle is a persistent toolbar preference, kept in
     the flow engine so both the toolbar and the node components read one
     source of truth. */
  function snapEnabled() { return !!ui.snapOn; }

  function setSnapEnabled(enabled, persist) {
    ui.snapOn = !!enabled;
    flowApi()?.snap?.set?.(ui.snapOn);
    if (persist) writePref(PREF_SNAP, ui.snapOn);
    syncSnapButton();
  }

  function toggleSnap() { setSnapEnabled(!snapEnabled(), true); }

  function syncSnapButton() {
    if (!ui.snapBtn) return;
    const on = snapEnabled();
    ui.snapBtn.classList.toggle(THEME_ON, on);
    const label = on ? "关闭网格吸附" : "开启网格吸附";
    ui.snapBtn.title = label;
    ui.snapBtn.setAttribute("aria-label", label);
    ui.snapBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function applyInitialSnapMode() {
    const stored = readPref(PREF_SNAP);
    setSnapEnabled(stored === null ? false : !!stored, false);
    return true;
  }

  function closePops() {
    stopRepeat();
    ui.fieldEditing = false;
    if (ui.zoomPop) {
      ui.zoomPop.remove();
      ui.zoomPop = null;
    }
    if (ui.modePop) {
      ui.modePop.remove();
      ui.modePop = null;
    }
    ui.modeBtn?.setAttribute("aria-expanded", "false");
    ui.zoomBtn?.classList.remove(THEME_ON);
  }

  function dismissLater(pop, anchor) {
    /* These listeners outlive the popup they were created for: when a popup is
       closed by the toolbar button (closePops removes the element directly) the
       pair stays on document. Without the isConnected guard a stale listener
       would see `pop.contains(target) === false` for every click and close the
       popup that is currently open -- i.e. the first click inside a freshly
       opened menu would dismiss it. */
    const off = () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const onDown = (event) => {
      if (!pop.isConnected) { off(); return; }
      if (pop.contains(event.target)) return;
      if (anchor?.contains(event.target)) return;
      off();
      closePops();
    };
    const onKey = (event) => {
      if (!pop.isConnected) { off(); return; }
      if (event.key !== "Escape") return;
      off();
      closePops();
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", onDown, true);
      document.addEventListener("keydown", onKey, true);
    }, 0);
  }

  /* ------------------------------ lifecycle ------------------------------- */

  function mount(stage) {
    if (!stage) return null;
    ui.stage = stage;
    if (!ui.wrap) {
      /* GraphCanvasMenu.vue: outer row is `pointer-events-none absolute
         inset-x-0 bottom-0 z-1200 flex`, but it lives inside the graph canvas
         panel that GraphCanvas.vue insets by var(--comfy-canvas-gutter) on the
         right and bottom. Applying that gutter as padding on the row keeps the
         floating panel exactly as far from the canvas edge as ComfyUI's own
         (measured: 8px right, 8px bottom). */
      ui.wrap = el("div",
        "ic-controls pointer-events-none absolute inset-x-0 bottom-0 z-1200 flex");
      ui.wrap.id = "infcanvas-controls";
      ui.wrap.setAttribute("data-testid", "infcanvas-controls");
      ui.wrap.style.paddingRight = GUTTER;
      ui.wrap.style.paddingBottom = GUTTER;
      ui.wrap.appendChild(buildToolbar());
    }
    stage.appendChild(ui.wrap);
    ui.linksReady = applyInitialLinkMode();
    syncModeIcon();
    const stored = readPref(PREF_VISIBLE);
    setMinimapVisible(
      stored === null ? setting("Comfy.Minimap.Visible", true) !== false : !!stored,
      false
    );
    applyInitialSnapMode();
    syncZoomLabel();
    return ui;
  }

  function unmount() {
    closePops();
    ui.wrap?.remove();
    ui.wrap = null;
    ui.bar = null;
    ui.modeBtn = null;
    ui.modeIcon = null;
    ui.zoomBtn = null;
    ui.zoomLabel = null;
    ui.mapBtn = null;
    ui.snapBtn = null;
    ui.linksBtn = null;
    ui.stage = null;
    ui.scaleText = "";
    ui.readOnlyIcon = null;
    ui.linksHidden = null;
    ui.linksReady = false;
  }

  /* Viewport changes arrive through NS.flow.onViewport in core; the labels are
     also refreshed per frame, which covers wheel zoom. */
  function tick() {
    if (!ui.wrap) return;
    if (!ui.linksReady && applyInitialLinkMode()) ui.linksReady = true;
    syncZoomLabel();
    syncModeIcon();
    syncLinkButton();
    syncSnapButton();
  }

  NS.controls = {
    mount, unmount, tick, fitView, toggleMinimap,
    snapEnabled, setSnapEnabled, syncSnapButton,
  };
})();
