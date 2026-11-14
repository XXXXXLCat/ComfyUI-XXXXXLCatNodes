import { ref } from "vue";

// 右上角「提示词 / 资产库 / 日志」面板与节点提示词框之间共享的状态
// 模块级单例：App 挂面板，Node 只需要登记自己能接收提示词
const panel = ref(null); // "prompt" | "asset" | "log" | null
// 面板打开（选中）的节点各自的写入通道：nodeId -> { insert(text, useCaret), isActive() }
const targets = new Map();
// 给面板底部提示用：当前有多少个节点可以接收提示词
const targetCount = ref(0);

// 从资产库拖进画布时用的私有类型，避免和系统文件、节点素材混淆
export const FILE_ASSET_DRAG_TYPE = "application/x-infinite-canvas-file-asset";

// 被嵌在 ComfyUI 的 iframe 里时，异步剪贴板 API 可能因权限或焦点被拒，
// 退回 execCommand + 临时 textarea（点击条目本身是用户手势，仍然有效）
function legacyCopy(text) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-1000px";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

export function useLibrary() {
  function open(name) {
    panel.value = name;
  }

  function close() {
    panel.value = null;
  }

  function toggle(name) {
    panel.value = panel.value === name ? null : name;
  }

  // 节点面板展开时登记，收起/卸载时注销
  function registerTarget(nodeId, target) {
    targets.set(nodeId, target);
    targetCount.value = targets.size;
  }

  function unregisterTarget(nodeId) {
    if (!targets.delete(nodeId)) return;
    targetCount.value = targets.size;
  }

  // 点条目：有聚焦的提示词框就按光标插入（全选时即整体替换），
  // 否则把提示词追加到所有面板打开的节点；一个都没选中时复制到剪贴板
  async function insertPrompt(text) {
    if (!text) return "";
    if (!targets.size) {
      return (await copyText(text)) ? "copied" : "failed";
    }
    const active = [...targets.values()].find((target) => target.isActive?.());
    if (active) {
      active.insert(text, true);
    } else {
      targets.forEach((target) => target.insert(text, false));
    }
    // 面板保持打开，方便连续插入
    return "inserted";
  }

  return {
    panel,
    targetCount,
    open,
    close,
    toggle,
    registerTarget,
    unregisterTarget,
    insertPrompt,
  };
}
