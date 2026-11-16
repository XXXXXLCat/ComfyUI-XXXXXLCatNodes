const PORT = 9231;
(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') { console.log('EXC', JSON.stringify(m.params.exceptionDetails.text), m.params.exceptionDetails.exception?.description?.slice(0,200)); } else if (m.method === 'Runtime.consoleAPICalled') { console.log('LOG', JSON.stringify(m.params.args.map(a=>a.value))); } };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8188/extensions/ComfyUI_InfiniteCanvas/__audio_demo.html?t=' + Date.now() });
  await new Promise((r) => setTimeout(r, 1500));
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify({geo: window.__geo||null, body: document.body.innerHTML.length, canvas: !!document.querySelector("canvas"), cw: document.querySelector("canvas")?.width})', returnByValue: true });
  console.log(r.result.value);
  process.exit(0);
})();
