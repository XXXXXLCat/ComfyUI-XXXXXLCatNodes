/* Live check for the audio generator's API-parameter popover.
   Verifies: the gear button sits LEFT of the API picker / opening it shows the
   exposed params as ComfyUI widget rows (label left, control right) / the
   ScrubableNumberInput stepper (− value [badge] +) really changes values /
   switch + select rows work / Escape closes it / it is not clipped.
   Needs the temp workflow `音频参数测试` (copied from 文生音乐) in api/. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';
const WF = '音频参数测试';

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b));
  }).on('error', rej);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const child = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--window-size=1600,1200', '--hide-scrollbars',
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
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /* Never trust the profile cache: the point is to test the code we just wrote. */
  await send('Page.reload', { ignoreCache: true });
  await sleep(3000);

  if (await ev(`location.href.includes('/user-select')`)) {
    console.log('login:', await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-param-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
      return JSON.stringify({ clickedNext: !!next });
    })()`, true));
    await sleep(5000);
  }

  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    ready = await ev(`!!(window.InfCanvas && InfCanvas.api && InfCanvas.api.addNodeByType)`);
    if (!ready) await sleep(300);
  }
  console.log('runtime ready:', ready);
  if (!ready) { ws.close(); child.kill(); return; }

  const setup = await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    NS.api.newCanvas();
    await new Promise((r) => setTimeout(r, 900));
    const gen = NS.api.addNodeByType('infcanvas/gen_audio', [640, 180]);
    window.__probe = { gen: gen.id };
    return JSON.stringify({ id: gen.id, workflow: gen.data.workflow });
  })()`, true);
  console.log('setup:', setup);
  const genId = JSON.parse(setup).id;
  await sleep(1200);

  /* Select the node with a real click so the panel (is-selected) is visible. */
  const rect = JSON.parse(await ev(`(() => {
    const el = [...document.querySelectorAll('.vue-flow__node')].find((n) => n.getAttribute('data-id') === ${JSON.stringify(genId)});
    const b = el.getBoundingClientRect();
    return JSON.stringify([Math.round(b.x + b.width / 2), Math.round(b.y + 20)]);
  })()`));
  const clickAt = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(260);
  };
  const center = async (sel, nth = 0) => JSON.parse(await ev(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    const el = els[${nth}];
    if (!el) return 'null';
    const b = el.getBoundingClientRect();
    return JSON.stringify([Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]);
  })()`));
  const click = async (sel, nth = 0) => {
    const p = await center(sel, nth);
    if (!p) { console.log('missing selector', sel, nth); return false; }
    await clickAt(p[0], p[1]);
    return true;
  };

  await clickAt(rect[0], rect[1]);
  await sleep(500);

  /* Pick the temp workflow through the real API dropdown (addNodeByType only
     takes a position, so the workflow is chosen the way a user would). */
  await click('.icn__gpa-bar > .icn__selwrap > .icn__sel');
  await sleep(350);
  const wfNames = await ev(`[...document.querySelectorAll('.icn__gpa-bar > .icn__selwrap .icn__selitem')].map((b) => b.textContent.trim())`);
  const wfIdx = wfNames.findIndex((t) => t.indexOf('音频参数测试') >= 0);
  console.log('workflow list:', JSON.stringify(wfNames), '→ index', wfIdx);
  if (wfIdx >= 0) await click('.icn__gpa-bar > .icn__selwrap .icn__selitem', wfIdx);
  await sleep(1200);
  console.log('after pick:', await ev(`(() => {
    const node = window.InfCanvas.flow.state.nodes.value.find((n) => n.id === ${JSON.stringify(genId)});
    return JSON.stringify({ workflow: node.data.workflow, apiValues: node.data.apiValues });
  })()`));

  console.log('bar:', await ev(`(() => {
    const bar = document.querySelector('.icn__gpa .icn__gpa-bar');
    const gear = bar && bar.querySelector('.icn__gpa-set');
    const sel = bar && bar.querySelector(':scope > .icn__selwrap > .icn__sel');
    const send = bar && bar.querySelector('.icn__gpa-send');
    const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return JSON.stringify({ gear: box(gear), api: box(sel), run: box(send),
      gearBeforeApi: gear && sel ? gear.getBoundingClientRect().right <= sel.getBoundingClientRect().left : null,
      dot: !!bar.querySelector('.icn__gpa-setdot'),
      gearBg: gear && getComputedStyle(gear).backgroundColor }, null, 0);
  })()`));

  await click('.icn__gpa-set');
  await sleep(400);

  console.log('popover:', await ev(`(() => {
    const pop = document.querySelector('.icn__gpa-pop');
    if (!pop) return 'NO POPOVER';
    const cs = getComputedStyle(pop);
    const b = pop.getBoundingClientRect();
    const rows = [...pop.querySelectorAll('.icn__gpa-row')].map((row) => {
      const k = row.querySelector('.icn__gpa-rowk');
      const ctl = row.querySelector('.icn__gpa-num, .icn__gpa-sw, .icn__gpa-rowsel, .icn__gpa-txt');
      const cb = ctl && ctl.getBoundingClientRect();
      const kb = k && k.getBoundingClientRect();
      return {
        label: k && k.textContent.trim(),
        ctl: ctl && ctl.getAttribute('class'),
        h: cb && Math.round(cb.height), w: cb && Math.round(cb.width),
        gap: cb && kb ? Math.round(cb.left - kb.right) : null,
      };
    });
    const pill = pop.querySelector('.icn__gpa-num');
    const pcs = pill && getComputedStyle(pill);
    const badge = pop.querySelector('.icn__gpa-badge');
    return JSON.stringify({
      rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, border: cs.borderTopColor,
      rows, pill: pcs && { bg: pcs.backgroundColor, h: pcs.height, r: pcs.borderTopLeftRadius },
      badge: badge && (() => { const s = getComputedStyle(badge); return { bg: s.backgroundColor, w: s.width, h: s.height, r: s.borderTopLeftRadius }; })(),
      fills: [...pop.querySelectorAll('.icn__gpa-fill')].map((f) => f.style.width),
      clipBottom: Math.round(b.bottom) > window.innerHeight,
    }, null, 1);
  })()`));

  /* − / + on the first numeric row (seed) */
  const before = await ev(`(() => { const n = document.querySelectorAll('.icn__gpa-nin')[0]; return n ? n.value : null; })()`);
  await click('.icn__gpa-nbtn', 1);            /* nth 1 = the "+" of the first pill */
  const afterPlus = await ev(`document.querySelectorAll('.icn__gpa-nin')[0].value`);
  await click('.icn__gpa-nbtn', 0);            /* nth 0 = its "−" */
  const afterMinus = await ev(`document.querySelectorAll('.icn__gpa-nin')[0].value`);
  console.log('stepper:', JSON.stringify({ before, afterPlus, afterMinus }));

  /* shuffle badge on seed */
  await click('.icn__gpa-badge', 0);
  const afterRandom = await ev(`document.querySelectorAll('.icn__gpa-nin')[0].value`);
  /* decimal formatting on the cfg row */
  const cfgBefore = await ev(`document.querySelectorAll('.icn__gpa-nin')[1].value`);
  await click('.icn__gpa-nbtn', 2);
  const cfgAfter = await ev(`document.querySelectorAll('.icn__gpa-nin')[1].value`);
  console.log('random/decimal:', JSON.stringify({ afterRandom, cfgBefore, cfgAfter }));

  /* switch row */
  await click('.icn__gpa-sw', 0);
  console.log('switch:', await ev(`(() => {
    const sw = document.querySelector('.icn__gpa-sw');
    const track = sw.querySelector('.icn__gpa-swt');
    const thumb = sw.querySelector('.icn__gpa-thumb');
    return JSON.stringify({ on: sw.classList.contains('is-on'),
      bg: getComputedStyle(track).backgroundColor,
      thumb: getComputedStyle(thumb).transform, w: getComputedStyle(track).width });
  })()`));

  /* select row → menu → pick "karras" */
  await click('.icn__gpa-rowsel > .icn__sel');
  await sleep(300);
  const menuItems = await ev(`[...document.querySelectorAll('.icn__gpa-rowsel .icn__selitem')].map((b) => b.textContent.trim())`);
  await click('.icn__gpa-rowsel .icn__selitem', 1);
  await sleep(300);
  console.log('select:', JSON.stringify({ menuItems,
    picked: await ev(`document.querySelector('.icn__gpa-rowsel > .icn__sel .icn__sel-t').textContent.trim()`),
    menuClosed: await ev(`!document.querySelector('.icn__gpa-rowsel .icn__selmenu')`) }));

  console.log('values:', await ev(`(() => {
    const node = window.InfCanvas.flow.state.nodes.value.find((n) => n.id === ${JSON.stringify(genId)});
    return JSON.stringify(node.data.apiValues);
  })()`));

  /* screenshot the popover only, at 2x for inspection */
  const clip = JSON.parse(await ev(`(() => {
    const b = document.querySelector('.icn__gpa-pop').getBoundingClientRect();
    return JSON.stringify({ x: Math.floor(b.x) - 6, y: Math.floor(b.y) - 6, width: Math.ceil(b.width) + 12, height: Math.ceil(b.height) + 12 });
  })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/audio-params-pop.png', Buffer.from(shot.data, 'base64'));

  /* full frame as well */
  const full = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/audio-params-full.png', Buffer.from(full.data, 'base64'));

  /* Escape closes it and must NOT deselect the node */
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(400);
  console.log('escape:', await ev(`JSON.stringify({
    pop: !!document.querySelector('.icn__gpa-pop'),
    panelVisible: getComputedStyle(document.querySelector('.icn__gpa')).visibility })`));

  ws.close(); child.kill();
})();
