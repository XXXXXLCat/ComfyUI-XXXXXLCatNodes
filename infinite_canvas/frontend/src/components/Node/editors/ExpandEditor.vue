<template>
  <div class="editor">
    <!-- 参数控件挂到右侧控制列 -->
    <Teleport v-if="controlsEl" :to="controlsEl">
      <span class="editor-size">{{ sizeText }}</span>
      <span class="editor-tip">拖动边框调整画布范围，拖动画面移动图像位置</span>
    </Teleport>
    <!-- 应用按钮挂到右侧底部 -->
    <Teleport v-if="applyEl" :to="applyEl">
      <button type="button" class="primary-btn" :disabled="!ready" @click="apply">应用</button>
    </Teleport>

    <div ref="stageEl" class="editor-stage">
      <div v-if="ready" class="expand-wrap" :style="wrapStyle">
        <img
          :src="src"
          :alt="name"
          class="expand-img"
          :style="imageStyle"
          draggable="false"
          @pointerdown.stop="startImageDrag"
        />

        <span
          v-for="handle in handles"
          :key="handle"
          class="expand-handle"
          :class="`is-${handle}`"
          @pointerdown.stop="startResize($event, handle)"
        />
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
// 画布框（图像坐标系）：允许超出图像，白色部分就是扩图区域
const frame = reactive({ x: 0, y: 0, w: 0, h: 0 });
const scale = ref(1);
let dragState = null;
let observer = null;

const MIN_SIZE = 64;
const MAX_SIZE = 4096;
const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const ready = computed(() => natural.w > 0 && frame.w > 0 && scale.value > 0);

const wrapStyle = computed(() => ({
  width: `${frame.w * scale.value}px`,
  height: `${frame.h * scale.value}px`,
}));

const imageStyle = computed(() => ({
  left: `${-frame.x * scale.value}px`,
  top: `${-frame.y * scale.value}px`,
  width: `${natural.w * scale.value}px`,
  height: `${natural.h * scale.value}px`,
}));

const sizeText = computed(() =>
  ready.value ? `${Math.round(frame.w)} × ${Math.round(frame.h)}` : ""
);

function measure() {
  if (!stageEl.value || !frame.w) return;
  const rect = stageEl.value.getBoundingClientRect();
  const availableW = Math.max(160, rect.width - 80);
  const availableH = Math.max(120, rect.height - 60);
  scale.value = Math.min(availableW / frame.w, availableH / frame.h, 1);
}

async function load() {
  natural.w = 0;
  natural.h = 0;
  try {
    const image = await loadImage(props.src);
    sourceImage.value = image;
    natural.w = image.naturalWidth;
    natural.h = image.naturalHeight;
    frame.x = 0;
    frame.y = 0;
    frame.w = natural.w;
    frame.h = natural.h;
    measure();
  } catch (error) {
    console.warn("[Infinite-Canvas] 扩图素材加载失败", error);
  }
}

watch(() => props.src, load);
watch(scale, measure);

function listen() {
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function unlisten() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

function startImageDrag(event) {
  event.preventDefault();
  dragState = { type: "image", sx: event.clientX, sy: event.clientY, start: { ...frame } };
  listen();
}

function startResize(event, handle) {
  event.preventDefault();
  dragState = {
    type: "resize",
    handle,
    sx: event.clientX,
    sy: event.clientY,
    start: { ...frame },
  };
  listen();
}

function onPointerMove(event) {
  if (!dragState) return;
  const dx = (event.clientX - dragState.sx) / scale.value;
  const dy = (event.clientY - dragState.sy) / scale.value;
  const start = dragState.start;

  if (dragState.type === "image") {
    frame.x = clamp(start.x - dx, -frame.w + 40, natural.w - 40);
    frame.y = clamp(start.y - dy, -frame.h + 40, natural.h - 40);
    return;
  }

  const handle = dragState.handle;
  let x = start.x;
  let y = start.y;
  let w = start.w;
  let h = start.h;

  if (handle.includes("w")) {
    const nextX = start.x + dx;
    w = start.w - dx;
    if (w < MIN_SIZE) {
      w = MIN_SIZE;
      x = start.x + start.w - MIN_SIZE;
    } else if (w > MAX_SIZE) {
      w = MAX_SIZE;
      x = start.x + start.w - MAX_SIZE;
    } else {
      x = nextX;
    }
  }
  if (handle.includes("e")) {
    w = start.w + dx;
    if (w < MIN_SIZE) w = MIN_SIZE;
    if (w > MAX_SIZE) w = MAX_SIZE;
  }
  if (handle.includes("n")) {
    const nextY = start.y + dy;
    h = start.h - dy;
    if (h < MIN_SIZE) {
      h = MIN_SIZE;
      y = start.y + start.h - MIN_SIZE;
    } else if (h > MAX_SIZE) {
      h = MAX_SIZE;
      y = start.y + start.h - MAX_SIZE;
    } else {
      y = nextY;
    }
  }
  if (handle.includes("s")) {
    h = start.h + dy;
    if (h < MIN_SIZE) h = MIN_SIZE;
    if (h > MAX_SIZE) h = MAX_SIZE;
  }

  frame.x = x;
  frame.y = y;
  frame.w = w;
  frame.h = h;

  // 画布里至少保留 40px 图像，避免整张图被拖出可视区域
  frame.x = clamp(frame.x, -frame.w + 40, natural.w - 40);
  frame.y = clamp(frame.y, -frame.h + 40, natural.h - 40);
  measure();
}

function onPointerUp() {
  dragState = null;
  unlisten();
}

async function apply() {
  if (!ready.value || !sourceImage.value) return;
  const w = Math.round(frame.w);
  const h = Math.round(frame.h);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d");
  // 扩图区域填充白色
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, w, h);
  context.drawImage(
    sourceImage.value,
    Math.round(-frame.x),
    Math.round(-frame.y),
    natural.w,
    natural.h
  );
  const blob = await canvasToBlob(canvas);
  const base = props.name ? props.name.replace(/\.\w+$/, "") : "image";
  emit("apply", blob, `${base}-expand.png`);
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

.editor-size {
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--c-surface) 85%, transparent);
  color: var(--c-text);
  font-size: 12px;
  text-align: center;
}

.editor-tip {
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.7;
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

.expand-wrap {
  position: relative;
  overflow: hidden;
  background: #ffffff;
  box-shadow: 0 0 0 1px var(--c-editor-outline);
}

.expand-img {
  position: absolute;
  max-width: none;
  cursor: move;
  user-select: none;
}

.expand-handle {
  position: absolute;
  background: var(--c-editor-handle);
}

/* 四边中点的胶囊 */
.expand-handle.is-n,
.expand-handle.is-s {
  left: 50%;
  width: 26px;
  height: 8px;
  border-radius: 4px;
  transform: translate(-50%, -50%);
  cursor: ns-resize;
}
.expand-handle.is-s {
  top: 100%;
}
.expand-handle.is-n {
  top: 0;
}

.expand-handle.is-e,
.expand-handle.is-w {
  top: 50%;
  width: 8px;
  height: 26px;
  border-radius: 4px;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
}
.expand-handle.is-e {
  left: 100%;
}
.expand-handle.is-w {
  left: 0;
}

/* 四角的小圆点 */
.expand-handle.is-nw,
.expand-handle.is-ne,
.expand-handle.is-se,
.expand-handle.is-sw {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
.expand-handle.is-nw { left: 0; top: 0; cursor: nwse-resize; }
.expand-handle.is-ne { left: 100%; top: 0; cursor: nesw-resize; }
.expand-handle.is-se { left: 100%; top: 100%; cursor: nwse-resize; }
.expand-handle.is-sw { left: 0; top: 100%; cursor: nesw-resize; }

.editor-hint {
  color: var(--c-muted);
  font-size: 12px;
}
</style>
