/* Video / audio node tools -- FFmpeg backend, reference interaction model.

   The operation flow is ported from the reference project's
   xcat-video-edit.js / xcat-audio-edit.js / xcat-media-core.js:

     video 提取 / 分离 : click -> progress dialog -> 1 / 2 result nodes
     video 截取                : preview + 10 thumbnails + two draggable
                                 handles + ruler + numeric start/end, playback
                                 confined to the selection -> 1 mp4 node
     video 抽帧                : three-way menu anchored to the button
                                 (当前帧 / 首帧 / 尾帧) -> progress -> 1 png
     audio 截取                : waveform multi-segment editor (split / merge /
                                 delete / undo / redo / audition) -> 1 m4a
     audio 变速                : 0.1-4 slider + 6 presets + numeric + duration
                                 estimate -> 1 m4a

   All six call POST /api/infcanvas/{audio,video}/process (FFmpeg). The backend
   writes m4a / mp4 / png into input/infcanvas and returns asset descriptors;
   NS.tools.spawnRefs() turns them into nodes. Media is never re-encoded in the
   browser and the source node is never replaced.

   Because a Python change needs a real ComfyUI restart, every dialog shows a
   readiness banner from createProbe() instead of a JSON parse error. */
(() => {
  const NS = (window.InfCanvas = window.InfCanvas || {});
  const R = (NS.icRegistry = NS.icRegistry || {});
  const T = () => NS.tools;

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const fmt = (v) => T()?.fmtPrecise?.(v) ?? "0:00.00";
  const toast = (kind, summary, detail = "") => {
    if (NS.api?.toast) NS.api.toast(kind, summary, detail);
    else console.log("[InfCanvas media tools]", kind, summary, detail);
  };
  const refOf = (ctx) => T().refOf(ctx);
  const stemOf = (name) => String(name || "asset").replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "asset";

  let probes = null;
  function getProbes() {
    if (!probes) {
      probes = {
        audio: T().createProbe(T().API_AUDIO),
        video: T().createProbe(T().API_VIDEO),
      };
    }
    return probes;
  }

  /* --------------------------- request / results ------------------------- */

  async function runRequest(api, payload, ctx, opts) {
    const ui = opts.ui;
    const probe = getProbes()[opts.kind];
    const ok = await probe.check();
    if (!ok) {
      toast("error", T().NOT_READY);
      ui?.setApiReady?.(false);
      ui?.setWarn?.(false);
      ui?.setStatus?.("后端接口未就绪，需重启 ComfyUI", true);
      T().closeModal();
      return false;
    }
    ui?.setApiReady?.(true);
    ui?.setWarn?.(true);
    ui?.setBusy?.(true);
    ui?.lock?.(true);
    try {
      const data = await T().request(api, payload, ui?.signal);
      const files = data.files || [];
      if (!files.length) throw new Error("后端没有返回产物");
      T().spawnRefs(files, ctx);
      T().closeModal();
      toast("success", opts.done || `已生成 ${files.length} 个新节点`);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") {
        T().closeModal();
        toast("info", "已取消");
        return false;
      }
      if (String(error?.message || "").includes("接口未就绪")) {
        probe.invalidate();
        ui?.setApiReady?.(false);
        ui?.setWarn?.(false);
      }
      ui?.setStatus?.(String(error?.message || error), true);
      ui?.setBusy?.(false);
      ui?.lock?.(false);
      toast("error", (opts.label || "媒体") + "处理失败", String(error?.message || error));
      return false;
    }
  }

  async function preflight(ui, kind, onReady) {
    const ok = await getProbes()[kind].check();
    ui.setApiReady(ok);
    ui.setWarn(ok);
    if (!ok) ui.setStatus("后端接口未就绪，需重启 ComfyUI", true);
    else ui.setStatus("");
    /* The reference paints the timeline/waveform regardless of readiness;
       the shell's apiReady gate keeps Apply disabled in the same render pass. */
    onReady?.();
    return ok;
  }

  /* Click-to-run actions show a compact spinner dialog, not a confirm dialog. */
  function progressModal(kind, title, sub, ctx, payload, opts = {}) {
    const api = kind === "audio" ? T().API_AUDIO : T().API_VIDEO;
    T().openModal({
      title, sub, width: 440,
      progress: true,
      progressText: `正在用 FFmpeg 处理${kind === "audio" ? "音频" : "视频"}，请稍候…`,
      cancelLabel: "取消处理",
      warn: T().WARN_HTML,
      run: (ui) => runRequest(api, payload, ctx, {
        ui, kind, label: kind === "audio" ? "音频" : "视频", done: opts.done,
      }),
    });
  }

  /* --------------------------- video: no-arg actions --------------------- */

  R.extractAudio = (ctx) => progressModal("video", "提取",
    "提取音轨并生成音频节点，保留原视频", ctx,
    { ref: refOf(ctx), action: "extractAudio" },
    { done: "已生成音轨节点" });

  R.separate = (ctx) => progressModal("video", "分离",
    "生成静音视频和音轨两个节点，保留原视频", ctx,
    { ref: refOf(ctx), action: "separate" },
    { done: "已生成静音视频和音轨两个节点" });

  /* --------------------------- video: frame menu ------------------------- */

  R.frame = (ctx) => {
    const anchor = ctx.button || document.querySelector(
      `.vue-flow__node[data-id="${ctx.id}"] .icn__tool[data-action="frame"]`);
    if (!anchor) { toast("error", "无法定位抽帧按钮"); return; }
    const wrap = document.querySelector(`.vue-flow__node[data-id="${ctx.id}"]`);
    const nodeVideo = wrap?.querySelector("video");
    const current = nodeVideo && Number.isFinite(nodeVideo.currentTime) && nodeVideo.currentTime > 0
      ? nodeVideo.currentTime : 0;
    T().openMenu(anchor, [
      { label: "抽取当前帧", value: fmt(current), onPick: () => runFrame("current", ctx, current) },
      { label: "抽取首帧", onPick: () => runFrame("first", ctx, 0) },
      { label: "抽取尾帧", onPick: () => runFrame("last", ctx, 0) },
    ]);
  };

  function runFrame(which, ctx, time) {
    const labels = { current: "当前帧", first: "首帧", last: "尾帧" };
    progressModal("video", "抽帧",
      `导出${labels[which]}为 PNG 图片节点，保留原视频`, ctx,
      { ref: refOf(ctx), action: "frame", frame: which, time: time || 0 },
      { done: "已生成图片节点" });
  }

  /* ------------------------------ video: trim ---------------------------- */

  function loadVideo(url) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
      video.addEventListener("loadedmetadata", () => resolve(video), { once: true });
      video.addEventListener("error", () => reject(new Error("视频加载失败")), { once: true });
      video.load();
    });
  }

  /* Fixed 10 thumbnails, independent of clip length; offscreen video seeks and
     draws 160x96 JPEGs with `cover`. Stops as soon as the dialog is gone. */
  function buildThumbs(src, duration, cb, alive) {
    const video = document.createElement("video");
    video.muted = true; video.preload = "auto"; video.playsInline = true; video.src = src;
    const count = 10;
    const out = new Array(count).fill("");
    let index = 0, done = false, started = false, timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      video.onloadeddata = video.onseeked = video.onerror = null;
      try { video.removeAttribute("src"); video.load(); } catch (error) { /* optional */ }
      cb(out);
    };
    const shot = () => {
      if (done) return;
      if ((alive && !alive()) || index >= count) return finish();
      try {
        video.currentTime = Math.min(duration * (index + 0.5) / count,
          Math.max(0, duration - 0.001));
      } catch (error) { index += 1; shot(); }
    };
    const start = () => {
      if (started || done) return;
      started = true;
      shot();
    };
    timer = setTimeout(finish, 15000);
    video.addEventListener("loadeddata", start);
    if (video.readyState >= 2) setTimeout(start, 0);
    video.addEventListener("seeked", () => {
      if (done || (alive && !alive())) return finish();
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 96;
        const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const w = video.videoWidth * scale, h = video.videoHeight * scale;
        canvas.getContext("2d").drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        out[index] = canvas.toDataURL("image/jpeg", 0.75);
      } catch (error) { /* placeholder */ }
      index += 1; shot();
    });
    video.addEventListener("error", finish);
  }

  R.trim = (ctx) => {
    const S = { duration: 0, limit: 0, minLen: 0.01, start: 0, end: 0, current: 0 };
    let ui = null, video, track, strip, startInput, endInput;
    const valid = () => S.duration > 0 && S.start >= 0 && S.end > S.start &&
      S.end <= S.limit + 0.000001;

    const q = (selector) => ui?.body.querySelector(selector);
    const paintPlayhead = () => {
      if (!S.duration || !ui) return;
      if (video && Number.isFinite(video.currentTime)) S.current = video.currentTime;
      const head = q(".ict-tl-playhead");
      if (head) head.style.left = (clamp(S.current / S.duration, 0, 1) * 100) + "%";
    };
    function paint(skipInputs = false) {
      if (!S.duration || !ui) return;
      const startPct = clamp(S.start / S.duration, 0, 1) * 100;
      const endPct = clamp(S.end / S.duration, 0, 1) * 100;
      const sel = q(".ict-tl-sel");
      if (sel) { sel.style.left = startPct + "%"; sel.style.width = Math.max(0, endPct - startPct) + "%"; }
      const ml = q(".ict-ml"), mr = q(".ict-mr");
      if (ml) { ml.style.left = "0"; ml.style.width = startPct + "%"; }
      if (mr) { mr.style.left = endPct + "%"; mr.style.width = (100 - endPct) + "%"; }
      const hs = q(".ict-hs"), he = q(".ict-he");
      if (hs) {
        hs.style.left = startPct + "%";
        hs.setAttribute("aria-valuenow", S.start.toFixed(2));
        hs.setAttribute("aria-valuetext", S.start.toFixed(2) + " 秒");
      }
      if (he) {
        he.style.left = endPct + "%";
        he.setAttribute("aria-valuenow", S.end.toFixed(2));
        he.setAttribute("aria-valuetext", S.end.toFixed(2) + " 秒");
      }
      const sub = q(".ict-tl-dur");
      if (sub) sub.textContent = "原视频 " + fmt(S.duration);
      const length = q(".ict-length");
      if (length) length.textContent = "时长 " + (valid() ? (S.end - S.start).toFixed(2) : "—") + " 秒";
      const hint = q(".ict-trim-hint");
      if (hint) hint.textContent = valid()
        ? "点击时间轴可预览对应画面；播放只播放选中的片段。"
        : "请选择有效的起止时间。";
      if (!skipInputs) {
        if (startInput && document.activeElement !== startInput) startInput.value = S.start.toFixed(2);
        if (endInput && document.activeElement !== endInput) endInput.value = S.end.toFixed(2);
      }
      paintPlayhead();
      ui.setApplyEnabled(valid());
    }
    function seekPreview(value) {
      if (!S.duration || !Number.isFinite(value) || !ui || !video) return;
      video.pause();
      try { video.currentTime = clamp(value, 0, Math.max(0, S.duration - 0.001)); }
      catch (error) { /* optional */ }
      S.current = video.currentTime;
      paintPlayhead();
    }
    function setBoundary(edge, value) {
      if (!S.duration || !Number.isFinite(value)) return;
      const rounded = Math.round(value * 100) / 100;
      if (edge === "start") S.start = clamp(rounded, 0, Math.max(0, S.end - S.minLen));
      else S.end = clamp(rounded, S.start + S.minLen, S.limit);
      S.start = +S.start.toFixed(2);
      S.end = +S.end.toFixed(2);
      paint();
      seekPreview(edge === "start" ? S.start : S.end);
    }
    function onTimeInput(event) {
      if (!S.duration) return;
      const which = event?.target === endInput ? "end" : "start";
      const a = parseFloat(startInput.value), b = parseFloat(endInput.value);
      if (Number.isFinite(a)) S.start = clamp(+a.toFixed(2), 0, S.limit);
      if (Number.isFinite(b)) S.end = clamp(+b.toFixed(2), 0, S.limit);
      if (S.end < S.start + S.minLen) {
        if (which === "start") S.start = Math.max(0, S.end - S.minLen);
        else S.end = Math.min(S.limit, S.start + S.minLen);
      }
      paint(true);
      seekPreview(which === "start" ? S.start : S.end);
    }
    function bindHandle(el, which) {
      if (!el) return;
      el.addEventListener("pointerdown", (event) => {
        if (!S.duration || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        const width = track.getBoundingClientRect().width;
        if (!width) return;
        const x0 = event.clientX, t0 = which === "start" ? S.start : S.end, pid = event.pointerId;
        try { el.setPointerCapture(pid); } catch (error) { /* optional */ }
        seekPreview(t0);
        const move = (ev) => {
          if (ev.pointerId !== pid) return;
          setBoundary(which, t0 + (ev.clientX - x0) / width * S.duration);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          try { if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid); } catch (error) { /* optional */ }
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      });
      el.addEventListener("keydown", (event) => {
        if (!S.duration) return;
        const step = event.shiftKey ? 1 : 0.1;
        const t = which === "start" ? S.start : S.end;
        let next;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = t - step;
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = t + step;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = S.limit;
        else return;
        event.preventDefault(); event.stopPropagation();
        setBoundary(which, next);
      });
    }

    T().openModal({
      title: "截取", sub: "正在读取视频…", width: 760,
      applyLabel: "截取", applyDisabled: true, cancelLabel: "取消",
      warn: T().WARN_HTML,
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-video-preview"><video controls playsinline preload="auto"></video></div>
          <div class="ict-tl">
            <div class="ict-tl-head"><span>拖动左右边界，选择保留的片段</span><span class="ict-tl-dur">原视频 00:00.00</span></div>
            <div class="ict-track">
              <div class="ict-strip"></div>
              <div class="ict-tl-mask ict-ml"></div><div class="ict-tl-mask ict-mr"></div>
              <div class="ict-tl-sel"></div><div class="ict-tl-playhead"></div>
              <button type="button" class="ict-tl-handle ict-hs" role="slider"
                      aria-label="片段开始边界" aria-orientation="horizontal"><span></span></button>
              <button type="button" class="ict-tl-handle ict-he" role="slider"
                      aria-label="片段结束边界" aria-orientation="horizontal"><span></span></button>
            </div>
            <div class="ict-tl-ruler"></div>
          </div>
          <div class="ict-times">
            <label>开始时间 <input class="ict-input ict-start" type="number" step="0.01" min="0" value="0.00" /><span>秒</span></label>
            <label>结束时间 <input class="ict-input ict-end" type="number" step="0.01" min="0" value="0.00" /><span>秒</span></label>
            <span class="ict-length ict-length">时长 — 秒</span>
          </div>
          <p class="ict-hint ict-trim-hint">点击时间轴可预览对应画面；播放只播放选中的片段。</p>`;
        video = q("video");
        track = q(".ict-track");
        strip = q(".ict-strip");
        startInput = q(".ict-start");
        endInput = q(".ict-end");
        let mediaUrl = ctx.url;
        if (NS.api?.resolveMediaUrl) {
          NS.api.resolveMediaUrl(ctx.data?.asset || {}).then((u) => {
            mediaUrl = u;
            if (ui?.mask?.isConnected && video) video.src = u;
          }).catch(() => { /* keep ctx.url */ });
        }
        video.src = mediaUrl;
        for (const input of [startInput, endInput]) {
          input.addEventListener("focus", function () { this.select(); });
          input.addEventListener("input", onTimeInput);
        }
        bindHandle(q(".ict-hs"), "start");
        bindHandle(q(".ict-he"), "end");
        track.addEventListener("pointerdown", (event) => {
          if (!S.duration || event.button !== 0) return;
          const box = track.getBoundingClientRect();
          if (!box.width) return;
          const t = (event.clientX - box.left) / box.width * S.duration;
          seekPreview(clamp(t, S.start, S.end));
        });
        video.addEventListener("loadedmetadata", () => {
          const d = Number(video.duration);
          if (!Number.isFinite(d) || d <= 0) { ui.setStatus("无法读取视频时长", true); return; }
          S.duration = d;
          S.limit = Math.floor(d * 100) / 100;
          S.minLen = Math.min(0.01, S.limit);
          S.start = 0; S.end = S.limit; S.current = 0;
          startInput.max = S.limit; endInput.max = S.limit;
          const ruler = q(".ict-tl-ruler");
          if (ruler) ruler.innerHTML = [0, 1, 2, 3, 4]
            .map((i) => `<span>${fmt(S.duration * i / 4)}</span>`).join("");
          ui.setStatus("");
          paint();
          buildThumbs(mediaUrl, d, (list) => {
            if (!ui?.mask?.isConnected || !strip) return;
            strip.innerHTML = list.map((src) => src
              ? `<img src="${src}" alt="" draggable="false" />` : "<i></i>").join("");
          }, () => !!ui?.mask?.isConnected);
        });
        video.addEventListener("timeupdate", () => {
          if (!S.duration) return;
          S.current = video.currentTime;
          paintPlayhead();
          if (!video.paused && valid() && video.currentTime >= S.end) {
            video.pause();
            try { video.currentTime = Math.max(0, S.end - 0.001); } catch (error) { /* optional */ }
          }
        });
        video.addEventListener("seeked", paintPlayhead);
        video.addEventListener("play", () => {
          if (!valid()) return;
          if (video.currentTime < S.start || video.currentTime >= S.end) {
            try { video.currentTime = S.start; } catch (error) { /* optional */ }
          }
        });
        video.addEventListener("error", () => ui.setStatus("视频预览加载失败，缩略图可能不可用", true));
        ui.lock = (on) => {
          for (const element of [startInput, endInput, q(".ict-hs"), q(".ict-he")]) {
            if (element) element.disabled = !!on;
          }
          track.style.pointerEvents = on ? "none" : "";
        };
        preflight(ui, "video", () => paint());
      },
      onClose: () => { try { video?.pause(); } catch (error) { /* optional */ } },
      onApply: () => {
        if (!valid()) throw new Error("请选择有效的起止时间");
        return runRequest(T().API_VIDEO,
          { ref: refOf(ctx), action: "trim", start: S.start, end: S.end }, ctx,
          { ui, kind: "video", label: "视频", done: "已生成新的视频节点" });
      },
    });
  };

  /* --------------------------- audio: waveform --------------------------- */

  function offlineContext(length = 1, sampleRate = 44100) {
    const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) throw new Error("浏览器不支持音频解码");
    return new OC(1, Math.max(1, length), sampleRate);
  }
  async function decodeUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("素材读取失败：HTTP " + response.status);
    const data = await response.arrayBuffer();
    return await offlineContext().decodeAudioData(data);
  }
  function computePeaks(buffer, count = 1200) {
    const data = buffer.getChannelData(0);
    const out = new Float32Array(count);
    const size = Math.max(1, Math.floor(data.length / count));
    for (let i = 0; i < count; i += 1) {
      let peak = 0;
      for (let j = i * size; j < Math.min(data.length, i * size + size); j += 1) {
        const value = Math.abs(data[j]);
        if (value > peak) peak = value;
      }
      out[i] = peak;
    }
    return out;
  }
  function fakePeaks(seedText) {
    const out = new Float32Array(1200);
    let seed = 0;
    for (let i = 0; i < seedText.length; i += 1) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
    for (let k = 0; k < 1200; k += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out[k] = 0.18 + (seed / 4294967296) * 0.5 * (0.6 + 0.4 * Math.sin(k / 17));
    }
    return out;
  }
  function drawClipWave(canvas, peaks, duration, kept) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#232428";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!peaks || !peaks.length || !kept || !kept.length) return;
    const mid = canvas.height / 2;
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(canvas.width, mid + 0.5);
    ctx.stroke();
    ctx.fillStyle = "#0b8ce9";
    ctx.globalAlpha = 0.5;
    const count = Math.max(1, Math.floor(rect.width / 4));
    const maxH = canvas.height * 0.82;
    const N = peaks.length;
    /* The kept ranges are laid out *contiguously* (end-to-end), exactly like the
       segment track below: deleted parts are gone, the surviving fragments are
       stitched together so the waveform reads as one continuous clip. Each column
       samples the peak at its position inside that concatenated timeline (via
       `idx`), which is what makes deleting a segment visibly change the waveform. */
    let totalKept = 0;
    for (const r of kept) totalKept += Math.max(0, r.end - r.start);
    if (totalKept <= 0) { ctx.globalAlpha = 1; return; }
    for (let i = 0; i < count; i += 1) {
      const keptT = (i / count) * totalKept; // position inside the concatenated timeline
      let acc = 0, srcT = 0;
      for (const r of kept) {
        const len = Math.max(0, r.end - r.start);
        if (keptT <= acc + len) { srcT = r.start + (keptT - acc); break; }
        acc += len;
      }
      const idx = clamp(Math.floor(srcT / (duration || 1) * N), 0, N - 1);
      const value = peaks[idx] || 0;
      const height = Math.max(2 * dpr, value * maxH);
      ctx.fillRect(i * 4 * dpr + dpr, mid - height / 2, 2 * dpr, height);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------------------------- audio: clip ------------------------------ */

  R.clip = async (ctx) => {
    const MIN_GAP = 0.01;
    let buffer = null, duration = 0, peaks = null;
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctx.data?.asset || {}).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    try {
      buffer = await decodeUrl(mediaUrl);
      duration = buffer.duration;
      peaks = computePeaks(buffer);
    } catch (error) { /* playable but undecodable: fall back to metadata */ }
    if (!duration) {
      duration = await new Promise((resolve) => {
        const audio = new Audio(mediaUrl);
        let done = false;
        const finish = (value) => { if (!done) { done = true; resolve(value || 0); } };
        audio.addEventListener("loadedmetadata", () => finish(
          Number.isFinite(audio.duration) ? audio.duration : 0));
        audio.addEventListener("error", () => finish(0));
        setTimeout(() => finish(0), 4000);
      });
      peaks = fakePeaks(mediaUrl);
    }
    if (!duration) throw new Error("无法读取音频时长，不能剪辑");

    const S = {
      duration, peaks, groups: [[{ start: 0, end: duration }]],
      selected: 0, playhead: 0, undoStack: [], redoStack: [],
      audio: new Audio(mediaUrl), playClip: 0, playPart: 0,
    };
    S.audio.preload = "auto";
    let ui = null;
    const q = (selector) => ui?.body.querySelector(selector);

    const clips = () => {
      let offset = 0;
      return S.groups.map((ranges) => {
        let length = 0;
        const parts = ranges.map((r) => {
          const part = { start: r.start, end: r.end, offset: length, length: r.end - r.start };
          length += part.length;
          return part;
        });
        const clip = { parts, offset, length };
        offset += length;
        return clip;
      });
    };
    const totalDuration = () => clips().reduce((sum, c) => sum + c.length, 0);
    const timelineDuration = () => totalDuration() || S.duration || 1;
    const valid = () => S.duration > 0 && S.groups.length > 0 && S.groups.every((group) =>
      group.length && group.every((r) => Number.isFinite(r.start) && Number.isFinite(r.end) &&
        r.start >= 0 && r.end > r.start && r.end <= S.duration + 0.05));
    const snapshot = () => ({
      groups: S.groups.map((g) => g.map((r) => ({ start: r.start, end: r.end }))),
      selected: S.selected, playhead: S.playhead,
    });
    const pause = () => { try { S.audio?.pause(); } catch (error) { /* optional */ } };
    function seekPlayer() {
      if (!S.groups.length) return;
      const list = clips();
      let index = list.findIndex((c) => c.offset + c.length > S.playhead);
      if (index < 0) index = Math.max(0, list.length - 1);
      S.playClip = index;
      const clip = list[index];
      if (!clip) return;
      let partIndex = clip.parts.findIndex((p) => clip.offset + p.offset + p.length > S.playhead);
      if (partIndex < 0) partIndex = clip.parts.length - 1;
      S.playPart = partIndex;
      const part = clip.parts[partIndex];
      if (!part) return;
      try { S.audio.currentTime = part.start + S.playhead - clip.offset - part.offset; }
      catch (error) { /* optional */ }
    }
    function applyState(state, silent) {
      pause();
      S.groups = state.groups;
      S.selected = clamp(state.selected, 0, Math.max(0, S.groups.length - 1));
      S.playhead = clamp(state.playhead, 0, totalDuration());
      if (!silent) { S.undoStack = []; S.redoStack = []; }
      seekPlayer();
      render();
    }
    function commit(next, index, time) {
      S.undoStack.push(snapshot());
      S.redoStack = [];
      applyState({ groups: next, selected: index,
                   playhead: time == null ? S.playhead : time }, true);
    }
    function undo() {
      if (!S.undoStack.length) return;
      S.redoStack.push(snapshot());
      applyState(S.undoStack.pop(), true);
    }
    function redo() {
      if (!S.redoStack.length) return;
      S.undoStack.push(snapshot());
      applyState(S.redoStack.pop(), true);
    }
    function split() {
      const list = clips(), clip = list[S.selected];
      if (!clip) return;
      const t = S.playhead - clip.offset;
      if (t < MIN_GAP || clip.length - t < MIN_GAP) return;
      const left = [], right = [];
      clip.parts.forEach((part) => {
        if (part.offset + part.length <= t) left.push({ start: part.start, end: part.end });
        else if (part.offset >= t) right.push({ start: part.start, end: part.end });
        else {
          const cut = part.start + t - part.offset;
          left.push({ start: part.start, end: cut });
          right.push({ start: cut, end: part.end });
        }
      });
      if (!left.length || !right.length) return;
      const next = S.groups.slice();
      next.splice(S.selected, 1, left, right);
      commit(next, S.selected + 1);
    }
    function merge() {
      if (S.groups.length < 2) return;
      const index = Math.max(0, S.selected - 1);
      const next = S.groups.slice();
      next.splice(index, 2, next[index].concat(next[index + 1]));
      commit(next, index, clips()[index] ? clips()[index].offset : 0);
    }
    function removeSegment() {
      if (!S.groups.length) return;
      const next = S.groups.filter((_, i) => i !== S.selected);
      const index = clamp(S.selected, 0, Math.max(0, next.length - 1));
      const time = clips().slice(0, index).reduce((sum, c) => sum + c.length, 0);
      commit(next, index, time);
    }
    function seekAt(t) {
      if (!Number.isFinite(t)) return;
      pause();
      S.playhead = clamp(t, 0, totalDuration());
      seekPlayer();
      render();
    }
    function updatePlayback() {
      const list = clips();
      let clip = list[S.playClip];
      let part = clip && clip.parts[S.playPart];
      const t = S.audio.currentTime;
      if (!part || !Number.isFinite(t)) return;
      S.playhead = clip.offset + part.offset + clamp(t - part.start, 0, part.length);
      if (!S.audio.paused && t >= part.end - 0.004) {
        let next = clip.parts[++S.playPart];
        if (!next) {
          clip = list[++S.playClip];
          S.playPart = 0;
          next = clip && clip.parts[0];
        }
        if (!next) { pause(); S.playhead = totalDuration(); }
        else { S.selected = S.playClip; try { S.audio.currentTime = next.start; } catch (error) { /* optional */ } }
      }
      render(true);
    }
    function togglePlay() {
      if (!valid()) return;
      if (!S.audio.paused) { pause(); render(); return; }
      if (S.playhead >= totalDuration() - 0.01) S.playhead = 0;
      seekPlayer();
      const promise = S.audio.play();
      promise?.catch?.(() => ui?.setStatus("播放失败：浏览器无法解码该音频", true));
      render();
    }

    function render(light = false) {
      if (!ui) return;
      const list = clips(), total = totalDuration(), span = timelineDuration();
      const head = q(".ict-clip-head");
      if (head) head.style.left = (S.playhead / span * 100) + "%";
      const current = q(".ict-cur"), totalEl = q(".ict-total");
      if (current) current.textContent = fmt(S.playhead);
      if (totalEl) totalEl.textContent = fmt(total);
      const play = q(".ict-play");
      if (play) play.textContent = S.audio && !S.audio.paused ? "❚❚" : "▶";
      setToolState();
      if (light) return;
      const ruler = q(".ict-clip-ruler");
      if (ruler) ruler.innerHTML = [0, 1, 2, 3, 4, 5]
        .map((i) => `<span style="left:${i * 20}%">${fmt(i * span / 5)}</span>`).join("");
      const track = q(".ict-clip-track");
      if (track) {
        track.innerHTML = "";
        list.forEach((clip, index) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ict-clip-seg" + (index === S.selected ? " is-selected" : "");
          button.dataset.index = String(index);
          button.style.left = (clip.offset / span * 100) + "%";
          button.style.width = (clip.length / span * 100) + "%";
          button.textContent = `片段 ${index + 1} · ${clip.length.toFixed(2)}s`;
          track.appendChild(button);
        });
      }
      const canvas = q(".ict-clip-wave");
      if (canvas && S.peaks) {
        const kept = S.groups.flat();
        drawClipWave(canvas, S.peaks, S.duration, kept);
      }
      ui.setApplyEnabled(valid());
    }
    function setToolState() {
      const list = clips(), clip = list[S.selected];
      const canSplit = !!clip && S.playhead - clip.offset >= MIN_GAP &&
        clip.offset + clip.length - S.playhead >= MIN_GAP;
      const state = {
        undo: S.undoStack.length > 0, redo: S.redoStack.length > 0,
        split: canSplit, merge: S.groups.length > 1, remove: !!clip,
      };
      ui?.body.querySelectorAll(".ict-toolrow button[data-act]").forEach((button) => {
        button.disabled = !state[button.dataset.act];
      });
    }

    S.audio.addEventListener("timeupdate", updatePlayback);
    S.audio.addEventListener("ended", () => render());

    T().openModal({
      title: "截取与拼接", sub: "正在读取音频…", width: 760,
      applyLabel: "导出音频", applyDisabled: true, cancelLabel: "取消",
      warn: T().WARN_HTML,
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-clip-tl">
            <div class="ict-clip-stage">
              <canvas class="ict-clip-wave"></canvas>
              <div class="ict-clip-track"></div>
              <span class="ict-clip-head"></span>
            </div>
            <div class="ict-clip-ruler"></div>
          </div>
          <div class="ict-toolrow">
            <button class="ict-btn" type="button" data-act="undo">撤销</button>
            <button class="ict-btn" type="button" data-act="redo">重做</button>
            <span class="ict-sep"></span>
            <button class="ict-btn" type="button" data-act="split">分割</button>
            <button class="ict-btn" type="button" data-act="merge">粘合</button>
            <button class="ict-btn" type="button" data-act="remove">删除片段</button>
            <span class="ict-hint">Ctrl+Z 撤销 · Ctrl+Y 重做 · ←/→ 微调 0.1 秒</span>
          </div>
          <div class="ict-player">
            <button class="ict-btn ict-play" type="button" title="播放 / 暂停试听">▶</button>
            <time><b class="ict-cur">0:00.00</b> / <span class="ict-total">0:00.00</span></time>
            <span class="ict-hint">点击片段或时间刻度定位播放头，分割后删除不需要的段落，导出时按保留顺序拼接。</span>
          </div>`;
        const stage = q(".ict-clip-stage");
        const waveEl = q(".ict-clip-wave");
        let scrubbing = false;
        const scrubTo = (clientX) => {
          const box = waveEl.getBoundingClientRect();
          if (!box.width) return;
          const ratio = clamp((clientX - box.left) / box.width, 0, 1);
          seekAt(ratio * timelineDuration());
        };
        /* Drag the white playhead directly on the waveform: press the head line
           (or anywhere on the wave) and drag. Segment buttons still select, so
           skip when the press lands on one. The line shows ew-resize arrows on
           hover and stays grabbed (dragging + is-scrubbing) while scrubbing. */
        const head = q(".ict-clip-head");
        stage.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          if (e.target.closest(".ict-clip-seg")) return;
          scrubbing = true;
          stage.classList.add("is-scrubbing");
          head.classList.add("dragging");
          try { stage.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
          scrubTo(e.clientX);
          e.preventDefault();
        });
        stage.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e.clientX); });
        const stopScrub = () => {
          if (!scrubbing) return;
          scrubbing = false;
          stage.classList.remove("is-scrubbing");
          head.classList.remove("dragging");
        };
        stage.addEventListener("pointerup", stopScrub);
        stage.addEventListener("pointercancel", stopScrub);
        body.addEventListener("click", (event) => {
          const tool = event.target.closest(".ict-toolrow button[data-act]");
          if (tool && !tool.disabled) {
            ({ undo, redo, split, merge, remove: removeSegment })[tool.dataset.act]?.();
            return;
          }
          if (event.target.closest(".ict-play")) { togglePlay(); return; }
          const segment = event.target.closest(".ict-clip-seg");
          if (segment) {
            const index = Number(segment.dataset.index), clip = clips()[index];
            if (!clip) return;
            const box = segment.getBoundingClientRect();
            S.selected = index;
            seekAt(clip.offset + clip.length * clamp((event.clientX - box.left) / box.width, 0, 1));
            return;
          }
          if (event.target.closest(".ict-clip-ruler")) {
            const box = q(".ict-clip-ruler").getBoundingClientRect();
            seekAt((event.clientX - box.left) / box.width * timelineDuration());
          }
        });
        body.addEventListener("keydown", (event) => {
          const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "");
          if (event.key === "Delete" || event.key === "Backspace") {
            if (!typing) event.stopPropagation();
            return;
          }
          const mod = event.ctrlKey || event.metaKey;
          if (mod && !event.altKey && !typing) {
            const key = String(event.key).toLowerCase();
            if (key === "z" || key === "y") {
              event.preventDefault(); event.stopPropagation();
              (key === "y" || event.shiftKey) ? redo() : undo();
              return;
            }
          }
          if (typing) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation();
            seekAt(S.playhead + (event.key === "ArrowRight" ? 0.1 : -0.1));
          } else if (event.key === " " || event.code === "Space") {
            if (event.target?.tagName === "BUTTON") return;
            event.preventDefault(); event.stopPropagation();
            togglePlay();
          }
        });
        render();
        preflight(ui, "audio", () => render());
      },
      onClose: () => pause(),
      onApply: () => {
        if (!valid()) throw new Error("片段无效，请检查音频时长");
        const segments = S.groups.reduce((all, group) => all.concat(group.map((r) => ({
          start: +r.start.toFixed(4), end: +r.end.toFixed(4),
        }))), []);
        return runRequest(T().API_AUDIO,
          { ref: refOf(ctx), action: "clip", segments }, ctx,
          { ui, kind: "audio", label: "音频", done: "已在右侧生成新的音频节点" });
      },
    });
  };

  /* ---------------------------- audio: speed ----------------------------- */

  R.speed = async (ctx) => {
    const mediaUrl = (NS.api?.resolveMediaUrl
      ? await NS.api.resolveMediaUrl(ctx.data?.asset || {}).catch(() => ctx.url)
      : ctx.url) || ctx.url;
    let duration = 0;
    duration = await new Promise((resolve) => {
      const audio = new Audio(mediaUrl);
      let done = false;
      const finish = (value) => { if (!done) { done = true; resolve(value || 0); } };
      audio.addEventListener("loadedmetadata", () => finish(
        Number.isFinite(audio.duration) ? audio.duration : 0));
      audio.addEventListener("error", () => finish(0));
      setTimeout(() => finish(0), 4000);
    });
    let speed = 1, ui = null, audition = null;
    const q = (selector) => ui?.body.querySelector(selector);
    const render = () => {
      const info = q(".ict-speedinfo");
      if (info) info.textContent = duration
        ? `原时长 ${fmt(duration)}  →  预计 ${fmt(duration / speed)}`
        : "正在读取音频时长…";
      const slider = q(".ict-slider-range"), number = q(".ict-speed-number");
      if (slider && String(speed) !== slider.value) slider.value = String(speed);
      if (number && document.activeElement !== number) number.value = speed.toFixed(2);
      T().paintRanges?.(ui?.body);
      ui?.body.querySelectorAll(".ict-chip[data-speed]").forEach((chip) => {
        chip.classList.toggle("is-active", Math.abs(Number(chip.dataset.speed) - speed) < 0.001);
      });
      if (audition && !audition.paused) audition.playbackRate = speed;
      const audBtn = q(".ict-audition");
      if (audBtn) audBtn.textContent = (audition && !audition.paused) ? "❚❚ 停止试听" : "▶ 试听";
    };
    const ensureAudition = () => {
      if (!audition) {
        audition = new Audio(mediaUrl);
        audition.preload = "auto";
        audition.addEventListener("ended", () => render());
      }
      return audition;
    };
    const toggleAudition = () => {
      const a = ensureAudition();
      if (!a.paused) { a.pause(); render(); return; }
      a.playbackRate = speed;
      a.play().then(() => render()).catch(() => ui?.setStatus("试听播放失败", true));
    };
    T().openModal({
      title: "音频变速", sub: "0.1× – 4× · FFmpeg atempo 保持音调", width: 560,
      applyLabel: "生成变速音频", applyDisabled: true, cancelLabel: "取消",
      warn: T().WARN_HTML,
      build(body, modalUi) {
        ui = modalUi;
        body.innerHTML = `
          <div class="ict-hint ict-speedinfo" style="margin-top:0">正在读取音频…</div>
          <div class="ict-slider-field" style="margin-top:12px">
            <input class="ict-slider-range" type="range" min="0.1" max="4" step="0.1" value="1"
                   aria-label="变速倍数" />
            <input class="ict-input ict-speed-number" type="number" min="0.1" max="4" step="0.1" value="1.00" aria-label="变速倍数数值" />
          </div>
          <div class="ict-chips ict-presets" style="margin-top:12px">
            ${[0.5, 0.75, 1, 1.5, 2, 3].map((v) =>
              `<button class="ict-chip" type="button" data-speed="${v}">${v}×</button>`).join("")}
          </div>
          <div class="ict-speed-preview" style="margin-top:12px;display:flex;align-items:center;gap:10px">
            <button class="ict-btn ict-audition" type="button">▶ 试听</button>
            <span class="ict-hint">按当前倍速实时播放试听（浏览器原生变速，音调会随速度变化）</span>
          </div>
          <p class="ict-hint">变速使用 FFmpeg atempo 链式处理，保持音调不变；结果会在右侧生成新的素材音频节点，原音频保留。</p>`;
        const slider = q(".ict-slider-range"), number = q(".ict-speed-number");
        const audBtn = q(".ict-audition");
        audBtn?.addEventListener("click", toggleAudition);
        number.addEventListener("focus", function () { this.select(); });
        body.addEventListener("click", (event) => {
          const chip = event.target.closest(".ict-chip[data-speed]");
          if (!chip) return;
          speed = Number(chip.dataset.speed);
          render();
        });
        body.addEventListener("input", (event) => {
          if (event.target === slider) {
            speed = clamp(Number(slider.value) || 1, 0.1, 4);
            render();
          }
        });
        body.addEventListener("change", (event) => {
          if (event.target !== number) return;
          const value = Number(number.value);
          speed = Number.isFinite(value) ? clamp(value, 0.1, 4) : 1;
          render();
        });
        render();
        preflight(ui, "audio", () => ui.setApplyEnabled(true));
      },
      onApply: () => runRequest(T().API_AUDIO,
        { ref: refOf(ctx), action: "speed", speed }, ctx,
        { ui, kind: "audio", label: "音频", done: "已在右侧生成新的音频节点" }),
      onClose: () => { try { audition?.pause(); } catch (e) { /* optional */ } audition = null; },
    });
  };
})();
