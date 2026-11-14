<template>
  <div class="canvas-tabbar">
    <button
      class="tb-btn tb-btn--primary"
      type="button"
      title="聚焦节点（优先定位正在运行的节点，否则回到上次选择的节点）"
      @click="emit('focus')"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M2.6 2.6 21.4 10.4l-7.6 3.2-3.2 7.6L2.6 2.6z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        />
        <path
          d="M13.8 13.6 2.6 2.6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <button class="tb-btn" type="button" title="全览画布" @click="emit('fit')">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path
          d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <rect
          x="9"
          y="9"
          width="6"
          height="6"
          rx="1.2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        />
      </svg>
    </button>

    <span class="tb-sep" />

    <button class="tb-btn" type="button" title="画布管理" @click="emit('canvas')">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path
          d="M12 3 3 7.5l9 4.5 9-4.5L12 3z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
        <path
          d="M3 12.2 12 16.7l9-4.5M3 16.7 12 21.2l9-4.5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <button class="tb-btn" type="button" title="资产管理" @click="emit('assets')">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <rect
          x="3.5"
          y="3.5"
          width="12"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
        />
        <path
          d="M7 8h5M7 11.5h5M7 15h3"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <path
          d="M18.5 6.5v11a2 2 0 0 1-2 2H8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <button class="tb-btn" type="button" title="工作流配置" @click="emit('workflow')">
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path
          d="M4 7h10M18 7h2M4 17h2M10 17h10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
        <circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.6" />
        <circle cx="8" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.6" />
      </svg>
    </button>
  </div>
</template>

<script setup>
const emit = defineEmits(["focus", "fit", "canvas", "assets", "workflow"]);
</script>

<style scoped>
.canvas-tabbar {
  position: absolute;
  left: 50%;
  bottom: 16px;
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  transform: translateX(-50%);
  border: 1px solid var(--c-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--c-surface) 92%, transparent);
  box-shadow: 0 10px 28px var(--c-shadow);
  backdrop-filter: blur(10px);
}

.tb-btn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--c-text);
  transition: background 0.15s, color 0.15s;
}

.tb-btn:hover {
  background: var(--c-hover);
  color: var(--c-strong-text);
}

.tb-btn:active {
  color: var(--c-accent);
}

/* 聚焦按钮用主题色高亮，和其余工具区分开 */
.tb-btn--primary {
  color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 13%, transparent);
}

.tb-btn--primary:hover {
  color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 22%, transparent);
}

.tb-sep {
  width: 1px;
  height: 18px;
  margin: 0 2px;
  background: var(--c-line);
}
</style>
