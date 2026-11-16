/* UI layer: a standalone canvas-mode shell (tab bar + left rail + drawer panel
   + graph stage). None of these elements live inside ComfyUI's own sidebar or
   topbar: they are mounted under #infcanvas-root, a sibling of #vue-app. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const st = () => NS.state;
  const api = () => NS.api;
  const backend = () => NS.backend;
  const esc = (value) => api()?.esc ? api().esc(value) : String(value ?? "");

  /* Icons come from ComfyUI 1.59.1 source:
     src/composables/sidebarTabs/useNodeLibrarySidebarTab.ts -> icon-[comfy--node]
     .../useAssetsSidebarTab.ts  -> icon-[comfy--image-ai-edit]
     .../useWorkflowsSidebarTab.ts -> icon-[comfy--workflow]
     src/components/sidebar/SidebarLogoutIcon.vue -> pi pi-sign-out */
  const SIDEBAR_ITEMS = [
    { key: "exit", icon: "pi pi-sign-out", label: "退出画布", tip: "退出画布，返回 ComfyUI" },
    { key: "nodes", icon: "icon-[comfy--node]", label: "新建节点", tip: "新建节点" },
    { key: "assets", icon: "icon-[comfy--image-ai-edit]", label: "资产库", tip: "资产库" },
    { key: "canvases", icon: "icon-[comfy--workflow]", label: "画布", tip: "画布列表" },
    /* Reference: the "工作流配置" tab in the library dock (canvas-app.js:272)
       opens the WorkflowConfig FloatingWindow dialog. Here the same entry is
       added to this rail, renamed 工作流配置 -> API配置 with rail label "API".
       It opens the dialog in js/infcanvas-api-config.js, NOT a drawer panel.
       icon-[lucide--server] is ComfyUI's own CSS class (main-*.css). */
    { key: "api", icon: "icon-[lucide--server]", label: "API", tip: "API配置" },
  ];
  const PANEL_TITLES = { nodes: "新建节点", assets: "资产库", canvases: "画布" };

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
    const buttons = new Map();
    for (const item of SIDEBAR_ITEMS) {
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
      button.setAttribute("aria-label", item.tip);
      const content = node("div", "side-bar-button-content flex flex-col items-center gap-2");
      const iconWrap = node("div", "sidebar-icon-wrapper relative");
      iconWrap.appendChild(node("i", item.icon + " side-bar-button-icon"));
      content.appendChild(iconWrap);
      content.appendChild(node("span",
        "side-bar-button-label line-clamp-2 w-max " +
        "max-w-[calc(var(--sidebar-width)-var(--sidebar-padding))] " +
        "text-center text-2xs leading-none wrap-break-word whitespace-normal",
        item.label));
      button.appendChild(content);
      button.appendChild(node("span", "ic-tip", item.tip));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (item.key === "exit") { api().exit(); return; }
        /* Reference: the library tab opens the workflow dialog. The API entry
           opens our ported FloatingWindow instead of switching the drawer. */
        if (item.key === "api") { NS.apiConfig?.open?.(); return; }
        setPanel(st().panelKey === item.key ? null : item.key);
      });
      group.appendChild(button);
      buttons.set(item.key, button);
    }

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
    const panelClose = node("button",
      "relative inline-flex cursor-pointer touch-manipulation appearance-none " +
      "items-center justify-center gap-2 border-none font-inter text-sm " +
      "font-medium whitespace-nowrap transition-colors focus-visible:ring-1 " +
      "focus-visible:ring-ring focus-visible:outline-none " +
      "disabled:pointer-events-none disabled:opacity-50 " +
      "bg-transparent text-muted-foreground hover:bg-accent shrink-0 size-8 rounded-lg");
    panelClose.type = "button";
    panelClose.title = "关闭侧栏";
    panelClose.setAttribute("aria-label", "关闭侧栏");
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
      root, tabbar, sidebar, buttons, panel, panelTitle, panelBody, stage, resizeHandle,
    };
    shell.destroyResizer = attachPanelResizer(shell, resizeHandle);
    st().shell = shell;
    st().panelKey = null;
    st().panelBody = panelBody;
    st().panelToken = (st().panelToken || 0) + 1;
    return shell;
  }

  function unmountShell() {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
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

  /* Context menu mirrors WorkflowTab.contextMenuItems +
     useWorkflowActionsMenu: rename, duplicate | separator | save, save-as |
     separator | close-tab, close-left, close-right, close-others.
     Labels come from zh/main.json; icons, separators and typography from
     menuStyles.ts / MenuItemContent.vue / MenuSeparator.vue. */
  function showTabMenu(event, doc, index, count) {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const menu = node("div", "ic-menu");
    menu.setAttribute("role", "menu");

    const isFirst = index === 0;
    const isLast = index === count - 1;
    const items = [
      { label: "重命名", icon: "pi pi-pencil", command: () => api().renameDoc(doc.id) },
      { label: "复制", icon: "pi pi-copy", command: () => api().duplicateDoc(doc.id) },
      { separator: true },
      { label: "保存", icon: "pi pi-save", command: () => api().saveActive(false, doc) },
      { label: "另存为", icon: "pi pi-save", command: () => api().saveActive(true, doc) },
      { separator: true },
      { label: "关闭标签", icon: "pi pi-times", command: () => api().closeDoc(doc.id) },
      {
        label: "关闭左侧标签", icon: "pi pi-times", subIcon: "pi pi-arrow-left",
        disabled: isFirst, command: () => api().closeDocsAt(doc.id, "left"),
      },
      {
        label: "关闭右侧标签", icon: "pi pi-times", subIcon: "pi pi-arrow-right",
        disabled: isLast, command: () => api().closeDocsAt(doc.id, "right"),
      },
      {
        label: "关闭其他标签", icon: "pi pi-times", subIcon: "pi pi-arrows-h",
        disabled: isFirst && isLast, command: () => api().closeDocsAt(doc.id, "others"),
      },
    ];

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
      iconWrap.appendChild(node("i", item.icon));
      if (item.subIcon) iconWrap.appendChild(node("i", "ic-menu-subicon " + item.subIcon));
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

  /* Double-click on empty canvas: the canvas's own node list, anchored at the
     pointer. Only the 8 registered infcanvas types are offered -- ComfyUI's
     node search box is what we deliberately replaced (see onCanvasEvent in
     infcanvas-core.js). The menu surface is the same one menuStyles.ts defines
     for ComfyUI's own context menus, so it reads as part of the host UI. */
  function showAddNodeMenu(anchor) {
    document.querySelectorAll(".ic-menu").forEach((menu) => menu.remove());
    const menu = node("div", "ic-menu ic-node-menu");
    menu.id = "infcanvas-node-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "新建节点");

    const groups = [["asset", "素材节点"], ["text", "文本节点"], ["gen", "生成节点"]];
    for (const [role, heading] of groups) {
      const specs = (NS.SPECS || []).filter((entry) => entry.role === role);
      if (!specs.length) continue;
      if (menu.children.length) menu.appendChild(node("div", "ic-menu-sep"));
      menu.appendChild(node("div", "ic-menu-section", heading));
      for (const spec of specs) {
        const button = node("button", "ic-menu-item");
        button.type = "button";
        button.setAttribute("role", "menuitem");
        button.title = spec.desc;
        const iconWrap = node("span", "ic-menu-icon");
        iconWrap.appendChild(node("i", spec.icon));
        button.append(iconWrap, node("span", "ic-menu-label", spec.title));
        button.addEventListener("click", (clickEvent) => {
          clickEvent.stopPropagation();
          closeMenu();
          // Same contract as the drop path: node.pos is the top-left corner.
          api().addNodeByType(spec.type, anchor.world);
        });
        menu.appendChild(button);
      }
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
      close.title = "关闭标签";
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
    add.title = "新建画布";
    add.addEventListener("click", () => api().newCanvas());
    bar.appendChild(add);
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
    state.panelKey = key;
    state.panelToken = (state.panelToken || 0) + 1;
    shell.root.classList.toggle("has-panel", !!key);
    for (const [itemKey, button] of shell.buttons) {
      const selected = !!key && itemKey === key;
      /* .side-bar-button-selected is SidebarIcon.vue's own global rule */
      button.classList.toggle("side-bar-button-selected", selected);
      button.classList.toggle("is-active", selected);
    }
    shell.panelTitle.textContent = PANEL_TITLES[key] || "";
    shell.panelBody.replaceChildren();
    if (!key) return;
    if (key === "nodes") renderNodeLibrary(shell.panelBody);
    else if (key === "assets") renderAssets(shell.panelBody);
    else if (key === "canvases") renderCanvasList(shell.panelBody);
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
    for (const [label, filter] of [["素材节点", "asset"], ["文本节点", "text"], ["生成节点", "gen"]]) {
      panel.appendChild(node("div", "ic-section", label));
      const list = node("div", "ic-list");
      for (const spec of (NS.SPECS || []).filter((entry) => entry.role === filter)) {
        const button = node("button", "ic-item");
        button.type = "button";
        button.innerHTML = `<i class="${spec.icon}"></i><span class="ic-item-title">${esc(spec.title)}</span><span class="ic-item-desc">${esc(spec.desc)}</span>`;
        button.addEventListener("click", () => api().addNodeByType(spec.type));
        list.appendChild(button);
      }
      panel.appendChild(list);
    }
    panel.appendChild(node("div", "ic-hint",
      "点击添加到画布；也可以直接把图片、视频、音频、文本文件拖入画布自动生成素材节点。生成类节点需调用 ComfyUI API，视频 / 音频默认需要在 workflows/ 中放入自己的 API 格式工作流模板。"));
    container.replaceChildren(panel);
  }

  async function renderAssets(container) {
    if (!isCurrent(container, "assets")) return;
    const panel = panelHeader(null);
    const controls = node("div", "ic-row");
    const upload = node("label", "ic-btn");
    upload.innerHTML = '<i class="pi pi-upload"></i> 上传素材';
    const fileInput = node("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    upload.appendChild(fileInput);
    const refresh = node("button", "ic-btn");
    refresh.type = "button";
    refresh.innerHTML = '<i class="pi pi-refresh"></i> 刷新';
    controls.append(upload, refresh);
    panel.appendChild(controls);
    const grid = node("div", "ic-grid");
    grid.appendChild(node("div", "ic-empty", "加载中…"));
    panel.appendChild(grid);
    panel.appendChild(node("div", "ic-hint", "点击插入画布，或拖到画布上；列出 ComfyUI input/infcanvas 与 output 中的媒体文件。"));
    container.replaceChildren(panel);

    async function load() {
      grid.replaceChildren();
      try {
        const { assets = [] } = await backend().assets();
        if (!isCurrent(container, "assets")) return;
        if (!assets.length) {
          grid.appendChild(node("div", "ic-empty", "暂无资产。拖入文件或点击「上传素材」。"));
          return;
        }
        for (const asset of assets) {
          const card = node("div", "ic-card");
          card.draggable = true;
          card.title = asset.name;
          if (asset.kind === "image") {
            const image = node("img", "ic-thumb");
            image.src = api().viewUrl(asset);
            image.alt = asset.name;
            card.appendChild(image);
          } else {
            const icon = node("div", "ic-thumb-icon");
            icon.innerHTML = `<i class="${asset.kind === "video" ? "pi pi-video" : asset.kind === "audio" ? "pi pi-volume-up" : "pi pi-align-left"}"></i>`;
            card.appendChild(icon);
          }
          card.appendChild(node("span", "ic-card-label", asset.name));
          card.addEventListener("click", () => {
            const type = NS.TYPE_BY_KIND[asset.kind] || NS.TYPE_BY_KIND.text;
            api().addNodeByType(type, null, asset);
          });
          card.addEventListener("dragstart", (event) => {
            event.dataTransfer.setData("application/x-infcanvas-asset", JSON.stringify(asset));
            event.dataTransfer.effectAllowed = "copy";
          });
          grid.appendChild(card);
        }
      } catch (error) {
        if (!isCurrent(container, "assets")) return;
        grid.appendChild(node("div", "ic-empty", "加载失败：" + esc(error)));
      }
    }

    refresh.addEventListener("click", load);
    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files || []);
      for (const file of files) {
        const kind = api().kindFromFile(file.name);
        if (!kind) { api().toast("warning", "不支持的文件类型", file.name); continue; }
        try {
          const asset = await backend().upload(file);
          if (kind === "text") {
            try { asset.text = (await (api().readTextFile || ((f) => f.text()))(file)).slice(0, 4000); } catch (error) { /* binary */ }
          }
          api().addNodeByType(NS.TYPE_BY_KIND[kind], null, asset);
          api().toast("success", "素材已添加", file.name);
        } catch (error) { api().toast("error", "上传失败", file.name + " · " + String(error)); }
      }
      fileInput.value = "";
      await load();
    });
    await load();
  }

  async function renderCanvasList(container) {
    if (!isCurrent(container, "canvases")) return;
    const panel = panelHeader(null);
    const controls = node("div", "ic-row");
    const create = node("button", "ic-btn");
    create.type = "button";
    create.innerHTML = '<i class="pi pi-plus"></i> 新建画布';
    create.addEventListener("click", () => api().newCanvas());
    const refresh = node("button", "ic-btn");
    refresh.type = "button";
    refresh.innerHTML = '<i class="pi pi-refresh"></i> 刷新';
    controls.append(create, refresh);
    panel.appendChild(controls);
    const list = node("div", "ic-list");
    panel.appendChild(list);
    panel.appendChild(node("div", "ic-hint", "与 ComfyUI 工作流一致：多标签、Ctrl+S 保存、关闭时确认未保存更改。"));
    container.replaceChildren(panel);

    async function load() {
      list.replaceChildren();
      try {
        const { canvases = [] } = await backend().canvases();
        if (!isCurrent(container, "canvases")) return;
        if (!canvases.length) {
          list.appendChild(node("div", "ic-empty", "还没有保存的画布。新建后按 Ctrl+S 保存。"));
          return;
        }
        for (const canvas of canvases) {
          const row = node("div", "ic-item");
          row.innerHTML = '<i class="pi pi-sitemap"></i>';
          row.appendChild(node("span", "ic-item-title", canvas.name));
          row.appendChild(node("span", "ic-item-desc", new Date(canvas.mtime * 1000).toLocaleDateString()));
          row.addEventListener("click", () => api().openByName(canvas.name));
          const remove = node("button", "ic-btn tiny danger");
          remove.type = "button";
          remove.innerHTML = '<i class="pi pi-trash"></i>';
          remove.title = "删除画布";
          remove.addEventListener("click", async (event) => {
            event.stopPropagation();
            const ok = await api().confirmDialog({
              title: "删除画布", message: `确定删除「${canvas.name}」？`, hint: "此操作不可撤销",
              type: "delete", key: "infcanvas-delete-canvas",
            });
            if (!ok) return;
            try {
              await backend().remove(canvas.name);
              api().toast("success", "画布已删除", canvas.name);
              await load();
            } catch (error) { api().toast("error", "删除失败", String(error)); }
          });
          row.appendChild(remove);
          list.appendChild(row);
        }
      } catch (error) {
        if (!isCurrent(container, "canvases")) return;
        list.appendChild(node("div", "ic-empty", "加载失败：" + esc(error)));
      }
    }

    refresh.addEventListener("click", load);
    await load();
  }

  /* API 配置：侧栏「API」按钮打开独立弹窗（js/infcanvas-api-config.js）。 */

  function refreshPanels() {
    const state = st();
    try {
      if (!state.shell || !state.panelBody || !document.body.contains(state.panelBody)) return;
      if (state.panelKey === "canvases") renderCanvasList(state.panelBody);
      else if (state.panelKey === "assets") renderAssets(state.panelBody);
    } catch (error) { console.warn("[InfCanvas] refreshPanels failed", error); }
  }

  /* No toast/dialog implementation here: infcanvas-core.js calls ComfyUI's
     own extensionManager.toast / .dialog.confirm / .dialog.prompt, and the
     stylesheet keeps DialogPortal / the toast dock above #infcanvas-root.
     Reimplementing them would only drift from ComfyUI's real appearance. */

  NS.ui = {
    injectStyles, mountShell, unmountShell, mountTabs, removeTabs, renderTabs,
    setPanel, renderNodeLibrary, renderAssets, renderCanvasList, refreshPanels,
    showAddNodeMenu,
  };
})();
