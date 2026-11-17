/* Opens the REAL crop dialog (js/infcanvas-tools.js) and checks that each
   number input became a FormNumberField stepper: 40px pill, 24px minus/plus
   buttons, centered 16px input, geometry + click behaviour + screenshot. */
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
<script src="/js/infcanvas-media-tools.js"></script>
<script>
  window.__openTrim = async () => {
    await window.InfCanvas.tools.registry.trim({
      id: 'probe',
      url: 'http://127.0.0.1:8477/nope.mp4',
      data: { asset: { name: 'probe.mp4', kind: 'video' } },
    });
    return 'opened';
  };
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/test-trim')) {
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
  const url = `http://127.0.0.1:${SITE}/test-trim.html`;
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1200,900', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.cache/cdp-profile', url], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 40 && !list; n += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('test-trim'));
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
  console.log('open:', await ev('window.__openTrim()', true));
  await sleep(900);

  const read = () => ev(`(() => {
    const out = [];
    document.querySelectorAll('.ict-num').forEach((n) => {
      const inp = n.querySelector('input');
      const dec = n.querySelector('button');
      const inc = n.querySelectorAll('button')[1];
      const g = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
      const cs = getComputedStyle(n), ci = getComputedStyle(inp);
      out.push({ box: g(n), dec: g(dec), inc: g(inc), radius: cs.borderRadius,
        bg: cs.backgroundColor, decColor: getComputedStyle(dec).color,
        inputFont: ci.fontSize, inputAlign: ci.textAlign, value: inp.value,
        iconBox: g(dec.querySelector('svg') || dec) });
    });
    const aside = document.querySelector('.ict-side');
    const rows = [...document.querySelectorAll('.ict-slider-field')].map((r) => {
      const b = r.getBoundingClientRect();
      return { box: [Math.round(b.width), Math.round(b.height)],
        rangeW: Math.round(r.querySelector('input[type=range]').getBoundingClientRect().width) };
    });
    return JSON.stringify({ count: out.length, steppers: out, sliderField: rows,
      asideKids: aside ? [...aside.children].map((el) => el.className || el.tagName.toLowerCase()) : null }, null, 1);
  })()`);

  console.log('几何:', await read());

  /* click the + of the width field and read the value back */
  console.log('点宽 + :', await ev(`(() => {
    const n = document.querySelector('.ict-num');
    const inp = n.querySelector('input');
    const before = inp.value;
    n.querySelectorAll('button')[1].click();
    return before + ' -> ' + inp.value;
  })()`));
  await sleep(150);
  console.log('点宽 - :', await ev(`(() => {
    const n = document.querySelector('.ict-num');
    const inp = n.querySelector('input');
    const before = inp.value;
    n.querySelectorAll('button')[0].click();
    return before + ' -> ' + inp.value;
  })()`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/stepper-crop.png', Buffer.from(shot.data, 'base64'));

  /* zoom on the width/height row */
  const box = JSON.parse(await ev(`(() => {
    const b = document.querySelector('.ict-4').getBoundingClientRect();
    return JSON.stringify([b.x, b.y, b.width, b.height]);
  })()`));
  const zoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: box[0] - 6, y: box[1] - 6, width: box[2] + 12, height: box[3] + 12, scale: 3 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/stepper-crop-zoom.png', Buffer.from(zoom.data, 'base64'));

  ws.close();
  child.kill();
  server.close();
})();
