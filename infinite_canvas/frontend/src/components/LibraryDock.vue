<template>
  <div class="library-dock">
    <!-- 右上角两个圆角 tab -->
    <div class="library-tabs">
      <button
        class="lib-tab"
        :class="{ 'is-active': panel === 'prompt' }"
        type="button"
        @click="toggle('prompt')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M4 6h16M4 12h10M4 18h13"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        提示词
      </button>
      <button
        class="lib-tab"
        :class="{ 'is-active': panel === 'asset' }"
        type="button"
        @click="toggle('asset')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
          <circle cx="9" cy="10" r="1.6" fill="currentColor" />
          <path d="M4.5 18l5-5 4 4 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
        </svg>
        资产库
      </button>
      <button
        class="lib-tab"
        :class="{ 'is-active': panel === 'log' }"
        type="button"
        @click="toggle('log')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M4 7h3M4 12h3M4 17h3"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d="M11 7h9M11 12h9M11 17h6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        日志
      </button>
    </div>

    <!-- 右侧滑出面板 -->
    <Transition name="dock">
      <section v-if="panel" class="library-panel" @wheel.stop @mousedown.stop>
        <!-- 提示词 -->
        <template v-if="panel === 'prompt'">
          <header class="lib-head">
            <span class="lib-title">提示词</span>
            <span class="lib-count">{{ prompts.length }} 条</span>
          </header>

          <div class="lib-list">
            <article
              v-for="item in prompts"
              :key="item.id"
              class="prompt-item"
              @click="onPromptClick(item)"
              @mousedown="onItemMouseDown"
            >
              <div class="prompt-name-row">
                <input
                  v-if="editingId === item.id"
                  ref="nameInputEl"
                  v-model="nameDraft"
                  class="prompt-name-input"
                  maxlength="60"
                  placeholder="未命名"
                  spellcheck="false"
                  @click.stop
                  @keydown.enter.prevent="$event.target.blur()"
                  @keydown.esc.prevent="cancelRename($event)"
                  @blur="saveName(item)"
                />
                <button
                  v-else
                  class="prompt-name"
                  type="button"
                  :title="item.name || '未命名'"
                  @click.stop="startRename(item)"
                >
                  {{ item.name || "未命名" }}
                </button>
              </div>
              <p class="prompt-text">{{ item.text }}</p>
              <button class="item-del" type="button" title="删除" @click.stop="removePrompt(item)">
                ×
              </button>
            </article>
            <p v-if="!prompts.length" class="lib-empty">还没有收藏的提示词</p>
          </div>

          <!-- 底部收藏框：上方名称、下方内容，收藏按钮压在文本框右下角 -->
          <div class="lib-compose">
            <div class="compose-box">
              <input
                v-model="draftName"
                class="compose-name"
                maxlength="60"
                placeholder="未命名"
                spellcheck="false"
              />
              <div class="compose-text-wrap">
                <textarea
                  v-model="draft"
                  class="compose-text"
                  placeholder="输入要收藏的提示词…"
                  spellcheck="false"
                  @keydown.ctrl.enter.prevent="addPrompt"
                  @keydown.meta.enter.prevent="addPrompt"
                />
                <button
                  class="compose-save"
                  type="button"
                  :disabled="!draft.trim() || saving"
                  @click="addPrompt"
                >
                  {{ saving ? "保存中" : "收藏" }}
                </button>
              </div>
            </div>
          </div>

          <footer class="lib-foot">
            {{ copyTip || footerHint }}
          </footer>
        </template>

        <!-- 资产库 -->
        <template v-else-if="panel === 'asset'">
          <header class="lib-head">
            <span class="lib-title">资产库</span>
            <span class="lib-count" v-if="total">{{ assets.length }} / {{ total }}</span>
            <div class="lib-switch">
              <button
                type="button"
                :class="{ 'is-active': kind === 'input' }"
                @click="setKind('input')"
              >
                input
              </button>
              <button
                type="button"
                :class="{ 'is-active': kind === 'output' }"
                @click="setKind('output')"
              >
                output
              </button>
            </div>
          </header>

          <div class="lib-cats">
            <button
              v-for="cat in CATEGORIES"
              :key="cat.value"
              type="button"
              class="lib-cat"
              :class="{ 'is-active': category === cat.value }"
              @click="setCategory(cat.value)"
            >
              {{ cat.label }}
            </button>
          </div>

          <div
            ref="gridEl"
            class="asset-grid"
            @scroll="onGridScroll"
            @wheel="closePreview"
          >
            <div
              v-for="file in assets"
              :key="assetKey(file)"
              class="asset-cell"
              draggable="true"
              :title="file.filename"
              @dragstart="onAssetDragStart($event, file)"
              @mouseenter="openPreview($event, file)"
              @mouseleave="closePreview"
            >
              <!-- 视频也用后端抽帧的缩略图，不再只显示扩展名 -->
              <img
                v-if="showThumb(file)"
                :src="thumbUrl(file)"
                loading="lazy"
                decoding="async"
                alt=""
                @error="markThumbFailed(file)"
              />
              <span v-else class="asset-ext">{{ extOf(file.filename) }}</span>
              <span v-if="file.category === 'video'" class="asset-badge">▶</span>
              <span v-else-if="file.category === 'audio'" class="asset-badge is-audio">♪</span>
              <span class="asset-name">{{ file.filename }}</span>
            </div>
            <p v-if="loadingMore" class="lib-more">加载中…</p>
            <p v-else-if="assets.length && !hasMore" class="lib-more">
              已加载全部 {{ total }} 个
            </p>
            <p v-if="!assets.length" class="lib-empty">
              {{ loading ? "加载中…" : "这个目录里还没有素材" }}
            </p>
          </div>

          <footer class="lib-foot">拖到画布空白处新建节点，拖到节点上添加素材</footer>
        </template>

        <!-- 任务队列日志 -->
        <template v-else>
          <header class="lib-head">
            <span class="lib-title">任务队列</span>
            <span class="lib-count" v-if="running.length || pending.length">
              {{ running.length }} 运行 · {{ pending.length }} 排队
            </span>
            <span class="lib-count" v-else-if="history.length">{{ history.length }} 条</span>
            <div class="lib-switch">
              <button type="button" :disabled="historyLoading" @click="loadHistory">刷新</button>
            </div>
          </header>

          <div class="lib-list history-list">
            <!-- 队列里还没跑完的任务：正在运行 / 排队中 -->
            <section v-if="running.length || pending.length" class="history-group">
              <h4 class="history-day">进行中</h4>
              <article
                v-for="item in running"
                :key="`run-${item.promptId}`"
                class="history-item"
              >
                <div class="history-thumb is-spinning"><span>↻</span></div>
                <div class="history-body">
                  <p class="history-name">正在执行…</p>
                  <p class="history-meta">运行中 · {{ shortId(item.promptId) }}</p>
                </div>
                <button
                  class="history-stop"
                  type="button"
                  title="停止这个任务"
                  :disabled="!!abortingId"
                  @click="abortTask(item)"
                >
                  ×
                </button>
              </article>
              <article
                v-for="item in pending"
                :key="`wait-${item.promptId}`"
                class="history-item"
              >
                <div class="history-thumb"><span>{{ item.position }}</span></div>
                <div class="history-body">
                  <p class="history-name">排队中</p>
                  <p class="history-meta">第 {{ item.position }} 位 · {{ shortId(item.promptId) }}</p>
                </div>
                <button
                  class="history-stop"
                  type="button"
                  title="从队列移出"
                  :disabled="!!abortingId"
                  @click="abortTask(item)"
                >
                  ×
                </button>
              </article>
            </section>

            <section v-for="group in historyGroups" :key="group.label" class="history-group">
              <h4 class="history-day">{{ group.label }}</h4>
              <article
                v-for="item in group.items"
                :key="item.promptId"
                class="history-item"
                @mouseenter="openHistoryPreview($event, item)"
                @mouseleave="closePreview"
              >
                <div class="history-thumb">
                  <img
                    v-if="historyThumb(item)"
                    :src="historyThumb(item)"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    @error="markHistoryThumbFailed(item)"
                  />
                  <span v-else>{{ historyExt(item) }}</span>
                </div>
                <div class="history-body">
                  <p class="history-name">{{ historyTitle(item) }}</p>
                  <p v-if="item.error" class="history-meta is-error">
                    {{ historyMeta(item) }} · {{ item.error }}
                  </p>
                  <p v-else class="history-meta">{{ historyMeta(item) }}</p>
                </div>
              </article>
            </section>
            <p v-if="!history.length && !running.length && !pending.length" class="lib-empty">
              {{ historyLoading ? "加载中…" : historyError || "还没有跑过的任务" }}
            </p>
          </div>

          <footer class="lib-foot">
            来自 ComfyUI 的队列历史，重启 ComfyUI 后会清空
          </footer>
        </template>

        <!-- 悬停素材/任务时的快速预览气泡 -->
        <Teleport to="body">
          <div
            v-if="previewCard"
            class="preview-bubble"
            :style="{
              left: `${previewCard.x}px`,
              top: `${previewCard.y}px`,
              width: previewCard.ready ? `${previewCard.width}px` : 'auto',
              height: previewCard.ready ? `${previewCard.height}px` : 'auto',
              visibility: previewCard.ready ? 'visible' : 'hidden',
            }"
          >
            <video
              v-if="previewCard.file.category === 'video'"
              :src="assetUrl(previewCard.file)"
              autoplay
              muted
              loop
              playsinline
              @loadedmetadata="fitPreview"
            />
            <img
              v-else-if="previewCard.file.category === 'photo'"
              :src="thumbUrl(previewCard.file, 640)"
              @load="fitPreview"
            />
            <div v-else class="preview-bubble-audio">音频</div>
            <span class="preview-bubble-name">{{ previewCard.file.filename }}</span>
          </div>
        </Teleport>
      </section>
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { FILE_ASSET_DRAG_TYPE, useLibrary } from "../composables/useLibrary.js";

const { panel, targetCount, toggle, insertPrompt } = useLibrary();

const footerHint = computed(() => {
  if (!targetCount.value) return "未选中节点时，点击条目会复制到剪贴板";
  if (targetCount.value === 1) return "点击条目插入到选中的节点（框内全选可整段替换）";
  return `点击条目会同时插入到选中的 ${targetCount.value} 个节点`;
});

// 没有可写入的节点时，点击条目复制到剪贴板，底部短暂提示一下
const copyTip = ref("");
let copyTimer = 0;

async function onPromptClick(item) {
  const result = await insertPrompt(item.text);
  if (result !== "copied" && result !== "failed") return;
  copyTip.value = result === "copied" ? "已复制到剪贴板" : "复制失败，请手动选择文本";
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => {
    copyTip.value = "";
  }, 1600);
}

onBeforeUnmount(() => {
  clearTimeout(copyTimer);
  stopHistoryTimer();
  closeHistorySocket();
});

const prompts = ref([]);
const draftName = ref("");
const draft = ref("");
const saving = ref(false);
// 正在重命名的那条提示词，以及输入框里的临时名称
const editingId = ref("");
const nameDraft = ref("");
const nameInputEl = ref(null);

const kind = ref("input");
// 二级分类：全部 / 图片 / 音频 / 视频
const CATEGORIES = [
  { value: "all", label: "全部" },
  { value: "photo", label: "图片" },
  { value: "video", label: "视频" },
  { value: "audio", label: "音频" },
];
const category = ref("all");
// 资产库一次只拉一页，滚动到底再拉下一页；缩略图由后端按需生成
const PAGE_LIMIT = 60;
const assets = ref([]);
const total = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const exhausted = ref(false);
const gridEl = ref(null);
const hasMore = computed(() => !exhausted.value && assets.value.length < total.value);

// ---------------------------------------------------------------- 任务队列日志
// 后端转发 ComfyUI 的 /history（只读、不落盘），重启 ComfyUI 后自然清空
const history = ref([]);
// 队列里还没跑完的任务（/queue 的 queue_running / queue_pending）
const running = ref([]);
const pending = ref([]);
const historyLoading = ref(false);
const historyError = ref("");
let historyTimer = 0;
let historySocket = null;
let historyRefreshTimer = 0;
// 正在请求时又收到刷新请求，等这次结束后立刻再拉一次，避免错过刚跑完的任务
let historyPending = false;

async function loadHistory() {
  if (historyLoading.value) {
    historyPending = true;
    return;
  }
  historyLoading.value = true;
  try {
    const response = await fetch("/infinite_canvas/api/queue/history?limit=60");
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || "读取队列历史失败");
    history.value = data.items || [];
    running.value = data.running || [];
    pending.value = data.pending || [];
    historyError.value = "";
  } catch (error) {
    historyError.value = error?.message || "读取队列历史失败";
  } finally {
    historyLoading.value = false;
    if (historyPending) {
      historyPending = false;
      loadHistory();
    }
  }
}

// prompt id 是 uuid，列表里只露前 8 位做区分
function shortId(promptId) {
  return String(promptId || "").slice(0, 8);
}

// 停止正在运行的任务 / 把排队中的任务移出队列，后端会区分这两种情况
const abortingId = ref("");

async function abortTask(item) {
  if (abortingId.value) return;
  abortingId.value = item.promptId;
  try {
    const response = await fetch("/infinite_canvas/api/queue/abort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_id: item.promptId }),
    });
    if (response.ok) {
      // 通知画布把对应节点的运行/排队状态复位，两边状态保持一致
      window.dispatchEvent(
        new CustomEvent("infinite-canvas:queue-abort", {
          detail: { promptId: item.promptId },
        })
      );
    }
    await loadHistory();
  } catch {
    // 取消失败就交给下一轮轮询刷新
  } finally {
    abortingId.value = "";
  }
}

function stopHistoryTimer() {
  clearInterval(historyTimer);
  historyTimer = 0;
}

// ComfyUI 的 /ws 会广播执行事件，面板开着时靠它立刻刷新，轮询只做兜底
const HISTORY_EVENTS = new Set([
  "status",
  "execution_start",
  "execution_cached",
  "execution_success",
  "execution_error",
  "execution_interrupted",
]);

function refreshFromEvent() {
  clearTimeout(historyRefreshTimer);
  historyRefreshTimer = setTimeout(loadHistory, 300);
}

function connectHistorySocket() {
  if (historySocket && historySocket.readyState <= WebSocket.OPEN) return;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  // 独立的 clientId：进度类消息只推给提交任务的客户端，这里只要广播事件
  const clientId = `ic_log_${Date.now().toString(36)}`;
  const socket = new WebSocket(`${scheme}://${location.host}/ws?clientId=${clientId}`);
  historySocket = socket;
  socket.onmessage = (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (HISTORY_EVENTS.has(message?.type)) refreshFromEvent();
  };
  socket.onerror = () => {
    // 连不上就退回轮询
    if (historySocket === socket) historySocket = null;
  };
  socket.onclose = () => {
    if (historySocket === socket) historySocket = null;
    // 面板还开着就隔几秒重连，期间靠轮询兜底
    if (panel.value === "log") {
      historyRefreshTimer = setTimeout(() => {
        if (panel.value === "log") connectHistorySocket();
      }, 3000);
    }
  };
}

function closeHistorySocket() {
  clearTimeout(historyRefreshTimer);
  historyRefreshTimer = 0;
  if (!historySocket) return;
  // 主动关闭不触发重连
  historySocket.onclose = null;
  historySocket.close();
  historySocket = null;
}

// 按完成日期分组（今天 / 昨天 / X 月 X 日），后端已按时间倒序
const historyGroups = computed(() => {
  const groups = [];
  for (const item of history.value) {
    const label = dayLabel(item.finishedAt);
    let group = groups[groups.length - 1];
    if (!group || group.label !== label) {
      group = { label, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
});

function dayLabel(stamp) {
  if (!stamp) return "未知时间";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (stamp >= todayStart) return "今天";
  if (stamp >= todayStart - 86400000) return "昨天";
  const date = new Date(stamp);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

function historyTitle(item) {
  return item.files[0]?.filename || (item.status === "error" ? "执行失败" : "无产物");
}

function historyExt(item) {
  const name = item.files[0]?.filename || "";
  const ext = name.split(".").pop();
  return ext && ext !== name ? ext.toUpperCase().slice(0, 4) : "—";
}

// 任务产物转成预览气泡要的素材结构：缩略图接口只认 input / output
function historyPreviewFile(item) {
  const file = item.files?.[0];
  if (!file) return null;
  if (file.type !== "output" && file.type !== "input") return null;
  const name = file.filename || "";
  let category = "other";
  if (/\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(name)) category = "photo";
  else if (/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(name)) category = "video";
  else if (/\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(name)) category = "audio";
  if (category === "other") return null;
  return { ...file, category };
}

function openHistoryPreview(event, item) {
  const file = historyPreviewFile(item);
  if (file) openPreview(event, file);
}

function statusText(item) {
  if (item.status === "interrupted") return "已中断";
  if (item.status === "error") return "失败";
  if (item.status === "success") return "完成";
  return "未知";
}

// 文件名下面那行：状态 · 耗时 · 产物数量
function historyMeta(item) {
  const parts = [statusText(item)];
  if (item.duration != null) parts.push(`${item.duration.toFixed(2)}s`);
  if (item.files.length > 1) parts.push(`${item.files.length} 个产物`);
  return parts.join(" · ");
}

// 缩略图走资产库同一个接口，只支持 input / output；temp 里的预览图给扩展名占位
function historyThumb(item) {
  const file = item.files?.[0];
  if (!file) return "";
  if (file.type !== "output" && file.type !== "input") return "";
  if (!/\.(png|jpe?g|webp|gif|bmp|tiff|mp4|webm|mov|mkv|avi|m4v)$/i.test(file.filename)) {
    return "";
  }
  if (thumbFailed.value[`${file.type}/${file.subfolder}/${file.filename}`]) return "";
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type,
    size: "320",
  });
  return `/infinite_canvas/api/library/thumb?${params.toString()}`;
}

function markHistoryThumbFailed(item) {
  const file = item.files?.[0];
  if (!file) return;
  thumbFailed.value = {
    ...thumbFailed.value,
    [`${file.type}/${file.subfolder}/${file.filename}`]: true,
  };
}

watch(panel, (value) => {
  stopHistoryTimer();
  closeHistorySocket();
  if (value === "prompt") loadPrompts();
  if (value === "asset") loadAssets();
  else closePreview();
  // 日志面板开着时定时刷新，刚跑完的任务会自动出现
  if (value === "log") {
    loadHistory();
    connectHistorySocket();
    // WebSocket 负责"一有事件就立刻刷"，5 秒轮询只做断线/丢事件的兜底
    historyTimer = setInterval(loadHistory, 5000);
  }
});

watch(kind, () => {
  if (panel.value === "asset") loadAssets();
});

watch(category, () => {
  if (panel.value === "asset") loadAssets();
});

async function loadPrompts() {
  try {
    const response = await fetch("/infinite_canvas/api/library/prompts");
    const data = await response.json();
    prompts.value = data.prompts || [];
  } catch {
    prompts.value = [];
  }
}

async function addPrompt() {
  const text = draft.value.trim();
  if (!text || saving.value) return;
  saving.value = true;
  try {
    const response = await fetch("/infinite_canvas/api/library/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draftName.value.trim(), text }),
    });
    const data = await response.json();
    if (data.prompts) prompts.value = data.prompts;
    draft.value = "";
    draftName.value = "";
  } catch {
    // 接口不可用时保留输入内容，等下次重试
  } finally {
    saving.value = false;
  }
}

// 点条目时不让提示词框失焦，否则拿不到光标/选区，"全选后替换整段"就失效了；
// 重命名输入框里要允许鼠标选词，单独放过
function onItemMouseDown(event) {
  if (event.target.closest(".prompt-name-input")) return;
  event.preventDefault();
}

// 点名称进入重命名；名称区域在整卡片里，必须阻止冒泡，否则会触发"插入提示词"
async function startRename(item) {
  editingId.value = item.id;
  nameDraft.value = item.name || "";
  await nextTick();
  const el = Array.isArray(nameInputEl.value) ? nameInputEl.value[0] : nameInputEl.value;
  el?.focus();
  el?.select();
}

function cancelRename(event) {
  editingId.value = "";
  event.target.blur();
}

// 失焦自动保存；名称没变就不发请求
async function saveName(item) {
  if (editingId.value !== item.id) return;
  editingId.value = "";
  const name = nameDraft.value.trim();
  if (name === (item.name || "")) return;
  try {
    const response = await fetch(
      `/infinite_canvas/api/library/prompts/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }
    );
    const data = await response.json();
    if (data.prompts) prompts.value = data.prompts;
  } catch {
    // 改名失败保持原样，下次打开面板会重新拉取
  }
}

async function removePrompt(item) {
  try {
    const response = await fetch(
      `/infinite_canvas/api/library/prompts/${encodeURIComponent(item.id)}`,
      { method: "DELETE" }
    );
    const data = await response.json();
    if (data.prompts) prompts.value = data.prompts;
  } catch {
    // 删除失败就保持原样
  }
}

function fetchAssets(offset, assetKind, assetCategory) {
  const params = new URLSearchParams({
    type: assetKind,
    category: assetCategory,
    offset: String(offset),
    limit: String(PAGE_LIMIT),
  });
  return fetch(`/infinite_canvas/api/library/assets?${params.toString()}`).then(
    (response) => response.json()
  );
}

async function loadAssets() {
  loading.value = true;
  const currentKind = kind.value;
  const currentCategory = category.value;
  try {
    const data = await fetchAssets(0, currentKind, currentCategory);
    // 期间切了 input/output 或分类，这一页结果作废
    if (kind.value !== currentKind || category.value !== currentCategory) return;
    assets.value = data.files || [];
    total.value = Number(data.total) || assets.value.length;
    exhausted.value = false;
  } catch {
    assets.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
    nextTick(() => {
      if (gridEl.value) gridEl.value.scrollTop = 0;
    });
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  const currentKind = kind.value;
  const currentCategory = category.value;
  try {
    const data = await fetchAssets(assets.value.length, currentKind, currentCategory);
    if (kind.value !== currentKind || category.value !== currentCategory) return;
    const next = data.files || [];
    // 服务端按修改时间排序，期间有新文件会让偏移量错位，按 key 去重
    const seen = new Set(assets.value.map(assetKey));
    for (const file of next) {
      const key = assetKey(file);
      if (!seen.has(key)) {
        seen.add(key);
        assets.value.push(file);
      }
    }
    total.value = Number(data.total) || total.value;
    if (!next.length) exhausted.value = true;
  } catch {
    // 拉取失败就停在当前这一页，下次滚动再试
  } finally {
    loadingMore.value = false;
  }
}

function onGridScroll(event) {
  const el = event.currentTarget;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) loadMore();
}

function setKind(next) {
  if (kind.value === next) return;
  kind.value = next;
}

function setCategory(next) {
  if (category.value === next) return;
  category.value = next;
}

function assetKey(file) {
  return `${file.type}/${file.subfolder}/${file.filename}`;
}

// 图片和视频都有缩略图（视频是后端抽帧的封面），音频只有图标
function canThumb(file) {
  return file.category === "photo" || file.category === "video";
}

// 缩略图生成失败（比如服务器没装 PyAV/OpenCV 抽不了视频帧）时退回扩展名占位
const thumbFailed = ref({});

function showThumb(file) {
  return canThumb(file) && !thumbFailed.value[assetKey(file)];
}

function markThumbFailed(file) {
  thumbFailed.value = { ...thumbFailed.value, [assetKey(file)]: true };
}

// 缩略图只用于网格展示；v= 用源文件的 mtime，源图更新后能拿到新缩略图
// size 是后端缩略图最长边档位：网格 320，悬停气泡放大展示用 640
function thumbUrl(file, size = 320) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || kind.value,
    size: String(size),
    v: String(file.updated || 0),
  });
  return `/infinite_canvas/api/library/thumb?${params.toString()}`;
}

// 原图地址：拖到画布、预览视频时用
function assetUrl(file) {
  const params = new URLSearchParams({
    filename: file.filename,
    subfolder: file.subfolder || "",
    type: file.type || kind.value,
  });
  return `/view?${params.toString()}`;
}

function extOf(name) {
  return (name.split(".").pop() || "?").toUpperCase().slice(0, 4);
}

function onAssetDragStart(event, file) {
  closePreview();
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("text/plain", file.filename);
  event.dataTransfer.setData(
    FILE_ASSET_DRAG_TYPE,
    JSON.stringify({ filename: file.filename, subfolder: file.subfolder || "", type: file.type })
  );
}

// 悬停素材时的快速预览气泡：和节点媒体条一样的气泡（Teleport 到 body，避免被面板裁剪）
const previewCard = ref(null);
let previewTimer = null;

function closePreview() {
  clearTimeout(previewTimer);
  previewCard.value = null;
}

function openPreview(event, file) {
  clearTimeout(previewTimer);
  const rect = event.currentTarget.getBoundingClientRect();
  previewTimer = setTimeout(() => {
    previewCard.value = {
      file,
      rect: {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        height: rect.height,
      },
      x: rect.right + 12,
      y: rect.top,
      width: 0,
      height: 0,
      ready: false,
    };
    // 音频没有尺寸可测，直接给个固定小卡片
    if (file.category !== "photo" && file.category !== "video") {
      placePreview(200, 88, true);
    }
  }, 220);
}

// 资源加载完成后按真实宽高比定气泡尺寸（上限 360），气泡高度自适应、由资源填满
function fitPreview(event) {
  const card = previewCard.value;
  const el = event.currentTarget;
  if (!card || !el) return;
  const width = el.naturalWidth || el.videoWidth || 0;
  const height = el.naturalHeight || el.videoHeight || 0;
  if (!width || !height) return;
  const maxWidth = 360;
  const maxHeight = Math.min(520, window.innerHeight - 80);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  placePreview(Math.round(width * scale), Math.round(height * scale), true);
}

// 根据缩略图位置摆放气泡：优先右侧，放不下翻到左侧，再夹在视口内
function placePreview(width, height, ready) {
  const card = previewCard.value;
  if (!card) return;
  const gap = 12;
  let x = card.rect.right + gap;
  if (x + width > window.innerWidth - 8) x = card.rect.left - gap - width;
  x = Math.min(Math.max(8, x), window.innerWidth - width - 8);
  let y = card.rect.top + card.rect.height / 2 - height / 2;
  y = Math.min(Math.max(8, y), window.innerHeight - height - 8);
  previewCard.value = {
    ...card,
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    ready,
  };
}
</script>

<style scoped>
.library-dock {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.library-tabs {
  display: flex;
  gap: 8px;
  pointer-events: auto;
}

.lib-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--c-line-strong);
  border-radius: 999px;
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 12px;
  cursor: pointer;
  transition: color 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.lib-tab:hover {
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.lib-tab.is-active {
  border-color: var(--c-accent);
  background: var(--c-accent-weak);
  color: var(--c-accent-ink);
}

.library-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: min(340px, 34vw);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--c-line-strong);
  border-radius: 14px;
  background: var(--c-surface);
  box-shadow: 0 20px 48px var(--c-shadow);
  pointer-events: auto;
}

.dock-enter-from,
.dock-leave-to {
  opacity: 0;
  transform: translateX(28px);
}

.dock-enter-active,
.dock-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.lib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 8px;
  flex: 0 0 auto;
}

.lib-title {
  color: var(--c-text);
  font-size: 13px;
  font-weight: 600;
}

.lib-count {
  color: var(--c-muted);
  font-size: 11px;
}

.lib-switch {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding: 2px;
  border-radius: 8px;
  background: var(--c-surface-3);
}

.lib-switch button {
  height: 22px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
}

.lib-switch button.is-active {
  background: var(--c-surface);
  color: var(--c-text);
}

.lib-cats {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px;
  flex: 0 0 auto;
}

.lib-cat {
  height: 24px;
  padding: 0 12px;
  border: 1px solid var(--c-line);
  border-radius: 999px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}

.lib-cat:hover {
  color: var(--c-text);
  border-color: var(--c-border-strong);
}

.lib-cat.is-active {
  border-color: color-mix(in srgb, var(--c-accent) 60%, transparent);
  background: var(--c-accent-weak);
  color: var(--c-accent-ink);
}

/* 底部收藏框：一个整框装名称 + 内容 */
.lib-compose {
  flex: 0 0 auto;
  padding: 0 12px 10px;
}

.compose-box {
  border: 1px solid var(--c-line-strong);
  border-radius: 10px;
  background: var(--c-surface-3);
  overflow: hidden;
  transition: border-color 0.16s ease;
}

.compose-box:focus-within {
  border-color: var(--c-accent);
}

.compose-name {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1px solid var(--c-line);
  background: transparent;
  color: var(--c-text);
  font-size: 12px;
  font-weight: 600;
  outline: none;
}

.compose-text-wrap {
  position: relative;
}

.compose-text {
  display: block;
  width: 100%;
  min-height: 74px;
  max-height: 180px;
  /* 给右下角的收藏按钮留出位置，长文本不会压到按钮下面 */
  padding: 8px 10px 34px;
  border: 0;
  background: transparent;
  color: var(--c-text);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.compose-save {
  position: absolute;
  right: 8px;
  bottom: 8px;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--accent-yellow);
  border-radius: 7px;
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 12px;
  cursor: pointer;
}

.compose-save:disabled {
  opacity: 0.45;
  cursor: default;
}

.lib-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prompt-item {
  position: relative;
  padding: 9px 28px 9px 10px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-surface);
  cursor: pointer;
  transition: border-color 0.16s ease, background 0.16s ease;
}

.prompt-item:hover {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
  background: var(--c-surface-3);
}

.prompt-name-row {
  margin-bottom: 4px;
  min-height: 18px;
}

.prompt-name {
  display: block;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-text);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  cursor: text;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.prompt-name:hover {
  color: var(--c-accent-ink);
}

.prompt-name-input {
  width: 100%;
  height: 22px;
  padding: 0 6px;
  border: 1px solid var(--c-accent);
  border-radius: 6px;
  background: var(--c-surface);
  color: var(--c-text);
  font-size: 12px;
  font-weight: 600;
  outline: none;
}

.prompt-text {
  margin: 0;
  display: -webkit-box;
  overflow: hidden;
  color: var(--c-text);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.item-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--c-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.item-del:hover {
  background: color-mix(in srgb, var(--c-text) 8%, transparent);
  color: var(--c-danger);
}

.asset-grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: start;
  gap: 8px;
}

.asset-cell {
  position: relative;
  /* 用 padding-top 撑正方形：grid 自动行高不认 aspect-ratio，行会被压矮导致方块互相压盖 */
  padding-top: 100%;
  overflow: hidden;
  border: 1px solid var(--c-line);
  border-radius: 9px;
  background: var(--c-surface-2);
  cursor: grab;
}

.asset-cell:hover {
  border-color: color-mix(in srgb, var(--c-accent) 55%, transparent);
}

.asset-cell img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.asset-ext {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--c-muted);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.asset-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 5px 4px;
  overflow: hidden;
  color: #f4f4f8;
  font-size: 10px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
}

/* 视频/音频角标：视频有缩略图，再叠一个播放符号 */
.asset-badge {
  position: absolute;
  top: 5px;
  right: 5px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: #f4f4f8;
  font-size: 9px;
  line-height: 1;
}

.asset-badge.is-audio {
  color: var(--accent-yellow, #f2ff59);
}

.lib-empty {
  grid-column: 1 / -1;
  margin: 18px 0;
  color: var(--c-muted-2);
  font-size: 12px;
  text-align: center;
}

.lib-more {
  grid-column: 1 / -1;
  margin: 4px 0 8px;
  color: var(--c-muted-2);
  font-size: 11px;
  text-align: center;
}

.lib-foot {
  flex: 0 0 auto;
  padding: 8px 12px 10px;
  border-top: 1px solid var(--c-line);
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.4;
}

/* 悬停预览气泡（Teleport 到 body） */
.preview-bubble {
  position: fixed;
  z-index: 40;
  overflow: hidden;
  border: 1px solid var(--c-line-strong);
  border-radius: 14px;
  background: var(--c-surface);
  box-shadow: 0 18px 44px var(--c-shadow);
  pointer-events: none;
}

.preview-bubble img,
.preview-bubble video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.preview-bubble-audio {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: var(--c-muted);
  font-size: 13px;
}

.preview-bubble-name {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18px 10px 8px;
  overflow: hidden;
  color: #eaeaef;
  font-size: 11px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
}

/* 任务队列日志 */
.history-list {
  gap: 0;
}

.history-group:first-child .history-day {
  margin-top: 2px;
}

.history-day {
  margin: 10px 0 4px;
  color: var(--c-muted);
  font-size: 11px;
  font-weight: 500;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  padding: 6px;
  border-radius: 9px;
}

.history-item:hover {
  background: var(--c-surface-3);
}

.history-thumb {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--c-surface-2);
  color: var(--c-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

/* 运行中的任务用旋转箭头代替缩略图 */
.history-thumb.is-spinning span {
  animation: history-spin 1.1s linear infinite;
  font-size: 15px;
}

@keyframes history-spin {
  to {
    transform: rotate(360deg);
  }
}

.history-thumb img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

/* 文件名在上、状态/耗时在下，上下贴住整行的 40px 高度 */
.history-body {
  flex: 1 1 auto;
  min-width: 0;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2px;
}

.history-name {
  margin: 0;
  overflow: hidden;
  color: var(--c-text);
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.history-meta {
  margin: 0;
  display: -webkit-box;
  overflow: hidden;
  color: var(--c-muted);
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.history-meta.is-error {
  color: var(--c-danger);
}

/* 停止运行中 / 移除排队中的任务 */
.history-stop {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0 0 1px;
  border: 1px solid var(--c-line);
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.history-stop:hover:not(:disabled) {
  border-color: var(--c-danger);
  color: var(--c-danger);
}

.history-stop:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
