<template>
  <div
    v-if="kind === 'image'"
    ref="stageEl"
    class="cmp-image"
    :class="{ 'is-overlay': mode === 'overlay' }"
    @pointerdown="startDrag"
  >
    <div class="cmp-layer">
      <img :src="before.url" :alt="before.name" draggable="false" />
    </div>
    <div class="cmp-layer" :style="afterStyle">
      <img :src="after.url" :alt="after.name" draggable="false" />
    </div>
    <span class="cmp-tag is-left">上游</span>
    <span class="cmp-tag is-right">当前</span>
    <div v-if="mode === 'split'" class="cmp-line" :style="{ left: `${pos}%` }">
      <span class="cmp-handle">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path
            d="M10 7l-5 5 5 5M14 7l5 5-5 5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </div>

    <!-- 对比模式切换：分割 / 叠加 -->
    <div class="cmp-modes" @pointerdown.stop @click.stop>
      <button
        class="cmp-mode"
        :class="{ 'is-active': mode === 'split' }"
        type="button"
        @click="mode = 'split'"
      >
        分割
      </button>
      <button
        class="cmp-mode"
        :class="{ 'is-active': mode === 'overlay' }"
        type="button"
        @click="mode = 'overlay'"
      >
        叠加
      </button>
    </div>
    <div v-if="mode === 'overlay'" class="cmp-opacity" @pointerdown.stop @click.stop @wheel.stop>
      <span>当前图</span>
      <input v-model.number="opacity" type="range" min="0" max="100" step="1" />
      <span class="cmp-opacity-num">{{ opacity }}%</span>
    </div>
  </div>

  <div v-else class="cmp-video" :style="{ bottom: `${bottomInset}px` }">
    <div class="cmp-side">
      <video
        ref="videoA"
        :src="before.url"
        muted
        playsinline
        preload="metadata"
        @timeupdate="onTimeA"
        @loadedmetadata="onMeta"
        @play="playing = true"
        @pause="playing = false"
        @ended="onEnded"
      />
      <span class="cmp-tag is-left">上游</span>
    </div>

    <div class="cmp-mid">
      <button class="cmp-play" type="button" :title="playing ? '同步暂停' : '同步播放'" @click="toggle">
        <svg v-if="!playing" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M7 4.5v15M17 4.5v15"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <span class="cmp-time">{{ formatTime(current) }} / {{ formatTime(duration) }}</span>
    </div>

    <div class="cmp-side">
      <video
        ref="videoB"
        :src="after.url"
        playsinline
        preload="metadata"
        @loadedmetadata="onMeta"
        @ended="onEnded"
      />
      <span class="cmp-tag is-right">当前</span>
    </div>

    <!-- 底部进度条：拖动时两路同步 seek -->
    <div class="cmp-progress" @pointerdown.stop @click.stop>
      <input
        type="range"
        min="0"
        :max="duration || 0"
        step="0.01"
        :value="current"
        :disabled="!duration"
        @input="onSeek"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

const props = defineProps({
  kind: { type: String, default: "image" },
  before: { type: Object, required: true },
  after: { type: Object, required: true },
  // 底部缩略条占用的高度，避免进度条被遮住
  bottomInset: { type: Number, default: 0 },
});

// ---------------- 图片：分割 / 叠加对比 ----------------
const stageEl = ref(null);
const pos = ref(50);
const mode = ref("split");
const opacity = ref(60);
let dragging = false;

const afterStyle = computed(() =>
  mode.value === "overlay"
    ? { opacity: `${opacity.value}%` }
    : { clipPath: `inset(0 0 0 ${pos.value}%)` }
);

function startDrag(event) {
  if (props.kind !== "image" || mode.value !== "split" || !stageEl.value) return;
  dragging = true;
  updatePos(event);
  window.addEventListener("pointermove", updatePos);
  window.addEventListener("pointerup", endDrag);
}

function updatePos(event) {
  if (!dragging || !stageEl.value) return;
  const rect = stageEl.value.getBoundingClientRect();
  if (!rect.width) return;
  const next = ((event.clientX - rect.left) / rect.width) * 100;
  pos.value = Math.min(100, Math.max(0, next));
}

function endDrag() {
  dragging = false;
  window.removeEventListener("pointermove", updatePos);
  window.removeEventListener("pointerup", endDrag);
}

onBeforeUnmount(() => {
  endDrag();
  pauseAll();
});

// ---------------- 视频：左右同步播放 ----------------
const videoA = ref(null);
const videoB = ref(null);
const playing = ref(false);
const current = ref(0);
const duration = ref(0);

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function onTimeA() {
  const a = videoA.value;
  const b = videoB.value;
  if (!a) return;
  current.value = a.currentTime;
  if (Number.isFinite(a.duration)) duration.value = Math.max(duration.value, a.duration);
  // 播放中修正两路视频的进度漂移
  if (playing.value && b && Math.abs(b.currentTime - a.currentTime) > 0.3) {
    b.currentTime = a.currentTime;
  }
}

async function toggle() {
  const a = videoA.value;
  const b = videoB.value;
  if (!a || !b) return;
  if (playing.value) {
    pauseAll();
    return;
  }
  if (a.currentTime >= (a.duration || 0)) a.currentTime = 0;
  b.currentTime = a.currentTime;
  a.muted = true;
  b.muted = false;
  try {
    await Promise.all([a.play(), b.play()]);
    playing.value = true;
  } catch {
    playing.value = false;
  }
}

function pauseAll() {
  playing.value = false;
  if (videoA.value) videoA.value.pause();
  if (videoB.value) videoB.value.pause();
}

function onEnded() {
  pauseAll();
  const a = videoA.value;
  if (a && Number.isFinite(a.duration)) {
    duration.value = a.duration;
    current.value = a.duration;
  }
}

// 两路视频取较长的时长作为进度条范围
function onMeta() {
  const times = [videoA.value, videoB.value]
    .filter(Boolean)
    .map((video) => video.duration)
    .filter((time) => Number.isFinite(time));
  if (times.length) duration.value = Math.max(...times);
}

// 拖动进度条：暂停并让两路同步跳转
function seekTo(seconds) {
  if (!duration.value) return;
  const target = Math.min(Math.max(seconds, 0), duration.value);
  pauseAll();
  current.value = target;
  if (videoA.value) videoA.value.currentTime = target;
  if (videoB.value) videoB.value.currentTime = target;
}

function onSeek(event) {
  seekTo(parseFloat(event.target.value));
}

// 空格播放/暂停，左右方向键逐帧（按 30fps 估算）
const FRAME = 1 / 30;

function onKeydown(event) {
  if (props.kind !== "video") return;
  const target = event.target;
  const tag = (target && target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (target && target.isContentEditable)) {
    return;
  }
  if (event.code === "Space") {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    seekTo(current.value + (event.key === "ArrowRight" ? FRAME : -FRAME));
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
</script>

<style scoped>
.cmp-image {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #0c0c10;
  cursor: ew-resize;
  touch-action: none;
}

.cmp-image.is-overlay {
  cursor: default;
}

.cmp-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cmp-layer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.cmp-tag {
  position: absolute;
  top: 10px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #e6e6e6;
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
}

.cmp-tag.is-left {
  left: 10px;
}

.cmp-tag.is-right {
  right: 10px;
}

.cmp-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-yellow);
  transform: translateX(-1px);
  pointer-events: none;
}

.cmp-handle {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--accent-yellow);
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-surface) 82%, transparent);
  color: var(--c-accent);
  transform: translate(-50%, -50%);
}

/* ---------------- 视频对比 ---------------- */
.cmp-video {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  background: #0c0c10;
}

.cmp-side {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}

.cmp-side video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.cmp-mid {
  flex: 0 0 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--c-surface);
}

.cmp-play {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid color-mix(in srgb, var(--c-accent) 75%, transparent);
  border-radius: 50%;
  background: var(--c-accent-weak);
  color: var(--c-accent);
  cursor: pointer;
}

.cmp-play:hover {
  background: color-mix(in srgb, var(--c-accent) 22%, transparent);
}

.cmp-time {
  font-size: 10px;
  color: var(--c-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---------------- 图片对比模式切换 ---------------- */
.cmp-modes {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 20;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--c-surface) 92%, transparent);
  transform: translateX(-50%);
}

.cmp-mode {
  padding: 3px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
}

.cmp-mode:hover {
  color: var(--c-text);
}

.cmp-mode.is-active {
  background: var(--c-accent-weak);
  color: var(--c-accent);
}

.cmp-opacity {
  position: absolute;
  top: 44px;
  left: 50%;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--c-surface) 92%, transparent);
  color: var(--c-text);
  font-size: 11px;
  transform: translateX(-50%);
}

.cmp-opacity input {
  width: 130px;
  margin: 0;
  accent-color: var(--accent-yellow);
}

.cmp-opacity-num {
  min-width: 32px;
  color: var(--c-muted);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* ---------------- 视频对比进度条 ---------------- */
.cmp-progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 8px;
  z-index: 20;
  display: flex;
}

.cmp-progress input {
  width: 100%;
  height: 14px;
  margin: 0;
  accent-color: var(--accent-yellow);
  cursor: pointer;
}

.cmp-progress input:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
