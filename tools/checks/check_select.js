/* Live check for the Nodes 2.0 style select in the video generator panel:
   open the workflow list, read its geometry/colours, pick another entry, then
   verify the value and that outside / Escape presses close the popover. */
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
  const ev = async (expr, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) return 'ERR ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const center = async (sel, index = 0) => JSON.parse(await ev(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(sel)})[${index}];
    if (!el) return 'null';
    const b = el.getBoundingClientRect();
    return JSON.stringify([Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]);
  })()`));

  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-sel-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
    })()`, true);
    await sleep(5000);
  }

  let ready = false;
  for (let i = 0; i < 100 && !ready; i += 1) {
    ready = await ev(`!!(window.InfCanvas && InfCanvas.api && InfCanvas.api.addNodeByType && InfCanvas.flow && InfCanvas.flow.state)`);
    if (!ready) await sleep(300);
  }
  console.log('runtime ready:', ready);
  if (!ready) { ws.close(); child.kill(); return; }

  console.log('setup:', await ev(`(async () => {
    const NS = window.InfCanvas;
    await NS.api.enter();
    await new Promise((r) => setTimeout(r, 800));
    const gen = NS.api.addNodeByType('infcanvas/gen_video', [560, 200]);
    NS.flow.selectNodes([gen.id]);
    window.__probe = { genId: gen.id };
    return JSON.stringify(window.__probe);
  })()`, true));
  await sleep(900);

  const gp = await center('.icn--gen', 0);
  await click(gp[0], gp[1] + 24);
  await sleep(700);

  /* --- workflow trigger --- */
  console.log('trigger:', await ev(`(() => {
    const b = document.querySelectorAll('.icn__sel')[0]; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
    return JSON.stringify({ label: b.textContent.trim(), h: Math.round(r.height), radius: cs.borderRadius,
      bg: cs.backgroundColor, font: cs.fontSize, caret: !!b.querySelector('svg') });
  })()`));
  const t1 = await center('.icn__sel', 0);
  await click(t1[0], t1[1]);
  await sleep(400);

  console.log('menu:', await ev(`(() => {
    const m = document.querySelector('.icn__selmenu');
    if (!m) return 'NO MENU';
    const cs = getComputedStyle(m); const b = m.getBoundingClientRect();
    const trig = document.querySelectorAll('.icn__sel')[0].getBoundingClientRect();
    const items = [...m.querySelectorAll('.icn__selitem')];
    const on = m.querySelector('.icn__selitem.is-on');
    const ics = on && getComputedStyle(on);
    return JSON.stringify({
      rect: [Math.round(b.width), Math.round(b.height)],
      gap: Math.round(b.top - trig.bottom),
      bg: cs.backgroundColor, radius: cs.borderRadius, pad: cs.padding, border: cs.borderColor,
      items: items.length, itemH: Math.round(items[0].getBoundingClientRect().height),
      itemPad: getComputedStyle(items[0]).padding, itemFont: getComputedStyle(items[0]).fontSize,
      onBg: ics && ics.backgroundColor, onLabel: on && on.textContent.trim(),
      check: !!(on && on.querySelector('.icn__selitem-check')),
      labels: items.map((i) => i.textContent.trim()),
    });
  })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/select-open.png', Buffer.from(shot.data, 'base64'));
  const mb = JSON.parse(await ev(`(() => { const m = document.querySelector('.icn__selmenu').getBoundingClientRect();
    return JSON.stringify([Math.round(m.left), Math.round(m.top), Math.round(m.width), Math.round(m.height)]); })()`));
  const zoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: Math.max(0, mb[0] - 40), y: Math.max(0, mb[1] - 60), width: mb[2] + 80, height: mb[3] + 100, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/select-zoom.png', Buffer.from(zoom.data, 'base64'));

  /* pick the second entry */
  console.log('pick:', await ev(`(() => {
    const items = [...document.querySelectorAll('.icn__selitem')];
    if (items.length < 2) return 'ONLY ' + items.length;
    const target = items[1];
    const name = target.textContent.trim();
    return JSON.stringify({ name });
  })()`));
  const it = await center('.icn__selitem', 1);
  await click(it[0], it[1]);
  await sleep(400);
  console.log('after pick:', await ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ workflow: node?.data?.workflow, menu: !!document.querySelector('.icn__selmenu'),
      trigger: document.querySelectorAll('.icn__sel')[0].textContent.trim() });
  })()`));

  /* outside press closes — press INSIDE the panel padding, otherwise the click
     would land on empty canvas and deselect the node (hiding the whole panel).
     Use the bottom-centre padding: the corner +3 px is outside the 10px radius
     and belongs to the canvas, which would clear the selection. */
  const pbox = JSON.parse(await ev(`(() => { const b = document.querySelector('.icn__gpv').getBoundingClientRect();
    return JSON.stringify([Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]); })()`));
  const blank = [pbox[0] + Math.round(pbox[2] / 2), pbox[1] + pbox[3] - 5];
  const t2 = await center('.icn__sel', 0);
  await click(t2[0], t2[1]);
  await sleep(300);
  await click(blank[0], blank[1]);
  await sleep(300);
  console.log('outside close:', await ev(`JSON.stringify({ menu: !!document.querySelector('.icn__selmenu'),
    panelVisible: getComputedStyle(document.querySelector('.icn__gpv')).visibility })`));

  /* Escape closes */
  await click(t2[0], t2[1]);
  await sleep(300);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(300);
  console.log('escape close:', await ev(`JSON.stringify({ menu: !!document.querySelector('.icn__selmenu'),
    panelVisible: getComputedStyle(document.querySelector('.icn__gpv')).visibility })`));

  /* size select */
  console.log('sel buttons:', await ev(`JSON.stringify([...document.querySelectorAll('.icn__sel')].map((b) => {
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  }))`));
  const s1 = await center('.icn__sel', 1);
  console.log('size trigger center:', JSON.stringify(s1));
  console.log('hit stack:', await ev(`(() => {
    const probe = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return { at: [x, y], tag: hit && hit.tagName.toLowerCase() + '.' + String(hit.className).slice(0, 30) };
    };
    const btns = [...document.querySelectorAll('.icn__sel')];
    const r0 = btns[0].getBoundingClientRect(); const r1 = btns[1].getBoundingClientRect();
    return JSON.stringify({
      wf: probe(Math.round(r0.left + r0.width / 2), Math.round(r0.top + r0.height / 2)),
      size: probe(Math.round(r1.left + r1.width / 2), Math.round(r1.top + r1.height / 2)),
      wfRect: [Math.round(r0.left), Math.round(r0.top), Math.round(r0.width), Math.round(r0.height)],
      sizeRect: [Math.round(r1.left), Math.round(r1.top), Math.round(r1.width), Math.round(r1.height)],
    });
  })()`));
  await click(s1[0], s1[1]);
  await sleep(400);
  console.log('after real click:', await ev(`JSON.stringify({ menu: !!document.querySelector('.icn__selmenu'),
    cls: [...document.querySelectorAll('.icn__sel')].map((b) => b.className) })`));
  console.log('size menu:', await ev(`(() => {
    const m = document.querySelector('.icn__selmenu');
    if (!m) return 'NO MENU';
    const items = [...m.querySelectorAll('.icn__selitem')];
    const on = m.querySelector('.icn__selitem.is-on');
    return JSON.stringify({ items: items.length, on: on && on.textContent.trim(),
      check: !!(on && on.querySelector('.icn__selitem-check')) });
  })()`));
  const s2 = await center('.icn__selitem', 2);
  await click(s2[0], s2[1]);
  await sleep(400);
  console.log('after size pick:', await ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ w: node?.data?.width, h: node?.data?.height,
      trigger: document.querySelectorAll('.icn__sel')[1].textContent.trim() });
  })()`));

  /* closing shot of the bar without any menu */
  await click(blank[0], blank[1]);
  await sleep(300);
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/select-closed.png', Buffer.from(shot2.data, 'base64'));

  ws.close(); child.kill();
})();
