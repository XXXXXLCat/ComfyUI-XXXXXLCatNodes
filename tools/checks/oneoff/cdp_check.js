const http = require('http');

const PORT = 9223;
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
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      events.push('[' + msg.params.type + '] ' + text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      events.push('[EXCEPTION] ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Log.entryAdded') {
      events.push('[' + msg.params.entry.level + '] ' + msg.params.entry.text);
    }
  };

  await new Promise((r) => ws.onopen = r);
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8188/' });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) return 'EVAL_ERR ' + (res.exceptionDetails.exception?.description || res.exceptionDetails.text);
    return res.result.value;
  };

  // wait for extension modules
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs('!!(window.InfCanvas && window.InfCanvas.flow && window.InfCanvas.api)');
    if (ok === true) break;
    await sleep(250);
  }
  console.log('flow ready:', await evalJs('!!(window.InfCanvas && window.InfCanvas.flow)'));
  console.log('api ready :', await evalJs('!!(window.InfCanvas && window.InfCanvas.api)'));

  console.log('enter ->', await evalJs('(async()=>{try{await window.InfCanvas.api.enter();return "entered";}catch(e){return "FAIL "+e.message+" | "+(e.stack||"").split("\\n")[1];}})()'));
  await sleep(3000);
  console.log(await evalJs(`JSON.stringify({
    active: window.InfCanvas.api.isActive(),
    root: !!document.getElementById('infcanvas-root'),
    host: !!document.getElementById('infcanvas-vueflow'),
    vueFlow: !!document.querySelector('.vue-flow'),
    nodes: document.querySelectorAll('.vue-flow__node').length,
    toast: [...document.querySelectorAll('.p-toast-message')].map(e=>e.textContent.trim()).join(' | ')
  })`));

  console.log('--- console/errors ---');
  console.log(events.filter((e) => /infcanvas|InfCanvas|error|Error|Uncaught|warn/i.test(e)).slice(-40).join('\n') || '(none)');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('DRIVER_FAIL', e); process.exit(1); });
