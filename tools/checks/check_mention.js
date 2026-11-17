/* Live check for the "@" reference CHIP in the real ComfyUI page.
   Builds one image asset + one video generator wired together, types "@",
   picks the entry, then verifies: chip DOM (thumbnail + label, atomic),
   plain-text storage, hover preview card, and one-backspace removal. */
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

  /* ComfyUI lands on the user-select screen first: create a throwaway user. */
  await sleep(2500);
  if (await ev(`location.href.includes('/user-select')`)) {
    console.log('login:', await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-chip-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
      return JSON.stringify({ name: el.value, clickedNext: !!next });
    })()`, true));
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
    NS.api.newCanvas();   /* blank doc: earlier runs left nodes behind */
    await new Promise((r) => setTimeout(r, 800));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#2f6f8f"/><circle cx="200" cy="150" r="70" fill="#e0b040"/></svg>';
    const asset = NS.api.addNodeByType('infcanvas/asset_image', [180, 220], {
      name: 'Clipboard_Screenshot.png', filename: 'Clipboard_Screenshot.png', kind: 'image',
      url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
    });
    const gen = NS.api.addNodeByType('infcanvas/gen_video', [760, 200]);
    NS.flow.addEdge({ id: 'probe-edge', source: asset.id, target: gen.id });
    NS.flow.selectNodes([gen.id]);
    window.__probe = { assetId: asset.id, genId: gen.id };
    return JSON.stringify({ ...window.__probe, active: NS.api.isActive() });
  })()`, true));
  await sleep(900);

  /* select the generator with a real click so the overlay panel becomes visible */
  /* Node-scoped query helpers: the canvas may already hold OTHER generator
     nodes (each with its own .icn__gpv-rich / .icn__gpv-asset), so a global
     query would read the wrong panel. */
  console.log('scope:', await ev(`(() => {
    window.__root = () => document.querySelector('[data-id="' + window.__probe.genId + '"]');
    window.__q = (s) => { const r = window.__root(); return r ? r.querySelector(s) : null; };
    window.__qa = (s) => { const r = window.__root(); return r ? [...r.querySelectorAll(s)] : []; };
    return !!window.__root(); })()`));

  /* Select through the API: a synthetic click no longer reliably lands on the
     node header, and the overlay panel is inert (pointer-events:none) while the
     node is unselected. */
  console.log('select:', await ev(`(() => { InfCanvas.flow.selectNodes([window.__probe.genId]);
    InfCanvas.api.revealNode(window.__probe.genId); return 'ok'; })()`));
  await sleep(800);

  /* "文生视频" has no asset slots — switch to "全能参考" so thumbnails show up
     and both preview cards can be compared side by side. */
  console.log('mode:', await ev(`(async () => {
    const btn = [...window.__qa('.icn__gpv-mode')].find((b) => b.textContent.trim() === '全能参考');
    if (!btn) return 'NO BTN';
    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    return JSON.stringify({ slots: window.__qa('.icn__gpv-asset').length });
  })()`, true));

  console.log('panel layout:', await ev(`(() => {
    const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return JSON.stringify({
      node: (function () { const e = document.querySelector('[data-id="' + window.__probe.genId + '"] .icn');
        if (!e) return null; const b = e.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })(),
      panel: pick('.icn__gpv'),
      modes: pick('.icn__gpv-modes'),
      assets: pick('.icn__gpv-assets'),
      slot: pick('.icn__gpv-slot'),
      asset: pick('.icn__gpv-asset'),
      rich: pick('.icn__gpv-rich'),
      bar: pick('.icn__gpv-bar'),
    }); })()`));

  /* put the caret at the end of the prompt and type "参考 @" */
  console.log('focus:', await ev(`(() => { const el = window.__q('.icn__gpv-rich'); el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return document.activeElement === el; })()`));
  await send('Input.insertText', { text: '参考 @' });
  await sleep(400);
  console.log('menu:', await ev(`(() => { const m = window.__q('.icn__gpv-atmenu');
    return m ? JSON.stringify({ items: m.querySelectorAll('.icn__gpv-atitem').length }) : 'NO MENU'; })()`));

  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(500);
  console.log('chip:', await ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    const chip = window.__q('.icn__gpv-ref');
    const el = window.__q('.icn__gpv-rich');
    if (!chip) return JSON.stringify({ prompt: node?.data?.prompt, chip: null, html: el?.innerHTML });
    const b = chip.getBoundingClientRect();
    const label = chip.querySelector('.icn__gpv-ref-t');
    return JSON.stringify({
      prompt: node?.data?.prompt,
      html: el.innerHTML,
      chip: { w: Math.round(b.width), h: Math.round(b.height),
        editable: chip.getAttribute('contenteditable'),
        label: label?.textContent, labelColor: label ? getComputedStyle(label).color : null,
        hasImg: !!chip.querySelector('img'), imgW: chip.querySelector('img')?.getBoundingClientRect().width },
      textBefore: el.textContent,
    }, null, 1);
  })()`));

  /* hover the chip -> preview card */
  /* hover the SLOT thumbnail first, to capture the reference card metrics */
  const sr = JSON.parse(await ev(`(() => { const s = window.__q('.icn__gpv-asset');
    const b = s.getBoundingClientRect(); return JSON.stringify([Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sr[0], y: sr[1], buttons: 0 });
  await sleep(500);
  console.log('slot preview:', await ev(`(() => { const p = window.__q('.icn__gpv-preview:not(.icn__gpv-refprev)');
    if (!p) return 'NO SLOT PREVIEW';
    const b = p.getBoundingClientRect(); const cs = getComputedStyle(p);
    const m = p.querySelector('.icn__gpv-preview-media'); const mr = m?.getBoundingClientRect();
    return JSON.stringify({ w: Math.round(b.width), h: Math.round(b.height), radius: cs.borderRadius,
      border: cs.borderColor, bg: cs.backgroundColor, shadow: cs.boxShadow.slice(0, 30),
      mediaW: mr && Math.round(mr.width), bleed: mr && Math.round(mr.right - (b.right - 1)),
      mediaRadius: m && getComputedStyle(m).borderRadius,
      name: p.querySelector('.icn__gpv-preview-name')?.textContent }); })()`));

  const cr = JSON.parse(await ev(`(() => { const c = window.__q('.icn__gpv-ref');
    const b = c.getBoundingClientRect(); return JSON.stringify([Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cr[0], y: cr[1], buttons: 0 });
  await sleep(500);
  console.log('chip preview:', await ev(`(() => { const p = document.querySelector('.icn__gpv-refprev');
    if (!p) return 'NO PREVIEW';
    const b = p.getBoundingClientRect(); const cs = getComputedStyle(p);
    const chip = window.__q('.icn__gpv-ref').getBoundingClientRect();
    return JSON.stringify({ w: Math.round(b.width), h: Math.round(b.height), above: Math.round(chip.top - b.bottom),
      radius: cs.borderRadius, border: cs.borderColor, bg: cs.backgroundColor, shadow: cs.boxShadow.slice(0, 30),
      name: p.querySelector('.icn__gpv-preview-name')?.textContent,
      centered: Math.round(b.left + b.width / 2 - (chip.left + chip.width / 2)) }); })()`));
  console.log('typography:', await ev(`(() => { const el = window.__q('.icn__gpv-rich');
    const cs = getComputedStyle(el);
    const label = getComputedStyle(window.__q('.icn__gpv-ref-t'));
    const img = window.__q('.icn__gpv-ref-img')?.getBoundingClientRect();
    return JSON.stringify({ font: cs.fontFamily.split(',')[0], size: cs.fontSize, lh: cs.lineHeight,
      h: Math.round(el.getBoundingClientRect().height),
      weight: cs.fontWeight, chipFont: label.fontSize, chipColor: label.color, img: img && Math.round(img.width) }); })()`));
  console.log('geometry:', await ev(`(() => {
    const p = document.querySelector('.icn__gpv-refprev');
    const m = p.querySelector('.icn__gpv-preview-media');
    const pr = p.getBoundingClientRect(), mr = m.getBoundingClientRect();
    return JSON.stringify({
      card: [Math.round(pr.width), Math.round(pr.height)],
      media: [Math.round(mr.width), Math.round(mr.height)],
      bleedLeft: Math.round(pr.left + 1 - mr.left),
      bleedRight: Math.round(mr.right - (pr.right - 1)),
      cardRadius: getComputedStyle(p).borderRadius,
      mediaRadius: getComputedStyle(m).borderRadius,
      nameRadius: getComputedStyle(p.querySelector('.icn__gpv-preview-name')).borderRadius,
    }); })()`));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/chip-hover.png', Buffer.from(shot.data, 'base64'));
  const zb = JSON.parse(await ev(`(() => { const c = window.__q('.icn__gpv-ref').getBoundingClientRect();
    return JSON.stringify([Math.round(c.left), Math.round(c.top)]); })()`));
  const zoomPrev = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: Math.max(0, zb[0] - 130), y: Math.max(0, zb[1] - 230), width: 320, height: 280, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/chip-prev-zoom.png', Buffer.from(zoomPrev.data, 'base64'));

  /* double-clicking the chip must NOT drop a caret inside it */
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cr[0], y: cr[1], button: 'left', clickCount: 2 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cr[0], y: cr[1], button: 'left', clickCount: 2 });
  await sleep(250);
  console.log('caret after dblclick:', await ev(`(() => { const s = getSelection(); const n = s.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const chip = el?.closest?.('.icn__gpv-ref');
    return JSON.stringify({ anchor: n?.nodeName, anchorText: (n?.textContent || '').slice(0, 24), insideChip: !!chip }); })()`));
  /* park the caret where a real insert leaves it: end of the separator space */
  await ev(`(() => { const chip = window.__q('.icn__gpv-ref'); const el = window.__q('.icn__gpv-rich');
    el.focus(); const space = chip.nextSibling; const r = document.createRange();
    if (space && space.nodeType === 3 && space.data.length) r.setStart(space, space.data.length);
    else r.setStartAfter(chip);
    r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r); return 'ok'; })()`);

  /* backspace 1 eats the separator space, backspace 2 removes the chip whole */
  const backspace = async () => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 });
    await sleep(350);
  };
  const readPrompt = async () => ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ prompt: node?.data?.prompt, chips: window.__qa('.icn__gpv-ref').length });
  })()`);
  await backspace();
  console.log('after backspace 1:', await readPrompt());
  await backspace();
  console.log('after backspace 2:', await readPrompt());

  /* reload the value from outside: the token must come back as a chip */
  console.log('reparse:', await ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    node.data.prompt = '第一张参考图：@图片1 女玩家过肩，俯拍，电影光。';
    InfCanvas.flow.updateNodeData(window.__probe.genId, { prompt: node.data.prompt });
    return 'set';
  })()`));
  await sleep(600);
  console.log('reparsed:', await ev(`(() => {
    const el = window.__q('.icn__gpv-rich');
    const chip = el.querySelector('.icn__gpv-ref');
    return JSON.stringify({ chips: el.querySelectorAll('.icn__gpv-ref').length, html: el.innerHTML.slice(0, 260),
      hasImg: !!chip?.querySelector('img') });
  })()`));
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/chip-inline.png', Buffer.from(shot2.data, 'base64'));

  /* select-all inside the editor: the chip's "@图片1" must be part of the text */
  console.log('selection:', await ev(`(() => {
    const el = window.__q('.icn__gpv-rich'); el.focus();
    const r = document.createRange(); r.selectNodeContents(el);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return JSON.stringify({ text: s.toString(), userSelect: getComputedStyle(el.querySelector('.icn__gpv-ref')).userSelect });
  })()`));

  /* paste a copied prompt: tokens must come back as chips, not raw text */
  console.log('paste:', await ev(`(() => {
    const el = window.__q('.icn__gpv-rich');
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/plain', ' 第二张参考图：@图片1 换个角度');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return 'pasted';
  })()`));
  await sleep(400);
  console.log('pasted:', await ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    const el = window.__q('.icn__gpv-rich');
    return JSON.stringify({ prompt: node?.data?.prompt, chips: el.querySelectorAll('.icn__gpv-ref').length,
      text: el.textContent });
  })()`));

  /* close-up of the prompt line so chip/typography alignment is inspectable */
  const pb = JSON.parse(await ev(`(() => { const b = window.__q('.icn__gpv-rich').getBoundingClientRect();
    return JSON.stringify([Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]); })()`));
  const zoom = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: pb[0], y: pb[1], width: pb[2], height: Math.min(60, pb[3]), scale: 3 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/chip-zoom.png', Buffer.from(zoom.data, 'base64'));

  /* clean shot of the panel with the pointer parked away from every hover card */
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: 760, buttons: 0 });
  await sleep(500);
  console.log('leftovers:', await ev(`(() => {
    const list = [...document.querySelectorAll('.icn__gpv-preview, .icn__gpv-refprev')].map((e) => {
      const b = e.getBoundingClientRect();
      return { cls: e.className, rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] };
    });
    const slot = window.__q('.icn__gpv-asset');
    const sb = slot?.getBoundingClientRect();
    return JSON.stringify({ cards: list, slot: sb && [Math.round(sb.left), Math.round(sb.top), Math.round(sb.width), Math.round(sb.height)] });
  })()`));
  const shot3 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/panel-clean.png', Buffer.from(shot3.data, 'base64'));

  ws.close(); child.kill();
})();