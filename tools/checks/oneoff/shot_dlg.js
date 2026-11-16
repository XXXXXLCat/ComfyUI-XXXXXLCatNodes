/* Screenshots the audio clip dialog mock: rest state + hover states, and dumps
   the computed geometry of every Nodes 2.0 control. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///E:/Workspace/Workspace-Infinite-Canvas/__dlg_demo.html';

const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
    let b = '';
    res.on('data', (c) => (b += c));
    res.on('end', () => resolve(b));
  }).on('error', reject);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--window-size=820,700', '--hide-scrollbars',
    '--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/dlg-profile',
    URL,
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40 && !list; i += 1) {
    await sleep(250);
    try { list = JSON.parse(await get('/json/list')); } catch (e) { /* not up yet */ }
  }
  const target = (list || []).find((t) => t.type === 'page');
  if (!target) { console.log('no page target'); child.kill(); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await sleep(1200);

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (res.exceptionDetails) return { error: res.exceptionDetails.text };
    return res.result.value;
  };

  const shot = async (name, clip) => {
    const res = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
    fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/' + name, Buffer.from(res.data, 'base64'));
  };

  const geom = await evalJs(`(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return { box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
        bg: s.backgroundColor, color: s.color, radius: s.borderRadius, border: s.borderWidth,
        font: s.fontSize + '/' + s.fontWeight, family: s.fontFamily.split(',')[0] };
    };
    return JSON.stringify({
      panel: pick('.ict-panel'),
      toolBtn: pick('.ict-toolrow .ict-btn'),
      splitBtn: pick('.ict-toolrow [data-act=split]'),
      play: pick('.ict-play'),
      seg: pick('.ict-clip-seg'),
      segSel: pick('.ict-clip-seg.is-selected'),
      hint: pick('.ict-player .ict-hint'),
      toolHint: pick('.ict-toolrow .ict-hint'),
      time: pick('.ict-player time'),
      cur: pick('.ict-player time b'),
      cancel: pick('.ict-actions .ict-btn'),
      apply: pick('.ict-actions .ict-btn--primary'),
      close: pick('.ict-x'),
      status: pick('.ict-status')
    }, null, 1);
  })()`);
  console.log(geom);
  await sleep(200);
  await shot('dlg-rest.png', { x: 0, y: 0, width: 800, height: 470 });

  const hoverAt = async (sel, name, clip) => {
    const box = JSON.parse(await evalJs(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect();
      return JSON.stringify([b.x + b.width / 2, b.y + b.height / 2]); })()`));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0], y: box[1], button: 'none' });
    await sleep(350);
    const bg = await evalJs(`getComputedStyle(document.querySelector('${sel}')).backgroundColor`);
    console.log('hover', sel, '->', bg);
    await shot(name, clip);
  };
  await hoverAt('.ict-toolrow [data-act=split]', 'dlg-hover-split.png', { x: 0, y: 258, width: 800, height: 44 });
  await hoverAt('.ict-actions .ict-btn--primary', 'dlg-hover-apply.png', { x: 400, y: 390, width: 400, height: 80 });
  await hoverAt('.ict-clip-seg', 'dlg-hover-seg.png', { x: 0, y: 200, width: 800, height: 80 });

  ws.close();
  child.kill();
})();
