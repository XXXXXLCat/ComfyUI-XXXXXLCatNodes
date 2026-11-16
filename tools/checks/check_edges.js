/* Live check for: link centre dots (click = disconnect), Alt+drag slicing,
   white highlight on the wires of a selected node, and Ctrl+Z / Ctrl+Y. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1440,900', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.workbuddy/tmp/edge-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60 && !list; i += 1) { await sleep(300); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('8188'));
  if (!target) { console.log('no page'); child.kill(); return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p }));
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const mouse = async (type, x, y, modifiers = 0, button = 'left') => send('Input.dispatchMouseEvent', {
    type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1, modifiers,
  });
  const drag = async (from, to, modifiers = 0, steps = 8) => {
    await mouse('mousePressed', from[0], from[1], modifiers);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await mouse('mouseMoved', Math.round(from[0] + (to[0] - from[0]) * t), Math.round(from[1] + (to[1] - from[1]) * t), modifiers);
      await sleep(18);
    }
    await mouse('mouseReleased', to[0], to[1], modifiers);
  };
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  };

  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-edge-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
    })()`, true);
    await sleep(5000);
  }

  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    ready = await ev(`!!(window.InfCanvas && InfCanvas.api && InfCanvas.api.addNodeByType && InfCanvas.flow && InfCanvas.flow.state)`);
    if (!ready) await sleep(300);
  }
  console.log('runtime ready:', ready);
  if (!ready) { ws.close(); child.kill(); return; }

  console.log('setup:', await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 900));
    NS.api.newCanvas();
    await new Promise((r) => setTimeout(r, 500));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2f6f8f"/></svg>';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const a = NS.api.addNodeByType('infcanvas/asset_image', [120, 140], { name: 'a.png', filename: 'a.png', kind: 'image', url });
    const b = NS.api.addNodeByType('infcanvas/asset_image', [120, 480], { name: 'b.png', filename: 'b.png', kind: 'image', url });
    const gen = NS.api.addNodeByType('infcanvas/gen_video', [760, 240]);
    const add = (s, t, n) => NS.flow.addEdge({ id: n, source: s, target: t, type: 'ic' });
    add(a.id, gen.id, 'e-probe-1');
    add(b.id, gen.id, 'e-probe-2');
    NS.flow.selectNodes([]);
    NS.flow.history?.reset?.();
    window.__probe = { a: a.id, b: b.id, gen: gen.id };
    return JSON.stringify({ nodes: NS.flow.nodesOf().length, edges: NS.flow.edgesOf().length });
  })()`, true));
  await sleep(900);

  /* --- 1. one centre dot per link, sitting exactly on the curve midpoint --- */
  console.log('dots:', await ev(`(() => {
    const out = [...document.querySelectorAll('.vue-flow__edge')].map((g) => {
      const dot = g.querySelector('.ic-edge-dot');
      const path = g.querySelector('.vue-flow__edge-path');
      const cs = dot && getComputedStyle(dot);
      const mid = path.getPointAtLength(path.getTotalLength() / 2);
      return {
        id: g.getAttribute('data-id'),
        hasDot: !!dot,
        r: dot && Number(dot.getAttribute('r')),
        fill: cs && cs.fill,
        pointer: cs && cs.pointerEvents,
        cursor: cs && cs.cursor,
        dx: dot ? Math.round(Number(dot.getAttribute('cx')) - mid.x) : null,
        dy: dot ? Math.round(Number(dot.getAttribute('cy')) - mid.y) : null,
      };
    });
    return JSON.stringify(out);
  })()`));

  /* --- 2. clicking a dot disconnects that wire --- */
  const dotXY = JSON.parse(await ev(`(() => {
    const g = [...document.querySelectorAll('.vue-flow__edge')].find((e) => e.getAttribute('data-id') === 'e-probe-1');
    const dot = g.querySelector('.ic-edge-dot').getBoundingClientRect();
    return JSON.stringify([Math.round(dot.left + dot.width / 2), Math.round(dot.top + dot.height / 2)]);
  })()`));
  console.log('dot at:', JSON.stringify(dotXY));
  await mouse('mousePressed', dotXY[0], dotXY[1]);
  await mouse('mouseReleased', dotXY[0], dotXY[1]);
  await sleep(500);
  console.log('after dot click:', await ev(`JSON.stringify({
    edges: InfCanvas.flow.edgesOf().map((e) => e.id),
    dom: [...document.querySelectorAll('.vue-flow__edge')].map((g) => g.getAttribute('data-id')),
  })`));

  /* --- 3. white highlight on the wires of a selected node --- */
  console.log('highlight off:', await ev(`(() => {
    const path = document.querySelector('.ic-edge-g .vue-flow__edge-path');
    return JSON.stringify({ hl: document.querySelector('.ic-edge-g').getAttribute('class'),
      stroke: path && getComputedStyle(path).stroke });
  })()`));
  await ev(`InfCanvas.flow.selectNodes([window.__probe.gen])`);
  await sleep(500);
  console.log('highlight on:', await ev(`(() => {
    const g = document.querySelector('.ic-edge-g');
    const path = g.querySelector('.vue-flow__edge-path');
    const dot = g.querySelector('.ic-edge-dot');
    return JSON.stringify({ cls: g.getAttribute('class'), stroke: getComputedStyle(path).stroke,
      width: getComputedStyle(path).strokeWidth, dot: getComputedStyle(dot).fill,
      sel: InfCanvas.flow.state.selectedIds.value,
      edgeSelected: document.querySelector('.vue-flow__edge').getAttribute('class') });
  })()`));
  await ev(`InfCanvas.flow.selectNodes([window.__probe.a])`);
  await sleep(400);
  console.log('other node selected:', await ev(`(() => {
    const g = document.querySelector('.ic-edge-g');
    return JSON.stringify({ cls: g.getAttribute('class'), stroke: getComputedStyle(g.querySelector('.vue-flow__edge-path')).stroke });
  })()`));
  await ev(`InfCanvas.flow.selectNodes([])`);
  await sleep(300);

  /* --- 4. Alt + left drag across a wire slices it --- */
  const mid = JSON.parse(await ev(`(() => {
    const path = document.querySelector('.vue-flow__edge-path');
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const box = document.getElementById('infcanvas-vueflow').getBoundingClientRect();
    const vp = InfCanvas.flow.getViewport();
    return JSON.stringify([Math.round(box.left + p.x * vp.zoom + vp.x), Math.round(box.top + p.y * vp.zoom + vp.y)]);
  })()`));
  console.log('cut through:', JSON.stringify(mid));
  await drag([mid[0] - 70, mid[1] - 90], [mid[0] + 70, mid[1] + 90], 1);
  await sleep(600);
  console.log('after alt drag:', await ev(`JSON.stringify({ edges: InfCanvas.flow.edgesOf().map((e) => e.id),
    dom: [...document.querySelectorAll('.vue-flow__edge')].map((g) => g.getAttribute('data-id')) })`));

  /* --- 5. undo / redo --- */
  const snap = async (label) => console.log(label, await ev(`JSON.stringify({ edges: InfCanvas.flow.edgesOf().length,
    stack: InfCanvas.flow.history.size() })`));
  await snap('start:');
  await key('z', 'KeyZ', 90, 2); await sleep(700); await snap('ctrl+z #1:');
  await key('z', 'KeyZ', 90, 2); await sleep(700); await snap('ctrl+z #2:');
  await key('z', 'KeyZ', 90, 2); await sleep(700); await snap('ctrl+z #3:');
  await key('y', 'KeyY', 89, 2); await sleep(700); await snap('ctrl+y #1:');
  await key('y', 'KeyY', 89, 2); await sleep(700); await snap('ctrl+y #2:');
  await key('y', 'KeyY', 89, 2); await sleep(700); await snap('ctrl+y #3:');

  /* --- 6. dots vanish below 60% zoom --- */
  await ev(`InfCanvas.flow.history.undo()`); await sleep(700);
  await ev(`InfCanvas.flow.history.undo()`); await sleep(900);
  console.log('restored for zoom test:', await ev(`InfCanvas.flow.edgesOf().length`));
  await ev(`InfCanvas.flow.setZoom(0.5)`);
  await sleep(800);
  console.log('zoom 50%:', await ev(`(() => { const dot = document.querySelector('.ic-edge-dot');
    return JSON.stringify({ far: document.querySelector('.ic-flow').className,
      display: dot && getComputedStyle(dot).display }); })()`));
  await ev(`InfCanvas.flow.setZoom(1)`);
  await sleep(700);

  /* select the generator so the shot shows the white highlight */
  await ev(`InfCanvas.flow.selectNodes([window.__probe.gen])`);
  await sleep(500);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/edges-hl.png', Buffer.from(shot.data, 'base64'));

  /* zoomed crop of one link midpoint */
  const midBox = JSON.parse(await ev(`(() => {
    const dot = document.querySelector('.ic-edge-dot').getBoundingClientRect();
    return JSON.stringify([Math.round(dot.left), Math.round(dot.top), Math.round(dot.width)]);
  })()`));
  shot = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: midBox[0] - 80, y: midBox[1] - 50, width: 200, height: 130, scale: 4 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/edges-dot.png', Buffer.from(shot.data, 'base64'));

  /* --- 7. the alt slice leaves the wire red mid-drag --- */
  await ev(`InfCanvas.flow.selectNodes([])`);
  const mid2 = JSON.parse(await ev(`(() => {
    const path = document.querySelector('.vue-flow__edge-path');
    const p = path.getPointAtLength(path.getTotalLength() / 2);
    const box = document.getElementById('infcanvas-vueflow').getBoundingClientRect();
    const vp = InfCanvas.flow.getViewport();
    return JSON.stringify([Math.round(box.left + p.x * vp.zoom + vp.x), Math.round(box.top + p.y * vp.zoom + vp.y)]);
  })()`));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 1 });
  await mouse('mousePressed', mid2[0] - 60, mid2[1] - 80, 1);
  for (let i = 1; i <= 6; i += 1) {
    await mouse('mouseMoved', mid2[0] - 60 + (120 * i) / 6, mid2[1] - 80 + (160 * i) / 6, 1);
    await sleep(30);
  }
  await sleep(200);
  console.log('mid-slice:', await ev(`JSON.stringify({ red: [...document.querySelectorAll('.vue-flow__edge')].map((g) => g.getAttribute('class')),
    stroke: getComputedStyle(document.querySelector('.vue-flow__edge-path')).stroke,
    cursor: getComputedStyle(document.querySelector('.vue-flow__pane')).cursor,
    cls: document.querySelector('.ic-flow').className })`));
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/edges-cut.png', Buffer.from(shot.data, 'base64'));
  await mouse('mouseReleased', mid2[0] + 60, mid2[1] + 80, 1);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: 0 });
  await sleep(500);
  console.log('after release:', await ev(`JSON.stringify({ edges: InfCanvas.flow.edgesOf().length,
    cls: document.querySelector('.ic-flow').className })`));

  ws.close(); child.kill();
})();
