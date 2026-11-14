<template>
  <FloatingWindow v-if="visible" :title="title" width="92vw" height="86vh" @close="close">
    <div class="cm">
      <header class="cm-bar">
        <button class="cm-btn" type="button" @click="createCanvas">新建画布</button>
        <span class="cm-state" :class="{ 'is-dirty': dirty }">
          {{ saving ? "保存中…" : dirty ? "有未保存的改动" : "已保存" }}
        </span>
        <div class="cm-bar-right">
          <button
            class="cm-btn"
            type="button"
            :disabled="!currentId || saving"
            @click="saveNow()"
          >
            保存当前
          </button>
          <button
            class="cm-btn is-danger"
            type="button"
            :disabled="!selected.length"
            @click="removeSelected"
          >
            删除所选{{ selected.length ? `（${selected.length}）` : "" }}
          </button>
        </div>
      </header>

      <div class="cm-list">
        <div
          v-for="item in list"
          :key="item.id"
          class="cm-card"
          :class="{
            'is-current': item.id === currentId,
            'is-selected': selected.includes(item.id),
          }"
          @click="onCardClick(item)"
        >
          <div class="cm-card-top">
            <span class="cm-brand">Infinite_canvas</span>
            <span v-if="item.id === currentId" class="cm-current">当前</span>
            <div class="cm-card-actions">
              <button class="cm-icon" type="button" title="编辑名称" @click.stop="startRename(item)">
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10.6 2.8l2.6 2.6M2.5 13.5l.7-3 7.4-7.4 2.6 2.6-7.4 7.4-3.3.4z"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button class="cm-icon is-danger" type="button" title="删除" @click.stop="removeOne(item)">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 7h16M9 7V5h6v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div class="cm-card-name">
            <input
              v-if="editingId === item.id"
              ref="editInput"
              v-model="editingName"
              class="cm-rename"
              spellcheck="false"
              @keydown.enter.prevent="commitRename(item)"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename(item)"
              @click.stop
              @keydown.stop
            />
            <span v-else class="cm-card-title" :title="item.name">{{ item.name }}</span>
          </div>

          <div class="cm-card-meta">
            <span class="cm-card-meta-text">
              {{ item.nodes }} 个节点 · {{ formatTime(item.updated) }}
            </span>
            <input
              v-model="selected"
              class="cm-check"
              type="checkbox"
              :value="item.id"
              title="选择此画布（批量删除用）"
              @click.stop
            />
          </div>
        </div>

        <div v-if="!list.length" class="cm-empty">还没有画布，点左上角新建一个</div>
      </div>

      <div v-if="message" class="cm-msg">{{ message }}</div>
    </div>
  </FloatingWindow>
</template>

<script>
export const meta = { key: "canvas", title: "画布管理", order: 1 };
</script>

<script setup>
import { computed, inject, nextTick, ref, watch } from "vue";
import FloatingWindow from "../FloatingWindow/index.vue";
import { closeDialog, isDialogOpen } from "../../stores/dialogs.js";

const key = "canvas";
const title = "画布管理";
const visible = computed(() => isDialogOpen(key));

// 解构后这些 ref 在模板里会自动解包
const {
  list,
  currentId,
  saving,
  dirty,
  message,
  refresh,
  create,
  open,
  rename,
  remove,
  saveNow,
} = inject("canvasStore");

const selected = ref([]);
const editingId = ref("");
const editingName = ref("");
const editInput = ref(null);

// 打开弹窗时刷新列表（其他页面可能刚改过）
watch(
  visible,
  (on) => {
    if (on) {
      selected.value = [];
      refresh().catch(() => {});
    }
  },
  { immediate: true }
);

function close() {
  closeDialog(key);
}

function formatTime(value) {
  if (!value) return "-";
  const date = new Date(value * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function createCanvas() {
  try {
    await create();
    selected.value = [];
  } catch (error) {
    message.value = error.message || "新建失败";
  }
}

async function openCanvas(id) {
  try {
    await open(id);
    close();
  } catch (error) {
    message.value = error.message || "打开失败";
  }
}

function onCardClick(item) {
  // 当前画布不用再打开
  if (item.id === currentId.value) return;
  openCanvas(item.id);
}

function startRename(item) {
  editingId.value = item.id;
  editingName.value = item.name;
  nextTick(() => {
    const input = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value;
    if (input) {
      input.focus();
      input.select();
    }
  });
}

function cancelRename() {
  editingId.value = "";
  editingName.value = "";
}

async function commitRename(item) {
  if (editingId.value !== item.id) return;
  const name = editingName.value.trim();
  cancelRename();
  if (!name || name === item.name) return;
  try {
    await rename(item.id, name);
  } catch (error) {
    message.value = error.message || "重命名失败";
  }
}

async function removeOne(item) {
  const ok = window.confirm(`删除画布「${item.name}」？此操作不可撤销。`);
  if (!ok) return;
  try {
    const removed = await remove([item.id]);
    selected.value = selected.value.filter((id) => !removed.includes(id));
  } catch (error) {
    message.value = error.message || "删除失败";
  }
}

async function removeSelected() {
  if (!selected.value.length) return;
  const ok = window.confirm(`删除选中的 ${selected.value.length} 个画布？此操作不可撤销。`);
  if (!ok) return;
  try {
    await remove(selected.value);
    selected.value = [];
  } catch (error) {
    message.value = error.message || "删除失败";
  }
}
</script>

<style scoped>
.cm {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  color: var(--c-text);
}

.cm-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.cm-bar-right {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.cm-btn {
  padding: 7px 12px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-surface-3);
  color: var(--c-text);
  font-size: 12px;
}

.cm-btn:hover:not(:disabled) {
  border-color: var(--c-border-strong);
  background: var(--c-hover);
}

.cm-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.cm-btn.is-danger:not(:disabled) {
  border-color: var(--c-danger-line);
  color: var(--c-danger);
}

.cm-btn.is-danger:hover:not(:disabled) {
  background: var(--c-danger-soft);
}

.cm-state {
  font-size: 12px;
  color: var(--c-muted);
}

.cm-state.is-dirty {
  color: #e0b36a;
}

.cm-list {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(214px, 1fr));
  align-content: start;
  gap: 14px;
  padding: 2px;
  overflow-y: auto;
}

/* ---------------- 画布卡片 ---------------- */
.cm-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 168px;
  padding: 12px 12px 10px;
  border: 1px solid var(--c-line);
  border-radius: 16px;
  background: var(--c-surface);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.cm-card:hover {
  border-color: var(--c-border-strong);
  background: var(--c-hover);
}

.cm-card.is-current {
  border-color: color-mix(in srgb, var(--c-accent) 50%, transparent);
  background: color-mix(in srgb, var(--c-accent) 6%, var(--c-surface));
  cursor: default;
}

.cm-card.is-selected {
  border-color: var(--c-accent);
  background: color-mix(in srgb, var(--c-accent) 10%, var(--c-surface));
}

.cm-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cm-brand {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border: 1px solid color-mix(in srgb, var(--c-accent) 45%, transparent);
  border-radius: 999px;
  background: var(--c-accent-weak);
  color: var(--c-accent);
  font-size: 11px;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.cm-current {
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--c-accent-weak);
  color: var(--c-accent);
  font-size: 10px;
  white-space: nowrap;
}

.cm-card-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}

.cm-card-name {
  flex: 1 1 auto;
  display: flex;
  align-items: flex-start;
  min-height: 0;
}

.cm-card-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--c-text);
}

.cm-rename {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--c-accent);
  border-radius: 8px;
  background: var(--c-surface-2);
  color: var(--c-text);
  font-size: 14px;
  outline: none;
}

.cm-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--c-line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--c-text) 2%, transparent);
}

.cm-card-meta-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
  color: var(--c-muted);
}

.cm-check {
  position: relative;
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

.cm-check:hover {
  border-color: var(--c-border-strong);
}

.cm-check:checked {
  border-color: var(--accent-yellow);
  background: var(--accent-yellow);
}

.cm-check:checked::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 0;
  width: 5px;
  height: 8px;
  border: solid var(--c-on-accent);
  border-width: 0 2px 2px 0;
  transform: rotate(42deg);
}

.cm-icon {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
}

.cm-icon:hover {
  background: var(--c-hover);
  color: var(--c-text);
}

.cm-icon.is-danger:hover {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.cm-empty {
  grid-column: 1 / -1;
  padding: 40px 0;
  text-align: center;
  font-size: 12px;
  color: var(--c-muted);
}

.cm-msg {
  flex: 0 0 auto;
  font-size: 12px;
  color: var(--c-danger);
}

/* 亮色下原本的琥珀色对比太弱，换深一档 */
html[data-theme="light"] .cm-state.is-dirty {
  color: #a8701f;
}
</style>
