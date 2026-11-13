/*
 * xcat-monitor.js — 画布顶部系统状态条（2026-11-13）
 * ------------------------------------------------------------------
 * 把 ComfyUI 菜单栏上的那一整套状态条原样搬进 Infinite Canvas：
 *
 *   RAM Cleanup | VRAM Cleanup | CPU | RAM | GPU | VRAM | TEMP
 *
 * 外观、配色、数值格式、tooltip、清理节点入参全部对齐 web/monitor.js，
 * 数据源同样是 GET /xxxxxlcat-monitor（500ms 轮询）。画布是独立 iframe，
 * 拿不到 ComfyUI 前端的 app/api 模块，所以这里直接用同源 fetch：
 *
 *   GET  /xxxxxlcat-monitor   遥测快照（cpu / ram / gpus / disk / ts）
 *   POST /prompt              排入 🐈‍⬛RAMReclaim / 🐈‍⬛VRAMSweep 立即执行
 *
 * 挂载位置：顶部 .canvas-tabs-strip（38px 高、右侧整段空白），绝对定位
 * 在 right:12px。它和 ComfyUI 菜单栏里的位置一一对应，不占标签栏的
 * flex 流，也不会遮住画布内容。Vue 重渲染 / 主题切换可能换掉子节点，
 * 所以每次轮询都检查一次 isConnected，掉了就重新挂。
 *
 * 底板固定深色 #171718：画布亮色主题下顶栏是浅灰，状态段原本的
 * rgba(255,255,255,.07) 半透明白底会让白字看不清，给整条一个深色底板
 * 后两种主题都可读，且与菜单栏观感一致。
 *
 * 事件隔离：状态条在 .vue-flow 之外（与它是兄弟节点），但上游有绑在
 * window 上的双击建节点 / 滚轮缩放 / 拖拽平移监听，所以在冒泡阶段
 * 拦掉 pointerdown / dblclick / wheel，按钮自身的 click 不受影响。
 */
(function () {
  'use strict';

  var REFRESH_MS = 500;

  /* 与 web/monitor.js 完全一致 */
  var COLORS = { cpu: '#207125', ram: '#357E3B', gpu: '#0B8CE9', vram: '#2498EA', temp: '#B33A3A' };
  var TEMP_MIN = 40, TEMP_MAX = 85, TEMP_COLD = '#207125', TEMP_HOT = '#B33A3A';
  var BOX_BG = '#262729';
  var TEXT_COLOR = '#FFFFFF';
  var LABEL_COLOR = 'rgba(255,255,255,.55)';
  var PLATE_BG = 'rgba(23,23,24,.94)';

  var CLEANUP = {
    ram: {
      cls: '🐈‍⬛RAMReclaim',
      top: 'RAM', bottom: 'Cleanup',
      inputs: { clean_file_cache: true, clean_processes: true, clean_dlls: true, retry_times: 3 }
    },
    vram: {
      cls: '🐈‍⬛VRAMSweep',
      top: 'VRAM', bottom: 'Cleanup',
      inputs: { offload_model: true, offload_cache: true }
    }
  };

  var root = null;
  var segs = {};
  var maxVRAM = 0;
  var lastData = null;

  function mk(tag) { return document.createElement(tag); }
  function fmtGB(gb) { return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1); }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function tempColor(ratio) {
    var t = clamp(ratio, 0, 1);
    var ah = parseInt(TEMP_COLD.slice(1), 16), bh = parseInt(TEMP_HOT.slice(1), 16);
    var ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
    var br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
    return 'rgb(' + Math.round(ar + (br - ar) * t) + ',' + Math.round(ag + (bg - ag) * t) + ',' + Math.round(ab + (bb - ab) * t) + ')';
  }

  /* 单个状态段：38×30，背景填充条自底向上 = 占用量，上数字下标签 */
  function mkSeg(key, label, color) {
    var seg = mk('div');
    seg.className = 'xcat-cm-seg';
    seg.dataset.key = key;
    seg.style.cssText = [
      'position:relative;overflow:hidden;flex-shrink:0;',
      'width:38px;height:30px;border-radius:4px;',
      'background:rgba(255,255,255,.07);',
      'box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);',
      'user-select:none;cursor:default;'
    ].join('');
    var fill = mk('i');
    fill.className = 'xcat-cm-fill';
    fill.style.cssText =
      'position:absolute;left:0;right:0;bottom:0;height:0%;' +
      'background:' + color + ';opacity:1;transition:height .5s;z-index:0;';
    var val = mk('div');
    val.className = 'xcat-cm-val';
    val.textContent = '…';
    val.style.cssText =
      'position:absolute;top:3px;left:0;right:0;text-align:center;' +
      'font-size:10px;font-weight:600;color:' + TEXT_COLOR + ';' +
      'text-shadow:0 1px 2px rgba(0,0,0,.78);font-variant-numeric:tabular-nums;z-index:1;';
    var lbl = mk('div');
    lbl.textContent = label;
    lbl.style.cssText =
      'position:absolute;bottom:2px;left:0;right:0;text-align:center;' +
      'font-size:8.5px;color:' + LABEL_COLOR + ';z-index:1;';
    seg.append(fill, val, lbl);
    return { seg: seg, val: val, fill: fill };
  }

  function setSeg(s, pct, text, title, fillColor) {
    s.fill.style.height = clamp(pct, 0, 100).toFixed(1) + '%';
    if (fillColor) s.fill.style.background = fillColor;
    s.val.textContent = text;
    if (title) s.seg.title = title;
  }

  function mkCleanupButton(kind) {
    var def = CLEANUP[kind];
    var btn = mk('button');
    btn.type = 'button';
    btn.className = 'xcat-cm-clean';
    btn.dataset.kind = kind;
    btn.title = def.top + ' ' + def.bottom;
    btn.style.cssText = [
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'width:50px;height:30px;flex-shrink:0;border-radius:4px;',
      'border:1px solid rgba(255,255,255,.14);background:' + BOX_BG + ';',
      'cursor:pointer;padding:0;line-height:1.15;transition:background .15s;'
    ].join('');
    var line1 = mk('div');
    line1.textContent = def.top;
    line1.style.cssText = 'font-size:11px;font-weight:600;color:' + TEXT_COLOR + ';';
    var line2 = mk('div');
    line2.textContent = def.bottom;
    line2.style.cssText = 'font-size:10px;color:' + LABEL_COLOR + ';';
    btn.append(line1, line2);
    btn.addEventListener('mouseenter', function () {
      if (!btn.disabled) btn.style.background = 'rgba(255,255,255,.12)';
    });
    btn.addEventListener('mouseleave', function () {
      if (!btn.disabled) btn.style.background = BOX_BG;
    });
    btn.addEventListener('click', function () { runCleanup(kind, btn); });
    return btn;
  }

  function mkSeparator() {
    var sep = mk('div');
    sep.className = 'xcat-cm-sep';
    sep.style.cssText =
      'width:1px;height:22px;background:rgba(255,255,255,.22);margin:0 3px;flex:0 0 auto;';
    return sep;
  }

  function build() {
    var el = mk('div');
    el.id = 'xcat-canvas-monitor';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', '系统状态');
    el.style.cssText = [
      'position:absolute;top:3px;right:12px;z-index:9;',
      'display:flex;flex-direction:row;align-items:center;gap:5px;',
      'height:32px;padding:0 6px;box-sizing:border-box;',
      'background:' + PLATE_BG + ';border:1px solid rgba(255,255,255,.08);',
      'border-radius:6px;user-select:none;'
    ].join('');

    /* 冒泡阶段拦掉画布级手势；capture 阶段不拦，否则按钮收不到事件 */
    ['pointerdown', 'mousedown', 'dblclick', 'wheel', 'contextmenu'].forEach(function (type) {
      el.addEventListener(type, function (e) { e.stopPropagation(); });
    });

    el.append(mkCleanupButton('ram'), mkCleanupButton('vram'), mkSeparator());
    segs.cpu = mkSeg('cpu', 'CPU', COLORS.cpu);
    segs.ram = mkSeg('ram', 'RAM', COLORS.ram);
    segs.gpu = mkSeg('gpu', 'GPU', COLORS.gpu);
    segs.vram = mkSeg('vram', 'VRAM', COLORS.vram);
    segs.temp = mkSeg('temp', 'TEMP', COLORS.temp);
    Object.keys(segs).forEach(function (k) { el.append(segs[k].seg); });
    return el;
  }

  function mount() {
    var strip = document.querySelector('.canvas-tabs-strip');
    if (!strip) return false;
    if (root && root.isConnected && root.parentNode === strip) return true;
    root = build();
    strip.appendChild(root);
    return true;
  }

  function render(data) {
    if (!data || !segs.cpu) return;
    lastData = data;

    if (data.cpu && data.cpu.percent != null) {
      var p = data.cpu.percent;
      setSeg(segs.cpu, p, Math.floor(p) + '%', 'CPU ' + Math.floor(p) + '%');
    }
    if (data.ram) {
      var rp = data.ram.percent;
      setSeg(segs.ram, rp, Math.floor(rp) + '%',
        'RAM ' + Math.floor(rp) + '% · ' + fmtGB(data.ram.used_gb) + 'G / ' + fmtGB(data.ram.total_gb) + 'G');
    }
    var gpu = data.gpus && data.gpus[0];
    if (gpu) {
      setSeg(segs.gpu, gpu.usage, Math.floor(gpu.usage) + '%',
        'GPU ' + Math.floor(gpu.usage) + '% · ' + gpu.name);
      var vramP = 100 * (gpu.vram_used_gb / gpu.vram_total_gb);
      if (gpu.vram_used_gb > maxVRAM) maxVRAM = gpu.vram_used_gb;
      var vramTitle = 'VRAM ' + Math.floor(vramP) + '% · ' + fmtGB(gpu.vram_used_gb) + 'G / ' + fmtGB(gpu.vram_total_gb) + 'G';
      if (maxVRAM > 0) vramTitle += ' · Max ' + fmtGB(maxVRAM) + 'G';
      setSeg(segs.vram, vramP, fmtGB(gpu.vram_used_gb) + 'G', vramTitle);
      var ratio = clamp((gpu.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
      setSeg(segs.temp, ratio * 100, Math.round(gpu.temp) + '°C',
        'TEMP ' + Math.round(gpu.temp) + '°C · ' + gpu.name, tempColor(ratio));
    } else {
      ['gpu', 'vram', 'temp'].forEach(function (key) {
        setSeg(segs[key], 0, 'N/A', key.toUpperCase() + ' N/A');
      });
    }
  }

  /* 点击清理：排入对应节点，ComfyUI 进程内立即执行（与菜单栏同一条链路） */
  function runCleanup(kind, btn) {
    /* 两个按钮各自独立，与菜单栏一致：禁用期间只拦自己，不吞另一个按钮的点击 */
    if (btn.disabled) return;
    var def = CLEANUP[kind];
    btn.disabled = true;
    btn.style.opacity = '.45';
    var prompt = {};
    prompt['clean_1'] = { class_type: def.cls, inputs: def.inputs };
    fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt, client_id: 'xxxxxlcat-canvas-monitor' })
    }).catch(function () { /* 静默，按钮按时恢复 */ }).then(function () {
      setTimeout(function () {
        btn.disabled = false;
        btn.style.opacity = '';
      }, 800);
    });
  }

  function tick() {
    mount();
    fetch('/xxxxxlcat-monitor', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) render(d); })
      .catch(function () { /* ComfyUI 未就绪时保留上次读数 */ });
  }

  function start() {
    mount();
    tick();
    setInterval(tick, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  /* 供 CDP 验证与排障使用 */
  window.__xcatCanvasMonitor = {
    get root() { return root; },
    get last() { return lastData; },
    mount: mount,
    tick: tick,
    render: render
  };
})();
