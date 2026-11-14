import { computed, nextTick, onScopeDispose, reactive, ref, toRaw, watch } from "vue";
import { useVueFlow } from "@vue-flow/core";

// 默认节点按 16:9 出图：宽度 454、高度 226，使素材卡片区域（内容区 × 84%）正好 16:9，
// 这样跑出 16:9 的图时节点尺寸不会再跳动
const NODE_WIDTH = 454;
const NODE_HEIGHT = 226;
// 纵向排布间距：给节点悬停操作条留出空间，上下游节点、粘贴副本都用这个间距
const NODE_GAP_Y = 72;
// 内容区相对节点外框的内缩：左右/上下各 10px 内边距 + 1px 边框
const NODE_PADDING = 22;
const MAX_NODE_H = 900;
// 自适应尺寸的容忍比例：分辨率按 8/16/32 对齐会让比例有 1% 左右的偏差，
// 差在 2% 以内视为同一比例，不调整节点尺寸；16:10、4:3 这类真实差异仍会生效
const FIT_TOLERANCE_RATIO = 0.02;
const FIT_TOLERANCE_MIN = 3;
// 节点里当前素材卡片只占内容区宽度的 84%（两侧留出堆叠卡片的错位空间），
// 自适应尺寸要按卡片实际显示区域算，否则图片会被居中裁切
const CARD_WIDTH_RATIO = 0.84;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.7 };

// ComfyUI 的 /view 地址：素材存在 input 目录，产物存在 output 目录，前端只存引用
function mediaUrl(ref) {
  const params = new URLSearchParams({
    filename: ref.filename || "",
    subfolder: ref.subfolder || "",
    type: ref.type || "input",
  });
  return `/view?${params.toString()}`;
}

function guessKind(filename) {
  if (/\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(filename || "")) return "image";
  if (/\.(mp4|webm|mov|mkv|avi)$/i.test(filename || "")) return "video";
  if (/\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(filename || "")) return "audio";
  return "image";
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ------------------------------------------------------------ 完成通知
// 任务跑完时：页面在后台就闪标题，同时播放两声提示音（WebAudio 合成，不依赖音频文件）
// 本页面通常被嵌在 ComfyUI 的 iframe 里，标题要改父页面的，标签栏才会跟着闪
function hostDocument() {
  try {
    return window.top.document;
  } catch {
    return document;
  }
}
const hostDoc = hostDocument();
let baseTitle = hostDoc.title || "Infinite Canvas";
let titleTimer = 0;
let audioCtx = null;

function audioContext() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function unlockAudio() {
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
}

function playDoneSound() {
  const ctx = audioContext();
  if (!ctx) return;
  const play = () => {
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.18 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.32);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(play).catch(() => {});
  else play();
}

function stopTitleFlash() {
  if (!titleTimer) return;
  clearInterval(titleTimer);
  titleTimer = 0;
  hostDoc.title = baseTitle;
}

// 只在标签页不可见时闪（用户正看着画布就不打扰）
function flashTitle() {
  if (!hostDoc.hidden) return;
  clearInterval(titleTimer);
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    hostDoc.title = on ? "● 完成" : baseTitle;
  }, 900);
}

function notifyDone() {
  playDoneSound();
  flashTitle();
}

// 第一次交互时解锁音频，避免完成提示音被浏览器自动播放策略拦截
window.addEventListener("pointerdown", unlockAudio, { once: true, capture: true });
hostDoc.addEventListener("visibilitychange", () => {
  if (!hostDoc.hidden) stopTitleFlash();
});

// 工作流列表顺序由「工作流配置」维护，新节点默认用列表里的第一个
let workflowNames = [];
let workflowsLoaded = false;

async function loadWorkflowNames(force = false) {
  if (workflowsLoaded && !force) return workflowNames;
  try {
    const response = await fetch("/infinite_canvas/api/workflows");
    const data = await response.json();
    workflowNames = (data.workflows || []).map((item) => item.name);
  } catch {
    workflowNames = [];
  }
  workflowsLoaded = true;
  return workflowNames;
}

function defaultWorkflow() {
  return workflowNames[0] || "";
}

// 配置页调整顺序后，下一次建节点直接用新顺序
if (typeof window !== "undefined") {
  window.addEventListener("infinite-canvas:workflows-changed", () => {
    loadWorkflowNames(true);
  });
}
loadWorkflowNames();

// 缩略图地址：后端按 ref 生成并缓存 WebP，只用于节点/面板展示；执行、下载、预览仍用原图
// size 是缩略图最长边档位（320 / 640 / 960），节点卡片会放大，所以默认用 640
// version 是缓存标识：同名文件被重新生成时 filename 不变，靠它让浏览器换掉旧缩略图
function mediaThumbUrl(ref, size = 640, version = "") {
  const params = new URLSearchParams({
    filename: ref.filename || "",
    subfolder: ref.subfolder || "",
    type: ref.type || "input",
    size: String(size),
  });
  if (version) params.set("v", String(version));
  return `/infinite_canvas/api/library/thumb?${params.toString()}`;
}

// 序列化时去掉运行时字段（url / thumbUrl 由 ref 推导，file 是上传中的本地文件，
// pending / error 只代表这一次上传的状态）
function stripMediaItem(item) {
  const { url, thumbUrl, blob, file, pending, error, ...rest } = item;
  return rest;
}

// 反序列化时根据 ref 还原 /view 地址与原图缩略图地址（JSON 里只存引用，不存完整 URL）
function hydrateMediaItem(item) {
  if (!item) return item;
  if (!item.ref || !item.ref.filename) return item;
  return { ...item, url: mediaUrl(item.ref), thumbUrl: mediaThumbUrl(item.ref, 640, item.id) };
}

// 素材指纹：除了 id 还带上文件名。
// 裁剪/扩图回写时是就地替换，id 保持不变但内容已经变了
function mediaKeyOf(node) {
  return (node.data?.media || [])
    .map((item) => `${item.id}/${item.ref?.filename || ""}`)
    .join(",");
}

export function useGraph() {
  const flow = useVueFlow("demo");

  const nodes = ref([]);
  const edges = ref([]);
  // 画布的平移/缩放，与节点坐标一起保存，刷新后回到上次看到的位置
  const viewport = ref({ ...DEFAULT_VIEWPORT });
  // 坐标变更版本号：只在拖动结束/撤销重做时自增，供自动保存判断是否需要落盘
  const layoutRevision = ref(0);
  // Shift 拖拽框选出来的节点只高亮，不展开参数面板（否则一次框选会刷出一排面板）
  const boxSelectedIds = reactive(new Set());

  let nodeSeq = 0;
  let edgeSeq = 0;
  // 上传中的原始文件（不进 Vue 响应式数据，避免 File 被代理后 FileReader 报错）
  const pendingFiles = new Map();
  // 正在进行的上传 id 集合 + 空闲时的回调，运行工作流前用它等待素材就绪
  const uploadInFlight = new Set();
  let uploadWaiters = [];
  let connectStart = null;
  // 拉线预览的吸附点：整块节点都是连接热区，预览线要吸到节点的默认端口
  // （从输出口拉线吸目标的左侧入口，从输入口拉线吸目标的右侧出口）
  const connectSnap = ref(null);
  // 加载画布时整体替换 nodes/edges，需要让同步/回收的监听跳过这一轮
  let loading = false;
  // Vue Flow 允许落在端口附近就吸附连接，此时 mouseup 的 target 可能是画布，
  // 用 connect 事件先行标记，避免把有效连接误判成"在空白处松手"
  let justConnected = false;

  function baseData(label) {
    return {
      label,
      // 没指定工作流的新节点默认用列表第一条
      workflow: defaultWorkflow(),
      // 工作流暴露字段的值：{ 节点id: { 输入名: 值 } }
      params: {},
      // 哪些随机数字段处于"每次运行刷新"模式：{ 字段id: true }
      randomFields: {},
      inputMedia: [],
    };
  }

  function addNode(position) {
    captureUndo();
    nodeSeq += 1;
    const id = String(nodeSeq);
    // 增量添加：整体替换 nodes 数组会让 Vue Flow 对全部节点重建图节点，
    // 且内部对无父节点的情况是 O(N²)，2000+ 节点时新建一个节点就要几百毫秒
    for (const node of flow.getNodes.value) {
      if (node.selected) node.selected = false;
    }
    flow.addNodes([
      {
        id,
        type: "demo",
        selected: true,
        position: {
          x: Math.round(position.x - NODE_WIDTH / 2),
          y: Math.round(position.y - 36),
        },
        data: baseData(`${nodeSeq}`),
      },
    ]);
    // 新建后立即选中并展开参数面板，不用再点一下
    nextTick(() => {
      const created = flow.getNodes.value.find((node) => node.id === id);
      if (created) flow.addSelectedNodes([created]);
    });
    return id;
  }

  // 单个文件 -> 上传到 ComfyUI input 目录。用 XHR 是为了能感知上传是否还有进展；
  // 网络差的时候 30 秒没有任何进展就主动中断，交给调用方显示"失败 / 重试"
  function postMedia(file, kind) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("读取文件失败"));
      reader.onload = () => {
        const name = file.name || (kind === "video" ? "视频" : "图片");
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/infinite_canvas/api/media");
        xhr.setRequestHeader("Content-Type", "application/json");

        let lastTick = Date.now();
        // 上传停滞检测：进度事件会刷新 lastTick
        const watchdog = setInterval(() => {
          if (Date.now() - lastTick > 30000) xhr.abort();
        }, 5000);
        const settle = (fn) => {
          clearInterval(watchdog);
          fn();
        };

        xhr.upload.onprogress = () => {
          lastTick = Date.now();
        };
        xhr.onerror = () => settle(() => reject(new Error("网络中断")));
        xhr.onabort = () => settle(() => reject(new Error("上传超时")));
        xhr.ontimeout = () => settle(() => reject(new Error("上传超时")));
        xhr.onload = () =>
          settle(() => {
            let ref = null;
            try {
              ref = JSON.parse(xhr.responseText);
            } catch {
              ref = null;
            }
            if (xhr.status < 200 || xhr.status >= 300 || !ref || !ref.filename) {
              reject(new Error("上传失败"));
              return;
            }
            resolve(ref);
          });

        xhr.send(JSON.stringify({ name, data: reader.result }));
      };
      reader.readAsDataURL(file);
    });
  }

  // 单个文件 -> 媒体项：先上传到 ComfyUI input 目录，再拿 /view 引用
  async function uploadFile(file, kind) {
    const name = file.name || (kind === "video" ? "视频" : "图片");
    try {
      const ref = await postMedia(file, kind);
      const itemId = newId();
      return {
        id: itemId,
        name,
        kind,
        ref: { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "input" },
        url: mediaUrl(ref),
        thumbUrl: mediaThumbUrl(ref, 640, itemId),
      };
    } catch {
      // 接口不可用时退回本地预览（刷新后失效，但界面仍可用）
      return { id: newId(), name, kind, url: URL.createObjectURL(file), blob: file };
    }
  }

  // 拖入文件时先建"本地占位"媒体项：立刻用本地预览显示出来，
  // 再后台补传，卡片上显示进度；失败就停在"失败 / 点击重试"
  function makePlaceholder(file, kind) {
    const id = newId();
    // File 不放媒体项里：媒体项是 Vue 响应式对象，取 File 出来会被代理包一层，
    // FileReader/XHR 读代理会报 Illegal invocation；原始文件按 id 存在普通 Map 里
    pendingFiles.set(id, file);
    return {
      id,
      name: file.name || (kind === "video" ? "视频" : "图片"),
      kind,
      url: URL.createObjectURL(file),
      thumbUrl: "",
      pending: true,
      error: "",
    };
  }

  function filesToPlaceholders(files) {
    const items = [];
    for (const file of files) {
      let kind = "";
      if (file.type.startsWith("image/")) kind = "image";
      else if (file.type.startsWith("video/")) kind = "video";
      else if (file.type.startsWith("audio/")) kind = "audio";
      if (kind) items.push(makePlaceholder(file, kind));
    }
    return items;
  }

  // 同一个素材可能被拖到多个节点（各节点持有的是副本），上传落定时要按 id 同步过去，
  // 否则下游节点的副本会一直停在"上传中"（失败时也一样收不到错误）
  function syncItemCopies(item) {
    for (const node of nodes.value) {
      const all = [...(node.data.media || []), ...(node.data.inputMedia || [])];
      for (const media of all) {
        if (media === item || !media || media.id !== item.id) continue;
        // 副本用的本地预览地址已经用不上了，换掉后回收
        if (media.url && media.url.startsWith("blob:") && media.url !== item.url) {
          const stale = media.url;
          setTimeout(() => URL.revokeObjectURL(stale), 1000);
        }
        media.ref = item.ref;
        media.url = item.url;
        media.thumbUrl = item.thumbUrl;
        media.pending = false;
        media.error = item.error || "";
      }
    }
  }

  async function doUpload(item, file) {
    try {
      const ref = await postMedia(file, item.kind);
      pendingFiles.delete(item.id);
      const localUrl = item.url;
      item.ref = { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "input" };
      item.url = mediaUrl(item.ref);
      item.thumbUrl = mediaThumbUrl(item.ref, 640, item.id);
      item.pending = false;
      item.error = "";
      syncItemCopies(item);
      // 服务端地址已经换上了，延迟释放本地预览（避免正在播放的视频被立刻打断）
      if (localUrl && localUrl.startsWith("blob:")) {
        setTimeout(() => URL.revokeObjectURL(localUrl), 1000);
      }
    } catch (err) {
      item.pending = false;
      item.error = (err && err.message) || "上传失败";
      syncItemCopies(item);
      throw err;
    }
  }

  // 上传落定后，唤醒所有不再被它挡住的等待者
  function flushUploadWaiters() {
    if (!uploadWaiters.length) return;
    const rest = [];
    for (const waiter of uploadWaiters) {
      if (waiter.ids.some((id) => uploadInFlight.has(id))) rest.push(waiter);
      else waiter.resolve();
    }
    uploadWaiters = rest;
  }

  function runUpload(item) {
    const file = pendingFiles.get(item.id);
    if (!file || uploadInFlight.has(item.id)) return Promise.resolve();
    uploadInFlight.add(item.id);
    const task = doUpload(item, file).finally(() => {
      uploadInFlight.delete(item.id);
      flushUploadWaiters();
    });
    return task;
  }

  // 运行前等在途上传落定：传 ids 就只等这些素材（含从别的节点复制过来的同 id 副本），
  // 不传则等全部。这样点运行不用手动等上传，也不会被画布上无关的上传拖住
  function waitForUploads(ids) {
    const watching = ids && ids.length ? ids.filter((id) => uploadInFlight.has(id)) : [...uploadInFlight];
    if (!watching.length) return Promise.resolve();
    return new Promise((resolve) => uploadWaiters.push({ ids: watching, resolve }));
  }

  // 失败后点一下卡片重试（原始文件还留在 pendingFiles 里）
  function retryUpload(item) {
    if (!item || !pendingFiles.has(item.id) || item.pending) return;
    if (uploadInFlight.has(item.id)) return;
    item.pending = true;
    item.error = "";
    runUpload(item).catch(() => {});
  }

  // 执行结果（后端返回的 /view 引用）-> 媒体项，不需要再下载
  function itemsFromRefs(refs) {
    return (refs || [])
      .filter((ref) => ref && ref.filename)
      .map((ref) => {
        const itemId = newId();
        return {
          id: itemId,
          name: ref.name || ref.filename,
          kind: ref.kind || guessKind(ref.filename),
          ref: { filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "output" },
          url: mediaUrl(ref),
          thumbUrl: mediaThumbUrl(ref, 640, itemId),
        };
      });
  }

  // ------------------------------------------------------------ 节点自适应尺寸
  // 让「素材实际显示区域」（84% 宽度 × 内容区高度）严格等于图片宽高比：
  // 以节点当前宽度为基准算高度，高度落在 [225, 900] 之间；
  // 宽幅图算出来低于最小高度时，反过来补足宽度，保证不裁切也不留黑边
  function measureImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  async function fitNodeToFirstImage(nodeId, items) {
    const first = (items || []).find((item) => item && item.kind === "image" && (item.thumbUrl || item.url));
    if (!first) return false;
    let size = await measureImage(first.thumbUrl || first.url);
    // 缩略图还没生成 / 生成失败时退回原图测比例
    if (!size && first.thumbUrl && first.url) size = await measureImage(first.url);
    if (!size || !size.w || !size.h) return false;
    // 图片加载期间节点可能已被删除
    const node = flow.findNode(nodeId);
    if (!node) return false;

    const ratio = size.h / size.w;
    let width = Math.max(NODE_WIDTH, Number(node.data.w) || NODE_WIDTH);
    // 卡片宽度只有内容区的 84%，按这个宽度算高度才能保证卡片区域正好是图片比例
    let height = Math.round(NODE_PADDING + (width - NODE_PADDING) * CARD_WIDTH_RATIO * ratio);

    if (height > MAX_NODE_H) {
      // 超长竖图：高度封顶，宽度保持不缩
      height = MAX_NODE_H;
    } else if (height < NODE_HEIGHT) {
      // 宽幅图：保持最小高度，反过来补足宽度
      height = NODE_HEIGHT;
      width = Math.round((height - NODE_PADDING) / (CARD_WIDTH_RATIO * ratio) + NODE_PADDING);
    }

    const nextWidth = Math.max(NODE_WIDTH, width);
    const curWidth = Number(node.data.w) || NODE_WIDTH;
    const curHeight = Number(node.data.h) || NODE_HEIGHT;
    const widthTolerance = Math.max(FIT_TOLERANCE_MIN, curWidth * FIT_TOLERANCE_RATIO);
    const heightTolerance = Math.max(FIT_TOLERANCE_MIN, curHeight * FIT_TOLERANCE_RATIO);
    if (Math.abs(nextWidth - curWidth) <= widthTolerance && Math.abs(height - curHeight) <= heightTolerance) {
      return false;
    }

    node.data.w = nextWidth;
    node.data.h = height;
    return true;
  }


  // 一次拖入的多个文件放进同一个节点，节点内用堆叠卡片切换
  // 先把本地占位塞进节点（立刻可见），上传在后台跑，卡片上显示进度
  function addMediaNode(position, files) {
    const media = filesToPlaceholders(files);
    if (!media.length) return null;

    captureUndo();
    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: {
          x: Math.round(position.x - NODE_WIDTH / 2),
          y: Math.round(position.y - NODE_HEIGHT / 2),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          media,
          index: 0,
        },
      },
    ];
    // 从 nodes 里取回来的是响应式代理，状态更新才会触发渲染
    nodes.value
      .find((node) => node.id === id)
      ?.data.media.forEach((item) => runUpload(item).catch(() => {}));
    // 拖入多张时以第一张的宽高比撑开节点，避免竖图显示不全
    fitNodeToFirstImage(id, media);
    return id;
  }

  // 往已有节点上继续追加素材（同样先放本地占位，后台补传）
  function appendMedia(nodeId, files) {
    const items = filesToPlaceholders(files);
    if (!items.length) return false;

    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return false;
    captureUndo();
    const media = node.data.media || [];
    const wasEmpty = !media.length;
    node.data.media = [...media, ...items];
    if (wasEmpty) node.data.index = 0;
    node.data.media.slice(media.length).forEach((item) => runUpload(item).catch(() => {}));
    // 只有在节点本来是空的时候才按这批素材的第一次比例定尺寸
    if (wasEmpty) fitNodeToFirstImage(nodeId, items);
    return true;
  }

  // 直接把已构造好的媒体项追加到节点（执行产物走这里，不再经过上传）
  function appendItems(nodeId, items) {
    if (!items || !items.length) return false;

    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return false;
    const media = node.data.media || [];
    const wasEmpty = !media.length;
    node.data.media = [...media, ...items];
    if (wasEmpty) node.data.index = 0;
    // 空节点落首个产物时按它的比例定尺寸；已有素材时保持原有比例不变
    if (wasEmpty) fitNodeToFirstImage(nodeId, items);
    return true;
  }

  // 从 (x, y) 开始往下找一块没被占用的空位：命中已有节点就整块往下挪一行，
  // skipId 用于跳过发起这次排布的那个节点本身
  function placeClearBelow(x, y, width, height, skipId = null) {
    const hit = (node) => {
      if (node.id === skipId) return false;
      const w = Math.max(NODE_WIDTH, Number(node.data?.w) || NODE_WIDTH);
      const h = Math.max(NODE_HEIGHT, Number(node.data?.h) || NODE_HEIGHT);
      const nx = Number(node.position?.x) || 0;
      const ny = Number(node.position?.y) || 0;
      return x < nx + w && nx < x + width && y < ny + h && ny < y + height;
    };
    for (let guard = 0; guard < 200 && nodes.value.some(hit); guard += 1) {
      y += height + NODE_GAP_Y;
    }
    return y;
  }

  // 下游节点的落位：第一个紧贴源节点右侧，之后在同一列里往下排开。
  // 横向一直排会把画布拉成一条长龙，纵向一列更像"同一个节点的多次产出"。
  // 依然做占用检测，避免压住放大过的上游节点或已有节点
  function placeChildOf(source) {
    const gap = NODE_WIDTH / 2;
    const sourceW = Math.max(NODE_WIDTH, Number(source.data?.w) || NODE_WIDTH);
    const x = Math.round(source.position.x + sourceW + gap);
    const y = placeClearBelow(x, Math.round(source.position.y), NODE_WIDTH, NODE_HEIGHT, source.id);
    return { x, y };
  }

  // 以当前节点为输入派生一个下游节点（右侧一列，自动向下排开）：自动连线 + 继承自身媒体
  // items 为新节点自身的首批素材（运行产物）
  function spawnChildNode(sourceId, items = []) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return null;

    // 继承的素材在创建时就带上，避免新建后再改 data 被 v-model 同步覆盖
    const inherited = (source.data.media || []).map((item) => ({ ...item, sourceId }));
    const slot = placeChildOf(source);

    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: slot,
        data: {
          ...baseData(`${nodeSeq}`),
          // 生成参数沿用上游节点
          params: JSON.parse(JSON.stringify(source.data.params || {})),
          randomFields: JSON.parse(JSON.stringify(source.data.randomFields || {})),
          workflow: source.data.workflow || defaultWorkflow(),
          media: items,
          index: 0,
          inputMedia: inherited,
        },
      },
    ];

    addEdge(sourceId, null, id, null);
    if (items.length) fitNodeToFirstImage(id, items);
    return id;
  }

  // 从屏幕坐标拖入文件：转画布坐标后建节点
  async function importMedia(clientX, clientY, files) {
    return addMediaNode(
      flow.screenToFlowCoordinate({ x: clientX, y: clientY }),
      files
    );
  }

  function addEdge(source, sourceHandle, target, targetHandle) {
    edgeSeq += 1;
    edges.value = [
      ...edges.value,
      {
        id: `e${edgeSeq}`,
        type: "canvas",
        source,
        sourceHandle: sourceHandle || null,
        target,
        targetHandle: targetHandle || null,
      },
    ];
  }

  // 节点输出给下游时只带自身媒体（不含它自己的上游输入）
  function inheritMedia(sourceId, targetId) {
    const source = flow.findNode(sourceId);
    const target = flow.findNode(targetId);
    if (!source || !target) return;

    const own = source.data.media || [];
    if (!own.length) return;

    const existing = target.data.inputMedia || [];
    const seen = new Set(existing.map((item) => item.id));
    const added = [];
    for (const item of own) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      // sourceId 用于断开连线时精确回收
      added.push({ ...item, sourceId });
    }
    if (!added.length) return;

    target.data.inputMedia = [...existing, ...added];
  }

  // 断开连线后，把这条上游贡献的媒体从下游移除
  function dropInputMedia(targetId, sourceId) {
    if (edges.value.some((edge) => edge.target === targetId && edge.source === sourceId)) {
      return;
    }
    const node = nodes.value.find((item) => item.id === targetId);
    if (!node) return;

    const list = node.data.inputMedia || [];
    const kept = list.filter((item) => item.sourceId !== sourceId);
    if (kept.length !== list.length) node.data.inputMedia = kept;
  }

  // 监听连线被删除（手动删除校验，节点删除也会触发）。
  // 不能用 deep watch：拖动节点时 Vue Flow 每帧都在改连线的 sourceX/sourceY，
  // deep 会把全部连线深遍历一遍；只比较 id 拼接出的签名即可
  const edgeEnds = new Map();
  const edgeSignature = computed(() => edges.value.map((edge) => edge.id).join(","));
  watch(edgeSignature, () => {
    const alive = new Set();
    for (const edge of edges.value) {
      alive.add(edge.id);
      edgeEnds.set(edge.id, { source: edge.source, target: edge.target });
    }
    for (const [id, ends] of [...edgeEnds]) {
      if (alive.has(id)) continue;
      edgeEnds.delete(id);
      if (loading || restoring) continue;
      dropInputMedia(ends.target, ends.source);
    }
  });

  // 上游自身媒体被重排/删除/追加后，同步给所有直接下游
  function syncDownstream(sourceId) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return;

    const own = (source.data.media || []).map((item) => ({ ...item, sourceId }));
    const targets = new Set(
      edges.value.filter((edge) => edge.source === sourceId).map((edge) => edge.target)
    );

    for (const targetId of targets) {
      const target = nodes.value.find((item) => item.id === targetId);
      if (!target) continue;

      // 用最新自身媒体替换该来源原来占的那一段，其他来源的位置保持不变
      const kept = [];
      let at = -1;
      for (const item of target.data.inputMedia || []) {
        if (item.sourceId === sourceId) {
          if (at === -1) at = kept.length;
          continue;
        }
        kept.push(item);
      }
      if (at === -1) at = kept.length;

      target.data.inputMedia = [...kept.slice(0, at), ...own, ...kept.slice(at)];
    }
  }

  // 自身媒体的 id 序列快照：序列一变就说明被重排/删除/追加，通知下游
  const mediaKeys = new Map();

  function snapshotMediaKeys() {
    mediaKeys.clear();
    for (const node of nodes.value) {
      mediaKeys.set(node.id, mediaKeyOf(node));
    }
  }

  // 只比较素材指纹：拖拽时节点 position 每帧都在变，
  // deep watch 会把所有节点的 data（素材、参数）整体深遍历一遍
  const mediaSignature = computed(() => {
    return nodes.value
      .map((node) => `${node.id}:${mediaKeyOf(node)}`)
      .join("|");
  });
  watch(mediaSignature, () => {
    if (loading || restoring) return;
    const alive = new Set();
    for (const node of nodes.value) {
      alive.add(node.id);
      const key = mediaKeyOf(node);
      const prev = mediaKeys.get(node.id);
      mediaKeys.set(node.id, key);
      if (prev !== undefined && prev !== key) syncDownstream(node.id);
    }

    // 节点被删掉后清掉快照
    for (const id of [...mediaKeys.keys()]) {
      if (!alive.has(id)) mediaKeys.delete(id);
    }
  });

  // ------------------------------------------------------------ 撤销
  // 快照式撤销：操作前把整张画布（节点结构、节点数据、素材引用）存一份。
  // 素材只存引用不存文件，删除节点/素材也不回收 input 文件，统一交给资产管理面板处理。
  const UNDO_LIMIT = 40;
  let undoStack = [];
  let undoAt = 0;
  let restoring = false;

  function cloneMediaList(list) {
    return (list || [])
      .filter((item) => item && (item.ref?.filename || item.pending || item.url))
      .map((item) => {
        const { url, thumbUrl, blob, file, pending, error, ...rest } = item;
        return rest.ref ? { ...rest, ref: { ...rest.ref } } : rest;
      });
  }

  function snapshotGraph() {
    return {
      seq: { node: nodeSeq, edge: edgeSeq },
      nodes: nodes.value.map((item) => {
        // 快照只读数据，用 toRaw 绕开响应式代理，1000 个节点时能省掉大量 get 陷阱
        const node = toRaw(item);
        const data = toRaw(node.data) || {};
        const { media, inputMedia, ...rest } = data;
        return {
          id: node.id,
          type: node.type || "demo",
          position: {
            x: Math.round(node.position?.x || 0),
            y: Math.round(node.position?.y || 0),
          },
          data: {
            // data 上除素材外的字段（params / randomFields / workflow 等）都是整体替换写入，
            // 从不就地修改，所以浅拷贝共享引用就够了：省掉每次新建节点时深克隆整张图
            ...rest,
            media: cloneMediaList(media),
            inputMedia: cloneMediaList(inputMedia),
          },
        };
      }),
      edges: edges.value.map((edge) => ({
        id: edge.id,
        type: edge.type || "canvas",
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
      })),
    };
  }

  // force = true 用于明确的一次性操作（切换工作流、粘贴），不受输入合并窗口影响
  function captureUndo(force = false) {
    if (restoring || loading) return;
    const now = Date.now();
    // 连续输入（提示词、滑块、数字框）合并成一步，避免每敲一个字都压一份
    if (!force && now - undoAt < 1200) return;
    undoAt = now;
    undoStack.push(snapshotGraph());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  }

  function restoreGraph(snapshot) {
    restoring = true;
    const restoredNodes = snapshot.nodes.map((node) => ({
      id: node.id,
      type: node.type || "demo",
      position: { ...node.position },
      data: {
        ...JSON.parse(JSON.stringify(node.data)),
        media: (node.data.media || []).map(hydrateMediaItem),
        inputMedia: (node.data.inputMedia || []).map(hydrateMediaItem),
      },
    }));

    nodes.value = restoredNodes;
    edges.value = snapshot.edges.map((edge) => ({ ...edge }));
    nodeSeq = snapshot.seq?.node ?? nodeSeq;
    edgeSeq = snapshot.seq?.edge ?? edgeSeq;
    // 撤销/重做可能只改了坐标（节点 id 不变），要单独通知自动保存
    layoutRevision.value += 1;
    // 直接刷新媒体快照，避免还原这一轮被当成"素材变化"去同步下游
    snapshotMediaKeys();

    nextTick(() => {
      restoring = false;
    });
  }

  function undo() {
    if (restoring) return false;
    const snapshot = undoStack.pop();
    if (!snapshot) return false;

    // 撤销掉正在运行的节点前先中断，避免任务跑完找不到节点
    const kept = new Set(snapshot.nodes.map((node) => node.id));
    for (const node of nodes.value) {
      if (!kept.has(node.id)) abortPrompt(node.id);
    }

    undoAt = 0;
    restoreGraph(snapshot);
    return true;
  }

  // 切画布时撤销历史作废
  function flushUndo() {
    undoStack = [];
    undoAt = 0;
  }

  // ------------------------------------------------------------ 画布存取

  function exportCanvas() {
    return {
      nodes: nodes.value.map((item) => {
        // 保存只读数据：用 toRaw 避免随后 JSON.stringify 时逐个字段走代理
        const node = toRaw(item);
        const data = toRaw(node.data) || {};
        return {
          id: node.id,
          type: node.type || "demo",
          position: { x: node.position.x, y: node.position.y },
          data: {
            ...data,
            // 还没传完的占位素材没有 ref，存下来也没法还原，直接跳过
            media: (data.media || [])
              .filter((mediaItem) => mediaItem && mediaItem.ref && mediaItem.ref.filename)
              .map(stripMediaItem),
            inputMedia: (data.inputMedia || [])
              .filter((mediaItem) => mediaItem && mediaItem.ref && mediaItem.ref.filename)
              .map(stripMediaItem),
          },
        };
      }),
      edges: edges.value.map((edge) => ({
        id: edge.id,
        type: edge.type || "canvas",
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || null,
        targetHandle: edge.targetHandle || null,
      })),
      seq: { node: nodeSeq, edge: edgeSeq },
      viewport: {
        x: Math.round(viewport.value.x),
        y: Math.round(viewport.value.y),
        zoom: viewport.value.zoom,
      },
    };
  }

  function loadCanvas(canvas) {
    loading = true;
    boxSelectedIds.clear();
    flushUndo();
    const loadedNodes = (canvas.nodes || []).map((node) => {
      const data = node.data || {};
      return {
        id: String(node.id),
        type: node.type || "demo",
        position: {
          x: Math.round(node.position?.x || 0),
          y: Math.round(node.position?.y || 0),
        },
        data: {
          ...baseData(data.label || node.id),
          ...data,
          media: (data.media || []).map(hydrateMediaItem),
          inputMedia: (data.inputMedia || []).map(hydrateMediaItem),
        },
      };
    });
    const loadedEdges = (canvas.edges || []).map((edge) => ({
      id: edge.id,
      type: edge.type || "canvas",
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null,
      targetHandle: edge.targetHandle || null,
    }));

    nodes.value = loadedNodes;
    edges.value = loadedEdges;

    // 序号从文件里恢复，避免新节点 id 和已有节点冲突
    nodeSeq = Number(canvas.seq?.node) || 0;
    edgeSeq = Number(canvas.seq?.edge) || 0;
    for (const node of loadedNodes) nodeSeq = Math.max(nodeSeq, Number(node.id) || 0);
    for (const edge of loadedEdges) {
      edgeSeq = Math.max(edgeSeq, Number(String(edge.id).replace(/^e/, "")) || 0);
    }

    snapshotMediaKeys();

    // 恢复上次的平移/缩放（旧画布没有 viewport 字段时回到默认视图）
    const saved = canvas.viewport || {};
    const zoom = Number(saved.zoom);
    const next = {
      x: Number(saved.x) || 0,
      y: Number(saved.y) || 0,
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : DEFAULT_VIEWPORT.zoom,
    };
    viewport.value = next;
    nextTick(() => {
      flow.setViewport(next);
      loading = false;
    });
  }

  function resetCanvas() {
    loading = true;
    boxSelectedIds.clear();
    flushUndo();
    nodes.value = [];
    edges.value = [];
    nodeSeq = 0;
    edgeSeq = 0;
    snapshotMediaKeys();
    viewport.value = { ...DEFAULT_VIEWPORT };
    nextTick(() => {
      flow.setViewport(DEFAULT_VIEWPORT);
      loading = false;
    });
  }

  // ------------------------------------------------------------ 视图操作
  // 纸飞机按钮：恢复默认缩放，并把指定节点（没传就取当前选中的）居中
  function focusNode(nodeId) {
    const zoom = DEFAULT_VIEWPORT.zoom;
    let id = nodeId;
    if (!id) {
      // getSelectedNodes 是 computed，取 .value 而不是当函数调用（否则抛 TypeError）
      const picked = flow.getSelectedNodes?.value || [];
      id = picked.length ? picked[0].id : null;
    }
    const node = id && flow.findNode ? flow.findNode(id) : null;
    if (!node) {
      flow.setViewport({ ...DEFAULT_VIEWPORT });
      return;
    }

    const pos = node.computedPosition || node.position || { x: 0, y: 0 };
    const size = node.dimensions || { width: 0, height: 0 };
    // 视口容器尺寸：Vue Flow 这里可能给的是 ref，也可能直接是 DOM 元素
    const raw = flow.viewportRef;
    const el = raw && raw.value !== undefined ? raw.value : raw;
    const width = (el && el.clientWidth) || window.innerWidth;
    const height = (el && el.clientHeight) || window.innerHeight;
    flow.setViewport({
      x: Math.round(width / 2 - (pos.x + size.width / 2) * zoom),
      y: Math.round(height / 2 - (pos.y + size.height / 2) * zoom),
      zoom,
    });
  }

  // 全览：把包含所有节点的区域缩放到视口里
  function fitCanvas() {
    flow.fitView({ padding: 0.18, includeHiddenNodes: false });
  }

  function onDblClick(event) {
    // 双击节点时不要新建
    if (event.target.closest(".vue-flow__node")) return;
    // 画布内的浮层（资产库面板、底部工具栏、右下角菜单）双击都不该新建节点
    if (event.target.closest(".library-dock, .canvas-tabbar, .canvas-menu")) return;
    addNode(flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY }));
  }

  function onConnect(connection) {
    justConnected = true;
    captureUndo(true);
    addEdge(
      connection.source,
      connection.sourceHandle,
      connection.target,
      connection.targetHandle
    );
    // 把上游媒体带进下游节点
    inheritMedia(connection.source, connection.target);
  }

  // 拉线时整块节点都是连接热区：鼠标压在节点身上就把预览线吸到该节点的默认端口。
  // 落点只认光标下的节点，不做端口半径吸附（App.vue 里 connection-radius 设为 0），
  // 否则光标离节点还有几十像素就会被端口吸过去
  function trackConnectPointer(event) {
    const start = flow.connectionStartHandle.value;
    const touch = event.touches?.[0];
    const target = touch
      ? document.elementFromPoint(touch.clientX, touch.clientY)
      : event.target;
    if (!start || !(target instanceof Element) || target.closest(".node-panel")) {
      connectSnap.value = null;
      return;
    }

    const nodeId = target.closest(".vue-flow__node")?.dataset.id;
    const node = nodeId && nodeId !== start.nodeId ? flow.findNode(nodeId) : null;
    const size = node?.dimensions;
    if (!node || !size?.width || !size?.height) {
      connectSnap.value = null;
      return;
    }

    // 从输出口往右拉吸附到目标的左侧入口，从输入口往左拉吸附到目标的右侧出口
    const toTarget = start.type === "source";
    connectSnap.value = {
      nodeId: node.id,
      x: toTarget ? node.computedPosition.x : node.computedPosition.x + size.width,
      y: node.computedPosition.y + size.height / 2,
      position: toTarget ? "left" : "right",
    };
  }

  function onConnectStart(payload) {
    connectStart = payload
      ? {
          nodeId: payload.nodeId,
          handleId: payload.handleId,
          handleType: payload.handleType,
        }
      : null;
    connectSnap.value = null;
    window.addEventListener("mousemove", trackConnectPointer);
    window.addEventListener("touchmove", trackConnectPointer, { passive: true });
  }

  function onConnectEnd(event) {
    const start = connectStart;
    connectStart = null;
    window.removeEventListener("mousemove", trackConnectPointer);
    window.removeEventListener("touchmove", trackConnectPointer);
    // 松手时可能已经不在节点上（只是被热区吸住了），把吸附到的节点一起带上
    const snappedNodeId = connectSnap.value?.nodeId;

    if (justConnected) {
      justConnected = false;
      return;
    }

    if (!start || !event || !(event.target instanceof Element)) return;

    // 落在节点主体、端口、或热区吸附范围里都视为连接；落在自己的端口上则什么都不做
    const dropNodeId =
      event.target.closest(".vue-flow__node")?.getAttribute("data-id") || snappedNodeId;
    if (dropNodeId === start.nodeId && event.target.closest(".vue-flow__handle")) return;
    if (dropNodeId && dropNodeId !== start.nodeId && flow.findNode(dropNodeId)) {
      captureUndo(true);
      if (start.handleType === "source") {
        addEdge(start.nodeId, start.handleId, dropNodeId, null);
        inheritMedia(start.nodeId, dropNodeId);
      } else {
        addEdge(dropNodeId, null, start.nodeId, start.handleId);
        inheritMedia(dropNodeId, start.nodeId);
      }
      return;
    }

    const id = addNode(
      flow.screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
    );

    // 手动拉线新建的下游节点沿用上游选择的工作流和已填参数
    // 新节点是增量加进 Vue Flow store 的，nodes.value 要等这一轮刷新后才有，这里直接查 store
    const upstream = flow.findNode(start.nodeId);
    const created = flow.findNode(id);
    if (created && upstream?.data.workflow) {
      created.data.workflow = upstream.data.workflow;
      created.data.params = JSON.parse(JSON.stringify(upstream.data.params || {}));
      created.data.randomFields = JSON.parse(
        JSON.stringify(upstream.data.randomFields || {})
      );
    }

    if (start.handleType === "source") {
      addEdge(start.nodeId, start.handleId, id, null);
      inheritMedia(start.nodeId, id);
    } else {
      addEdge(id, null, start.nodeId, start.handleId);
      inheritMedia(id, start.nodeId);
    }
  }

  const offConnect = flow.onConnect(onConnect);
  const offConnectStart = flow.onConnectStart(onConnectStart);
  const offConnectEnd = flow.onConnectEnd(onConnectEnd);

  // ------------------------------------------------------------ 节点复制
  // 按住 Alt / Option 拖动节点时会拖出一个虚拟副本，松手处才落成真实的兄弟节点，
  // 原节点不动；工作流、参数（含提示词）、上游连线和素材一起复制

  function duplicateNode(sourceId, position) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return null;

    captureUndo(true);
    nodeSeq += 1;
    const id = String(nodeSeq);
    // 和新建节点一样走增量添加：整体替换 nodes 数组会让 Vue Flow 重建全部图节点，
    // 且内部对无父节点的匹配是 O(N²)，2000+ 节点时复制一次要几百毫秒
    flow.addNodes([
      {
        id,
        type: "demo",
        position: { x: Math.round(position.x), y: Math.round(position.y) },
        data: {
          ...baseData(`${nodeSeq}`),
          workflow: source.data.workflow || defaultWorkflow(),
          params: JSON.parse(JSON.stringify(source.data.params || {})),
          randomFields: JSON.parse(JSON.stringify(source.data.randomFields || {})),
          // 副本沿用原节点拖过的尺寸，不再退回默认的 400×260
          w: source.data.w,
          h: source.data.h,
          // 素材沿用引用，但 id 要重新生成，避免和原节点在同一目标节点上被去重；
          // 还在上传的素材保留原 id，上传落定后按 id 把引用同步到副本
          media: (source.data.media || []).map((item) => ({
            ...item,
            id: item.pending || !item.ref ? item.id : newId(),
          })),
          index: 0,
          inputMedia: (source.data.inputMedia || []).map((item) => ({
            ...item,
            id: item.pending || !item.ref ? item.id : newId(),
          })),
        },
      },
    ]);

    // 上游连线一起复制，副本的运行条件和原节点一致
    for (const edge of edges.value.filter((item) => item.target === sourceId)) {
      addEdge(edge.source, edge.sourceHandle, id, edge.targetHandle);
    }

    return id;
  }

  // ------------------------------------------------------------ 复制 / 粘贴
  // Ctrl/Cmd + C 记住选中的节点（支持多选），Ctrl/Cmd + V 在下方空白处生成副本。
  // 与 Alt 拖拽复制不同：这里不复制上游连线，也不带上游媒体，
  // 选中节点之间的内部连线会一起复制
  let clipboard = null;

  function copySelection() {
    const selected = flow.getSelectedNodes?.value || [];
    if (!selected.length) return 0;

    clipboard = {
      nodes: selected.map((picked) => {
        const source = nodes.value.find((node) => node.id === picked.id) || picked;
        const { media, inputMedia, ...rest } = source.data || {};
        const data = JSON.parse(JSON.stringify(rest));
        data.media = (media || []).map((item) => {
          const clean = stripMediaItem(item);
          // 还在上传的素材保留原 id，上传落定后按 id 同步到副本
          if (item.pending || !item.ref) {
            clean.id = item.id;
            clean.url = item.url;
          } else {
            clean.id = newId();
          }
          return clean;
        });
        return {
          from: source.id,
          position: {
            x: Math.round(source.position?.x || 0),
            y: Math.round(source.position?.y || 0),
          },
          data,
        };
      }),
      edges: edges.value
        .filter(
          (edge) =>
            selected.some((node) => node.id === edge.source) &&
            selected.some((node) => node.id === edge.target)
        )
        .map((edge) => ({
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle || null,
          targetHandle: edge.targetHandle || null,
        })),
    };
    return clipboard.nodes.length;
  }

  function pasteClipboard() {
    if (!clipboard || !clipboard.nodes.length) return 0;

    captureUndo(true);
    // 和下游节点同一套落位逻辑：整块选区往下找一块没被占用的空位，避免盖住已有节点
    const box = clipboard.nodes.reduce(
      (acc, entry) => {
        const w = Math.max(NODE_WIDTH, Number(entry.data?.w) || NODE_WIDTH);
        const h = Math.max(NODE_HEIGHT, Number(entry.data?.h) || NODE_HEIGHT);
        return {
          minX: Math.min(acc.minX, entry.position.x),
          minY: Math.min(acc.minY, entry.position.y),
          maxX: Math.max(acc.maxX, entry.position.x + w),
          maxY: Math.max(acc.maxY, entry.position.y + h),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    );
    const boxW = box.maxX - box.minX;
    const boxH = box.maxY - box.minY;
    const top = placeClearBelow(box.minX, box.minY + boxH + NODE_GAP_Y, boxW, boxH);
    const offsetY = top - box.minY;
    const created = [];
    const idMap = new Map();

    for (const entry of clipboard.nodes) {
      nodeSeq += 1;
      const id = String(nodeSeq);
      idMap.set(entry.from, id);
      created.push({
        id,
        type: "demo",
        selected: true,
        position: { x: entry.position.x, y: entry.position.y + offsetY },
        data: {
          ...baseData(`${nodeSeq}`),
          ...JSON.parse(JSON.stringify(entry.data)),
          media: (entry.data.media || []).map(hydrateMediaItem),
          inputMedia: [],
        },
      });
    }

    // 清掉旧选中，再增量追加新节点（整体替换数组会让 Vue Flow 重建全部图节点，
    // 且内部对无父节点的匹配是 O(N²)，2000+ 节点时粘贴一次要几百毫秒）
    flow.removeSelectedNodes();
    flow.addNodes(created);

    // 一次粘贴多个节点按"框选"处理：只高亮，不逐个展开参数面板。
    // 之后单独点其中某个节点时，rememberNode 会把它移出集合、面板正常展开
    if (created.length > 1) {
      for (const node of created) boxSelectedIds.add(node.id);
    }

    // 内部连线按新 id 重建，并让上游媒体重新同步到下游
    for (const edge of clipboard.edges || []) {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) continue;
      addEdge(source, edge.sourceHandle, target, edge.targetHandle);
      inheritMedia(source, target);
    }

    nextTick(() => {
      const instances = [...idMap.values()]
        .map((id) => flow.getNodes.value.find((node) => node.id === id))
        .filter(Boolean);
      if (instances.length) flow.addSelectedNodes(instances);
    });

    return created.length;
  }

  // 输入框里按 Ctrl+C/V 是正常复制文本，不拦截
  function isTypingTarget(target) {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      "input, textarea, select, [contenteditable='true'], [contenteditable='']"
    );
  }

  function onCopyPasteKey(event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
    const key = String(event.key || "").toLowerCase();
    if (key !== "c" && key !== "v" && key !== "z") return;
    if (isTypingTarget(event.target)) return;

    if (key === "z") {
      if (undo()) event.preventDefault();
      return;
    }
    if (key === "c") {
      if (copySelection()) event.preventDefault();
      return;
    }
    if (pasteClipboard()) event.preventDefault();
  }

  window.addEventListener("keydown", onCopyPasteKey);

  // Vue Flow 自带的 Backspace / Delete 删除节点不走这里，先抢在它之前存一份快照，
  // 这样键盘删除也能撤销（监听顺序上我们比 VueFlow 组件先注册）
  function onDeleteKey(event) {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (isTypingTarget(event.target)) return;
    const selected = flow.getSelectedNodes?.value || [];
    if (!selected.length) return;
    captureUndo(true);
  }
  window.addEventListener("keydown", onDeleteKey);

  // 拖动开始前存一份位置，拖动结束写回坐标，撤销才能退回原位
  const offNodeDragStart = flow.onNodeDragStart(() => captureUndo(true));

  // 拖动结束后把坐标写回节点数据：Vue Flow 只在内部状态里更新位置，
  // 不写回来导出的画布就还是创建时的坐标
  const offNodeDragStop = flow.onNodeDragStop((payload) => {
    const dragged = payload?.nodes?.length
      ? payload.nodes
      : payload?.node
        ? [payload.node]
        : [];
    for (const item of dragged) {
      const target = nodes.value.find((node) => node.id === item.id);
      if (target && item.position) {
        target.position = { x: item.position.x, y: item.position.y };
      }
    }
    // 坐标不在保存签名里逐帧比较（1000 个节点时拖拽每帧都要序列化一次），
    // 拖动结束后用一个版本号通知自动保存
    layoutRevision.value += 1;
  });

  // 端口是否已连线：在这里一次汇总成 Set，
  // 否则每个节点都要自己 some() 扫一遍全部连线（N 个节点 × E 条连线）
  const connectedSources = computed(() => new Set(edges.value.map((edge) => edge.source)));
  const connectedTargets = computed(() => new Set(edges.value.map((edge) => edge.target)));

  // Shift 拖拽框选出来的节点只高亮，不展开参数面板（否则一次框选会刷出一排面板）；
  // 只有主动点击 / 新建的节点才展开，点一下就把它从这份集合里去掉
  let boxSelecting = false;
  const offSelectionStart = flow.onSelectionStart(() => {
    boxSelecting = true;
  });
  const offSelectionEnd = flow.onSelectionEnd(() => {
    boxSelecting = false;
  });
  watch(
    () => flow.getSelectedNodes.value.map((node) => node.id).join(","),
    () => {
      if (!boxSelecting) return;
      for (const node of flow.getSelectedNodes.value) boxSelectedIds.add(node.id);
    }
  );

  // 视口裁剪：当前视口内（外扩一圈缓冲）的节点 id。
  // 只决定节点内容挂不挂载，素材引用、连线和上下游传递都在 nodes/edges 上，不受影响
  const VISIBLE_BUFFER = 320;
  const viewSize = ref({ width: window.innerWidth, height: window.innerHeight });
  const onViewResize = () => {
    viewSize.value = { width: window.innerWidth, height: window.innerHeight };
  };
  window.addEventListener("resize", onViewResize);
  onScopeDispose(() => window.removeEventListener("resize", onViewResize));

  const visibleNodeIds = computed(() => {
    const panned = viewport.value || { x: 0, y: 0, zoom: 1 };
    const zoom = Number(panned.zoom) || 1;
    // 视口坐标反推画布坐标
    const minX = (-panned.x - VISIBLE_BUFFER) / zoom;
    const maxX = (-panned.x + viewSize.value.width + VISIBLE_BUFFER) / zoom;
    const minY = (-panned.y - VISIBLE_BUFFER) / zoom;
    const maxY = (-panned.y + viewSize.value.height + VISIBLE_BUFFER) / zoom;
    const ids = new Set();
    for (const item of nodes.value) {
      // 拖动节点时 position 每帧都在变：直接读代理会让这个 computed 每帧失效，
      // 2474 个节点整表重算一次约 5ms，是拖拽掉帧的主要来源。
      // 用 toRaw 只保留"节点增删 + 视口变化"两个依赖；被拖动/选中的节点本来就不会被裁剪
      const node = toRaw(item);
      const w = Number(node.data?.w) || NODE_WIDTH;
      const h = Number(node.data?.h) || NODE_HEIGHT;
      const x = Number(node.position?.x) || 0;
      const y = Number(node.position?.y) || 0;
      if (x + w >= minX && x <= maxX && y + h >= minY && y <= maxY) ids.add(node.id);
    }
    return ids;
  });

  // 平移/缩放变化同步到本地；只比较三个数值，避免 deep 遍历整个视口对象
  watch(
    () => {
      const value = flow.viewport.value;
      return value ? `${value.x}|${value.y}|${value.zoom}` : "";
    },
    () => {
      if (loading) return;
      const value = flow.viewport.value;
      if (!value) return;
      viewport.value = { x: value.x, y: value.y, zoom: value.zoom };
    }
  );

  // ------------------------------------------------------------ 异步执行
  // /prompt 只返回 prompt_id，进度通过 ComfyUI 的 /ws 推送；
  // 另外定时查结果接口兜底，避免 WebSocket 断线时任务一直停在"运行中"
  const runStates = reactive({});
  const promptNodes = new Map();
  // 节点 -> 当前任务，中断时按节点找到要取消的 prompt
  const nodePrompts = new Map();
  const settledPrompts = new Set();
  const pollers = new Map();
  let socket = null;

  // ------------------------------------------------------------ 跨刷新恢复运行态
  // prompt -> 节点的映射只在内存里，刷新页面后就对不上了；把这张表存一份到
  // localStorage，重新进入画布时再向 ComfyUI 的队列核对一次，以队列为准恢复状态
  const PROMPT_MAP_KEY = "infinite-canvas:prompt-nodes";
  const PROMPT_MAP_LIMIT = 50;
  // 恢复时的有效期：超过一天的任务 ComfyUI 的历史里多半已经清掉
  const RESTORE_MAX_AGE = 24 * 60 * 60 * 1000;
  // 当前画布 id：不同画布的节点 id 都从 1 开始，映射必须按画布隔离，否则会串台
  let runScope = "";

  function readPromptMap() {
    try {
      const value = JSON.parse(localStorage.getItem(PROMPT_MAP_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function writePromptMap(map) {
    try {
      localStorage.setItem(PROMPT_MAP_KEY, JSON.stringify(map));
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  function rememberPrompt(promptId, nodeId, startedAt) {
    const map = readPromptMap();
    map[promptId] = { nodeId, startedAt, scope: runScope };
    const entries = Object.entries(map);
    if (entries.length > PROMPT_MAP_LIMIT) {
      entries.sort((a, b) => (b[1]?.startedAt || 0) - (a[1]?.startedAt || 0));
      writePromptMap(Object.fromEntries(entries.slice(0, PROMPT_MAP_LIMIT)));
      return;
    }
    writePromptMap(map);
  }

  function forgetPrompt(promptId) {
    const map = readPromptMap();
    if (!(promptId in map)) return;
    delete map[promptId];
    writePromptMap(map);
  }

  function setRunScope(id) {
    runScope = String(id || "");
  }

  function executionClientId() {
    const KEY = "infinite_canvas_client_id";
    let value = localStorage.getItem(KEY);
    if (!value) {
      value = `ic_${newId()}`;
      localStorage.setItem(KEY, value);
    }
    return value;
  }

  // 和提交任务时用的是同一个 clientId，否则 ComfyUI 不会把进度推过来
  const clientId = executionClientId();

  function ensureSocket() {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(
      `${scheme}://${location.host}/ws?clientId=${encodeURIComponent(clientId)}`
    );
    socket.onmessage = onSocketMessage;
    socket.onclose = () => {
      socket = null;
    };
    socket.onerror = () => {
      // 连不上 /ws 时任务仍靠轮询跟进，这里只提示方便排查（如开发服务器没代理 /ws）
      console.warn("[Infinite-Canvas] WebSocket 连接失败，进度改为轮询更新");
      socket = null;
    };
  }

  // 从进度消息里取出"当前正在采样"的那个节点的步数。
  // 不能把所有节点的 max/value 加起来：模型加载之类的节点也会报 max=1/value=1，
  // 采样还没开始就会算出 100%
  function readProgress(data) {
    const nodes = data?.nodes;
    if (nodes && typeof nodes === "object") {
      // max > 1 才是多步采样；max = 1 的节点（加载模型等）不参与进度计算
      const list = Object.values(nodes).filter((item) => Number(item?.max) > 1);
      const active =
        list.find((item) => item?.state === "running") ||
        list.find((item) => {
          const value = Number(item?.value) || 0;
          return value > 0 && value < Number(item?.max);
        });
      if (!active) return null;
      const max = Number(active.max) || 0;
      return { value: Math.min(Number(active.value) || 0, max), max };
    }
    const max = Number(data?.max) || 0;
    // max 只有 1 的多半是"加载模型 / 处理一张图"这类一次性节点，拿它当进度会瞬间 100%
    if (max <= 1) return null;
    return { value: Math.min(Number(data?.value) || 0, max), max };
  }

  // 进度百分比来自采样步数，加载模型/解码阶段没有事件，容易长时间停在 0%，
  // 因此界面上不做进度估算，只显示状态 + 计时（见 Node/index.vue）
  function onSocketMessage(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const data = message?.data || {};
    // 老版本 ComfyUI 的 progress 消息不带 prompt_id：只有一个任务在跑时直接归属它
    const promptId = data.prompt_id || (promptNodes.size === 1 ? promptNodes.keys().next().value : "");
    if (!promptId) return;

    const nodeId = promptNodes.get(promptId);
    const state = nodeId ? runStates[nodeId] : null;
    if (!state) return;

    if (message.type === "execution_start") {
      state.status = "running";
      state.stepValue = 0;
      state.stepMax = 0;
    } else if (message.type === "progress" || message.type === "progress_state") {
      state.status = "running";
      // 只记录当前采样节点的步数：多采样器串联时进度会从头开始，但这就是真实进度
      const step = readProgress(data);
      if (step) {
        state.stepValue = step.value;
        state.stepMax = step.max;
      }
    } else if (message.type === "execution_success") {
      checkPrompt(nodeId, promptId);
    } else if (message.type === "execution_interrupted") {
      failPrompt(nodeId, promptId, "任务已中断");
    } else if (message.type === "execution_error") {
      failPrompt(nodeId, promptId, data.exception_message || "执行失败");
    }
  }

  async function submitExecution(payload) {
    const response = await fetch("/infinite_canvas/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, clientId }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error((data && data.error) || `运行失败（${response.status}）`);
    }
    if (!data || !data.prompt_id) throw new Error("ComfyUI 未返回任务 id");
    return data.prompt_id;
  }

  function stopPolling(promptId) {
    const timer = pollers.get(promptId);
    if (timer) clearInterval(timer);
    pollers.delete(promptId);
  }

  function failPrompt(nodeId, promptId, message) {
    if (settledPrompts.has(promptId)) return;
    settledPrompts.add(promptId);
    stopPolling(promptId);
    promptNodes.delete(promptId);
    nodePrompts.delete(nodeId);
    forgetPrompt(promptId);
    const state = runStates[nodeId];
    if (state) {
      state.status = "error";
      state.error = message || "运行失败";
    }
    setTimeout(() => {
      if (runStates[nodeId]?.status === "error") delete runStates[nodeId];
    }, 4000);
  }

  function finishPrompt(nodeId, promptId, images) {
    if (settledPrompts.has(promptId)) return;
    settledPrompts.add(promptId);
    stopPolling(promptId);
    promptNodes.delete(promptId);
    nodePrompts.delete(nodeId);
    forgetPrompt(promptId);

    const state = runStates[nodeId];
    const items = itemsFromRefs(images);
    if (items.length) {
      appendItems(nodeId, items);
      if (state) state.status = "done";
      notifyDone();
    } else if (state) {
      state.status = "error";
      state.error = "工作流没有返回素材";
    }
    setTimeout(() => {
      if (runStates[nodeId]?.status !== "error") delete runStates[nodeId];
    }, 1000);
  }

  async function checkPrompt(nodeId, promptId) {
    if (settledPrompts.has(promptId) || !promptNodes.has(promptId)) return;
    let data = null;
    try {
      const response = await fetch(`/infinite_canvas/api/prompts/${encodeURIComponent(promptId)}`);
      data = await response.json().catch(() => null);
    } catch {
      return;
    }
    if (!data) return;
    if (data.status === "error") {
      failPrompt(nodeId, promptId, data.error);
      return;
    }
    if (data.status !== "done") {
      // 排队中还是执行中由 ComfyUI 队列给出，没开始前不显示假进度
      const state = runStates[nodeId];
      if (state) {
        state.status = data.status === "queued" ? "queued" : "running";
        state.position = Number(data.position) || 0;
      }
      return;
    }
    finishPrompt(nodeId, promptId, data.images || []);
  }

  // 素材还在上传时，下游节点先以 uploading 状态占位；上传落定后由 trackPrompt 接管
  function markUploading(nodeId) {
    runStates[nodeId] = {
      status: "uploading",
      error: "",
      position: 0,
      promptId: "",
      startedAt: Date.now(),
    };
  }

  function clearUploading(nodeId) {
    if (runStates[nodeId]?.status === "uploading") delete runStates[nodeId];
  }

  // 节点是否还在活动：上传素材 / 等上游 / 排队 / 运行 / 刚完成还没同步下游
  const ACTIVE_STATUSES = new Set(["uploading", "waiting", "queued", "running", "done"]);

  function nodeBusy(nodeId) {
    const state = runStates[nodeId];
    if (state && ACTIVE_STATUSES.has(state.status)) return true;
    const node = nodes.value.find((item) => item.id === nodeId);
    if (!node) return false;
    // 没有运行状态但素材还在传，也算没准备好
    return [...(node.data.media || []), ...(node.data.inputMedia || [])].some(
      (item) => item && item.pending && uploadInFlight.has(item.id)
    );
  }

  // 上游还在活动时，下游节点先以 waiting 状态占位，上游结束后再提交
  function markWaiting(nodeId) {
    runStates[nodeId] = {
      status: "waiting",
      error: "",
      position: 0,
      promptId: "",
      startedAt: Date.now(),
    };
  }

  function clearWaiting(nodeId) {
    if (runStates[nodeId]?.status === "waiting") delete runStates[nodeId];
  }

  // 提交成功后先按"排队中"接管，第一次查询会立刻纠正成运行中。
  // startedAt 由调用方给出：刷新后恢复任务时沿用原来的提交时刻，计时不会从头开始
  function trackPrompt(nodeId, promptId, startAt = 0) {
    const startedAt = Number(startAt) || Date.now();
    promptNodes.set(promptId, nodeId);
    nodePrompts.set(nodeId, promptId);
    rememberPrompt(promptId, nodeId, startedAt);
    runStates[nodeId] = {
      status: "queued",
      error: "",
      position: 0,
      // 当前采样节点的真实步数（ComfyUI 的 value / max），没收到进度事件前都是 0
      stepValue: 0,
      stepMax: 0,
      promptId,
      // 从提交开始计时（排队时间也算），界面显示已等/已用时长
      startedAt,
    };
    ensureSocket();

    const timer = setInterval(() => {
      // 超过 30 分钟视为异常，避免无限挂起
      if (Date.now() - startedAt > 30 * 60 * 1000) {
        failPrompt(nodeId, promptId, "等待超时，任务可能仍在执行");
        return;
      }
      checkPrompt(nodeId, promptId);
    }, 2500);
    pollers.set(promptId, timer);

    setTimeout(() => checkPrompt(nodeId, promptId), 800);
  }

  // 重新进入画布后把 ComfyUI 里仍在跑的任务挂回节点：排队/运行中的继续跟进进度，
  // 期间已经跑完的把产物补进节点；ComfyUI 里查不到的（重启过 / 被清理）直接丢弃映射
  async function restoreRunStates() {
    const map = readPromptMap();
    const pending = [];
    let changed = false;
    for (const [promptId, entry] of Object.entries(map)) {
      const startedAt = Number(entry?.startedAt) || 0;
      const valid =
        entry?.scope === runScope &&
        Date.now() - startedAt < RESTORE_MAX_AGE &&
        nodes.value.some((node) => node.id === entry?.nodeId);
      if (!valid) {
        delete map[promptId];
        changed = true;
        continue;
      }
      pending.push([promptId, entry.nodeId, startedAt]);
    }
    if (changed) writePromptMap(map);
    if (!pending.length) return;

    // 先跟 ComfyUI 核对一遍，只恢复它还在跟踪的任务，避免恢复出永远跑不完的假状态
    let known = null;
    try {
      const response = await fetch("/infinite_canvas/api/queue/history?limit=200");
      const data = await response.json();
      known = new Set(
        [...(data.running || []), ...(data.pending || []), ...(data.items || [])].map(
          (item) => item.promptId
        )
      );
    } catch {
      // ComfyUI 连不上时先按队列里的记录恢复，轮询会继续纠错
      known = null;
    }

    for (const [promptId, nodeId, startedAt] of pending) {
      if (known && !known.has(promptId)) {
        forgetPrompt(promptId);
        continue;
      }
      trackPrompt(nodeId, promptId, startedAt);
    }
  }

  // 先清本地状态（同步执行，删除节点时可以立即生效），返回要取消的任务 id
  function clearRunState(nodeId) {
    const state = runStates[nodeId];
    const promptId = state?.promptId || nodePrompts.get(nodeId) || "";
    if (promptId) {
      settledPrompts.add(promptId);
      stopPolling(promptId);
      promptNodes.delete(promptId);
      forgetPrompt(promptId);
    }
    nodePrompts.delete(nodeId);
    delete runStates[nodeId];
    return promptId;
  }

  // 运行中的任务中断执行，排队中的任务移出队列
  async function abortPrompt(nodeId) {
    const promptId = clearRunState(nodeId);
    if (!promptId) return "";
    try {
      const response = await fetch("/infinite_canvas/api/queue/abort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      });
      const data = await response.json().catch(() => null);
      return (data && data.action) || "";
    } catch {
      return "";
    }
  }

  // 日志面板里中断运行中 / 移除排队中的任务后，画布上对应节点的状态要一起复位，
  // 两边是不同的组件，用事件把 prompt id 传过来
  function onQueueAbort(event) {
    const promptId = event.detail?.promptId;
    if (!promptId) return;
    const nodeId = promptNodes.get(promptId);
    if (nodeId) clearRunState(nodeId);
  }
  window.addEventListener("infinite-canvas:queue-abort", onQueueAbort);

  onScopeDispose(() => {
    window.removeEventListener("keydown", onCopyPasteKey);
    window.removeEventListener("keydown", onDeleteKey);
    window.removeEventListener("mousemove", trackConnectPointer);
    window.removeEventListener("touchmove", trackConnectPointer);
    window.removeEventListener("infinite-canvas:queue-abort", onQueueAbort);
    offConnect();
    offConnectStart();
    offConnectEnd();
    offNodeDragStart();
    offNodeDragStop();
    for (const timer of pollers.values()) clearInterval(timer);
    pollers.clear();
    if (socket) socket.close();
  });

  // 编辑产物（裁切 / 扩图 / 宫格）先上传成 input 素材，再作为节点内容
  async function uploadAsset(blob, name) {
    const filename = name || "edit.png";
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    return uploadFile(file, guessKind(filename));
  }

  // 编辑结果覆盖节点里的某张素材：保留原 id，堆叠位置不变
  function replaceMediaItem(nodeId, i, item) {
    const node = nodes.value.find((entry) => entry.id === nodeId);
    if (!node) return false;
    const list = node.data.media || [];
    if (!list[i]) return false;
    node.data.media = list.map((old, k) => (k === i ? { ...item, id: old.id } : old));
    return true;
  }

  // 在源节点旁边建一个不连线的新节点（宫格切分 / 拼接的产物）
  function spawnDetachedNode(sourceId, items = []) {
    const source = nodes.value.find((item) => item.id === sourceId);
    if (!source) return null;

    captureUndo(true);
    const x = Math.round(source.position.x + NODE_WIDTH + 80);
    let y = Math.round(source.position.y);
    // 与已有节点重叠时继续向下排开
    while (
      nodes.value.some(
        (node) => Math.abs(node.position.x - x) < 40 && Math.abs(node.position.y - y) < NODE_HEIGHT
      )
    ) {
      y += NODE_HEIGHT + 40;
    }

    nodeSeq += 1;
    const id = String(nodeSeq);
    nodes.value = [
      ...nodes.value,
      {
        id,
        type: "demo",
        position: { x, y },
        data: { ...baseData(`${nodeSeq}`), media: items, index: 0 },
      },
    ];
    return id;
  }

  // 把节点里的一张素材拖到画布空白处：用这张素材新建一个不连线的节点
  function spawnMediaNodeAt(sourceId, i, clientX, clientY) {
    const source = flow.findNode(sourceId);
    const item = source?.data?.media?.[i];
    if (!source || !item) return null;

    captureUndo(true);
    const point = flow.screenToFlowCoordinate({ x: clientX, y: clientY });
    nodeSeq += 1;
    const id = String(nodeSeq);
    // 同样走增量添加，避免 Vue Flow 因整体替换数组而重建全部图节点
    flow.addNodes([
      {
        id,
        type: "demo",
        position: {
          x: Math.round(point.x - NODE_WIDTH / 2),
          y: Math.round(point.y - NODE_HEIGHT / 2),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          workflow: source.data.workflow || defaultWorkflow(),
          // 素材是复制出来的，id 重新生成，避免和源节点在同一上游上被去重；
          // 还在上传的素材保留原 id，等它上传完再按 id 同步引用
          media: [{ ...item, id: item.pending || !item.ref ? item.id : newId() }],
          index: 0,
        },
      },
    ]);
    fitNodeToFirstImage(id, [item]);
    return id;
  }

  // 从资产库拖进画布：在落点新建一个只带这批素材的节点
  function spawnItemsNodeAt(items, clientX, clientY) {
    if (!items || !items.length) return null;

    captureUndo(true);
    const point = flow.screenToFlowCoordinate({ x: clientX, y: clientY });
    nodeSeq += 1;
    const id = String(nodeSeq);
    // 同样走增量添加，避免 Vue Flow 因整体替换数组而重建全部图节点
    flow.addNodes([
      {
        id,
        type: "demo",
        position: {
          x: Math.round(point.x - NODE_WIDTH / 2),
          y: Math.round(point.y - NODE_HEIGHT / 2),
        },
        data: {
          ...baseData(`${nodeSeq}`),
          media: items,
          index: 0,
        },
      },
    ]);
    // 资产拖进画布：按第一张素材的比例撑开节点
    fitNodeToFirstImage(id, items);
    return id;
  }

  // 划线切断连线：一次断多条算一步撤销
  function cutEdges(ids) {
    if (!ids || !ids.length) return 0;
    captureUndo(true);
    flow.removeEdges(ids);
    return ids.length;
  }

  return {
    nodes,
    edges,
    connectSnap,
    connectedSources,
    connectedTargets,
    boxSelectedIds,
    visibleNodeIds,
    viewport,
    layoutRevision,
    runStates,
    submitExecution,
    trackPrompt,
    restoreRunStates,
    setRunScope,
    abortPrompt,
    onDblClick,
    importMedia,
    appendMedia,
    appendItems,
    spawnChildNode,
    duplicateNode,
    spawnMediaNodeAt,
    spawnItemsNodeAt,
    itemsFromRefs,
    uploadAsset,
    retryUpload,
    waitForUploads,
    markUploading,
    clearUploading,
    markWaiting,
    clearWaiting,
    nodeBusy,
    replaceMediaItem,
    spawnDetachedNode,
    exportCanvas,
    loadCanvas,
    resetCanvas,
    focusNode,
    fitCanvas,
    captureUndo,
    undo,
    cutEdges,
  };
}
