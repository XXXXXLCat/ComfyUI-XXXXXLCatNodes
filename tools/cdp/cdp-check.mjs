// Collect console errors / uncaught exceptions while reloading and entering
// canvas mode. usage: node tools/cdp/cdp-check.mjs [ms]
const waitMs = Number(process.argv[2] || 15000);

const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("8188"));
if (!page) { console.error("no page"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const problems = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    const d = message.params.exceptionDetails;
    problems.push("EXCEPTION: " + (d.exception?.description || d.text));
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    const text = message.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    if (text.trim()) problems.push("CONSOLE: " + text.slice(0, 400));
  }
  if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
    problems.push("LOG: " + message.params.entry.text.slice(0, 400));
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  return reply.result?.result?.value;
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 10000));

let ready = false;
for (let i = 0; i < 40; i += 1) {
  ready = await evaluate("!!(window.LiteGraph && window.InfCanvas?.api)");
  if (ready) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log("ready:", ready);
if (ready) {
  await evaluate("(async()=>{await window.InfCanvas.api.enter();})()");
  await new Promise((r) => setTimeout(r, 1200));
  const state = await evaluate(`JSON.stringify({
    active: window.InfCanvas.api.isActive(),
    toolbar: !!document.querySelector('#infcanvas-controls [role="toolbar"]'),
    minimap: !!document.querySelector('#infcanvas-stage .litegraph-minimap')
  })`);
  console.log("state:", state);
  // exercise the controls once
  await evaluate(`(() => {
    const bar = document.querySelector("#infcanvas-controls");
    const buttons = [...bar.querySelectorAll("button")];
    buttons[2].click();            // zoom popup
    return "clicked";
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evaluate(`(() => {
    const pop = document.querySelector('[data-testid="zoom-controls-popup"]');
    const input = pop?.querySelector("input");
    if (input) { input.value = "150"; input.dispatchEvent(new Event("input", { bubbles: true })); }
    return "zoomed";
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  console.log("scale:", await evaluate("Math.round(window.InfCanvas.api.canvas().ds.scale * 100)"));
  await evaluate(`document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); "closed"`);
  await new Promise((r) => setTimeout(r, Math.max(2000, waitMs - 12000)));
}

console.log("problems:", problems.length);
for (const problem of problems) console.log("-", problem);
ws.close();
