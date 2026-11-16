/* Bar check for MIXED exposed-field types: select / switch / number / textarea.
   Uses a throwaway workflow copy (音频面板测试) so the user's real config is
   untouched. Verifies wrapping, no overflow, and that each widget writes its
   value into data.apiValues (which core writes into the workflow inputs). */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';
const WF = '音频面板测试';

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1600,1000', '--hide-scrollbars',
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
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-bar-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
      return 'ok';
    })()`, true);
    await sleep(5000);
  }

  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    ready = await ev(`!!(window.InfCanvas && InfCanvas.api && InfCanvas.flow)`);
    if (!ready) await sleep(300);
  }
  console.log('ready:', ready);
  if (!ready) { ws.close(); child.kill(); return; }

  console.log('setup:', await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 900));
    const gen = NS.api.addNodeByType('infcanvas/gen_audio', [700, 260]);
    NS.flow.updateNodeData(gen.id, { workflow: ${JSON.stringify(WF)} });
    NS.flow.selectNodes([gen.id]);
    window.__probe = { id: gen.id };
    await new Promise((r) => setTimeout(r, 900));
    return JSON.stringify({ workflow: gen.data.workflow });
  })()`, true));
  await sleep(700);

  const gp = JSON.parse(await ev(`(() => { const el = document.querySelector('.icn--gen');
    const b = el.getBoundingClientRect(); return JSON.stringify([Math.round(b.x + b.width / 2), Math.round(b.y + 24)]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await sleep(700);

  console.log('cells:', await ev(`(() => {
    const cells = [...document.querySelectorAll('.icn__gpa-fields > *')];
    return JSON.stringify(cells.map((c) => {
      const b = c.getBoundingClientRect();
      return { cls: c.className, x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
        label: c.querySelector('.icn__gpa-k')?.textContent.trim(),
        value: (c.querySelector('input') || {}).value ?? c.querySelector('.icn__gpa-v')?.textContent.trim() };
    })); })()`));

  console.log('bar box:', await ev(`(() => {
    const bar = document.querySelector('.icn__gpa-bar').getBoundingClientRect();
    const panel = document.querySelector('.icn__gpa').getBoundingClientRect();
    const run = document.querySelector('.icn__gpa .icn__gp-send').getBoundingClientRect();
    return JSON.stringify({ bar: [Math.round(bar.width), Math.round(bar.height)],
      panelH: Math.round(panel.height),
      runInside: run.right <= panel.right + 0.5 && run.bottom <= panel.bottom + 0.5,
      spillRight: Math.round(run.right - panel.right) }); })()`));

  console.log('select pick:', await ev(`(async () => {
    const sel = document.querySelector('.icn__gpa-sel');
    if (!sel) return 'NO SELECT';
    sel.click();
    await new Promise((r) => setTimeout(r, 350));
    const menu = sel.parentElement.querySelector('.icn__selmenu');
    const opts = menu ? [...menu.querySelectorAll('.icn__selitem')].map((b) => b.textContent.trim()) : [];
    const karras = menu && [...menu.querySelectorAll('.icn__selitem')].find((b) => b.textContent.trim() === 'karras');
    if (karras) karras.click();
    await new Promise((r) => setTimeout(r, 300));
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.id);
    return JSON.stringify({ opts, trigger: document.querySelector('.icn__gpa-sel .icn__sel-t')?.textContent,
      apiValues: node.data.apiValues, menuClosed: !document.querySelector('.icn__selmenu') });
  })()`, true));

  console.log('switch toggle:', await ev(`(async () => {
    const sw = document.querySelector('.icn__gpa-sw');
    if (!sw) return 'NO SWITCH';
    const before = sw.textContent.trim();
    sw.click();
    await new Promise((r) => setTimeout(r, 250));
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.id);
    const sw2 = document.querySelector('.icn__gpa-sw');
    return JSON.stringify({ before, after: sw2.textContent.trim(), on: sw2.classList.contains('is-on'),
      apiValues: node.data.apiValues });
  })()`, true));

  console.log('prompt build:', await ev(`(async () => {
    const api = window.comfyAPI.api.api;
    const orig = api.queuePrompt;
    window.__cap = null;
    api.queuePrompt = async (...a) => { window.__cap = a[1] && a[1].output; throw new Error('probe-stop'); };
    await InfCanvas.generate.run(window.__probe.id);
    await new Promise((r) => setTimeout(r, 400));
    api.queuePrompt = orig;
    const cap = window.__cap;
    if (!cap) return 'NO PROMPT';
    return JSON.stringify({ scheduler: cap['37_9'].inputs.scheduler, steps: cap['37_9'].inputs.steps,
      switch: cap['37_43'].inputs.switch, top_k: cap['37_13'].inputs.top_k,
      switchType: typeof cap['37_43'].inputs.switch }); })()`, true));

  const clip = JSON.parse(await ev(`(() => { const p = document.querySelector('.icn__gpa').getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, p.left - 8), y: Math.max(0, p.top - 8), w: p.width + 16, h: p.height + 16 }); })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/audio-bar-mixed.png', Buffer.from(shot.data, 'base64'));
  ws.close(); child.kill();
})();
