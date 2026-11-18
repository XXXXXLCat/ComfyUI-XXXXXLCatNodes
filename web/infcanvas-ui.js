/* UI layer: a standalone canvas-mode shell (tab bar + left rail + drawer panel
   + graph stage). None of these elements live inside ComfyUI's own sidebar or
   topbar: they are mounted under #infcanvas-root, a sibling of #vue-app. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  /* i18n: lazy reference; i18n.js loads after most modules, but every call
     site runs after app init when NS.i18n is available. */
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  /* A few labels cannot be expressed as a dictionary key: the language
     toggle deliberately shows the TARGET language in its own script
     (English in zh UI, 中文 in en UI). Pass a function and resolve it at
     render + every locale repaint, same as a normal key. */
  const displayOf = (value) => (typeof value === "function" ? value() : t(value));
  const st = () => NS.state;
  const api = () => NS.api;
  const backend = () => NS.backend;
  const esc = (value) => api()?.esc ? api().esc(value) : String(value ?? "");
  /* The rail's top slot is the Infinite Canvas brand mark, not a control: the
     same white/orange logo as the ComfyUI top-bar entry (canvas-logo.svg). */
  const CANVAS_LOGO_URL = new URL("./canvas-logo.svg", import.meta.url).href;

  /* Icons come from ComfyUI 1.59.1 source:
     src/composables/sidebarTabs/useNodeLibrarySidebarTab.ts -> icon-[comfy--node]
     .../useAssetsSidebarTab.ts -> icon-[comfy--image-ai-edit]
     .../useNodeLibrarySidebarTab.ts -> icon-[comfy--node]
     .../useWorkflowsSidebarTab.ts -> icon-[comfy--workflow]
     .../useModelLibrarySidebarTab.ts -> icon-[comfy--ai-model]
     src/platform/workflow/management/composables/useAppsSidebarTab.ts
       -> icon-[lucide--panels-top-left] (the ComfyUI Apps icon) */
  /* label/tip are i18n source keys (Chinese); resolved through t() at render
     and on every language change so the rail never shows a stale language. */
  const SIDEBAR_ITEMS = [
    /* Gallery — mounted straight below the canvas logo in the rail. The
       panel itself is the same history-gallery builder used by ComfyUI's own
       sidebar tab (infcanvas-ui.js setPanel -> NS.galleryPanel.mount). */
    { key: "gallery", icon: "icon-[comfy--image-ai-edit]", label: "资产", tip: "资产" },
    { key: "nodes", icon: "icon-[comfy--node]", label: "节点", tip: "节点" },
    /* Placeholder rail button: no panel/action yet, just sits below 节点. */
    { key: "media", icon: "icon-[comfy--ai-model]", label: "收藏", tip: "收藏" },
    { key: "canvases", icon: "icon-[comfy--workflow]", label: "画布", tip: "画布列表" },
    /* Reference: the "工作流配置" tab in the library dock (canvas-app.js:272)
       opens the WorkflowConfig FloatingWindow dialog. Here the same entry is
       added to this rail, renamed 工作流配置 -> 配置 / Config.
       It opens the dialog in js/infcanvas-api-config.js, NOT a drawer panel.
       icon-[lucide--panels-top-left] is ComfyUI's own Apps icon class. */
    { key: "api", icon: "icon-[lucide--panels-top-left]", label: "配置", tip: "配置" },
  ];
  const PANEL_TITLES = {
    gallery: "资产", nodes: "添加节点", media: "收藏", canvases: "画布管理",
  };
  /* Cleanup returned by NS.galleryPanel.mount — the gallery installs global
     listeners and body-portaled popovers, so it must be torn down on switch. */
  let galleryCleanup = null;
  /* Set when switching into the canvas panel so renderCanvasList can mirror
     BaseWorkflowsSidebarTab's onMounted search focus exactly once. */
  let focusCanvasSearch = false;

  /* Resizable drawer, copied from ComfyUI 1.59.1 (frontend sourcesContent):
     - LiteGraphCanvasSplitterOverlay.vue / SplitterResizeHandle.vue:
       a SplitterResizeHandle sits between the side panel and the graph,
       role=separator / tabindex=0 / data-state=inactive|hover|drag,
       1px line with a 4px ::after hit area, bg-border/50 -> bg-primary on
       hover/drag, inline touch-action:none + user-select:none.
     - usePanelSizing.ts: the panel width in PIXELS is captured on drag start
       and written to localStorage on drag end (100ms debounce via
       splitterPersistence.ts); the same value is restored on open.
     - splitterConstants: SIDEBAR_MIN_WIDTH (= default, measured 311.5px),
       CENTER_PANEL_MIN_WIDTH (graph keeps ~160px), SIDE_PANEL_SIZE=20.4
       (measured data-panel-size="20.4").
     - reka-ui calculate.js: ArrowLeft/Right ±10% of group (Shift 100%),
       Home/End jump to min/max.
     All visuals come from the host's own classes/stylesheet; no CSS copied. */
  const SIDEBAR_MIN_WIDTH = 312;
  const CENTER_PANEL_MIN_WIDTH = 160;
  const SIDE_PANEL_SIZE = 20.4;
  const PANEL_WIDTH_KEY = "InfCanvas.Sidebar.LeftWidth";
  const HANDLE_CLASSES = [
    "relative z-10 flex w-px shrink-0 items-center justify-center bg-border",
    "outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-1",
    "after:-translate-x-1/2 hover:bg-primary data-[state=drag]:bg-primary",
    "focus-visible:ring-1 focus-visible:ring-ring cursor-ew-resize",
    "pointer-events-auto bg-border/50",
  ].join(" ");

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  /* Add-node menu glyphs: lucide text-pen / image / video / audio-lines, the
     same four the canvas nodes use as their empty-state art. The host bundle
     ships icon-[lucide--image|video|audio-lines] but NOT text-pen, so mixing
     CSS classes with a hand-drawn one would render at different weights.
     Drawing all four here keeps them pixel-identical at 16px. */
  const NODE_GLYPHS = {
    "text-pen": '<path d="M12 12H3"/>'
      + '<path d="M21 5H3"/>'
      + '<path d="M21.377 14.626a1 1 0 10-3.004-3.004l-5.01 5.012a2 2 0 00-.506.854l-.837 2.87a.5.5 0 00.62.62l2.87-.837a2 2 0 00.854-.506z"/>'
      + '<path d="M8 19H3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>'
      + '<circle cx="9" cy="9" r="2"/>'
      + '<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>'
      + '<rect x="2" y="6" width="14" height="12" rx="2"/>',
    "audio-lines": '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/>'
      + '<path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    /* lucide layers-3 — stacked slabs = a stack of LoRA models. */
    lora: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L3 7.5l8.17 5.32a2 2 0 0 0 1.66 0L21 7.5 12.83 2.18Z"/>'
      + '<path d="m3 12.5 8.17 5.32a2 2 0 0 0 1.66 0L21 12.5"/>'
      + '<path d="m3 17.5 8.17 5.32a2 2 0 0 0 1.66 0L21 17.5"/>',
  };
  const GLYPH_OF = { text: "text-pen", image: "image", video: "video", audio: "audio-lines", lora: "lora" };
  const menuGlyphSvg = (name) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="none"'
    + ' stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
    + (NODE_GLYPHS[name] || "") + '</svg>';

  function injectStyles() {
    if (!NS.css || document.querySelector("#infcanvas-style")) return;
    const style = document.createElement("style");
    style.id = "infcanvas-style";
    style.textContent = NS.css;
    document.head.appendChild(style);
  }

  function attachPanelResizer(shell, handle) {
    const bounds = () => {
      const rail = shell.sidebar.getBoundingClientRect().width || 56;
      return {
        min: SIDEBAR_MIN_WIDTH,
        max: Math.max(SIDEBAR_MIN_WIDTH,
          window.innerWidth - rail - CENTER_PANEL_MIN_WIDTH - 1),
        group: Math.max(1, window.innerWidth - rail),
      };
    };
    let width = SIDEBAR_MIN_WIDTH;
    let saveTimer = 0;
    let drag = null;

    const apply = (px) => {
      const { min, max } = bounds();
      width = Math.max(min, Math.min(max, Math.round(px)));
      shell.root.style.setProperty("--infcanvas-panel-width", width + "px");
      return width;
    };
    const save = () => {
      try { localStorage.setItem(PANEL_WIDTH_KEY, String(width)); }
      catch (error) { /* storage unavailable */ }
    };
    const scheduleSave = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 100);
    };

    try {
      const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
      const rail = shell.sidebar.getBoundingClientRect().width || 56;
      const fallback = Math.max(SIDEBAR_MIN_WIDTH,
        Math.round((SIDE_PANEL_SIZE / 100) * (window.innerWidth - rail)));
      apply(Number.isFinite(stored) && stored > 0 ? stored : fallback);
    } catch (error) {
      apply(SIDEBAR_MIN_WIDTH);
    }

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !st().panelKey) return;
      event.preventDefault();
      event.stopPropagation();
      try { handle.setPointerCapture(event.pointerId); } catch (error) { /* optional */ }
      drag = { x: event.clientX, width };
      handle.dataset.state = "drag";
      shell.root.classList.add("is-resizing");
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag) return;
      event.preventDefault();
      apply(drag.width + (event.clientX - drag.x));
    });
    const finish = () => {
      if (!drag) return;
      drag = null;
      handle.dataset.state = "hover";
      shell.root.classList.remove("is-resizing");
      scheduleSave();
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.addEventListener("pointerenter", () => {
      if (!drag) handle.dataset.state = "hover";
    });
    handle.addEventListener("pointerleave", () => {
      if (!drag) handle.dataset.state = "inactive";
    });
    handle.addEventListener("keydown", (event) => {
      const { min, max, group } = bounds();
      const step = (event.shiftKey ? 100 : 10) / 100 * group;
      let next;
      switch (event.key) {
        case "ArrowRight": next = width + step; break;
        case "ArrowLeft": next = width - step; break;
        case "End": next = max; break;
        case "Home": next = min; break;
        default: return;
      }
      event.preventDefault();
      event.stopPropagation();
      apply(next);
      scheduleSave();
    });

    const onWindowResize = () => apply(width);
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      clearTimeout(saveTimer);
      save(); // onBeforeUnmount(flushLayouts) in LiteGraphCanvasSplitterOverlay.vue
      shell.root.classList.remove("is-resizing");
    };
  }

  /* --------------------------- standalone shell --------------------------- */

  function mountShell() {
    if (st().shell) return st().shell;
    const root = node("div");
    root.id = "infcanvas-root";
    root.setAttribute("data-testid", "infcanvas-root");

    const tabbar = node("header");
    tabbar.id = "infcanvas-tabbar";
    root.appendChild(tabbar);

    const body = node("div");
    body.id = "infcanvas-body";

    /* SideToolbar.vue + SidebarIcon.vue: reuse the exact host classes so the
       host's own stylesheet (button variants, --sidebar-* tokens, selected /
       hover rules) styles the rail. No copied pixel values here. */
    const sidebar = node("nav",
      "side-tool-bar-container flex h-full flex-col items-center bg-transparent " +
      "transition-[max-width,opacity,transform] duration-300 ease-in-out " +
      "connected-sidebar pointer-events-auto overflow-hidden border-r border-border/50 shadow-md");
    sidebar.id = "infcanvas-sidebar";
    sidebar.setAttribute("data-testid", "infcanvas-sidebar");
    /* SideToolbar.vue: :style="{ maxWidth: isHidden ? '0px' : 'var(--sidebar-width)' }" */
    sidebar.style.maxWidth = "var(--sidebar-width)";
    const group = node("div",
      "sidebar-item-group flex shrink-0 flex-col items-center overflow-hidden border border-transparent");
    sidebar.appendChild(group);
    /* Logo slot: plain <div>/<img>, never a <button>. No click, no tooltip,
       no i18n label — it is branding only. 退出画布 stays available as the
       white button at the far right of the tab bar. */
    const logoSlot = node("div", "ic-side-logo");
    logoSlot.setAttribute("aria-hidden", "true");
    const logoImage = node("img");
    logoImage.src = CANVAS_LOGO_URL;
    logoImage.alt = "";
    logoImage.draggable = false;
    logoSlot.appendChild(logoImage);
    group.appendChild(logoSlot);
    const buttons = new Map();
    const sideRefs = new Map();   // key -> { label, tip, item, button }
    const makeSideButton = (item) => {
      const button = node("button",
        "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
        "items-center justify-center gap-2 border-none font-inter font-medium " +
        "whitespace-nowrap transition-colors focus-visible:ring-1 " +
        "focus-visible:ring-ring focus-visible:outline-none " +
        "disabled:pointer-events-none disabled:opacity-50 " +
        "bg-transparent text-muted-foreground hover:bg-accent " +
        "side-bar-button h-(--sidebar-item-height) w-(--sidebar-width) " +
        "shrink-0 rounded-none p-2 text-xs ic-side-btn");
      button.type = "button";
      button.dataset.key = item.key;
      button.setAttribute("aria-label", displayOf(item.tip));
      const content = node("div", "side-bar-button-content flex flex-col items-center gap-2");
      const iconWrap = node("div", "sidebar-icon-wrapper relative");
      iconWrap.appendChild(node("i", item.icon + " side-bar-button-icon"));
      content.appendChild(iconWrap);
      const labelEl = node("span",
        "side-bar-button-label line-clamp-2 w-max " +
        "max-w-[calc(var(--sidebar-width)-var(--sidebar-padding))] " +
        "text-center text-2xs leading-none wrap-break-word whitespace-normal",
        displayOf(item.label));
      content.appendChild(labelEl);
      button.appendChild(content);
      const tipEl = node("span", "ic-tip", displayOf(item.tip));
      button.appendChild(tipEl);
      sideRefs.set(item.key, { label: labelEl, tip: tipEl, item, button });
      return button;
    };
    for (const item of SIDEBAR_ITEMS) {
      const button = makeSideButton(item);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        /* Reference: the library tab opens the workflow dialog. The API entry
           opens our ported FloatingWindow instead of switching the drawer. */
        if (item.key === "api") { NS.apiConfig?.open?.(); return; }
        setPanel(st().panelKey === item.key ? null : item.key);
      });
      group.appendChild(button);
      buttons.set(item.key, button);
    }

    /* Language toggle pinned to the very bottom of the rail, not appended
       under API. SideToolbar.vue does exactly this: a second
       `sidebar-item-group` with `mt-auto` inside the h-full flex column
       (bottomToolbarRef), so the gap absorbs all leftover height. */
    const langGroup = node("div",
      "sidebar-item-group mt-auto flex shrink-0 flex-col items-center overflow-hidden border border-transparent");
    sidebar.appendChild(langGroup);
    const langItem = {
      key: "lang", icon: "pi pi-language",
      /* Show what the NEXT click switches to, not the current state. */
      label: () => (NS.i18n?.current?.() === "en" ? "中文" : "English"),
      tip: () => t(NS.i18n?.current?.() === "en" ? "切换到中文" : "切换到英文"),
    };
    const langButton = makeSideButton(langItem);
    langButton.dataset.langToggle = "1";
    langButton.addEventListener("click", (event) => {
      event.stopPropagation();
      NS.i18n?.toggleLang?.();
    });
    langGroup.appendChild(langButton);

    /* LiteGraphCanvasSplitterOverlay.vue + SidebarTabTemplate.vue +
       SidebarTabCloseButton.vue: the panel appears instantly (no width tween;
       reka-ui splitter sets flex:20.4 1 0). Only .sidebar-content-container
       fades its opacity over 200ms. */
    const panel = node("aside",
      "min-h-0 min-w-0 side-bar-panel pointer-events-auto bg-background " +
      "focus-visible:outline-hidden");
    panel.id = "infcanvas-panel";
    panel.setAttribute("data-testid", "infcanvas-panel");
    const contentWrap = node("div",
      "sidebar-content-container size-full overflow-x-hidden overflow-y-auto " +
      "transition-opacity duration-200 ease-in-out");
    const container = node("div",
      "comfy-vue-side-bar-container group/sidebar-tab flex size-full flex-col");
    const headerWrap = node("div", "comfy-vue-side-bar-header flex flex-col");
    const panelHead = node("div", "flex min-h-16 items-center justify-between border-b px-4");
    const titleBox = node("div", "flex min-w-0 flex-1 items-center overflow-hidden");
    const panelTitle = node("span", "truncate font-bold", "");
    titleBox.appendChild(panelTitle);
    const actions = node("div", "flex items-center gap-2");
    /* SidebarTabTemplate #tool-buttons: hover-revealed muted icon button.
       Only the canvas panel shows it; renderCanvasList wires its handler. */
    /* SidebarTabTemplate's tool-buttons wrapper: w-0 opacity-0, revealed by
       group-hover/group-focus-within. The wrapper (not the button) animates,
       so the 32px icon button never gets clipped. */
    const toolButtons = node("div", "ic-tool-buttons");
    const panelRefresh = node("button",
      "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
      "items-center justify-center gap-2 border-none font-inter text-sm " +
      "font-medium whitespace-nowrap transition-colors focus-visible:ring-1 " +
      "focus-visible:ring-ring focus-visible:outline-none " +
      "disabled:pointer-events-none disabled:opacity-50 " +
      "bg-transparent text-muted-foreground hover:bg-accent shrink-0 size-8 rounded-lg");
    panelRefresh.type = "button";
    panelRefresh.title = t("刷新画布列表");
    panelRefresh.setAttribute("aria-label", t("刷新画布列表"));
    panelRefresh.setAttribute("data-testid", "workflows-refresh-button");
    /* BaseWorkflowsSidebarTab: icon-[lucide--refresh-cw] size-4. */
    panelRefresh.innerHTML = '<i class="icon-[lucide--refresh-cw] size-4"></i>';
    panelRefresh.style.display = "none";
    toolButtons.appendChild(panelRefresh);
    actions.appendChild(toolButtons);
    /* The gallery/媒体 panels move their file count + refresh button into this
       slot so they sit in the title row, immediately left of the close X. */
    const headSlot = node("div", "xog-head-slot");
    actions.appendChild(headSlot);
    const panelClose = node("button",
      "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
      "items-center justify-center gap-2 border-none font-inter text-sm " +
      "font-medium whitespace-nowrap transition-colors focus-visible:ring-1 " +
      "focus-visible:ring-ring focus-visible:outline-none " +
      "disabled:pointer-events-none disabled:opacity-50 " +
      "bg-transparent text-muted-foreground hover:bg-accent shrink-0 size-8 rounded-lg");
    panelClose.type = "button";
    panelClose.title = t("关闭侧栏");
    panelClose.setAttribute("aria-label", t("关闭侧栏"));
    panelClose.setAttribute("data-testid", "sidebar-close-button");
    panelClose.innerHTML = '<i class="icon-[lucide--x] size-4"></i>';
    panelClose.addEventListener("click", () => setPanel(null));
    actions.appendChild(panelClose);
    panelHead.append(titleBox, actions);
    headerWrap.appendChild(panelHead);
    const panelBody = node("div", "comfy-vue-side-bar-body scrollbar-custom h-0 grow overflow-x-hidden");
    panelBody.id = "infcanvas-panel-body";
    panelBody.setAttribute("data-testid", "infcanvas-panel-body");
    container.append(headerWrap, panelBody);
    contentWrap.appendChild(container);
    panel.appendChild(contentWrap);

    /* SplitterResizeHandle.vue: hidden while no panel is mounted, 1px line,
       4px ::after hit area, role=separator, keyboard resizable. */
    const resizeHandle = node("div", HANDLE_CLASSES);
    resizeHandle.id = "infcanvas-panel-resize-handle";
    resizeHandle.setAttribute("data-testid", "infcanvas-panel-resize-handle");
    resizeHandle.setAttribute("role", "separator");
    resizeHandle.setAttribute("tabindex", "0");
    resizeHandle.setAttribute("data-resize-handle", "");
    resizeHandle.setAttribute("data-orientation", "horizontal");
    resizeHandle.setAttribute("data-state", "inactive");
    resizeHandle.setAttribute("data-resize-handle-state", "inactive");
    resizeHandle.setAttribute("data-panel-resize-handle-enabled", "true");
    resizeHandle.setAttribute("data-panel-resize-handle-id", "infcanvas-panel-resize-handle");
    resizeHandle.setAttribute("aria-controls", "infcanvas-panel");
    /* reka-ui sets these inline on the handle (measured on the native DOM). */
    resizeHandle.style.touchAction = "none";
    resizeHandle.style.userSelect = "none";

    const stage = node("main");
    stage.id = "infcanvas-stage";
    stage.setAttribute("data-testid", "infcanvas-stage");
    body.append(sidebar, panel, resizeHandle, stage);
    root.appendChild(body);
    document.body.appendChild(root);

    const shell = {
      root, tabbar, sidebar, buttons, sideRefs, langButton,
      panel, panelTitle, panelBody, panelRefresh, headSlot, stage, resizeHandle,
    };
    shell.destroyResizer = attachPanelResizer(shell, resizeHandle);
    st().shell = shell;
    /* Subscribe once for native-DOM locale repaint (Vue nodes react via $t). */
    if (!NS._i18nUiSubscribed && NS.i18n?.onChange) {
      NS.i18n.onChange(() => repaintLocale());
      NS._i18nUiSubscribed = true;
    }
    st().panelKey = null;
    st().panelBody = panelBody;
    st().panelToken = (st().panelToken || 0) + 1;
    return shell;
  }

  function unmountShell() {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    if (galleryCleanup) { galleryCleanup(); galleryCleanup = null; }
    const shell = st().shell;
    try { shell?.destroyResizer?.(); } catch (error) { /* optional */ }
    if (shell?.root) shell.root.remove();
    st().shell = null;
    st().tabsHost = null;
    st().panelKey = null;
    st().panelBody = null;
    st().panelToken = (st().panelToken || 0) + 1;
  }

  /* ------------------------------ tab bar -------------------------------- */

  function mountTabs() {
    const shell = st().shell;
    if (!shell || document.querySelector("#infcanvas-tabs")) return;
    const bar = node("div");
    bar.id = "infcanvas-tabs";
    bar.setAttribute("data-testid", "infcanvas-tabs");
    shell.tabbar.appendChild(bar);
    st().tabsHost = bar;
    renderTabs();
  }

  function removeTabs() {
    const bar = st().tabsHost;
    if (bar) bar.remove();
    st().tabsHost = null;
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
  }

  /* One menu surface for every context menu in the canvas: the tab menu, the
     canvas row menu and the node list all render through here, so they stay
     identical. Surface + items follow menuStyles.ts / MenuItemContent.vue /
     MenuSeparator.vue. */
  function openMenu(event, items, extraClass) {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const menu = node("div", "ic-menu" + (extraClass ? " " + extraClass : ""));
    menu.setAttribute("role", "menu");

    for (const item of items) {
      if (item.separator) { menu.appendChild(node("div", "ic-menu-sep")); continue; }
      const button = node("button", "ic-menu-item");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      if (item.disabled) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const iconWrap = node("span", "ic-menu-icon");
      const iconEl = node("i", item.icon);
      /* Native `text-[1em]` icons: glyph tracks the item's 14px font, not 16. */
      if (item.iconEm) iconEl.style.fontSize = "1em";
      iconWrap.appendChild(iconEl);
      button.append(iconWrap, node("span", "ic-menu-label", item.label));
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        menu.remove();
        if (!item.disabled) item.command();
      });
      menu.appendChild(button);
    }

    (st().shell?.root || document.body).appendChild(menu);
    const rect = typeof menu.getBoundingClientRect === "function"
      ? menu.getBoundingClientRect() : { width: 224, height: 340 };
    menu.style.left = Math.max(0, Math.min(event.clientX, window.innerWidth - rect.width - 4)) + "px";
    menu.style.top = Math.max(0, Math.min(event.clientY, window.innerHeight - rect.height - 4)) + "px";
    const dismiss = (clickEvent) => {
      if (!menu.contains(clickEvent.target)) menu.remove();
      document.removeEventListener("click", dismiss, true);
    };
    setTimeout(() => document.addEventListener("click", dismiss, true), 0);
  }

  /* Tab menu mirrors WorkflowTab.contextMenuItems + useWorkflowActionsMenu:
     rename, duplicate | separator | save, save-as | separator | close-tab,
     close-left, close-right, close-others. */
  function showTabMenu(event, doc, index, count) {
    const isFirst = index === 0;
    const isLast = index === count - 1;
    const items = [
      { label: t("重命名"), icon: "pi pi-pencil", command: () => api().renameDoc(doc.id) },
      { label: t("复制"), icon: "pi pi-copy", command: () => api().duplicateDoc(doc.id) },
      { separator: true },
      { label: t("保存"), icon: "pi pi-save", command: () => api().saveActive(false, doc) },
      { label: t("另存为"), icon: "pi pi-save", command: () => api().saveActive(true, doc) },
      { separator: true },
      { label: t("关闭标签"), icon: "pi pi-times", command: () => api().closeDoc(doc.id) },
      /* Native close-left/right/others use the SAME pi-times glyph as a plain
         1em cross (text-[1em] = 14px). No second arrow glyph — measured on a
         real right-click of a native tab. */
      {
        label: t("关闭左侧标签"), icon: "pi pi-times", iconEm: true,
        disabled: isFirst, command: () => api().closeDocsAt(doc.id, "left"),
      },
      {
        label: t("关闭右侧标签"), icon: "pi pi-times", iconEm: true,
        disabled: isLast, command: () => api().closeDocsAt(doc.id, "right"),
      },
      {
        label: t("关闭其他标签"), icon: "pi pi-times", iconEm: true,
        disabled: isFirst && isLast, command: () => api().closeDocsAt(doc.id, "others"),
      },
    ];

    openMenu(event, items, "ic-menu--tab");
  }

  /* Canvas row menu: same surface and same rename/duplicate semantics as the
     tab menu — rename asks for a name, duplicate copies straight away under
     "<name> (Copy)" and opens the copy. Item order follows the native tree
     menu (rename, delete, duplicate) with no separator and no red delete. */
  function showCanvasMenu(event, canvas, reload, names) {
    const uniqueCanvasName = (base) => {
      const taken = new Set((names || []).map((entry) => entry.name));
      let name = base;
      let counter = 2;
      while (taken.has(name)) {
        name = `${base} (${counter})`;
        counter += 1;
      }
      return name;
    };
    const items = [
      { label: t("重命名"), icon: "pi pi-file-edit", command: async () => {
        const value = await api().promptDialog({
          title: t("重命名画布"), message: t("画布名称"), defaultValue: canvas.name,
        });
        if (value === null || !String(value).trim()) return;
        const name = String(value).trim();
        if (name === canvas.name) return;
        try {
          await api().renameCanvas(canvas.name, name);
          await reload();
        } catch (error) { api().toast("error", t("重命名失败"), String(error)); }
      } },
      { label: t("删除"), icon: "pi pi-trash", command: async () => {
        const ok = await api().confirmDialog({
          title: t("删除画布"), message: t("确定删除「{name}」？", { name: canvas.name }), hint: t("此操作不可撤销"),
          type: "delete", key: "infcanvas-delete-canvas",
        });
        if (!ok) return;
        try {
          await backend().remove(canvas.name);
          api().toast("success", t("画布已删除"), canvas.name);
          await reload();
        } catch (error) { api().toast("error", t("删除失败"), String(error)); }
      } },
      /* 复制 ≠ 保存: the copy opens as an unsaved tab, nothing is written to
         disk, and the canvas list therefore gains no new row. */
      { label: t("复制"), icon: "pi pi-file-export", command: async () => {
        const base = String(canvas.name).replace(/\s*\(\d+\)$/, "");
        const name = uniqueCanvasName(base + " (Copy)");
        try {
          await api().duplicateCanvas(canvas.name, name, (names || []).map((entry) => entry.name));
        } catch (error) { api().toast("error", t("复制失败"), String(error)); }
      } },
    ];
    openMenu(event, items);
  }

  /* One popover drives both node lists:
       - double click on empty canvas -> every registered type (only the 8
         infcanvas types; ComfyUI's node search box is what we deliberately
         replaced, see onCanvasEvent in infcanvas-core.js);
       - releasing a wire over empty canvas -> ONLY the types that can take
         that wire, picked by infcanvas-flow.js.
     `options.specs` limits the list, `options.title` adds a caption and
     `options.onPick(spec)` replaces the default "create at the pointer".
     The menu surface is the one menuStyles.ts defines for ComfyUI's own
     context menus, so it reads as part of the host UI. */
  function showNodePickMenu(anchor, options = {}) {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const menu = node("div", "ic-menu ic-node-menu");
    menu.id = options.id || "infcanvas-node-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", options.label || t("添加节点"));

    const allowed = options.specs ? new Set(options.specs.map((spec) => spec.type)) : null;
    /* One flat list, no role subheadings and no description tooltips: caption
       is 添加节点 (or the caller's own title on the wire-release menu), then
       文本 / 图像 / 视频 / 音频 in that fixed order, with the matching
       lucide glyphs. */
    const ORDER = ["text", "image", "video", "audio", "lora"];
    const specs = (NS.SPECS || [])
      .filter((entry) => !allowed || allowed.has(entry.type))
      .slice()
      .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    menu.appendChild(node("div", "ic-menu-section", options.title || t("添加节点")));
    for (const spec of specs) {
      const button = node("button", "ic-menu-item");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      const iconWrap = node("span", "ic-menu-icon");
      iconWrap.innerHTML = menuGlyphSvg(GLYPH_OF[spec.kind] || "image");
      button.append(iconWrap, node("span", "ic-menu-label", t(spec.title)));
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        closeMenu();
        if (options.onPick) { options.onPick(spec); return; }
        // Same contract as the drop path: node.pos is the top-left corner.
        api().addNodeByType(spec.type, anchor.world);
      });
      menu.appendChild(button);
    }
    if (!menu.querySelector(".ic-menu-item")) {
      menu.appendChild(node("div", "ic-menu-empty", t("没有可接入的节点")));
    }

    const root = st().shell?.root || document.body;
    root.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const x = Number.isFinite(anchor.clientX) ? anchor.clientX : 0;
    const y = Number.isFinite(anchor.clientY) ? anchor.clientY : 0;
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) + "px";

    function closeMenu() {
      menu.remove();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("wheel", closeMenu, true);
    }
    function onOutside(event) {
      if (!menu.contains(event.target)) closeMenu();
    }
    function onKey(event) {
      if (event.key === "Escape") { event.stopPropagation(); closeMenu(); }
    }
    setTimeout(() => {
      if (!document.body.contains(menu)) return;
      document.addEventListener("pointerdown", onOutside, true);
      document.addEventListener("keydown", onKey, true);
      // Wheel over the canvas zooms; the menu would stay pinned to stale
      // screen coordinates, so dismiss it like ComfyUI's own popovers do.
      document.addEventListener("wheel", closeMenu, true);
    }, 0);
    return menu;
  }

  /* Double-click on empty canvas: every node type, at the pointer. */
  function showAddNodeMenu(anchor) {
    return showNodePickMenu(anchor, {});
  }
  /* Wire released over empty canvas: only the types that can take it. The
     candidate list and the "create + connect" step both live in
     infcanvas-flow.js — this is the surface. */
  function showConnectNodeMenu(anchor) {
    return showNodePickMenu(anchor, {
      id: "infcanvas-connect-menu",
      label: t("连线到新节点"),
      title: t("接入新节点"),
      specs: anchor.specs || [],
      onPick: anchor.onPick,
    });
  }

  function renderTabs() {
    const bar = st().tabsHost;
    if (!bar) return;
    bar.replaceChildren();
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const strip = node("div", "ic-tab-strip");
    const docs = st().docs;
    for (let index = 0; index < docs.length; index += 1) {
      const doc = docs[index];
      const active = doc.id === st().activeId;
      const tab = node("div", "ic-tab"
        + (active ? " is-active" : "")
        + (doc.dirty ? " has-status" : ""));
      tab.dataset.id = doc.id;
      tab.appendChild(node("span", "ic-label", doc.name || "Unsaved Canva"));
      /* WorkflowTab.vue: a size-4 shrink-0 status slot follows the label.
         The close button is absolutely positioned over that slot, so it can
         never overlap the label text. */
      const status = node("span", "ic-status");
      if (doc.dirty) status.appendChild(node("span", "ic-dot"));
      tab.appendChild(status);
      const close = node("button", "ic-close");
      close.type = "button";
      close.setAttribute("aria-label", "关闭");
      close.title = t("关闭标签");
      close.innerHTML = '<i class="pi pi-times"></i>';
      close.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        api().closeDoc(doc.id);
      });
      tab.appendChild(close);
      tab.addEventListener("click", () => api().switchDoc(doc.id));
      tab.addEventListener("auxclick", (auxEvent) => {
        if (auxEvent.button === 1) { auxEvent.preventDefault(); api().closeDoc(doc.id); }
      });
      tab.addEventListener("contextmenu", (menuEvent) => {
        menuEvent.preventDefault();
        showTabMenu(menuEvent, doc, index, docs.length);
      });
      strip.appendChild(tab);
    }
    bar.appendChild(strip);
    const add = node("button", "ic-tab-add");
    add.type = "button";
    add.innerHTML = '<i class="pi pi-plus"></i>';
    add.title = t("新建画布");
    add.addEventListener("click", () => api().newCanvas());
    bar.appendChild(add);
    /* Exit button pinned to the far right of the tab strip. White surface on
       purpose so it reads as the primary escape action against the dark tabs.
       Reuses the same i18n keys and exit handler as the rail's exit item. */
    const exit = node("button", "ic-tab-exit");
    exit.type = "button";
    exit.innerHTML = '<span class="ic-tab-exit-label"></span>';
    exit.querySelector(".ic-tab-exit-label").textContent = t("退出画布");
    exit.title = t("退出画布，返回 ComfyUI");
    exit.addEventListener("click", () => api().exit());
    bar.appendChild(exit);
  }

  /* --------------------------- drawer panels ----------------------------- */

  function isCurrent(container, key) {
    return st().panelKey === key
      && st().panelBody === container
      && document.body.contains(container);
  }

  function setPanel(key) {
    const state = st();
    const shell = state.shell;
    if (!shell) return;
    /* Gallery owns document/window listeners + body-portaled popovers. Tear the
       previous instance down before its host is cleared (or before switching
       to a different panel), otherwise those listeners pile up on every switch. */
    if (galleryCleanup) { galleryCleanup(); galleryCleanup = null; }
    shell.panelBody.classList.remove("ic-gallery-host");
    /* BaseWorkflowsSidebarTab's onMounted focuses the SearchInput. Mirror that
       once per switch into the canvas panel — not on every refreshPanels()
       re-render, which would yank the caret away while typing. */
    if (key === "canvases" && state.panelKey !== "canvases") focusCanvasSearch = true;
    state.panelKey = key;
    state.panelToken = (state.panelToken || 0) + 1;
    shell.root.classList.toggle("has-panel", !!key);
    for (const [itemKey, button] of shell.buttons) {
      const selected = !!key && itemKey === key;
      /* .side-bar-button-selected is SidebarIcon.vue's own global rule */
      button.classList.toggle("side-bar-button-selected", selected);
      button.classList.toggle("is-active", selected);
    }
    shell.panelTitle.textContent = key ? t(PANEL_TITLES[key] || "") : "";
    shell.panelRefresh.style.display = key === "canvases" ? "" : "none";
    shell.panelRefresh.onclick = null;
    /* Gallery moved its count + refresh into the header slot; clear it on
       every switch so they never leak into a different panel. */
    shell.headSlot.replaceChildren();
    shell.panelBody.replaceChildren();
    if (!key) return;
    if (key === "gallery" || key === "media") {
      /* Both panels use the same builder; 媒体 only swaps the output/input
         tabs for a folder chip (mode:media) and lists the chosen folder. Mark
         the host so canvas CSS pins the header and scrolls only the grid. */
      shell.panelBody.classList.add("ic-gallery-host");
      galleryCleanup = NS.galleryPanel?.mount?.(
          shell.panelBody,
          { ...(key === "media" ? { mode: "media" } : {}), headSlot: shell.headSlot }
      ) || null;
    } else if (key === "nodes") renderNodeLibrary(shell.panelBody);
    else if (key === "canvases") renderCanvasList(shell.panelBody);
  }

  /* Repaint every native-DOM string in the shell when language changes.
     Vue-driven nodes react on their own through the shared lang ref. */
  function repaintLocale() {
    const shell = st().shell;
    if (!shell) return;
    for (const [key, ref] of shell.sideRefs) {
      ref.label.textContent = displayOf(ref.item.label);
      ref.tip.textContent = displayOf(ref.item.tip);
      ref.button.setAttribute("aria-label", displayOf(ref.item.tip));
    }
    /* Re-render the currently open drawer so its static labels switch too. */
    if (st().panelKey) setPanel(st().panelKey);
    /* Tab bar tooltips + add-canvas title. */
    document.querySelectorAll(".ic-tabbar [title]").forEach((el) => {
      /* titles set from t() at creation are refreshed by re-running mountTabs
         below only when needed; tab labels are user data and stay as-is. */
    });
    const add = shell.tabbar?.querySelector(".ic-tab-add");
    if (add) add.title = t("新建画布");
    const exitLabel = shell.tabbar?.querySelector(".ic-tab-exit-label");
    if (exitLabel) exitLabel.textContent = t("退出画布");
    const exit = shell.tabbar?.querySelector(".ic-tab-exit");
    if (exit) exit.title = t("退出画布，返回 ComfyUI");
  }

  /* Panel chrome follows ComfyUI's SidebarTabTemplate.vue: the title lives in
     the 64px header; the body holds the panel's own content. */
  function panelHeader(hintText) {
    const panel = node("div", "ic-panel");
    if (hintText) panel.appendChild(node("div", "ic-hint", hintText));
    return panel;
  }

  function renderNodeLibrary(container) {
    if (!isCurrent(container, "nodes")) return;
    const panel = panelHeader(null);
    /* One flat list, no role subheadings / row descriptions / footer hint:
       the drawer is just four rows in the fixed 文本 / 图像 / 视频 / 音频
       order, matching the double-click menu (showNodePickMenu) — including
       the same four lucide glyphs. */
    const ORDER = ["text", "image", "video", "audio", "lora"];
    const list = node("div", "ic-list");
    for (const kind of ORDER) {
      const spec = (NS.SPECS || []).find((entry) => entry.kind === kind);
      if (!spec) continue;
      const button = node("button", "ic-item");
      button.type = "button";
      button.innerHTML = menuGlyphSvg(GLYPH_OF[spec.kind] || "image")
        + `<span class="ic-item-title">${esc(t(spec.title))}</span>`;
      button.addEventListener("click", () => api().addNodeByType(spec.type));
      list.appendChild(button);
    }
    panel.appendChild(list);
    container.replaceChildren(panel);
  }

  async function renderCanvasList(container) {
    if (!isCurrent(container, "canvases")) return;
    const panel = panelHeader(null);
    /* Native sidebar body has no padding/gap wrapper (see .ic-panel--canvases). */
    panel.classList.add("ic-panel--canvases");

    /* BaseWorkflowsSidebarTab puts a SearchInput in the header slot; its
       TextDivider is a left label followed by a growing dashed rule.
       SearchInput.vue md: icon-[lucide--search] size-4 at left-2.5, and the
       clear Button (variant=textonly, size=icon-sm) REPLACES it at the same
       left-2.5 spot — it does not sit on the right. */
    const search = node("div", "ic-search");
    search.appendChild(node("i", "ic-search-glyph icon-[lucide--search] size-4"));
    const searchInput = node("input", "ic-search-input");
    searchInput.type = "text";
    /* Native: $t('g.searchPlaceholder', { subject }) -> "搜索 {subject}…"
       with the space; subject for this tab is 画布. */
    searchInput.placeholder = t("搜索 画布...");
    searchInput.setAttribute("aria-label", t("搜索 画布"));
    searchInput.addEventListener("input", render);
    search.appendChild(searchInput);
    const clear = node("button", "ic-search-clear");
    clear.type = "button";
    clear.title = t("清除搜索");
    clear.innerHTML = '<i class="icon-[lucide--x] size-4"></i>';
    clear.addEventListener("click", () => {
      searchInput.value = "";
      render();
      searchInput.focus();
    });
    search.appendChild(clear);
    panel.appendChild(search);
    const refreshBtn = st().shell?.panelRefresh;
    if (refreshBtn) refreshBtn.onclick = load;

    const list = node("div", "ic-list ic-canvas-list scrollbar-custom");
    panel.appendChild(list);
    container.replaceChildren(panel);
    if (focusCanvasSearch) {
      focusCanvasSearch = false;
      searchInput.focus();
    }

    let canvases = [];

    function divider(text) {
      const wrap = node("div", "ic-divider");
      wrap.appendChild(node("span", "ic-divider-label", text));
      wrap.appendChild(node("div", "ic-divider-line"));
      return wrap;
    }

    function rowFor(canvas) {
      const row = node("div", "ic-item ic-canvas-item");
      const active = (api().docs() || []).some(
        (entry) => entry.saved && entry.name === canvas.name && entry.id === api().activeId());
      if (active) row.classList.add("is-active");
      /* TreeExplorer.vue getTreeNodeIcon(): leaf icon = 'pi pi-file'. */
      row.innerHTML = '<i class="pi pi-file"></i>';
      row.appendChild(node("span", "ic-item-title", canvas.name));

      const bookmark = node("button", "ic-bookmark");
      bookmark.type = "button";
      const paint = (on) => {
        bookmark.classList.toggle("is-on", on);
        bookmark.innerHTML = '<i class="pi ' + (on ? "pi-bookmark-fill" : "pi-bookmark") + '"></i>';
        bookmark.title = on ? t("取消书签") : t("添加书签");
      };
      paint(api().isBookmarked(canvas.name));
      bookmark.addEventListener("click", (event) => {
        event.stopPropagation();
        paint(api().toggleBookmark(canvas.name));
        render();
      });
      row.appendChild(bookmark);
      row.addEventListener("click", () => api().openByName(canvas.name));
      row.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showCanvasMenu(event, canvas, load, canvases);
      });
      return row;
    }

    function render() {
      search.classList.toggle("has-value", !!searchInput.value);
      const query = String(searchInput.value || "").trim().toLocaleLowerCase();
      const filtered = canvases.filter(
        (canvas) => String(canvas.name).toLocaleLowerCase().includes(query));
      list.replaceChildren();
      const marked = filtered.filter((canvas) => api().isBookmarked(canvas.name));
      if (marked.length) {
        list.appendChild(divider(t("书签")));
        for (const canvas of marked) list.appendChild(rowFor(canvas));
      }
      if (filtered.length) {
        /* Native TextDivider label for the "all workflows" group is 浏览. */
        list.appendChild(divider(t("浏览")));
        for (const canvas of filtered) list.appendChild(rowFor(canvas));
      } else {
        list.appendChild(node("div", "ic-empty",
          query ? t("没有匹配的画布") : t("还没有保存的画布。新建后按 Ctrl+S 保存。")));
      }
    }

    async function load() {
      try {
        const { canvases: items = [] } = await backend().canvases();
        if (!isCurrent(container, "canvases")) return;
        canvases = items;
        render();
      } catch (error) {
        if (!isCurrent(container, "canvases")) return;
        list.replaceChildren(node("div", "ic-empty", t("加载失败：") + esc(error)));
      }
    }
    await load();
  }

  /* API 配置：侧栏「API Config」按钮打开独立弹窗（js/infcanvas-api-config.js）。 */

  function refreshPanels() {
    const state = st();
    try {
      if (!state.shell || !state.panelBody || !document.body.contains(state.panelBody)) return;
      if (state.panelKey === "canvases") renderCanvasList(state.panelBody);
    } catch (error) { console.warn("[InfCanvas] refreshPanels failed", error); }
  }

  /* No toast/dialog implementation here: infcanvas-core.js calls ComfyUI's
     own extensionManager.toast / .dialog.confirm / .dialog.prompt, and the
     stylesheet keeps DialogPortal / the toast dock above #infcanvas-root.
     Reimplementing them would only drift from ComfyUI's real appearance. */

  NS.ui = {
    injectStyles, mountShell, unmountShell, mountTabs, removeTabs, renderTabs,
    setPanel, renderNodeLibrary, renderCanvasList, refreshPanels,
    showAddNodeMenu, showConnectNodeMenu,
  };
})();
