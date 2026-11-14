<template>
  <div class="editor">
    <!-- 参数控件挂到右侧控制列 -->
    <Teleport v-if="controlsEl" :to="controlsEl">
      <select v-model="ratioKey" class="ratio-select" @change="applyRatio">
        <option v-for="option in ratioOptions" :key="option.key" :value="option.key">
          {{ option.label }}
        </option>
      </select>
      <span class="editor-size">{{ sizeText }}</span>
    </Teleport>
    <!-- 应用按钮挂到右侧底部 -->
    <Teleport v-if="applyEl" :to="applyEl">
      <button type="button" class="primary-btn" :disabled="!ready" @click="apply">应用</button>
    </Teleport>

    <div ref="stageEl" class="editor-stage">
      <div v-if="ready" class="crop-wrap" :style="wrapStyle">
        <img :src="src" :alt="name" draggable="false" class="crop-img" />

        <!-- 框外压暗 -->
        <div class="crop-mask" :style="{ top: 0, left: 0, right: 0, height: `${boxDisp.y}px` }" />
        <div
          class="crop-mask"
          :style="{ top: `${boxDisp.y}px`, left: 0, width: `${boxDisp.x}px`, height: `${boxDisp.h}px` }"
        />
        <div
          class="crop-mask"
          :style="{
            top: `${boxDisp.y}px`,
            left: `${boxDisp.x + boxDisp.w}px`,
            right: 0,
            height: `${boxDisp.h}px`,
          }"
        />
        <div
          class="crop-mask"
          :style="{
            top: `${boxDisp.y + boxDisp.h}px`,
            left: 0,
            right: 0,
            bottom: 0,
          }"
        />

        <!-- 裁切框 -->
        <div class="crop-box" :style="boxStyle" @pointerdown="startMove">
          <span
            v-for="handle in handles"
            :key="handle"
            class="crop-handle"
            :class="`is-${handle}`"
            @pointerdown.stop="startResize($event, handle)"
          />
        </div>
      </div>
      <span v-else class="editor-hint">图片加载中…</span>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { canvasToBlob, clamp, loadImage } from "../../../utils/image";

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
const crop = reactive({ x: 0, y: 0, w: 0, h: 0 });
const scale = ref(1);
const ratioKey = ref("free");
let dragState = null;
let observer = null;

const ratioOptions = [
  { key: "free", label: "自由裁切" },
  { key: "original", label: "原图比例" },
  { key: "1:1", label: "1:1" },
  { key: "4:3", label: "4:3" },
  { key: "3:4", label: "3:4" },
  { key: "16:9", label: "16:9" },
  { key: "9:16", label: "9:16" },
];

const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const ready = computed(() => natural.w > 0 && natural.h > 0 && scale.value > 0);

const activeRatio = computed(() => {
  if (ratioKey.value === "free") return 0;
  if (ratioKey.value === "original") return natural.w / (natural.h || 1);
  const [a, b] = ratioKey.value.split(":").map(Number);
  return a / b;
});

const boxDisp = computed(() => ({
  x: crop.x * scale.value,
  y: crop.y * scale.value,
  w: crop.w * scale.value,
  h: crop.h * scale.value,
}));

const wrapStyle = computed(() => ({
  width: `${natural.w * scale.value}px`,
  height: `${natural.h * scale.value}px`,
}));

const boxStyle = computed(() => ({
  left: `${boxDisp.value.x}px`,
  top: `${boxDisp.value.y}px`,
  width: `${boxDisp.value.w}px`,
  height: `${boxDisp.value.h}px`,
}));

const sizeText = computed(() =>
  ready.value ? `${Math.round(crop.w)} × ${Math.round(crop.h)}` : ""
);

function measure() {
  if (!stageEl.value || !natural.w) return;
  const rect = stageEl.value.getBoundingClientRect();
  const availableW = Math.max(160, rect.width - 36);
  const availableH = Math.max(120, rect.height - 24);
  scale.value = Math.min(availableW / natural.w, availableH / natural.h);
}

function initBox() {
  crop.w = natural.w * 0.8;
  crop.h = natural.h * 0.8;
  crop.x = (natural.w - crop.w) / 2;
  crop.y = (natural.h - crop.h) / 2;
}

async function load() {
  natural.w = 0;
  natural.h = 0;
  try {
    const image = await loadImage(props.src);
    sourceImage.value = image;
    natural.w = image.naturalWidth;
    natural.h = image.naturalHeight;
    initBox();
    measure();
  } catch (error) {
    console.warn("[Infinite-Canvas] 裁切图加载失败", error);
  }
}

watch(() => props.src, load);
watch(scale, () => {
  if (!ready.value) return;
  crop.x = clamp(crop.x, 0, natural.w - crop.w);
  crop.y = clamp(crop.y, 0, natural.h - crop.h);
});

function applyRatio() {
  const ratio = activeRatio.value;
  if (!ratio || !ready.value) return;
  const cx = crop.x + crop.w / 2;
  const cy = crop.y + crop.h / 2;
  let h = crop.h;
  let w = h * ratio;
  if (w > natural.w) {
    w = natural.w;
    h = w / ratio;
  }
  if (h > natural.h) {
    h = natural.h;
    w = h * ratio;
  }
  crop.w = w;
  crop.h = h;
  crop.x = clamp(cx - w / 2, 0, natural.w - w);
  crop.y = clamp(cy - h / 2, 0, natural.h - h);
}

function listen() {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function unlisten() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

function startMove(event) {
  event.preventDefault();
  dragState = {
    type: "move",
    sx: event.clientX,
    sy: event.clientY,
    start: { ...crop },
  };
  listen();
}

function startResize(event, handle) {
  event.preventDefault();
  dragState = {
    type: "resize",
    handle,
    sx: event.clientX,
    sy: event.clientY,
    start: { ...crop },
    ratio: activeRatio.value,
  };
  listen();
}

function onPointerMove(event) {
  if (!dragState) return;
  const dx = (event.clientX - dragState.sx) / scale.value;
  const dy = (event.clientY - dragState.sy) / scale.value;

  if (dragState.type === "move") {
    crop.x = clamp(dragState.start.x + dx, 0, natural.w - dragState.start.w);
    crop.y = clamp(dragState.start.y + dy, 0, natural.h - dragState.start.h);
    return;
  }

  const start = dragState.start;
  const handle = dragState.handle;
  const ratio = dragState.ratio;
  const MIN = 32;

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle.includes("w")) left = clamp(start.x + dx, 0, right - MIN);
  if (handle.includes("e")) right = clamp(start.x + start.w + dx, left + MIN, natural.w);
  if (handle.includes("n")) top = clamp(start.y + dy, 0, bottom - MIN);
  if (handle.includes("s")) bottom = clamp(start.y + start.h + dy, top + MIN, natural.h);

  let w = right - left;
  let h = bottom - top;

  if (!ratio) {
    crop.x = left;
    crop.y = top;
    crop.w = w;
    crop.h = h;
    return;
  }

  // 锁定比例：先定一条边，再按固定边/中线锚点重新摆放
  const anchorX = handle.includes("w")
    ? start.x + start.w
    : handle.includes("e")
      ? start.x
      : start.x + start.w / 2;
  const anchorY = handle.includes("n")
    ? start.y + start.h
    : handle.includes("s")
      ? start.y
      : start.y + start.h / 2;

  const maxW = handle.includes("w")
    ? anchorX
    : handle.includes("e")
      ? natural.w - anchorX
      : 2 * Math.min(anchorX, natural.w - anchorX);
  const maxH = handle.includes("n")
    ? anchorY
    : handle.includes("s")
      ? natural.h - anchorY
      : 2 * Math.min(anchorY, natural.h - anchorY);

  const corner = (handle.includes("w") || handle.includes("e")) && (handle.includes("n") || handle.includes("s"));
  if (corner) {
    if (w / ratio >= h) h = w / ratio;
    else w = h * ratio;
  } else if (handle.includes("w") || handle.includes("e")) {
    h = w / ratio;
  } else {
    w = h * ratio;
  }

  w = Math.max(MIN, Math.min(w, maxW, maxH * ratio));
  h = w / ratio;

  const finalLeft = handle.includes("w")
    ? anchorX - w
    : handle.includes("e")
      ? anchorX
      : anchorX - w / 2;
  const finalTop = handle.includes("n")
    ? anchorY - h
    : handle.includes("s")
      ? anchorY
      : anchorY - h / 2;

  crop.x = clamp(finalLeft, 0, natural.w - w);
  crop.y = clamp(finalTop, 0, natural.h - h);
  crop.w = w;
  crop.h = h;
}

function onPointerUp() {
  dragState = null;
  unlisten();
}

async function apply() {
  if (!ready.value || !sourceImage.value) return;
  const w = Math.max(1, Math.round(crop.w));
  const h = Math.max(1, Math.round(crop.h));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d");
  context.drawImage(
    sourceImage.value,
    Math.round(crop.x),
    Math.round(crop.y),
    w,
    h,
    0,
    0,
    w,
    h
  );
  const blob = await canvasToBlob(canvas);
  const base = props.name ? props.name.replace(/\.\w+$/, "") : "image";
  emit("apply", blob, `${base}-crop.png`);
}

onMounted(() => {
  load();
  if (stageEl.value) {
    observer = new ResizeObserver(() => measure());
    observer.observe(stageEl.value);
  }
});

onBeforeUnmount(() => {
  unlisten();
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

/* 下拉框铺满右侧控制列 */
.ratio-select {
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface-3);
  color: var(--c-text);
  font-size: 12px;
  outline: none;
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

.crop-wrap {
  position: relative;
}

.crop-img {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

.crop-mask {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
}

.crop-box {
  position: absolute;
  border: 1px solid #ffffff;
  box-sizing: border-box;
  cursor: move;
}

.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #ffffff;
  transform: translate(-50%, -50%);
}

.crop-handle.is-nw { left: 0; top: 0; cursor: nwse-resize; }
.crop-handle.is-n { left: 50%; top: 0; cursor: ns-resize; }
.crop-handle.is-ne { left: 100%; top: 0; cursor: nesw-resize; }
.crop-handle.is-e { left: 100%; top: 50%; cursor: ew-resize; }
.crop-handle.is-se { left: 100%; top: 100%; cursor: nwse-resize; }
.crop-handle.is-s { left: 50%; top: 100%; cursor: ns-resize; }
.crop-handle.is-sw { left: 0; top: 100%; cursor: nesw-resize; }
.crop-handle.is-w { left: 0; top: 50%; cursor: ew-resize; }

.editor-hint {
  color: var(--c-muted);
  font-size: 12px;
}
</style>
