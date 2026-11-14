<template>
  <div class="wf-preview">
    <div class="wf-tools">
      <button type="button" title="缩小" @click="zoomTo(currentZoom - 0.2)">−</button>
      <span class="wf-zoom">{{ Math.round(currentZoom * 100) }}%</span>
      <button type="button" title="放大" @click="zoomTo(currentZoom + 0.2)">+</button>
      <button type="button" class="wf-fit" title="适应画布" @click="fit">适应</button>
    </div>

    <VueFlow
      id="wf-preview"
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes"
      :min-zoom="0.2"
      :max-zoom="2"
      :nodes-draggable="false"
      :nodes-connectable="false"
      :elements-selectable="false"
      :zoom-on-double-click="false"
      :fit-view-on-init="true"
      @node-click="onNodeClick"
    >
      <Background :pattern-color="canvasGridColor" :gap="18" />
    </VueFlow>

    <div v-if="!workflow" class="wf-empty">选择左侧工作流查看预览</div>
    <div v-else-if="!fields.length" class="wf-empty is-tip">点击节点配置可暴露给画布的参数</div>
  </div>
</template>

<script setup>
import { computed, markRaw, nextTick, watch } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import PreviewNode from "./PreviewNode.vue";
import { useTheme } from "../../composables/useTheme.js";

const props = defineProps({
  workflow: { type: Object, default: null },
  fields: { type: Array, default: () => [] },
});

const emit = defineEmits(["inspect"]);

const nodeTypes = { preview: markRaw(PreviewNode) };
const { canvasGridColor } = useTheme();

// 每个节点已暴露的字段数，画在节点卡片上
const exposedCount = computed(() => {
  const counts = new Map();
  for (const field of props.fields) {
    const id = String(field.nodeId);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
});

function onNodeClick({ node }) {
  emit("inspect", String(node.id));
}

// 自动布局：按依赖深度分列，同列内依次向下排
const COL_STEP = 220;
const ROW_STEP = 62;

const nodes = computed(() => {
  const workflow = props.workflow;
  if (!workflow) return [];

  const ids = Object.keys(workflow);
  const sourceOf = (id) => {
    const targets = new Set();
    const inputs = (workflow[id] && workflow[id].inputs) || {};
    for (const value of Object.values(inputs)) {
      // API 格式里连线是 [上游节点 id, 输出槽位]
      if (Array.isArray(value) && value.length === 2 && workflow[String(value[0])]) {
        targets.add(String(value[0]));
      }
    }
    return [...targets];
  };

  const depth = new Map();
  const visiting = new Set();
  const visit = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0; // 防御环
    visiting.add(id);
    let level = 0;
    for (const up of sourceOf(id)) level = Math.max(level, visit(up) + 1);
    visiting.delete(id);
    depth.set(id, level);
    return level;
  };
  ids.forEach(visit);

  // 每列节点数，按最长列居中排布，图形更均衡
  const levelCount = new Map();
  for (const id of ids) {
    const level = depth.get(id) || 0;
    levelCount.set(level, (levelCount.get(level) || 0) + 1);
  }
  const maxCount = Math.max(...levelCount.values(), 1);

  const rows = new Map();
  return ids.map((id) => {
    const level = depth.get(id) || 0;
    const row = rows.get(level) || 0;
    rows.set(level, row + 1);
    const offset = (maxCount - levelCount.get(level)) / 2;
    const info = workflow[id] || {};
    return {
      id,
      type: "preview",
      position: { x: level * COL_STEP, y: (offset + row) * ROW_STEP },
      data: {
        title: (info._meta && info._meta.title) || info.class_type || id,
        classType: info.class_type || "",
        hue: hueOf(info.class_type || id),
        exposed: exposedCount.value.get(id) || 0,
      },
    };
  });
});

const edges = computed(() => {
  const workflow = props.workflow;
  if (!workflow) return [];

  const seen = new Set();
  const result = [];
  for (const [id, info] of Object.entries(workflow)) {
    const inputs = (info && info.inputs) || {};
    for (const value of Object.values(inputs)) {
      if (!Array.isArray(value) || value.length !== 2) continue;
      const source = String(value[0]);
      if (!workflow[source]) continue;
      const key = `${source}->${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ id: key, source, target: id, type: "default" });
    }
  }
  return result;
});

// 同一 class_type 用固定色相，方便在预览里区分节点类别
function hueOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

const flow = useVueFlow("wf-preview");
const currentZoom = computed(() => flow.viewport.value.zoom || 1);

function zoomTo(level) {
  flow.zoomTo(Math.min(Math.max(level, 0.2), 2), { duration: 180 });
}

function fit() {
  // 图很小时不放大过头，保持可读
  flow.fitView({ padding: 0.1, maxZoom: 1, duration: 250 });
}

watch(
  () => props.workflow,
  async () => {
    await nextTick();
    if (nodes.value.length) fit();
  }
);
</script>

<style scoped>
.wf-preview {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  overflow: hidden;
  background: var(--c-input-bg);
}

.wf-preview :deep(.vue-flow) {
  width: 100%;
  height: 100%;
}

.wf-preview :deep(.vue-flow__node) {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
}

.wf-preview :deep(.vue-flow__edge-path) {
  stroke: var(--c-edge);
  stroke-width: 1.2;
}

.wf-tools {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--c-surface) 90%, transparent);
  backdrop-filter: blur(6px);
}

.wf-tools button {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 13px;
}

.wf-tools button:hover {
  background: var(--c-hover);
  color: var(--c-text);
}

.wf-fit {
  width: auto !important;
  padding: 0 8px;
  font-size: 11px !important;
}

.wf-zoom {
  min-width: 40px;
  text-align: center;
  font-size: 11px;
  color: var(--c-muted);
}

.wf-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 12px;
  color: var(--c-muted);
  pointer-events: none;
}

/* 没有字段时的操作提示，贴在画布底部，不遮挡节点 */
.wf-empty.is-tip {
  inset: auto 0 14px;
  font-size: 11px;
  color: var(--c-muted);
}
</style>
