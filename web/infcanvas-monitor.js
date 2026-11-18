/* Canvas-mode system monitor (top-right floating strip).
 *
 * Mirrors the ComfyUI menu-bar status bar (web/monitor.js) INSIDE the infinite
 * canvas, because canvas mode hides the host's own topbar (infcanvas-style.js).
 * One block, matching the menu bar exactly:
 *
 *   [RAM Cleanup] [VRAM Cleanup] | [CPU] [RAM] [GPU] [VRAM] [TEMP]   (fig. 2)
 *
 * Data:  GET /xxxxxlcat-monitor  (telemetry, 500ms)
 * Action: POST /prompt           RAM/VRAM cleanup nodes
 *
 * Mounted as a child of #infcanvas-root (a sibling of the Vue Flow stage), so
 * it is removed together with the shell on canvas exit. All host gestures are
 * stopped in the bubbling phase so the strip never pans/zooms/cuts the canvas.
 * Native DOM only — no custom component library inside the canvas shell.
 */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const t = (key, params) => (NS.i18n ? NS.i18n.t(key, params) : key);
  const api = () => window.comfyAPI?.api?.api || NS.api?.raw || null;

  const REFRESH_MS = 500;
  /* Exact metrics from web/monitor.js (the menu-bar status bar) so the canvas
     copy is pixel-identical to the native one — don't invent new sizes. */
  const BAR_H = 32;
  const BAR_RADIUS = 8;
  const COLORS = { cpu: "#207125", ram: "#357E3B", gpu: "#0B8CE9", vram: "#2498EA", temp: "#B33A3A" };
  const TEMP_MIN = 40, TEMP_MAX = 85, TEMP_COLD = "#207125", TEMP_HOT = "#B33A3A";
  const BOX_BG = "#262729";
  const TEXT_COLOR = "#FFFFFF";
  const LABEL_COLOR = "rgba(255,255,255,.55)";
  const PLATE_BG = "rgba(23,23,24,.94)";

  const CLEANUP = {
    ram: { cls: "🐈‍⬛RAMReclaim", inputs: { clean_file_cache: true, clean_processes: true, clean_dlls: true, retry_times: 3 } },
    vram: { cls: "🐈‍⬛VRAMSweep", inputs: { offload_model: true, offload_cache: true } },
  };
  /* Build a /prompt node graph for a cleanup kind. `both` chains RAM off VRAM's
     pass-through output so ComfyUI runs VRAM first, then RAM, in one queue. */
  function cleanPrompt(kind) {
    const vram = { class_type: "🐈‍⬛VRAMSweep", inputs: { offload_model: true, offload_cache: true } };
    const ram = (anything) => ({
      class_type: "🐈‍⬛RAMReclaim",
      inputs: {
        clean_file_cache: true, clean_processes: true, clean_dlls: true, retry_times: 3,
        ...(anything ? { anything } : {}),
      },
    });
    if (kind === "ram") return { clean_1: ram(null) };
    if (kind === "both") return { clean_1: vram, clean_2: ram(["clean_1", 0]) };
    return { clean_1: vram }; // vram (default)
  }

  let root = null;
  let timer = null;
  let segs = null;
  let maxVRAM = 0;

  const mk = (tag) => document.createElement(tag);
  const fmtGB = (gb) => (gb >= 100 ? gb.toFixed(0) : gb.toFixed(1));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function tempColor(ratio) {
    const t2 = clamp(ratio, 0, 1);
    const ah = parseInt(TEMP_COLD.slice(1), 16), bh = parseInt(TEMP_HOT.slice(1), 16);
    const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
    const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
    return "rgb(" + Math.round(ar + (br - ar) * t2) + "," + Math.round(ag + (bg - ag) * t2) + "," + Math.round(ab + (bb - ab) * t2) + ")";
  }

  function mkSeg(key, label, color) {
    const seg = mk("div");
    seg.className = "ic-cm-seg";
    seg.dataset.key = key;
    seg.style.cssText = [
      "position:relative;overflow:hidden;flex-shrink:0;",
      "width:38px;height:" + BAR_H + "px;border-radius:" + BAR_RADIUS + "px;",
      "background:rgba(255,255,255,.07);",
      "box-shadow:none;border:0;",
      "user-select:none;cursor:default;",
    ].join("");
    const fill = mk("i");
    fill.style.cssText =
      "position:absolute;left:0;right:0;bottom:0;height:0%;" +
      "background:" + color + ";opacity:1;transition:height .5s;z-index:0;";
    const val = mk("div");
    val.style.cssText =
      "position:absolute;top:3px;left:0;right:0;text-align:center;" +
      "font-size:10px;font-weight:600;color:" + TEXT_COLOR + ";" +
      "text-shadow:0 1px 2px rgba(0,0,0,.78);font-variant-numeric:tabular-nums;z-index:1;";
    val.textContent = "…";
    const lbl = mk("div");
    lbl.textContent = label;
    lbl.style.cssText =
      "position:absolute;bottom:2px;left:0;right:0;text-align:center;" +
      "font-size:8.5px;color:" + LABEL_COLOR + ";z-index:1;";
    seg.append(fill, val, lbl);
    return { seg, val, fill };
  }

  function setSeg(s, pct, text, title, fillColor) {
    s.fill.style.height = clamp(pct, 0, 100).toFixed(1) + "%";
    if (fillColor) s.fill.style.background = fillColor;
    s.val.textContent = text;
    if (title) s.seg.title = title;
  }

  function mkCleanupButton(kind) {
    const def = CLEANUP[kind];
    const btn = mk("button");
    btn.type = "button";
    btn.className = "ic-cm-clean";
    btn.dataset.kind = kind;
    const top = kind === "ram" ? "RAM" : "VRAM";
    btn.title = top + " Cleanup";
    btn.style.cssText = [
      "display:flex;flex-direction:column;align-items:center;justify-content:center;",
      "width:50px;height:" + BAR_H + "px;flex-shrink:0;border-radius:" + BAR_RADIUS + "px;",
      "box-sizing:border-box;border:0;outline:none;box-shadow:none;background:" + BOX_BG + ";",
      "color:" + TEXT_COLOR + ";cursor:pointer;padding:0;line-height:1.15;transition:background .15s;",
    ].join("");
    const l1 = mk("div");
    l1.textContent = top;
    l1.style.cssText = "font-size:11px;font-weight:600;color:" + TEXT_COLOR + ";";
    const l2 = mk("div");
    l2.textContent = "Cleanup";
    l2.style.cssText = "font-size:10px;color:" + LABEL_COLOR + ";";
    btn.append(l1, l2);
    btn.addEventListener("mouseenter", () => { if (!btn.disabled) btn.style.background = "rgba(255,255,255,.12)"; });
    btn.addEventListener("mouseleave", () => { if (!btn.disabled) btn.style.background = BOX_BG; });
    btn.addEventListener("click", () => runCleanup(kind, btn));
    return btn;
  }

  function mkSeparator() {
    const sep = mk("div");
    sep.style.cssText = "width:1px;height:22px;background:rgba(255,255,255,.22);margin:0 3px;flex:0 0 auto;";
    return sep;
  }

  function build() {
    const el = mk("div");
    el.id = "infcanvas-monitor";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", t("系统状态"));
    el.style.cssText = [
      "position:absolute;right:8px;top:46px;z-index:1000;",
      "display:flex;flex-direction:column;align-items:flex-start;gap:5px;",
      "pointer-events:auto;user-select:none;",
    ].join("");

    /* Stop canvas-level gestures in the bubble phase (capture stays open so
       the buttons still receive their own events). */
    ["pointerdown", "mousedown", "dblclick", "wheel", "contextmenu"].forEach((type) => {
      el.addEventListener(type, (e) => e.stopPropagation());
    });

    const plate = mk("div");
    plate.style.cssText = [
      "display:flex;flex-direction:row;align-items:center;gap:5px;",
      "height:40px;padding:0 6px;box-sizing:border-box;",
      "background:" + PLATE_BG + ";border:1px solid rgba(255,255,255,.08);border-radius:" + BAR_RADIUS + "px;",
    ].join("");
    plate.append(mkCleanupButton("ram"), mkCleanupButton("vram"), mkSeparator());
    segs = {
      cpu: mkSeg("cpu", "CPU", COLORS.cpu),
      ram: mkSeg("ram", "RAM", COLORS.ram),
      gpu: mkSeg("gpu", "GPU", COLORS.gpu),
      vram: mkSeg("vram", "VRAM", COLORS.vram),
      temp: mkSeg("temp", "TEMP", COLORS.temp),
    };
    Object.keys(segs).forEach((k) => plate.append(segs[k].seg));

    el.append(plate);
    return el;
  }

  function renderTelemetry(data) {
    if (!data || !segs) return;
    if (data.cpu && data.cpu.percent != null) {
      const p = data.cpu.percent;
      setSeg(segs.cpu, p, Math.floor(p) + "%", "CPU " + Math.floor(p) + "%");
    }
    if (data.ram) {
      const rp = data.ram.percent;
      setSeg(segs.ram, rp, Math.floor(rp) + "%",
        "RAM " + Math.floor(rp) + "% · " + fmtGB(data.ram.used_gb) + "G / " + fmtGB(data.ram.total_gb) + "G");
    }
    const gpu = data.gpus && data.gpus[0];
    if (gpu) {
      setSeg(segs.gpu, gpu.usage, Math.floor(gpu.usage) + "%", "GPU " + Math.floor(gpu.usage) + "% · " + gpu.name);
      const vramP = 100 * (gpu.vram_used_gb / gpu.vram_total_gb);
      if (gpu.vram_used_gb > maxVRAM) maxVRAM = gpu.vram_used_gb;
      let vramTitle = "VRAM " + Math.floor(vramP) + "% · " + fmtGB(gpu.vram_used_gb) + "G / " + fmtGB(gpu.vram_total_gb) + "G";
      if (maxVRAM > 0) vramTitle += " · Max " + fmtGB(maxVRAM) + "G";
      setSeg(segs.vram, vramP, fmtGB(gpu.vram_used_gb) + "G", vramTitle);
      const ratio = clamp((gpu.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
      setSeg(segs.temp, ratio * 100, Math.round(gpu.temp) + "°C", "TEMP " + Math.round(gpu.temp) + "°C · " + gpu.name, tempColor(ratio));
    } else {
      ["gpu", "vram", "temp"].forEach((key) => setSeg(segs[key], 0, "N/A", key.toUpperCase() + " N/A"));
    }
  }

  async function runCleanup(kind, btn) {
    /* `btn` is optional: the three 30px cleanup pills in the canvas call this
       with just a kind, so the action has to work without a monitor button. */
    if (btn && btn.disabled) return false;
    if (btn) { btn.disabled = true; btn.style.opacity = ".45"; }
    let ok = false;
    try {
      const a = api();
      const prompt = cleanPrompt(kind);
      if (a && a.fetchApi) {
        const resp = await a.fetchApi("/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, client_id: a.clientId || "xxxxxlcat-canvas-monitor" }),
        });
        ok = !resp || resp.ok !== false;
      } else {
        const resp = await fetch("/prompt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, client_id: "xxxxxlcat-canvas-monitor" }),
        });
        ok = !resp || resp.ok !== false;
      }
    } catch (e) { /* silent: restore the button / pill below */ }
    if (btn) setTimeout(() => { btn.disabled = false; btn.style.opacity = ""; }, 800);
    return ok;
  }

  async function tick() {
    const fetchJson = async (url) => {
      const a = api();
      const resp = a && a.fetchApi ? await a.fetchApi(url, { cache: "no-store" }) : await fetch(url, { cache: "no-store" });
      return resp && resp.ok ? resp.json() : null;
    };
    try { renderTelemetry(await fetchJson("/xxxxxlcat-monitor")); } catch (e) { /* keep last reading */ }
  }

  function mount(parent) {
    if (root && root.isConnected) return root;
    root = build();
    (parent || document.getElementById("infcanvas-root") || document.body).appendChild(root);
    repaintLocale();
    tick();
    if (timer) clearInterval(timer);
    timer = setInterval(tick, REFRESH_MS);
    return root;
  }

  function unmount() {
    if (timer) { clearInterval(timer); timer = null; }
    if (root) { root.remove(); root = null; }
    segs = null; maxVRAM = 0;
  }

  function repaintLocale() {
    if (!root) return;
    root.setAttribute("aria-label", t("系统状态"));
  }

  NS.canvasMonitor = { mount, unmount, repaintLocale, tick, runCleanup, get root() { return root; } };
})();
