/* Real crop dialog in a bare page: checks the ScrubableNumberInput clone
   (24px row, square 24x24 buttons, left aligned 12px input), the two-row
   宽/高 layout, click-to-select and drag-to-scrub. */
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
  window.__openMirror = async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
      '<rect width="600" height="400" fill="#2f6f8f"/></svg>';
    await window.InfCanvas.tools.registry.mirror({
      id: 'probe',
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      data: { asset: { name: 'probe.png', kind: 'image' } },
    });
    return 'opened';
  };
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/test-mirror')) {
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
  const url = `http://127.0.0.1:${SITE}/test-mirror.html`;
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1200,900', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.cache/cdp-profile', url], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 40 && !list; n += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('test-mirror'));
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
  console.log('open:', await ev('window.__openMirror()', true));
  await sleep(900);

  console.log('头部副标题:', await ev(`JSON.stringify({
    title: document.querySelector('.ict-head h3')?.textContent,
    sub: document.querySelector('.ict-sub')?.textContent,
    subLen: (document.querySelector('.ict-sub')?.textContent || '').length })`));
  console.log('按钮:', await ev(`(() => {
    const btns = [...document.querySelectorAll('.ict-mirror-btn')];
    return JSON.stringify(btns.map((b) => {
      const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
      return { text: b.textContent.trim(), smalls: b.querySelectorAll('small').length,
        box: [Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, radius: cs.borderRadius };
    }), null, 1);
  })()`));
  console.log('侧栏子元素:', await ev(`JSON.stringify([...document.querySelector('.ict-side').children].map((e) => e.className || e.tagName))`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/mirror.png', Buffer.from(shot.data, 'base64'));

  const box = JSON.parse(await ev(`(() => { const b = document.querySelector('.ict-mirror-grid').getBoundingClientRect();
    return JSON.stringify([b.x - 8, b.y - 26, b.width + 16, b.height + 34]); })()`));
  const zoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: box[0], y: box[1], width: box[2], height: box[3], scale: 2.5 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/mirror-zoom.png', Buffer.from(zoom.data, 'base64'));

  ws.close(); child.kill(); server.close();
})();
