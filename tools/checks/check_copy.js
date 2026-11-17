/* What actually lands on the clipboard when the prompt (with a @ chip) is
   copied. Grants clipboard access, selects the whole editor, copies, then
   reads text/plain + text/html back. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
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
    '--window-size=1440,900', '--hide-scrollbars',
    '--user-data-dir=' + ROOT + '/.cache/cdp-profile', URL], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60 && !list; i += 1) { await sleep(300); try { list = JSON.parse(await get('/json/list')); } catch (e) { /* wait */ } }
  const target = (list || []).find((t) => t.type === 'page' && t.url.includes('8188'));
  if (!target) { console.log('no page'); child.kill(); return; }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise((res, rej) => {
    const mid = ++id; pend.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method: m, params: p }));
  });
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pend.has(msg.id)) { const { res, rej } = pend.get(msg.id); pend.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
  };
  await new Promise((r) => (ws.onopen = r));
  await send('Page.enable'); await send('Runtime.enable');
  try { await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }); } catch (e) { /* optional */ }
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-copy-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next')?.click();
      return 'ok';
    })()`, true);
    await sleep(5000);
  }
  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    ready = await ev(`!!(window.InfCanvas && InfCanvas.api && InfCanvas.api.addNodeByType && InfCanvas.flow && InfCanvas.flow.state)`);
    if (!ready) await sleep(300);
  }
  if (!ready) { console.log('not ready'); ws.close(); child.kill(); return; }

  await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 800));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2f6f8f"/><circle cx="200" cy="150" r="70" fill="#e0b040"/></svg>';
    const asset = NS.api.addNodeByType('infcanvas/asset_image', [180, 220], {
      name: 'Clipboard_Screenshot.png', filename: 'Clipboard_Screenshot.png', kind: 'image',
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    });
    const gen = NS.api.addNodeByType('infcanvas/gen_video', [760, 200], null);
    NS.flow.addEdge({ id: 'probe-edge', source: asset.id, target: gen.id });
    window.__probe = { assetId: asset.id, genId: gen.id };
    window.__probe.setPrompt = (text) => {
      const node = NS.flow.state.nodes.value.find((n) => n.id === gen.id);
      node.data.prompt = text;
      NS.flow.updateNodeData(gen.id, { prompt: text });
    };
    window.__probe.setPrompt('第一张参考图：@图片1 女玩家过肩，俯拍，电影光。');
    return 'built';
  })()`, true);
  await sleep(800);

  const gp = JSON.parse(await ev(`(() => { const el = [...document.querySelectorAll('.icn--gen')][0];
    const b = el.getBoundingClientRect(); return JSON.stringify([Math.round(b.x + b.width / 2), Math.round(b.y + 24)]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await sleep(500);

  console.log('rendered:', await ev(`(() => { const el = document.querySelector('.icn__gpv-rich');
    return JSON.stringify({ chips: el.querySelectorAll('.icn__gpv-ref').length, html: el.innerHTML.slice(0, 200) }); })()`));

  /* select everything inside the editor, then copy through the real command */
  console.log('selection:', await ev(`(() => {
    const el = document.querySelector('.icn__gpv-rich');
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return JSON.stringify({ text: s.toString(), html: r.cloneContents().querySelectorAll?.('.icn__gpv-ref').length });
  })()`));

  await ev(`document.execCommand('copy')`);
  await sleep(400);
  console.log('clipboard:', await ev(`(async () => {
    let plain = null; let html = null;
    try { plain = await navigator.clipboard.readText(); } catch (e) { plain = 'ERR ' + e.message; }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
    } catch (e) { html = 'ERR ' + e.message; }
    return JSON.stringify({ plain, html: html && html.slice(0, 300) });
  })()`, true));

  /* also: what does a partial selection (starting mid-chip) produce? */
  console.log('double-click chip:', await ev(`(() => {
    const chip = document.querySelector('.icn__gpv-ref');
    const b = chip.getBoundingClientRect();
    return JSON.stringify([Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]);
  })()`));

  ws.close(); child.kill();
})();
