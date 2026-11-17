/* Live check for the AUDIO generator input rules.
   Verifies with REAL mouse drags:
     1. image -> audio generator is refused (edge count unchanged)
     2. video -> audio generator is refused
     3. 1st audio -> audio generator is accepted AND the mode auto-switches
        from 音乐设计 to 音乐翻唱
     4. 2nd audio -> refused (audio is capped at 1)
     5. text -> accepted, and it feeds the FIRST area (提示词 / 语气): the
        area's placeholder becomes the wired text
     6. tabs: with 1 audio wired, 音乐设计 / 语音设计 are disabled and
        音乐翻唱 / 语音克隆 stay selectable
   Screenshot lands in .workbuddy/tmp/audio-wiring.png */
const http = require('http');
const { spawn } = require('child_process');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const PORT = 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://127.0.0.1:8188/';
const OUT = ROOT + '/.workbuddy/tmp/audio-wiring.png';
const fs = require('fs');

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
      setter.call(el, 'probe-wire-' + Date.now().toString().slice(-6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next');
      if (next) next.click();
      return true;
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
    NS.api.newCanvas();   /* blank doc: earlier runs left nodes behind */
    await new Promise((r) => setTimeout(r, 1000));
    const asset = (kind, filename) => ({ filename, subfolder: '', type: 'input', kind, name: filename });
    const gen = NS.api.addNodeByType('infcanvas/gen_audio', [900, 300]);
    const img = NS.api.addNodeByType('infcanvas/asset_image', [120, 40], asset('image', 'probe.png'));
    const vid = NS.api.addNodeByType('infcanvas/asset_video', [120, 260], asset('video', 'probe.mp4'));
    const a1 = NS.api.addNodeByType('infcanvas/asset_audio', [120, 480], asset('audio', 'probe1.m4a'));
    const a2 = NS.api.addNodeByType('infcanvas/asset_audio', [120, 690], asset('audio', 'probe2.m4a'));
    const txt = NS.api.addNodeByType('infcanvas/asset_text', [560, 690]);
    NS.flow.updateNodeData(txt.id, { text: '轻快明亮的电子流行，女声，120bpm' });
    NS.flow.selectNodes([gen.id]);
    window.__probe = { gen: gen.id, img: img.id, vid: vid.id, a1: a1.id, a2: a2.id, txt: txt.id };
    return JSON.stringify({ gen: gen.id, mode: gen.data.audioMode || '(default)',
      edges: NS.flow.state.edges.value.length });
  })()`, true));
  await sleep(900);

  /* Handles: drag from the source node's OUTPUT handle to the generator's
     single INPUT handle, the same gesture a user makes. */
  const dragWire = async (srcId, dstId) => {
    const coords = JSON.parse(await ev(`(() => {
      const box = (id, sel) => { const n = document.querySelector('.vue-flow__node[data-id="' + id + '"]');
        const h = n && n.querySelector(sel); if (!h) return null;
        const b = h.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; };
      return JSON.stringify({ from: box(window.__probe['${srcId}'], '.vue-flow__handle.source'),
        to: box(window.__probe['${dstId}'], '.vue-flow__handle.target') }); })()`));
    if (!coords.from || !coords.to) return 'no handle ' + JSON.stringify(coords);
    const [x0, y0] = coords.from; const [x1, y1] = coords.to;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' });
    await sleep(60);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved',
        x: Math.round(x0 + ((x1 - x0) * i) / 8), y: Math.round(y0 + ((y1 - y0) * i) / 8), button: 'left' });
      await sleep(30);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', clickCount: 1 });
    await sleep(450);
    return 'ok';
  };

  const snapshot = async (label) => {
    const out = await ev(`(() => {
      const NS = window.InfCanvas; const P = window.__probe;
      const edges = NS.flow.state.edges.value.map((e) => e.source + '->' + e.target);
      const node = NS.flow.state.nodes.value.find((n) => n.id === P.gen);
      const tabs = [...document.querySelectorAll('.icn__gpa .icn__gpv-mode')].map((b) => ({
        label: b.textContent.trim(), on: b.classList.contains('is-on'), disabled: b.classList.contains('is-disabled'),
        title: b.getAttribute('title') }));
      const a = document.querySelector('.icn__gpa-area--a');
      return JSON.stringify({ edges, mode: node.data.audioMode, tabs,
        wiredHint: document.querySelectorAll('.icn__gpa-wired').length,
        aPlaceholder: a && a.getAttribute('placeholder') });
    })()`);
    console.log(label + ':', out);
    return JSON.parse(out);
  };

  await snapshot('start');

  console.log('drag image ->', await dragWire('img', 'gen'));
  const afterImg = await snapshot('after image');

  console.log('drag video ->', await dragWire('vid', 'gen'));
  const afterVid = await snapshot('after video');

  console.log('drag audio#1 ->', await dragWire('a1', 'gen'));
  const afterA1 = await snapshot('after audio#1');

  console.log('drag audio#2 ->', await dragWire('a2', 'gen'));
  const afterA2 = await snapshot('after audio#2');

  console.log('drag text ->', await dragWire('txt', 'gen'));
  const afterTxt = await snapshot('after text');

  /* The runtime proof: wire text -> first area must reach the workflow's own
     prompt field (caption), while 歌词 stays empty. queuePrompt is stubbed so
     nothing is actually queued. */
  console.log('payload:', await ev(`(async () => {
    const NS = window.InfCanvas; const P = window.__probe;
    NS.flow.updateNodeData(P.gen, { workflow: '文生音乐：MiniMax Music 3' });
    await new Promise((r) => setTimeout(r, 1600));
    const node = NS.flow.state.nodes.value.find((n) => n.id === P.gen);
    const api = window.comfyAPI.api.api;
    const orig = api.queuePrompt; window.__cap = null;
    api.queuePrompt = async (...args) => { window.__cap = args[1] && args[1].output; throw new Error('probe-stop'); };
    await NS.generate.run(P.gen);
    await new Promise((r) => setTimeout(r, 500));
    api.queuePrompt = orig;
    const cap = window.__cap;
    if (!cap) return JSON.stringify({ error: 'NO PROMPT', map: node.data.audioMap });
    const enc = cap['37_13'] && cap['37_13'].inputs;
    return JSON.stringify({ audioMap: node.data.audioMap, caption: enc && enc.caption,
      lyrics: enc && enc.lyrics });
  })()`, true));

  /* Re-select so the panel is visible in the screenshot (dragging cleared it). */
  await ev(`(window.InfCanvas.flow.selectNodes([window.__probe.gen]), true)`);
  await sleep(500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

  const verdict = {
    imageRefused: afterImg.edges.length === 0,
    videoRefused: afterVid.edges.length === 0,
    firstAudioAccepted: afterA1.edges.length === 1,
    modeSwitched: afterA1.mode === '音乐翻唱',
    secondAudioRefused: afterA2.edges.length === 1,
    textAccepted: afterTxt.edges.length === 2,
    textFeedsAreaA: String(afterTxt.aPlaceholder).includes('电子流行'),
    designTabsDisabled: afterTxt.tabs.filter((t) => t.disabled).map((t) => t.label).join(','),
    shot: OUT,
  };
  console.log('VERDICT:', JSON.stringify(verdict, null, 1));
  ws.close(); child.kill();
})();
