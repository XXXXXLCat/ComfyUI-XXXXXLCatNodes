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
     · 波形本身就是进度条：点击 / 拖动 seek，已播放的竖条变蓝
     · 原生 <audio>（隐藏）负责播放，hover 时左上角出现播放 / 暂停按钮
     · 阻止 mousedown / pointerdown / click 冒泡到 Vue Flow，避免拖节点、
       误切素材、误触发画布缩放平移；dblclick 不拦，仍可打开大预览

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
      head: g('--xw-head', '#3d9cff')
    };
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

    var plotW = Math.max(1, w - PAD_X * 2);
    var box = plotBox(h);
    var n = Math.max(12, Math.min(260, Math.floor(plotW / BAR_UNIT)));
    var peaks = resample(inst.peaks, n);
    var col = colors(inst.el);
    var maxH = box.h, mid = box.top + box.h / 2;
    var step = plotW / n, lw = Math.max(1.5, Math.min(3, step * .58));
    var headX = PAD_X + clamp(inst.progress, 0, 1) * plotW;

    g.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x = PAD_X + (i + .5) * step;
      var bh = Math.max(2, peaks[i] * maxH);
      g.strokeStyle = x <= headX ? col.played : col.bar;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x, mid - bh / 2);
      g.lineTo(x, mid + bh / 2);
      g.stroke();
    }
    /* 播放头：只贯穿绘图区（不再顶天立地）+ 绘图区顶部圆点 */
    g.strokeStyle = col.head;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(headX + .5, box.top);
    g.lineTo(headX + .5, box.top + box.h);
    g.stroke();
    g.fillStyle = col.head;
    g.beginPath();
    g.arc(headX, box.top, 5, 0, Math.PI * 2);
    g.fill();
  }

  function measure(inst) {
    var r = inst.el.getBoundingClientRect();
    inst.w = Math.max(1, Math.round(r.width));
    inst.h = Math.max(1, Math.round(r.height));
  }

  function sync(inst) {
    var a = inst.audio;
    if (a.duration && isFinite(a.duration) && a.duration > 0)
      inst.progress = clamp(a.currentTime / a.duration, 0, 1);
  }

  function loop(inst) {
    if (inst.dead || !inst.playing) return;
    sync(inst); draw(inst);
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
      w: 0, h: 0, playing: false, dragging: false, raf: 0, dead: false
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

    /* 冒泡阶段拦截：btn / canvas 上的业务监听器先跑，再阻止继续冒泡到
       Vue Flow 节点包装器（拖节点）、卡片（切素材、拖素材）与预览舞台（平移）。
       dblclick 不拦，保留双击打开大预览。 */
    ['mousedown', 'mouseup', 'click', 'pointerdown', 'touchstart', 'wheel']
      .forEach(function (type) {
        el.addEventListener(type, function (e) { e.stopPropagation(); });
      });

    btn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    btn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(inst); });

    el.addEventListener('pointerdown', function (e) {
      if (btn === e.target || btn.contains(e.target)) return;
      inst.dragging = true;
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      seekAt(inst, e.clientX);
    });
    el.addEventListener('pointermove', function (e) {
      if (inst.dragging) seekAt(inst, e.clientX);
    });
    function endDrag(e) {
      inst.dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    audio.addEventListener('loadedmetadata', function () { sync(inst); draw(inst); });
    audio.addEventListener('timeupdate', function () { sync(inst); draw(inst); });
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
          duration: i.audio.duration || 0, currentTime: +(i.audio.currentTime || 0).toFixed(3)
        };
      });
    }
  };
})();
