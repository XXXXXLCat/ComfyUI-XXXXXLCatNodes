<template>
  <div class="editor">
    <!-- 参数控件挂到右侧控制列 -->
    <Teleport v-if="controlsEl" :to="controlsEl">
      <RangeSlider v-model="rows" label="纵向" :min="1" :max="10" />
      <RangeSlider v-model="cols" label="横向" :min="1" :max="10" />
      <span class="editor-size">将拼接 {{ usedCount }} 张图片</span>
    </Teleport>
    <!-- 应用按钮挂到右侧底部 -->
    <Teleport v-if="applyEl" :to="applyEl">
      <button type="button" class="primary-btn" :disabled="!ready || busy" @click="apply">
        {{ busy ? "处理中…" : "应用" }}
      </button>
    </Teleport>

    <div ref="stageEl" class="editor-stage">
      <div v-if="ready" class="merge-grid" :style="gridStyle">
        <div
          v-for="(id, i) in cells"
          :key="i"
          class="merge-cell"
          :class="{ 'has-image': !!id }"
          :style="cellStyle"
          @pointerdown="startDrag($event, i)"
        >
          <img
            v-if="id && itemOf(id)"
            :src="itemOf(id).url"
            :alt="itemOf(id).name"
            draggable="false"
          />
        </div>
      </div>
      <span v-else-if="!sources.length" class="editor-hint">当前节点没有可拼接的图片</span>
      <span v-else class="editor-hint">素材加载中…</span>
    </div>

    <!-- 拖动时跟随指针的缩略图 -->
    <div
      v-if="drag"
      class="drag-ghost"
      :style="{ left: `${drag.x}px`, top: `${drag.y}px` }"
    >
      <img v-if="dragItem" :src="dragItem.url" alt="" draggable="false" />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { canvasToBlob, loadImage } from "../../../utils/image";
import RangeSlider from "./RangeSlider.vue";

const props = defineProps({
  media: { type: Array, default: () => [] },
  name: { type: String, default: "" },
  controlsEl: { type: Object, default: null },
  applyEl: { type: Object, default: null },
});

const emit = defineEmits(["apply"]);

const stageEl = ref(null);
const images = reactive({}); // id -> { el, w, h }
const cells = ref([]);
const rows = ref(1);
const cols = ref(1);
const scale = ref(1);
const busy = ref(false);
const drag = ref(null);
let observer = null;

// 拼接只处理图像素材
const sources = computed(() =>
  props.media.filter((item) => item && item.kind === "image" && item.url)
);

const usedCount = computed(() => cells.value.filter((id) => !!id).length);

const cellRatio = computed(() => {
  const sizes = Object.values(images);
  if (!sizes.length) return 1;
  const w = Math.max(...sizes.map((item) => item.w));
  const h = Math.max(...sizes.map((item) => item.h));
  return w / h;
});

const ready = computed(() => {
  if (!sources.value.length) return false;
  if (!sources.value.every((item) => images[item.id])) return false;
  return true;
});

const cellStyle = computed(() => {
  const ratio = cellRatio.value;
  const baseW = ratio >= 1 ? 150 : 150 * ratio;
  const baseH = ratio >= 1 ? 150 / ratio : 150;
  return {
    width: `${Math.round(baseW * scale.value)}px`,
    height: `${Math.round(baseH * scale.value)}px`,
  };
});

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${cols.value}, 1fr)`,
}));

function measure() {
  if (!stageEl.value || !ready.value) return;
  const rect = stageEl.value.getBoundingClientRect();
  const ratio = cellRatio.value;
  const cellW = ratio >= 1 ? 150 : 150 * ratio;
  const cellH = ratio >= 1 ? 150 / ratio : 150;
  const availableW = Math.max(160, rect.width - 60);
  const availableH = Math.max(120, rect.height - 40);
  scale.value = Math.min(
    availableW / (cellW * cols.value),
    availableH / (cellH * rows.value),
    1
  );
}

function rebuildCells() {
  const total = rows.value * cols.value;
  const next = [];
  for (let i = 0; i < total; i += 1) {
    const item = sources.value[i];
    next.push(item ? item.id : null);
  }
  cells.value = next;
}

watch([rows, cols], () => {
  rebuildCells();
  measure();
});

watch(() => sources.value.length, (count) => {
  if (!count) return;
  cols.value = Math.max(1, Math.min(3, count));
  rows.value = Math.max(1, Math.ceil(count / cols.value));
  rebuildCells();
  measure();
});

function itemOf(id) {
  return props.media.find((item) => item.id === id) || null;
}

const dragItem = computed(() => (drag.value ? itemOf(cells.value[drag.value.index]) : null));

function startDrag(event, index) {
  if (!cells.value[index]) return;
  event.preventDefault();
  drag.value = { index, x: event.clientX, y: event.clientY, moved: false };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function onMove(event) {
  if (!drag.value) return;
  drag.value.x = event.clientX;
  drag.value.y = event.clientY;
  drag.value.moved = true;
}

function onUp(event) {
  const current = drag.value;
  drag.value = null;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  if (!current || !current.moved) return;

  const target = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest(".merge-cell");
  if (!target) return;

  const cellsEl = Array.from(document.querySelectorAll(".merge-cell"));
  const targetIndex = cellsEl.indexOf(target);
  if (targetIndex < 0 || targetIndex === current.index) return;

  const next = [...cells.value];
  const tmp = next[current.index];
  next[current.index] = next[targetIndex];
  next[targetIndex] = tmp;
  cells.value = next;
}

async function load() {
  for (const item of sources.value) {
    if (!item || images[item.id]) continue;
    try {
      const image = await loadImage(item.url);
      images[item.id] = { el: image, w: image.naturalWidth, h: image.naturalHeight };
    } catch (error) {
      console.warn("[Infinite-Canvas] 拼接素材加载失败", error);
    }
  }
  const count = sources.value.length;
  cols.value = Math.max(1, Math.min(3, count));
  rows.value = Math.max(1, Math.ceil(count / cols.value));
  rebuildCells();
  measure();
}

async function apply() {
  if (!ready.value || busy.value) return;
  busy.value = true;
  try {
    const ratio = cellRatio.value;
    let cellW = ratio >= 1 ? 1024 : 1024 * ratio;
    let cellH = ratio >= 1 ? 1024 / ratio : 1024;
    const totalW = cols.value * cellW;
    const totalH = rows.value * cellH;
    const limit = 4096;
    if (Math.max(totalW, totalH) > limit) {
      const factor = limit / Math.max(totalW, totalH);
      cellW *= factor;
      cellH *= factor;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(cols.value * cellW);
    canvas.height = Math.round(rows.value * cellH);
    const context = canvas.getContext("2d");

    cells.value.forEach((id, index) => {
      if (!id) return;
      const info = images[id];
      if (!info) return;
      const cx = Math.floor(index % cols.value) * cellW;
      const cy = Math.floor(index / cols.value) * cellH;
      // 等比铺满格子（居中裁掉多余部分）
      const cover = Math.max(cellW / info.w, cellH / info.h);
      const sw = cellW / cover;
      const sh = cellH / cover;
      const sx = (info.w - sw) / 2;
      const sy = (info.h - sh) / 2;
      context.drawImage(info.el, sx, sy, sw, sh, cx, cy, cellW, cellH);
    });

    const blob = await canvasToBlob(canvas);
    const base = props.name ? props.name.replace(/\.\w+$/, "") : "image";
    emit("apply", blob, `${base}-merge.png`);
  } catch (error) {
    console.warn("[Infinite-Canvas] 宫格拼接失败", error);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  load();
  if (stageEl.value) {
    observer = new ResizeObserver(() => measure());
    observer.observe(stageEl.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  if (observer) observer.disconnect();
});
</script>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.editor-size {
  font-size: 12px;
  color: var(--c-muted);
}

.primary-btn {
  width: 100%;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--accent-yellow);
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.primary-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.editor-stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--c-surface);
  user-select: none;
  touch-action: none;
}

.merge-grid {
  display: grid;
}

.merge-cell {
  position: relative;
  overflow: hidden;
  border: 1px dashed var(--c-border-strong);
  box-sizing: border-box;
  background: var(--c-surface-2);
}

.merge-cell.has-image {
  border-color: transparent;
  cursor: grab;
}

.merge-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  user-select: none;
}

.drag-ghost {
  position: fixed;
  z-index: 1000;
  width: 84px;
  height: 84px;
  transform: translate(-50%, -50%);
  border: 2px solid var(--accent-yellow);
  border-radius: 8px;
  overflow: hidden;
  pointer-events: none;
  opacity: 0.9;
}

.drag-ghost img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.editor-hint {
  color: var(--c-muted);
  font-size: 12px;
}
</style>
