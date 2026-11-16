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
    '--user-data-dir=' + ROOT + '/.workbuddy/tmp/diff-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60 && !list; i += 1) { await sleep(300); try { list = JSON.parse(await get('/json/list')); } catch (e) {} }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('8188'));
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
  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-diff-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
    })()`, true);
    await sleep(5000);
  }
  for (let i = 0; i < 100; i += 1) { if (await ev(`!!(window.InfCanvas && InfCanvas.flow)`)) break; await sleep(300); }
  console.log(await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 900));
    NS.api.newCanvas();
    await new Promise((r) => setTimeout(r, 400));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2f6f8f"/></svg>';
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const a = NS.api.addNodeByType('infcanvas/asset_image', [120, 140], { name: 'a.png', filename: 'a.png', kind: 'image', url });
    const gen = NS.api.addNodeByType('infcanvas/gen_video', [760, 240]);
    NS.flow.addEdge({ id: 'e-1', source: a.id, target: gen.id, type: 'ic' });
    NS.flow.history.reset();
    await new Promise((r) => setTimeout(r, 1500));
    const raw = NS.flow.history.raw();
    if (raw.length < 2) return JSON.stringify({ count: raw.length, diff: 'single' });
    if (raw.length < 2) return JSON.stringify({ count: raw.length, diff: 'single' });
    const A = JSON.parse(raw[0]), B = JSON.parse(raw[1]);
    const diff = [];
    A.nodes.forEach((n, i) => {
      const m = B.nodes[i] || {};
      if (JSON.stringify(n) === JSON.stringify(m)) return;
      Object.keys({ ...n, ...m }).forEach((k) => {
        if (k === 'data') {
          Object.keys({ ...(n.data || {}), ...(m.data || {}) }).forEach((d) => {
            if (JSON.stringify(n.data?.[d]) !== JSON.stringify(m.data?.[d]))
              diff.push(n.id + '.' + d + ': ' + JSON.stringify(n.data?.[d]) + ' -> ' + JSON.stringify(m.data?.[d]));
          });
        } else if (JSON.stringify(n[k]) !== JSON.stringify(m[k])) {
          diff.push(n.id + '.' + k + ': ' + JSON.stringify(n[k]) + ' -> ' + JSON.stringify(m[k]));
        }
      });
    });
    if (JSON.stringify(A.edges) !== JSON.stringify(B.edges)) diff.push('edges differ');
    return JSON.stringify({ count: raw.length, diff });
  })()`, true));
  ws.close(); child.kill();
})();
