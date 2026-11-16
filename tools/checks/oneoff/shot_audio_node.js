/* Screenshot only: audio generator panel in its default state (music mode),
   with the real music workflow selected so the API fields show up. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WF = '文生音乐：MiniMax Music 3';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1600,1000', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.cache/cdp-profile', 'http://127.0.0.1:8188/'], { stdio: 'ignore' });
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
  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'shot-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
      return 'ok';
    })()`, true);
    await sleep(5000);
  }
  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    ready = await ev(`!!(window.InfCanvas && InfCanvas.api && InfCanvas.flow)`);
    if (!ready) await sleep(300);
  }
  if (!ready) { console.log('not ready'); ws.close(); child.kill(); return; }

  await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 900));
    const gen = NS.api.addNodeByType('infcanvas/gen_audio', [640, 300]);
    NS.flow.updateNodeData(gen.id, { workflow: ${JSON.stringify(WF)} });
    NS.flow.selectNodes([gen.id]);
    window.__id = gen.id;
    await new Promise((r) => setTimeout(r, 900));
    return 'ok';
  })()`, true);
  await sleep(800);
  const gp = JSON.parse(await ev(`(() => { const el = document.querySelector('.icn--gen');
    const b = el.getBoundingClientRect(); return JSON.stringify([Math.round(b.x + b.width / 2), Math.round(b.y + 24)]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await sleep(700);
  const clip = JSON.parse(await ev(`(() => { const p = document.querySelector('.icn').getBoundingClientRect();
    const pa = document.querySelector('.icn__gpa').getBoundingClientRect();
    const left = Math.min(p.left, pa.left) - 14, top = Math.min(p.top, pa.top) - 40;
    const right = Math.max(p.right, pa.right) + 14, bottom = Math.max(p.bottom, pa.bottom) + 14;
    return JSON.stringify({ x: left, y: top, w: right - left, h: bottom - top }); })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/audio-node-final.png', Buffer.from(shot.data, 'base64'));
  ws.close(); child.kill();
})();
