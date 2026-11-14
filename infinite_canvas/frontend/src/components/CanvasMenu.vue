<template>
  <div class="canvas-menu" @click.stop>
    <Transition name="cm-fade">
      <div v-if="open" class="cm-pop">
        <button class="cm-item" type="button" @click="switchTheme">
          <svg v-if="isLight" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5a8.5 8.5 0 1 0 11.7 11.7z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linejoin="round"
            />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path
              d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          <span>{{ isLight ? "暗色模式" : "亮色模式" }}</span>
        </button>
        <button
          class="cm-item"
          type="button"
          title="卸载已加载的模型并清空显存 / 内存缓存"
          :disabled="freeState === 'busy'"
          @click="freeMemory"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
            <path
              d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
          <span>{{ freeLabel }}</span>
        </button>
        <button class="cm-item is-danger" type="button" @click="exitCanvas">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 12H3M6.5 8.5L3 12l3.5 3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>退出画布</span>
        </button>
      </div>
    </Transition>
    <button class="cm-fab" type="button" title="菜单" aria-label="菜单" @click.stop="open = !open">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M4 7h16M4 12h16M4 17h16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useTheme } from "../composables/useTheme.js";

const { isLight, toggleTheme } = useTheme();

const open = ref(false);
// 被嵌进 ComfyUI 弹窗时通知外层关闭；直接打开页面（本地调试）时退回上一页或 ComfyUI 首页
const embedded = ref(false);

// 走后端接口（内部转发 ComfyUI 的 POST /free）：本地 vite dev server 下也能用
const freeState = ref("idle");
let freeTimer = null;
const freeLabel = computed(
  () =>
    ({
      idle: "释放显存",
      busy: "正在释放…",
      done: "显存已释放",
      error: "释放失败",
    })[freeState.value]
);

async function freeMemory() {
  if (freeState.value === "busy") return;
  freeState.value = "busy";
  clearTimeout(freeTimer);
  try {
    const response = await fetch("/infinite_canvas/api/free", { method: "POST" });
    if (!response.ok) throw new Error(String(response.status));
    freeState.value = "done";
  } catch {
    freeState.value = "error";
  }
  freeTimer = setTimeout(() => {
    freeState.value = "idle";
  }, 2000);
}

function switchTheme() {
  toggleTheme();
}

function exitCanvas() {
  open.value = false;
  if (embedded.value) {
    window.parent.postMessage({ type: "infinite-canvas:close" }, window.location.origin);
    return;
  }
  if (document.referrer) {
    window.history.back();
    return;
  }
  // 没有来源页（比如直接输入地址打开）就回 ComfyUI 首页
  window.location.href = "/";
}

function closeMenu() {
  open.value = false;
}

function onKeydown(event) {
  if (event.key === "Escape" && open.value) closeMenu();
}

onMounted(() => {
  embedded.value = window.self !== window.top;
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeMenu);
  document.removeEventListener("keydown", onKeydown);
  clearTimeout(freeTimer);
});
</script>

<style scoped>
.canvas-menu {
  position: absolute;
  right: 18px;
  bottom: 16px;
  /* 层级要低于右侧面板（资产库 z=6 / 提示词面板），避免挡住面板内容 */
  z-index: 4;
}

.cm-fab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--c-line);
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-surface) 92%, transparent);
  color: var(--c-text);
  box-shadow: 0 10px 28px var(--c-shadow);
  backdrop-filter: blur(10px);
  transition: transform 0.15s, background 0.15s, color 0.15s;
}

.cm-fab:hover {
  transform: translateY(-1px);
  background: var(--c-hover);
  color: var(--c-strong-text);
}

.cm-fab:active {
  transform: scale(0.96);
}

.cm-fab svg,
.cm-item svg {
  pointer-events: none;
}

.cm-pop {
  position: absolute;
  right: 0;
  bottom: 48px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 160px;
  padding: 5px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-surface);
  box-shadow: 0 10px 28px var(--c-shadow);
}

.cm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-text);
  font-size: 13px;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.cm-item:hover {
  background: var(--c-hover);
  color: var(--c-strong-text);
}

.cm-item:disabled {
  opacity: 0.65;
  cursor: default;
}

.cm-item:disabled:hover {
  background: transparent;
  color: var(--c-text);
}

.cm-item.is-danger {
  color: var(--c-danger);
}

.cm-item.is-danger:hover {
  background: color-mix(in srgb, var(--c-danger) 12%, transparent);
}

.cm-fade-enter-active,
.cm-fade-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.cm-fade-enter-from,
.cm-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
