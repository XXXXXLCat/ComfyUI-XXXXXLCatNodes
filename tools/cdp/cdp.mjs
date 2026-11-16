// Minimal CDP driver for the local headless Chrome (port 9222).
// usage:
//   node tools/cdp/cdp.mjs eval        (JS from stdin, awaited, result printed)
//   node tools/cdp/cdp.mjs shot <png>
//   node tools/cdp/cdp.mjs click <x> <y> [button]
//   node tools/cdp/cdp.mjs move <x> <y>
//   node tools/cdp/cdp.mjs wheel <x> <y> <deltaY>
//   node tools/cdp/cdp.mjs navigate <url>
import fs from "node:fs";

const [, , command, ...args] = process.argv;

const CDP_PORT = process.env.CDP_PORT || "9222";
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("8188"));
if (!page) { console.error("no comfyui page target"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const reply = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (reply.result?.exceptionDetails) {
    console.error("EXCEPTION:", JSON.stringify(reply.result.exceptionDetails, null, 2));
    process.exitCode = 1;
    return;
  }
  const value = reply.result?.result?.value;
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

async function screenshot(path) {
  const reply = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path, Buffer.from(reply.result.data, "base64"));
  console.log("saved", path);
}

async function mouse(type, x, y, extra = {}) {
  await send("Input.dispatchMouseEvent", {
    type, x, y, button: "left", clickCount: 1, ...extra,
  });
}

switch (command) {
  case "eval": {
    const code = fs.readFileSync(0, "utf8");
    await evaluate(code);
    break;
  }
  case "shot":
    await screenshot(args[0] || "shot.png");
    break;
  case "click": {
    const x = Number(args[0]), y = Number(args[1]);
    await mouse("mouseMoved", x, y, { button: "none" });
    await mouse("mousePressed", x, y, { button: "left", clickCount: 1 });
    await new Promise((r) => setTimeout(r, 60));
    await mouse("mouseReleased", x, y, { button: "left", clickCount: 1 });
    break;
  }
  case "dblclick": {
    const x = Number(args[0]), y = Number(args[1]);
    await mouse("mouseMoved", x, y, { button: "none" });
    await mouse("mousePressed", x, y, { button: "left", clickCount: 1 });
    await mouse("mouseReleased", x, y, { button: "left", clickCount: 1 });
    await new Promise((r) => setTimeout(r, 40));
    await mouse("mousePressed", x, y, { button: "left", clickCount: 2 });
    await new Promise((r) => setTimeout(r, 40));
    await mouse("mouseReleased", x, y, { button: "left", clickCount: 2 });
    break;
  }
  case "drag": {
    const [x1, y1, x2, y2] = args.map(Number);
    await mouse("mouseMoved", x1, y1, { button: "none" });
    await mouse("mousePressed", x1, y1, { clickCount: 1 });
    await new Promise((r) => setTimeout(r, 60));
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x, y, button: "left", buttons: 1, clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 30));
    }
    await mouse("mouseReleased", x2, y2, { clickCount: 1 });
    break;
  }
  case "move":
    await mouse("mouseMoved", Number(args[0]), Number(args[1]), { button: "none" });
    break;
  case "text":
    await send("Input.insertText", { text: args.join(" ") });
    break;
  case "wheel":
    await send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: Number(args[0]), y: Number(args[1]),
      deltaX: 0, deltaY: Number(args[2]),
    });
    break;
  case "navigate": {
    await send("Page.navigate", { url: args[0] });
    break;
  }
  case "reload": {
    // ignoreCache: bypass the HTTP/memory cache so edited extension files load.
    await send("Page.reload", { ignoreCache: true });
    break;
  }
  default:
    console.error("unknown command", command);
    process.exitCode = 2;
}
ws.close();
