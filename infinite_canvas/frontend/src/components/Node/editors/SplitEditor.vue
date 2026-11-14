<template>
  <div class="editor">
    <!-- 参数控件挂到右侧控制列 -->
    <Teleport v-if="controlsEl" :to="controlsEl">
      <RangeSlider v-model="hLines" label="横向线" :min="0" :max="10" />
      <RangeSlider v-model="vLines" label="纵向线" :min="0" :max="10" />
      <span class="editor-size">将输出 {{ outputCount }} 张</span>
    </Teleport>
    <!-- 应用按钮挂到右侧底部 -->
    <Teleport v-if="applyEl" :to="applyEl">
      <button type="button" class="primary-btn" :disabled="!ready || busy" @click="apply">
        {{ busy ? "处理中…" : "应用" }}
      </button>
    </Teleport>

    <div ref="stageEl" class="editor-stage">
      <div v-if="ready" class="split-wrap" :style="wrapStyle">
        <img :src="src" :alt="name" draggable="false" class="split-img" />
        <template v-for="row in rowLines" :key="`r${row}`">
          <span class="grid-line is-h" :style="{ top: `${(row / rowTotal) * 100}%` }" />
        </template>
        <template v-for="col in colLines" :key="`c${col}`">
          <span class="grid-line is-v" :style="{ left: `${(col / colTotal) * 100}%` }" />
        </template>
        <span class="grid-border" />
      </div>
      <span v-else class="editor-hint">图片加载中…</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { canvasToBlob, loadImage } from "../../../utils/image";
import RangeSlider from "./RangeSlider.vue";

const props = defineProps({
  src: { type: String, required: true },
  name: { type: String, default: "" },
  controlsEl: { type: Object, default: null },
  applyEl: { type: Object, default: null },
});

const emit = defineEmits(["apply"]);

const stageEl = ref(null);
const sourceImage = ref(null);
const natural = reactive({ w: 0, h: 0 });
const scale = ref(1);
const hLines = ref(1);
const vLines = ref(1);
const busy = ref(false);
let observer = null;

const rowTotal = computed(() => hLines.value + 1);
const colTotal = computed(() => vLines.value + 1);
const outputCount = computed(() => rowTotal.value * colTotal.value);

const rowLines = computed(() =>
  Array.from({ length: hLines.value }, (_, i) => i + 1)
);
const colLines = computed(() =>
  Array.from({ length: vLines.value }, (_, i) => i + 1)
);

const ready = computed(() => natural.w > 0 && natural.h > 0 && scale.value > 0);

const wrapStyle = computed(() => ({
  width: `${natural.w * scale.value}px`,
  height: `${natural.h * scale.value}px`,
}));

function measure() {
  if (!stageEl.value || !natural.w) return;
  const rect = stageEl.value.getBoundingClientRect();
  const availableW = Math.max(160, rect.width - 36);
  const availableH = Math.max(120, rect.height - 24);
  scale.value = Math.min(availableW / natural.w, availableH / natural.h);
}

async function load() {
  natural.w = 0;
  natural.h = 0;
  try {
    const image = await loadImage(props.src);
    sourceImage.value = image;
    natural.w = image.naturalWidth;
    natural.h = image.naturalHeight;
    measure();
  } catch (error) {
    console.warn("[Infinite-Canvas] 宫格切分素材加载失败", error);
  }
}

watch(() => props.src, load);

async function apply() {
  if (!ready.value || !sourceImage.value || busy.value) return;
  busy.value = true;
  try {
    const image = sourceImage.value;
    const rows = rowTotal.value;
    const cols = colTotal.value;
    const base = props.name ? props.name.replace(/\.\w+$/, "") : "image";
    const pieces = [];

    for (let r = 0; r < rows; r += 1) {
      const y0 = Math.round((image.naturalHeight * r) / rows);
      const y1 = Math.round((image.naturalHeight * (r + 1)) / rows);
      for (let c = 0; c < cols; c += 1) {
        const x0 = Math.round((image.naturalWidth * c) / cols);
        const x1 = Math.round((image.naturalWidth * (c + 1)) / cols);
        const w = Math.max(1, x1 - x0);
        const h = Math.max(1, y1 - y0);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        context.drawImage(image, x0, y0, w, h, 0, 0, w, h);
        const blob = await canvasToBlob(canvas);
        pieces.push({ blob, name: `${base}-${r + 1}-${c + 1}.png` });
      }
    }

    emit("apply", pieces);
  } catch (error) {
    console.warn("[Infinite-Canvas] 宫格切分失败", error);
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
}

.split-wrap {
  position: relative;
}

.split-img {
  display: block;
  width: 100%;
  height: 100%;
}

.grid-line {
  position: absolute;
  background: rgba(255, 255, 255, 0.85);
  pointer-events: none;
}

.grid-line.is-h {
  left: 0;
  right: 0;
  height: 1px;
  transform: translateY(-0.5px);
}

.grid-line.is-v {
  top: 0;
  bottom: 0;
  width: 1px;
  transform: translateX(-0.5px);
}

.grid-border {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.85);
  pointer-events: none;
}

.editor-hint {
  color: var(--c-muted);
  font-size: 12px;
}
</style>
