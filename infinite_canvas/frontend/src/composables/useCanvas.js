import { computed, nextTick, ref, toRaw, watch } from "vue";

const API = "/infinite_canvas/api/canvases";
const LAST_KEY = "infinite-canvas:last";
const AUTOSAVE_DELAY = 800;

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && data.error) || `请求失败（${response.status}）`);
  }
  return data;
}

function readLast() {
  try {
    return localStorage.getItem(LAST_KEY) || "";
  } catch {
    return "";
  }
}

function rememberLast(id) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function useCanvas({
  nodes,
  edges,
  viewport,
  layoutRevision,
  exportCanvas,
  loadCanvas,
  resetCanvas,
  setRunScope,
  restoreRunStates,
}) {
  const list = ref([]);
  const currentId = ref("");
  const currentName = ref("");
  const saving = ref(false);
  const dirty = ref(false);
  const message = ref("");
  const ready = ref(false);

  // 加载画布时整体替换 nodes/edges，不能让自动保存把这一轮当成用户编辑
  let applying = false;
  let saveTimer = null;

  async function refresh() {
    const data = await request(API);
    list.value = data.canvases || [];
    return list.value;
  }

  async function applyCanvas(canvas) {
    applying = true;
    // 运行态映射按画布隔离，必须在载入节点之前切换，恢复时才知道该用哪一份
    setRunScope(canvas.id);
    loadCanvas(canvas);
    currentId.value = canvas.id;
    currentName.value = canvas.name || "";
    rememberLast(canvas.id);
    dirty.value = false;
    message.value = "";
    // 等 watch 冲刷完再解除保护（loadCanvas 的赋值是同步的，watch 是微任务）
    await nextTick();
    applying = false;
    // 节点已经就位，把刷新前还在跑的任务重新挂回去（内部会先跟 ComfyUI 核对）
    restoreRunStates();
  }

  async function create(name) {
    const fallback = `画布 ${list.value.length + 1}`;
    const canvas = await request(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || fallback }),
    });
    applying = true;
    resetCanvas();
    // 新画布节点 id 从 1 开始，切到新作用域，避免旧画布的任务映射套上来
    setRunScope(canvas.id);
    currentId.value = canvas.id;
    currentName.value = canvas.name || fallback;
    rememberLast(canvas.id);
    dirty.value = false;
    await refresh();
    await nextTick();
    applying = false;
    return canvas;
  }

  async function open(id) {
    if (!id) return null;
    const canvas = await request(`${API}/${encodeURIComponent(id)}`);
    await applyCanvas(canvas);
    return canvas;
  }

  async function rename(id, name) {
    const next = (name || "").trim();
    if (!id || !next) return null;
    const saved = await request(`${API}/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canvas: { name: next } }),
    });
    if (id === currentId.value) currentName.value = saved.name || next;
    await refresh();
    return saved;
  }

  async function saveNow() {
    if (!currentId.value) return;
    clearTimeout(saveTimer);
    saving.value = true;
    try {
      const canvas = exportCanvas();
      const body = JSON.stringify({ canvas });
      await request(`${API}/${encodeURIComponent(currentId.value)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body,
      });
      dirty.value = false;
      message.value = "";
    } catch (error) {
      message.value = error.message || "保存失败";
    } finally {
      saving.value = false;
    }
  }

  function scheduleSave() {
    if (applying || !currentId.value) return;
    dirty.value = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, AUTOSAVE_DELAY);
  }

  async function remove(ids) {
    const targets = (ids || []).filter(Boolean);
    if (!targets.length) return [];
    const data = await request(`${API}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: targets }),
    });
    const removed = data.removed || [];
    if (removed.includes(currentId.value)) {
      applying = true;
      resetCanvas();
      currentId.value = "";
      currentName.value = "";
      rememberLast("");
      dirty.value = false;
      await nextTick();
      applying = false;
    }
    await refresh();
    return removed;
  }

  // 打开页面时恢复上次编辑的画布；一个都没有就新建一张
  async function bootstrap() {
    try {
      await refresh();
      const last = readLast();
      if (last && list.value.some((item) => item.id === last)) {
        await open(last);
      } else if (list.value.length) {
        await open(list.value[0].id);
      } else {
        await create("画布 1");
      }
    } catch (error) {
      message.value = error.message || "画布加载失败";
    } finally {
      ready.value = true;
    }
  }

  // 自动保存的触发条件：节点位置/尺寸/参数/素材、连线、视口。
  // 不能用 deep watch：初次挂载 200+ 节点时 Vue Flow 会连续改节点对象，
  // deep watcher 会在同一次 flush 里被反复触发（Vue 报 Maximum recursive updates），
  // 拖拽时也会每帧深度遍历整张图
  // 素材指纹：id + 文件名，就地替换（裁剪/扩图回写）也能感知到
  const mediaFingerprint = (list) =>
    (list || []).map((item) => `${item.id}/${item.ref?.filename || ""}`).join(",");

  // 注意：这里列出的字段要和 exportCanvas 保存的内容保持一致，
  // 以后往 node.data 里加需要持久化的字段时别忘了加进来，否则改动不会触发自动保存
  const saveSignature = computed(() => {
    return JSON.stringify([
      // 坐标不逐个比较：1000 个节点时拖拽每帧都要序列化一次。
      // 拖动结束 / 撤销重做会自增 layoutRevision，用它通知保存
      layoutRevision?.value || 0,
      nodes.value.map((node) => {
        // 通过代理只读出这些引用（建立依赖），真正序列化时用 toRaw：
        // params / randomFields 都是整体替换写入，读一次引用就能感知变化，
        // 不必让 JSON.stringify 逐层走代理（1000 个节点时这是主要耗时）
        const data = node.data;
        return [
          node.id,
          data?.label,
          data?.w,
          data?.h,
          data?.index,
          data?.workflow,
          toRaw(data?.params),
          toRaw(data?.randomFields),
          mediaFingerprint(data?.media),
          mediaFingerprint(data?.inputMedia),
        ];
      }),
      edges.value.map((edge) => [edge.id, edge.source, edge.target]),
      viewport.value.x,
      viewport.value.y,
      viewport.value.zoom,
    ]);
  });
  watch(saveSignature, scheduleSave, { flush: "post" });

  return {
    list,
    currentId,
    currentName,
    saving,
    dirty,
    message,
    ready,
    refresh,
    create,
    open,
    rename,
    remove,
    saveNow,
    bootstrap,
  };
}
