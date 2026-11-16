/* Screenshots the other-dialog mock (变速 / 宫格 / 调整 / 截取 / 抽帧菜单). */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///E:/Workspace/Workspace-Infinite-Canvas/__dlg2_demo.html';
const OUT = 'E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/';

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
    '--window-size=820,2400', '--hide-scrollbars',
    '--user-data-dir=' + OUT + 'dlg2-profile', URL,
  ], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 40 && !list; i += 1) {
    await sleep(250);
    try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ }
  }
  const target = (list || []).find((t) => t.type === 'page');
  if (!target) { console.log('no page'); child.kill(); return; }
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
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 2400, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(1000);

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (res.exceptionDetails) return { error: res.exceptionDetails.text };
    return res.result.value;
  };
  const shot = async (name, clip) => {
    const res = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
    fs.writeFileSync(OUT + name, Buffer.from(res.data, 'base64'));
  };

  const boxes = await evalJs(`(() => {
    const out = [];
    document.querySelectorAll('.ict-panel').forEach((p) => {
      const b = p.getBoundingClientRect();
      out.push([Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]);
    });
    return JSON.stringify(out);
  })()`);
  console.log('panels', boxes);

  const style = await evalJs(`(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      const b = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height),
        s.backgroundColor, s.color, s.borderRadius, s.fontSize + '/' + s.fontWeight];
    };
    const track = document.querySelector('.ict-field input[type=range]');
    const ts = getComputedStyle(track, '::-webkit-slider-runnable-track');
    return JSON.stringify({
      field: pick('.ict-field'), fieldSlider: pick('.ict-field input[type=range]'),
      numberInField: pick('.ict-field .ict-input'), chip: pick('.ict-chip'),
      chipActive: pick('.ict-chip.is-active'), preset: pick('.ict-grid-preset'),
      presetActive: pick('.ict-grid-preset.is-active'), customBtn: pick('.ict-grid-custom-btn'),
      sliderLabel: pick('.ict-slider'), input: pick('.ict-times .ict-input'),
      menuItem: pick('.ict-menu button'), menuSpan: pick('.ict-menu button span'),
      rangeHeight: ts.height, rangeRadius: ts.borderRadius
    }, null, 1);
  })()`);
  console.log(style);

  const panels = JSON.parse(boxes);
  const names = ['speed', 'grid', 'adjust', 'trim'];
  for (let i = 0; i < panels.length; i += 1) {
    const [x, y, w, h] = panels[i];
    await shot('dlg2-' + names[i] + '.png', { x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: h + 12 });
  }
  const menuBox = JSON.parse(await evalJs(`(() => {
    const b = document.querySelector('.ict-menu').getBoundingClientRect();
    return JSON.stringify([b.x, b.y, b.width, b.height]);
  })()`));
  await shot('dlg2-menu.png', { x: menuBox[0] - 8, y: menuBox[1] - 8, width: menuBox[2] + 16, height: menuBox[3] + 16 });

  ws.close();
  child.kill();
})();
