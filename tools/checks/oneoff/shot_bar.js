const http = require('http');
const fs = require('fs');
const PORT = 9225;

const get = (path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
    let b = '';
    res.on('data', (c) => b += c);
    res.on('end', () => resolve(b));
  }).on('error', reject);
});

(async () => {
  const list = JSON.parse(await get('/json/list'));
  const target = list.find((t) => t.type === 'page');
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
  await new Promise((r) => ws.onopen = r);
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 700, height: 400, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: 'http://127.0.0.1:8188/extensions/ComfyUI_InfiniteCanvas/__bar_demo.html' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(1500);

  const shot = async (name, clip) => {
    const res = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/' + name, Buffer.from(res.data, 'base64'));
  };

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return res.result.value;
  };

  const box = await evalJs(`(() => {
    const g = document.querySelector('.icn__vol-group').getBoundingClientRect();
    const b = document.querySelector('.icn__btn--vol').getBoundingClientRect();
    return JSON.stringify({ group: [g.x, g.y, g.width, g.height], btn: [b.x, b.y, b.width, b.height] });
  })()`);
  console.log('geometry:', box);
  const g = JSON.parse(box);

  // rest state: pointer parked far away
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, button: 'none' });
  await sleep(400);
  await shot('bar-rest.png', { x: 0, y: 150, width: 480, height: 120 });

  // hover state: pointer on the speaker
  const cx = g.btn[0] + g.btn[2] / 2;
  const cy = g.btn[1] + g.btn[3] / 2;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy, button: 'none' });
  await sleep(600);
  console.log('hovered:', await evalJs(`!!document.querySelector('.icn__vol-group:hover')`));
  console.log('vol width:', await evalJs(`document.querySelector('.icn__vol').getBoundingClientRect().width`));
  console.log('group width:', await evalJs(`document.querySelector('.icn__vol-group').getBoundingClientRect().width`));
  await shot('bar-hover.png', { x: 0, y: 150, width: 480, height: 120 });

  ws.close();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
