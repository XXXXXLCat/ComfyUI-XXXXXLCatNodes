<template>
  <div class="float-window" role="dialog" :aria-label="title" :style="{ width, height }">
    <header class="float-head">
      <span class="float-title">{{ title }}</span>
      <button class="float-close" title="关闭" @click="emit('close')">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </header>
    <div class="float-body">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted } from "vue";

defineProps({
  title: { type: String, default: "" },
  width: { type: String, default: "80vw" },
  height: { type: String, default: "80vh" },
});

const emit = defineEmits(["close"]);

function closeOnEsc(event) {
  if (event.key === "Escape") emit("close");
}

onMounted(() => window.addEventListener("keydown", closeOnEsc));
onBeforeUnmount(() => window.removeEventListener("keydown", closeOnEsc));
</script>

<style scoped>
.float-window {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  max-width: 96vw;
  max-height: 92vh;
  border: 1px solid var(--c-line);
  border-radius: 20px;
  background: var(--c-panel);
  box-shadow: 0 20px 60px var(--c-shadow);
}

.float-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--c-line);
}

.float-title {
  font-size: 13px;
  font-weight: 600;
}

.float-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
}

.float-close:hover {
  background: var(--c-hover);
  color: var(--c-text);
}

.float-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px;
  overflow: auto;
  color: var(--c-muted);
  font-size: 12px;
}
</style>
