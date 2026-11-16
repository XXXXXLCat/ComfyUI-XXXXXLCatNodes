const PORT = Number(process.argv[2] || 9227);
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
  await sleep(1500);

  // hover the speaker -> pill opens
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 456, y: 222, button: 'none', buttons: 0 });
  await sleep(600);

  // hover the volume slider itself so the knob is painted
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 400, y: 222, button: 'none', buttons: 0 });
  await sleep(500);

  // tight crop of the whole volume control, 8x
  let s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 360, y: 205, width: 120, height: 36, scale: 8 } });
  fs.writeFileSync(OUT + 'zoom-vol.png', Buffer.from(s.data, 'base64'));

  // metrics of the geometry
  const js = `(() => {
    const g = document.querySelector('.icn__vol-group');
    const p = getComputedStyle(g, '::before');
    const v = document.querySelector('.icn__vol');
    const t = document.querySelector('.icn__vol .icn__slider-thumb');
    const b = document.querySelector('.icn__btn--play');
    const gb = g.getBoundingClientRect();
    const pb = document.querySelector('.icn__btn--play').getBoundingClientRect();
    return JSON.stringify({
      groupH: gb.height, playH: pb.height,
      groupRight: gb.right, playLeft: pb.left, nodeRight: 480,
      speakerRight: document.querySelector('.icn__btn--vol').getBoundingClientRect().right,
      pillBg: p.backgroundColor, pillRadius: p.borderRadius,
      pillTop: p.top, pillBottom: p.bottom, pillLeft: p.left, pillRight: p.right,
      volW: v.getBoundingClientRect().width,
      thumb: t.getBoundingClientRect().toJSON(),
      volBox: v.getBoundingClientRect().toJSON()
    });
  })()`;
  const r = await send('Runtime.evaluate', { expression: js, returnByValue: true });
  console.log(r.result.value);
  process.exit(0);
})();
