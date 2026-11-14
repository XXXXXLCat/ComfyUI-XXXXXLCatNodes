/**
 * 运行时行为回归（阶段 10 建立；阶段 11 / batch 5 补丁机制退役后成为主验收网）。
 *
 * 前置：headless Chrome 在 9333，vite preview 构建产物在 8202。
 * 用法：node xcat/verify-runtime-state.js
 *
 * 检查：
 *  1. window.__xcatFlow 的 state 与下方契约逐项一致
 *     （snapGrid 在允许清单里，只记录不断言）；
 *  2. Delete / Backspace 仍能删除选中节点；
 *  3. zoomTo 被 clamp 到 minZoom=0.02 / maxZoom=10；
 *  4. 零 console error。
 *
 * 这些值原是 #1~#4 四组构建期字节替换的效果，实测属历史冗余：应用自身的
 * VueFlow props 与 applyMode() 已逐项设置。补丁退役后契约常量内联在这里，
 * 不再依赖已归档的 xcat/ported-defaults.js。
 */

/** 行为回归基准：window.__xcatFlow 的运行时 state（阶段 9 补丁版实测值）。 */
const EXPECTED_RUNTIME_STATE = {
  minZoom: 0.02,
  maxZoom: 10,
  selectionMode: "partial",
  snapToGrid: false,
  deleteKeyCode: ["Backspace", "Delete"],
  selectionKeyCode: "Control",
  multiSelectionKeyCode: "Control",
  connectionRadius: 0,
  zoomOnDoubleClick: false,
};

/** snapGrid 从 [10,10] 回到上游 [15,15]，snapToGrid=false 时无读取生效。 */
const STATE_DIFF_ALLOWLIST = ["snapGrid"];

const PORT = 9333;
const URL = `http://127.0.0.1:8202/infinite_canvas/app/index.html?tsv=${Date.now()}`;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pend = new Map();
    let id = 0;
    const errs = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error")
        errs.push((m.params.args || []).map((a) => a.value || a.description || "").join(" "));
      if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.text);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    };
    ws.onerror = reject;
    ws.onopen = () => resolve({
      errs,
      send: (method, params) => new Promise((res) => {
        const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

const READ_STATE = `JSON.stringify((function(){
  var f=window.__xcatFlow; if(!f) return null;
  var out={};
  Object.keys(${JSON.stringify(EXPECTED_RUNTIME_STATE)}).forEach(function(k){
    var v=f[k]; out[k]=(v&&typeof v==='object'&&'value'in v)?v.value:v;
  });
  var g=f.snapGrid; out.snapGrid=(g&&typeof g==='object'&&'value'in g)?g.value:g;
  return out;
})())`;

(async () => {
  const ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const browser = await connect(ver.webSocketDebuggerUrl);
  const created = await browser.send("Target.createTarget", {
    url: URL, newWindow: true, width: 1600, height: 1000,
  });
  const targetId = created.result && created.result.targetId;
  await new Promise((r) => setTimeout(r, 900));
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = await connect(list.find((t) => t.id === targetId).webSocketDebuggerUrl);
  await page.send("Runtime.enable"); await page.send("Page.enable");
  const ev = async (e) => (await page.send("Runtime.evaluate", {
    expression: e, returnByValue: true, awaitPromise: true,
  })).result.result.value;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) {
    if (await ev("!!window.__xcatFlow")) break;
    await sleep(500);
  }
  await sleep(800);

  const out = { state: null, mismatches: [], allowedDiff: {}, deleteKey: {}, backspaceKey: {}, zoom: {}, errors: [] };

  /* 1. state 契约 */
  const state = JSON.parse(await ev(READ_STATE) || "null");
  out.state = state;
  if (!state) { console.log(JSON.stringify(out, null, 2)); process.exit(1); }
  for (const [k, want] of Object.entries(EXPECTED_RUNTIME_STATE)) {
    const got = state[k];
    if (JSON.stringify(got) !== JSON.stringify(want)) out.mismatches.push({ key: k, want, got });
  }
  for (const k of STATE_DIFF_ALLOWLIST) out.allowedDiff[k] = state[k];

  /* 2. Delete / Backspace 删除选中节点 */
  await page.send("Page.bringToFront");
  const mk = async () => {
    await ev(`(function(){var f=window.__xcatFlow;f.removeNodes((f.getNodes.value||[]).map(function(n){return n.id}));return 1})()`);
    await sleep(420);
    await ev(`window.__xcatNodeMenu.create('asset-text')`);
    await sleep(620);
    await ev(`(function(){var f=window.__xcatFlow,n=(f.getNodes.value||[])[0];if(n)n.selected=true;return 1})()`);
    await sleep(240);
    return {
      nodes: await ev(`window.__xcatFlow.getNodes.value.length`),
      selected: await ev(`window.__xcatFlow.getSelectedNodes.value.length`),
    };
  };
  // CDP 真键盘事件（合成 KeyboardEvent 不会被 @vueuse onKeyStroke 当作真实输入）
  const press = async (key, code, vk) => {
    await page.send("Input.dispatchKeyEvent", {
      type: "keyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
    });
    await sleep(620);
    return ev(`window.__xcatFlow.getNodes.value.length`);
  };
  const d0 = await mk();
  out.deleteKey = { nodes: d0.nodes, selected: d0.selected, after: await press("Delete", "Delete", 46) };
  const b0 = await mk();
  out.backspaceKey = { nodes: b0.nodes, selected: b0.selected, after: await press("Backspace", "Backspace", 8) };

  /* 3. 缩放边界（zoomTo 会被 clamp 到 store 的 min/max） */
  await ev(`(function(){var f=window.__xcatFlow;try{f.zoomTo(100,{duration:0})}catch(e){};return 1})()`);
  await sleep(320);
  out.zoom.atMax = await ev(`(function(){var v=window.__xcatFlow.viewport;return v&&v.value?v.value.zoom:v&&v.zoom})()`);
  await ev(`(function(){var f=window.__xcatFlow;try{f.zoomTo(.0001,{duration:0})}catch(e){};return 1})()`);
  await sleep(320);
  out.zoom.atMin = await ev(`(function(){var v=window.__xcatFlow.viewport;return v&&v.value?v.value.zoom:v&&v.zoom})()`);
  await ev(`(function(){var f=window.__xcatFlow;try{f.zoomTo(1,{duration:0})}catch(e){};return 1})()`);

  out.errors = page.errs.slice(0, 10);
  const ok = out.mismatches.length === 0 &&
    out.deleteKey.nodes === 1 && out.deleteKey.after === 0 &&
    out.backspaceKey.nodes === 1 && out.backspaceKey.after === 0 &&
    Math.abs(out.zoom.atMax - 10) < 0.01 &&
    Math.abs(out.zoom.atMin - 0.02) < 0.001 &&
    out.errors.length === 0;
  out.pass = ok;
  console.log(JSON.stringify(out, null, 2));
  page.close(); browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
