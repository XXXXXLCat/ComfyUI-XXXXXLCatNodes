const http = require('http');
const PORT = 9224;
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
  const events = [];
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
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      events.push('EXCEPTION ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (r.status >= 400) events.push('HTTP ' + r.status + ' ' + r.url);
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (/infcanvas|InfCanvas/i.test(text)) events.push('[' + msg.params.type + '] ' + text);
    }
  };
  await new Promise((r) => ws.onopen = r);
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8188/' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) return 'EVAL_ERR ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  };
  await sleep(9000);
  console.log('scripts:', await evalJs(`JSON.stringify([...document.querySelectorAll('script[src]')].map(s=>s.src).filter(s=>/infcanvas/i.test(s)))`));
  console.log('InfCanvas keys:', await evalJs(`JSON.stringify(Object.keys(window.InfCanvas||{}))`));
  console.log('--- events ---');
  console.log(events.slice(0, 30).join('\n') || '(none)');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('DRIVER_FAIL', e.message); process.exit(1); });
