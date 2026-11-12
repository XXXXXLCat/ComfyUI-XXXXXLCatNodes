/* ==================================================================
   xcat-media-controls.js — 媒体控制条（视频 / 音频共用一套自绘实现）
   ------------------------------------------------------------------
   视频节点与音频节点现在用**同一份**控制条代码：播放 / 时间 / 进度 /
   静音 / 音量，全部自绘，不引用上游 .vp-btn / .vp-time / .vp-seek，
   也不补 data-v-5b5d8e84 scoped 属性。

   这套东西要解决的三个观感问题：
     · 原生 input[type=range] 的 thumb 位置按整像素吸附，222px 的条上
       每秒只走 1.55px，看起来就是「一顿一顿」；而且 thumb 内缩 4.5px，
       0% / 100% 与轨道对不齐。
     · 进度填充用 background 百分比（--progress），同样只能整像素跳。
     · 时间文字由浏览器按内容撑宽，秒数从 9 进位到 10 时整串变宽，
       右边元素每秒被挤一下；甚至被压窄后画出省略号「…」。
   新实现：进度 / 音量是 div + span 画的（轨道 + 填充 + 圆点），位置只用
   transform: scaleX / translate3d 驱动（亚像素、走合成层、不触发布局）；
   时间拆成「当前 / 分隔 / 总长」三段定宽（22 + 9 + 22 = 53px），进位
   不改总宽；播放时用 rAF 每帧跟随媒体时间，而不是只听 timeupdate 的 ~4Hz。

   视频条怎么换：
     上游 .vp-bar 是压缩 bundle 里的 Vue 组件（<div class="video-player">
     下 [video, .vp-bar]），改它要重写渲染函数。做法与节点操作按钮一致：
     把原 .vp-bar 隐藏（保留 DOM，Vue 的 patch 仍以它为锚点，不会出错），
     在同一个 .video-player 里追加自己的 .xcat-vbar。Vue 不会清理 vnode
     之外的追加节点（children 按 vnode 数组管理，不按 childNodes 索引重排）。

   几何：gap 8 / padding 7 10 8 / 按钮 20 / 时间 10px / 进度 3px + 9px
   圆点 / 音量条 60px；节点里右内边距 36px 让开 .node-resize（见 CSS）。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatMediaControls) return;

  /* 图标与上游 VideoPlayer.vue 完全一致：14×14、同样的 path */
  function icon(paths) {
    return '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' + paths + '</svg>';
  }
  var ICON_PLAY = icon('<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>');
  var ICON_PAUSE = icon('<path d="M7 4.5v15M17 4.5v15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>');
  var ICON_VOL = icon(
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>' +
    '<path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
  var ICON_MUTE = icon(
    '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/>' +
    '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');

  var installed = new WeakMap();  // host -> true
  var STOP = ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup',
              'touchstart', 'wheel', 'dblclick'];

  function fmt(t) {
    if (!isFinite(t) || t < 0) t = 0;
    var s = Math.floor(t), m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  }

  function stopAll(el) {
    STOP.forEach(function (type) {
      el.addEventListener(type, function (e) { e.stopPropagation(); });
    });
  }

  /* ---------------------------------------------------------- 自绘滑块
     返回 { root, set }。set(0..1) 只改变换，不碰布局。
     轨道左右各内缩 4.5px，圆点中心正好落在轨道两端。 */
  function mkSlider(cls, label, onInput) {
    var root = document.createElement('div');
    root.className = cls + ' nodrag';
    root.tabIndex = 0;
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', label);
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', '100');

    var track = document.createElement('span');
    track.className = cls + '-track';
    var fill = document.createElement('span');
    fill.className = cls + '-fill';
    var thumb = document.createElement('span');
    thumb.className = cls + '-thumb';
    root.appendChild(track);
    root.appendChild(fill);
    root.appendChild(thumb);

    var ratio = 0, dragging = false, spanPx = 0, lastPct = -1;

    /* 轨道可用宽度缓存在 spanPx 里：paint 每帧都跑，不能每帧读 clientWidth
       （那是强制同步布局）。尺寸变化交给 ResizeObserver。 */
    function measure() {
      spanPx = Math.max(0, root.clientWidth - 9);
    }
    function paint() {
      fill.style.transform = 'scaleX(' + ratio + ')';
      thumb.style.transform = 'translate3d(' + (ratio * spanPx).toFixed(2) + 'px,0,0)';
      var pct = Math.round(ratio * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        root.setAttribute('aria-valuenow', String(pct));
      }
    }
    function at(clientX) {
      var r = root.getBoundingClientRect();
      var w = r.width - 9;
      var p = w > 0 ? (clientX - r.left - 4.5) / w : 0;
      return p < 0 ? 0 : p > 1 ? 1 : p;
    }
    function apply(p, fire) {
      ratio = p;
      paint();
      if (fire && onInput) onInput(ratio);
    }

    root.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      dragging = true;
      try { root.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      apply(at(e.clientX), true);
    });
    root.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      e.stopPropagation();
      apply(at(e.clientX), true);
    });
    ['pointerup', 'pointercancel'].forEach(function (t) {
      root.addEventListener(t, function (e) {
        if (!dragging) return;
        dragging = false;
        try { root.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      });
    });
    root.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? .02
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -.02 : 0;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      apply(Math.min(1, Math.max(0, ratio + d)), true);
    });
    /* 尺寸变化（节点 resize / 大预览）时圆点位置要按新宽度重算 */
    if (window.ResizeObserver) new ResizeObserver(function () { measure(); paint(); }).observe(root);

    measure();
    paint();
    return {
      root: root,
      set: function (p) { ratio = p; paint(); }
    };
  }

  function mkIconButton(cls, title, svg) {
    var b = document.createElement('button');
    b.className = cls + ' nodrag';
    b.type = 'button';
    b.title = title;
    b.innerHTML = svg;
    return b;
  }

  /* ---------------------------------------------------------- 控制条
     为任意媒体元素（<video> / <audio>）建一条自绘控制条。
     cls 决定挂哪个 class（xcat-aw-bar / xcat-vbar），几何由 .xcat-mbar 提供。 */
  function buildBar(media, cls) {
    var bar = document.createElement('div');
    bar.className = 'xcat-mbar ' + cls + ' nodrag';

    var play = mkIconButton('xaw-btn xaw-play', '播放', ICON_PLAY);
    var mute = mkIconButton('xaw-btn xaw-mute', '静音', ICON_VOL);

    /* 时间：三段定宽，秒数进位不改变总宽（宽度一变右边就会跟着挪） */
    var time = document.createElement('span');
    time.className = 'xaw-time';
    var tCur = document.createElement('b');
    var tSep = document.createElement('i');
    var tDur = document.createElement('b');
    tCur.textContent = '0:00';
    tSep.textContent = '/';
    tDur.textContent = '0:00';
    time.appendChild(tCur);
    time.appendChild(tSep);
    time.appendChild(tDur);

    function duration() {
      var d = media.duration;
      return (d && isFinite(d) && d > 0) ? d : 0;
    }

    var seek = mkSlider('xaw-seek', '进度', function (p) {
      var d = duration();
      if (!d) return;
      try { media.currentTime = p * d; } catch (_) { /* ignore */ }
      paintProgress();
      paintTime();
    });

    var vol = mkSlider('xaw-vol', '音量', function (p) {
      media.volume = p;
      if (p > 0 && media.muted) media.muted = false;
    });

    /* 顺序与上游 .vp-bar 一致：播放 / 时间 / 进度 / 静音 / 音量 */
    bar.appendChild(play);
    bar.appendChild(time);
    bar.appendChild(seek.root);
    bar.appendChild(mute);
    bar.appendChild(vol.root);

    var lastSec = -1, playing = false, raf = 0;

    /* 只写 transform，不读布局；paint 内部也不读 clientWidth（已缓存） */
    function paintProgress() {
      var d = duration();
      seek.set(d ? Math.min(1, Math.max(0, (media.currentTime || 0) / d)) : 0);
    }
    function paintTime() {
      var s = Math.floor(media.currentTime || 0);
      if (s === lastSec) return;          // 秒数没变就不碰 DOM
      lastSec = s;
      tCur.textContent = fmt(media.currentTime);
      tDur.textContent = fmt(duration());
    }
    function frame() {
      if (!playing) return;
      paintProgress();
      paintTime();
      raf = requestAnimationFrame(frame);
    }
    function repaint() { paintProgress(); paintTime(); }

    play.addEventListener('click', function (e) {
      e.stopPropagation();
      if (media.paused) {
        if (!media.getAttribute('src')) return;
        var p = media.play();
        if (p && p.catch) p.catch(function () { /* 无手势 / 源不可播 */ });
      } else media.pause();
    });

    media.addEventListener('loadedmetadata', function () { lastSec = -1; repaint(); });
    media.addEventListener('durationchange', function () { lastSec = -1; repaint(); });
    media.addEventListener('timeupdate', function () { if (!playing) repaint(); });
    media.addEventListener('seeked', function () { lastSec = -1; repaint(); });
    media.addEventListener('play', function () {
      playing = true;
      play.innerHTML = ICON_PAUSE;
      play.title = '暂停';
      cancelAnimationFrame(raf);
      frame();
    });
    media.addEventListener('pause', function () {
      playing = false;
      play.innerHTML = ICON_PLAY;
      play.title = '播放';
      cancelAnimationFrame(raf);
      repaint();
    });
    media.addEventListener('ended', function () {
      playing = false;
      cancelAnimationFrame(raf);
      lastSec = -1;
      repaint();
    });

    /* 静音按钮由本脚本自己管（上游那颗已被隐藏） */
    function syncVol() {
      var v = media.muted ? 0 : (typeof media.volume === 'number' ? media.volume : 1);
      vol.set(v);
      var silent = media.muted || media.volume === 0;
      mute.innerHTML = silent ? ICON_MUTE : ICON_VOL;
      mute.title = silent ? '取消静音' : '静音';
    }
    mute.addEventListener('click', function (e) {
      e.stopPropagation();
      media.muted = !media.muted;
      if (!media.muted && media.volume === 0) media.volume = .5;
      syncVol();
    });
    media.addEventListener('volumechange', syncVol);

    stopAll(bar);
    syncVol();
    lastSec = -1;
    repaint();

    return bar;
  }

  /* ---------------------------------------------------------- 视频节点 */
  function installVideoBar(bar) {
    if (installed.has(bar)) return;
    var host = bar.parentElement;              // .video-player（position:relative）
    if (!host) return;
    var video = host.querySelector('.vp-video');
    if (!video) return;                        // 组件还没渲染完，下次扫描再装

    /* 原条保留在 DOM 里（Vue 的 patch 锚点），只藏起来 */
    bar.style.display = 'none';
    bar.setAttribute('data-xcat-off', '1');

    host.appendChild(buildBar(video, 'xcat-vbar'));
    installed.set(bar, true);
  }

  /* ---------------------------------------------------------- 音频波形 */
  function installAudioWave(wave) {
    if (installed.has(wave)) return;
    /* xcat-audio-wave.js 会先清空容器再建 <audio>，等它就绪 */
    var audio = wave.querySelector('.xcat-wave-audio');
    if (!audio) return;

    wave.appendChild(buildBar(audio, 'xcat-aw-bar'));
    installed.set(wave, true);
  }

  function installAll() {
    document.querySelectorAll('.vp-bar').forEach(installVideoBar);
    document.querySelectorAll('.xcat-audio-wave').forEach(installAudioWave);
  }

  /* rAF 合并：DOM 变化可能是成批的（节点新建、翻页、弹出预览） */
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; installAll(); });
  }

  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].addedNodes.length || list[i].removedNodes.length) { schedule(); break; }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  installAll();
  window.__xcatMediaControls = {
    install: installAll,
    stats: function () {
      return {
        videoBars: document.querySelectorAll('.xcat-vbar').length,
        audioBars: document.querySelectorAll('.xcat-aw-bar').length,
        hiddenUpstream: document.querySelectorAll('.vp-bar[data-xcat-off]').length,
        seeks: document.querySelectorAll('.xaw-seek').length
      };
    }
  };
})();
