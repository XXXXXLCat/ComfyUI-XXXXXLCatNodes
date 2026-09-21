/* Verification for the LoRA stack front end (web/lora_rows.js + both callers).

   Runs the real scripts against a mock ComfyUI node: the files have no DOM or
   canvas dependency, only `app`, so a stub is enough to exercise the row
   add / collapse / hide logic exactly as the front end would.

   The same suite runs against every registered node, so a second stack cannot
   quietly drift away from the first.

   Run: node <repo>/scripts/test_lora_stack_ui.mjs
*/
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const WEB = join(REPO, "web");
const BRAND = "\u{1F408}\u200D\u2B1B";
const MAX_ROWS = 12;

const NODES = [
  {
    id: `${BRAND}StackLoras`,
    label: "Load LoRA Stack",
    entry: "lora_stack.js",
    fields: ["lora", "strength", "on"],
  },
  {
    id: `${BRAND}StackLorasClip`,
    label: "Load LoRA Stack (Model and CLIP)",
    entry: "lora_stack_clip.js",
    fields: ["lora", "strength_model", "strength_clip", "on"],
  },
];

const failures = [];
function check(name, ok, detail = "") {
  console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures.push(name);
}

/* ---------------------------------------------------------------- mock host */

const extensions = [];
const app = {
  registerExtension(ext) {
    extensions.push(ext);
  },
  graph: { change() {} },
  canvas: { setDirty() {} },
};
globalThis.__app = app;

/* The engine imports the app; the callers just import the engine. Both land in
   one temp dir so the caller's relative import resolves. */
const dir = mkdtempSync(join(tmpdir(), "lsui-"));
writeFileSync(
  join(dir, "lora_rows.js"),
  readFileSync(join(WEB, "lora_rows.js"), "utf8").replace(
    /import\s*\{\s*app\s*\}\s*from\s*"[^"]+";/,
    "const app = globalThis.__app;"
  )
);
for (const node of NODES) {
  writeFileSync(join(dir, node.entry), readFileSync(join(WEB, node.entry), "utf8"));
  await import(pathToFileURL(join(dir, node.entry)).href);
}

if (extensions.length !== NODES.length) {
  console.log(`FAIL  扩展注册数量不对：期望 ${NODES.length}，实际 ${extensions.length}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ mock node */

function defaultFor(field) {
  if (field === "lora") return "None";
  if (field === "on") return true;
  return 1;
}

function makeNode(fields) {
  const widgets = [];
  for (let i = 1; i <= MAX_ROWS; i++) {
    const s = String(i).padStart(2, "0");
    for (const field of fields) {
      widgets.push({ name: `${field}_${s}`, value: defaultFor(field), options: {}, hidden: false, computeSize: undefined });
    }
  }
  return {
    widgets,
    properties: {},
    // LiteGraph measures a node the moment it is built — before anything is
    // hidden — so the mock starts as tall as all twelve rows.
    size: [300, 1000],
    fits: 0,
    computeSize() {
      return [300, 148 + widgets.filter((w) => !w.hidden).length * 22];
    },
    setSize(sz) {
      this.size = [Math.round(sz[0]), Math.round(sz[1])];
      this.fits += 1;
    },
    addWidget(type, name, value, callback) {
      const w = { name, type, value, callback, options: {}, hidden: false };
      widgets.push(w);
      return w;
    },
    setDirtyCanvas() {},
  };
}

const widget = (node, name) => node.widgets.find((w) => w.name === name);
const press = (node, label) => widget(node, label).callback();
const visible = (node) => {
  let top = 0;
  for (let i = 1; i <= MAX_ROWS; i++) {
    const w = widget(node, `lora_${String(i).padStart(2, "0")}`);
    if (w && !w.hidden) top = i;
  }
  return top;
};

/* --------------------------------------------------------------------- suite */

function runSuite(node, nodeType) {
  console.log(`\n=== ${node.label} (${node.id}) ===`);
  const strengths = node.fields.filter((f) => f.startsWith("strength"));
  const make = () => {
    const n = makeNode(node.fields);
    nodeType.prototype.onNodeCreated.call(n);
    return n;
  };
  const setStrengths = (n, index, base) =>
    strengths.forEach((f, i) => { widget(n, `${f}_${String(index).padStart(2, "0")}`).value = base + i * 0.1; });
  const strengthsAre = (n, index, base) =>
    strengths.every((f, i) => widget(n, `${f}_${String(index).padStart(2, "0")}`).value === base + i * 0.1);

  console.log("  [1] 默认状态");
  let n = make();
  check("默认显示 4 行", visible(n) === 4, `visible=${visible(n)}`);
  check("第 4 行可见、第 5 行隐藏",
    widget(n, "lora_04").hidden === false && widget(n, "lora_05").hidden === true);
  check(`同一行的 ${node.fields.length} 个控件一起隐藏`,
    node.fields.every((f) => widget(n, `${f}_05`).hidden === true));
  check("隐藏同时写入 options（前端另有一处读它）",
    widget(n, "lora_05").options.hidden === true);
  check("两个按钮已挂上",
    !!widget(n, "Add LoRA") && !!widget(n, "Remove empty rows"));
  check("未用行默认值正确（LoRA=None、强度=1、开关=开）",
    widget(n, "lora_01").value === "None" && strengths.every((f) => widget(n, `${f}_01`).value === 1) &&
    widget(n, "on_01").value === true);

  console.log("  [2] 增行 / 清空空槽");
  press(n, "Add LoRA");
  check("Add 后显示 5 行", visible(n) === 5, `visible=${visible(n)}`);
  check("计数已存档", n.properties.ls_rows === 5);
  press(n, "Add LoRA");
  press(n, "Remove empty rows");
  check("全空时一键清空只留 1 行", visible(n) === 1, `visible=${visible(n)}`);

  console.log("  [3] 一次移除所有空槽，非空行向前压实");
  n = make();
  widget(n, "lora_01").value = "a.safetensors";
  setStrengths(n, 1, 0.8);
  widget(n, "lora_03").value = "c.safetensors";
  setStrengths(n, 3, 0.3);
  widget(n, "on_03").value = false;
  press(n, "Remove empty rows");
  check("空槽全部消失，只剩 2 行", visible(n) === 2, `visible=${visible(n)}`);
  check("第 1 行原样不动",
    widget(n, "lora_01").value === "a.safetensors" && strengthsAre(n, 1, 0.8) && widget(n, "on_01").value === true);
  check("后面的行连全部强度/开关一起压实到第 2 行",
    widget(n, "lora_02").value === "c.safetensors" && strengthsAre(n, 2, 0.3) && widget(n, "on_02").value === false);
  check("腾空的槽位恢复默认值",
    widget(n, "lora_03").value === "None" && strengths.every((f) => widget(n, `${f}_03`).value === 1) &&
    widget(n, "on_03").value === true);
  check("计数存为 2", n.properties.ls_rows === 2);
  check("第 3 行已隐藏", widget(n, "lora_03").hidden === true);

  n = make();
  widget(n, "lora_01").value = "only.safetensors";
  press(n, "Remove empty rows");
  check("只有一个非空行 → 收成 1 行", visible(n) === 1, `visible=${visible(n)}`);
  check("该行的值保留", widget(n, "lora_01").value === "only.safetensors");

  n = make();
  press(n, "Add LoRA");
  press(n, "Add LoRA");
  press(n, "Remove empty rows");
  check("全是空的 → 只保留 1 行", visible(n) === 1, `visible=${visible(n)}`);

  console.log("  [4] 不变量：已填行不会被计数隐藏");
  n = makeNode(node.fields);
  n.properties.ls_rows = 1;
  widget(n, "lora_03").value = "filled.safetensors";
  nodeType.prototype.onConfigure.call(n, { size: [300, 400] });
  check("计数=1 但第 3 行有值 → 展开到第 3 行", visible(n) === 3, `visible=${visible(n)}`);

  console.log("  [5] 新增行的默认值");
  n = make();
  press(n, "Add LoRA");
  check("新行是空的、强度 1、开关开",
    widget(n, "lora_05").value === "None" && strengths.every((f) => widget(n, `${f}_05`).value === 1) &&
    widget(n, "on_05").value === true);
  check("新行可见", widget(n, "lora_05").hidden === false);

  console.log("  [6] 上下限与工作流还原");
  n = make();
  for (let i = 0; i < 20; i++) press(n, "Add LoRA");
  check("Add 到上限后停住（12 行）", visible(n) === MAX_ROWS, `visible=${visible(n)}`);
  press(n, "Remove empty rows");
  check("一键清空回落到 1 行", visible(n) === 1, `visible=${visible(n)}`);

  n = makeNode(node.fields);
  n.properties.ls_rows = 7;
  nodeType.prototype.onConfigure.call(n, { size: [300, 400] });
  check("载入工作流时按存档计数展开", visible(n) === 7, `visible=${visible(n)}`);

  n = makeNode(node.fields);
  nodeType.prototype.onConfigure.call(n, undefined);
  check("配置缺失也不抛错并用默认值", visible(n) === 4, `visible=${visible(n)}`);

  console.log("  [7] 新建时按内容收高（不保留 12 行的高度）");
  n = make();
  check("建节点时的 12 行高度已被重算", n.size[1] === n.computeSize()[1], `${n.size[1]} vs ${n.computeSize()[1]}`);
  check("只调用了 1 次 setSize", n.fits === 1, `fits=${n.fits}`);
  press(n, "Add LoRA");
  check("加行后重新贴合内容高度", n.size[1] === n.computeSize()[1] && n.fits === 2);
  press(n, "Remove empty rows");
  check("清空空槽后同样贴合", n.size[1] === n.computeSize()[1]);

  n = makeNode(node.fields);
  n.size = [300, 520]; // 模拟工作流里存档的高度
  nodeType.prototype.onConfigure.call(n, { size: [300, 520] });
  check("载入工作流时不改写高度", n.fits === 0 && n.size[1] === 520, `fits=${n.fits}, h=${n.size[1]}`);
}

for (const node of NODES) {
  const nodeType = { prototype: {} };
  // Every extension is fed the same nodeData; only the one that owns this id
  // wires anything, exactly like in ComfyUI.
  for (const ext of extensions) {
    await ext.beforeRegisterNodeDef(nodeType, { name: node.id });
  }
  runSuite(node, nodeType);
}

console.log();
if (failures.length) {
  console.log(`失败 ${failures.length} 项: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`全部通过（${NODES.length} 个节点）`);
