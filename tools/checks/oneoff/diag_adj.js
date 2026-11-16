const http = require('http');
const { spawn } = require('child_process');
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///E:/Workspace/Workspace-Infinite-Canvas/__dlg2_demo.html';
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1080,600', '--hide-scrollbars',
    '--user-data-dir=E:/Workspace/Workspace-Infinite-Canvas/.cache/cdp-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40 && !list; i += 1) { await sleep(250); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* retry */ } }
  const t = (list || []).find((x) => x.type === 'page');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method: m, params: p }));
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const { res, rej } = pend.get(m.id); pend.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Runtime.enable');
  await sleep(1200);
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) return r.exceptionDetails.text;
    return r.result.value;
  };
  console.log(await ev(`(() => {
    const out = [];
    document.querySelectorAll('.ict-slider').forEach((row, i) => {
      const inp = row.querySelector('input'), o = row.querySelector('output');
      const ib = inp.getBoundingClientRect(), ob = o.getBoundingClientRect(), rb = row.getBoundingClientRect();
      out.push({ i, val: inp.value, row: [Math.round(rb.x), Math.round(rb.width)],
        input: [Math.round(ib.x), Math.round(ib.width)], out: [Math.round(ob.x), Math.round(ob.width)] });
    });
    return JSON.stringify(out, null, 1);
  })()`));
  ws.close();
  child.kill();
})();
