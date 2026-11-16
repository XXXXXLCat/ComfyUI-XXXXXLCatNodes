/* Live check for the reworked AUDIO generator panel.
   Verifies: 4 mode tabs / two prompt areas (music + voice labels) / API
   dropdown bottom-left / API-exposed fields on the right, the real values
   landing in the workflow's own node inputs (captured queue prompt), and the
   layout + a screenshot. */
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';
const WF = '文生音乐：MiniMax Music 3';

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
    console.log('login:', await ev(`(async () => {
      const el = document.querySelector('#new-user-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'probe-audio-' + Date.now().toString().slice(-6));
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
    await new Promise((r) => setTimeout(r, 900));
    const gen = NS.api.addNodeByType('infcanvas/gen_audio', [700, 260]);
    NS.flow.selectNodes([gen.id]);
    window.__probe = { genId: gen.id };
    return JSON.stringify({ id: gen.id, role: gen.data.role, kind: gen.data.kind, workflow: gen.data.workflow });
  })()`, true));
  await sleep(900);

  /* real click so the panel is actually visible (is-selected) */
  const gp = JSON.parse(await ev(`(() => { const el = document.querySelector('.icn--gen');
    const b = el.getBoundingClientRect(); return JSON.stringify([Math.round(b.x + b.width / 2), Math.round(b.y + 24)]); })()`));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gp[0], y: gp[1], button: 'left', clickCount: 1 });
  await sleep(600);

  console.log('modes:', await ev(`(() => {
    const els = [...document.querySelectorAll('.icn__gpa .icn__gpv-mode')];
    const cs = els[0] && getComputedStyle(els[0]);
    return JSON.stringify({
      labels: els.map((e) => e.textContent.trim()),
      on: els.filter((e) => e.classList.contains('is-on')).map((e) => e.textContent.trim()),
      size: cs && cs.fontSize, color: cs && cs.color, h: els[0] && Math.round(els[0].getBoundingClientRect().height),
    }); })()`));

  console.log('areas:', await ev(`(() => {
    const boxes = [...document.querySelectorAll('.icn__gpa-box')];
    return JSON.stringify(boxes.map((box) => {
      const ta = box.querySelector('textarea'); const b = ta.getBoundingClientRect();
      const cs = getComputedStyle(ta);
      return { label: box.querySelector('.icn__gpa-label').textContent.trim(),
        ph: ta.getAttribute('placeholder'), h: Math.round(b.height), font: cs.fontSize,
        bg: cs.backgroundColor, radius: cs.borderRadius };
    })); })()`));

  console.log('bar (empty fields):', await ev(`(() => {
    const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    return JSON.stringify({ panel: pick('.icn__gpa'), bar: pick('.icn__gpa-bar'),
      api: pick('.icn__gpa-bar > .icn__selwrap'), apiText: document.querySelector('.icn__gpa-bar .icn__sel-t')?.textContent,
      gear: pick('.icn__gpa-set'), gearLeftOfApi: (() => {
        const g = document.querySelector('.icn__gpa-set'); const a = document.querySelector('.icn__gpa-bar > .icn__selwrap');
        return g && a ? g.getBoundingClientRect().right <= a.getBoundingClientRect().left : null; })(),
      run: pick('.icn__gpa .icn__gp-send') }); })()`));

  /* pick the real music workflow from the API dropdown */
  console.log('api menu:', await ev(`(async () => {
    document.querySelector('.icn__gpa-bar .icn__sel').click();
    await new Promise((r) => setTimeout(r, 350));
    const menu = document.querySelector('.icn__gpa-bar .icn__selmenu');
    const items = menu ? [...menu.querySelectorAll('.icn__selitem')].map((b) => b.textContent.trim()) : [];
    return JSON.stringify({ open: !!menu, items });
  })()`, true));

  console.log('pick workflow:', await ev(`(async () => {
    const menu = document.querySelector('.icn__gpa-bar .icn__selmenu');
    const hit = [...menu.querySelectorAll('.icn__selitem')].find((b) => b.textContent.trim() === ${JSON.stringify(WF)});
    if (!hit) return 'NO ITEM';
    hit.click();
    await new Promise((r) => setTimeout(r, 900));
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ workflow: node.data.workflow, apiLabel: document.querySelector('.icn__gpa-bar .icn__sel-t')?.textContent,
      audioMap: node.data.audioMap });
  })()`, true));
  await sleep(400);

  /* the exposed params live in the gear popover now */
  console.log('popover fields:', await ev(`(async () => {
    const gear = document.querySelector('.icn__gpa-set');
    gear.click();
    await new Promise((r) => setTimeout(r, 400));
    const pop = document.querySelector('.icn__gpa-pop');
    if (!pop) return 'NO POPOVER';
    const rows = [...pop.querySelectorAll('.icn__gpa-row')].map((row) => {
      const k = row.querySelector('.icn__gpa-rowk');
      const ctl = row.querySelector('.icn__gpa-num, .icn__gpa-sw, .icn__gpa-rowsel, .icn__gpa-txt');
      const cb = ctl && ctl.getBoundingClientRect();
      const cs = ctl && getComputedStyle(ctl);
      const num = ctl && ctl.querySelector('.icn__gpa-nin');
      const txt = ctl && ctl.querySelector('.icn__gpa-tin');
      const sel = ctl && ctl.querySelector('.icn__sel-t');
      return { label: k && k.textContent.trim(), kind: ctl && ctl.getAttribute('class'),
        w: cb && Math.round(cb.width), h: cb && Math.round(cb.height),
        bg: cs && cs.backgroundColor, r: cs && cs.borderTopLeftRadius,
        value: num ? num.value : txt ? txt.value : sel ? sel.textContent.trim() : null };
    });
    const b = pop.getBoundingClientRect();
    return JSON.stringify({ rect: [Math.round(b.width), Math.round(b.height)],
      bg: getComputedStyle(pop).backgroundColor, rows }, null, 1);
  })()`, true));

  /* type into both areas */
  await ev(`(() => { const ta = document.querySelectorAll('.icn__gpa-area')[0];
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return true; })()`);
  await send('Input.insertText', { text: '温暖的女声民谣，木吉他分解和弦，80bpm' });
  await sleep(200);
  await ev(`(() => { const ta = document.querySelectorAll('.icn__gpa-area')[1];
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return true; })()`);
  await send('Input.insertText', { text: '[Verse]\n风把夏天吹成了从前\n\n[Chorus]\n我们还在原地打转' });
  await sleep(300);
  console.log('typed:', await ev(`(() => {
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ prompt: node.data.prompt, lyrics: node.data.lyrics }); })()`));

  /* change 时长 (number field) to 120 through its real input in the popover */
  console.log('field edit:', await ev(`(() => {
    const pop = document.querySelector('.icn__gpa-pop');
    if (!pop) return 'NO POPOVER';
    const inputs = [...pop.querySelectorAll('.icn__gpa-nin')];
    const dur = inputs.find((i) => Number(i.value) === 300);
    if (!dur) return 'NO DURATION ROW: ' + inputs.map((i) => i.value).join(',');
    dur.value = '120';
    dur.dispatchEvent(new Event('change', { bubbles: true }));
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ apiValues: node.data.apiValues, shown: dur.value });
  })()`));
  /* close it so the screenshot shows the resting bar */
  await ev(`(() => { document.querySelector('.icn__gpa-set').click(); return true; })()`);
  await sleep(300);

  /* capture the prompt that generation would submit (queuePrompt is stubbed) */
  console.log('built prompt:', await ev(`(async () => {
    const api = window.comfyAPI.api.api;
    const orig = api.queuePrompt;
    window.__cap = null;
    api.queuePrompt = async (...args) => { window.__cap = args[1] && args[1].output; throw new Error('probe-stop'); };
    await InfCanvas.generate.run(window.__probe.genId);
    await new Promise((r) => setTimeout(r, 400));
    api.queuePrompt = orig;
    const cap = window.__cap;
    if (!cap) return 'NO PROMPT';
    const enc = cap['37_13'] && cap['37_13'].inputs;
    const seed = cap['37_38'] && cap['37_38'].inputs;
    return JSON.stringify({ caption: enc && enc.caption, lyrics: enc && enc.lyrics,
      max_duration: enc && enc.max_duration, seed: seed && seed.seed,
      captionType: typeof (enc && enc.caption) }); })()`, true));

  /* switch to a VOICE mode: labels must change, music text must be preserved */
  console.log('voice mode:', await ev(`(async () => {
    const btn = [...document.querySelectorAll('.icn__gpa .icn__gpv-mode')].find((b) => b.textContent.trim() === '语音设计');
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const boxes = [...document.querySelectorAll('.icn__gpa-box')];
    const node = InfCanvas.flow.state.nodes.value.find((n) => n.id === window.__probe.genId);
    return JSON.stringify({ labels: boxes.map((b) => b.querySelector('.icn__gpa-label').textContent.trim()),
      ph: boxes.map((b) => b.querySelector('textarea').getAttribute('placeholder')),
      mode: node.data.audioMode, map: node.data.audioMap,
      prompt: node.data.prompt }); })()`, true));

  console.log('layout after fields:', await ev(`(() => {
    const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null;
      const b = e.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
    const bar = document.querySelector('.icn__gpa-bar');
    const rb = bar.getBoundingClientRect();
    const run = document.querySelector('.icn__gpa .icn__gp-send').getBoundingClientRect();
    return JSON.stringify({ panel: pick('.icn__gpa'), bar: pick('.icn__gpa-bar'),
      api: pick('.icn__gpa-bar > .icn__selwrap'), fields: pick('.icn__gpa-fields'),
      run: [Math.round(run.left), Math.round(run.top), Math.round(run.width), Math.round(run.height)],
      overflowRight: Math.round(run.right - rb.right), overflowLeft: Math.round(rb.left - document.querySelector('.icn__gpa').getBoundingClientRect().left) }); })()`));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/audio-panel.png', Buffer.from(shot.data, 'base64'));

  /* zoomed crop of the panel for eyeballing */
  const clip = JSON.parse(await ev(`(() => { const p = document.querySelector('.icn__gpa').getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, p.left - 8), y: Math.max(0, p.top - 8), w: p.width + 16, h: p.height + 16 }); })()`));
  const shot2 = await send('Page.captureScreenshot', { format: 'png',
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 2 } });
  fs.writeFileSync(ROOT + '/.workbuddy/tmp/audio-panel-zoom.png', Buffer.from(shot2.data, 'base64'));

  ws.close(); child.kill();
})();
