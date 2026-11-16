// Measure Chrome's native <video controls> shadow DOM (what ComfyUI's
// Load Video node actually renders) so we can copy it 1:1.
const PORT = Number(process.argv[2] || 9225);
const URL = 'http://127.0.0.1:8188/extensions/ComfyUI_InfiniteCanvas/__native.html';

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { send, close } = await connect();
  await send('Page.enable');
  await send('DOM.enable');
  await send('CSS.enable');
  await send('Page.navigate', { url: URL });
  await sleep(3500);

  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });

  // Flatten tree, keeping track of shadow roots.
  const media = [];
  const walk = (node, depth) => {
    const name = (node.nodeName || '').toLowerCase();
    if (name.includes('media-controls') || name === 'video') media.push(node);
    const kids = [...(node.children || []), ...(node.shadowRoots || [])];
    for (const k of kids) walk(k, depth + 1);
  };
  walk(root, 0);

  console.log('native media nodes found:', media.length);

  for (const node of media) {
    const label = node.nodeName.toLowerCase();
    let box = null;
    try {
      const m = await send('DOM.getBoxModel', { nodeId: node.nodeId });
      const q = m.model.border;
      box = {
        x: +(q[0]).toFixed(1), y: +(q[1]).toFixed(1),
        w: +(q[2] - q[0]).toFixed(1), h: +(q[5] - q[1]).toFixed(1)
      };
    } catch (e) { /* no box */ }
    let style = {};
    try {
      const s = await send('CSS.getComputedStyleForNode', { nodeId: node.nodeId });
      for (const p of s.computedStyle) {
        if (['background-color', 'background-image', 'height', 'width', 'border-radius',
             'padding', 'margin', 'color', 'opacity', 'font-size', 'display',
             'appearance', 'box-shadow'].includes(p.name)) style[p.name] = p.value;
      }
    } catch (e) { /* ignore */ }
    const attrs = {};
    for (let i = 0; i < (node.attributes || []).length; i += 2) attrs[node.attributes[i]] = node.attributes[i + 1];
    console.log('\n===', label, JSON.stringify(attrs).slice(0, 160));
    console.log('  box', JSON.stringify(box));
    console.log('  style', JSON.stringify(style));
  }

  // Hover the volume button to reveal its slider, then re-measure.
  const v = media.find((n) => n.nodeName.toLowerCase() === 'video');
  if (v) {
    const m = await send('DOM.getBoxModel', { nodeId: v.nodeId });
    const x0 = m.model.border[0], y0 = m.model.border[1];
    const x1 = m.model.border[2], y1 = m.model.border[5];
    // volume button sits near the right edge of the panel
    const px = x1 - 40, py = (y0 + y1) / 2;
    console.log('\n--- hovering volume at', px, py);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px - 4, y: py, button: 'none', buttons: 0 });
    await sleep(120);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', buttons: 0 });
    await sleep(700);

    const { root: root2 } = await send('DOM.getDocument', { depth: -1, pierce: true });
    const after = [];
    const walk2 = (node) => {
      const name = (node.nodeName || '').toLowerCase();
      if (name.includes('media-controls')) after.push(node);
      for (const k of [...(node.children || []), ...(node.shadowRoots || [])]) walk2(k);
    };
    walk2(root2);
    console.log('\n=== after hover, media-controls nodes:', after.length);
    for (const node of after) {
      const label = node.nodeName.toLowerCase();
      let box = null;
      try {
        const m = await send('DOM.getBoxModel', { nodeId: node.nodeId });
        const q = m.model.border;
        box = { x: +q[0].toFixed(1), y: +q[1].toFixed(1), w: +(q[2] - q[0]).toFixed(1), h: +(q[5] - q[1]).toFixed(1) };
      } catch (e) { }
      let style = {};
      try {
        const s = await send('CSS.getComputedStyleForNode', { nodeId: node.nodeId });
        for (const p of s.computedStyle) {
          if (['background-color', 'height', 'width', 'border-radius', 'padding', 'opacity', 'display', 'appearance'].includes(p.name)) style[p.name] = p.value;
        }
      } catch (e) { }
      const attrs = {};
      for (let i = 0; i < (node.attributes || []).length; i += 2) attrs[node.attributes[i]] = node.attributes[i + 1];
      console.log(label, JSON.stringify(attrs).slice(0, 120), JSON.stringify(box), JSON.stringify(style));
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/.workbuddy/tmp/native-hover.png', Buffer.from(shot.data, 'base64'));
    console.log('\nscreenshot written');
  }

  close();
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
