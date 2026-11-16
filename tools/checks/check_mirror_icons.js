/* Renders the mirror-dialog icons straight from infcanvas-tools.js so the
   rotate glyphs can be compared with the reference screenshot. */
const fs = require('fs');
const src = fs.readFileSync('E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-tools.js', 'utf8');
const start = src.indexOf('const MIRROR_PATHS = {');
const end = src.indexOf('};', start) + 2;
const literal = src.slice(start + 'const MIRROR_PATHS = '.length, end);
const paths = new Function('return ' + literal)();

const svg = (key, size, sw) => '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size +
  '" fill="none" stroke="currentColor" stroke-width="' + sw +
  '" stroke-linecap="round" stroke-linejoin="round">' + (paths[key] || '') + '</svg>';

const keys = ['flipX', 'flipY', 'rotate90', 'rotate270', 'rotate180'];
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#313235;color:#fff;font-family:Inter,system-ui,sans-serif;}
.row{display:flex;gap:40px;padding:24px;align-items:center;}
.big{display:flex;gap:28px;padding:16px 24px;background:#262729;border-radius:8px;}
.cell{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:#8a8a8a;}
.real{display:flex;gap:12px;padding:16px 24px;background:#171718;border-radius:8px;}
.chip{display:flex;align-items:center;gap:8px;padding:10px;border-radius:6px;background:#262729;font-size:12px;}
</style></head><body>
<div class="row"><div class="big">${keys.map((k) => `<div class="cell">${svg(k, 96, 1.7)}<span>${k}</span></div>`).join('')}</div></div>
<div class="row"><div class="real">${keys.map((k) => `<div class="chip">${svg(k, 20, 1.7)}<span>${k}</span></div>`).join('')}</div></div>
</body></html>`;
fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/__mirror_icons.html', html);

const http = require('http');
const { spawn } = require('child_process');
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/__mirror_icons.html';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=900,320', '--hide-scrollbars',
    '--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.cache/cdp-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 40 && !list; n += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pend.has(msg.id)) {
      const { res, rej } = pend.get(msg.id); pend.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 620, height: 260, scale: 2 } });
  fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/mirror-icons.png', Buffer.from(shot.data, 'base64'));
  ws.close();
  child.kill();
})();
