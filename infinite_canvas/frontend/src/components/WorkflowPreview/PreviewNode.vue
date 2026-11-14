<template>
  <div
    class="preview-node"
    :class="{ 'is-configurable': data.exposed > 0 }"
    :style="{ '--n-hue': data.hue }"
  >
    <Handle type="target" :position="Position.Left" class="preview-handle" />
    <div class="preview-title">
      {{ data.title }}<span class="preview-id">#{{ id }}</span>
    </div>
    <div class="preview-type">
      {{ data.classType }}
      <span v-if="data.exposed" class="preview-count">{{ data.exposed }} 已用</span>
    </div>
    <Handle type="source" :position="Position.Right" class="preview-handle" />
  </div>
</template>

<script setup>
import { Handle, Position } from "@vue-flow/core";

defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
});
</script>

<style scoped>
.preview-node {
  width: 168px;
  padding: 6px 9px;
  border: 1px solid hsl(var(--n-hue) 42% 55% / 0.5);
  border-radius: 8px;
  background: hsl(var(--n-hue) 32% 15%);
  box-shadow: 0 4px 12px var(--c-shadow);
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.preview-node:hover {
  border-color: hsl(var(--n-hue) 55% 70%);
  box-shadow: 0 4px 16px var(--c-shadow);
}

.preview-node.is-configurable {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
}

.preview-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
}

.preview-title > span {
  flex: 0 0 auto;
}

.preview-id {
  font-weight: 400;
  font-size: 10px;
  color: hsl(var(--n-hue) 55% 72%);
}

.preview-type {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 10px;
  color: var(--c-muted);
  white-space: nowrap;
  overflow: hidden;
}

.preview-count {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--c-accent);
}

.preview-handle {
  width: 6px;
  height: 6px;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: hsl(var(--n-hue) 45% 60% / 0.7);
}

/* 亮色：节点底色变浅，色相保留；标题/类型文字切到主题文字色 */
html[data-theme="light"] .preview-node {
  border-color: hsl(var(--n-hue) 38% 62% / 0.45);
  background: hsl(var(--n-hue) 40% 93%);
}

html[data-theme="light"] .preview-node:hover {
  border-color: hsl(var(--n-hue) 45% 45%);
}

html[data-theme="light"] .preview-node.is-configurable {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
}

html[data-theme="light"] .preview-id {
  color: hsl(var(--n-hue) 55% 32%);
}

html[data-theme="light"] .preview-handle {
  background: hsl(var(--n-hue) 45% 45% / 0.7);
}
</style>
