/* ==================================================================
   xcat-video-edit.js — 视频节点四个工具（2026-11-13）
   ------------------------------------------------------------------
   参考 Toonflow-app 的 packages/nodes/videoNode，按本包约定落地：

     提取音轨    点击即执行 → 1 个 asset-audio 节点（m4a / AAC 192k）
     分离音视频  点击即执行 → asset-audio + asset-video（静音）两个节点
     截取片段    单段时间轴：视频预览 + 10 张缩略图 + 两个可拖手柄 +
                 起止数字输入 → 1 个 asset-video 节点（mp4，含音轨）
     截取视频帧  三选一（当前帧 / 首帧 / 尾帧）→ 1 个 asset-image 节点（PNG）

   全部走 POST /infinite_canvas/api/video/process（FFmpeg），原节点保留。
   按钮注入 / 后端就绪预检 / 请求解析 / 产物建节点统一用 xcat-media-core.js，
   与音频节点「截取 / 变速」共用内核。弹窗复用 .xcat-ae-* 样式骨架。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatVideoEdit) return;
  var core = window.__xcatMediaCore;
  if (!core) { console.warn('[xcat] xcat-media-core.js 未加载，视频工具不可用'); return; }

  var API = '/infinite_canvas/api/video/process';
  var probe = core.createProbe(API);
  var q = core.q, qa = core.qa, esc = core.esc, toast = core.toast;
  var WARN = '视频处理接口未就绪：后端 Python 尚未重启。请<strong>完全重启 ComfyUI</strong>' +
    '（只刷新浏览器无效），然后重新操作。';
  var NOT_READY = '视频处理接口未就绪：请完全重启 ComfyUI（只刷新浏览器无效）';
  var THUMBS = 10;

  var modal = null, menu = null, busy = false, controller = null, S = null;

  function fmt (v) {
    var t = Math.round(Math.max(0, isFinite(v) ? v : 0) * 100);
    /* 照参考 formatTime：mm:ss.cc，分钟补两位、秒固定两位小数 */
    return String(Math.floor(t / 6000)).padStart(2, '0') + ':' +
      (t % 6000 / 100).toFixed(2).padStart(5, '0');
  }
  function setStatus (text, isError) {
    var el = q('#xcat-ae-status', modal);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }
  function isolate (el) {
    ['pointerdown', 'mousedown', 'dblclick', 'click', 'wheel', 'contextmenu', 'drop', 'dragover']
      .forEach(function (t) { el.addEventListener(t, function (e) { e.stopPropagation(); }); });
  }
  function close () {
    if (controller) { try { controller.abort(); } catch (e) {} }
    if (modal) {
      /* 弹窗关掉后预览视频必须暂停，否则后台还在解码播放 */
      var pv = q('#xcat-ve-video', modal);
      if (pv) { try { pv.pause(); } catch (e) {} }
      modal.remove();
    }
    modal = null; S = null; busy = false; controller = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('dblclick', onDblGuard, true);
    window.removeEventListener('paste', onDblGuard, true);
  }
  function onKey (e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy || controller) cancelOrClose(); }
  }
  function onDblGuard (e) {
    if (!modal) return;
    e.preventDefault(); e.stopPropagation();
  }
  function cancelOrClose () {
    if (busy && controller) controller.abort();
    else close();
  }
  function guard () {
    return probe.check().then(function (ok) {
      if (!ok) { toast(NOT_READY, true); return false; }
      return true;
    });
  }

  /* ------------------------------------------------------------ 通用执行 */
  /* opts: {title, sub, runLabel, done}；modal 已存在时（截取片段弹窗）复用它，
     否则（提取音轨 / 分离 / 截帧）先建一个进度弹窗。 */
  async function execute (payload, ctx, opts) {
    if (busy) return;
    busy = true;
    controller = new AbortController();
    var runBtn = q('#xcat-ve-run', modal);
    var cancelBtn = q('#xcat-ve-cancel', modal);
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = '处理中…'; }
    if (cancelBtn) cancelBtn.textContent = '取消处理';
    /* 照参考 :disabled="processing"：处理中冻结时间轴与输入框 */
    lockTrim(true);
    var pv = q('#xcat-ve-video', modal);
    if (pv) { try { pv.pause(); } catch (e) {} }
    setStatus('正在用 FFmpeg 处理视频…');

    if (!await guard()) {
      busy = false; controller = null;
      close();
      return;
    }
    try {
      var data = await core.request(API, payload, controller.signal, '视频');
      var files = data.files || [];
      if (!files.length) throw new Error('后端没有返回产物');
      await core.buildResultNodes(files, ctx.id);
      close();
      toast(opts.done || ('已生成 ' + files.length + ' 个新节点'));
    } catch (err) {
      if (err && err.name === 'AbortError') { close(); toast('已取消'); return; }
      if (err && err.message && err.message.indexOf('接口未就绪') >= 0) {
        probe.invalidate();
        core.setWarn(modal, false, '后端接口未就绪，需重启 ComfyUI');
      }
      setStatus(err && err.message ? err.message : '处理失败', true);
      toast('视频处理失败：' + (err && err.message ? err.message : '未知错误'), true);
    } finally {
      busy = false;
      controller = null;
      lockTrim(false);
      var b = q('#xcat-ve-run', modal);
      if (b) { b.disabled = !valid(); b.textContent = opts.runLabel || '开始处理'; }
      var c = q('#xcat-ve-cancel', modal);
      if (c) c.textContent = '取消';
    }
  }
  function lockTrim (on) {
    if (!modal) return;
    var tl = q('#xcat-ve-tl', modal);
    if (tl) tl.classList.toggle('is-busy', !!on);
    ['#xcat-ve-start', '#xcat-ve-end', '#xcat-ve-hs', '#xcat-ve-he'].forEach(function (s) {
      var el = q(s, modal);
      if (el) el.disabled = !!on;
    });
  }

  /* ------------------------------------------------------------ 进度弹窗 */
  function progressModal (title, sub, ctx, payload, opts) {
    if (modal) close();
    var host = q('#app') || document.body;
    modal = document.createElement('div');
    modal.className = 'xcat-ae-modal';
    modal.innerHTML = [
      '<div class="xcat-ae-backdrop"></div>',
      '<div class="xcat-ae-dialog xcat-ve-dialog is-compact" role="dialog" aria-modal="true" aria-label="', esc(title), '">',
        '<div class="xcat-ae-head"><div>',
          '<div class="xcat-ae-title">', esc(title), '</div>',
          '<div class="xcat-ae-sub">', esc(sub), '</div>',
        '</div><button type="button" class="xcat-ae-x" id="xcat-ve-x" title="关闭">×</button></div>',
        core.warnHtml(WARN),
        '<div class="xcat-ae-body xcat-ve-progress">',
          '<div class="xcat-ve-spinner"></div>',
          '<div class="xcat-ve-progress-text">正在处理视频，请稍候…</div>',
        '</div>',
        '<div class="xcat-ae-foot">',
          '<div class="xcat-ae-status" id="xcat-ae-status"></div>',
          '<button type="button" class="xcat-ae-btn" id="xcat-ve-cancel">取消处理</button>',
        '</div>',
      '</div>'
    ].join('');
    host.appendChild(modal);
    isolate(modal);
    q('#xcat-ve-x', modal).addEventListener('click', cancelOrClose);
    q('#xcat-ve-cancel', modal).addEventListener('click', cancelOrClose);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('dblclick', onDblGuard, true);
    window.addEventListener('paste', onDblGuard, true);
    execute(payload, ctx, opts);
  }

  /* ------------------------------------------------------------ 无参操作 */
  function runSimple (action, ctx) {
    if (busy || modal) return;
    var opts = action === 'separate'
      ? {
          title: '分离音视频', sub: '生成静音视频和音轨两个节点，保留原视频',
          done: '已生成静音视频和音轨两个节点'
        }
      : {
          title: '提取音轨', sub: '提取音轨并生成音频节点，保留原视频',
          done: '已生成音轨节点'
        };
    progressModal(opts.title, opts.sub, ctx, { ref: ctx.ref, action: action }, opts);
  }

  /* ------------------------------------------------------------ 截帧菜单 */
  function closeMenu () {
    if (menu) menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', onMenuOutside, true);
  }
  function onMenuOutside (e) {
    if (menu && !menu.contains(e.target)) closeMenu();
  }
  function currentVideoTime (ctx) {
    var wrap = document.querySelector('.vue-flow__node[data-id="' + ctx.id + '"]');
    var v = wrap && wrap.querySelector('video');
    if (v && isFinite(v.currentTime) && v.currentTime > 0) return v.currentTime;
    return 0;
  }
  function openFrameMenu (ctx, btn) {
    closeMenu();
    var t = currentVideoTime(ctx);
    var host = q('#app') || document.body;
    menu = document.createElement('div');
    menu.className = 'xcat-ve-menu';
    menu.innerHTML = [
      '<button type="button" data-frame="current">截取当前帧<span>', fmt(t), '</span></button>',
      '<button type="button" data-frame="first">截取首帧</button>',
      '<button type="button" data-frame="last">截取尾帧</button>'
    ].join('');
    host.appendChild(menu);
    var r = btn.getBoundingClientRect();
    var left = Math.min(r.left, window.innerWidth - 190);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = (r.bottom + 6) + 'px';
    isolate(menu);
    menu.addEventListener('click', function (e) {
      var b = e.target.closest('[data-frame]');
      if (!b) return;
      var which = b.dataset.frame;
      closeMenu();
      runFrame(which, ctx, t);
    });
    setTimeout(function () { document.addEventListener('pointerdown', onMenuOutside, true); }, 0);
  }
  function runFrame (which, ctx, time) {
    if (busy || modal) return;
    var labels = { current: '当前帧', first: '首帧', last: '尾帧' };
    progressModal('截取视频帧', '导出' + labels[which] + '为 PNG 图片节点，保留原视频', ctx,
      { ref: ctx.ref, action: 'frame', frame: which, time: time || 0 },
      { title: '截取视频帧', sub: '正在截取' + labels[which] + '…', done: '已生成图片节点' });
  }

  /* ------------------------------------------------------------ 截取片段 */
  /* 交互逐条对齐 Toonflow videoActions.vue 的 trim 分支：
       - 预览只在选区内播放（play 越界跳回 start，播到 end 暂停）
       - 拖边界 / 改输入框时预览同步 seek 到对应时间点
       - 点击时间轴 seek（限制在选区内）
       - 播放头随 timeupdate 移动 + 5 点时间刻度尺
       - 手柄 role=slider + 方向键 ±0.1 / Shift ±1 / Home / End
     之前只做了静态时间轴，预览与选区完全脱节，这里补齐。 */
  function openTrim (ctx) {
    if (busy || modal) return;
    closeMenu();
    var token = String(Date.now());
    S = {
      ctx: ctx, token: token, duration: 0, limit: 0, minLen: 0.01,
      start: 0, end: 0, current: 0, thumbs: []
    };
    var host = q('#app') || document.body;
    modal = document.createElement('div');
    modal.className = 'xcat-ae-modal';
    modal.innerHTML = [
      '<div class="xcat-ae-backdrop"></div>',
      '<div class="xcat-ae-dialog xcat-ve-dialog" role="dialog" aria-modal="true" aria-label="截取片段">',
        '<div class="xcat-ae-head"><div>',
          '<div class="xcat-ae-title">截取片段</div>',
          '<div class="xcat-ae-sub" id="xcat-ve-sub">正在读取视频…</div>',
        '</div><button type="button" class="xcat-ae-x" id="xcat-ve-x" title="关闭">×</button></div>',
        core.warnHtml(WARN),
        '<div class="xcat-ae-body xcat-ve-body">',
          '<div class="xcat-ve-preview">',
            '<video id="xcat-ve-video" src="', esc(ctx.item.url),
              '" controls playsinline preload="auto"></video>',
          '</div>',
          '<div class="xcat-ve-tl" id="xcat-ve-tl">',
            '<div class="xcat-ve-tl-head">',
              '<span>拖动左右边界，选择保留的片段</span>',
              '<span class="xcat-ve-tl-dur" id="xcat-ve-dur">原视频 00:00.00</span>',
            '</div>',
            '<div class="xcat-ve-track" id="xcat-ve-track">',
              '<div class="xcat-ve-strip" id="xcat-ve-strip"></div>',
              '<div class="xcat-ve-mask is-left" id="xcat-ve-ml"></div>',
              '<div class="xcat-ve-mask is-right" id="xcat-ve-mr"></div>',
              '<div class="xcat-ve-sel" id="xcat-ve-sel"></div>',
              '<div class="xcat-ve-playhead" id="xcat-ve-ph"></div>',
              '<button type="button" class="xcat-ve-handle is-start" id="xcat-ve-hs"',
                ' role="slider" aria-label="片段开始边界" aria-orientation="horizontal"',
                ' aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0.00 秒"><span></span></button>',
              '<button type="button" class="xcat-ve-handle is-end" id="xcat-ve-he"',
                ' role="slider" aria-label="片段结束边界" aria-orientation="horizontal"',
                ' aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0.00 秒"><span></span></button>',
            '</div>',
            '<div class="xcat-ve-ruler" id="xcat-ve-ruler"></div>',
          '</div>',
          '<div class="xcat-ve-times">',
            '<label>开始时间 <input type="number" id="xcat-ve-start" step="0.01" min="0" value="0.00"><span>秒</span></label>',
            '<label>结束时间 <input type="number" id="xcat-ve-end" step="0.01" min="0" value="0.00"><span>秒</span></label>',
            '<span class="xcat-ve-length" id="xcat-ve-length">时长 — 秒</span>',
          '</div>',
          '<div class="xcat-ve-hint" id="xcat-ve-hint">点击时间轴可预览对应画面；播放只播放选中的片段。原视频会保留。</div>',
        '</div>',
        '<div class="xcat-ae-foot">',
          '<div class="xcat-ae-status" id="xcat-ae-status"></div>',
          '<button type="button" class="xcat-ae-btn" id="xcat-ve-cancel">取消</button>',
          '<button type="button" class="xcat-ae-btn is-primary" id="xcat-ve-run" disabled>截取片段</button>',
        '</div>',
      '</div>'
    ].join('');
    host.appendChild(modal);
    isolate(modal);
    q('#xcat-ve-x', modal).addEventListener('click', cancelOrClose);
    q('#xcat-ve-cancel', modal).addEventListener('click', cancelOrClose);
    q('#xcat-ve-run', modal).addEventListener('click', function () {
      if (!S || !valid()) { setStatus('请选择有效的起止时间', true); return; }
      execute({ ref: S.ctx.ref, action: 'trim', start: S.start, end: S.end }, S.ctx, {
        runLabel: '截取片段', done: '已生成新的视频节点'
      });
    });
    var si = q('#xcat-ve-start', modal), ei = q('#xcat-ve-end', modal);
    si.addEventListener('focus', function () { this.select(); });
    ei.addEventListener('focus', function () { this.select(); });
    si.addEventListener('input', onTimeInput);
    ei.addEventListener('input', onTimeInput);
    bindHandle(q('#xcat-ve-hs', modal), 'start');
    bindHandle(q('#xcat-ve-he', modal), 'end');
    var track = q('#xcat-ve-track', modal);
    if (track) track.addEventListener('pointerdown', seekTrack);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('dblclick', onDblGuard, true);
    window.addEventListener('paste', onDblGuard, true);

    var video = q('#xcat-ve-video', modal);
    video.addEventListener('loadedmetadata', function () {
      if (!S || S.token !== token) return;
      var d = video.duration;
      if (!isFinite(d) || d <= 0) { setStatus('无法读取视频时长', true); return; }
      S.duration = d;
      /* 照参考 clipLimit / minimumLength：末端向下取整到百分秒，避免超长 */
      S.limit = Math.floor(d * 100) / 100;
      S.minLen = Math.min(0.01, S.limit);
      S.start = 0; S.end = S.limit; S.current = 0;
      if (si) si.max = S.limit;
      if (ei) ei.max = S.limit;
      buildRuler();
      paint();
      setStatus('');
      buildThumbs(ctx.item.url, d, function (list) {
        if (!S || S.token !== token) return;
        S.thumbs = list;
        var strip = q('#xcat-ve-strip', modal);
        if (!strip) return;
        strip.innerHTML = list.map(function (src) {
          return src ? '<img src="' + src + '" alt="" draggable="false">' : '<i></i>';
        }).join('');
      }, function () { return !!S && S.token === token && !!modal; });
    });
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', paintPlayhead);
    video.addEventListener('play', onPlaySelection);
    video.addEventListener('error', function () {
      if (S && S.token === token) setStatus('视频预览加载失败，缩略图可能不可用', true);
    });
    guard().then(function (ok) {
      if (!S || S.token !== token) return;
      core.setWarn(modal, ok, '后端接口未就绪，需重启 ComfyUI');
      if (!ok) { var b = q('#xcat-ve-run', modal); if (b) b.disabled = true; }
    });
  }

  function valid () {
    return !!S && S.duration > 0 && S.start >= 0 && S.end > S.start &&
      S.end <= S.limit + 0.000001;
  }
  function buildRuler () {
    var r = q('#xcat-ve-ruler', modal);
    if (!r || !S) return;
    var out = [];
    for (var i = 0; i < 5; i++) out.push('<span>' + fmt(S.duration * i / 4) + '</span>');
    r.innerHTML = out.join('');
  }
  function paintPlayhead () {
    if (!S || !S.duration || !modal) return;
    var v = q('#xcat-ve-video', modal);
    if (v && isFinite(v.currentTime)) S.current = v.currentTime;
    var ph = q('#xcat-ve-ph', modal);
    if (ph) ph.style.left = (core.clamp(S.current / S.duration, 0, 1) * 100) + '%';
  }
  function paint (skipInputs) {
    if (!S || !S.duration || !modal) return;
    var d = S.duration;
    var sp = core.clamp(S.start / d, 0, 1) * 100;
    var ep = core.clamp(S.end / d, 0, 1) * 100;
    var sel = q('#xcat-ve-sel', modal);
    if (sel) { sel.style.left = sp + '%'; sel.style.width = Math.max(0, ep - sp) + '%'; }
    var ml = q('#xcat-ve-ml', modal), mr = q('#xcat-ve-mr', modal);
    if (ml) { ml.style.left = '0'; ml.style.width = sp + '%'; }
    if (mr) { mr.style.left = ep + '%'; mr.style.width = (100 - ep) + '%'; }
    var hs = q('#xcat-ve-hs', modal), he = q('#xcat-ve-he', modal);
    if (hs) {
      hs.style.left = sp + '%';
      hs.setAttribute('aria-valuemax', Math.max(0, S.end - S.minLen).toFixed(2));
      hs.setAttribute('aria-valuenow', S.start.toFixed(2));
      hs.setAttribute('aria-valuetext', S.start.toFixed(2) + ' 秒');
    }
    if (he) {
      he.style.left = ep + '%';
      he.setAttribute('aria-valuemin', (S.start + S.minLen).toFixed(2));
      he.setAttribute('aria-valuemax', S.limit.toFixed(2));
      he.setAttribute('aria-valuenow', S.end.toFixed(2));
      he.setAttribute('aria-valuetext', S.end.toFixed(2) + ' 秒');
    }
    var sub = q('#xcat-ve-sub', modal);
    if (sub) sub.textContent = '原视频 ' + fmt(d) + ' · 拖动左右边界，选择保留的片段';
    var dur = q('#xcat-ve-dur', modal);
    if (dur) dur.textContent = '原视频 ' + fmt(d);
    var len = q('#xcat-ve-length', modal);
    if (len) len.textContent = '时长 ' + (valid() ? (S.end - S.start).toFixed(2) : '—') + ' 秒';
    var hint = q('#xcat-ve-hint', modal);
    if (hint) hint.textContent = valid()
      ? '点击时间轴可预览对应画面；播放只播放选中的片段。截取后生成新视频节点，原视频会保留。'
      : '请选择有效的起止时间。';
    if (!skipInputs) {
      var si = q('#xcat-ve-start', modal), ei = q('#xcat-ve-end', modal);
      if (si && document.activeElement !== si) si.value = S.start.toFixed(2);
      if (ei && document.activeElement !== ei) ei.value = S.end.toFixed(2);
    }
    paintPlayhead();
    var run = q('#xcat-ve-run', modal);
    if (run && !busy) run.disabled = !valid();
  }
  /* 预览定位：暂停并把画面挪到指定秒数，播放头同步 */
  function seekPreview (value) {
    if (!S || !S.duration || !isFinite(value) || !modal) return;
    var v = q('#xcat-ve-video', modal);
    if (!v) return;
    v.pause();
    try { v.currentTime = core.clamp(value, 0, Math.max(0, S.duration - 0.001)); } catch (e) {}
    S.current = v.currentTime;
    paintPlayhead();
  }
  /* 边界约束与参考 setBoundary 一致：start <= end - minLen、end <= clipLimit */
  function setBoundary (edge, value) {
    if (!S || !S.duration || busy || !isFinite(value)) return;
    var rounded = Math.round(value * 100) / 100;
    if (edge === 'start') S.start = core.clamp(rounded, 0, Math.max(0, S.end - S.minLen));
    else S.end = core.clamp(rounded, S.start + S.minLen, S.limit);
    S.start = +S.start.toFixed(2);
    S.end = +S.end.toFixed(2);
    paint();
    seekPreview(edge === 'start' ? S.start : S.end);
  }
  function onTimeInput (e) {
    if (!S || !S.duration) return;
    var si = q('#xcat-ve-start', modal), ei = q('#xcat-ve-end', modal);
    if (!si || !ei) return;
    /* 改开始就跳到开始、改结束就跳到结束（原来一律跳到 start） */
    var which = (e && e.target === ei) ? 'end' : 'start';
    var a = parseFloat(si.value), b = parseFloat(ei.value);
    if (isFinite(a)) S.start = core.clamp(+a.toFixed(2), 0, S.limit);
    if (isFinite(b)) S.end = core.clamp(+b.toFixed(2), 0, S.limit);
    if (S.end < S.start + S.minLen) {
      if (which === 'start') S.start = Math.max(0, S.end - S.minLen);
      else S.end = Math.min(S.limit, S.start + S.minLen);
    }
    paint(true);
    seekPreview(which === 'start' ? S.start : S.end);
  }
  /* 播放只播放选中片段：越过 end 停住；从选区外按播放则跳回 start */
  function onTimeUpdate () {
    if (!S || !S.duration || !modal) return;
    var v = q('#xcat-ve-video', modal);
    if (!v) return;
    S.current = v.currentTime;
    paintPlayhead();
    if (!v.paused && valid() && v.currentTime >= S.end) {
      v.pause();
      try { v.currentTime = Math.max(0, S.end - 0.001); } catch (e) {}
    }
  }
  function onPlaySelection () {
    if (!S || !S.duration || !modal || !valid()) return;
    var v = q('#xcat-ve-video', modal);
    if (v && (v.currentTime < S.start || v.currentTime >= S.end)) {
      try { v.currentTime = S.start; } catch (e) {}
    }
  }
  function seekTrack (e) {
    if (!S || !S.duration || busy || e.button !== 0 || !modal) return;
    var track = q('#xcat-ve-track', modal);
    if (!track) return;
    var r = track.getBoundingClientRect();
    if (!r.width) return;
    var t = (e.clientX - r.left) / r.width * S.duration;
    seekPreview(core.clamp(t, S.start, S.end));
  }
  function changeBoundary (e, edge) {
    if (!S || !S.duration || busy) return;
    var step = e.shiftKey ? 1 : 0.1;
    var t = edge === 'start' ? S.start : S.end;
    var next;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = t - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = t + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = S.limit;
    else return;
    e.preventDefault(); e.stopPropagation();
    setBoundary(edge, next);
  }
  /* 相对位移换算：抓手柄任意位置拖动都不会先跳一下 */
  function bindHandle (el, which) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) {
      if (!S || !S.duration || busy || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      var track = q('#xcat-ve-track', modal);
      if (!track) return;
      var width = track.getBoundingClientRect().width;
      if (!width) return;
      var x0 = e.clientX, t0 = which === 'start' ? S.start : S.end, pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (_) {}
      el.classList.add('is-dragging');
      seekPreview(t0);
      var move = function (ev) {
        if (ev.pointerId !== pid) return;
        setBoundary(which, t0 + (ev.clientX - x0) / width * S.duration);
      };
      var up = function () {
        el.classList.remove('is-dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        try { if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid); } catch (_) {}
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('keydown', function (e) { changeBoundary(e, which); });
  }

  /* 固定 10 张缩略图，内存/耗时不随视频时长增长（参考 Toonflow 的取舍）。
     用离屏 video 逐次 seek + canvas 160×96 JPEG；失败只留占位，不挡使用。
     alive() 变假（弹窗已关）就立刻停，别在后台继续解码。 */
  function buildThumbs (src, duration, cb, alive) {
    var v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = src;
    var out = new Array(THUMBS).fill(''), idx = 0, done = false, started = false, timer = 0;
    function finish () {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      v.onloadeddata = v.onseeked = v.onerror = null;
      try { v.removeAttribute('src'); v.load(); } catch (e) {}
      cb(out);
    }
    function shot () {
      if (done) return;
      if ((alive && !alive()) || idx >= THUMBS) { finish(); return; }
      try {
        v.currentTime = Math.min(duration * (idx + 0.5) / THUMBS,
          Math.max(0, duration - 0.001));
      } catch (e) { idx++; shot(); }
    }
    function start () {
      if (started || done) return;
      started = true;
      shot();
    }
    timer = setTimeout(finish, 15000);
    v.addEventListener('loadeddata', start);
    if (v.readyState >= 2) setTimeout(start, 0);
    v.addEventListener('seeked', function () {
      if (done || (alive && !alive())) { finish(); return; }
      try {
        var c = document.createElement('canvas');
        c.width = 160; c.height = 96;
        /* 照参考 loadThumbnails：cover 等比缩放居中，别把画面拉变形 */
        var scale = Math.max(c.width / v.videoWidth, c.height / v.videoHeight);
        var w = v.videoWidth * scale, h = v.videoHeight * scale;
        c.getContext('2d').drawImage(v, (c.width - w) / 2, (c.height - h) / 2, w, h);
        out[idx] = c.toDataURL('image/jpeg', 0.75);
      } catch (e) {}
      idx++; shot();
    });
    v.addEventListener('error', finish);
  }

  /* ------------------------------------------------------------ 按钮注入 */
  var DEFS = [
    { cls: 'xcat-ve-audio', label: '提取音轨', open: function (ctx) { runSimple('extractAudio', ctx); } },
    { cls: 'xcat-ve-separate', label: '分离音视频', open: function (ctx) { runSimple('separate', ctx); } },
    { cls: 'xcat-ve-trim', label: '截取片段', open: function (ctx) { openTrim(ctx); } },
    { cls: 'xcat-ve-frame', label: '截取视频帧', open: function (ctx, wrap, btn) { openFrameMenu(ctx, btn); } }
  ];

  function install () {
    if (busy) return;                 /* 处理中别让 Vue 重建按钮打断 */
    core.installButtons('#app .demo-node .node-actions', DEFS, 'video');
  }
  var queued = false;
  function schedule () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; install(); });
  }
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].addedNodes.length || list[i].removedNodes.length ||
          list[i].type === 'attributes') { schedule(); break; }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });
  setInterval(schedule, 1200);
  install();
  probe.check();                    /* 页面加载先探一次，点击时已有结果 */

  window.__xcatVideoEdit = {
    install: install,
    close: close,
    closeMenu: closeMenu,
    state: function () {
      return S ? {
        duration: S.duration, limit: S.limit, start: S.start, end: S.end,
        current: S.current, thumbs: S.thumbs.length
      } : null;
    },
    runSimple: runSimple,
    openTrim: openTrim,
    openFrameMenu: openFrameMenu,
    seekPreview: seekPreview,
    setBoundary: setBoundary
  };
})();
