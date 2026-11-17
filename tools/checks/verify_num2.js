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
  window.__openCrop = async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
      '<rect width="600" height="400" fill="#2f6f8f"/></svg>';
    await window.InfCanvas.tools.registry.crop({
      id: 'probe',
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      data: { asset: { name: 'probe.png', kind: 'image' } },
    });
    return 'opened';
  };
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/test-crop')) {
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
  const url = `http://127.0.0.1:${SITE}/test-crop.html`;
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1200,900', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.cache/cdp-profile', url], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 40 && !list; n += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('test-crop'));
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
  console.log('open:', await ev('window.__openCrop()', true));
  await sleep(900);

  const read = () => ev(`(() => {
    const boxes = [...document.querySelectorAll('.ict-4 .ict-num')];
    const out = boxes.map((n) => {
      const b = n.getBoundingClientRect();
      const btns = [...n.querySelectorAll('button')].map((x) => {
        const r = x.getBoundingClientRect();
        return [Math.round(r.width), Math.round(r.height)];
      });
      const inp = n.querySelector('input');
      const cs = getComputedStyle(n), ci = getComputedStyle(inp);
      return { box: [Math.round(b.width), Math.round(b.height)], x: Math.round(b.x), y: Math.round(b.y),
        btns, radius: cs.borderRadius, bg: cs.backgroundColor,
        inputFont: ci.fontSize, align: ci.textAlign, value: inp.value,
        icon: (() => { const s = n.querySelector('button svg'); if (!s) return null;
          const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() };
    });
    return JSON.stringify({ count: out.length, rows: out, gapY: out.length > 1 ? out[1].y - out[0].y - out[0].box[1] : null }, null, 1);
  })()`);
  console.log('几何:', await read());

  console.log('比例芯片:', await ev(`(() => {
    const chips = [...document.querySelectorAll('.ict-chips .ict-chip')];
    const nums = [...document.querySelectorAll('.ict-4 .ict-num')];
    const nb = nums[0].getBoundingClientRect();
    const nf = getComputedStyle(nums[0].querySelector('input')).fontSize;
    return JSON.stringify(chips.slice(0, 4).map((c) => {
      const b = c.getBoundingClientRect(), cs = getComputedStyle(c);
      return { text: c.textContent.trim(), box: [Math.round(b.width), Math.round(b.height)],
        bg: cs.backgroundColor, radius: cs.borderRadius, font: cs.fontSize,
        active: c.classList.contains('is-active') };
    }).concat([{ numBox: [Math.round(nb.width), Math.round(nb.height)], numFont: nf,
      sameHeight: Math.round(chips[0].getBoundingClientRect().height) === Math.round(nb.height) }]), null, 1);
  })()`));

  /* click centre of the input area -> should select all */
  const c = JSON.parse(await ev(`(() => { const b = document.querySelector('.ict-4 .ict-num .ict-num-cell').getBoundingClientRect();
    return JSON.stringify([b.x + 20, b.y + b.height / 2]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c[0], y: c[1], buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0], y: c[1], button: 'left', clickCount: 1, buttons: 0 });
  await sleep(200);
  console.log('点击后:', await ev(`(() => {
    const n = document.querySelector('.ict-4 .ict-num');
    const i = n.querySelector('input');
    return JSON.stringify({ editing: n.classList.contains('is-editing'),
      focused: document.activeElement === i, selStart: i.selectionStart, selEnd: i.selectionEnd,
      len: i.value.length, cursor: getComputedStyle(n.querySelector('.ict-num-swipe')).cursor });
  })()`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/num2-crop.png', Buffer.from(shot.data, 'base64'));

  const box = JSON.parse(await ev(`(() => { const b = document.querySelector('.ict-4').getBoundingClientRect();
    return JSON.stringify([b.x, b.y, b.width, b.height]); })()`));
  const zoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: box[0] - 6, y: box[1] - 6, width: box[2] + 12, height: box[3] + 12, scale: 3 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/num2-zoom.png', Buffer.from(zoom.data, 'base64'));

  const rbox = JSON.parse(await ev(`(() => { const r = document.querySelector('.ict-ratios').getBoundingClientRect();
    const n = document.querySelector('.ict-4 .ict-num').getBoundingClientRect();
    return JSON.stringify([r.x - r.width / 2, r.y - 30, r.width * 2, r.height + 70]); })()`));
  const rzoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: rbox[0], y: rbox[1], width: rbox[2], height: rbox[3], scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/num2-ratio.png', Buffer.from(rzoom.data, 'base64'));

  /* hover the minus button -> bg-muted */
  await ev(`document.activeElement.blur()`);
  await sleep(120);
  const d = JSON.parse(await ev(`(() => { const b = document.querySelector('.ict-4 .ict-num button').getBoundingClientRect();
    return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: d[0], y: d[1], buttons: 0 });
  await sleep(250);
  console.log('按钮 hover:', await ev(`getComputedStyle(document.querySelector('.ict-4 .ict-num button')).backgroundColor`));

  /* drag the swipe overlay 60px to the right -> value should change by 6 steps */
  await ev(`document.querySelector('.ict-4 .ict-num input').value`);
  const before = await ev(`document.querySelector('.ict-4 .ict-num input').value`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c[0], y: c[1], button: 'left', clickCount: 1, buttons: 1 });
  for (let s = 1; s <= 6; s += 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c[0] + s * 10, y: c[1], buttons: 1 });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c[0] + 60, y: c[1], button: 'left', clickCount: 1, buttons: 0 });
  await sleep(200);
  console.log('向右拖 60px:', before, '->', await ev(`document.querySelector('.ict-4 .ict-num input').value`),
    'editing:', await ev(`document.querySelector('.ict-4 .ict-num').classList.contains('is-editing')`));

  ws.close();
  child.kill();
  server.close();
})();
