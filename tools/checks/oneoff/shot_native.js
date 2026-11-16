// Screenshot the native video control bar at exact size, then hover the
// volume button to capture the expanded slider.
const PORT = Number(process.argv[2] || 9225);
const URL = 'http://127.0.0.1:8188/extensions/ComfyUI_InfiniteCanvas/__native.html';
const fs = require('fs');
const OUT = 'E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/';

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, close: () => ws.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { send, close } = await connect();
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 520, height: 300, deviceScaleFactor: 2, mobile: false
  });
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  const clip = { x: 0, y: 0, width: 480, height: 270, scale: 2 };
  let shot = await send('Page.captureScreenshot', { format: 'png', clip });
  fs.writeFileSync(OUT + 'native-rest.png', Buffer.from(shot.data, 'base64'));
  console.log('rest shot done');

  // find the volume button position: query the panel geometry via JS is not
  // possible for UA shadow DOM, so probe a few x positions along the bar.
  const boxes = await send('Runtime.evaluate', {
    expression: `(() => { const b = document.getElementById('v').getBoundingClientRect();
      return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height}); })()`,
    returnByValue: true
  });
  console.log('video box', boxes.result.value);

  // Volume button is the 3rd control from the right in current Chrome;
  // try hovering x = right - 125 (skipping overflow menu + fullscreen).
  const candidates = [125, 105, 145, 165];
  for (const dx of candidates) {
    const px = 480 - dx;
    const py = 270 - 22;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px - 30, y: py, button: 'none', buttons: 0 });
    await sleep(80);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', buttons: 0 });
    await sleep(600);
    const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 300, y: 200, width: 180, height: 70, scale: 2 } });
    fs.writeFileSync(OUT + `native-hover-${dx}.png`, Buffer.from(s.data, 'base64'));
    console.log('hover candidate dx=' + dx + ' -> native-hover-' + dx + '.png');
  }

  close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
