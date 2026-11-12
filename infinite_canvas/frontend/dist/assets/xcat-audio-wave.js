/* ==================================================================
   xcat-audio-wave.js — 音频节点波形（替代上游 <audio controls> 原生进度条）
   ------------------------------------------------------------------
   上游把活动音频卡渲染成 `<audio class="media-audio" controls>`，双击后的
   大预览也是 `<audio controls>`。压缩 bundle 里没有源码，这里不碰 Vue 组件，
   只把那两个元素换成空的 `<div class="xcat-audio-wave" data-src="...">`
   （见 patch_audio_wave.py），本文件用 MutationObserver 找到这些容器并接管：

     · fetch + AudioContext.decodeAudioData 解码真实音频 → 峰值包络；
       解码失败 / 无 src 时用按 src 生成的确定性伪波形占位（视觉不空）
     · canvas 画圆头竖条，上下留白（底部还要让开 35px 控制条），
       播放头是贯穿绘图区的蓝线 + 顶部圆点
     · 播放头才是滑块：只有鼠标移到播放头上（水平 ±9px），圆点才变成
       带左右箭头的蓝色胶囊、光标变 ew-resize；按住它左右拖动才能 seek。
       点波形任意其它位置不会跳进度，避免误触。已播放的竖条变蓝
     · 原生 <audio>（隐藏）负责播放
     · 节点行为与视频 / 图片节点一致：空白处按下拖节点（grab 光标）、
       滚轮缩放画布、双击开大预览都照常冒泡；只有按住播放头时才拦截，
       避免拖进度同时拖动节点

   Vue 对 children=null 的 element vnode 不管理 innerHTML，所以注入的 DOM
   在节点数据更新时不会被清掉；data-src 变化由实例自己的 observer 处理。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatAudioWave) return;

  var AC = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null;
  var peaksCache = new Map();      // src -> Promise<Float32Array|null>
  var instances = new WeakMap();   // el -> inst
  var all = new Set();             // 用于主题切换后统一重绘
  var PEAKS_RES = 1600;            // 缓存分辨率，绘制时按宽度降采样
  var BAR_UNIT = 5;                // 每根竖条占 5px（约 3px 线 + 2px 间隔）
  var PAD_X = 14;                  // 左右留白让播放头圆点不被裁掉
  var HEAD_HIT = 9;                // 播放头（滑块）的水平命中半径，px
  var HEAD_PAD_Y = 12;             // 命中区上下外扩，让顶部圆点也好抓
  /* 上下留白：波形不顶节点边缘。底部至少 44px，因为 .xcat-aw-bar 控制条
     高 35px 叠在波形上；顶部至少 34px，让左上角 8px/22px 的名称胶囊
     （占 8~30px）与播放头圆点（半径 5）都完整落在留白里。
     按容器高度取比例再夹到固定区间，节点 resize / 大预览(160px) 都适用。 */
  var PAD_TOP_MIN = 34, PAD_TOP_MAX = 44;
  var PAD_BOTTOM_MIN = 44, PAD_BOTTOM_MAX = 56;
  function plotBox(h) {
    var top = clamp(h * .16, PAD_TOP_MIN, PAD_TOP_MAX);
    var bottom = clamp(h * .20, PAD_BOTTOM_MIN, PAD_BOTTOM_MAX);
    if (h - top - bottom < 24) {
      top = Math.max(8, (h - 24) * .4);
      bottom = Math.max(8, h - 24 - top);
    }
    return { top: top, bottom: bottom, h: Math.max(8, h - top - bottom) };
  }

  function plotW(inst) { return Math.max(1, inst.w - PAD_X * 2); }
  function headX(inst) { return PAD_X + clamp(inst.progress, 0, 1) * plotW(inst); }

  /* 只有指针落在播放头这条竖线上才算「在滑块上」。clientX/Y 是视口坐标；
     inst.w/h 来自 getBoundingClientRect，与 canvas 的 CSS 绘制坐标一致。 */
  function hitHead(inst, clientX, clientY) {
    var r = inst.el.getBoundingClientRect();
    var x = clientX - r.left, y = clientY - r.top;
    var box = plotBox(inst.h);
    return Math.abs(x - headX(inst)) <= HEAD_HIT &&
           y >= box.top - HEAD_PAD_Y && y <= box.top + box.h + HEAD_PAD_Y;
  }

  var ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M8 5.5v13l10-6.5z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    '<path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* 无真实音频时的占位波形：两端渐弱 + 若干强弱段，形状接近参考图 */
  function fakePeaks(src, n) {
    var r = rng(hash(src || 'xcat')), out = new Float32Array(n), segs = [], k;
    for (k = 0; k < 9; k++)
      segs.push({ c: (k + .5) / 9 + (r() - .5) * .05, w: .035 + r() * .055, g: .30 + r() * .70 });
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      var edge = Math.pow(Math.sin(Math.PI * t), .42);
      var g = .10;
      for (var j = 0; j < segs.length; j++) {
        var d = (t - segs[j].c) / segs[j].w;
        g = Math.max(g, segs[j].g * Math.exp(-d * d * 2.1));
      }
      var trem = .80 + .20 * Math.sin(t * 79);
      out[i] = clamp(edge * g * trem * (.62 + .38 * r()), .03, 1);
    }
    return out;
  }

  function computePeaks(buf, n) {
    var chans = [], c;
    for (c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    var len = chans[0].length, out = new Float32Array(n), mx = 0, i, j, k;
    for (i = 0; i < n; i++) {
      var s = Math.floor(i * len / n), e = Math.max(s + 1, Math.floor((i + 1) * len / n));
      var stride = Math.max(1, Math.floor((e - s) / 48)), peak = 0;
      for (j = s; j < e; j += stride) {
        var v = 0;
        for (k = 0; k < chans.length; k++) if (Math.abs(chans[k][j]) > v) v = Math.abs(chans[k][j]);
        if (v > peak) peak = v;
      }
      out[i] = peak; if (peak > mx) mx = peak;
    }
    /* 指数 >1 放大动态：参考图的波形有明显强弱段，pow(.75) 会把起伏压平成椭圆 */
    if (mx > 0) for (i = 0; i < n; i++) out[i] = clamp(Math.pow(out[i] / mx, 1.15), .03, 1);
    return out;
  }

  function getPeaks(src) {
    if (!src) return Promise.resolve(null);
    if (peaksCache.has(src)) return peaksCache.get(src);
    var p = fetch(src)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
      .then(function (ab) {
        if (!AC) return null;
        if (!audioCtx) audioCtx = new AC();
        return audioCtx.decodeAudioData(ab);
      })
      .then(function (buf) { return buf ? computePeaks(buf, PEAKS_RES) : null; })
      .catch(function () { return null; });
    peaksCache.set(src, p);
    return p;
  }

  function resample(peaks, n) {
    var out = new Float32Array(n), L = peaks.length;
    for (var i = 0; i < n; i++) {
      var s = Math.floor(i * L / n), e = Math.max(s + 1, Math.floor((i + 1) * L / n)), v = 0;
      for (var j = s; j < e && j < L; j++) if (peaks[j] > v) v = peaks[j];
      out[i] = v;
    }
    return out;
  }

  function colors(el) {
    var cs = getComputedStyle(el);
    function g(n, d) { return (cs.getPropertyValue(n) || '').trim() || d; }
    return {
      bar: g('--xw-bar', '#8b929e'),
      played: g('--xw-played', '#4a9eff'),
      head: g('--xw-head', '#3d9cff'),
      headFg: g('--xw-head-fg', '#ffffff')
    };
  }

  /* 圆角矩形胶囊（不用 ctx.roundRect，兼容旧 Chromium） */
  function capsule(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function draw(inst) {
    var c = inst.canvas, w = inst.w, h = inst.h;
    if (!c || !w || !h || inst.dead) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    var g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    var pw = plotW(inst);
    var box = plotBox(h);
    var n = Math.max(12, Math.min(260, Math.floor(pw / BAR_UNIT)));
    var peaks = resample(inst.peaks, n);
    var col = colors(inst.el);
    var maxH = box.h, mid = box.top + box.h / 2;
    var step = pw / n, lw = Math.max(1.5, Math.min(3, step * .58));
    var hx = headX(inst);
    var grabbed = inst.hoverHead || inst.dragging;

    g.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = PAD_X + (i + .5) * step;
      var bh = Math.max(2, peaks[i] * maxH);
      g.strokeStyle = x <= hx ? col.played : col.bar;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x, mid - bh / 2);
      g.lineTo(x, mid + bh / 2);
      g.stroke();
    }
    /* 播放头：只贯穿绘图区（不再顶天立地） */
    g.strokeStyle = col.head;
    g.lineWidth = grabbed ? 3 : 2;
    g.beginPath();
    g.moveTo(hx + .5, box.top);
    g.lineTo(hx + .5, box.top + box.h);
    g.stroke();

    if (!grabbed) {
      /* 平时：绘图区顶部一个小圆点，提示这里是滑块 */
      g.fillStyle = col.head;
      g.beginPath();
      g.arc(hx, box.top, 5, 0, Math.PI * 2);
      g.fill();
    } else {
      /* hover / 拖动：圆点变成带左右箭头的胶囊，明确「可左右拉」。
         拖到 0% / 100% 时把胶囊夹在容器内，别被 overflow:hidden 切掉半边。 */
      var capX = clamp(hx - 16, 1, Math.max(1, w - 33));
      var cx = capX + 16;
      g.fillStyle = col.head;
      capsule(g, capX, box.top - 9, 32, 18, 9);
      g.fill();
      g.strokeStyle = col.headFg;
      g.lineWidth = 1.8;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(cx - 6, box.top - 3.5);
      g.lineTo(cx - 9.5, box.top);
      g.lineTo(cx - 6, box.top + 3.5);
      g.moveTo(cx + 6, box.top - 3.5);
      g.lineTo(cx + 9.5, box.top);
      g.lineTo(cx + 6, box.top + 3.5);
      g.stroke();
    }
  }

  function measure(inst) {
    var r = inst.el.getBoundingClientRect();
    inst.w = Math.max(1, Math.round(r.width));
    inst.h = Math.max(1, Math.round(r.height));
  }

  /* 播放时播放头会自己往前跑，鼠标不动也要重算「是否还在滑块上」，
     否则箭头胶囊会留在原地、跟着蓝线一起漂走。 */
  function refreshHover(inst) {
    if (inst.dragging || inst.lastX == null) return;
    var over = hitHead(inst, inst.lastX, inst.lastY);
    if (over !== inst.hoverHead) {
      inst.hoverHead = over;
      inst.el.style.cursor = over ? 'ew-resize' : '';
    }
  }

  function sync(inst) {
    var a = inst.audio;
    if (a.duration && isFinite(a.duration) && a.duration > 0)
      inst.progress = clamp(a.currentTime / a.duration, 0, 1);
    refreshHover(inst);
  }

  function loop(inst) {
    if (inst.dead || !inst.playing) return;
    /* 拖动播放头时以拖动位置为准，别让 rAF 把它拉回音频当前时间 */
    if (!inst.dragging) sync(inst);
    draw(inst);
    inst.raf = requestAnimationFrame(function () { loop(inst); });
  }

  function seekAt(inst, clientX) {
    var r = inst.el.getBoundingClientRect();
    var plotW = Math.max(1, r.width - PAD_X * 2);
    var t = clamp((clientX - r.left - PAD_X) / plotW, 0, 1);
    var a = inst.audio;
    if (a.duration && isFinite(a.duration) && a.duration > 0) {
      try { a.currentTime = t * a.duration; } catch (_) { /* ignore */ }
    }
    inst.progress = t;
    draw(inst);
  }

  function toggle(inst) {
    var a = inst.audio;
    if (!a.getAttribute('src')) return;
    if (a.paused) {
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* 无手势 / 源不可播 */ });
    } else a.pause();
  }

  function init(el) {
    if (instances.has(el)) return;
    var src = el.getAttribute('data-src') || '';
    var inst = {
      el: el, src: src, peaks: fakePeaks(src, PEAKS_RES), decoded: false, progress: 0,
      w: 0, h: 0, playing: false, dragging: false, hoverHead: false, dragDX: 0,
      lastX: null, lastY: null, raf: 0, dead: false
    };
    instances.set(el, inst);
    all.add(inst);

    var canvas = document.createElement('canvas');
    canvas.className = 'xcat-wave-canvas';
    var btn = document.createElement('button');
    btn.className = 'xcat-wave-play nodrag';
    btn.type = 'button';
    btn.title = '播放';
    btn.innerHTML = ICON_PLAY;
    var audio = document.createElement('audio');
    audio.className = 'xcat-wave-audio';
    audio.preload = 'metadata';
    if (src) audio.src = src;
    while (el.firstChild) el.removeChild(el.firstChild);
    el.appendChild(canvas);
    el.appendChild(btn);
    el.appendChild(audio);
    inst.canvas = canvas; inst.btn = btn; inst.audio = audio;

    /* 上游给 <audio> 的 class 是 "media-audio nodrag"：nodrag 是 Vue Flow 的
       「不许拖节点」标记，整个波形容器因此拖不动。摘掉它，波形才和视频 /
       图片节点一样能拖节点（光标也继承 .media-stack-card 的 pointer）。 */
    el.classList.remove('nodrag');

    /* 和视频 / 图片节点一致：波形空白处按下就是拖节点（一只手光标），
       滚轮缩放画布、双击开大预览都照常冒泡。只有真的按住播放头时才拦
       冒泡，否则拖进度会把节点一起拖走（d3-drag 走 mousedown）。
       控制条自己带 nodrag，条内按钮 / 滑块不会拖节点。 */
    btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(inst); });

    /* 进度只靠拖播放头：点波形空白（竖条、留白、控制条）一律不跳。
       命中播放头时先记住指针与播放头的水平差，按下瞬间不产生位移。 */
    el.addEventListener('pointerdown', function (e) {
      if (btn === e.target || btn.contains(e.target)) return;
      if (!hitHead(inst, e.clientX, e.clientY)) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      var r = el.getBoundingClientRect();
      inst.dragDX = e.clientX - (r.left + headX(inst));
      inst.dragging = true;
      inst.hoverHead = true;
      el.style.cursor = 'ew-resize';
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      draw(inst);
    });
    el.addEventListener('mousedown', function (e) {
      if (btn === e.target || btn.contains(e.target)) return;
      if (!hitHead(inst, e.clientX, e.clientY)) return;
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      inst.lastX = e.clientX; inst.lastY = e.clientY;
      if (inst.dragging) { seekAt(inst, e.clientX - inst.dragDX); return; }
      var over = hitHead(inst, e.clientX, e.clientY);
      if (over !== inst.hoverHead) {
        inst.hoverHead = over;
        el.style.cursor = over ? 'ew-resize' : '';
        draw(inst);                       // 重绘圆点 ↔ 左右箭头胶囊
      }
    });
    function endDrag(e) {
      if (!inst.dragging) return;
      inst.dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      inst.hoverHead = (e.clientX != null) ? hitHead(inst, e.clientX, e.clientY) : false;
      el.style.cursor = inst.hoverHead ? 'ew-resize' : '';
      draw(inst);
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('pointerleave', function () {
      if (inst.dragging) return;
      inst.lastX = inst.lastY = null;
      inst.hoverHead = false;
      el.style.cursor = '';
      draw(inst);
    });

    audio.addEventListener('loadedmetadata', function () { sync(inst); draw(inst); });
    audio.addEventListener('timeupdate', function () {
      if (!inst.dragging) sync(inst);
      draw(inst);
    });
    audio.addEventListener('play', function () {
      inst.playing = true; btn.innerHTML = ICON_PAUSE; btn.title = '暂停';
      cancelAnimationFrame(inst.raf); loop(inst);
    });
    audio.addEventListener('pause', function () {
      inst.playing = false; btn.innerHTML = ICON_PLAY; btn.title = '播放';
      cancelAnimationFrame(inst.raf); draw(inst);
    });
    audio.addEventListener('ended', function () { inst.progress = 0; draw(inst); });

    if (window.ResizeObserver) {
      inst.ro = new ResizeObserver(function () { measure(inst); draw(inst); });
      inst.ro.observe(el);
    } else {
      inst.onResize = function () { measure(inst); draw(inst); };
      window.addEventListener('resize', inst.onResize);
    }

    /* Vue 更新 data-src（换素材）时重新加载 */
    inst.ao = new MutationObserver(function () {
      var s = el.getAttribute('data-src') || '';
      if (s === inst.src) return;
      inst.src = s; inst.progress = 0; inst.decoded = false;
      try { audio.pause(); } catch (_) { /* ignore */ }
      if (s) audio.src = s; else audio.removeAttribute('src');
      inst.peaks = fakePeaks(s, PEAKS_RES);
      draw(inst);
      getPeaks(s).then(function (p) {
        if (!inst.dead && p) { inst.peaks = p; inst.decoded = true; draw(inst); }
      });
    });
    inst.ao.observe(el, { attributes: true, attributeFilter: ['data-src'] });

    /* Vue patch 可能把 class 重新写成 "... nodrag"，持续摘掉，否则节点又拖不动 */
    inst.co = new MutationObserver(function () {
      if (el.classList.contains('nodrag')) el.classList.remove('nodrag');
    });
    inst.co.observe(el, { attributes: true, attributeFilter: ['class'] });

    measure(inst);
    draw(inst);
    getPeaks(src).then(function (p) {
      if (!inst.dead && p) { inst.peaks = p; inst.decoded = true; draw(inst); }
    });
  }

  function destroy(el) {
    var inst = instances.get(el);
    if (!inst) return;
    inst.dead = true;
    cancelAnimationFrame(inst.raf);
    try { inst.audio.pause(); inst.audio.removeAttribute('src'); inst.audio.load(); } catch (_) { /* ignore */ }
    if (inst.ro) inst.ro.disconnect();
    if (inst.ao) inst.ao.disconnect();
    if (inst.co) inst.co.disconnect();
    if (inst.onResize) window.removeEventListener('resize', inst.onResize);
    instances.delete(el);
    all.delete(inst);
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches('.xcat-audio-wave')) init(root);
    if (root.querySelectorAll) root.querySelectorAll('.xcat-audio-wave').forEach(init);
  }
  function sweepRemoved(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches('.xcat-audio-wave')) destroy(root);
    if (root.querySelectorAll) root.querySelectorAll('.xcat-audio-wave').forEach(destroy);
  }

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i], j;
      for (j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
      for (j = 0; j < m.removedNodes.length; j++) sweepRemoved(m.removedNodes[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /* 主题切换后颜色变量变了，重绘已有波形 */
  function repaintAll() { all.forEach(function (inst) { if (!inst.dead) draw(inst); }); }
  new MutationObserver(repaintAll)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  if (document.body)
    new MutationObserver(repaintAll)
      .observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'class'] });

  scan(document.documentElement);
  window.__xcatAudioWave = {
    init: init, destroy: destroy, repaint: repaintAll,
    count: function () { return all.size; },
    stats: function () {
      return Array.from(all).map(function (i) {
        var sum = 0;
        for (var k = 0; k < i.peaks.length; k++) sum += i.peaks[k];
        return {
          src: i.src.slice(0, 64), peakAvg: +(sum / i.peaks.length).toFixed(4), decoded: i.decoded,
          w: i.w, h: i.h, progress: +i.progress.toFixed(3), playing: i.playing,
          headX: +headX(i).toFixed(1), hoverHead: i.hoverHead, dragging: i.dragging,
          cursor: i.el.style.cursor || getComputedStyle(i.el).cursor,
          duration: i.audio.duration || 0, currentTime: +(i.audio.currentTime || 0).toFixed(3)
        };
      });
    }
  };
})();
