/* Runs the REAL grid dialog (js/infcanvas-tools.js, unchanged) in a bare page:
   serves the workspace over http, opens the dialog with an inline image, then
   clicks 4 宫格 / 25 宫格 / 自定义 and reads the slider values back. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const SITE = 8477;
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' };

const page = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#171718;color:#fff;font-family:Inter,system-ui,sans-serif}
#infcanvas-root{position:fixed;inset:0;}</style></head>
<body><div id="infcanvas-root"></div>
<script src="/js/infcanvas-tools.js"></script>
<script>
  window.__openGrid = async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
      '<rect width="600" height="400" fill="#2f6f8f"/></svg>';
    await window.InfCanvas.tools.registry.grid({
      id: 'probe',
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      data: { asset: { name: 'probe.png', kind: 'image' } },
    });
    return 'opened';
  };
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/test-grid')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
    return;
  }
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(SITE, '127.0.0.1', r));
  const url = `http://127.0.0.1:${SITE}/test-grid.html`;
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1200,900', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.workbuddy/tmp/grid-live-profile', url], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 40 && !list; n += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('test-grid'));
  if (!target) { console.log('no page'); child.kill(); server.close(); return; }
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
  await send('Runtime.enable');
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  for (let n = 0; n < 20 && !(await ev('!!(window.InfCanvas && window.InfCanvas.tools)')); n += 1) await sleep(250);
  console.log('open:', await ev('window.__openGrid()', true));
  await sleep(900);

  const read = () => ev(`(() => {
    const rows = document.querySelector('.ict-grid-custom input[data-f=rows]');
    const cols = document.querySelector('.ict-grid-custom input[data-f=cols]');
    const out = (k) => document.querySelector('.ict-grid-custom output[data-o=' + k + ']')?.textContent;
    return JSON.stringify({ rows: rows?.value, cols: cols?.value, outRows: out('rows'), outCols: out('cols'),
      activePresets: [...document.querySelectorAll('.ict-grid-preset.is-active')].map((c) => c.dataset.grid),
      summary: document.querySelector('.ict-summary')?.textContent,
      customHidden: document.querySelector('.ict-grid-custom')?.hidden,
      fill: rows?.style.getPropertyValue('--ict-p') });
  })()`);

  console.log('初始:', await read());
  await ev(`document.querySelectorAll('.ict-grid-preset')[2].click()`);
  await sleep(120);
  console.log('点 4 宫格:', await read());
  await ev(`document.querySelectorAll('.ict-grid-preset')[3].click()`);
  await sleep(120);
  console.log('点 25 宫格:', await read());
  await ev(`document.querySelector('.ict-grid-custom-btn').click()`);
  await sleep(200);
  console.log('点自定义:', await read());

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/grid-custom-live.png', Buffer.from(shot.data, 'base64'));
  ws.close();
  child.kill();
  server.close();
})();
