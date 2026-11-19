/* Canvas-mode ComfyUI console (bottom logs panel).
 *
 * Mirrors ComfyUI's native "console" (side-toolbar terminal button ->
 * BottomPanel -> LogsTerminal/xterm) INSIDE the infinite canvas, because
 * canvas mode hides the host's own bottom panel together with #vue-app
 * (infcanvas-style.js). Fidelity rule: no fake transport and no terminal
 * reimplementation — every byte comes from the host ComfyApi:
 *
 *   initial snapshot : api.getRawLogs()          -> { entries: [{ m }, ...] }
 *   live stream      : api.addEventListener('logs', e => e.detail.entries)
 *   subscription     : api.subscribeLogs(true)   (same as useLogsTerminal)
 *   backend reconnect: 'reconnected' event -> reset + getRawLogs + resubscribe
 *
 * The xterm widget itself cannot be reused (it is a Vue component inside the
 * hidden #vue-app), so the terminal AREA is a faithful native-DOM reproduction:
 * ComfyUI's BaseTerminal.vue is `bg-neutral-900` (#171717) with `p-2`, monospace
 * font, ANSI colour via xterm's default theme. We render the log entries as
 * lines and apply xterm's default ANSI palette so it reads identically.
 *
 * Mounted as a child of #infcanvas-root (a sibling of the stage), removed with
 * the shell on canvas exit. All host gestures are stopped in the bubble phase
 * so the panel never pans/zooms/cuts the canvas behind it.
 */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  const api = () => window.comfyAPI?.api?.api || NS.api?.raw || null;

  /* xterm.js default ANSI palette (the theme ComfyUI uses when not desktop:
     `theme: isDesktop ? { background: '#171717' } : undefined` -> xterm default).
     Foreground 30-37 / 90-97, background 40-47 / 100-107. */
  const ANSI_FG = [
    "#000000", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
    "#5c6370", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
  ];
  const ANSI_BG = [
    "#000000", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
    "#5c6370", "#e06c75", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
  ];
  const MAX_LINES = 2000;       // bound the DOM (xterm scrollback is capped too)

  let root = null;
  let screen = null;            // scrolling log viewport
  let titleEl = null;
  let copyBtn = null;
  let closeBtn = null;
  let opened = false;
  let subscribed = false;
  let listeners = [];           // [[type, fn]] — removed on unmount
  let resyncController = null;
  let lineCount = 0;
  let resizeObserver = null;

  const mk = (tag) => document.createElement(tag);

  /* Publish the panel's real height to the canvas shell so floating widgets
     pinned to the bottom-right (the minimap) can ride above it instead of
     overlapping. Reading getBoundingClientRect after the .is-open class flip
     forces a reflow, so max-height:70% / short viewports stay accurate. */
  function syncOffset() {
    const host = root && root.parentElement;
    if (!host) return;
    if (!opened) { host.style.removeProperty("--ic-console-h"); return; }
    host.style.setProperty("--ic-console-h", Math.round(root.getBoundingClientRect().height) + "px");
  }

  /* ---- ANSI SGR -> styled spans ------------------------------------------
     xterm writes entries as raw strings that may contain CSI SGR sequences.
     We support the colour/bold subset ComfyUI's server logger emits; anything
     else is stripped so control bytes never reach the DOM. */
  function trim() {
    if (lineCount <= MAX_LINES) return;
    const drop = lineCount - MAX_LINES;
    // Remove from the top until `drop` <br> markers are gone.
    let removed = 0;
    while (screen.firstChild && removed < drop) {
      const node = screen.firstChild;
      node.remove();
      if (node.tagName === "BR") removed += 1;
    }
    lineCount = MAX_LINES;
  }

  function renderEntryText(text, fg, bg, bold) {
    const span = mk("span");
    span.textContent = text;
    if (fg) span.style.color = fg;
    if (bg) span.style.backgroundColor = bg;
    if (bold) span.style.fontWeight = "600";
    return span;
  }

  /* Style-correct writer: tracks SGR state and opens a new span whenever the
     style changes, matching xterm's per-cell colours. */
  function writeEntriesStyled(entries) {
    if (!screen || !Array.isArray(entries)) return;
    const text = entries.map((e) => (e && typeof e.m === "string" ? e.m : "")).join("");
    if (!text) return;

    let fg = null, bg = null, bold = false;
    let frag = document.createDocumentFragment();
    let pending = "";
    const emit = () => {
      if (!pending) return;
      frag.appendChild(renderEntryText(pending, fg, bg, bold));
      pending = "";
    };
    const applySGR = (params) => {
      emit();
      const codes = params === "" ? [0] : params.split(";").map((x) => (x === "" ? 0 : parseInt(x, 10)));
      for (const c of codes) {
        if (c === 0) { fg = null; bg = null; bold = false; }
        else if (c === 1) bold = true;
        else if (c === 22) bold = false;
        else if (c === 39) fg = null;
        else if (c === 49) bg = null;
        else if (c >= 30 && c <= 37) fg = ANSI_FG[c - 30];
        else if (c >= 90 && c <= 97) fg = ANSI_FG[c - 90 + 8];
        else if (c >= 40 && c <= 47) bg = ANSI_BG[c - 40];
        else if (c >= 100 && c <= 107) bg = ANSI_BG[c - 100 + 8];
      }
    };
    const newLine = () => {
      emit();
      screen.appendChild(frag);
      screen.appendChild(mk("br"));
      frag = document.createDocumentFragment();
      lineCount += 1;
    };

    const re = /\x1b\[([0-9;?]*)([A-Za-z])|\r?\n|\r/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      pending += text.slice(last, m.index);
      if (m[0] === "\n" || m[0] === "\r\n") newLine();
      else if (m[2] === "m") applySGR(m[1]);
      last = m.index + m[0].length;
    }
    pending += text.slice(last);
    emit();
    if (frag.firstChild) screen.appendChild(frag);

    trim();
    screen.scrollTop = screen.scrollHeight;
  }

  function reset() {
    if (screen) screen.replaceChildren();
    lineCount = 0;
  }

  /* ---- host API bridge --------------------------------------------------- */
  function listen(type, fn) {
    const a = api();
    if (!a || typeof a.addEventListener !== "function") return;
    a.addEventListener(type, fn);
    listeners.push([type, fn]);
  }
  function unlisten() {
    const a = api();
    for (const [type, fn] of listeners) {
      try { a?.removeEventListener?.(type, fn); } catch (e) { /* no-op */ }
    }
    listeners = [];
  }

  async function loadLogs() {
    const a = api();
    if (!a || typeof a.getRawLogs !== "function") {
      writeEntriesStyled([{ m: t("无法连接 ComfyUI 日志服务") + "\r\n" }]);
      return;
    }
    const controller = new AbortController();
    resyncController = controller;
    try {
      const logs = await a.getRawLogs();
      if (controller.signal.aborted) return;
      reset();
      writeEntriesStyled(logs?.entries || []);
      if (!subscribed && typeof a.subscribeLogs === "function") {
        await a.subscribeLogs(true);
        subscribed = true;
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      console.warn("[InfCanvas console] getRawLogs failed", e);
    }
  }

  function bindStream() {
    if (listeners.length) return;
    listen("logs", (e) => writeEntriesStyled(e?.detail?.entries || []));
    listen("reconnected", () => { void loadLogs(); });
  }

  /* ---- DOM --------------------------------------------------------------- */
  function build() {
    const el = mk("div");
    el.id = "infcanvas-console";
    el.className = "ic-console";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", t("控制台"));
    el.setAttribute("data-testid", "infcanvas-console");

    /* Stop canvas gestures (panel sits over the Vue Flow stage). */
    ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((type) => {
      el.addEventListener(type, (e) => e.stopPropagation());
    });

    const bar = mk("div");
    bar.className = "ic-console-bar";

    const tab = mk("div");
    tab.className = "ic-console-tab";
    tab.setAttribute("data-state", "active");
    titleEl = mk("span");
    titleEl.className = "font-normal";
    tab.appendChild(titleEl);

    const ops = mk("div");
    ops.className = "ic-console-ops";
    copyBtn = mk("button");
    copyBtn.type = "button";
    copyBtn.className = "ic-console-op";
    copyBtn.innerHTML = '<i class="pi pi-copy"></i>';
    copyBtn.addEventListener("click", copyAll);
    closeBtn = mk("button");
    closeBtn.type = "button";
    closeBtn.className = "ic-console-op";
    closeBtn.innerHTML = '<i class="pi pi-times"></i>';
    closeBtn.addEventListener("click", () => hide());
    ops.append(copyBtn, closeBtn);

    bar.append(tab, ops);

    screen = mk("div");
    screen.className = "ic-console-screen";
    screen.setAttribute("data-testid", "infcanvas-console-screen");

    el.append(bar, screen);
    return el;
  }

  async function copyAll() {
    const text = screen ? screen.innerText : "";
    try { await navigator.clipboard.writeText(text); }
    catch (e) { /* clipboard may be unavailable in insecure context */ }
  }

  function syncButton() {
    const btn = document.querySelector('#infcanvas-sidebar [data-key="console"]');
    if (btn) btn.classList.toggle("side-bar-button-selected", opened);
  }

  function show() {
    if (!root) return;
    root.classList.add("is-open");
    opened = true;
    syncButton();
    syncOffset();
    bindStream();
    void loadLogs();
  }
  function hide() {
    if (!root) return;
    root.classList.remove("is-open");
    opened = false;
    syncButton();
    syncOffset();
  }
  function toggle() { opened ? hide() : show(); }

  function mount(parent) {
    if (root && root.isConnected) return root;
    root = build();
    (parent || document.getElementById("infcanvas-root") || document.body).appendChild(root);
    repaintLocale();
    /* Subscribe to the stream even while hidden so opening shows live lines
       immediately; the initial snapshot is (re)loaded on first open. */
    bindStream();
    /* Keep the offset correct when the viewport shrinks and max-height:70%
       clamps the panel, or when its height is otherwise changed. */
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { if (opened) syncOffset(); });
      resizeObserver.observe(root);
    }
    return root;
  }

  function unmount() {
    if (resyncController) { resyncController.abort(); resyncController = null; }
    unlisten();
    subscribed = false;
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (root && root.parentElement) root.parentElement.style.removeProperty("--ic-console-h");
    if (root) { root.remove(); root = null; }
    screen = null; titleEl = null; copyBtn = null; closeBtn = null;
    opened = false; lineCount = 0;
  }

  function repaintLocale() {
    if (!root) return;
    root.setAttribute("aria-label", t("控制台"));
    if (titleEl) titleEl.textContent = t("日志").toUpperCase();
    if (copyBtn) copyBtn.title = t("复制日志");
    if (closeBtn) closeBtn.title = t("关闭控制台");
  }

  NS.consolePanel = { mount, unmount, show, hide, toggle, repaintLocale, writeEntries: writeEntriesStyled, isOpen: () => opened };
})();
