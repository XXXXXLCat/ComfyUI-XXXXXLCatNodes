/* Static check: the node action row must stay hidden on hover and only appear
   when the node carries `is-selected`. Uses the real CSS literal from
   infcanvas-flow.js, real mouse events through CDP. */
const fs = require('fs');
const path = 'E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-flow.js';
const src = fs.readFileSync(path, 'utf8');

const start = src.indexOf('const CSS = `');
if (start < 0) throw new Error('CSS literal not found');
let i = start + 'const CSS = `'.length;
let buf = '';
while (i < src.length) {
  const c = src[i];
  if (c === '\\') { buf += src[i] + src[i + 1]; i += 2; continue; }
  if (c === '`') break;
  buf += c; i++;
}
const literal = '`' + buf + '`';

const consts = {};
const re = /const ([A-Z][A-Z0-9_]{2,}) = ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?[\d.]+);/g;
let m;
while ((m = re.exec(src))) {
  consts[m[1]] = /^["']/.test(m[2]) ? JSON.parse(m[2].replace(/^'|'$/g, '"')) : Number(m[2]);
}
const aliasRe = /const ([A-Z][A-Z0-9_]{2,}) = ([A-Z][A-Z0-9_]{2,});/g;
while ((m = aliasRe.exec(src))) if (m[2] in consts) consts[m[1]] = consts[m[2]];
const proxy = new Proxy({}, {
  has: () => true,
  get: (t, k) => {
    if (typeof k === 'symbol') return undefined;
    if (k in consts) return consts[k];
    throw new Error('unresolved interpolation: ' + String(k));
  },
});
const css = new Function('c', 'with (c) { return ' + literal + '; }')(proxy);

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;font-family:Inter,system-ui,sans-serif;}
#infcanvas-vueflow{position:relative;padding:120px 60px;}
</style><style>${css}</style></head><body>
<div id="infcanvas-vueflow">
  <div class="icn icn--asset" id="node" style="position:relative;width:480px;height:270px;background:#262729;border-radius:12px">
    <div class="icn__tools" id="tools">
      <button class="icn__tool" type="button">裁剪</button>
      <button class="icn__tool" type="button">网格</button>
      <button class="icn__tool" type="button">下载</button>
    </div>
  </div>
</div></body></html>`;
fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/__tools_demo.html', html);

const http = require('http');
const { spawn } = require('child_process');
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/__tools_demo.html';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=900,700', '--hide-scrollbars',
    '--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.cache/cdp-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 40 && !list; n += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page');
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
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await sleep(700);

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) return r.exceptionDetails.text;
    return r.result.value;
  };
  const state = () => ev(`(() => {
    const t = document.getElementById('tools'), s = getComputedStyle(t);
    const b = t.getBoundingClientRect();
    return JSON.stringify({ opacity: s.opacity, visibility: s.visibility,
      box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)],
      selected: document.getElementById('node').classList.contains('is-selected') });
  })()`);

  console.log('初始(未选中/未悬停):', await state());

  // hover the node centre
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 340, buttons: 0 });
  await sleep(300);
  console.log('悬停未选中:', await state());

  // select it
  await ev(`document.getElementById('node').classList.add('is-selected')`);
  await sleep(300);
  console.log('选中:', await state());

  // mouse far away, still selected
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 860, y: 60, buttons: 0 });
  await sleep(300);
  console.log('选中且鼠标移开:', await state());

  // deselect
  await ev(`document.getElementById('node').classList.remove('is-selected')`);
  await sleep(300);
  console.log('取消选中:', await state());

  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 40, y: 60, width: 560, height: 420, scale: 2 } });
  fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/tools-hover-off.png', Buffer.from(shot.data, 'base64'));
  ws.close();
  child.kill();
})();
