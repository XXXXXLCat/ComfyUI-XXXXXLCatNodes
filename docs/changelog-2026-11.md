# 改造记录（2026-11）

按时间倒序的逐项改造说明与实测数据。使用说明见上级 [README](../../README.md)。

## 素材节点按参考项目高保真改造（2026-11-15 晚）

用户再次要求「参考 `E:\Workspace\Workspace-XXXXXLCatNodes` 的素材图片 / 素材视频 / 素材音频节点，改我们的节点」。这次不是近似，而是按参考项目 `infinite_canvas/frontend` 的源码逐行核对后重写 `js/infcanvas-flow.js` 的 `IcNode`：

| 参考源码 | 照搬的内容 |
|---|---|
| `src/styles/xcat-overrides.css:3091`（`.demo-node`）/ `3844`（`.xcat-node-name`）/ `3867`（`.node-actions`）| 无边框无内边距、圆角 12、无 30px 标题栏；左上角 22px 半透明名称胶囊；节点正上方 hover 单行文字工具行 |
| 同文件 `3105` + ComfyUI `LGraphCanvas.ts`（`NODE_BOX_OUTLINE_COLOR`、`connections_width = 3`）| 选中白色 3px 环（原来是蓝色 1px + 光晕） |
| 同文件 `3237` / `src/components/Node/VideoPlayer.vue`（`.vp-video`）| 媒体 100% 铺满、`object-fit:contain`、`background:#000`、`pointer-events:none`（点击画面不播放、拖节点照常） |
| `public/assets/xcat-media-controls.js`（`mkSlider` / `buildBar`）+ CSS `3674`（`.xcat-mbar` / `.xaw-*`）| 控制条 gap 8 / padding `7 36 8 10` / 20px 按钮 / 时间 22+9+22 右-中-左定宽 / 轨道左右内缩 4.5px、3px 高 / 9px 圆点 / 60px 音量条；进度音量只用 `scaleX` + `translate3d`（亚像素、不触发布局），pointer capture 拖动、方向键 ±2%、ResizeObserver、rAF 每帧、`volumechange` 同步、静音后音量 0 恢复 0.5、整条屏蔽 8 类事件 |
| `public/assets/xcat-audio-wave.js`（`plotBox` / `draw` / `hitHead` / `seekAt`）+ CSS `--xw-*` | 波形圆头竖条、上下留白（top 34–44 / bottom 44–56）、峰值按宽度降采样、已播段蓝 / 未播段灰、播放头只贯穿绘图区且顶部有圆点，hover / 拖动时变成带左右箭头的胶囊；**只有命中播放头（±9px）才可拖**，点波形空白不跳进度；颜色走 `--icw-*` 变量 |
| `README.md:2674`（「节点内强调色 #F2FF59 → #0B8CE9」）+ CSS `4946` | 强调色 `#f2ff59` → **`#0b8ce9`**（按钮 hover、进度填充、圆点、端口、resize 角标） |
| `src/components/Node/index.vue:130`（`.node-upload`）+ CSS `3267` | 空节点整块是点击上传命中区（去掉虚线框），上传后原地变成对应类型节点；hover 工具行「下载 / 删除」 |

配套改动：`data.size[1]` 就是**整个节点的高度**（素材默认 320×180；生成节点现已去掉表单头，与素材统一，见「生成节点改造」）；画布网格层 class 从 `.ic-grid` 改成 `.ic-canvas-grid`，避免与侧栏素材网格的同名规则冲突；`peaksFor()` 增加多订阅者回调，解码完成后所有同 URL 的波形一起重绘。（生成节点也去掉 30px 标题栏后，`freeSpot()` / `revealNode()` / `fitView()` 里按 `role` 加 `TITLE_H` 的分支已一并清除；`core.js` 仅保留 v1 存档坐标迁移用到的 `TITLE_H`。）

**实测（无头 Chrome + CDP 真鼠标，0 JS 异常）**：三类节点 480×270 / 无标题栏 / 名称胶囊 / 媒体或波形 / 控制条齐全，生成节点仍 250×260 带表单头；圆角 12、`padding 7 36 8 10`、`#0b8ce9`、轨道内缩 4.5px、9px 圆点、时间三段右/左对齐；视频播放 1.08s 时 `scaleX(0.2067)` + `translate3d(49.62px)`、时间 `0:01`、暂停图标；拖进度 seek 到 0.76 且节点坐标与视口**完全不变**；静音 / 音量 0.32 / 控制条上双击与滚轮都不弹菜单、不缩放；波形 hover 变 `ew-resize`、拖播放头 seek 到 3.77/5.17、点空白不跳；选中白框 3px、hover 工具行「下载 / 删除」且删除真的移除节点；空节点 `DOM.setFileInputFiles` 真上传 mp4 后原地变成视频节点（5.17s、控制条可用）；适应视图 4 节点全在视口；v2 存档往返尺寸不变；退出画布媒体释放。

迁移前的 `js/infcanvas-flow.js` 与 `js/infcanvas-style.js` 备份在 `.backup/media-2026-11-15/`，若要恢复旧的 LiteGraph 风格标题栏可直接覆盖回来（同时需把 `infcanvas-core.js` 的四处高度分支改回 `+ TITLE_H`）。

## 节点功能按参考项目补齐（2026-11-15 晚 2）

上一节只搬了外观与播放核心，节点 hover 只留了「下载 / 删除」。对照参考项目 `frontend/src/components/Node/NodeActions.vue`、`public/assets/xcat-{image-tools,video-edit,audio-edit,text-edit}.js` 与其 README 里**最终生效**的按类型过滤表，补齐了每个节点自己的功能：

| 节点 | 按钮行（不适用的直接不渲染） |
|---|---|
| 素材图片 | 裁剪 / 宫格 / 镜像 / 调整 / 下载 / 删除 |
| 素材视频 | 提取 / 分离 / 截取 / 抽帧 / 下载 / 删除 |
| 素材音频 | 截取 / 变速 / 下载 / 删除 |
| 素材文本 | 下载 / 删除；**双击进入 Markdown 源码编辑**，平时用宿主 `renderMarkdownToHtml()` 渲染；默认 320×180，内容区顶部预留 38px 让名称胶囊不遮首行 |
| 生成类 / 空节点 | 删除 |

实现路线由用户最终拍板为**对齐参考项目**：视频 / 音频交给后端 FFmpeg，图片仍在浏览器 Canvas；产物格式 PNG / MP4 / M4A，不再输出 WebM / WAV，也不再用 MediaRecorder / WebAudio 导出。详细契约与操作方式见下一节。

- **图片**：Canvas 2D 全分辨率处理，产物走已有 `/api/infcanvas/upload`。裁剪含 12 种比例预设、8 个手柄、框内拖动、全选与方向键微调；宫格 2/3/4/5 带图标预设 + 实时网格线预览、按原图整数边界切片；镜像 5 个带图标按钮悬停预览、**点击即生成**；调整移植 `xcat-image-adjust-core.js` 的 11 项算法（线性光空间 + Float32Array，魔数与运算顺序照抄），512px 实时预览、重置、`+0.45 / −…` 数值显示、应用禁用态、原分辨率导出。
- **后端**：`server_routes.py` 新增 `/api/infcanvas/{audio,video}/process` 与就绪探测 `/api/infcanvas/media/health`；产物直接写进 `input/infcanvas`，返回与 `/api/infcanvas/assets` 同形状的资产描述，前端 `spawnRefs()` 直接建节点，无需二次上传。
- **视频 / 音频**：六个工具只按参考项目的方式收集参数并 POST，处理全部由 FFmpeg 一次转码完成（不再需要等片段播完）。
- **产物定位**：`resultPosition()` → `NS.api.freeSpot()`，保证新节点落在可见区内（Vue Flow 会丢弃视口外节点），原素材不变。

配套修正：

- 弹窗挂在 `#infcanvas-root` 内而不是 `body`（画布模式会隐藏 `body` 下除 root 以外的所有 div），遮罩吞掉指针 / 滚轮 / 双击 / 键盘；`infcanvas-core.js` 的 `onKeyDown` 与双击菜单在 `NS.tools.isOpen()` 时提前返回，弹窗里按 Delete 不会误删节点。
- `NS.flow.updateNodeData()` 把节点数据同时写回**源数组**和 Vue Flow 的 store 副本；组件的 `patch()` 统一走它。这顺手修好了生成节点参数、文本编辑、上传、resize 之前只改副本、存档会丢的 bug。
- `NS.flow.findNode()` 现在代理 Vue Flow 的实时节点，产物定位读的是拖动后的真实坐标。
- 工具行 13px（参考项目在 zoom .7 下实测 11px 不可读）、8px 圆角、`#0b8ce9` 描边；弹窗背景用宿主 `--secondary-background`，**不能用 `--primary-background`（实测它就是强调蓝 `#0b8ce9`）**。
- 文本节点平时用 ComfyUI 自带 `extensionManager.renderMarkdownToHtml()` 渲染（自带净化）；双击节点**任意处**进 textarea，光标落在末尾而非全选，Esc / 失焦 / 外部点击退出并保留文本（对齐参考 `xcat-text-edit.js`，不是「Esc 取消」）。
- **文本节点创建方式**（对齐参考 `xcat-paste.js`）：画布内 `Ctrl/Cmd+V` 粘贴纯文本 → 建一个文本节点（内容写进 `data.text`）；粘贴 / 拖入 `.txt/.md` 等文本文件 → 读内容建同样节点（UTF-8/BOM、UTF-16、GBK 自动识别，中文 ANSI 不乱码）；输入框内粘贴不拦。落点取鼠标最后在画布上的位置，无记录则用可见区中心。媒体文件粘贴 / 拖入仍走上传建对应素材节点。

改动前文件备份在 `.backup/tools-2026-11-15/`；FFmpeg 重写前的备份在 `.backup/ffmpeg-2026-11-15/`。

## FFmpeg 后端 + 原版操作方式（2026-11-15 晚 3）

用户明确要求「还是用 FFmpeg 吧，另外我发现你很多功能是不是乱改？操作方式和原版的完全不一样」。逐行核对参考项目 `frontend/public/assets/xcat-media-core.js`、`xcat-image-tools.js`、`xcat-image-adjust-core.js`、`xcat-video-edit.js`、`xcat-audio-edit.js`、`xcat-text-edit.js` 与 `infinite_canvas/__init__.py` 的 `process_audio` / `process_video`，把上一轮自创的简化交互整体换成参考项目的实际操作方式。

### 后端契约（`server_routes.py`）

| 路由 | 作用 |
|---|---|
| `GET /api/infcanvas/media/health` | 返回 `{ok, ffmpeg, ffprobe, audio, video}`；旧 Python 进程没有此路由，会 404 |
| `POST /api/infcanvas/audio/process` | `{ref, action:"clip"\|"speed", segments?, speed?}` → m4a |
| `POST /api/infcanvas/video/process` | `{ref, action:"extractAudio"\|"separate"\|"trim"\|"frame", start?, end?, frame?, time?}` → m4a / mp4 / png |

- `ffmpeg` / `ffprobe` 用 `shutil.which()`，找不到时回退 `imageio_ffmpeg.get_ffmpeg_exe()`；Windows 传 `CREATE_NO_WINDOW` 避免弹控制台；音频超时 300s、视频 600s。
- 输出参数与参考一致：m4a 用 `aac 192k` / `ipod` / `+faststart`；mp4 用 `libx264 -preset fast -crf 18` + `pad=ceil(iw/2)*2:ceil(ih/2)*2` + `yuv420p` + `aac 192k` / `+faststart`；png 用 `image2 -update 1`。
- 音频截取用 `atrim + concat`（1–64 段）；变速用链式 `atempo`，每级限制 0.5–2，总倍速 0.1–4×；尾帧用 `-sseof -1` 逐帧覆盖同一 PNG。
- `_resolve_media_path()` 禁止 `/`、`\`、`..` 与控制字符，并要求 `commonpath` 落在对应媒体目录内；非法文件名 / 未知 action 均返回 400。
- 返回 `{ok, action, files:[{filename, name, subfolder, type, kind, role, url, duration}]}`，形状与 `upload_asset()` / `list_assets()` 一致，前端可直接建节点。

### 就绪预检与 `apiReady` 门控

- 参考项目用**空 POST** 探测旧后端（会落到静态文件路由返回 text/plain 405/404），但会在控制台留下 400 噪音。本项目改为 `GET /api/infcanvas/media/health`，要求 `content-type` 为 JSON 且 `ok === true`；**失败不缓存**，`probe.invalidate()` 后重启即恢复。
- 弹窗壳维护 `apiReady`，所有渲染通路都 AND 进去：`apply.disabled = !applyEnabled || !apiReady || busy`，对应参考项目的 `run.disabled = !valid() || busy || !apiReady`。这样 `loadedmetadata` 之后触发的 `paint()` / `render()` 不会把未就绪时已禁用的应用按钮重新打开，`setStatus("")` 也不会清掉错误提示。
- 未就绪时：截取 / 剪辑 / 变速三个弹窗显示「请**完全重启 ComfyUI**（只刷新浏览器无效）」横幅、禁用应用按钮、状态栏报错；提取 / 分离 / 抽帧这类**点击即执行**的动作按参考 `guard()` 弹 toast 后关闭进度窗。

### 操作方式逐项对齐

| 工具 | 参考项目的实际操作方式 |
|---|---|
| 提取 / 分离 | 点击即执行，spinner 进度窗（「正在用 FFmpeg 处理…」+ 取消处理），**没有应用按钮** |
| 抽帧 | 按钮旁锚定下拉菜单三选一：抽取当前帧（带时间）/ 首帧 / 尾帧，不是大弹窗 |
| 视频截取 | 视频预览 + 10 张缩略图 + 双手柄时间轴 + 5 格刻度尺 + 起止数字输入 + 选区内播放；方向键微调手柄 |
| 音频截取 | 波形多段剪辑：分割 / 粘合 / 删除 / 撤销 / 重做 / 试听，Ctrl+Z / Ctrl+Y / ←→ / Space，不是简单起止列表 |
| 音频变速 | 0.1×–4× 滑块 + 6 个预设（0.5 / 0.75 / 1 / 1.5 / 2 / 3）+ 数值输入 + 时长预估 |
| 图片裁剪 / 宫格 / 镜像 / 调整 | 见上一节；镜像点击即生成，调整有预览 / 重置 / 应用禁用态 |
| 文本 | 双击任意处进 textarea，光标到末尾，Esc / blur / 外部点击退出并保留文本 |

弹窗框架 `openModal()` 支持 `warn` 横幅、`progress` spinner、`applyLabel: null`（无应用按钮）、`extraFoot[]` 附加按钮、`setApiReady / setWarn / setBusy / setApplyEnabled / setStatus / setProgressText`、`AbortController.signal` 与 `run(ui)` 立即执行；`openMenu(anchor, items)` 提供锚定下拉。所有弹层事件本地吞掉，不与画布的 Delete / 双击 / 滚轮冲突。

### 验收

- Python 与全部 JS 语法检查通过。
- 后端直测（embedded Python 直接调 `process_audio` / `process_video`）：audio clip / speed、video extractAudio / separate / trim / frame first·current·last 共 8 个用例全部 200 并产出 m4a / mp4 / png；非法 action 与非法路径返回 400。
- 临时 ComfyUI 8189（重启过 Python）：CDP 实测按类型按钮行、六个 FFmpeg 工具、图片四工具、文本 Markdown 编辑、真鼠标 / 键盘、抽帧菜单锚定、裁剪框内拖动与手柄缩放、Delete / Esc 隔离。
- 稳定状态干净复检 `problems: 0`；模拟旧后端（health 404）时三个弹窗均显示横幅且应用禁用、点击即执行的动作 toast 后关窗；恢复后端后回归 trim / speed 真实产出节点、零 JS 异常。

⚠️ **Python 新增路由必须完全重启 ComfyUI 才生效**（只刷新浏览器无效）。主实例 8188 未重启时 `/api/infcanvas/media/health` 返回 404，弹窗会显示上述横幅；临时实例 8189 已完整验证。
