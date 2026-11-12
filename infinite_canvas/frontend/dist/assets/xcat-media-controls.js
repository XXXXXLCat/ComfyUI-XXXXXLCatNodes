/* ==================================================================
   xcat-media-controls.js — 媒体控制条补强（不动压缩 bundle）
   ------------------------------------------------------------------
   1) 视频节点：上游 .vp-bar 的音量按钮只有「静音 / 取消静音」两个状态，
      这里在控制条末尾追加一个音量滑块，直接读写同一个 <video>.volume。
      Vue 自己的 onVolumechange 仍会同步静音按钮图标，互不干扰。
      视频条本身完全交给上游，本脚本一个字节都不改。
   2) 音频节点：xcat-audio-wave.js 生成的波形保留不变，在波形底部补一条
      控制条 —— 这一版是**完全自绘**的，不引用上游任何 .vp-* class，
      也不补 data-v-5b5d8e84 scoped 属性：
        · 进度 / 音量都是 div + span 画的（轨道 + 填充 + 圆点），
          没有任何原生 input[type=range]；
        · 位置用 transform: scaleX / translate3d 驱动，亚像素、走合成层，
          不会像原生 thumb 那样按整像素吸附、也不会触发重排；
        · 时间拆成「当前 / 分隔 / 总长」三段定宽，秒数进位不改变总宽，
          右侧元素不会每秒被挤动一下；
        · 播放时用 rAF 跟随 currentTime（而不是只听 timeupdate 的 ~4Hz），
          暂停 / 拖动时用事件补一帧。
      几何与视频条对齐：gap 8 / padding 7 8 8 10 / 按钮 20 / 时间 10px /
      进度 3px 高 + 9px 圆点。右侧 36px 留白给 .node-resize 手柄。

   为什么全用 DOM 注入而不是改 bundle：.vp-bar 是压缩产物里的 Vue 组件，
   改它要重写渲染函数与 patch flag；而 Vue 对 vnode 之外追加的 DOM 不会
   清理（children 由 vnode 数组管理，不按 childNodes 索引重排），注入安全。
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

  /* ---------------------------------------------------------- 视频音量滑块 */
  function mkVolumeInput() {
    var s = document.createElement('input');
    s.className = 'xcat-vol nodrag';
    s.type = 'range';
    s.min = '0'; s.max = '1'; s.step = '0.01'; s.value = '1';
    s.title = '音量';
    s.setAttribute('aria-label', '音量');
    /* 拖动滑块不能触发 Vue Flow 的拖节点 / 卡片切素材 */
    ['mousedown', 'pointerdown', 'click', 'dblclick', 'wheel'].forEach(function (t) {
      s.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    return s;
  }

  /* ---------------------------------------------------------- 自绘滑块
     返回 { root, set }。set(0..1) 只改变量 + transform，不碰布局。
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

  /* 把音量滑块 / 静音按钮与一个媒体元素绑定。
     paint(v) 负责把 0..1 画到滑块上（原生 input 或自绘滑块都行）。
     ownMute=true 时由本脚本切换静音（音频控制条）；
     false 时静音按钮归 Vue 管，只靠 volumechange 同步（视频控制条）。 */
  function bindVolume(media, paint, muteBtn, ownMute) {
    function sync() {
      var v = media.muted ? 0 : (typeof media.volume === 'number' ? media.volume : 1);
      paint(v);
      if (muteBtn) {
        var silent = media.muted || media.volume === 0;
        muteBtn.innerHTML = silent ? ICON_MUTE : ICON_VOL;
        muteBtn.title = silent ? '取消静音' : '静音';
      }
    }
    if (ownMute && muteBtn) {
      muteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        media.muted = !media.muted;
        if (!media.muted && media.volume === 0) media.volume = .5;
        sync();
      });
    }
    media.addEventListener('volumechange', sync);
    sync();
    return sync;
  }

  /* ---------------------------------------------------------- 视频节点 */
  function installVideoBar(bar) {
    if (installed.has(bar) || bar.querySelector('.xcat-vol')) return;
    var host = bar.parentElement;
    var video = host && host.querySelector('.vp-video');
    if (!video) return;                       // 组件还没渲染完，下次扫描再装
    var slider = mkVolumeInput();
    bar.appendChild(slider);                  // 追加到末尾，不插进 vnode 中间
    function paintVol(v) {
      slider.value = String(v);
      slider.style.setProperty('--vol', (v * 100) + '%');
    }
    bindVolume(video, paintVol, null, false);
    slider.addEventListener('input', function () {
      var v = Math.max(0, Math.min(1, Number(slider.value) || 0));
      video.volume = v;
      if (v > 0 && video.muted) video.muted = false;
      paintVol(v);
    });
    installed.set(bar, true);
  }

  /* ---------------------------------------------------------- 音频波形 */
  function installAudioWave(wave) {
    if (installed.has(wave)) return;
    /* xcat-audio-wave.js 会先清空容器再建 <audio>，等它就绪 */
    var audio = wave.querySelector('.xcat-wave-audio');
    if (!audio) return;

    var bar = document.createElement('div');
    bar.className = 'xcat-aw-bar nodrag';

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

    var seek = mkSlider('xaw-seek', '进度', function (p) {
      var d = duration();
      if (!d) return;
      try { audio.currentTime = p * d; } catch (_) { /* ignore */ }
      /* 波形靠这个事件重绘播放头 */
      try { audio.dispatchEvent(new Event('timeupdate')); } catch (_) { /* ignore */ }
    });

    var vol = mkSlider('xaw-vol', '音量', function (p) {
      audio.volume = p;
      if (p > 0 && audio.muted) audio.muted = false;
    });

    /* 顺序与视频 .vp-bar 一致：播放 / 时间 / 进度 / 静音 / 音量 */
    bar.appendChild(play);
    bar.appendChild(time);
    bar.appendChild(seek.root);
    bar.appendChild(mute);
    bar.appendChild(vol.root);
    wave.appendChild(bar);
    stopAll(bar);

    /* 按钮上的 stopPropagation 先于整条的 stopAll 生效没关系，
       关键是不能让 pointerdown 冒到 Vue Flow 触发拖节点 */
    play.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!audio.getAttribute('src')) return;
      if (audio.paused) {
        var p = audio.play();
        if (p && p.catch) p.catch(function () { /* 无手势 / 源不可播 */ });
      } else audio.pause();
    });

    function duration() {
      var d = audio.duration;
      return (d && isFinite(d) && d > 0) ? d : 0;
    }

    var lastSec = -1, playing = false, raf = 0;

    /* 只写 transform，不读布局（span() 里读 clientWidth 每帧一次，
       会强制同步布局；这里缓存下来，尺寸变了由 ResizeObserver 重画） */
    function paintProgress() {
      var d = duration();
      seek.set(d ? Math.min(1, Math.max(0, audio.currentTime / d)) : 0);
    }
    function paintTime() {
      var d = duration();
      var s = Math.floor(audio.currentTime || 0);
      if (s === lastSec) return;          // 秒数没变就不碰 DOM
      lastSec = s;
      tCur.textContent = fmt(audio.currentTime);
      tDur.textContent = fmt(d);
    }
    function frame() {
      if (!playing) return;
      paintProgress();
      paintTime();
      raf = requestAnimationFrame(frame);
    }
    function repaint() { paintProgress(); paintTime(); }

    audio.addEventListener('loadedmetadata', function () { lastSec = -1; repaint(); });
    audio.addEventListener('durationchange', function () { lastSec = -1; repaint(); });
    audio.addEventListener('timeupdate', function () { if (!playing) repaint(); });
    audio.addEventListener('seeked', function () { lastSec = -1; repaint(); });
    audio.addEventListener('play', function () {
      playing = true;
      play.innerHTML = ICON_PAUSE;
      play.title = '暂停';
      cancelAnimationFrame(raf);
      frame();
    });
    audio.addEventListener('pause', function () {
      playing = false;
      play.innerHTML = ICON_PLAY;
      play.title = '播放';
      cancelAnimationFrame(raf);
      repaint();
    });
    audio.addEventListener('ended', function () {
      playing = false;
      cancelAnimationFrame(raf);
      lastSec = -1;
      repaint();
    });

    bindVolume(audio, function (v) { vol.set(v); }, mute, true);

    lastSec = -1;
    repaint();
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
        videoBars: document.querySelectorAll('.vp-bar .xcat-vol').length,
        audioBars: document.querySelectorAll('.xcat-aw-bar').length,
        seeks: document.querySelectorAll('.xaw-seek').length,
        vols: Array.from(document.querySelectorAll('.xaw-vol')).map(function (s) {
          var th = s.querySelector('.xaw-thumb');
          return { tf: th && th.style.transform };
        })
      };
    }
  };
})();
