/* Undo coverage beyond the wires: node deletion (Delete key), a node drag and
   a panel field edit must each be one step, and Ctrl+Z must restore them. */
const http = require('http');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b)); }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--window-size=1440,900',
    '--hide-scrollbars', '--user-data-dir=' + ROOT + '/.workbuddy/tmp/hist-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60 && !list; i += 1) { await sleep(300); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('8188'));
  if (!target) { console.log('no page'); child.kill(); return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => { const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p })); });
  ws.onmessage = (e) => { const msg = JSON.parse(e.data); if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const mouse = async (type, x, y, modifiers = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1, modifiers });
  const key = async (k, code, vk, modifiers = 0) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  };

  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-hist-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
    })()`, true);
    await sleep(5000);
  }
  for (let i = 0; i < 100; i += 1) { if (await ev(`!!(window.InfCanvas && InfCanvas.flow)`)) break; await sleep(300); }

  console.log('setup:', await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 900));
    NS.api.newCanvas();
    await new Promise((r) => setTimeout(r, 400));
    const gen = NS.api.addNodeByType('infcanvas/gen_video', [520, 220]);
    const text = NS.api.addNodeByType('infcanvas/asset_text', [200, 240], { text: 'hello' });
    await new Promise((r) => setTimeout(r, 600));
    NS.flow.selectNodes([]);
    NS.flow.history.reset();
    await new Promise((r) => setTimeout(r, 600));
    window.__probe = { gen: gen.id, text: text.id };
    return JSON.stringify({ nodes: NS.flow.nodesOf().length, stack: NS.flow.history.size() });
  })()`, true));
  await sleep(700);

  const state = async (label) => console.log(label, await ev(`JSON.stringify({ nodes: InfCanvas.flow.nodesOf().length,
    edges: InfCanvas.flow.edgesOf().length, dom: document.querySelectorAll('.vue-flow__node').length,
    stack: InfCanvas.flow.history.size() })`));
  await state('after setup:');

  /* delete a node with the Delete key, then undo */
  await ev(`InfCanvas.flow.selectNodes([window.__probe.text])`);
  await sleep(300);
  await key('Delete', 'Delete', 46);
  await sleep(800);
  await state('after delete:');
  await key('z', 'KeyZ', 90, 2);
  await sleep(800);
  await state('undo delete:');

  /* drag a node, then undo */
  const box = JSON.parse(await ev(`(() => {
    const el = [...document.querySelectorAll('.vue-flow__node')].find((n) => n.getAttribute('data-id') === window.__probe.gen);
    const b = el.getBoundingClientRect();
    return JSON.stringify([Math.round(b.left + b.width / 2), Math.round(b.top + 34)]);
  })()`));
  const before = await ev(`JSON.stringify(InfCanvas.flow.nodesOf().find((n) => n.id === window.__probe.gen).position)`);
  await mouse('mousePressed', box[0], box[1]);
  for (let i = 1; i <= 8; i += 1) { await mouse('mouseMoved', box[0] + i * 12, box[1] + i * 6); await sleep(20); }
  await mouse('mouseReleased', box[0] + 96, box[1] + 48);
  await sleep(900);
  const moved = await ev(`JSON.stringify(InfCanvas.flow.nodesOf().find((n) => n.id === window.__probe.gen).position)`);
  console.log('drag:', before, '->', moved);
  await key('z', 'KeyZ', 90, 2);
  await sleep(800);
  console.log('undo drag:', await ev(`JSON.stringify(InfCanvas.flow.nodesOf().find((n) => n.id === window.__probe.gen).position)`));

  /* Ctrl+Z inside the prompt editor must stay native (no graph undo) */
  const ta = await ev(`(() => { const el = document.querySelector('.icn__gpv-rich');
    if (!el) return 'none'; el.focus(); return document.activeElement.className; })()`);
  console.log('editor focus:', ta);

  ws.close(); child.kill();
})();
