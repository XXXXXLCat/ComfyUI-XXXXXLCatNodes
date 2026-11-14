<template>
  <FloatingWindow v-if="visible" :title="title" width="92vw" height="86vh" @close="close">
    <div class="wf-config">
      <aside class="wf-left">
        <!-- 只有本地开发调试（vite dev）才需要配置后端地址，打包上线后省略 -->
        <section v-if="showAddress" class="wf-block">
          <div class="wf-label">COMFYUI 后端地址</div>
          <div class="wf-addr">
            <input
              v-model="address"
              class="wf-input"
              placeholder="留空 = 当前 ComfyUI（自身）"
              spellcheck="false"
              @keydown.stop
            />
            <button v-if="address" class="wf-addr-clear" title="清空" @click="address = ''">
              ×
            </button>
          </div>
          <button class="wf-primary" type="button" :disabled="savingAddress" @click="saveAddress">
            保存
          </button>
          <div class="wf-hint">格式 host:port（留空即使用当前 ComfyUI）</div>
        </section>

        <section class="wf-block wf-grow">
          <div class="wf-label">工作流列表（拖动可调整顺序）</div>
          <div class="wf-list">
            <button
              v-for="(item, index) in workflows"
              :key="item.name"
              class="wf-item"
              :class="{
                'is-active': item.name === currentName,
                'is-dragging': dragIndex === index,
                'is-drop': dropIndex === index && dragIndex !== index,
              }"
              type="button"
              draggable="true"
              @dragstart="onDragStart($event, index)"
              @dragover.prevent="onDragOver($event, index)"
              @drop.prevent="onDrop($event, index)"
              @dragend="onDragEnd"
              @click="selectWorkflow(item.name)"
            >
              <svg class="wf-item-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle cx="4" cy="3.5" r="1.8" stroke="currentColor" stroke-width="1.3" />
                <circle cx="4" cy="12.5" r="1.8" stroke="currentColor" stroke-width="1.3" />
                <circle cx="12" cy="8" r="1.8" stroke="currentColor" stroke-width="1.3" />
                <path d="M4 5.3v5.4M5.8 3.5h2.4a1.8 1.8 0 0 1 1.8 1.8v1M5.8 12.5h2.4a1.8 1.8 0 0 0 1.8-1.8v-1" stroke="currentColor" stroke-width="1.3" />
              </svg>
              <span class="wf-item-name">{{ item.name }}</span>
              <span class="wf-item-meta">{{ item.nodes }} 个节点</span>
            </button>
            <div v-if="!workflows.length" class="wf-empty-list">还没有工作流，先上传一个</div>
          </div>
          <button class="wf-upload" type="button" @click="pickFile">上传工作流</button>
          <input ref="fileInput" type="file" accept=".json,application/json" multiple hidden @change="onFiles" />
        </section>

        <div v-if="message" class="wf-msg" :class="{ 'is-error': messageError }">{{ message }}</div>
      </aside>

      <section class="wf-right">
        <header class="wf-head">
          <div class="wf-head-info">
            <div class="wf-name">{{ currentName || "未选择工作流" }}</div>
            <div v-if="currentName" class="wf-sub">
              {{ nodeCount }} 个节点 · 已暴露 {{ fields.length }} 个字段
            </div>
          </div>
          <div class="wf-actions">
            <button
              v-if="currentName"
              class="wf-save"
              type="button"
              :disabled="!fieldsDirty"
              @click="saveFields"
            >
              保存配置
            </button>
            <button v-if="currentName" class="wf-danger" type="button" @click="removeWorkflow">
              删除
            </button>
          </div>
        </header>
        <WorkflowPreview :workflow="currentWorkflow" :fields="fields" @inspect="openNodeFields" />

        <NodeFields
          :visible="!!inspecting"
          :node-id="inspecting"
          :node-type="inspectNode?.class_type || ''"
          :node="inspectNode"
          :fields="inspectFields"
          :title="inspectNode?.title || ''"
          @close="inspecting = ''"
          @change="applyNodeFields"
        />
      </section>
    </div>
  </FloatingWindow>
</template>

<script>
export const meta = { key: "workflow", title: "工作流配置", order: 2 };
</script>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import FloatingWindow from "../FloatingWindow/index.vue";
import WorkflowPreview from "../WorkflowPreview/index.vue";
import NodeFields from "../WorkflowPreview/NodeFields.vue";
import { closeDialog, isDialogOpen } from "../../stores/dialogs.js";

const key = "workflow";
const title = "工作流配置";
const visible = computed(() => isDialogOpen(key));

const API = "/infinite_canvas/api";

// 后端地址只在本地开发（vite dev）时可配置，打包上线按当前 ComfyUI 运行
const showAddress = import.meta.env.DEV;

const address = ref("");
const workflows = ref([]);
const currentName = ref("");
const currentWorkflow = ref(null);
const savingAddress = ref(false);
const fileInput = ref(null);

// 拖拽排序状态
const dragIndex = ref(-1);
const dropIndex = ref(-1);

const message = ref("");
const messageError = ref(false);
let messageTimer = 0;

// 当前工作流暴露给画布的字段（保存到 <工作流名>.fields.json）
const fields = ref([]);
const fieldsDirty = ref(false);
const inspecting = ref("");

const nodeCount = computed(() =>
  currentWorkflow.value ? Object.keys(currentWorkflow.value).length : 0
);

const inspectNode = computed(() => {
  const node = currentWorkflow.value?.[inspecting.value];
  if (!node) return null;
  return {
    ...node,
    title: (node._meta && node._meta.title) || node.class_type || `#${inspecting.value}`,
  };
});

const inspectFields = computed(() =>
  fields.value.filter((field) => String(field.nodeId) === inspecting.value)
);

function notify(text, isError = false) {
  message.value = text;
  messageError.value = isError;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message.value = "";
  }, 2500);
}

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error((data && data.error) || `请求失败（${response.status}）`);
  }
  if (data === null) throw new Error("接口无响应，请在 ComfyUI 中打开本页面");
  return data;
}

async function loadSettings() {
  try {
    const data = await request("/settings");
    address.value = data.comfy_address || "";
  } catch (err) {
    notify(err.message, true);
  }
}

async function saveAddress() {
  savingAddress.value = true;
  try {
    const data = await request("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comfy_address: address.value.trim() }),
    });
    address.value = data.comfy_address || "";
    notify("地址已保存");
  } catch (err) {
    notify(err.message, true);
  } finally {
    savingAddress.value = false;
  }
}

async function loadWorkflows() {
  try {
    const data = await request("/workflows");
    workflows.value = data.workflows || [];
    const exists = workflows.value.some((item) => item.name === currentName.value);
    if (!exists) {
      currentName.value = "";
      currentWorkflow.value = null;
      if (workflows.value.length) await selectWorkflow(workflows.value[0].name);
    }
    // 让画布同步最新顺序/第一条工作流
    window.dispatchEvent(new CustomEvent("infinite-canvas:workflows-changed"));
  } catch (err) {
    notify(err.message, true);
  }
}

// ---------------- 拖拽排序 ----------------
function onDragStart(event, index) {
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    // Firefox 需要写入数据才会真正开始拖拽
    event.dataTransfer.setData("text/plain", String(index));
  }
}

function onDragOver(event, index) {
  if (dragIndex.value < 0) return;
  event.dataTransfer.dropEffect = "move";
  dropIndex.value = index;
}

async function onDrop(event, index) {
  const from = dragIndex.value;
  dragIndex.value = -1;
  dropIndex.value = -1;
  if (from < 0 || from === index) return;

  const list = [...workflows.value];
  const [moved] = list.splice(from, 1);
  list.splice(index, 0, moved);
  workflows.value = list;

  try {
    const data = await request("/workflows/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: list.map((item) => item.name) }),
    });
    if (data.workflows) workflows.value = data.workflows;
    notify("顺序已保存");
    // 通知画布：新节点默认工作流跟着变
    window.dispatchEvent(new CustomEvent("infinite-canvas:workflows-changed"));
  } catch (err) {
    notify(err.message, true);
    await loadWorkflows();
  }
}

function onDragEnd() {
  dragIndex.value = -1;
  dropIndex.value = -1;
}

async function selectWorkflow(name) {
  try {
    const data = await request(`/workflows/${encodeURIComponent(name)}`);
    currentName.value = data.name;
    currentWorkflow.value = data.workflow;
    inspecting.value = "";
    await loadFields(name);
  } catch (err) {
    notify(err.message, true);
  }
}

async function loadFields(name) {
  try {
    const data = await request(`/workflows/${encodeURIComponent(name)}/fields`);
    fields.value = data.fields || [];
  } catch (err) {
    fields.value = [];
  }
  fieldsDirty.value = false;
}

// 点击预览里的节点：打开该节点的字段配置
function openNodeFields(nodeId) {
  if (!currentWorkflow.value?.[nodeId]) return;
  inspecting.value = String(nodeId);
}

// 子弹窗每次改动都回传该节点的完整字段表，这里替换掉旧的那一部分
function applyNodeFields(list) {
  const nodeId = inspecting.value;
  const others = fields.value.filter((field) => String(field.nodeId) !== nodeId);
  fields.value = [...others, ...list];
  fieldsDirty.value = true;
}

async function saveFields() {
  if (!currentName.value) return;
  try {
    const data = await request(`/workflows/${encodeURIComponent(currentName.value)}/fields`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: fields.value }),
    });
    fields.value = data.fields || [];
    fieldsDirty.value = false;
    notify("配置已保存");
  } catch (err) {
    notify(err.message, true);
  }
}

function isApiWorkflow(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const values = Object.values(data);
  return values.length > 0 && values.every((item) => item && typeof item === "object" && item.class_type);
}

function pickFile() {
  fileInput.value?.click();
}

async function onFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  for (const file of files) {
    try {
      let workflow;
      try {
        workflow = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} 不是合法 JSON`);
      }
      if (!isApiWorkflow(workflow)) {
        throw new Error(`${file.name} 不是 ComfyUI API 格式工作流`);
      }
      const name = file.name.replace(/\.json$/i, "");
      const saved = await request("/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, workflow }),
      });
      await loadWorkflows();
      await selectWorkflow(saved.name);
      notify(`已保存 ${saved.name}`);
    } catch (err) {
      notify(err.message, true);
    }
  }
}

async function removeWorkflow() {
  if (!currentName.value) return;
  if (!window.confirm(`删除工作流「${currentName.value}」？`)) return;
  try {
    await request(`/workflows/${encodeURIComponent(currentName.value)}`, { method: "DELETE" });
    currentName.value = "";
    currentWorkflow.value = null;
    fields.value = [];
    fieldsDirty.value = false;
    inspecting.value = "";
    await loadWorkflows();
    notify("已删除");
  } catch (err) {
    notify(err.message, true);
  }
}

watch(
  visible,
  (open) => {
    if (!open) return;
    if (showAddress) loadSettings();
    loadWorkflows();
  },
  { immediate: true }
);

onBeforeUnmount(() => clearTimeout(messageTimer));

function close() {
  closeDialog(key);
}
</script>

<style scoped>
.wf-config {
  display: flex;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

/* ---------------- 左栏 ---------------- */
.wf-left {
  flex: 0 0 268px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: auto;
}

.wf-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-input-bg);
}

.wf-grow {
  flex: 1 1 auto;
  min-height: 0;
}

.wf-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--c-muted);
}

.wf-addr {
  position: relative;
}

.wf-input {
  width: 100%;
  height: 34px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-surface-2);
  color: var(--c-text);
  font-size: 12px;
  outline: none;
}

.wf-input::placeholder {
  color: var(--c-muted-2);
}

.wf-input:focus {
  border-color: var(--c-border-strong);
}

.wf-addr-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--c-muted);
  font-size: 12px;
  line-height: 1;
}

.wf-addr-clear:hover {
  background: var(--c-hover);
  color: var(--c-text);
}

.wf-primary {
  height: 34px;
  border: 1px solid var(--c-border-strong);
  border-radius: 8px;
  background: var(--c-surface-3);
  color: var(--c-text);
  font-size: 12px;
}

.wf-primary:hover {
  border-color: var(--c-accent);
}

.wf-primary:disabled {
  opacity: 0.6;
}

.wf-hint {
  font-size: 11px;
  color: var(--c-muted);
  line-height: 1.5;
}

.wf-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow: auto;
}

.wf-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--c-text);
  text-align: left;
}

.wf-item:hover {
  background: var(--c-hover);
}

.wf-item.is-active {
  border-color: var(--c-border-strong);
  background: var(--c-surface-3);
}

.wf-item.is-dragging {
  opacity: 0.45;
}

.wf-item.is-drop {
  border-color: color-mix(in srgb, var(--c-accent) 60%, transparent);
  background: var(--c-accent-weak);
}

.wf-item-icon {
  flex: 0 0 auto;
  color: var(--c-muted);
}

.wf-item-name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-item-meta {
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--c-muted);
}

.wf-empty-list {
  padding: 14px 10px;
  border: 1px dashed var(--c-line);
  border-radius: 8px;
  font-size: 11px;
  color: var(--c-muted);
  text-align: center;
}

.wf-upload {
  height: 34px;
  border: 1px dashed var(--c-border-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--c-muted);
  font-size: 12px;
}

.wf-upload:hover {
  border-color: var(--c-accent);
  color: var(--c-text);
}

.wf-msg {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--c-surface-3);
  font-size: 11px;
  color: var(--c-muted);
}

.wf-msg.is-error {
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

/* ---------------- 右栏 ---------------- */
.wf-right {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.wf-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--c-line);
  border-radius: 12px;
  background: var(--c-input-bg);
}

.wf-head-info {
  min-width: 0;
}

.wf-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-sub {
  margin-top: 2px;
  font-size: 11px;
  color: var(--c-muted);
}

.wf-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
}

.wf-danger {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--c-border-strong);
  border-radius: 7px;
  background: transparent;
  color: var(--c-muted);
  font-size: 11px;
}

.wf-danger:hover {
  border-color: var(--c-danger-line);
  background: var(--c-danger-soft);
  color: var(--c-danger);
}

.wf-save {
  height: 28px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--c-accent) 50%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--c-accent) 14%, transparent);
  color: var(--c-accent);
  font-size: 11px;
}

.wf-save:hover:not(:disabled) {
  background: color-mix(in srgb, var(--c-accent) 22%, transparent);
}

.wf-save:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
