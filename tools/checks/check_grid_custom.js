/* Live check in the real ComfyUI page: 宫格 → 自定义 must open at 行3 / 列3,
   even right after clicking a preset. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1500,1000', '--hide-scrollbars',
    '--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.cache/cdp-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let n = 0; n < 60 && !list; n += 1) { await sleep(300); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('8188'));
  if (!target) { console.log('no page', JSON.stringify(list?.[0]?.url)); child.kill(); return; }
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
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  // wait for the extension
  let ready = false;
  for (let n = 0; n < 60 && !ready; n += 1) {
    ready = await ev('!!(window.InfCanvas && window.InfCanvas.tools)');
    if (!ready) await sleep(500);
  }
  console.log('extension ready:', ready);
  if (!ready) { ws.close(); child.kill(); return; }

  console.log('open grid:', await ev(`(async () => {
    await InfCanvas.tools.registry.grid({
      id: 'probe', url: '/view?filename=example.png&type=input',
      data: { asset: { name: 'example.png', kind: 'image' } },
    });
    return 'ok';
  })()`, true));

  await sleep(1200);
  const read = () => ev(`(() => {
    const rows = document.querySelector('.ict-grid-custom input[data-f=rows]');
    const cols = document.querySelector('.ict-grid-custom input[data-f=cols]');
    const out = (k) => document.querySelector('.ict-grid-custom output[data-o=' + k + ']')?.textContent;
    const active = [...document.querySelectorAll('.ict-grid-preset.is-active')].map((c) => c.dataset.grid);
    const summary = document.querySelector('.ict-grid-summary, .ict-summary')?.textContent;
    const fill = rows ? rows.style.getPropertyValue('--ict-p') : null;
    return JSON.stringify({ rows: rows?.value, cols: cols?.value, outRows: out('rows'), outCols: out('cols'),
      activePresets: active, summary, hidden: document.querySelector('.ict-grid-custom')?.hidden, fill });
  })()`);

  console.log('初始（预设 9 宫格）:', await read());
  console.log('点 4 宫格:', await ev(`document.querySelectorAll('.ict-grid-preset')[2].click(); 'clicked'`), await read());
  console.log('点 25 宫格:', await ev(`document.querySelectorAll('.ict-grid-preset')[3].click(); 'clicked'`), await read());
  console.log('点 自定义:', await ev(`document.querySelector('.ict-grid-custom-btn').click(); 'clicked'`), await read());

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/grid-live.png', Buffer.from(shot.data, 'base64'));
  ws.close();
  child.kill();
})();
