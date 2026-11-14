/**
 * 阶段 11 / batch 5 之后的源码契约单测（替代旧的 verify-p21-logic.mjs）。
 *
 * 旧单测在 vm 里比对「真源 vs legacy/p21 压缩片段」；补丁机制退役后不再有
 * 片段，改为两件事：
 *   1. src/xcat/app/canvas-app.js 的四个 XCAT-SOURCE 标记块，必须与
 *      src/xcat/logic/*.js 真源渲染出的文本逐字符一致（防漂移）；
 *   2. 直接 import 真源 ES 模块，断言节点角色 / 工作流分类 / 桥接的关键行为。
 *
 * 运行时行为另由 .workbuddy/tmp/verify-*.js 的 CDP 真浏览器探针覆盖。
 *
 * 用法（frontend/ 下）：node xcat/verify-source-logic.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as role from "../src/xcat/logic/node-role.js";
import * as wf from "../src/xcat/logic/workflow-scope.js";
import * as tabs from "../src/xcat/logic/canvas-tabs.js";
import * as bridge from "../src/xcat/logic/canvas-tabs-bridge.js";
import * as sd from "../src/xcat/logic/save-dialog.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FE = path.dirname(HERE);
const LOGIC = path.join(FE, "src", "xcat", "logic");
const FROZEN = path.join(FE, "src", "xcat", "app", "canvas-app.js");

let cases = 0;
const eq = (label, got, want) => {
  assert.deepEqual(JSON.parse(JSON.stringify(got ?? null)),
                   JSON.parse(JSON.stringify(want ?? null)), label);
  cases += 1;
};
const ok = (label, value) => { assert.ok(value, label); cases += 1; };

// ---- 1. 固化源码的四个标记块 == 真源渲染文本 ------------------------------
const PARTS = [
  ["02-canvas-tabs-core", ["canvas-tabs.js", "canvas-tabs-bridge.js"], ""],
  ["03-save-dialog", ["save-dialog.js"], ""],
  ["05-node-role", ["node-role.js"], "try{installNodeRoleGlobals();}catch(e){}\n"],
  ["06-workflow-scope", ["workflow-scope.js"],
   "try{installWorkflowGlobals();}catch(e){}\n"],
];

function render(names, tail) {
  return names.map((name) => {
    let text = fs.readFileSync(path.join(LOGIC, name), "utf8");
    if (!text.endsWith("\n")) text += "\n";
    return text.replace(/^export /gm, "");
  }).join("") + tail;
}

const frozen = fs.readFileSync(FROZEN, "utf8");
for (const [id, names, tail] of PARTS) {
  const begin = `/* XCAT-SOURCE-BEGIN: ${id} */\n`;
  const end = `/* XCAT-SOURCE-END: ${id} */\n`;
  const s = frozen.indexOf(begin);
  ok(`${id}: BEGIN marker`, s >= 0);
  const e = frozen.indexOf(end, s);
  ok(`${id}: END marker`, e > s);
  eq(`${id}: frozen block == src/xcat/logic/*.js`,
     frozen.slice(s + begin.length, e), render(names, tail));
}
ok("exactly 4 source blocks", (frozen.match(/XCAT-SOURCE-BEGIN/g) || []).length === 4);
ok("frozen app still mounts #app", frozen.includes('mount("#app")'));

// ---- 2. 模块导出契约 -------------------------------------------------------
for (const [mod, fns] of [
  [role, ["xcatNodeRoles", "xcatRole", "xcatIsGen", "xcatIsText",
          "xcatNodeRole", "xcatTextInput", "installNodeRoleGlobals"]],
  [wf, ["xcatWFCats", "xcatWFCatOf", "xcatWFGrouped", "xcatWFItemClick",
        "xcatWFRemember", "xcatWFScope", "xcatWFInScope", "xcatWFDefaultFor",
        "xcatWFPills", "xcatWFPillClick", "installWorkflowGlobals"]],
  [tabs, ["xcatFlushImpl", "xcatPickImpl", "xcatAddImpl", "xcatWheelImpl",
          "xcatSaveCurrentImpl", "xcatTabsBootstrap", "installCanvasTabs"]],
  [bridge, []],
  [sd, ["xcatShowSaveDialog"]],
]) {
  for (const fn of fns) ok(`export ${fn} is function`, typeof mod[fn] === "function");
}

// ---- 3. 节点角色 -----------------------------------------------------------
eq("nine roles", role.xcatNodeRoles(), [
  "asset-image", "asset-video", "asset-audio", "asset-text",
  "gen-image", "gen-video", "gen-audio", "gen-text", "lora",
]);
eq("known role kept", role.xcatRole({ role: "lora" }), "lora");
eq("unknown role falls back to media.kind", role.xcatRole({ role: "nope", media: [{ kind: "video" }] }), "asset-video");
eq("audio media", role.xcatRole({ media: [{ kind: "audio" }] }), "asset-audio");
eq("no data", role.xcatRole({}), "asset-image");
eq("null data", role.xcatRole(null), "asset-image");
eq("gen-audio is gen", role.xcatIsGen({ role: "gen-audio" }), true);
eq("asset is not gen", role.xcatIsGen({ role: "asset-image" }), false);
eq("gen-text is text", role.xcatIsText({ role: "gen-text" }), true);
eq("asset-text is text", role.xcatIsText({ role: "asset-text" }), true);
eq("gen-image is not text", role.xcatIsText({ role: "gen-image" }), false);

// ---- 4. 工作流七分类与 role 接入范围 ---------------------------------------
eq("seven categories", wf.xcatWFCats(), [
  "文生图像", "图像编辑", "文生视频", "参考生视频",
  "图像放大", "图像反推", "文生音乐",
]);
eq("gen-image scope", wf.xcatWFScope("gen-image"), ["文生图像", "图像编辑"]);
eq("gen-video scope", wf.xcatWFScope("gen-video"), ["文生视频", "参考生视频"]);
eq("gen-audio scope", wf.xcatWFScope("gen-audio"), ["文生音乐"]);
eq("gen-text unrestricted", wf.xcatWFScope("gen-text"), null);
eq("unknown role unrestricted", wf.xcatWFScope("nope"), null);
eq("in scope", wf.xcatWFInScope("gen-audio", "文生音乐"), true);
eq("out of scope", wf.xcatWFInScope("gen-image", "文生音乐"), false);
eq("unrestricted in scope", wf.xcatWFInScope("gen-text", "文生音乐"), true);
eq("scope cache default is empty string", wf.xcatWFDefaultFor("gen-audio"), "");

// ---- 5. 保存对话框桥接 -----------------------------------------------------
const calls = [];
globalThis.window = {
  __xcatSaveDialog: {
    open(prefill, cb) { calls.push({ prefill, cb }); },
    close() { calls.push({ close: true }); },
  },
};
const cb = () => {};
sd.xcatShowSaveDialog("我的画布", cb);
eq("bridge forwards prefill", calls[0] && calls[0].prefill, "我的画布");
eq("bridge forwards callback", typeof calls[0] && typeof calls[0].cb, "function");
delete globalThis.window;

// ---- 6. 全局挂接器 ---------------------------------------------------------
const fakeWin = {};
role.installNodeRoleGlobals(fakeWin);
wf.installWorkflowGlobals(fakeWin);
eq("__xcatRole installed", typeof fakeWin.__xcatRole, "function");
eq("__xcatIsText installed", typeof fakeWin.__xcatIsText, "function");
eq("__xcatWFScopeFor installed", typeof fakeWin.__xcatWFScopeFor, "function");
eq("__xcatWfCats installed", typeof fakeWin.__xcatWfCats, "object");
eq("installed role works", fakeWin.__xcatRole({ role: "gen-audio" }), "gen-audio");
eq("installed scope works", fakeWin.__xcatWFScopeFor("gen-audio"), ["文生音乐"]);

console.log(`PASS: ${cases} cases — src/xcat/logic/*.js == frozen blocks + behaviour contracts`);
