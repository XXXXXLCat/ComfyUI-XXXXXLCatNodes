/* ==================================================================
   xcat-image-tools.js — 图片节点四个工具（2026-11-13）
   ------------------------------------------------------------------
   参考 E:/Toonflow/packages/nodeShared/src/ 的组件，按本包覆盖层架构
   落地（dist 无 node_modules、无 Vue 组件注册，全部是独立 iframe 里的原生
   DOM + Canvas）：

     裁剪      自研（参考上游 crop 的交互定位）  拖拽框选 + 8 手柄 +
                                  7 种比例锁定 + X/Y/宽/高数值联动 → 1 个 PNG 节点
     宫格切分  imageGridSplit.vue  2/3/4/5 预设 + 行列 1~10 自定义 +
                                  网格线实时预览 → N 个 PNG 图片节点
     镜像      imageMirror.vue     左右/上下翻转 + 顺/逆时针 90° + 180°
                                  五选一，悬停 CSS 预览 → 1 个 PNG 节点
     调整      imageAdjust.vue     11 个调色滑块（内核见
               + imageAdjust.ts    xcat-image-adjust-core.js），512px 实时
                                  预览 + 全分辨率导出 → 1 个 PNG 节点

   注意：上游自带的旧「裁剪 / 扩图 / 宫格」三个入口已在 bundle 里过滤掉，
   这里的「裁剪」是走本包内核重新实现的，与上游那个同名弹窗无关。

   四者的共同约定（与参考一致）：只搬像素，产物是**新节点**、原图保留、
   输出 PNG、节点名带操作后缀。产物落盘复用本包已有的
   POST /infinite_canvas/api/media（JSON dataURL → input/ 目录），因此
   **后端零改动、不需要重启 ComfyUI**；建节点走 xcat-media-core.js 的
   buildResultNodes()，与音频 / 视频工具共用同一套内核。
   ================================================================== */
(function () {
  'use strict';
  if (window.__xcatImageTools) return;
  var core = window.__xcatMediaCore;
  var adj = window.__xcatImageAdjustCore;
  if (!core || !adj) {
    console.warn('[xcat] xcat-media-core.js / xcat-image-adjust-core.js 未加载，图片工具不可用');
    return;
  }

  var UPLOAD = '/infinite_canvas/api/media';
  var q = core.q, qa = core.qa, esc = core.esc, toast = core.toast, clamp = core.clamp;
  var NODE_W = core.NODE_W, NODE_H = core.NODE_H, GAP_X = core.GAP_X, GAP_Y = core.GAP_Y;

  var modal = null, S = null, busy = false, controller = null, frame = 0;

  /* ------------------------------------------------------------ 通用骨架 */
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
  function onKey (e) {
    if (!modal) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (!busy || controller) close();
      return;
    }
    /* 裁剪：方向键微调选区位置，Shift 一次 10px；输入框聚焦时交给原生 */
    if (S && S.kind === 'crop' && S.ready &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) >= 0) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault(); e.stopPropagation();
      var step = e.shiftKey ? 10 : 1;
      S.rect.x = clamp(S.rect.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0),
        0, Math.max(0, S.natW - S.rect.w));
      S.rect.y = clamp(S.rect.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0),
        0, Math.max(0, S.natH - S.rect.h));
      paintCrop();
    }
  }
  function onDblGuard (e) {
    if (!modal) return;
    e.preventDefault(); e.stopPropagation();
  }
  function close () {
    if (controller) { try { controller.abort(); } catch (e) {} }
    cancelAnimationFrame(frame);
    if (modal) modal.remove();
    modal = null; S = null; busy = false; controller = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('dblclick', onDblGuard, true);
    window.removeEventListener('paste', onDblGuard, true);
    window.removeEventListener('resize', layoutCrop);
  }
  function shell (title, sub, bodyHtml, footHtml, widthCls) {
    if (modal) close();
    var host = q('#app') || document.body;
    modal = document.createElement('div');
    modal.className = 'xcat-ae-modal';
    modal.innerHTML = [
      '<div class="xcat-ae-backdrop"></div>',
      '<div class="xcat-ae-dialog xcat-im-dialog ', widthCls || '', '" role="dialog" aria-modal="true" aria-label="', esc(title), '">',
        '<div class="xcat-ae-head"><div>',
          '<div class="xcat-ae-title">', esc(title), '</div>',
          '<div class="xcat-ae-sub">', esc(sub), '</div>',
        '</div><button type="button" class="xcat-ae-x" id="xcat-im-x" title="关闭">×</button></div>',
        '<div class="xcat-ae-body xcat-im-body">', bodyHtml, '</div>',
        '<div class="xcat-ae-foot">',
          '<div class="xcat-ae-status" id="xcat-ae-status"></div>',
          footHtml,
        '</div>',
      '</div>'
    ].join('');
    host.appendChild(modal);
    isolate(modal);
    q('#xcat-im-x', modal).addEventListener('click', close);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('dblclick', onDblGuard, true);
    window.addEventListener('paste', onDblGuard, true);
    return modal;
  }
  function footButtons (cancelLabel, runLabel, runId) {
    return '<button type="button" class="xcat-ae-btn" id="xcat-im-cancel">' + esc(cancelLabel || '取消') + '</button>' +
      '<button type="button" class="xcat-ae-btn is-primary" id="' + runId + '">' + esc(runLabel) + '</button>';
  }
  function bindCancel () {
    var b = q('#xcat-im-cancel', modal);
    if (b) b.addEventListener('click', close);
  }

  /* ------------------------------------------------------------ 源图 / 上传 */
  function loadImage (url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        if (!img.naturalWidth || !img.naturalHeight) return reject(new Error('无法读取图片尺寸'));
        resolve(img);
      };
      img.onerror = function () { reject(new Error('图片加载失败')); };
      img.src = url;
    });
  }
  function canvasDataUrl (canvas) {
    return canvas.toDataURL('image/png');
  }
  function upload (name, dataUrl, signal) {
    return fetch(UPLOAD, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, data: dataUrl }),
      signal: signal || undefined
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data;
        try { data = JSON.parse(raw); }
        catch (e) { throw new Error('素材上传接口未就绪（HTTP ' + res.status + '）：请完全重启 ComfyUI 后重试'); }
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        if (!data || !data.filename) throw new Error('上传没有返回文件名');
        return data;
      });
    });
  }
  /* 失败时把已上传的孤儿 PNG 删掉（DELETE 是 fire-and-forget，不挡错误提示） */
  function cleanup (filenames) {
    filenames.forEach(function (name) {
      try { fetch(UPLOAD + '/' + encodeURIComponent(name), { method: 'DELETE' }); } catch (e) {}
    });
  }

  /* 当前视口放不下 N 个节点时缩小视图。上游 Vue Flow 会丢掉「视口外、
     没能完成初始化」的节点（见 xcat-media-core.js 的第 4 条坑），而
     buildResultNodes() 的 placeClear() 正是按 visibleRect() 找空位，所以
     先放大可见 flow 区域，再一次性建节点，10×10 也不会凭空消失。 */
  function ensureViewportFor (count, srcId) {
    var f = core.flow();
    if (!f || !f.viewport || !f.viewport.value || count <= 9) return;
    var src = core.nodeById(srcId);
    /* 可见区必须从「源节点左上角」起算，不能只框住产物区 —— 上游会丢掉
       视口外的节点，平移过头会把源节点本身清掉，连带打乱新节点的 id 分配。 */
    var startX = src ? src.position.x : 0;
    var startY = src ? src.position.y : 0;
    var side = Math.ceil(Math.sqrt(count));
    var needW = (side + 1) * (NODE_W + GAP_X) + 48;
    var needH = (side + 1) * (NODE_H + GAP_Y) + 48;
    var z = Math.min(
      Number(f.viewport.value.zoom) || 0.7,
      (window.innerWidth || 1280) / needW,
      (window.innerHeight || 800) / needH
    );
    z = Math.max(0.08, Math.min(0.7, z));
    var vp = { x: -(startX - 24) * z, y: -(startY - 24) * z, zoom: z };
    try {
      if (f.setViewport) f.setViewport(vp, { duration: 0 });
      else f.viewport.value = vp;
      /* setViewport 可能是异步动画；直接同步 ref，保证 placeClear 立刻看到 */
      if (f.viewport.value) f.viewport.value = vp;
    } catch (e) {
      try { f.viewport.value = vp; } catch (_) {}
    }
  }

  /* entries: [{name, dataUrl}]；逐张上传后一次建全部节点 */
  function commit (entries, ctx, doneText) {
    var signal = controller ? controller.signal : undefined;
    var made = [], results = [];
    var total = entries.length;
    ensureViewportFor(total, ctx.id);
    /* 逐张串行上传，避免一次发 100 个大 dataURL 把请求体撑爆；结果累积成
       files[] 再一次性交给 buildResultNodes（它要求数组，不是单个对象）。 */
    var chain = Promise.resolve();
    entries.forEach(function (entry, i) {
      chain = chain.then(function () {
        if (signal && signal.aborted) throw new Error('已取消');
        setStatus('正在保存产物 ' + (i + 1) + ' / ' + total + '…');
        return upload(entry.name, entry.dataUrl, signal).then(function (data) {
          made.push(data.filename);
          results.push({
            filename: data.filename,
            name: entry.name,
            subfolder: data.subfolder || '',
            type: data.type || 'input',
            role: 'asset-image'
          });
        });
      });
    });
    return chain.then(function () {
      if (signal && signal.aborted) throw new Error('已取消');
      setStatus('正在生成节点…');
      return core.buildResultNodes(results, ctx.id);
    }).then(function () {
      close();
      toast(doneText || ('已生成 ' + total + ' 个图片节点'));
    }).catch(function (err) {
      var aborted = (signal && signal.aborted) || (err && err.name === 'AbortError');
      cleanup(made);
      if (aborted) { if (modal) close(); return; }
      setStatus(err && err.message ? err.message : '处理失败', true);
    }).then(function () {
      busy = false; controller = null;
      var run = q('#xcat-im-run', modal);
      if (run) { run.disabled = false; run.textContent = S && S.runLabel ? S.runLabel : '应用'; }
    });
  }
  function begin () {
    busy = true;
    controller = new AbortController();
    var run = q('#xcat-im-run', modal);
    if (run) { run.disabled = true; run.textContent = '处理中…'; }
    var cancel = q('#xcat-im-cancel', modal);
    if (cancel) cancel.textContent = '取消处理';
  }
  function baseLabel (ctx) {
    return String((ctx.node && ctx.node.data && ctx.node.data.label) || '图片');
  }

  /* ------------------------------------------------------------ 宫格切分 */
  var GRID_PRESETS = [2, 3, 4, 5];
  function openGrid (ctx) {
    if (busy || modal) return;
    S = { ctx: ctx, kind: 'grid', rows: 3, cols: 3, size: { w: 0, h: 0 }, runLabel: '切分为图片节点' };
    var presets = GRID_PRESETS.map(function (n) {
      var cells = [];
      for (var i = 0; i < n * n; i++) cells.push('<i></i>');
      return '<button type="button" class="xcat-im-preset" data-grid="' + n + '" aria-pressed="false">' +
        '<span class="xcat-im-preset-icon" style="grid-template-columns:repeat(' + n + ',1fr)">' + cells.join('') + '</span>' +
        '<span>' + (n * n) + ' 宫格</span><small>' + n + ' × ' + n + '</small></button>';
    }).join('');
    var html = [
      '<div class="xcat-im-presets">', presets, '</div>',
      '<div class="xcat-im-grid-custom">',
        '<label><span>行数</span><input type="number" id="xcat-im-rows" min="1" max="10" step="1" value="3"></label>',
        '<span class="xcat-im-times">×</span>',
        '<label><span>列数</span><input type="number" id="xcat-im-cols" min="1" max="10" step="1" value="3"></label>',
      '</div>',
      '<div class="xcat-im-preview xcat-im-grid-preview">',
        '<div class="xcat-im-preview-inner">',
          '<img id="xcat-im-grid-img" src="', esc(ctx.item.url), '" alt="宫格切分预览">',
          '<div class="xcat-im-grid-lines" id="xcat-im-lines"></div>',
        '</div>',
      '</div>',
      '<div class="xcat-im-summary"><span id="xcat-im-count">共 9 张图片</span><span>从左到右，逐行切分</span></div>',
      '<p class="xcat-im-hint">按相邻整数边界切分，不能整除的尺寸也不会丢失或重复边缘像素。原图保留。</p>'
    ].join('');
    shell('宫格切分', '保留原图 · 最多 10 × 10', html, footButtons('取消', '切分为图片节点', 'xcat-im-run'));
    bindCancel();
    qa('.xcat-im-preset', modal).forEach(function (b) {
      b.addEventListener('click', function () { setGrid(+b.dataset.grid, +b.dataset.grid); });
    });
    ['#xcat-im-rows', '#xcat-im-cols'].forEach(function (sel) {
      var el = q(sel, modal);
      if (el) el.addEventListener('input', function () {
        setGrid(parseInt(q('#xcat-im-rows', modal).value, 10), parseInt(q('#xcat-im-cols', modal).value, 10));
      });
    });
    var img = q('#xcat-im-grid-img', modal);
    img.addEventListener('load', function () { S.size = { w: img.naturalWidth, h: img.naturalHeight }; paintGrid(); });
    img.addEventListener('error', function () { setStatus('预览图加载失败', true); });
    q('#xcat-im-run', modal).addEventListener('click', function () { runGrid(ctx); });
    paintGrid();
  }
  function validGrid () {
    return S && S.kind === 'grid' && Number.isInteger(S.rows) && Number.isInteger(S.cols) &&
      S.rows >= 1 && S.rows <= 10 && S.cols >= 1 && S.cols <= 10 && S.rows * S.cols > 1;
  }
  function setGrid (rows, cols) {
    if (!S || S.kind !== 'grid') return;
    S.rows = clamp(isFinite(rows) ? rows : 3, 1, 10);
    S.cols = clamp(isFinite(cols) ? cols : 3, 1, 10);
    var r = q('#xcat-im-rows', modal), c = q('#xcat-im-cols', modal);
    if (r && document.activeElement !== r) r.value = S.rows;
    if (c && document.activeElement !== c) c.value = S.cols;
    qa('.xcat-im-preset', modal).forEach(function (b) {
      var on = +b.dataset.grid === S.rows && +b.dataset.grid === S.cols;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    paintGrid();
  }
  function paintGrid () {
    if (!S || S.kind !== 'grid' || !modal) return;
    var n = S.rows * S.cols;
    var count = q('#xcat-im-count', modal);
    if (count) count.textContent = validGrid() ? ('共 ' + n + ' 张图片') : '请设置有效行列数';
    var lines = q('#xcat-im-lines', modal);
    if (lines) {
      if (!validGrid()) { lines.innerHTML = ''; lines.style.display = 'none'; }
      else {
        var cells = [];
        for (var i = 0; i < n; i++) cells.push('<span><small>' + (i + 1) + '</small></span>');
        lines.innerHTML = cells.join('');
        lines.style.display = '';
        lines.style.gridTemplateColumns = 'repeat(' + S.cols + ', 1fr)';
        lines.style.gridTemplateRows = 'repeat(' + S.rows + ', 1fr)';
      }
    }
    var run = q('#xcat-im-run', modal);
    if (run && !busy) run.disabled = !validGrid() || !S.size.w || S.size.w < S.cols || S.size.h < S.rows;
  }
  function runGrid (ctx) {
    if (!validGrid() || busy) return;
    var rows = S.rows, cols = S.cols, total = rows * cols;
    begin();
    loadImage(ctx.item.url).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      if (w < cols || h < rows) throw new Error('图片尺寸小于切分行列数');
      var entries = [];
      var canvas = document.createElement('canvas');
      var context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      for (var row = 0; row < rows; row++) {
        for (var col = 0; col < cols; col++) {
          var left = Math.floor(col * w / cols);
          var top = Math.floor(row * h / rows);
          canvas.width = Math.floor((col + 1) * w / cols) - left;
          canvas.height = Math.floor((row + 1) * h / rows) - top;
          context.drawImage(img, left, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
          entries.push({
            name: baseLabel(ctx) + ' · ' + (row + 1) + '-' + (col + 1),
            dataUrl: canvasDataUrl(canvas)
          });
        }
      }
      canvas.width = canvas.height = 0;
      return commit(entries, ctx, '已切分为 ' + total + ' 个图片节点');
    }).catch(function (err) {
      setStatus(err && err.message ? err.message : '宫格切分失败', true);
      busy = false; controller = null;
      var run = q('#xcat-im-run', modal);
      if (run) { run.disabled = false; run.textContent = '切分为图片节点'; }
    });
  }

  /* ------------------------------------------------------------ 镜像 */
  var MIRRORS = [
    { key: 'flipX', label: '左右翻转', hint: '水平镜像', css: 'scaleX(-1)', swap: false },
    { key: 'flipY', label: '上下翻转', hint: '垂直镜像', css: 'scaleY(-1)', swap: false },
    { key: 'rotate90', label: '顺时针 90°', hint: '向右旋转', css: 'rotate(90deg)', swap: true },
    { key: 'rotate270', label: '逆时针 90°', hint: '向左旋转', css: 'rotate(-90deg)', swap: true },
    { key: 'rotate180', label: '180°', hint: '旋转半圈', css: 'rotate(180deg)', swap: false }
  ];
  function openMirror (ctx) {
    if (busy || modal) return;
    S = { ctx: ctx, kind: 'mirror', runLabel: '' };
    var buttons = MIRRORS.map(function (m, i) {
      return '<button type="button" class="xcat-im-mirror-btn' + (i === 4 ? ' is-wide' : '') + '" data-mirror="' + m.key + '">' +
        '<span class="xcat-im-mirror-icon">' + mirrorIcon(m.key) + '</span>' +
        '<span class="xcat-im-mirror-label">' + esc(m.label) + '</span>' +
        '<small>' + esc(m.hint) + '</small></button>';
    }).join('');
    var html = [
      '<div class="xcat-im-preview xcat-im-mirror-preview">',
        '<img id="xcat-im-mirror-img" src="', esc(ctx.item.url), '" alt="镜像效果预览">',
      '</div>',
      '<div class="xcat-im-mirror-actions">', buttons, '</div>',
      '<p class="xcat-im-hint">悬停可预览效果，点击即生成新图片节点，原图保留；90° 旋转会交换宽高。</p>'
    ].join('');
    shell('镜像 / 旋转', '保留原图 · 点击即生成', html,
      '<button type="button" class="xcat-ae-btn" id="xcat-im-cancel">关闭</button>');
    bindCancel();
    var preview = q('#xcat-im-mirror-img', modal);
    qa('.xcat-im-mirror-btn', modal).forEach(function (b) {
      var m = MIRRORS.filter(function (x) { return x.key === b.dataset.mirror; })[0];
      function show () { preview.style.transform = m.css; }
      function hide () { preview.style.transform = ''; }
      b.addEventListener('mouseenter', show);
      b.addEventListener('mouseleave', hide);
      b.addEventListener('focus', show);
      b.addEventListener('blur', hide);
      b.addEventListener('click', function () { runMirror(ctx, m); });
    });
  }
  /* 五个操作用内联 SVG 表示（画布是独立包，用不了参考的 Tabler 图标组件）。
     stroke=currentColor，暗/亮主题自动跟随。 */
  function mirrorIcon (key) {
    var paths = {
      flipX: '<path d="M12 3v18M8 7 3 12l5 5M16 7l5 5-5 5"/>',
      flipY: '<path d="M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5"/>',
      rotate90: '<path d="M12 3a9 9 0 1 1-9 9"/><path d="M12 3l-4 4M12 3l4 4"/>',
      rotate270: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 3l-4 4M12 3l4 4"/>',
      rotate180: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'
    };
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[key] || '') + '</svg>';
  }
  function runMirror (ctx, m) {
    if (busy) return;
    begin();
    setStatus('正在处理…');
    loadImage(ctx.item.url).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = m.swap ? h : w;
      canvas.height = m.swap ? w : h;
      var context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      context.save();
      if (m.key === 'flipX') { context.translate(w, 0); context.scale(-1, 1); }
      else if (m.key === 'flipY') { context.translate(0, h); context.scale(1, -1); }
      else if (m.key === 'rotate90') { context.translate(h, 0); context.rotate(Math.PI / 2); }
      else if (m.key === 'rotate270') { context.translate(0, w); context.rotate(-Math.PI / 2); }
      else { context.translate(w, h); context.scale(-1, -1); }
      context.drawImage(img, 0, 0);
      context.restore();
      var dataUrl = canvasDataUrl(canvas);
      canvas.width = canvas.height = 0;
      var suffix = m.label.replace(/\s/g, '');
      return commit([{ name: baseLabel(ctx) + ' · ' + suffix, dataUrl: dataUrl }], ctx,
        '已生成「' + suffix + '」图片节点');
    }).catch(function (err) {
      setStatus(err && err.message ? err.message : '镜像处理失败', true);
      busy = false; controller = null;
    });
  }

  /* ------------------------------------------------------------ 调整 */
  function fmtValue (v) {
    if (v === 0) return '0';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(2);
  }
  function openAdjust (ctx) {
    if (busy || modal) return;
    S = {
      ctx: ctx, kind: 'adjust', params: adj.defaultParams(), runLabel: '应用',
      base: null, src: null, pw: 0, ph: 0, ready: false
    };
    var rows = adj.ADJUST_FIELDS.map(function (f) {
      return '<div class="xcat-im-adjust-row">' +
        '<span class="xcat-im-adjust-label">' + esc(f.label) + '</span>' +
        '<input type="range" class="xcat-im-slider" data-key="' + f.key + '" min="' + f.min + '" max="' + f.max + '" step="0.01" value="0" aria-label="' + esc(f.label) + '">' +
        '<span class="xcat-im-adjust-value" data-value="' + f.key + '">0</span>' +
      '</div>';
    }).join('');
    var html = [
      '<div class="xcat-im-preview xcat-im-adjust-preview">',
        '<canvas id="xcat-im-adjust-canvas" aria-label="调整效果预览"></canvas>',
        '<span class="xcat-im-preview-badge" id="xcat-im-badge" hidden>预览中…</span>',
      '</div>',
      '<div class="xcat-im-adjust-list">', rows, '</div>'
    ].join('');
    shell('调整', '拖到满意后应用，会生成新节点、原图保留', html,
      '<button type="button" class="xcat-ae-btn" id="xcat-im-reset">重置</button>' +
      footButtons('取消', '应用', 'xcat-im-run'), 'is-adjust');
    bindCancel();
    q('#xcat-im-reset', modal).addEventListener('click', function () {
      S.params = adj.defaultParams();
      qa('.xcat-im-slider', modal).forEach(function (el) { el.value = '0'; });
      paintValues();
      schedulePreview();
    });
    qa('.xcat-im-slider', modal).forEach(function (el) {
      el.addEventListener('input', function () {
        S.params[el.dataset.key] = parseFloat(el.value) || 0;
        paintValues();
        schedulePreview();
      });
    });
    q('#xcat-im-run', modal).addEventListener('click', function () { runAdjust(ctx); });
    paintValues();
    schedulePreview();
  }
  function paintValues () {
    if (!S || S.kind !== 'adjust' || !modal) return;
    qa('[data-value]', modal).forEach(function (el) {
      var v = S.params[el.dataset.value] || 0;
      el.textContent = fmtValue(v);
      el.classList.toggle('is-changed', v !== 0);
    });
    var run = q('#xcat-im-run', modal);
    if (run && !busy) run.disabled = adj.isNoop(S.params);
  }
  /* 预览走 512px 下采样副本，每次都从原始副本重算，避免多次叠加 */
  function ensureBase () {
    if (S.ready) return Promise.resolve();
    return loadImage(S.ctx.item.url).then(function (img) {
      S.src = img;
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, 512 / Math.max(w, h));
      S.pw = Math.max(1, Math.round(w * scale));
      S.ph = Math.max(1, Math.round(h * scale));
      var c = document.createElement('canvas');
      c.width = S.pw; c.height = S.ph;
      var cx = c.getContext('2d');
      if (!cx) throw new Error('无法创建图片画布');
      cx.drawImage(img, 0, 0, S.pw, S.ph);
      S.base = cx.getImageData(0, 0, S.pw, S.ph);
      S.ready = true;
    });
  }
  function paintPreview () {
    if (!modal || !S || S.kind !== 'adjust' || !S.base) return;
    var canvas = q('#xcat-im-adjust-canvas', modal);
    if (!canvas) return;
    canvas.width = S.pw; canvas.height = S.ph;
    var cx = canvas.getContext('2d');
    if (!cx) return;
    var image = new ImageData(new Uint8ClampedArray(S.base.data), S.pw, S.ph);
    adj.applyImageAdjust(image, S.params);
    cx.putImageData(image, 0, 0);
  }
  function schedulePreview () {
    if (!modal || !S || S.kind !== 'adjust') return;
    var badge = q('#xcat-im-badge', modal);
    if (badge) badge.hidden = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () {
      ensureBase().then(function () {
        if (modal && S && S.kind === 'adjust') paintPreview();
      }).catch(function (err) {
        if (modal) setStatus((err && err.message) || '预览失败', true);
      }).then(function () {
        if (badge) badge.hidden = true;
      });
    });
  }
  function runAdjust (ctx) {
    if (busy || adj.isNoop(S.params)) return;
    var params = Object.assign({}, S.params);
    begin();
    setStatus('正在按原图分辨率导出…');
    ensureBase().then(function () {
      var w = S.src.naturalWidth, h = S.src.naturalHeight;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var cx = canvas.getContext('2d', { willReadFrequently: true });
      if (!cx) throw new Error('无法创建图片画布');
      cx.drawImage(S.src, 0, 0);
      var image = cx.getImageData(0, 0, w, h);
      adj.applyImageAdjust(image, params);   /* 清晰度须在原分辨率上做才准 */
      cx.putImageData(image, 0, 0);
      var dataUrl = canvasDataUrl(canvas);
      canvas.width = canvas.height = 0;
      /* 节点名带摘要，历史里能一眼看出调了什么（照参考取前三项） */
      var summary = adj.ADJUST_FIELDS.filter(function (f) { return params[f.key] !== 0; })
        .map(function (f) { return f.label; }).slice(0, 3).join('·');
      var suffix = summary ? ('调整 ' + summary) : '调整';
      return commit([{ name: baseLabel(ctx) + ' · ' + suffix, dataUrl: dataUrl }], ctx,
        '已生成「' + suffix + '」图片节点');
    }).catch(function (err) {
      setStatus(err && err.message ? err.message : '调整失败', true);
      busy = false; controller = null;
      var run = q('#xcat-im-run', modal);
      if (run) { run.disabled = false; run.textContent = '应用'; }
    });
  }

  /* ------------------------------------------------------------ 裁剪 */
  /* 选区一律用「原图像素」存储，渲染时乘 S.scale 换算到预览尺寸；导出直接
     把 rect 交给 drawImage 的 9 参数形式，避免预览缩放带来的取整误差。
     预览框尺寸由 JS 显式算出（父级 grid + max-height:100% 会退化，见
     memory 里的「CSS 等比缩放坑」），图片用 position:absolute + inset:0。 */
  /* 预设按「方 → 横 / 竖成对 → 宽 / 竖成对」排，避免只给横版漏掉镜像比例。
     自定义走 customRatio（宽 ÷ 高），任何比例都能锁定，不必再逐个补预设。 */
  var CROP_RATIOS = [
    { key: 'free', label: '自由', value: null },
    { key: 'origin', label: '原图', value: 0 },   /* 0 = 动态取原图宽高比 */
    { key: '1:1', label: '1:1', value: 1 },
    { key: '4:3', label: '4:3', value: 4 / 3 },
    { key: '3:4', label: '3:4', value: 3 / 4 },
    { key: '3:2', label: '3:2', value: 3 / 2 },
    { key: '2:3', label: '2:3', value: 2 / 3 },
    { key: '16:9', label: '16:9', value: 16 / 9 },
    { key: '9:16', label: '9:16', value: 9 / 16 },
    { key: '21:9', label: '21:9', value: 21 / 9 },
    { key: '9:21', label: '9:21', value: 9 / 21 },
    { key: 'custom', label: '自定义', value: -1 }  /* -1 = 读 S.customRatio */
  ];
  function ratioValue () {
    if (!S || S.kind !== 'crop') return null;
    if (S.ratioKey === 'free') return null;
    if (S.ratioKey === 'origin') return S.natW / S.natH;
    if (S.ratioKey === 'custom') return S.customRatio > 0 ? S.customRatio : null;
    return S.ratio;
  }
  function openCrop (ctx) {
    if (busy || modal) return;
    S = {
      ctx: ctx, kind: 'crop', runLabel: '裁剪并生成节点',
      natW: 0, natH: 0, dispW: 0, dispH: 0, scale: 1,
      rect: { x: 0, y: 0, w: 0, h: 0 }, ratioKey: 'free', ratio: 1,
      customRatio: 5 / 4, drag: null, ready: false
    };
    var ratios = CROP_RATIOS.map(function (r) {
      return '<button type="button" class="xcat-im-ratio' + (r.key === 'free' ? ' is-active' : '') +
        '" data-ratio="' + r.key + '" aria-pressed="' + (r.key === 'free') + '">' + esc(r.label) + '</button>';
    }).join('');
    var handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(function (d) {
      return '<span class="xcat-im-crop-handle" data-dir="' + d + '"></span>';
    }).join('');
    var fields = [['x', 'X'], ['y', 'Y'], ['w', '宽'], ['h', '高']].map(function (f) {
      return '<label><span>' + f[1] + '</span><input type="number" id="xcat-im-crop-' + f[0] +
        '" min="0" step="1" value="0"></label>';
    }).join('');
    var html = [
      '<div class="xcat-im-crop-preview">',
        '<div class="xcat-im-crop-stage" id="xcat-im-crop-stage">',
          '<div class="xcat-im-crop-frame" id="xcat-im-crop-frame">',
            '<img id="xcat-im-crop-img" src="', esc(ctx.item.url), '" alt="裁剪预览">',
            '<div class="xcat-im-crop-box" id="xcat-im-crop-box">',
              '<i class="xcat-im-crop-third t-v1"></i><i class="xcat-im-crop-third t-v2"></i>',
              '<i class="xcat-im-crop-third t-h1"></i><i class="xcat-im-crop-third t-h2"></i>',
              handles,
            '</div>',
          '</div>',
        '</div>',
      '</div>',
      '<div class="xcat-im-crop-ratios">', ratios, '</div>',
      '<div class="xcat-im-crop-custom" id="xcat-im-crop-custom" hidden>',
        '<span>自定义宽高比</span>',
        '<input type="number" id="xcat-im-crop-rw" min="1" max="9999" step="1" value="5" aria-label="自定义比例宽">',
        '<b>:</b>',
        '<input type="number" id="xcat-im-crop-rh" min="1" max="9999" step="1" value="4" aria-label="自定义比例高">',
        '<small id="xcat-im-crop-rinfo">5 : 4 · 1.250</small>',
      '</div>',
      '<div class="xcat-im-crop-fields">', fields, '</div>',
      '<div class="xcat-im-summary"><span id="xcat-im-crop-size">读取图片中…</span><span>原图保留</span></div>',
      '<p class="xcat-im-hint">在图上拖拽框选，拖四角或四边可调整，选框内可拖动；也可直接填 X / Y / 宽 / 高。方向键微调选区（Shift 加速），按 Esc 关闭。</p>'
    ].join('');
    shell('裁剪', '拖拽框选 · 可锁定比例 · 生成新图片节点', html,
      '<button type="button" class="xcat-ae-btn" id="xcat-im-crop-all">全选</button>' +
      footButtons('取消', '裁剪并生成节点', 'xcat-im-run'), 'is-crop');
    bindCancel();
    q('#xcat-im-crop-all', modal).addEventListener('click', selectAllCrop);
    qa('.xcat-im-ratio', modal).forEach(function (b) {
      b.addEventListener('click', function () { setCropRatio(b.dataset.ratio); });
    });
    ['#xcat-im-crop-rw', '#xcat-im-crop-rh'].forEach(function (sel) {
      var el = q(sel, modal);
      if (el) el.addEventListener('input', updateCustomRatio);
    });
    ['x', 'y', 'w', 'h'].forEach(function (k) {
      var el = q('#xcat-im-crop-' + k, modal);
      if (el) el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        if (isFinite(v)) setCropField(k, v);
      });
    });
    var frame = q('#xcat-im-crop-frame', modal);
    frame.addEventListener('pointerdown', cropDown);
    frame.addEventListener('pointermove', cropMove);
    frame.addEventListener('pointerup', cropUp);
    frame.addEventListener('pointercancel', cropUp);
    var run = q('#xcat-im-run', modal);
    /* 图片就绪前禁用「应用」。必须放在 init() 之前 —— 命中缓存时
       img.complete 为 true，init() 会同步跑完 paintCrop() 把按钮启用，
       若这行留在后面就会把它重新压回 disabled。 */
    if (run) run.disabled = true;
    var img = q('#xcat-im-crop-img', modal);
    function init () {
      if (!S || S.kind !== 'crop' || S.ready || !modal) return;
      S.natW = img.naturalWidth; S.natH = img.naturalHeight;
      if (!S.natW || !S.natH) { setStatus('无法读取图片尺寸', true); return; }
      S.ready = true;
      /* 初始给一个居中 80% 的选区，打开即可直接应用，也能立刻拖新框 */
      S.rect = {
        x: Math.round(S.natW * 0.1), y: Math.round(S.natH * 0.1),
        w: Math.round(S.natW * 0.8), h: Math.round(S.natH * 0.8)
      };
      layoutCrop();
    }
    img.addEventListener('load', init);
    img.addEventListener('error', function () { setStatus('预览图加载失败', true); });
    if (img.complete && img.naturalWidth) init();
    window.addEventListener('resize', layoutCrop);
    run.addEventListener('click', function () { runCrop(ctx); });
  }
  /* 舞台固定高，frame 尺寸显式算出；图片绝对定位铺满 frame，坐标系才精确 */
  function layoutCrop () {
    if (!S || S.kind !== 'crop' || !modal || !S.ready) return;
    var stage = q('#xcat-im-crop-stage', modal), frame = q('#xcat-im-crop-frame', modal);
    if (!stage || !frame) return;
    var availW = Math.max(40, stage.clientWidth - 16);
    var availH = Math.max(40, stage.clientHeight - 16);
    var scale = Math.min(availW / S.natW, availH / S.natH);
    if (!isFinite(scale) || scale <= 0) return;
    S.scale = scale;
    S.dispW = Math.max(1, Math.round(S.natW * scale));
    S.dispH = Math.max(1, Math.round(S.natH * scale));
    frame.style.width = S.dispW + 'px';
    frame.style.height = S.dispH + 'px';
    paintCrop();
  }
  function cropRectValid () {
    return !!(S && S.ready && S.rect.w >= 1 && S.rect.h >= 1 &&
      S.rect.x >= 0 && S.rect.y >= 0 &&
      S.rect.x + S.rect.w <= S.natW + 0.6 &&
      S.rect.y + S.rect.h <= S.natH + 0.6);
  }
  function paintCrop () {
    if (!S || S.kind !== 'crop' || !modal) return;
    var c = S.rect, s = S.scale;
    var box = q('#xcat-im-crop-box', modal);
    if (box) {
      box.style.left = (c.x * s) + 'px';
      box.style.top = (c.y * s) + 'px';
      box.style.width = Math.max(1, c.w * s) + 'px';
      box.style.height = Math.max(1, c.h * s) + 'px';
    }
    ['x', 'y', 'w', 'h'].forEach(function (k) {
      var el = q('#xcat-im-crop-' + k, modal);
      if (el && document.activeElement !== el) el.value = Math.round(c[k]);
    });
    var sum = q('#xcat-im-crop-size', modal);
    if (sum) sum.textContent = S.ready
      ? ('输出 ' + Math.round(c.w) + ' × ' + Math.round(c.h) + ' 像素 · 原图 ' + S.natW + ' × ' + S.natH)
      : '读取图片中…';
    var run = q('#xcat-im-run', modal);
    if (run && !busy) run.disabled = !cropRectValid();
  }
  function cropPoint (e) {
    var frame = q('#xcat-im-crop-frame', modal);
    var b = frame.getBoundingClientRect();
    return {
      x: clamp((e.clientX - b.left) / S.scale, 0, S.natW),
      y: clamp((e.clientY - b.top) / S.scale, 0, S.natH)
    };
  }
  function cropDown (e) {
    if (!S || S.kind !== 'crop' || !S.ready || busy || e.button !== 0) return;
    var p = cropPoint(e), c = S.rect;
    var dir = (e.target && e.target.dataset && e.target.dataset.dir) || '';
    try { q('#xcat-im-crop-frame', modal).setPointerCapture(e.pointerId); } catch (err) {}
    var inside = p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
    S.drag = {
      mode: dir ? 'resize' : (inside ? 'move' : 'new'),
      dir: dir, start: p, anchor: p,
      rect: { x: c.x, y: c.y, w: c.w, h: c.h }
    };
    if (S.drag.mode === 'new') { S.rect = { x: p.x, y: p.y, w: 0, h: 0 }; paintCrop(); }
    e.preventDefault();
  }
  /* 以拖拽方向的「对边 / 对角」为固定点，锁比例时按宽度反推高度，再按
     到画布边界的可用空间统一收缩 —— 8 个手柄与比例锁定共用一套算法。 */
  function cropResize (dir, p, a, r) {
    var W = S.natW, H = S.natH;
    var hasW = dir.indexOf('w') >= 0, hasE = dir.indexOf('e') >= 0;
    var hasN = dir.indexOf('n') >= 0, hasS = dir.indexOf('s') >= 0;
    var dx = hasW ? -1 : (hasE ? 1 : 0);
    var dy = hasN ? -1 : (hasS ? 1 : 0);
    var x0 = a.x, y0 = a.y, x1 = a.x + a.w, y1 = a.y + a.h;
    var fx = hasW ? x1 : (hasE ? x0 : (x0 + x1) / 2);
    var fy = hasN ? y1 : (hasS ? y0 : (y0 + y1) / 2);
    var w = (hasW || hasE) ? Math.abs(p.x - fx) : a.w;
    var h = (hasN || hasS) ? Math.abs(p.y - fy) : a.h;
    if (r) { w = Math.max(w, h * r); h = w / r; }
    var availW = dx > 0 ? W - fx : (dx < 0 ? fx : Math.min(fx, W - fx) * 2);
    var availH = dy > 0 ? H - fy : (dy < 0 ? fy : Math.min(fy, H - fy) * 2);
    if (r) { var lim = Math.min(availW, availH * r); w = Math.min(w, lim); h = w / r; }
    else { w = Math.min(w, availW); h = Math.min(h, availH); }
    w = Math.max(1, Math.min(w, W));
    h = Math.max(1, Math.min(h, H));
    var x = dx > 0 ? fx : (dx < 0 ? fx - w : fx - w / 2);
    var y = dy > 0 ? fy : (dy < 0 ? fy - h : fy - h / 2);
    return {
      x: clamp(x, 0, Math.max(0, W - w)),
      y: clamp(y, 0, Math.max(0, H - h)),
      w: w, h: h
    };
  }
  function cropMove (e) {
    if (!S || S.kind !== 'crop' || !S.drag) return;
    var d = S.drag, p = cropPoint(e), a = d.rect;
    var W = S.natW, H = S.natH, r = ratioValue();
    if (d.mode === 'move') {
      S.rect = {
        x: clamp(a.x + (p.x - d.start.x), 0, Math.max(0, W - a.w)),
        y: clamp(a.y + (p.y - d.start.y), 0, Math.max(0, H - a.h)),
        w: a.w, h: a.h
      };
    } else if (d.mode === 'new') {
      var dirX = p.x >= d.anchor.x ? 1 : -1, dirY = p.y >= d.anchor.y ? 1 : -1;
      var w = Math.abs(p.x - d.anchor.x), h = Math.abs(p.y - d.anchor.y);
      if (r) { w = Math.max(w, h * r); h = w / r; }
      var maxW = dirX > 0 ? W - d.anchor.x : d.anchor.x;
      var maxH = dirY > 0 ? H - d.anchor.y : d.anchor.y;
      if (r) { var lim = Math.min(maxW, maxH * r); w = Math.min(w, lim); h = w / r; }
      else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
      S.rect = {
        x: dirX > 0 ? d.anchor.x : d.anchor.x - w,
        y: dirY > 0 ? d.anchor.y : d.anchor.y - h,
        w: w, h: h
      };
    } else {
      S.rect = cropResize(d.dir, p, a, r);
    }
    paintCrop();
    e.preventDefault();
  }
  function cropUp (e) {
    if (!S || S.kind !== 'crop' || !S.drag) return;
    try { q('#xcat-im-crop-frame', modal).releasePointerCapture(e.pointerId); } catch (err) {}
    S.drag = null;
    paintCrop();
  }
  /* 自定义比例：两个整数输入（宽 : 高）→ S.customRatio。选中「自定义」时
     边输入边重算选区；非法值（0 / 空 / 非数）退回自由比例并给出提示。 */
  function updateCustomRatio () {
    if (!S || S.kind !== 'crop' || !modal) return;
    var rw = q('#xcat-im-crop-rw', modal), rh = q('#xcat-im-crop-rh', modal);
    var info = q('#xcat-im-crop-rinfo', modal);
    var w = parseFloat(rw && rw.value), h = parseFloat(rh && rh.value);
    if (!(w > 0 && h > 0) || !isFinite(w) || !isFinite(h)) {
      S.customRatio = 0;
      if (info) info.textContent = '请输入大于 0 的宽高';
      if (S.ratioKey === 'custom') paintCrop();
      return;
    }
    S.customRatio = w / h;
    if (info) info.textContent = w + ' : ' + h + ' · ' + (w / h).toFixed(3);
    if (S.ratioKey === 'custom') setCropRatio('custom');
  }
  function setCropRatio (key) {
    if (!S || S.kind !== 'crop' || !S.ready) return;
    var item = CROP_RATIOS.filter(function (x) { return x.key === key; })[0];
    if (!item) return;
    S.ratioKey = key;
    if (item.value > 0) S.ratio = item.value;
    qa('.xcat-im-ratio', modal).forEach(function (b) {
      var on = b.dataset.ratio === key;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    var custom = q('#xcat-im-crop-custom', modal);
    if (custom) custom.hidden = key !== 'custom';
    var r = ratioValue();
    if (!r || !modal) return paintCrop();
    var W = S.natW, H = S.natH, c = S.rect;
    var cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    var maxW = Math.min(cx, W - cx) * 2, maxH = Math.min(cy, H - cy) * 2;
    var w = Math.max(1, Math.min(Math.max(c.w, c.h * r), maxW, maxH * r));
    var h = w / r;
    S.rect = {
      x: clamp(cx - w / 2, 0, Math.max(0, W - w)),
      y: clamp(cy - h / 2, 0, Math.max(0, H - h)),
      w: w, h: h
    };
    paintCrop();
  }
  function selectAllCrop () {
    if (!S || S.kind !== 'crop' || !S.ready) return;
    var W = S.natW, H = S.natH, r = ratioValue();
    if (!r) S.rect = { x: 0, y: 0, w: W, h: H };
    else {
      var w = Math.min(W, H * r), h = w / r;
      S.rect = { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h };
    }
    paintCrop();
  }
  function setCropField (key, v) {
    if (!S || S.kind !== 'crop' || !S.ready) return;
    var W = S.natW, H = S.natH, r = ratioValue();
    var c = { x: S.rect.x, y: S.rect.y, w: S.rect.w, h: S.rect.h };
    if (key === 'w' || key === 'h') {
      var w = key === 'w' ? v : c.w, h = key === 'h' ? v : c.h;
      if (r) { if (key === 'w') h = w / r; else w = h * r; }
      w = clamp(w, 1, Math.max(1, W - c.x));
      h = clamp(h, 1, Math.max(1, H - c.y));
      if (r) {
        var lim = Math.min(W - c.x, (H - c.y) * r);
        w = Math.min(w, Math.max(1, lim)); h = w / r;
      }
      c.w = w; c.h = h;
    } else if (key === 'x') c.x = clamp(v, 0, Math.max(0, W - c.w));
    else c.y = clamp(v, 0, Math.max(0, H - c.h));
    S.rect = c;
    paintCrop();
  }
  function runCrop (ctx) {
    if (busy || !S || S.kind !== 'crop' || !cropRectValid()) return;
    var c = S.rect, W = Math.round(S.natW), H = Math.round(S.natH);
    var sx = clamp(Math.round(c.x), 0, W - 1);
    var sy = clamp(Math.round(c.y), 0, H - 1);
    var sw = clamp(Math.round(c.w), 1, W - sx);
    var sh = clamp(Math.round(c.h), 1, H - sy);
    begin();
    setStatus('正在按原图分辨率裁切…');
    loadImage(ctx.item.url).then(function (img) {
      var canvas = document.createElement('canvas');
      canvas.width = sw; canvas.height = sh;
      var cx = canvas.getContext('2d');
      if (!cx) throw new Error('无法创建图片画布');
      cx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      var dataUrl = canvasDataUrl(canvas);
      canvas.width = canvas.height = 0;
      var suffix = '裁剪 ' + sw + '×' + sh;
      return commit([{ name: baseLabel(ctx) + ' · ' + suffix, dataUrl: dataUrl }], ctx,
        '已生成「' + suffix + '」图片节点');
    }).catch(function (err) {
      setStatus(err && err.message ? err.message : '裁剪失败', true);
      busy = false; controller = null;
      var run = q('#xcat-im-run', modal);
      if (run) { run.disabled = false; run.textContent = '裁剪并生成节点'; }
    });
  }

  /* ------------------------------------------------------------ 按钮注入 */
  var DEFS = [
    { cls: 'xcat-im-crop', label: '裁剪', open: function (ctx) { openCrop(ctx); } },
    { cls: 'xcat-im-grid', label: '宫格切分', open: function (ctx) { openGrid(ctx); } },
    { cls: 'xcat-im-mirror', label: '镜像', open: function (ctx) { openMirror(ctx); } },
    { cls: 'xcat-im-adjust', label: '调整', open: function (ctx) { openAdjust(ctx); } }
  ];
  function install () {
    if (busy) return;                 /* 处理中别让 Vue 重建按钮打断 */
    core.installButtons('#app .demo-node .node-actions', DEFS, 'image');
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

  window.__xcatImageTools = {
    install: install,
    close: close,
    state: function () {
      if (!S) return null;
      return {
        kind: S.kind,
        rows: S.rows, cols: S.cols, size: S.size,
        params: S.kind === 'adjust' ? Object.assign({}, S.params) : null,
        rect: S.kind === 'crop' ? Object.assign({}, S.rect) : null,
        natW: S.kind === 'crop' ? S.natW : null,
        natH: S.kind === 'crop' ? S.natH : null,
        scale: S.kind === 'crop' ? S.scale : null,
        ratioKey: S.kind === 'crop' ? S.ratioKey : null,
        ratio: S.kind === 'crop' ? ratioValue() : null,
        customRatio: S.kind === 'crop' ? S.customRatio : null,
        ready: S.kind === 'crop' ? S.ready : null,
        valid: S.kind === 'crop' ? cropRectValid() : null
      };
    },
    openCrop: openCrop,
    openGrid: openGrid,
    openMirror: openMirror,
    openAdjust: openAdjust,
    setGrid: setGrid,
    setCropRatio: setCropRatio,
    updateCustomRatio: updateCustomRatio,
    CROP_RATIOS: CROP_RATIOS,
    selectAllCrop: selectAllCrop,
    setCropField: setCropField,
    runCrop: runCrop,
    runMirror: runMirror
  };
})();
