/* ==================================================================
   xcat-audio-edit.js — 音频节点「截取 / 变速」
   ------------------------------------------------------------------
   参考 Toonflow-app 的 packages/nodes/audioNode：节点顶部两个入口，
   截取是波形时间轴上的多段剪辑（分割 / 粘合 / 删除 / 撤销重做 / 试听），
   变速是 0.1×–4× 滑块。两者都把参数交给后端
   POST /infinite_canvas/api/audio/process（FFmpeg atrim+concat / atempo），
   导出的 m4a 作为一个新的**素材音频节点**落在原节点右侧，原音频不动。

   不碰上游 bundle：按钮像 xcat-node-actionbar.js 那样注入 .node-actions，
   弹窗挂在 #app 内（--cg-* 令牌定义在 #app 上），全部用 DOM 操作实现。
   片段模型与参考一致：groups = 片段数组，每组是一串源时间区间；
   导出时展开成一维 segments，删除造成的缺口用 concat 自然拼掉。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatAudioEdit) return;

  var API = '/infinite_canvas/api/audio/process';
  var SCOPE = 'data-v-abbe9e2b';
  var NODE_W = 480, NODE_H = 270, GAP_X = 80, GAP_Y = 40;
  var PEAKS_N = 1200;
  var MIN_GAP = 0.01;              /* 分割后每段至少 10ms，避免 0 长度片段 */

  var ICON_PLAY = '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" width="15" height="15"><path d="M7 4.5v15M17 4.5v15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';

  var S = null;                    /* 当前会话 */
  var modal = null;
  var busy = false;
  var controller = null;
  /* 后端 Python 改动必须重启 ComfyUI 才生效。旧进程没有 /audio/process 路由，
     POST 会落到静态文件路由，返回纯文本 "405: Method Not Allowed"（或 404），
     被当 JSON 解析就是 "JSONDecodeError ... 第1行第4列"。打开弹窗先探测一次，
     不就绪就明确提示并禁用导出，别让用户对着一个看不懂的解析错误猜。 */
  /* 与视频节点共用的媒体编辑内核（index.html 里必须排在本脚本之前） */
  var core = window.__xcatMediaCore;
  var probe = core ? core.createProbe(API) : null;
  var apiReady = false;

  /* ------------------------------------------------------------ 小工具 */
  function flow () { return window.__xcatFlow; }
  function graph () { return window.__xcatGraph; }
  function q (sel, root) { return (root || document).querySelector(sel); }
  function qa (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp (v, a, b) { return v < a ? a : (v > b ? b : v); }
  function finite (v) { return typeof v === 'number' && isFinite(v); }
  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt (v) {
    var t = Math.round(Math.max(0, finite(v) ? v : 0) * 100);
    return Math.floor(t / 6000) + ':' + (t % 6000 / 100).toFixed(2).padStart(5, '0');
  }
  function nodeById (id) {
    var f = flow();
    if (!f || !f.getNodes) return null;
    return f.getNodes.value.find(function (n) { return n.id === id; }) || null;
  }
  function activeAudio (wrap) {
    var id = wrap && wrap.dataset ? wrap.dataset.id : null;
    var n = id ? nodeById(id) : null;
    if (!n) return null;
    var media = (n.data && n.data.media) || [];
    var cur = media[clamp(Number(n.data && n.data.index) || 0, 0, Math.max(0, media.length - 1))];
    return cur && cur.kind === 'audio' ? cur : null;
  }
  function refOf (item) {
    if (item.ref && item.ref.filename) {
      return {
        filename: String(item.ref.filename),
        subfolder: String(item.ref.subfolder || ''),
        type: String(item.ref.type || 'input')
      };
    }
    try {
      var u = new URL(item.url, location.origin);
      return {
        filename: u.searchParams.get('filename') || '',
        subfolder: u.searchParams.get('subfolder') || '',
        type: u.searchParams.get('type') || 'input'
      };
    } catch (e) { return { filename: '', subfolder: '', type: 'input' }; }
  }
  function toast (text, isError) {
    var host = q('#app') || document.body;
    var el = document.createElement('div');
    el.className = 'xcat-ae-toast' + (isError ? ' is-error' : '');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 3200);
  }

  /* ------------------------------------------------------------ 按钮注入 */
  function makeBtn (cls, text, aria, mode) {
    var b = document.createElement('button');
    b.type = 'button';
    /* is-enabled 与上游 6 枚「可用」按钮同款描边，整排才一致 */
    b.className = 'fan-btn is-enabled ' + cls + ' nodrag';
    b.title = text;
    b.setAttribute('aria-label', aria);
    /* 本按钮自带文字，覆盖层 CSS 不要再给它补 ::after */
    b.setAttribute('data-xcat-text', '');
    b.setAttribute(SCOPE, '');
    b.textContent = text;
    ['pointerdown', 'mousedown', 'dblclick', 'click'].forEach(function (t) {
      b.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var wrap = b.closest('.vue-flow__node');
      var item = wrap && activeAudio(wrap);
      if (!item || !wrap) return;
      open(mode, wrap.dataset.id, item);
    });
    return b;
  }

  function install () {
    var bars = qa('#app .demo-node .node-actions');
    bars.forEach(function (bar) {
      if (!q('.xcat-ae-clip', bar)) bar.appendChild(makeBtn('xcat-ae-clip', '截取', '截取音频', 'clip'));
      if (!q('.xcat-ae-speed', bar)) bar.appendChild(makeBtn('xcat-ae-speed', '变速', '音频变速', 'speed'));
    });
    qa('.xcat-ae-clip, .xcat-ae-speed').forEach(function (b) {
      var wrap = b.closest('.vue-flow__node');
      b.style.display = (wrap && activeAudio(wrap)) ? '' : 'none';
    });
  }
  var queued = false;
  function schedule () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; install(); });
  }

  /* ------------------------------------------------------------ 会话与数据 */
  function open (mode, nodeId, item) {
    if (modal) close();
    var ref = refOf(item);
    if (!ref.filename) { toast('无法定位音频文件', true); return; }
    var src = item.url;
    S = {
      mode: mode, nodeId: nodeId, item: item, ref: ref, src: src,
      duration: 0, peaks: null, groups: [], selected: 0, playhead: 0,
      undoStack: [], redoStack: [], audio: null,
      playClip: 0, playPart: 0, speed: 1
    };
    buildModal();
    preflight();
    loadAudio().then(function () {
      if (!S || S.mode !== mode) return;
      if (mode === 'clip') initSegments();
      render();
    });
  }

  function buildModal () {
    var host = q('#app') || document.body;
    modal = document.createElement('div');
    modal.className = 'xcat-ae-modal';
    modal.innerHTML = [
      '<div class="xcat-ae-backdrop"></div>',
      '<div class="xcat-ae-dialog" role="dialog" aria-modal="true" aria-label="',
        S.mode === 'clip' ? '截取与拼接' : '音频变速', '">',
        '<div class="xcat-ae-head">',
          '<div><div class="xcat-ae-title">', S.mode === 'clip' ? '截取与拼接' : '音频变速', '</div>',
          '<div class="xcat-ae-sub" id="xcat-ae-sub">正在读取音频…</div></div>',
          '<button type="button" class="xcat-ae-x" id="xcat-ae-x" title="关闭" aria-label="关闭">×</button>',
        '</div>',
        '<div class="xcat-ae-warn" id="xcat-ae-warn" hidden>',
          '音频处理接口未就绪：后端 Python 尚未重启。请<strong>完全重启 ComfyUI</strong>',
          '（只刷新浏览器无效），然后重新打开本窗口。',
        '</div>',
        '<div class="xcat-ae-body" id="xcat-ae-body">', bodyHtml(), '</div>',
        '<div class="xcat-ae-foot">',
          '<div class="xcat-ae-status" id="xcat-ae-status"></div>',
          '<button type="button" class="xcat-ae-btn" id="xcat-ae-cancel">取消</button>',
          '<button type="button" class="xcat-ae-btn is-primary" id="xcat-ae-run" disabled>',
            S.mode === 'clip' ? '导出音频' : '生成变速音频', '</button>',
        '</div>',
      '</div>'
    ].join('');
    host.appendChild(modal);

    /* 弹窗内的交互不冒泡到画布；捕获阶段的全局脚本靠 target 判定，不会命中 */
    ['pointerdown', 'mousedown', 'dblclick', 'click', 'wheel', 'contextmenu', 'drop', 'dragover']
      .forEach(function (t) { modal.addEventListener(t, function (e) { e.stopPropagation(); }); });

    q('#xcat-ae-x', modal).addEventListener('click', function () { if (!busy) close(); });
    q('#xcat-ae-cancel', modal).addEventListener('click', function () { close(); });
    /* 遮罩不关闭：双击遮罩时第一击若关掉弹窗，第二击会落到画布上，
       被 xcat-new-node.js 的 dblclick 捕获当成「双击空白新建节点」。
       关闭只走右上 × / 取消 / Esc 三个明确入口。 */
    q('#xcat-ae-run', modal).addEventListener('click', run);
    var number = q('#xcat-ae-number', modal);
    if (number) number.addEventListener('focus', function () { this.select(); });
    q('#xcat-ae-body', modal).addEventListener('click', onClickBody);
    q('#xcat-ae-body', modal).addEventListener('input', onInputBody);
    q('#xcat-ae-body', modal).addEventListener('change', onChangeBody);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('paste', onPasteGuard, true);
    window.addEventListener('dblclick', onDblGuard, true);
    if (S.mode === 'clip') {
      S.audio = new Audio(S.src);
      S.audio.preload = 'auto';
      S.audio.addEventListener('timeupdate', updatePlayback);
      S.audio.addEventListener('ended', function () { render(); });
    }
  }

  function bodyHtml () {
    if (S.mode === 'speed') {
      return [
        '<div class="xcat-ae-speedinfo" id="xcat-ae-speedinfo">正在读取音频…</div>',
        '<div class="xcat-ae-speedrow">',
          '<span class="xcat-ae-limit">0.1×</span>',
          '<input type="range" id="xcat-ae-slider" class="xcat-ae-slider" min="0.1" max="4" step="0.1" value="1" aria-label="变速倍数">',
          '<span class="xcat-ae-limit">4×</span>',
          '<input type="number" id="xcat-ae-number" class="xcat-ae-number" min="0.1" max="4" step="0.1" value="1.00" aria-label="变速倍数数值">',
        '</div>',
        '<div class="xcat-ae-presets" id="xcat-ae-presets">',
          [0.5, 0.75, 1, 1.5, 2, 3].map(function (v) {
            return '<button type="button" class="xcat-ae-chip" data-speed="' + v + '">' + v + '×</button>';
          }).join(''),
        '</div>',
        '<p class="xcat-ae-note">变速使用 FFmpeg atempo 链式处理，保持音调不变；结果会在右侧生成新的素材音频节点，原音频保留。</p>'
      ].join('');
    }
    return [
      '<div class="xcat-ae-timeline" id="xcat-ae-timeline">',
        '<canvas class="xcat-ae-canvas" id="xcat-ae-canvas"></canvas>',
        '<div class="xcat-ae-ruler" id="xcat-ae-ruler"></div>',
        '<div class="xcat-ae-track" id="xcat-ae-track"></div>',
        '<span class="xcat-ae-playhead" id="xcat-ae-playhead"></span>',
        '<input type="range" class="xcat-ae-cursor" id="xcat-ae-cursor" min="0" max="1" step="0.01" value="0" aria-label="剪辑游标">',
      '</div>',
      '<div class="xcat-ae-tools">',
        '<button type="button" data-act="undo">撤销</button>',
        '<button type="button" data-act="redo">重做</button>',
        '<span class="xcat-ae-sep"></span>',
        '<button type="button" data-act="split">分割</button>',
        '<button type="button" data-act="merge">粘合</button>',
        '<button type="button" data-act="remove" class="is-danger">删除片段</button>',
        '<span class="xcat-ae-tools-hint">Ctrl+Z 撤销 · Ctrl+Y 重做 · ←/→ 微调 0.1 秒</span>',
      '</div>',
      '<div class="xcat-ae-player">',
        '<button type="button" class="xcat-ae-play" id="xcat-ae-play" title="播放 / 暂停试听">', ICON_PLAY, '</button>',
        '<span class="xcat-ae-time"><b id="xcat-ae-cur">0:00.00</b> / <span id="xcat-ae-total">0:00.00</span></span>',
        '<span class="xcat-ae-hint">点击片段或时间刻度定位播放头，分割后删除不需要的段落，导出时按保留顺序拼接。</span>',
      '</div>'
    ].join('');
  }

  /* ------------------------------------------------------------ 音频解码 */
  function loadAudio () {
    var src = S.src;
    return fetch(src).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx) throw new Error('浏览器不支持音频解码');
      var ctx = new Ctx(1, 1, 48000);
      return ctx.decodeAudioData(buf);
    }).then(function (buf) {
      if (!S || S.src !== src) return;
      S.duration = buf.duration;
      S.peaks = computePeaks(buf);
      setSub(fmt(S.duration) + ' · ' + esc(S.item.name || S.ref.filename));
    }).catch(function () {
      /* 浏览器能播放但无法解码的格式：退回 <audio> 的元数据，波形用占位 */
      return new Promise(function (resolve) {
        var a = new Audio(src);
        var done = false;
        var finish = function (d) {
          if (done || !S) return resolve();
          done = true;
          S.duration = d || 0;
          S.peaks = fakePeaks();
          setSub((d ? fmt(d) : '时长未知') + ' · 无法显示波形，仍可剪辑');
          resolve();
        };
        a.addEventListener('loadedmetadata', function () {
          finish(isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
        });
        a.addEventListener('error', function () { finish(0); });
        setTimeout(function () { finish(0); }, 4000);
      });
    });
  }
  function computePeaks (buffer) {
    var data = buffer.getChannelData(0);
    var out = new Float32Array(PEAKS_N);
    var size = Math.max(1, Math.floor(data.length / PEAKS_N));
    for (var i = 0; i < PEAKS_N; i++) {
      var s = i * size, e = Math.min(data.length, s + size), v = 0;
      for (var j = s; j < e; j++) { var a = Math.abs(data[j]); if (a > v) v = a; }
      out[i] = v;
    }
    return out;
  }
  function fakePeaks () {
    var out = new Float32Array(PEAKS_N), seed = 0;
    for (var i = 0; i < S.src.length; i++) seed = (seed * 31 + S.src.charCodeAt(i)) >>> 0;
    for (var k = 0; k < PEAKS_N; k++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      out[k] = 0.18 + (seed / 4294967296) * 0.5 * (0.6 + 0.4 * Math.sin(k / 17));
    }
    return out;
  }
  function setSub (text) { var el = q('#xcat-ae-sub'); if (el) el.textContent = text; }
  function setStatus (text, isError) {
    var el = q('#xcat-ae-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', !!isError);
  }

  /* ------------------------------------------------------------ 后端预检 */
  /* 探测逻辑在 xcat-media-core.js 的 createProbe()：发一个空操作，新后端
     返回 JSON 400，旧后端（未重启）的静态路由返回纯文本 405/404。 */
  async function preflight () {
    apiReady = probe ? await probe.check() : true;
    applyApiReady();
  }

  function applyApiReady () {
    if (!modal || !S) return;
    if (core) core.setWarn(modal, apiReady, '后端接口未就绪，需重启 ComfyUI');
    var run = q('#xcat-ae-run', modal);
    if (run && !busy) {
      run.disabled = !apiReady || (S.mode === 'clip' && !valid());
    }
  }

  /* ------------------------------------------------------------ 片段模型 */
  function initSegments () {
    if (!S.duration) { setStatus('无法读取音频时长，不能剪辑', true); return; }
    applyState({ groups: [[{ start: 0, end: S.duration }]], selected: 0, playhead: 0 }, true);
  }
  function clips () {
    var offset = 0;
    return S.groups.map(function (ranges) {
      var length = 0;
      var parts = ranges.map(function (r) {
        var p = { start: r.start, end: r.end, offset: length, length: r.end - r.start };
        length += p.length;
        return p;
      });
      var c = { parts: parts, offset: offset, length: length };
      offset += length;
      return c;
    });
  }
  function totalDuration () { return clips().reduce(function (a, c) { return a + c.length; }, 0); }
  function timelineDuration () { return totalDuration() || S.duration || 1; }
  function valid () {
    return S.duration > 0 && S.groups.length > 0 && S.groups.every(function (g) {
      return g.length && g.every(function (r) {
        return finite(r.start) && finite(r.end) && r.start >= 0 &&
          r.end > r.start && r.end <= S.duration + 0.05;
      });
    });
  }
  function snapshot () {
    return {
      groups: S.groups.map(function (g) { return g.map(function (r) { return { start: r.start, end: r.end }; }); }),
      selected: S.selected, playhead: S.playhead
    };
  }
  function applyState (state, silent) {
    pause();
    S.groups = state.groups;
    S.selected = clamp(state.selected, 0, Math.max(0, S.groups.length - 1));
    S.playhead = clamp(state.playhead, 0, totalDuration());
    if (!silent) { S.undoStack = []; S.redoStack = []; }
    seekPlayer();
    render();
  }
  function commit (next, index, time) {
    S.undoStack.push(snapshot());
    S.redoStack = [];
    applyState({ groups: next, selected: index, playhead: time == null ? S.playhead : time }, true);
  }
  function undo () {
    if (!S.undoStack.length) return;
    S.redoStack.push(snapshot());
    applyState(S.undoStack.pop(), true);
  }
  function redo () {
    if (!S.redoStack.length) return;
    S.undoStack.push(snapshot());
    applyState(S.redoStack.pop(), true);
  }
  function split () {
    var list = clips(), c = list[S.selected];
    if (!c) return;
    var t = S.playhead - c.offset;
    if (t < MIN_GAP || c.length - t < MIN_GAP) return;
    var left = [], right = [];
    c.parts.forEach(function (part) {
      if (part.offset + part.length <= t) left.push({ start: part.start, end: part.end });
      else if (part.offset >= t) right.push({ start: part.start, end: part.end });
      else {
        var cut = part.start + t - part.offset;
        left.push({ start: part.start, end: cut });
        right.push({ start: cut, end: part.end });
      }
    });
    if (!left.length || !right.length) return;
    var next = S.groups.slice();
    next.splice(S.selected, 1, left, right);
    commit(next, S.selected + 1);
  }
  function merge () {
    if (S.groups.length < 2) return;
    var i = Math.max(0, S.selected - 1);
    var next = S.groups.slice();
    next.splice(i, 2, next[i].concat(next[i + 1]));
    commit(next, i, clips()[i] ? clips()[i].offset : 0);
  }
  function removeSegment () {
    if (!S.groups.length) return;
    var next = S.groups.filter(function (_, i) { return i !== S.selected; });
    var index = clamp(S.selected, 0, Math.max(0, next.length - 1));
    var list = clips();
    var time = list.slice(0, index).reduce(function (a, c) { return a + c.length; }, 0);
    commit(next, index, time);
  }

  /* ------------------------------------------------------------ 试听 */
  function pause () { if (S && S.audio) { try { S.audio.pause(); } catch (e) {} } }
  function seekAt (t) {
    if (!finite(t)) return;
    pause();
    S.playhead = clamp(t, 0, totalDuration());
    seekPlayer();
    render();
  }
  function seekPlayer () {
    if (!S || !S.audio || !S.groups.length) return;
    var list = clips();
    var idx = list.findIndex(function (c) { return c.offset + c.length > S.playhead; });
    if (idx < 0) idx = Math.max(0, list.length - 1);
    S.playClip = idx;
    var c = list[idx];
    if (!c) return;
    var pi = c.parts.findIndex(function (p) { return c.offset + p.offset + p.length > S.playhead; });
    if (pi < 0) pi = c.parts.length - 1;
    S.playPart = pi;
    var part = c.parts[pi];
    if (!part) return;
    try { S.audio.currentTime = part.start + S.playhead - c.offset - part.offset; } catch (e) {}
  }
  function updatePlayback () {
    if (!S || !S.audio || S.mode !== 'clip') return;
    var list = clips(), c = list[S.playClip], part = c && c.parts[S.playPart];
    var t = S.audio.currentTime;
    if (!part || !finite(t)) return;
    S.playhead = c.offset + part.offset + clamp(t - part.start, 0, part.length);
    if (!S.audio.paused && t >= part.end - 0.004) {
      var next = c.parts[++S.playPart];
      if (!next) {
        c = list[++S.playClip];
        S.playPart = 0;
        next = c && c.parts[0];
      }
      if (!next) { pause(); S.playhead = totalDuration(); }
      else { S.selected = S.playClip; try { S.audio.currentTime = next.start; } catch (e) {} }
    }
    render(true);
  }
  function togglePlay () {
    if (!S || !S.audio || !valid()) return;
    if (!S.audio.paused) { pause(); render(); return; }
    if (S.playhead >= totalDuration() - 0.01) S.playhead = 0;
    seekPlayer();
    var p = S.audio.play();
    if (p && p.catch) p.catch(function () { setStatus('播放失败：浏览器无法解码该音频', true); });
    render();
  }

  /* ------------------------------------------------------------ 渲染 */
  function render (light) {
    if (!S || !modal) return;
    if (S.mode === 'speed') { renderSpeed(); return; }
    var list = clips(), total = totalDuration(), tl = timelineDuration();
    var cursor = q('#xcat-ae-cursor', modal);
    if (cursor) { cursor.max = String(Math.max(total || 0, 0.01)); if (document.activeElement !== cursor) cursor.value = String(S.playhead); }
    var ph = q('#xcat-ae-playhead', modal);
    if (ph) ph.style.left = (S.playhead / tl * 100) + '%';
    var cur = q('#xcat-ae-cur', modal), tot = q('#xcat-ae-total', modal);
    if (cur) cur.textContent = fmt(S.playhead);
    if (tot) tot.textContent = fmt(total);
    var play = q('#xcat-ae-play', modal);
    if (play) play.innerHTML = S.audio && !S.audio.paused ? ICON_PAUSE : ICON_PLAY;
    if (light) { setToolState(); return; }

    var ruler = q('#xcat-ae-ruler', modal);
    if (ruler) {
      ruler.innerHTML = [0, 1, 2, 3, 4, 5].map(function (i) {
        return '<span style="left:' + (i * 20) + '%">' + fmt(i * tl / 5) + '</span>';
      }).join('');
    }
    var track = q('#xcat-ae-track', modal);
    if (track) {
      track.innerHTML = list.map(function (c, i) {
        return '<button type="button" class="xcat-ae-segment' + (i === S.selected ? ' is-selected' : '') + '"' +
          ' data-index="' + i + '" style="left:' + (c.offset / tl * 100) + '%;width:' + (c.length / tl * 100) + '%">' +
          '<span class="xcat-ae-segname">片段 ' + (i + 1) + '</span>' +
          '<span class="xcat-ae-seglen">' + c.length.toFixed(2) + ' 秒</span></button>';
      }).join('');
    }
    setToolState();
    drawWave();
    setSub(esc(S.item.name || S.ref.filename) + ' · ' + list.length + ' 段 · 合计 ' + fmt(total));
  }
  function setToolState () {
    if (!modal || S.mode !== 'clip') return;
    var list = clips(), c = list[S.selected];
    var canSplit = !!c && S.playhead - c.offset >= MIN_GAP && c.offset + c.length - S.playhead >= MIN_GAP;
    var state = {
      undo: S.undoStack.length > 0, redo: S.redoStack.length > 0,
      split: canSplit, merge: S.groups.length > 1, remove: !!c
    };
    qa('.xcat-ae-tools button', modal).forEach(function (b) {
      b.disabled = !state[b.dataset.act];
    });
    var run = q('#xcat-ae-run', modal);
    if (run) run.disabled = !valid() || busy || !apiReady;
  }
  function drawWave () {
    var cv = q('#xcat-ae-canvas', modal);
    if (!cv || !S.peaks) return;
    var r = cv.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    var ctx = cv.getContext('2d');
    var cs = getComputedStyle(q('#app') || document.body);
    var primary = (cs.getPropertyValue('--cg-primary') || '#0b8ce9').trim();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.34;
    var n = Math.floor(r.width / 4);
    var mid = cv.height / 2, maxH = cv.height * 0.82;
    for (var i = 0; i < n; i++) {
      var s = Math.floor(i / n * S.peaks.length), e = Math.max(s + 1, Math.floor((i + 1) / n * S.peaks.length));
      var v = 0;
      for (var j = s; j < e && j < S.peaks.length; j++) if (S.peaks[j] > v) v = S.peaks[j];
      var h = Math.max(2 * dpr, v * maxH);
      ctx.fillRect(i * 4 * dpr + dpr, mid - h / 2, 2 * dpr, h);
    }
    ctx.globalAlpha = 1;
  }
  function renderSpeed () {
    if (!S || !modal) return;
    var info = q('#xcat-ae-speedinfo', modal);
    if (info) {
      info.textContent = S.duration
        ? '原时长 ' + fmt(S.duration) + '  →  预计 ' + fmt(S.duration / S.speed)
        : '正在读取音频时长…';
    }
    var slider = q('#xcat-ae-slider', modal), num = q('#xcat-ae-number', modal);
    if (slider && String(S.speed) !== slider.value) slider.value = String(S.speed);
    if (num && document.activeElement !== num) num.value = S.speed.toFixed(2);
    qa('.xcat-ae-chip', modal).forEach(function (b) {
      b.classList.toggle('is-active', Math.abs(Number(b.dataset.speed) - S.speed) < 0.001);
    });
    var run = q('#xcat-ae-run', modal);
    if (run) run.disabled = busy || !apiReady;
  }

  /* ------------------------------------------------------------ 事件 */
  function onClickBody (e) {
    if (!S) return;
    var chip = e.target.closest('.xcat-ae-chip');
    if (chip) { S.speed = Number(chip.dataset.speed); renderSpeed(); return; }
    if (e.target.closest('#xcat-ae-play')) { togglePlay(); return; }
    var tool = e.target.closest('.xcat-ae-tools button');
    if (tool && !tool.disabled) {
      ({ undo: undo, redo: redo, split: split, merge: merge, remove: removeSegment })[tool.dataset.act]();
      return;
    }
    if (S.mode !== 'clip') return;
    var seg = e.target.closest('.xcat-ae-segment');
    if (seg) {
      var i = Number(seg.dataset.index), c = clips()[i];
      if (!c) return;
      var rect = seg.getBoundingClientRect();
      var t = c.offset + c.length * clamp((e.clientX - rect.left) / rect.width, 0, 1);
      S.selected = i;
      seekAt(t);
      return;
    }
    if (e.target.closest('#xcat-ae-ruler')) {
      var rr = q('#xcat-ae-ruler', modal).getBoundingClientRect();
      seekAt((e.clientX - rr.left) / rr.width * timelineDuration());
    }
  }
  function onInputBody (e) {
    if (!S) return;
    if (e.target.id === 'xcat-ae-cursor') { seekAt(Number(e.target.value)); return; }
    if (e.target.id === 'xcat-ae-slider') { S.speed = Number(e.target.value); renderSpeed(); }
  }
  function onChangeBody (e) {
    if (!S) return;
    if (e.target.id === 'xcat-ae-number') {
      var v = Number(e.target.value);
      S.speed = finite(v) ? clamp(v, 0.1, 4) : 1;
      renderSpeed();
    }
  }
  function isTyping (el) {
    return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || '') || el.isContentEditable);
  }
  function onKey (e) {
    if (!S || !modal) return;
    var typing = isTyping(e.target);
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!busy) close();
      return;
    }
    /* 捕获阶段不能无差别 stopPropagation：那会连输入框自己的按键一起吞掉。
       只挡画布的 Delete（删选中节点）和剪辑快捷键，其余按键正常放行。 */
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!typing) e.stopPropagation();
      return;
    }
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !typing) {
      var k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault(); e.stopPropagation();
        if (S.mode === 'clip') { (k === 'y' || e.shiftKey) ? redo() : undo(); }
        return;
      }
    }
    if (S.mode !== 'clip' || typing) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation();
      seekAt(S.playhead + (e.key === 'ArrowRight' ? 0.1 : -0.1));
    } else if (e.key === ' ' || e.code === 'Space') {
      if (/^BUTTON$/.test(e.target.tagName)) return;
      e.preventDefault(); e.stopPropagation();
      togglePlay();
    }
  }
  /* 画布的 paste 捕获在 document 上；弹窗非输入区按 Ctrl+V 不该建文本节点 */
  function onPasteGuard (e) {
    if (!S || !modal || isTyping(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }
  /* xcat-new-node.js 在 document 捕获阶段监听 dblclick；window 捕获更早，
     模态期间一律吞掉，避免双击遮罩 / 弹窗内容触发画布缩放或新建菜单。 */
  function onDblGuard (e) {
    if (!S || !modal) return;
    e.preventDefault();
    e.stopPropagation();
  }

  /* ------------------------------------------------------------ 导出 */
  function flatSegments () {
    return S.groups.reduce(function (a, g) {
      return a.concat(g.map(function (r) { return { start: +r.start.toFixed(4), end: +r.end.toFixed(4) }; }));
    }, []);
  }
  /* 产物建节点（含避让、120ms 等待、失败回滚）已移到公共内核
     xcat-media-core.js 的 buildResultNodes()，视频节点四个功能共用。 */
  async function run () {
    if (busy || !S) return;
    if (!apiReady) { setStatus('后端接口未就绪，需重启 ComfyUI', true); applyApiReady(); return; }
    if (S.mode === 'clip' && !valid()) { setStatus('片段无效，请检查音频时长', true); return; }
    var payload = S.mode === 'clip'
      ? { ref: S.ref, action: 'clip', segments: flatSegments() }
      : { ref: S.ref, action: 'speed', speed: S.speed };
    busy = true;
    controller = new AbortController();
    var runBtn = q('#xcat-ae-run', modal);
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = '处理中…'; }
    setStatus('正在用 FFmpeg 处理音频…');
    try {
      if (!core) throw new Error('媒体编辑内核未加载，请刷新页面');
      /* 请求解析（含「后端未重启」提示）与产物建节点都走公共内核，
         视频节点的四个功能用的是同一份实现。 */
      var data = await core.request(API, payload, controller.signal, '音频');
      pause();
      await core.buildResultNodes([{
        filename: data.filename, name: data.name,
        subfolder: '', type: 'input', role: 'asset-audio'
      }], S.nodeId);
      close();
      toast('已在右侧生成新的音频节点');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      if (err && err.message && err.message.indexOf('接口未就绪') >= 0) {
        apiReady = false;
        if (probe) probe.invalidate();
        applyApiReady();
      }
      setStatus(err && err.message ? err.message : '处理失败', true);
      toast('音频处理失败：' + (err && err.message ? err.message : '未知错误'), true);
    } finally {
      busy = false;
      var b = q('#xcat-ae-run', modal);
      if (b) {
        b.disabled = !apiReady || (S && S.mode === 'clip' && !valid());
        b.textContent = S && S.mode === 'clip' ? '导出音频' : '生成变速音频';
      }
      controller = null;
    }
  }
  function close () {
    if (!modal) return;
    if (controller) { try { controller.abort(); } catch (e) {} }
    pause();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('paste', onPasteGuard, true);
    window.removeEventListener('dblclick', onDblGuard, true);
    modal.remove();
    modal = null;
    S = null;
    busy = false;
    controller = null;
  }

  /* ------------------------------------------------------------ 启动 */
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

  window.__xcatAudioEdit = {
    install: install,
    open: function (mode, id, item) { open(mode, id, item); },
    close: close,
    state: function () {
      return S ? {
        mode: S.mode, duration: S.duration, speed: S.speed,
        groups: S.groups, playhead: S.playhead, selected: S.selected,
        busy: busy, valid: S.mode === 'clip' ? valid() : true
      } : null;
    }
  };
})();
