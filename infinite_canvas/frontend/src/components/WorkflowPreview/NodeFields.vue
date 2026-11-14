<template>
  <!-- 点击遮罩不关闭：只有右上角关闭按钮或完成/保存才会关闭 -->
  <div v-if="visible" class="nf-mask">
    <div class="nf-card">
      <header class="nf-head">
        <div class="nf-head-text">
          <div class="nf-title">
            <span class="nf-dot" />
            {{ title }}
          </div>
          <div class="nf-sub">{{ nodeId ? `${nodeType} · #${nodeId}` : "" }}</div>
        </div>
        <button class="nf-close" type="button" title="关闭" @click="close">×</button>
      </header>

      <div class="nf-list">
        <div v-for="entry in entries" :key="entry.key" class="nf-item">
          <label class="nf-enable">
            <input
              v-model="entry.enabled"
              type="checkbox"
              class="nf-check"
            />
            <span class="nf-key" :title="entry.key">{{ entry.key }}</span>
            <span class="nf-default" :title="entry.defaultText">
              默认值: {{ entry.defaultText }}
            </span>
          </label>

          <div v-if="entry.enabled" class="nf-detail">
            <div class="nf-row">
              <select v-model="entry.type" class="nf-select">
                <option v-for="item in TYPE_OPTIONS" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
              <input
                v-model="entry.label"
                class="nf-input"
                placeholder="显示名"
                spellcheck="false"
              />
            </div>

            <div v-if="entry.type === 'select'" class="nf-options">
              <div v-for="(_, i) in entry.options" :key="i" class="nf-row">
                <input
                  v-model="entry.options[i]"
                  class="nf-input"
                  :placeholder="`选项 ${i + 1}`"
                  spellcheck="false"
                />
                <button
                  class="nf-remove"
                  type="button"
                  title="删除这个选项"
                  @click="removeOption(entry, i)"
                >
                  ×
                </button>
              </div>
              <button class="nf-add" type="button" @click="addOption(entry)">
                + 添加选项
              </button>
            </div>

            <div
              v-if="entry.type === 'slider' || entry.type === 'number' || entry.type === 'random'"
              class="nf-row nf-nums"
            >
              <label class="nf-num">
                最小
                <input v-model="entry.min" class="nf-input" type="number" />
              </label>
              <label class="nf-num">
                最大
                <input v-model="entry.max" class="nf-input" type="number" />
              </label>
              <label class="nf-num">
                步长
                <input v-model="entry.step" class="nf-input" type="number" />
              </label>
            </div>

            <div v-if="isMediaType(entry.type)" class="nf-note">
              运行时自动取节点上的{{ MEDIA_LABELS[entry.type] }}，优先上游、其次自身，这里不用填。
            </div>
          </div>
        </div>

        <div v-if="!entries.length" class="nf-empty">
          这个节点没有可直接修改的参数（连线字段不可暴露）
        </div>
      </div>

      <footer class="nf-foot">
        <span class="nf-count">已启用 {{ enabledCount }} 个字段</span>
        <button class="nf-done" type="button" @click="close">完成</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from "vue";

const props = defineProps({
  visible: { type: Boolean, default: false },
  nodeId: { type: String, default: "" },
  nodeType: { type: String, default: "" },
  node: { type: Object, default: null },
  fields: { type: Array, default: () => [] },
  title: { type: String, default: "" },
});

const emit = defineEmits(["close", "change"]);

const TYPE_OPTIONS = [
  { value: "text", label: "文本" },
  { value: "textarea", label: "多行文本" },
  { value: "number", label: "数字" },
  { value: "slider", label: "滑块" },
  { value: "select", label: "下拉框" },
  { value: "switch", label: "开关" },
  { value: "image", label: "图像（单张）" },
  { value: "image_list", label: "图像列表" },
  { value: "audio", label: "音频" },
  { value: "video", label: "视频" },
  { value: "random", label: "随机数" },
];

const MEDIA_LABELS = {
  image: "第一张图像",
  image_list: "全部图像（按上游在前、自身在后排列）",
  audio: "第一个音频",
  video: "第一个视频",
};

function isMediaType(type) {
  return !!MEDIA_LABELS[type];
}

const entries = ref([]);
const enabledCount = computed(() => entries.value.filter((entry) => entry.enabled).length);
// 上次向上抛出的结果，避免初始化 / 无变化时反复触发
let lastPayload = "";

function preview(value) {
  if (typeof value === "string") return value ? `"${value.slice(0, 60)}"` : '""';
  if (value === true || value === false) return String(value);
  return String(value);
}

// 按值的形状猜一个合理的默认类型
function guessType(value, key) {
  if (typeof value === "boolean") return "switch";
  if (typeof value === "number") return "number";
  const text = String(value || "");
  if (/text|prompt|string|caption/i.test(key) || text.includes("\n") || text.length > 40) {
    return "textarea";
  }
  return "text";
}

function buildEntries() {
  const inputs = (props.node && props.node.inputs) || {};
  const saved = new Map((props.fields || []).map((field) => [field.key, field]));
  const list = [];
  for (const [key, value] of Object.entries(inputs)) {
    // 连线（数组）和嵌套对象都不能通过表单直接修改
    if (Array.isArray(value) || (value !== null && typeof value === "object")) continue;
    const field = saved.get(key);
    let options = [...(field?.options || [])];
    // 还没配选项时，用当前值作为第一个选项，省得面对空下拉框
    if (!options.length && typeof value === "string" && value) options = [value];
    list.push({
      key,
      enabled: !!field,
      type: field?.type || guessType(value, key),
      label: field?.label || "",
      options,
      min: field?.min ?? "",
      max: field?.max ?? "",
      step: field?.step ?? "",
      defaultText: preview(value),
    });
  }
  entries.value = list;
  lastPayload = JSON.stringify(collect());
}

watch(
  () => [props.visible, props.nodeId],
  ([visible]) => {
    if (visible) buildEntries();
  },
  { immediate: true }
);

function toNum(raw) {
  if (raw === "" || raw === null || raw === undefined) return undefined;
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

function collect() {
  return entries.value
    .filter((entry) => entry.enabled)
    .map((entry) => {
      const field = {
        nodeId: props.nodeId,
        key: entry.key,
        type: entry.type,
        label: entry.label.trim() || entry.key,
      };
      if (entry.type === "select") {
        field.options = entry.options
          .map((item) => String(item).trim())
          .filter(Boolean);
      }
      if (entry.type === "number" || entry.type === "slider") {
        const min = toNum(entry.min);
        const max = toNum(entry.max);
        const step = toNum(entry.step);
        if (min !== undefined) field.min = min;
        if (max !== undefined) field.max = max;
        if (step !== undefined) field.step = step;
      }
      return field;
    });
}

function addOption(entry) {
  entry.options.push("");
}

function removeOption(entry, index) {
  entry.options.splice(index, 1);
}

function notify() {
  const payload = collect();
  const text = JSON.stringify(payload);
  if (text === lastPayload) return;
  lastPayload = text;
  emit("change", payload);
}

// 所有控件都通过 v-model 改 entry，改动落地后统一抛给父级
watch(entries, notify, { deep: true });

function close() {
  emit("close");
}
</script>

<style scoped>
.nf-mask {
  position: absolute;
  inset: 0;
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--c-backdrop);
  backdrop-filter: blur(2px);
}

.nf-card {
  display: flex;
  flex-direction: column;
  width: min(520px, 100%);
  max-height: 100%;
  border: 1px solid var(--c-border-strong);
  border-radius: 16px;
  background: var(--c-surface);
  box-shadow: 0 20px 50px var(--c-shadow);
  overflow: hidden;
}

.nf-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--c-line);
}

.nf-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.nf-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  background: var(--accent-yellow);
  transform: rotate(45deg);
}

.nf-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-muted);
}

.nf-close {
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
  font-size: 16px;
  line-height: 1;
}

.nf-close:hover {
  background: var(--c-hover);
  color: var(--c-text);
}

.nf-list {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  overflow-y: auto;
}

.nf-item {
  padding: 9px 10px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: var(--c-surface-2);
}

.nf-enable {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.nf-check {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
  border: 1px solid var(--c-border-strong);
  border-radius: 4px;
  background: var(--c-surface-2);
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

.nf-check:hover {
  border-color: var(--c-border-strong);
}

.nf-check:checked {
  border-color: var(--accent-yellow);
  background: var(--accent-yellow);
}

.nf-key {
  font-size: 12px;
  color: var(--c-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nf-default {
  margin-left: auto;
  flex: 0 1 auto;
  min-width: 0;
  font-size: 11px;
  color: var(--c-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.nf-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--c-line);
}

.nf-row {
  display: flex;
  gap: 6px;
}

.nf-select,
.nf-input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
  background: var(--c-surface-2);
  color: var(--c-text);
  font-size: 12px;
  outline: none;
  min-width: 0;
}

.nf-select:focus,
.nf-input:focus {
  border-color: var(--c-accent);
}

.nf-select {
  flex: 0 0 108px;
}

.nf-input {
  flex: 1 1 auto;
}

.nf-nums {
  gap: 8px;
}

.nf-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nf-note {
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--c-surface-2);
  font-size: 11px;
  line-height: 1.5;
  color: var(--c-muted);
}

.nf-remove {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
  background: var(--c-surface-2);
  color: var(--c-muted);
  font-size: 14px;
  line-height: 1;
}

.nf-remove:hover {
  border-color: var(--c-danger-line);
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.nf-add {
  height: 28px;
  border: 1px dashed color-mix(in srgb, var(--c-accent) 45%, transparent);
  border-radius: 7px;
  background: transparent;
  color: var(--c-accent);
  font-size: 11px;
}

.nf-add:hover {
  background: var(--c-accent-weak);
}

.nf-num {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 11px;
  color: var(--c-muted);
  white-space: nowrap;
}

.nf-num .nf-input {
  width: 100%;
}

.nf-empty {
  padding: 26px 10px;
  border: 1px dashed var(--c-line);
  border-radius: 10px;
  font-size: 12px;
  color: var(--c-muted);
  text-align: center;
}

.nf-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px 12px;
  border-top: 1px solid var(--c-line);
}

.nf-count {
  font-size: 11px;
  color: var(--c-muted);
}

.nf-done {
  height: 30px;
  padding: 0 16px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--accent-yellow);
  color: var(--c-on-accent);
  font-size: 12px;
  font-weight: 600;
}

.nf-done:hover {
  filter: brightness(0.94);
}
</style>
