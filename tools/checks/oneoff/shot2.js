const PORT = 9226, fs = require('fs');
const URL = 'http://127.0.0.1:8188/extensions/ComfyUI_InfiniteCanvas/__native.html';
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 270, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 3500));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/native-nolist.png', Buffer.from(s.data, 'base64'));
  console.log('done');
  process.exit(0);
})();
