/* ==================================================================
   xcat-media-controls.js — 媒体控制条补强（不动压缩 bundle）
   ------------------------------------------------------------------
   1) 视频节点：上游 .vp-bar 的音量按钮只有「静音 / 取消静音」两个状态，
      这里在控制条末尾追加一个音量滑块，直接读写同一个 <video>.volume。
      Vue 自己的 onVolumechange 仍会同步静音按钮图标，互不干扰。
   2) 音频节点：xcat-audio-wave.js 生成的波形保留不变，在波形底部补一条
      与 .vp-bar **逐像素一致**的控制条。内部元素直接复用上游
      .vp-btn / .vp-time / .vp-seek 三个 class 并补上 scoped 属性
      data-v-5b5d8e84，让上游 index-*.css 的规则原样命中，避免自己抄一份
      样式后尺寸慢慢跑偏（音频条曾用 18px 图标，视频条是 14px，肉眼可见）。
      音频条中间不再放细进度线（波形上有可拖动的蓝色播放头），
      改用一个透明的 flex 占位把静音 / 音量顶到右端，其余控件几何不变。
      波形进度只能 hover 播放头出左右箭头后拖动，点空白不跳。

   为什么全用 DOM 注入而不是改 bundle：.vp-bar 是压缩产物里的 Vue 组件，
   改它要重写渲染函数与 patch flag；而 Vue 对 vnode 之外追加的 DOM 不会
   清理（children 由 vnode 数组管理，不按 childNodes 索引重排），注入安全。

   控制条一律 padding-right:36px，给右下角 .node-resize 手柄让位
   （上一轮「音量按钮与 resize 重叠」就是这么修的）。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatMediaControls) return;

  /* VideoPlayer.vue 的 scoped id；注入元素补上它，才能命中上游 .vp-* 样式 */
  var SCOPE = 'data-v-5b5d8e84';
  function scoped(el) { el.setAttribute(SCOPE, ''); return el; }

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

  function mkVolume() {
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

  function mkButton(cls, title, svg) {
    var b = document.createElement('button');
    b.className = cls + ' nodrag';
    b.type = 'button';
    b.title = title;
    b.innerHTML = svg;
    return scoped(b);
  }

  /* 把音量滑块 / 静音按钮与一个媒体元素绑定。
     ownMute=true 时由本脚本切换静音（音频控制条）；
     false 时静音按钮归 Vue 管，只靠 volumechange 同步（视频控制条）。 */
  function bindVolume(media, slider, muteBtn, ownMute) {
    function sync() {
      var v = media.muted ? 0 : (typeof media.volume === 'number' ? media.volume : 1);
      slider.value = String(v);
      slider.style.setProperty('--vol', (v * 100) + '%');
      if (muteBtn) {
        var silent = media.muted || media.volume === 0;
        muteBtn.innerHTML = silent ? ICON_MUTE : ICON_VOL;
        muteBtn.title = silent ? '取消静音' : '静音';
      }
    }
    slider.addEventListener('input', function () {
      var v = Math.max(0, Math.min(1, Number(slider.value) || 0));
      media.volume = v;
      if (v > 0 && media.muted) media.muted = false;
      sync();
    });
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
  }

  /* ---------------------------------------------------------- 视频节点 */
  function installVideoBar(bar) {
    if (installed.has(bar) || bar.querySelector('.xcat-vol')) return;
    var host = bar.parentElement;
    var video = host && host.querySelector('.vp-video');
    if (!video) return;                       // 组件还没渲染完，下次扫描再装
    var slider = mkVolume();
    bar.appendChild(slider);                 // 追加到末尾，不插进 vnode 中间
    bindVolume(video, slider, null, false);
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
    var play = mkButton('vp-btn xcat-aw-play', '播放', ICON_PLAY);
    var time = document.createElement('span');
    time.className = 'vp-time xcat-aw-time';
    time.textContent = '0:00 / 0:00';
    scoped(time);
    /* 中间只留透明占位：进度由波形上的蓝色播放头表示，控制条不再画细线。
       flex:1 占掉原来 .vp-seek 的 222.7px，右端静音 / 音量仍与视频条对齐。 */
    var spacer = document.createElement('span');
    spacer.className = 'xcat-aw-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    var mute = mkButton('vp-btn xcat-aw-mute', '静音', ICON_VOL);
    var slider = mkVolume();
    /* 顺序与视频 .vp-bar 一致：播放 / 时间 / 占位 / 静音 / 音量 */
    bar.appendChild(play);
    bar.appendChild(time);
    bar.appendChild(spacer);
    bar.appendChild(mute);
    bar.appendChild(slider);
    wave.appendChild(bar);
    stopAll(bar);

    function syncTime() {
      time.textContent = fmt(audio.currentTime) + ' / ' + fmt(audio.duration);
    }
    function syncPlay() {
      play.innerHTML = audio.paused ? ICON_PLAY : ICON_PAUSE;
      play.title = audio.paused ? '播放' : '暂停';
    }
    play.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!audio.getAttribute('src')) return;
      if (audio.paused) {
        var p = audio.play();
        if (p && p.catch) p.catch(function () { /* 无手势 / 源不可播 */ });
      } else audio.pause();
    });
    ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'ended'].forEach(function (t) {
      audio.addEventListener(t, syncTime);
    });
    audio.addEventListener('play', syncPlay);
    audio.addEventListener('pause', syncPlay);
    audio.addEventListener('ended', syncPlay);
    bindVolume(audio, slider, mute, true);
    syncTime(); syncPlay();
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

  /* 主题切换只影响 CSS 变量，滑块填充色自动跟随；无需重绘 */
  installAll();
  window.__xcatMediaControls = {
    install: installAll,
    stats: function () {
      return {
        videoBars: document.querySelectorAll('.vp-bar .xcat-vol').length,
        audioBars: document.querySelectorAll('.xcat-aw-bar').length,
        audioSpacers: document.querySelectorAll('.xcat-aw-bar .xcat-aw-spacer').length,
        volumes: Array.from(document.querySelectorAll('.xcat-vol')).map(function (s) {
          return { value: +(+s.value).toFixed(2), fill: s.style.getPropertyValue('--vol') };
        })
      };
    }
  };
})();
