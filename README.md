# ComfyUI Infinite Canvas（嵌入式画布模式）

一个 ComfyUI 自定义节点包：在 ComfyUI 顶部增加入口，进入与工作流平级的**无限画布模式**。

**画布引擎是 Vue Flow**（`@vue-flow/core` 1.48），节点是真正的 Vue 组件，媒体是真正的 `<img>/<video>/<audio>`。它不再使用 ComfyUI 的 LiteGraph，也不碰 `app.graph`；ComfyUI 前端没有暴露 `window.Vue`，所以 Vue 3 运行时 + Vue Flow 由本包用 esbuild 打成单个本地 ESM（`js/vendor/vueflow.bundle.mjs`，**不依赖 CDN，离线可用**）。改造前基于 LiteGraph 的实现完整保留在 `.backup/litegraph-2026-11-15/`。

**界面隔离**：画布模式的所有界面（顶部标签栏、左侧栏、划出面板、画布本体、标签右键菜单）都挂在独立的 `#infcanvas-root` 中，它是 `#vue-app` 的兄弟节点；进入画布时 ComfyUI 自身的主界面及其导览遮罩统一隐藏，不注册 ComfyUI sidebar tab。退出后原样恢复。

**布局（覆盖，不挤压）**：`src/components/graph/GraphCanvas.vue` 把 `<canvas id="graph-canvas" class="absolute inset-0 size-full">` 与 `<LiteGraphCanvasSplitterOverlay>` 渲染为平级兄弟；后者根元素是 `pointer-events-none absolute top-0 left-0 z-999 flex size-full`，所以侧栏面板在整个画布之上，画布不参与 splitter 的 flex 布局。实测 1.59.1：打开面板前后 `#graph-canvas` 的 rect 恒为 `(0,0,1584,849)`。本项目照此把 `#infcanvas-stage` 设为绝对定位（左侧对齐 `--sidebar-width`），`#infcanvas-panel` 与 1px 分隔条设为同层绝对定位覆盖；打开/关闭/拖拽面板都不会改变 stage 与 canvas 的 rect、位图尺寸或图坐标。右下角浮动工具栏（`#infcanvas-controls`）与小地图同样绝对定位在 stage 之内、`z-1200` / `z-1000` 覆盖画布，与 `GraphCanvasMenu.vue` 在原生 `#graph-canvas` 之上的关系一致。

**弹窗与提示就是 ComfyUI 自己的**：重命名、保存 / 另存为、删除、关闭未保存画布的确认，以及全部 Toast，都通过扩展 API `app.extensionManager.dialog.prompt / .confirm / .toast` 调起，渲染的是 ComfyUI 的 `GlobalDialog.vue` / `DialogPortal.vue` / `ConfirmationDialogContent.vue` / ToastDock，不是重画的仿制品。样式表把 `DialogPortal` 容器（`.z-overlay`）和 ToastDock（`.z-toast`）放行到画布层之上；进入画布前已打开的 ComfyUI 弹窗会被标记 `data-infcanvas-suppressed` 保持隐藏，退出时移除标记。

> 之所以要处理浮层：ComfyUI / Reka UI 打开模态框时会把 `document.body.style.pointerEvents` 设为 `none`，并铺一层全屏遮罩。若画布层不显式 `pointer-events: auto` 且层级不够，整个画布会「什么都点不了」。现在 `#infcanvas-root` 固定 `pointer-events: auto` / `z-index: 20000`，弹窗 portal 提到 `2147483000`。LiteGraph 的右键菜单同样通过 `body` portal 显示并保留可用。

**视觉对齐**：标签栏、左侧栏与划出面板取自本机 frontend 1.59.1 的源码与真实浏览器 computed style，而不是近似配色；其中侧栏与划出面板**直接复用宿主自己的 class**（`side-tool-bar-container` / `side-bar-button` / `side-bar-panel` / `comfy-vue-side-bar-*` 等），由 ComfyUI 的样式表决定外观，而不是手写等价像素值。本机没有前端源码仓库，源码依据是 `python_embeded/Lib/site-packages/comfyui_frontend_package/static/assets/*.js.map` 内的 `sourcesContent`（原始 `.ts` / `.vue`）、`main-Dim_GrdG.css` 与 `GraphView-CNLIMPxL.css`：

| 部件 | 源码依据 | 对齐值 |
|---|---|---|
| 标签栏 | `src/components/graph/GraphCanvas.vue`（`.workflow-tabs-container`）、`src/components/topbar/WorkflowTabs.vue` | `38px` 高、`--background` 底、`border/50` 下边框、`shadow-md` |
| 画布标签 | `src/components/topbar/WorkflowTab.vue`、`src/components/ui/tabs/tabs.variants.ts` | 满高 `37px`、圆角 `8px`、无边框、`padding 8px 8px 8px 12px`、`font-inter text-sm leading-none font-normal`（14px / 400）、激活 `bg-secondary` + `text-foreground`；文字 `max-w-[150px] truncate`，后接 `size-4 shrink-0` 状态占位，关闭按钮 `absolute right-2 size-4` 压在占位上、不压文字 |
| 标签命名 | `src/platform/workflow/management/stores/workflowStore.ts`（`getUnconflictedPath`）、`src/platform/workflow/core/services/workflowService.ts`（`duplicateWorkflow`） | 基准名 `Unsaved Canva`（对应 ComfyUI 的 `Unsaved Workflow`）；从基准名开始找第一个空闲编号 `(2)`/`(3)`…，关闭标签释放名称，下次新建复用最小空缺；复制去掉尾部编号并由同一逻辑取名 |
| 标签右键菜单 | `src/components/topbar/WorkflowTab.vue`（`contextMenuItems`）、`src/composables/useWorkflowActionsMenu.ts`、`src/components/ui/menu/menuStyles.ts` / `MenuItemContent.vue` / `MenuSeparator.vue` | 重命名 `pi pi-pencil`、复制 `pi pi-copy` ┊ 保存 / 另存为 `pi pi-save` ┊ 关闭标签 `pi pi-times`、关闭左 / 右 / 其他标签（`pi pi-times` + 箭头 overlay 图标）；菜单 `min-w-56`(224px) `rounded-lg p-1`，项 `min-h-8 gap-2 px-3 py-1.5 text-sm`，分隔线 `my-1 h-px bg-border/50`；文案取 `zh/main.json` |
| 左侧栏 | `src/components/sidebar/SideToolbar.vue`、`SidebarIcon.vue`、`SidebarLogoutIcon.vue`、`src/composables/sidebarTabs/use*SidebarTab.ts` | 原生 class 直接复用：`side-tool-bar-container connected-sidebar border-r border-border/50 shadow-md`（`--sidebar-width` = 48 + 4×2 = 56px）、`sidebar-item-group`、`side-bar-button h-(--sidebar-item-height) w-(--sidebar-width) rounded-none p-2 text-xs`、Button `variant=muted-textonly`；hover / `.side-bar-button-selected` 由宿主全局规则提供；图标用 `icon-[comfy--node]` / `icon-[comfy--image-ai-edit]` / `icon-[comfy--workflow]` / `pi pi-sign-out` |
| 划出面板 | `src/components/LiteGraphCanvasSplitterOverlay.vue`（`.side-bar-panel`）、`src/components/sidebar/tabs/SidebarTabTemplate.vue`、`SidebarTabCloseButton.vue` | **宽度瞬时切换**（实测 `transition-duration: 0s`、`getAnimations() == 0`；reka-ui splitter `flex: 20.4 1 0` → 1600px 视口下 311.5px，默认取 312px，可拖拽右边缘调整），**唯一动效**是 `.sidebar-content-container` 的 `transition-opacity duration-200 ease-in-out`；面板 `bg-background` 无边框无阴影；头部 `flex min-h-16 items-center justify-between border-b px-4`（64px）、`truncate font-bold` 16px 标题、关闭按钮 `size-8 rounded-lg` + `icon-[lucide--x] size-4`；内容体 `comfy-vue-side-bar-body scrollbar-custom h-0 grow overflow-x-hidden` |
| 面板拉伸 | `src/components/LiteGraphCanvasSplitterOverlay.vue`（`SplitterResizeHandle`）、`src/components/ui/splitter/SplitterResizeHandle.vue`、`src/composables/usePanelSizing.ts`、`src/utils/splitterPersistence.ts`、reka-ui `calculate.js` | 面板与画布之间的 **1px 分隔条**：`w-px` + `after:w-1`（4px 热区）、`bg-border/50`、hover / 拖拽 `bg-primary`、`cursor-ew-resize`、`touch-action:none`、`role=separator` / `tabindex=0` / `data-state=inactive→hover→drag`；拖拽宽度 1:1 跟手，松开把**像素宽度**写入 `localStorage['InfCanvas.Sidebar.LeftWidth']`（100ms debounce，卸载时 flush）；范围 `312px ~ innerWidth - 侧栏 - 160 - 1`（原生实测 min 311.5 / max 1366.7）；键盘 `←/→` ±10%（Shift 100%）、`Home/End` 到最小/最大 |
| 弹窗 / 提示 | `src/services/dialogService.ts`（`confirm` / `prompt`）、`src/components/dialog/GlobalDialog.vue`、`DialogPortal.vue`、`content/ConfirmationDialogContent.vue`、`content/PromptDialogContent.vue`、`ui/dialog/dialog.variants.ts` | **直接调原生 API**：`rounded-2xl border bg-background shadow-lg`、`sm:max-w-xl`（576px）、`16px` 圆角、标题 16px 加粗、`hint` 带 `pi pi-info-circle`；保存确认用 `type:'dirtyClose'`（保存 / 否 / X 或 Esc → `true/false/null`），删除用 `type:'delete'`（`pi pi-trash` 红色按钮），其余用 `default` |
| 右下角浮动工具栏 | `src/components/graph/GraphCanvasMenu.vue`、`CanvasModeSelector.vue`、`modals/ZoomControlsModal.vue`、`design-system/button.variants.ts` | 容器 `absolute inset-x-0 bottom-0 z-1200 flex` + `ml-auto … floating-panel`（`--radius-xl` 圆角、`--spacing` 内边距、`bg-background`、`--shadow-inset-highlight` 阴影）；按钮直接用 `buttonVariants()` 的 class 串（`relative inline-flex … rounded-md border-none font-inter text-sm font-medium` + `size md` + `bg-secondary … hover:bg-accent`），再按源码覆盖成 `size-8 bg-transparent p-0` / `h-8 w-15`；模式触发器 `rounded-none! … hover:rounded-lg!` + `bg-muted` 图标 chip；分隔线 `h-[27px] w-px self-center bg-border`；激活态用宿主的 `not-active:bg-muted`；图标 `icon-[lucide--focus / map / route-off / chevron-down / mouse-pointer-2 / hand]` |
| 小地图 | `src/components/graph/MiniMap.vue` + `MiniMapPanel.vue`、`src/renderer/extensions/minimap/composables/*`、`minimapCanvasRenderer.ts`、`boundsCalculator.ts` | `absolute right-0 bottom-[54px] z-1000`，容器 `253×200`、`1px var(--border)`、`8px` 圆角、`shadow-md`；顶部 `icon-[lucide--settings-2]` / `icon-[lucide--x]` 两个 `size-8` 按钮 + `top-6 h-px bg-border` 分隔线；节点按 `color-mix(in srgb, var(--primary) 60%, transparent)` 填充（勾选「节点颜色」时改用节点 `bgcolor`），连线 `--muted-foreground` + `lineWidth 0.3` + 圆点，包围盒按 `enforceMinimumBounds(2500, 2000)` 扩展、`scale = min(w/bw, h/bh) × 0.9`；视口框 `2px solid var(--foreground)` + 20% 前景色填充，`translate()` 同步；点击/拖拽居中、滚轮 0.9 / 1.1 缩放 |
| 新建节点定位 | `src/services/litegraphService.ts`（`addNodeOnGraph` / `getCanvasCenter` / `goToNode`）、`src/extensions/core/widgetInputs.ts`（按 `NODE_TITLE_HEIGHT` 向下探测）、`src/lib/litegraph/src/LGraphCanvas.ts`（`boundingRect` = `[x, y - title, w, h + title]`、`animateToBounds` / `centerOnNode`） | 起点取 `ds.visible_area` 中心；重叠判定用含标题栏的 `boundingRect` 矩形（新节点下一次 draw 前 `boundingRect` 还是 0，不能用 `getNodeOnPos`）；行优先、中心 → 右 → 左铺满一行再换行；视口排满后 `revealNode()` 以最小位移平移 `ds.offset`（不改缩放）把新节点带回视口，避免"只在小地图里出现"；侧栏展开时用其覆盖宽度当左边界 |

画布层直接使用 ComfyUI 挂在 `:root` 上的 CSS 变量（`--background` / `--foreground` / `--muted` / `--accent` / `--border` / `--sidebar-*` 等），因此跟随主题变化。`main-Dim_GrdG.css` 定义 `--primary-background: var(--primary)`、`--primary: var(--color-azure-600)`，即蓝色 `#0b8ce9`，**不是面板底色**，不能用于提示框 / 对话框背景。

顶栏右侧在 ComfyUI 源码里是 `src/components/TopMenuSection.vue` 的 `data-testid="top-menu-actionbars"`——浮在画布上方的 `floating-panel`，按钮由 `ActionBarButtons.vue` 以 `h-7 rounded-full` 渲染。画布模式不复制这块内容，标签栏右侧保持与工作流标签栏一致的留白。

**标签行为**（与 ComfyUI 工作流标签一致）：新建第一个画布叫 `Unsaved Canva`，再新建依次 `Unsaved Canva (2)`、`Unsaved Canva (3)`；关闭 `Unsaved Canva` 后再新建**复用** `Unsaved Canva`，而不是继续递增到 `(4)`——因为它取的是当前已存在名称里的最小空缺（`getUnconflictedPath`），不是全局计数器。激活标签不收缩、显示完整名称；非激活标签固定 `160px`、文字 `max-w-150px` 超出显示省略号；关闭按钮排在文字后面的 16px 状态槽上，不与文字重叠。按 ComfyUI 的 `closeButtonVisibility`，激活且无脏点时关闭按钮常显，有脏点时鼠标悬停才切换为关闭按钮。标签右键菜单为：重命名、复制 ┊ 保存、另存为 ┊ 关闭标签、关闭左侧标签、关闭右侧标签、关闭其他标签；`isFirst` / `isLast` 时对应项按源码置灰。

验证环境：ComfyUI 0.45.0 + `comfyui-frontend-package 1.59.1`（Python 3.13 / Windows）+ Vue 3.5.42 + Vue Flow 1.48.2。样式与交互均经真实无头 Chrome（CDP）复测。

## 画布引擎与构建

| 文件 | 作用 |
|---|---|
| `js/infcanvas-flow.js` | Vue Flow 引擎：Vue 应用、`IcNode`（素材/生成节点）、`IcEdge`、小地图、网格背景、视口/节点/连线控制器（`NS.flow`） |
| `server_routes.py` | ComfyUI Python 路由：`/infcanvas/*` 文档与上传、`/api/infcanvas/media/health` 就绪探测、`/api/infcanvas/{audio,video}/process` 两个 FFmpeg 处理端点 |
| `js/infcanvas-core.js` | 文档与标签、后端 (`/infcanvas/*`)、生成流程、节点放置与视口避让、键盘、进入/退出 |
| `js/infcanvas-controls.js` | 右下角浮层工具栏：缩放百分比/弹层、模式、小地图与连线显隐（只做 DOM 与标签，控制 `NS.flow`） |
| `js/infcanvas-tools.js` | 按素材类型的 hover 操作行、参考式弹窗 / 菜单框架、后端就绪预检与产物建节点、图片四工具（裁剪 / 宫格 / 镜像 / 调整）、图像调整算法内核、下载 / 删除 |
| `js/infcanvas-media-tools.js` | 视频（提取 / 分离 / 截取 / 抽帧）与音频（截取 / 变速）工具；操作方式对齐参考项目，处理走 FFmpeg 后端，产物 m4a / mp4 / png |
| `js/infcanvas-ui.js` / `infcanvas-style.js` | 标签栏、侧栏、划出面板、双击节点菜单、宿主 CSS 对齐 |
| `js/vendor/vueflow.bundle.mjs` | 预打包的 Vue 3 + Vue Flow（含基础 CSS 字符串），由扩展以 ESM 相对路径导入；刻意用 `.mjs`，避免被 ComfyUI 的 `extensions/**/*.js` 递归扫描当成扩展入口 |

重建依赖（仅在需要升级 Vue Flow 时）：

```bat
cd tools/vuebuild
npm install
npm run build        :: 产出 js/vendor/vueflow.bundle.mjs
```

节点外观的全部数值集中在 `js/infcanvas-flow.js` 顶部（`SLOT_STEP` / `BAR_H` / `PAD_*` / `VOL_W` / `ACCENT` / `WAVE_*`）与文件内的 `CSS` 模板字符串，改外观只改这两处。素材节点的外观数值来自参考项目 `Workspace-XXXXXLCatNodes/infinite_canvas/frontend`（详见文末「素材节点按参考项目高保真改造」）。

## 功能对照

| 需求 | 实现 |
|---|---|
| 顶部菜单栏入口 | `actionBarButtons` 顶栏按钮 + `View` 菜单命令 + `Ctrl+Shift+I` |
| 画布样式/操作与 ComfyUI 一致 | 画布背景沿用 LiteGraph 的 100×100 网格贴图并按 `zoom` 平铺；交互为 Vue Flow 的 d3-zoom（指针为中心缩放、Ctrl+框选、左键平移、拖拽、连线），选择语义按 `selectionIntent.ts`；右下工具栏 / 小地图 / 标签栏 / 侧栏均不变。**节点**本身按参考项目改成了无标题栏卡片（见下一节），选中环用 ComfyUI 的 `NODE_BOX_OUTLINE_COLOR`(#FFF) 与 `connections_width`(3)，端口 10px `#0b8ce9` |
| 素材节点：图像/视频/音频 | 3 个节点（文本已独立为单独一类），默认 **320×180 是整个节点的高**（统一，最小宽 320）；无标题栏、圆角 12、左上角 22px 名称胶囊、hover 在节点正上方按类型显示**该节点自己的功能按钮行**（图片 6 / 视频 6 / 音频 4 / 文本 2 / 生成与空 1，详见文末）；媒体铺满整张卡片、`contain` 叠 `#1D1D1F` 底且 `pointer-events:none`；空节点整块是点击/拖入上传热区，上传后**原地**变成对应类型节点。视频/音频共用底部 35px 控制条（gap 8 / padding 7 10 8 10 / 20px 按钮 / 时间 22+9+22 定宽 / 3px 轨道内缩 4.5px / 9px 圆点 / 60px 音量条 / `#0b8ce9`），进度与音量用 `scaleX` + `translate3d` 亚像素驱动、pointer capture 拖动、方向键 ±2%、rAF 每帧刷新、整条屏蔽 8 类事件；音频波形照参考画圆头竖条 + 上下对称留白（各 20%）+ 播放头（hover 变可拖胶囊，只有命中播放头才 seek）；文本节点内容区顶部预留 38px 避免名称胶囊遮盖首行；拖入文件自动判定类型、上传并生成对应节点 |
| 文本节点 | 独立 role `text`（既不属于素材也不属于生成），外观沿用素材卡片但**左侧带输入接头、右侧带输出接头**，`role` 独立分组显示在侧栏/双击菜单的「文本节点」栏；默认 320×180；双击编辑 Markdown、粘贴纯文本 / 拖入 txt·md 建节点（详见文本节点改造章节） |
| 生成节点：图像/视频/音频 | 3 个节点；外观与交互已改造为与素材节点一致：**无标题栏、圆角 12、左上名称胶囊、hover 工具行、选中环、四角拉伸、网格吸附**，表单直接放在 body 内并顶部预留 38px 避开胶囊；左侧 4 个输入接头（图像/视频/音频/文本，居中排布）、右侧输出接头；`data.size[1]` 就是整个节点高（不再 +30）；收集连线素材 → 注入 API 工作流模板 → `queuePrompt` → 轮询 history → 结果回贴为素材节点并连线 |
| 画布自己的左侧栏 | `#infcanvas-sidebar`：4 个按钮，直接带 ComfyUI 原生的 `side-tool-bar-container` / `side-bar-button` class 与图标，由宿主样式表渲染；DOM 完全独立，不注册 ComfyUI sidebar tab、不改动其侧栏状态 |
| 左侧栏 1：退出画布 | 点击直接返回 ComfyUI，不划出面板；不触发 ComfyUI 的任何 sidebar tab |
| 左侧栏 2：新建节点 | 点击划出面板（默认宽度 312px、瞬时展开、内容 200ms 淡入），列出 7 类节点；拖拽面板右边缘的 1px 分隔条可调整宽度，宽度会被记住 |
| 左侧栏 3：资产库 | 划出面板，列出 `input/infcanvas` 与 `output` 媒体文件，可点击/拖拽入画布 |
| 左侧栏 4：画布 | 划出面板，已保存画布列表，新建/打开/删除；再次点击同一按钮收起 |
| 画布自己的顶部标签栏 | `#infcanvas-tabbar`（高度 `--workflow-tabs-height`），显示画布标签；命名按 `getUnconflictedPath` 复用最小空缺编号；点击切换、中键/× 关闭、+ 新建；右键菜单 8 项（重命名/复制/保存/另存为/关闭标签/关闭左侧/关闭右侧/关闭其他）含图标与分隔线。与 ComfyUI 工作流标签栏互不共用 DOM |
| 保存/关闭逻辑与工作流一致 | 脏标记、Ctrl+S、关闭前保存确认、3 秒防抖自动保存、另存为、多标签视口独立记忆 |
| 右下角浮动工具栏 | `#infcanvas-controls`：画布模式（选择 / 抓手，即 Vue Flow 的 `pan-on-drag`）下拉、缩放至全部节点、缩放百分比 + 弹层（放大 / 缩小 / 缩放到适合，按住连发 100ms；百分比输入框）、小地图开关、连线显隐；层级 `z-1200` 覆盖画布，不改变 stage 尺寸。**缩放范围 10% – 1000%**：上限同时写在 `js/infcanvas-flow.js` 的 `MAX_ZOOM`（作为 Vue Flow 的 `max-zoom`，否则 d3-zoom 会按库默认值 2 把滚轮卡在 200%）与 `js/infcanvas-controls.js` 的 `MAX_SCALE`，与百分比输入框的 `aria-valuemax=1000` 一致；输入超限值时失焦回写实际值 |
| 画布操作（选择模式） | **对齐 `Comfy.Canvas.NavigationMode = 'legacy'`（Drag Navigation，本机实测值）**：legacy 下左键拖空白 = **平移画布**、**Ctrl / Cmd + 左键拖 = 框选**（`LGraphCanvas.ts:2826` 只有 `ctrlOrMeta` 才启动 `_setupNodeSelectionDrag`）；本机实测该设置为 `legacy`，画布配置固定按 legacy；若把宿主切成 `standard`，需同步把 `pan-on-drag` 改为 `[1]`、`selection-key-code` 改为 `true`。框选相交即选（`selection-mode="partial"`，对应 `_getItemsInRect` 的 `overlapBounding`）。左键拖节点 = 移动（多选整组一起动）；**单击节点 = 替换选中**，**Shift / Ctrl / Meta + 单击 = 加选 / 减选** —— 这两条由 `@node-click` 按 `selectionIntent.ts` 的 `resolveClickSelection` 接管，并在 `pointerdown` 捕获阶段先存选择快照（Vue Flow 内置的 `handleNodeClick` 在 emit 之前就已 toggle）。Vue Flow 多选时盖在节点上的 `.vue-flow__nodesselection-rect` 已设 `pointer-events:none`（否则单击/加选全部被吞）。点空白 = 清空；`Delete` 删除。框选开关是 `selection-key-code` —— **Vue Flow 1.48 没有 `selectionOnDrag` prop** |
| 画布操作（抓手模式） | ComfyUI 的 read-only 画布：左键拖空白**和拖节点都是平移画布**（节点不移动），`nodes-draggable` / `elements-selectable` / `nodes-connectable` / `edges-updatable` 全部关闭，`Delete` 被拦下，双击空白不弹节点菜单（源码依据 `LGraphCanvas.ts:2843` 在 `read_only` 时提前 return）。已知差异：原生在只读下仍允许 Ctrl+拖框选（`ctrlOrMeta` 分支在 `read_only` 之前），这里一并禁用 |
| 适应视图 | 对齐 `Comfy.Canvas.FitView` → `fitViewToSelectionAnimated()` → `DragAndScale.animateToBounds()`：有选中就只适配选中、否则全部节点；填充比 `zoom=0.75`；每轴除以 `max(bounds, 300)` 避免小节点被放大到上限；350ms 缓动；只适配**可见**区域（左侧面板覆盖的宽度算作遮挡，同 `visibleCanvasViewport()`） |
| 小地图 | 253×200 面板（`@vue-flow/minimap`），节点按 `#4a9eff` 填充，视口框 2px 高亮描边，跟随缩放平移；可点击 / 拖拽导航、滚轮缩放；可见性记在 `localStorage['InfCanvas.MinimapVisible']`，首次进入沿用 ComfyUI 的 `Comfy.Minimap.Visible`。**与旧版差异**：不再提供「节点颜色 / 显示连线 / 显示分组」三项勾选（LiteGraph 专属设置） |
| 旧画布兼容 | 存档升级为 `version: 2`（`engine: "vueflow"`，`nodes/edges/viewport`）。读取 `version: 1` 的 LiteGraph 存档时自动迁移：`node.pos`（主体左上角）整体下移 30px、`links` 按目标槽位映射到 `image/video/audio/text` 端口、`offset/scale` 换成 `x/y/zoom`，素材与生成参数原样保留 |

## 安装

1. 确认 ComfyUI 前端 ≥ 1.53（本包按 1.59.1 实测）。
2. 在 `ComfyUI/custom_nodes/` 下建立目录联接到本仓库（目录名必须是合法 Python 标识符）：

```bat
mklink /J "E:\Comfy-Org\ComfyUI-Main\ComfyUI\custom_nodes\ComfyUI_InfiniteCanvas" "E:\Workspace\Workspace-Infinite-Canvas"
```

也可以直接运行 `tools\install.bat [custom_nodes路径]`。
3. 重启 ComfyUI。启动日志出现 `[InfCanvas] 9 HTTP routes registered` 即后端就绪。
4. 顶栏出现「无限画布」按钮；`View` 菜单也有同名命令。

卸载：删除该目录联接即可，包内数据另外存放在 `user/default/infinite_canvas/canvases/` 与 `input/infcanvas/`。

## 使用

1. 点击顶栏「无限画布」进入画布模式；ComfyUI 界面整体隐藏，出现画布自己的左侧栏（4 个按钮）与顶部画布标签栏。再次按 `Ctrl+Shift+I` 也可退出。
2. **新建节点**：点击左侧第 2 个按钮划出侧栏，选择 7 类节点之一；或直接把媒体文件拖到画布上自动生成素材节点。新节点落在**当前可见区域的中心**（源码依据 `litegraphService.ts` 的 `getCanvasCenter()` → `ds.visible_area`），若该位置已被占用则沿 `LiteGraph.NODE_TITLE_HEIGHT` 向下探测（源码依据 `widgetInputs.ts`）；先横向填满一行（中心 → 右 → 左），一行满了再换下一行。视口被填满后继续往下排，并**自动平移视图把新节点带回可见范围**（`revealNode()`，最小位移、不改变缩放；ComfyUI 的 `goToNode` 用 `canvas.animateToBounds` 做同类事情）。节点矩形按 `boundingRect` 计算（含标题栏），所以连续新建既不重叠、也不会只出现在小地图里；侧栏展开时节点还会避开侧栏覆盖的区域。侧栏右边缘可拖拽调整宽度（与 ComfyUI 的 splitter 一致），关闭、重开或刷新后保持该宽度。
3. **素材节点预览与播放**：图像、视频、音频节点把媒体铺满整张 480×270 卡片（等比 `contain`，多余区域为黑底），左上角半透明胶囊显示素材名；hover 节点时上方出现该类型专属的一排功能按钮（图片：裁剪 / 宫格 / 镜像 / 调整 / 下载 / 删除；视频：提取 / 分离 / 截取 / 抽帧 / 下载 / 删除；音频：截取 / 变速 / 下载 / 删除；文本：下载 / 删除，双击进入 Markdown 编辑；生成与空节点：删除）。空节点点整块区域即可选文件上传，上传后原地变成对应类型，不会多建一个节点。图片工具在浏览器内用 Canvas 处理、产物经 `/infcanvas/upload` 落盘；视频 / 音频工具走 Python FFmpeg 后端，后端直接写盘并返回资产描述（详见文末「FFmpeg 后端 + 原版操作方式」）。两类产物都在原节点右侧生成新节点，原素材保留。视频与音频底部有一条统一控制条：播放 / 暂停、`当前时间 / 总长`、可拖的进度条（也可聚焦后按方向键 ±2%）、静音、音量条；音频节点另画真实波形（解码后取峰值包络，已播段变蓝），播放头 hover 会变成带左右箭头的可拖胶囊，只有按住播放头才能 seek，点波形空白不会跳进度。控制条整条屏蔽指针 / 滚轮 / 双击事件，拖滑块既不移动节点、也不缩放画布、也不弹双击菜单；点其它区域仍然是拖动节点。
4. **连线**：素材节点的「素材」输出连到生成节点的「图像/视频/音频/文本素材」输入。生成节点填提示词、模板、seed 等参数后点「运行生成」。
5. **生成结果**：任务完成后自动在生成节点右侧创建一个素材节点，并连到生成节点的「结果」输出；资产库也会刷新。
6. **保存**：`Ctrl+S`；未命名画布会询问名称。关闭标签或退出画布时若有未保存更改会弹出确认。
7. **回到 ComfyUI**：左侧栏第 1 个按钮；有未保存更改时同样先确认。
8. **右下角工具栏**：与 ComfyUI 画布右下角一致。左侧下拉切换「选择 / 抓手」：选择模式下**左键拖空白平移画布、Ctrl+拖框选**、左键拖节点移动、单击选中、Shift/Ctrl+单击加选；抓手模式下左键一律平移（含拖节点），不能选、不能拖、不能连、不能删，双击也不弹节点菜单。准星图标把**选中**节点（无选中则全部节点）缩放到视口，填充 75% 并带 350ms 缓动；百分比按钮弹出放大 / 缩小 / 缩放到适合与百分比输入框，按住放大 / 缩小会连发；地图图标显示 / 隐藏小地图（点击拖拽小地图可跳转视图，滚轮缩放）；最后一个图标切换节点连线显隐。这些开关只作用于画布模式，不会改动 ComfyUI 工作流自身的显示设置。

### 与 ComfyUI 工作流联动

包内提供 V3 节点 `InfCanvas.AssetLoader`（分类 `infinite_canvas`）：把资产路径（如 `infcanvas/photo.png`，相对 `input/`）填入该节点，即可输出 `IMAGE` 与 `PATH` 供普通工作流使用。生成结果位于 `output/` 时，可先在资产库查看，再拖入画布上传一份到 `input/infcanvas/` 后使用。

## 生成模板

`workflows/*.json` 是 **API 格式 prompt**（不是 UI 工作流 JSON），由后端 `/api/infcanvas/workflow` 提供给前端。

- `image.json`：内置可用的默认文生图模板（CheckpointLoaderSimple → KSampler → VAEDecode → SaveImage）。若连线了图像素材，会自动改为 `LoadImage → VAEEncode` 图生图。
- `video.json` / `audio.json`：**需自行配置**。用 ComfyUI 导出 API 格式 JSON 覆盖对应文件即可；文件里 `_requires_config: true` 时，运行节点会提示配置而不是静默失败。

可用占位符：`{{prompt}}`、`{{negative}}`、`{{text}}`、`{{seed}}`、`{{steps}}`、`{{width}}`、`{{height}}`、`{{checkpoint}}`、`{{prefix}}`、`{{image}}`、`{{video}}`、`{{audio}}`。数值占位符在模板中写成 `"{{seed}}"` 即会替换为数字；素材占位符替换为相对 `input/` 的文件名。

> 视频 / 音频生成依赖你本机安装的对应节点或 API 节点。本包不绑定具体模型，避免硬编码不可用工作流。

## HTTP 路由

| 路由 | 用途 |
|---|---|
| `GET /api/infcanvas/health` | 健康检查 |
| `GET/POST/DELETE /api/infcanvas/canvas` | 读取 / 保存 / 删除画布 JSON |
| `GET /api/infcanvas/canvases` | 已保存画布列表 |
| `POST /api/infcanvas/upload` | 上传素材到 `input/infcanvas/` |
| `GET /api/infcanvas/assets` | 素材列表（`input/infcanvas` + `output`）|
| `GET /api/infcanvas/workflows`、`/workflow` | 生成模板列表 / 内容 |

所有文件名经白名单校验，路径限制在 ComfyUI 的 `input` / `output` / `user` 目录内；上传限制 200 MB 与媒体扩展名白名单。

## 已知限制

- 画布是独立的 Vue Flow DOM 渲染（`js/vendor/vueflow.bundle.mjs`），不再使用 LiteGraph 实例，也不改 `app.graph`。画布背景仍是 LiteGraph 的 100×100 网格贴图，所以观感与 ComfyUI 的经典画布保持一致。
- 8 类画布节点只存在于画布自己的 Vue Flow store；不注册 ComfyUI 节点类型，主工作流的节点库/搜索不会出现它们。
- 画布模式下 ComfyUI 的顶栏、工作流标签栏、侧栏与图一起隐藏；ComfyUI 的全局菜单、设置、队列等入口需退出画布后使用，这是刻意的界面隔离。
- 隐藏 ComfyUI 界面用的是 `visibility: hidden`（不改动布局尺寸与状态）。例外是 `DialogPortal`（`.z-overlay`）与 ToastDock（`.z-toast`），它们被放行并提到画布层之上，因为画布的提示与保存确认/命名输入调的是 ComfyUI 原生 API；进入画布前已打开的弹窗保持隐藏，退出后全部原样恢复。
- `output` 目录里的图像素材不能直接作为 `LoadImage` 输入，需先拖入画布重新上传一份到 `input/infcanvas/`。
- 生成任务是异步轮询 `/history`，默认最长等待 6 分钟。

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
