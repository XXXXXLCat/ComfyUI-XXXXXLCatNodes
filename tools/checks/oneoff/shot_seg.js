/* Screenshot the segmented-control demo and read real computed values. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///' + ROOT + '/__seg_demo.html';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=560,420', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.cache/cdp-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40 && !list; i += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('seg_demo'));
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
  await sleep(700);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  console.log('容器/分段:', await ev(`(() => {
    const box = document.querySelector('.icn__gpv-modes');
    const cs = getComputedStyle(box);
    const b = box.getBoundingClientRect();
    const items = [...box.querySelectorAll('.icn__gpv-mode')].map((el) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return { text: el.textContent, w: Math.round(r.width), h: Math.round(r.height),
        bg: s.backgroundColor, color: s.color, radius: s.borderRadius, font: s.fontSize,
        weight: s.fontWeight, pad: s.paddingLeft };
    });
    return JSON.stringify({ container: { w: Math.round(b.width), h: Math.round(b.height),
      bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, gap: cs.gap },
      items }, null, 1);
  })()`));

  /* hover the 2nd item with a real mouse event */
  const pt = JSON.parse(await ev(`(() => { const r = document.querySelectorAll('.icn__gpv-mode')[1].getBoundingClientRect();
    return JSON.stringify([r.x + r.width / 2, r.y + r.height / 2]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1], buttons: 0 });
  await sleep(250);
  console.log('hover item:', await ev(`(() => { const el = document.querySelectorAll('.icn__gpv-mode')[1];
    const s = getComputedStyle(el);
    return JSON.stringify({ bg: s.backgroundColor, color: s.color, font: s.fontSize,
      weight: s.fontWeight, lh: s.lineHeight, h: Math.round(el.getBoundingClientRect().height) }); })()`));
  console.log('active item:', await ev(`(() => { const el = document.querySelectorAll('.icn__gpv-mode')[0];
    const s = getComputedStyle(el);
    return JSON.stringify({ bg: s.backgroundColor, color: s.color }); })()`));

  const panel = await ev(`(() => { const b = document.querySelector('.panel').getBoundingClientRect();
    return JSON.stringify([b.x, b.y, b.width, b.height]); })()`);
  const box = JSON.parse(panel);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/seg.png', Buffer.from(shot.data, 'base64'));
  const zoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: box[0], y: box[1], width: box[2], height: 210, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/seg-zoom.png', Buffer.from(zoom.data, 'base64'));
  ws.close(); child.kill();
})();
