<template>
  <!-- 节点上方扇形操作：两边小、中间大 -->
  <div v-if="fanMounted || panelOpen" class="node-actions" :class="{ 'is-open': fanOpen }">
    <button
      v-for="(action, i) in actions"
      :key="action.key"
      class="fan-btn"
      :class="{ 'is-enabled': !isDisabled(action) }"
      :style="fanStyle(i)"
      type="button"
      :title="action.label"
      :disabled="isDisabled(action)"
      @pointerdown.stop
      @mousedown.stop
      @click.stop="trigger(action)"
    >
      <svg
        viewBox="0 0 24 24"
        :width="Math.round(fanSizes[i] * 0.48)"
        :height="Math.round(fanSizes[i] * 0.48)"
        aria-hidden="true"
      >
        <path
          v-for="(d, k) in action.paths"
          :key="k"
          :d="d"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>
  </div>

  <!-- 操作面板：预览 / 裁切 / 扩图 / 宫格编辑 -->
  <Teleport to="body">
    <div v-if="panelOpen" class="asset-mask" @mousedown.self="closePanel">
      <div class="asset-panel" @mousedown.stop @click.stop @wheel.stop>
        <!-- 关闭按钮放在弹层外框右上角 -->
        <button class="asset-close" type="button" title="关闭" @click="closePanel">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>
        </button>

        <div class="asset-body">
          <aside class="asset-side">
            <div class="side-tools">
              <button
                v-for="action in actions"
                :key="action.key"
                class="tool-btn"
                :class="{ 'is-active': mode === modeOf(action) }"
                type="button"
                :title="action.label"
                :disabled="isDisabled(action)"
                @click="trigger(action)"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    v-for="(d, k) in action.paths"
                    :key="k"
                    :d="d"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{{ action.label }}</span>
              </button>
            </div>

            <!-- 参数控件由当前编辑器 Teleport 进来 -->
            <div ref="controlsEl" class="side-controls">
              <!-- 宫格：分割 / 拼接 -->
              <div v-if="mode === 'grid'" class="side-switch">
                <button
                  type="button"
                  :class="{ 'is-active': gridMode === 'split' }"
                  @click="setGridMode('split')"
                >
                  分割
                </button>
                <button
                  type="button"
                  :class="{ 'is-active': gridMode === 'merge' }"
                  @click="setGridMode('merge')"
                >
                  拼接
                </button>
              </div>

              <span v-if="mode === 'preview'" class="side-hint">
                滚轮缩放 50%–800%，放大后可拖动查看
              </span>

              <!-- 对比：自身与上游第一条素材类型一致时显示 -->
              <button
                v-if="mode === 'preview' && canCompare"
                class="side-compare"
                :class="{ 'is-active': comparing }"
                type="button"
                @click="toggleCompare"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    d="M12 3v18M7 8l-4 4 4 4M17 8l4 4-4 4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <span>{{ comparing ? "退出对比" : "对比" }}</span>
              </button>
            </div>

            <!-- 应用按钮同样由编辑器 Teleport 进来，沉底 -->
            <div
              ref="applyEl"
              class="side-apply"
              :class="{ 'is-hidden': mode === 'preview' }"
            />
          </aside>

          <div class="asset-main">
            <template v-if="showContent">
              <PreviewPane
                v-if="mode === 'preview'"
                :item="current"
                :media="media"
                :index="index"
                :upstream="upstreamFirst"
                :comparing="comparing"
                @select="emit('select', $event)"
              />

              <CropEditor
                v-else-if="mode === 'crop' && isImage"
                :src="current.url"
                :name="current.name"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onReplace"
              />
              <ExpandEditor
                v-else-if="mode === 'expand' && isImage"
                :src="current.url"
                :name="current.name"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onReplace"
              />
              <SplitEditor
                v-else-if="mode === 'grid' && gridMode === 'split' && isImage"
                :src="current.url"
                :name="current.name"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onSplit"
              />
              <MergeEditor
                v-else-if="mode === 'grid' && gridMode === 'merge'"
                :media="media"
                :name="label"
                :controls-el="controlsEl"
                :apply-el="applyEl"
                @apply="onMerge"
              />

              <span v-else class="asset-empty">该素材不支持此操作</span>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, inject, nextTick, ref, watch } from "vue";
import PreviewPane from "./editors/PreviewPane.vue";
import CropEditor from "./editors/CropEditor.vue";
import ExpandEditor from "./editors/ExpandEditor.vue";
import SplitEditor from "./editors/SplitEditor.vue";
import MergeEditor from "./editors/MergeEditor.vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
  nodeId: { type: String, default: "" },
  media: { type: Array, default: () => [] },
  // 上游节点传入该节点的素材（用于对比）
  inputMedia: { type: Array, default: () => [] },
  index: { type: Number, default: 0 },
  label: { type: String, default: "" },
});

const emit = defineEmits(["select"]);

const graph = inject("canvasGraph");

const panelOpen = ref(false);

// 扇形按钮只在悬停/选中时挂载：节点一多就常驻几百个按钮 DOM，没必要。
// 先挂载、下一帧再加 is-open，保住展开动画；收起动画结束后再卸载
const fanMounted = ref(false);
const fanOpen = ref(false);
let fanTimer = 0;
watch(
  () => props.visible,
  (on) => {
    clearTimeout(fanTimer);
    if (on) {
      fanMounted.value = true;
      nextTick(() => {
        fanOpen.value = true;
      });
    } else {
      fanOpen.value = false;
      fanTimer = setTimeout(() => {
        fanMounted.value = false;
      }, 220);
    }
  },
  { immediate: true }
);
// 面板两阶段渲染：先挂右列（Teleport 目标），下一帧再挂编辑器
const showContent = ref(false);
const controlsEl = ref(null);
const applyEl = ref(null);
const mode = ref("preview");
// 宫格图标下再分「分割 / 拼接」两个子模式
const gridMode = ref("split");
const current = computed(() => props.media[props.index] || null);
const isImage = computed(() => !!current.value && current.value.kind === "image");

// 对比：自身与上游都有素材，第一条类型一致（只支持图片/视频），
// 且当前预览的必须是第一个素材
const comparing = ref(false);
const upstreamFirst = computed(() => props.inputMedia[0] || null);
const canCompare = computed(() => {
  const own = props.media[0];
  const up = upstreamFirst.value;
  if (!own || !up) return false;
  if (own.kind !== up.kind) return false;
  if (own.kind !== "image" && own.kind !== "video") return false;
  return props.index === 0;
});

watch(
  () => [canCompare.value, props.index, props.media.length, props.inputMedia.length],
  () => {
    if (!canCompare.value) comparing.value = false;
  }
);

function toggleCompare() {
  if (!canCompare.value) return;
  comparing.value = !comparing.value;
}

const zipRefs = computed(() =>
  props.media
    .filter((item) => item.ref && item.ref.filename)
    .map((item) => ({
      filename: item.ref.filename,
      subfolder: item.ref.subfolder || "",
      type: item.ref.type || "output",
    }))
);

// 扇形位置：x 为相对节点中心，top 为圆心距节点上沿的高度；中间两个最大
const fanSizes = [30, 34, 38, 38, 34, 30];
const FAN = [
  { x: -120, y: 28 },
  { x: -78, y: 40 },
  { x: -30, y: 48 },
  { x: 30, y: 48 },
  { x: 78, y: 40 },
  { x: 120, y: 28 },
];

function fanStyle(i) {
  const size = fanSizes[i];
  return {
    left: `${FAN[i].x}px`,
    top: `${-FAN[i].y}px`,
    width: `${size}px`,
    height: `${size}px`,
    transform: "translate(-50%, -50%)",
  };
}

const actions = [
  {
    key: "crop",
    label: "裁切",
    mode: "crop",
    imageOnly: true,
    paths: ["M8 4v12h12", "M4 8h12v12"],
  },
  {
    key: "expand",
    label: "扩图",
    mode: "expand",
    imageOnly: true,
    paths: ["M4 9V4h5", "M20 15v5h-5", "M15 4h5v5", "M9 20H4v-5"],
  },
  {
    key: "preview",
    label: "预览",
    mode: "preview",
    paths: ["M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  },
  {
    key: "grid",
    label: "宫格",
    mode: "grid",
    imageOnly: true,
    paths: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"],
  },
  {
    key: "download",
    label: "下载",
    paths: ["M12 3v12", "M7 11l5 5 5-5", "M4 20h16"],
  },
  {
    key: "downloadAll",
    label: "全部下载",
    paths: ["M12 2v9", "M8.5 8.5 12 12l3.5-3.5", "M3 14v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"],
  },
];

function modeOf(action) {
  return action.mode || "";
}

// 按钮可用规则：
// - 批量下载：节点自身至少两个文件才可用
// - 裁切 / 扩图 / 宫格：只对图片可用（音频、视频禁用）
// - 下载：当前有素材即可用
function isDisabled(action) {
  if (action.key === "downloadAll") return props.media.length < 2;
  if (action.key === "download") return !current.value;
  return !!action.imageOnly && !isImage.value;
}

function trigger(action) {
  if (isDisabled(action)) return;
  if (action.key === "download") {
    downloadCurrent();
    return;
  }
  if (action.key === "downloadAll") {
    downloadAll();
    return;
  }
  panelOpen.value = true;
  showContent.value = false;
  mode.value = action.mode || "preview";
  // 每次从图标进入宫格都先落在「分割」
  if (action.key === "grid") gridMode.value = "split";
  nextTick(() => {
    showContent.value = true;
  });
}

// 宫格分割 / 拼接切换后重新挂起编辑器
function setGridMode(next) {
  if (gridMode.value === next) return;
  showContent.value = false;
  gridMode.value = next;
  nextTick(() => {
    showContent.value = true;
  });
}

function closePanel() {
  panelOpen.value = false;
  showContent.value = false;
  comparing.value = false;
  mode.value = "preview";
}

// 双击节点素材时由父组件调用：直接打开预览面板
function openPreviewPanel() {
  panelOpen.value = true;
  showContent.value = false;
  comparing.value = false;
  mode.value = "preview";
  nextTick(() => {
    showContent.value = true;
  });
}

defineExpose({ openPreviewPanel });

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 下载当前显示的资产（走 /view 拉二进制，确保文件名可控）
async function downloadCurrent() {
  const item = current.value;
  if (!item) return;
  const filename = item.name || (item.ref && item.ref.filename) || "asset";
  try {
    const response = await fetch(item.url);
    if (!response.ok) throw new Error("下载失败");
    saveBlob(await response.blob(), filename);
  } catch (error) {
    console.warn("[Infinite-Canvas] 下载失败", error);
  }
}

// 全部下载：由后端把节点自身素材打包成 zip
async function downloadAll() {
  if (!zipRefs.value.length) return;
  try {
    const response = await fetch("/infinite_canvas/api/package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refs: zipRefs.value, name: props.label || "assets" }),
    });
    if (!response.ok) throw new Error("打包失败");
    saveBlob(await response.blob(), `${props.label || "assets"}.zip`);
  } catch (error) {
    console.warn("[Infinite-Canvas] 打包失败", error);
  }
}

// 裁切 / 扩图：新图直接覆盖当前素材
async function onReplace(blob, filename) {
  try {
    const item = await graph.uploadAsset(blob, filename);
    if (item) graph.replaceMediaItem(props.nodeId, props.index, item);
    mode.value = "preview";
  } catch (error) {
    console.warn("[Infinite-Canvas] 覆盖素材失败", error);
  }
}

// 宫格分割：所有切片放进旁边新建的节点
async function onSplit(pieces) {
  const items = [];
  for (const piece of pieces) {
    const item = await graph.uploadAsset(piece.blob, piece.name);
    if (item) items.push(item);
  }
  if (items.length) graph.spawnDetachedNode(props.nodeId, items);
  closePanel();
}

// 宫格拼接：合成图放进旁边新建的节点
async function onMerge(blob, filename) {
  try {
    const item = await graph.uploadAsset(blob, filename);
    if (item) graph.spawnDetachedNode(props.nodeId, [item]);
    closePanel();
  } catch (error) {
    console.warn("[Infinite-Canvas] 拼接结果保存失败", error);
  }
}
</script>

<style scoped>
/* 扇形操作层：锚在节点上沿中心，隐藏时不占交互 */
.node-actions {
  position: absolute;
  left: 50%;
  bottom: 100%;
  z-index: 25;
  width: 0;
  height: 0;
  pointer-events: none;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.node-actions.is-open {
  opacity: 1;
  transform: none;
}

.node-actions.is-open .fan-btn {
  pointer-events: auto;
}

.fan-btn {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: var(--c-surface-3);
  box-shadow: 0 6px 16px var(--c-shadow);
  color: var(--c-text);
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}

.fan-btn:hover {
  border-color: var(--c-accent);
  background: var(--c-hover);
  color: var(--c-accent);
}

/* 可用按钮高亮：黄色描边 + 淡黄底；不可用按钮降透明度并禁用指针 */
.fan-btn.is-enabled {
  border-color: color-mix(in srgb, var(--c-accent) 75%, transparent);
  color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 10%, transparent);
}

.fan-btn.is-enabled:hover {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 20%, transparent);
}

.fan-btn:disabled {
  opacity: 0.32;
  cursor: not-allowed;
  box-shadow: none;
}

.fan-btn:disabled:hover {
  border-color: var(--c-border-strong);
  background: var(--c-surface-3);
  color: var(--c-text);
}

/* 弹层 */
.asset-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--c-backdrop);
}

.asset-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(1120px, 93vw);
  height: min(720px, 90vh);
  padding: 12px;
  border: 1px solid var(--c-border-strong);
  border-radius: 18px;
  background: var(--c-surface);
  box-shadow: 0 24px 60px var(--c-shadow);
}

.asset-close {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 50%;
  background: color-mix(in srgb, var(--c-surface) 86%, transparent);
  color: var(--c-text);
  cursor: pointer;
}

.asset-close:hover {
  color: var(--c-accent);
  border-color: var(--c-accent);
}

.asset-body {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 12px;
}

.asset-main {
  position: relative;
  order: 1;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  border-radius: 12px;
  background: var(--c-surface-2);
}

.asset-empty {
  margin: auto;
  color: var(--c-muted);
  font-size: 13px;
}

/* 右侧控制列：图标 → 参数 → 应用（沉底） */
.asset-side {
  order: 2;
  flex: 0 0 128px;
  min-height: 0;
  /* 顶部留出关闭按钮的位置 */
  padding-top: 30px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.side-tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
}

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 4px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface-3);
  color: var(--c-text);
  font-size: 10px;
  line-height: 1.2;
  cursor: pointer;
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}

.tool-btn:hover:not(:disabled) {
  border-color: var(--c-accent);
  background: var(--c-hover);
  color: var(--c-accent);
}

.tool-btn.is-active {
  border-color: var(--c-accent);
  color: var(--c-accent);
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 宫格子模式切换 */
.side-switch {
  flex: 0 0 auto;
  display: flex;
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: var(--c-surface-3);
}

.side-switch button {
  flex: 1;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
}

.side-switch button.is-active {
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-weight: 600;
}

/* 参数控件容器：编辑器 Teleport 进来 */
.side-controls {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 100%;
  margin-top: 6px;
  padding: 10px;
  border-radius: 10px;
  background: var(--c-surface-3);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.side-controls:empty {
  display: none;
}

.side-hint {
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.7;
}

/* 对比开关：放在预览提示下方 */
.side-compare {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 34px;
  margin-top: 10px;
  border: 1px solid color-mix(in srgb, var(--c-accent) 60%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--c-accent) 8%, transparent);
  color: var(--c-accent);
  font-size: 12px;
  cursor: pointer;
}

.side-compare:hover,
.side-compare.is-active {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 20%, transparent);
}

/* 应用按钮容器：编辑器 Teleport 进来，沉底 */
.side-apply {
  flex: 0 0 auto;
  margin-top: auto;
}

.side-apply.is-hidden {
  display: none;
}
</style>
