const PORT = Number(process.argv[2] || 9226);
const fs = require('fs');
const URL = 'http://127.0.0.1:8188/extensions/ComfyUI_InfiniteCanvas/__bar_demo.html?t=' + Date.now();
const OUT = 'E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 270, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(1500);

  const clip = { x: 0, y: 0, width: 480, height: 270, scale: 1 };
  let s = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(OUT + 'ours-rest.png', Buffer.from(s.data, 'base64'));

  // hover the speaker (right side, same row)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 456, y: 222, button: 'none', buttons: 0 });
  await sleep(500);
  s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 260, y: 180, width: 220, height: 90, scale: 2 } });
  fs.writeFileSync(OUT + 'ours-hover.png', Buffer.from(s.data, 'base64'));

  // hover the play key
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 24, y: 222, button: 'none', buttons: 0 });
  await sleep(400);
  s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 180, width: 220, height: 90, scale: 2 } });
  fs.writeFileSync(OUT + 'ours-playhover.png', Buffer.from(s.data, 'base64'));

  console.log('shots done');
  process.exit(0);
})();
