/* Where does Ctrl+Z land? Records keydown on window/document, capture+bubble,
   then reports which phase saw it and whether it was already prevented. */
const http = require('http');
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
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, includeCommandLineAPI: true });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-key-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
    })()`, true);
    await sleep(5000);
  }
  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) { ready = await ev(`!!(window.InfCanvas && InfCanvas.flow)`); if (!ready) await sleep(300); }
  console.log('ready:', ready);
  console.log('enter:', await ev(`(async () => { await InfCanvas.api.enter(); return 'ok'; })()`, true));
  await sleep(1500);
  console.log('active:', await ev(`InfCanvas.api.isActive()`), 'toolsOpen:', await ev(`!!InfCanvas.tools?.isOpen?.()`),
    'target:', await ev(`document.activeElement && document.activeElement.tagName`));

  console.log('scripts:', await ev(`JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /infcanvas/i.test(n)))`));
  console.log('scripts:', await ev(`JSON.stringify(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /infcanvas/i.test(n)))`));
  console.log('listeners:', await ev(`JSON.stringify((getEventListeners(document).keydown || []).map((l) => (l.useCapture ? 'capture' : 'bubble') + ':' + (l.listener.name || 'anon') + ':' + String(l.listener).slice(0, 60)))`));
  console.log('listeners:', await ev(`JSON.stringify((getEventListeners(document).keydown || []).map((l) => (l.useCapture ? 'capture' : 'bubble') + ':' + (l.listener.name || 'anon') + ':' + String(l.listener).slice(0, 60)))`));
  console.log('dialog probe:', await ev(`JSON.stringify({ dlg: !!document.querySelector('[data-reka-dialog-content][data-state="open"]'),
    reka: [...document.querySelectorAll('[data-reka-dialog-content]')].map((e) => e.getAttribute('data-state')),
    target: document.activeElement?.tagName, toolsClosed: !InfCanvas.tools?.isOpen?.() })`));
  console.log('dialog probe:', await ev(`JSON.stringify({ dlg: !!document.querySelector('[data-reka-dialog-content][data-state="open"]'),
    reka: [...document.querySelectorAll('[data-reka-dialog-content]')].map((e) => e.getAttribute('data-state')),
    target: document.activeElement?.tagName, toolsClosed: !InfCanvas.tools?.isOpen?.() })`));
  console.log('dialog detail:', await ev(`(() => {
    const d = document.querySelector('[data-reka-dialog-content][data-state="open"]');
    if (!d) return 'none';
    const b = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    return JSON.stringify({ cls: String(d.className).slice(0, 90), rect: [Math.round(b.width), Math.round(b.height)],
      disp: cs.display, vis: cs.visibility, op: cs.opacity, inRoot: !!d.closest('#infcanvas-root'),
      role: d.getAttribute('role'), text: (d.textContent || '').trim().slice(0, 60) });
  })()`));
  console.log('dialog detail:', await ev(`(() => {
    const d = document.querySelector('[data-reka-dialog-content][data-state="open"]');
    if (!d) return 'none';
    const b = d.getBoundingClientRect();
    const cs = getComputedStyle(d);
    return JSON.stringify({ cls: String(d.className).slice(0, 90), rect: [Math.round(b.width), Math.round(b.height)],
      disp: cs.display, vis: cs.visibility, op: cs.opacity, inRoot: !!d.closest('#infcanvas-root'),
      role: d.getAttribute('role'), text: (d.textContent || '').trim().slice(0, 60) });
  })()`));
  console.log('recorder:', await ev(`(() => {
    window.__keys = [];
    const rec = (tag) => (e) => { if ((e.key || '').toLowerCase() === 'z') window.__keys.push(tag + ' ctrl=' + e.ctrlKey + ' prevented=' + e.defaultPrevented); };
    window.addEventListener('keydown', rec('window-capture'), true);
    document.addEventListener('keydown', rec('document-capture'), true);
    document.body.addEventListener('keydown', rec('body-capture'), true);
    window.addEventListener('keydown', rec('window-bubble'), false);
    document.addEventListener('keydown', rec('document-bubble'), false);
    document.body.addEventListener('keydown', rec('body-bubble'), false);
    return 'ok';
  })()`));
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 90, modifiers: 2 });
  await sleep(400);
  console.log('hits:', await ev(`JSON.stringify(window.__keys)`));

  /* same but synthesised from inside the page */
  console.log('synthetic:', await ev(`(() => {
    window.__keys = [];
    const e = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    return JSON.stringify(window.__keys);
  })()`));

  ws.close(); child.kill();
})();
