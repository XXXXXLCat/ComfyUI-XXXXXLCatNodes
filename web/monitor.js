// XXXXXLCatNodes 前端扩展：ComfyUI 菜单栏系统状态段（紧凑竖向版）。
// 每个指标是一个窄段：背景按占用量填充 + 上下排布的标签/数值，单行横排以缩短总宽。
// 由 XXXXXLCat Launcher 自动部署；ComfyUI 前端通过 /extensions 自动加载本文件。
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const REFRESH_MS = 500;

// 配色（用户指定）：深底白字 + 渐变绿蓝系
const COLORS = {
  cpu: "#207125",
  ram: "#357E3B",
  gpu: "#0B8CE9",
  vram: "#2498EA",
  temp: "#B33A3A",
};
const TEMP_MIN = 40;
const TEMP_MAX = 85;
const TEMP_COLD = "#207125";
const TEMP_HOT = "#B33A3A";
const BOX_BG = "#262729"; // 段/按钮底色
const TEXT_COLOR = "#FFFFFF"; // 数值文字颜色
const LABEL_COLOR = "rgba(255,255,255,.55)"; // 标签文字颜色

let root = null;
let segs = {};
let maxVRAM = 0; // 记录本次会话 VRAM 历史峰值（tooltip 显示）

function mk(tag) {
  return document.createElement(tag);
}

function fmtGB(gb) {
  return gb >= 100 ? gb.toFixed(0) : gb.toFixed(1);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** 温度比 -> 条色：40°C 深绿 -> 85°C 暗红 线性插值（不依赖 color-mix）。 */
function tempColor(ratio) {
  const t = clamp(ratio, 0, 1);
  const ah = parseInt(TEMP_COLD.slice(1), 16);
  const bh = parseInt(TEMP_HOT.slice(1), 16);
  const ar = (ah >> 16) & 255, ag = (ah >> 8) & 255, ab = ah & 255;
  const br = (bh >> 16) & 255, bg = (bh >> 8) & 255, bb = bh & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const b = Math.round(ab + (bb - ab) * t);
  return "rgb(" + r + "," + g + "," + b + ")";
}

/** 单个状态段：窄段(约38px×30px) = 背景填充条(占用量, 自底向上) + 上方数字 + 下方标签(上下布局)。 */
function mkSeg(key, label, color) {
  const seg = mk("div");
  seg.style.cssText = [
    "position:relative;overflow:hidden;flex-shrink:0;",
    "width:38px;height:30px;border-radius:4px;",
    "background:rgba(255,255,255,.07);",
    "box-shadow:inset 0 0 0 1px rgba(255,255,255,.06);",
    "user-select:none;cursor:default;",
  ].join("");

  // 背景填充：自底向上，高度=占用比（不透明度提高，色彩更鲜明）
  const fill = mk("i");
  fill.style.cssText =
    "position:absolute;left:0;right:0;bottom:0;height:0%;" +
    "background:" + color + ";opacity:1;transition:height .5s;z-index:0;";

  // 数字在上、标签在下（上下布局）
  const val = mk("div");
  val.style.cssText =
    "position:absolute;top:3px;left:0;right:0;text-align:center;" +
    "font-size:10px;font-weight:600;color:" + TEXT_COLOR + ";" +
    "text-shadow:0 1px 2px rgba(0,0,0,.78);font-variant-numeric:tabular-nums;z-index:1;";

  const lbl = mk("div");
  lbl.textContent = label;
  lbl.style.cssText =
    "position:absolute;bottom:2px;left:0;right:0;text-align:center;" +
    "font-size:8.5px;color:" + LABEL_COLOR + ";z-index:1;";

  seg.append(fill, val, lbl);
  return { seg, val, fill };
}

function setSeg(s, pct, text, title, fillColor) {
  s.fill.style.height = clamp(pct, 0, 100).toFixed(1) + "%";
  if (fillColor) s.fill.style.background = fillColor;
  s.val.textContent = text;
  if (title) s.seg.title = title;
}

function render(data) {
  if (!data) return;

  if (data.cpu && data.cpu.percent != null) {
    const p = data.cpu.percent;
    setSeg(segs.cpu, p, Math.floor(p) + "%", "CPU " + Math.floor(p) + "%");
  }

  if (data.ram) {
    const p = data.ram.percent;
    setSeg(
      segs.ram, p, Math.floor(p) + "%",
      "RAM " + Math.floor(p) + "% · " + fmtGB(data.ram.used_gb) + "G / " + fmtGB(data.ram.total_gb) + "G"
    );
  }

  const gpu = data.gpus && data.gpus[0];
  if (gpu) {
    setSeg(segs.gpu, gpu.usage, Math.floor(gpu.usage) + "%", "GPU " + Math.floor(gpu.usage) + "% · " + gpu.name);

    const vramP = 100 * (gpu.vram_used_gb / gpu.vram_total_gb);
    if (gpu.vram_used_gb > maxVRAM) maxVRAM = gpu.vram_used_gb;
    let vramTitle =
      "VRAM " + Math.floor(vramP) + "% · " + fmtGB(gpu.vram_used_gb) + "G / " + fmtGB(gpu.vram_total_gb) + "G";
    if (maxVRAM > 0) vramTitle += " · Max " + fmtGB(maxVRAM) + "G";
    setSeg(segs.vram, vramP, fmtGB(gpu.vram_used_gb) + "G", vramTitle);

    // 温度：条宽按 40–85°C 线性；条色深绿 -> 暗红
    const ratio = clamp((gpu.temp - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1);
    setSeg(segs.temp, ratio * 100, Math.round(gpu.temp) + "°C", "TEMP " + Math.round(gpu.temp) + "°C · " + gpu.name, tempColor(ratio));
  } else {
    for (const key of ["gpu", "vram", "temp"]) {
      setSeg(segs[key], 0, "N/A", key.toUpperCase() + " N/A");
    }
  }
}

async function tick() {
  try {
    const resp = await api.fetchApi("/xxxxxlcat-monitor", { cache: "no-store" });
    render(await resp.json());
  } catch (e) {
    // 静默：ComfyUI 未就绪/请求失败时保持上次显示
  }
}

// ---- 清理按钮（菜单栏状态行旁）：VRAM Cleanup / RAM Cleanup ----

/** 点击清理按钮：POST /prompt 排入对应清理节点（带默认配置参数），ComfyUI 进程内立即执行 */
async function runCleanup(kind, btn, inputs) {
  const cls = kind === "vram" ? "🐈‍⬛VRAMSweep" : "🐈‍⬛RAMReclaim";
  btn.disabled = true;
  btn.style.opacity = ".45";
  try {
    await api.fetchApi("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: { clean_1: { class_type: cls, inputs: inputs || {} } },
        client_id: api.clientId || "xxxxxlcat-monitor",
      }),
    });
  } catch (e) {
    // 静默：失败恢复按钮
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.style.opacity = "";
  }, 800);
}

/** 清理按钮：与状态行同高（30px）的英文两行按钮，上=VRAM/RAM，下=Cleanup */
function mkCleanupButton(kind, top, bottom, inputs) {
  const btn = mk("button");
  btn.type = "button";
  btn.title = top + " " + bottom;
  btn.style.cssText = [
    "display:flex;flex-direction:column;align-items:center;justify-content:center;",
    "width:50px;height:30px;flex-shrink:0;border-radius:4px;",
    "border:1px solid rgba(255,255,255,.14);background:" + BOX_BG + ";",
    "color:#FFFFFF;cursor:pointer;padding:0;line-height:1.15;",
    "transition:background .15s;",
  ].join("");
  const line1 = mk("div");
  line1.textContent = top;
  line1.style.cssText = "font-size:11px;font-weight:600;color:" + TEXT_COLOR + ";";
  const line2 = mk("div");
  line2.textContent = bottom;
  line2.style.cssText = "font-size:10px;color:" + LABEL_COLOR + ";";
  btn.append(line1, line2);
  btn.addEventListener("mouseenter", () => {
    if (!btn.disabled) btn.style.background = "rgba(255,255,255,.12)";
  });
  btn.addEventListener("mouseleave", () => {
    if (!btn.disabled) btn.style.background = BOX_BG;
  });
  btn.addEventListener("click", () => runCleanup(kind, btn, inputs));
  return btn;
}

function build() {
  root = mk("div");
  root.id = "xxxxxlcat-monitor";
  root.style.cssText =
    "display:flex;flex-direction:row;gap:5px;flex-wrap:wrap;align-items:center;" +
    "user-select:none;cursor:default;";
  // 清理按钮放在状态行左侧：RAM Cleanup 在左、VRAM Cleanup 在右（与状态段同高 30px）
  root.append(
    mkCleanupButton("ram", "RAM", "Cleanup", {
      clean_file_cache: true,
      clean_processes: true,
      clean_dlls: true,
      retry_times: 3,
    })
  );
  root.append(
    mkCleanupButton("vram", "VRAM", "Cleanup", { offload_model: true, offload_cache: true })
  );
  const sep = mk("div");
  sep.style.cssText = "width:1px;height:18px;background:rgba(255,255,255,.16);margin:0 2px;";
  root.append(sep);
  segs.cpu = mkSeg("cpu", "CPU", COLORS.cpu);
  segs.ram = mkSeg("ram", "RAM", COLORS.ram);
  segs.gpu = mkSeg("gpu", "GPU", COLORS.gpu);
  segs.vram = mkSeg("vram", "VRAM", COLORS.vram);
  segs.temp = mkSeg("temp", "TEMP", COLORS.temp);
  for (const key of Object.keys(segs)) root.append(segs[key].seg);
  return root;
}

function attach() {
  // 1) 新版前端：插入菜单栏设置组之前
  const settingsGroup = app.menu && app.menu.settingsGroup && app.menu.settingsGroup.element;
  if (settingsGroup) {
    settingsGroup.before(root);
    return;
  }
  // 2) 兜底：常见菜单栏选择器
  const bar = document.querySelector(
    "#comfy-menu-bar, #menu-container, .comfy-menu-bar, .menu-bar, .topbar"
  );
  if (bar) {
    bar.appendChild(root);
    return;
  }
  // 3) 最后兜底：右上角悬浮条（找不到菜单栏也保证可见）
  root.style.cssText +=
    "position:fixed;top:44px;right:12px;z-index:9999;width:auto;" +
    "background:rgba(17,17,17,.72);border:1px solid rgba(255,255,255,.14);" +
    "border-radius:8px;padding:6px 8px;backdrop-filter:blur(6px);";
  document.body.appendChild(root);
}

app.registerExtension({
  name: "XXXXXLCat.Monitor",
  async setup() {
    build();
    attach();
    setInterval(tick, REFRESH_MS);
    tick();
  },
});
