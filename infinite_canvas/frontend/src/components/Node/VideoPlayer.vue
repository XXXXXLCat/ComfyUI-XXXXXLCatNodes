<template>
  <div class="video-player">
    <!-- 视频本身不接收指针事件：点击画面不会自动播放，拖动画布/节点也不受影响 -->
    <video
      ref="videoEl"
      :src="src"
      class="vp-video"
      playsinline
      preload="metadata"
      @loadedmetadata="syncDuration"
      @timeupdate="syncCurrent"
      @play="playing = true"
      @pause="playing = false"
      @ended="onEnded"
      @volumechange="muted = videoEl ? videoEl.muted : muted"
    />

    <!-- 控制条：播放/暂停 + 时间条 + 音量 -->
    <div class="vp-bar" @mousedown.stop @click.stop @dblclick.stop>
      <button class="vp-btn" type="button" :title="playing ? '暂停' : '播放'" @click="togglePlay">
        <svg v-if="!playing" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M7 4.5v15M17 4.5v15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
        </svg>
      </button>

      <span class="vp-time">{{ formatTime(current) }} / {{ formatTime(duration) }}</span>

      <input
        class="vp-seek"
        type="range"
        min="0"
        :max="duration || 0"
        step="0.01"
        :value="current"
        :style="{ '--progress': progressPercent }"
        @input="onSeek"
      />

      <button class="vp-btn" type="button" :title="muted ? '取消静音' : '静音'" @click="toggleMute">
        <svg v-if="muted" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  src: { type: String, default: "" },
});

const videoEl = ref(null);
const playing = ref(false);
const muted = ref(false);
const current = ref(0);
const duration = ref(0);

const progressPercent = computed(() => {
  if (!duration.value) return "0%";
  return `${Math.min(100, (current.value / duration.value) * 100)}%`;
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function syncDuration() {
  duration.value = videoEl.value ? videoEl.value.duration || 0 : 0;
}

function syncCurrent() {
  current.value = videoEl.value ? videoEl.value.currentTime : 0;
}

function onEnded() {
  playing.value = false;
  current.value = 0;
  if (videoEl.value) videoEl.value.currentTime = 0;
}

async function togglePlay() {
  const el = videoEl.value;
  if (!el) return;
  if (el.paused) {
    try {
      await el.play();
    } catch {
      // 浏览器策略拦截时保持暂停状态即可
    }
  } else {
    el.pause();
  }
}

function toggleMute() {
  const el = videoEl.value;
  if (!el) return;
  el.muted = !el.muted;
  muted.value = el.muted;
}

function onSeek(event) {
  const el = videoEl.value;
  if (!el) return;
  el.currentTime = Number(event.target.value) || 0;
  current.value = el.currentTime;
}

// 切换素材（src 变化）时状态归零
watch(
  () => props.src,
  () => {
    playing.value = false;
    current.value = 0;
    duration.value = 0;
  }
);
</script>

<style scoped>
.video-player {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.vp-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  pointer-events: none;
}

.vp-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 8px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78) 45%);
}

.vp-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #f2f2f2;
  cursor: pointer;
}

.vp-btn:hover {
  color: var(--accent-yellow);
}

.vp-time {
  flex: 0 0 auto;
  font-size: 10px;
  line-height: 1;
  color: #e6e6e6;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.vp-seek {
  flex: 1 1 auto;
  min-width: 0;
  height: 3px;
  margin: 0;
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  appearance: none;
  background: linear-gradient(
    to right,
    var(--accent-yellow) 0,
    var(--accent-yellow) var(--progress, 0%),
    rgba(255, 255, 255, 0.32) var(--progress, 0%),
    rgba(255, 255, 255, 0.32) 100%
  );
}

.vp-seek::-webkit-slider-thumb {
  appearance: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent-yellow);
  border: 0;
}

.vp-seek::-moz-range-thumb {
  width: 9px;
  height: 9px;
  border: 0;
  border-radius: 50%;
  background: var(--accent-yellow);
}
</style>
