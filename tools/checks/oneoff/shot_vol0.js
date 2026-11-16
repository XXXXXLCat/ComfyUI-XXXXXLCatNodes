const PORT = Number(process.argv[2] || 9230);
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
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 270, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(1400);

  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 456, y: 222, button: 'none', buttons: 0 });
  await sleep(500);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 392, y: 222, button: 'none', buttons: 0 });
  await sleep(400);

  // volume at 0%: knob must sit at the pill's left cap centre
  await send('Runtime.evaluate', {
    expression: `(() => {
      const f = document.querySelector('.icn__vol .icn__slider-fill');
      const t = document.querySelector('.icn__vol .icn__slider-thumb');
      f.style.width = '0px';
      t.style.left = '6px';
      return JSON.stringify({ fill: f.getBoundingClientRect().toJSON(), thumb: t.getBoundingClientRect().toJSON(), pill: getComputedStyle(document.querySelector('.icn__vol-group'), '::before').left });
    })()`,
    returnByValue: true
  }).then((r) => console.log(r.result.value));

  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 355, y: 205, width: 130, height: 36, scale: 8 } });
  fs.writeFileSync(OUT + 'zoom-vol0.png', Buffer.from(s.data, 'base64'));
  process.exit(0);
})();
