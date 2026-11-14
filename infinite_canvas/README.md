# ComfyUI-Infinite-Canvas

> **Vendored copy.** This directory is the runtime part of
> [ComfyUI-Infinite-Canvas](https://github.com/YangShu2103/ComfyUI-Infinite-Canvas)
> (MIT © 2026 YangShu2103), shipped inside ComfyUI-XXXXXLCatNodes.
> Local changes: the floating entry button was removed (the entry now sits in the
> menu bar — see the parent package's `web/monitor.js` and `web/infinite_canvas.js`);
> `frontend/dist` is kept and the Vue sources / build config are dropped.
> Everything else, including the `/infinite_canvas/*` routes and the data
> directory, is unchanged. See `LICENSE` in this folder for the upstream license.

## 本地改动（升级上游时需要重新套用）

画布内的界面做了十五处调整，都不涉及业务逻辑：

1. 右下角的圆形菜单改成**左侧栏底部**的一项「亮色 / 暗色」（不再用红色）；
   「退出画布」移到**侧栏最顶部、提示词上方**，文字与图标按主题取 `--foreground`：暗色纯白 `#ffffff`、亮色近黑 `#09090a`（亮色栏底浅，纯白看不见）。
2. 「释放显存」按钮去掉。
3. 右上角的「提示词 / 资产库 / 日志」三个胶囊改成 **ComfyUI 同款左侧栏**。
4. 「画布管理」「资产管理」「工作流配置」三项从**底部工具条搬到左侧栏**，
   与上面的面板类入口用细线分组；「亮色 / 暗色」从侧栏项移到栏底菜单（见第 1 条）；
   「退出画布」在侧栏最上方，不参与分组。
5. **底部工具条改成画布右下角的浮动面板**，结构与图标照 ComfyUI 的
   `GraphCanvasMenu.vue` + `CanvasModeSelector.vue`：模式选择（选择 / 拖拽）、
   适应视图、缩放控制（含放大 / 缩小 / 适应 / 百分比输入）、网格吸附、隐藏连接线。
   原底栏的「聚焦节点」已删除（用途与适应视图重叠）。
6. 左侧栏、它展开的面板、底部工具条的**配色整体改用 ComfyUI 的语义色**
   （画布原来的偏蓝紫 `--c-*` 令牌 + 柠檬黄强调色在本区域被重映射）。
7. **顶部加了一条画布切换条**，形态照 ComfyUI 的顶部工作流标签（`WorkflowTabs.vue` /
   `WorkflowTab.vue`）：当前画布高亮、未保存时带圆点、末尾一个「+」新建画布。
   它**只显示已打开的画布**（open-tabs 模型），每个标签右侧都带一个 × 关闭按钮
   （照 ComfyUI `WorkflowTab.vue` 的 close-button：当前标签无脏标记时常显、有脏标记或非当前标签 hover 才显）；
   没有任何已打开画布时显示单个 `Unsaved Canvas` 标签。打开资产管理 / 工作流配置弹窗时，
   这条栏和画布一起被遮罩压暗且不可点（画布管理已是贴栏侧滑面板，不带遮罩，见第 21 条）。
8. **画布背景对齐 ComfyUI**：底色 + 10px 细线格 / 100px 强调线，取代原来几乎看不见的
   20px 点阵；真源与数值见下节「画布背景：抄 ComfyUI 调色板」。
9. **左侧栏图标统一换成 lucide**：原来混着上游 Infinite Canvas 手写 SVG 与本包补丁
   手写 SVG，现在 9 枚全部从 ComfyUI 前端包的 `icon-[lucide--*]` 解出真实 path；
   映射与例外见下节「左侧栏图标：统一 lucide」。
10. **面板内图标统一换成 lucide**：侧栏展开的面板 / 浮动窗口 / 画布管理卡片 /
    工作流列表里的 12 枚手写 SVG，以及顶部标签栏的实心「+」，全部换成同一前端包
    解出的 lucide，保留原有尺寸与位置；映射见下节「面板内图标统一 lucide」。
11. **三个贴栏面板补齐顶部留白**：提示词 / 资产库 / 任务队列的标题原本紧贴顶部
    画布标签栏、下面第一行内容又直接压在 header 分隔线上；现在按官方
    `SidebarTabTemplate.vue` 的 `min-h-16`(64px) 与 `pt-2`(8px) 对齐，
    见下节「面板顶部留白：对齐官方侧栏 header」。
12. **标题文字大小照「画廊」/ 官方 Tab**：面板标题 13px/600 → **16px/700**；
    资产库「全部 / 图片 / 视频 / 音频」11px 药丸 → **14px / 32px / 8px 圆角 /
    无边框** 的官方 Tab 规格，见下节「标题文字大小：照画廊 / 官方 Tab」。
13. **边距与间距对齐画廊 / 官方 4px 网格**：水平边距 12px → **16px**（`px-4`），
    header 与所有内容块左边缘统一在 72px；header gap、分类行上下、页脚上下统一
    **8px**，空态 16px、卡片圆角 8px，见下节「边距与间距」。
14. **补回面板滚动条**：上游全局 `*{scrollbar-width:none}` 把滑块藏了（能滚但看不见）。
    现在提示词 / 资产库 / 任务队列 + 三个浮窗都按官方 `.scrollbar-custom` 补回
    10px 轨道 + 6px 圆角滑块，见下节「面板滚动条：照 ComfyUI 的 scrollbar-custom」。
15. **三个弹窗的内容区按 ComfyUI 模板对话框 / 资产浏览器重排**：之前只对齐了外框，
    里面还是上游那套 10–13px 混排、10/12/14px 圆角、彩色描边。现在内容容器
    `px-6 / pb-10`、过滤条 `px-6 / pb-4`、按钮 `h-8 + rounded-lg + text-xs`、
    输入 `h-9`、Tag `h-6 + rounded-sm`、左栏 `14rem` + `bg-card` + NavItem
    （`px-4 py-3 text-sm rounded-md`）、右面板 `w-72`、网格 `minmax(15rem)` /
    `minmax(min(240px,30vw))`（媒体网格下限后来收到 160，见第 19 条）、卡片 `rounded-lg | rounded-2xl + p-2`、
    空态 40px 图标 + 18px/14px 文案；弹窗上限补成 `max-w-[1400px] / max-h-[80vh]`。
    数值出处与前后对照见下节「三个弹窗的内容区：照模板对话框 / 资产浏览器」。
16. **字体统一成 ComfyUI 的 Inter**：上游 `body` 是 `-apple-system / Segoe UI` 系统栈，
    iframe 里又拿不到主页面已加载的字体，所以和主界面并排看不是一套字。现在按官方
    **同名**注册 `@font-face`（`/fonts/inter-latin-normal.woff2` + italic），
    `html, body` 改 `"XCat Inter", Inter, Arial, sans-serif`，并补 `textarea` / `select`
    的字体继承。详见下节「字体：与 ComfyUI 同一套 Inter」。
17. **资产管理按官方三列骨架重排**：上游是「一条横跨全宽的过滤条 + 下面 flex 三栏」，
    左右两栏被压在条下面、起点比中列低一整行。现在 `.am` 改
    `grid-template-columns: 224px / 1fr / 288px`，`.am-body` 用 `display:contents`
    把三栏提成网格项，`.am-bar` 只占中列第一行；`.float-window` 改 flex 列让内容区
    吃满「弹窗高 − 72px」（原来 `.am` 只有 330px，可用 448px）；搜索框用 `order`
    从动作组末尾提到最左。**2026-11-12 又按用户给的参考图把整条工具带搬成通栏顶栏
    （左栏色块满铺、标题压在上面），搜索 / 刷新 / 批量管理全部上顶栏，详见第 26 条。**
18. **input / output 换成切换按钮、去掉左栏折叠按钮**：
    分段本来挤在中列工具条最左，后来挪进左栏，最终按需求放**标题栏**（第 26 条改成
    顶栏里、左栏色块外的网格左缘）。
    样式三次迭代：官方 `Tabs`（两个透明底文字，暗面 active 的
    `bg-secondary` 压在 `--background` 上几乎同色，看上去就是标题右边多了两个灰字）
    → 官方 ToggleGroup 方角货 → **胶囊切换按钮**（用户给参考图定稿）：一条
    `--cg-input`(#313235) 全圆角槽（`padding:2px / gap:2px`，28px 高），槽内
    选中的那块是 `--cg-bg`(#171718) 胶囊 + 前景字，未选中只有 `--cg-muted-fg`
    灰字；亮面槽 `--cg-muted`(#d9d9d9)、选中块回到 `--cg-bg`(#f3f3f3)。
    DOM 上它仍挂在 `.am-side` 里（vnode 不再动），靠
    `.am-side{position:static}` + `position:absolute; top:26px; left:248px`
    （= (80−28)/2 与 224+24）浮在顶栏、网格左缘对齐处，因此 `.float-body`
    与 `.am-side` 都要放开 `overflow`。
    折叠按钮 `.am-side-toggle` 整段删除，随之清掉 `.am:has(.am-side.is-collapsed)`
    与 `.am-side.is-collapsed` 三条样式。vnode 结构那一轮改过（`bde91b6e` →
    `f914d6cf`），此后的位置 / 样式调整都是纯 CSS。
19. **缩略图收小 + 预览锁成正方形**：中间网格列下限 240 → **160**（中列 ~790px
    可用宽下 3 列 267px → 4 列 199px）；右侧预览原先是 `flex:1 1 58%` 撑出的
    256×181 长方形，现在 `.am-preview` 改 `flex:0 0 auto`、`.am-preview-body`
    锁 `aspect-ratio:1/1`，省下的高度还给提示词区（`flex:1 1 auto`）。
20. **预览放大 + 去掉右侧那条 10px 空隙**：右面板 288 → **352px**，预览内边距
    16 → 12，正方形从 256 长到 **328**（`width:min(100%,46vh)` 给矮窗口兜底）；
    提示词区左右内边距也收到 12px，与预览左边缘对齐。另外 `.float-body` 早先
    被塞进了滚动条规则组（带 `scrollbar-gutter:stable`），内容区改 `overflow:hidden`
    之后它仍占着 10px，弹窗最右边就多出一条竖条 —— 已从规则组移除并显式
    `scrollbar-gutter:auto`，`.am` 宽从 1388 回到 1398，与内容区等宽。

21. **画布管理改成贴栏侧滑面板（不再弹窗）**：外壳从 `.float-window` + `.float-mask`
    改造成与「提示词」同款 —— 紧贴左侧竖栏右边（x=57）、通高（y=38 → 底）、
    `--cg-bg` 同底色、右边线 1px `--cg-line`、`--cg-shadow`；标题栏 64px /
    `padding:0 16px` / 标题 16px 700 / 1px 下划线。数值不是估的：8199 实测
    提示词面板 360×912 @ (57,38)、`.lib-head` 64、首块内容 y=102，画布管理面板
    现在逐项相同（实测同样是 360×912 / head 64 / `.cm` 从 102 起）。
    两条必须：① `.float-mask{display:none}` —— 侧滑面板不该挡画布，也和提示词一致；
    ② `width/height` 得 `!important` —— 上游组件把尺寸写成内联
    `:style="{width:90vw,height:80vh}"`，内联优先于普通声明。
    内容也跟着改了格局：15rem 卡片网格 → 两行清单项（第 1 行名称 + 复制 / 改名 /
    删除三枚图标，第 2 行「节点数·时间 + 复选框」），`Infinite_canvas` 徽章藏掉；
    360px 宽里网格只会剩一列、每格还占 168px 高，一屏看不了几个。
    交互：bundle 里这个侧栏按钮原本是「只置真」（`Ul("canvas")`），再点一次没反应，
    改成 `Ja("canvas")?Qa("canvas"):Ul("canvas")`，和提示词 / 资产库一样点两次开合；
    栏内高亮用 `#app:has(.float-window .cm) .lib-tab[title="画布管理"]` 反推
    ——**不能写 `:has(.float-window:has(.cm))`**，规范禁止 `:has` 套 `:has`，
    Chrome 会把整条判为无效选择器（踩过）。

22. **画布管理归入侧栏上面那组（挪分组细线，不挪按钮）**：它已经是贴栏面板，
    却还留在分割线下面和两个弹窗（资产管理 / 工作流配置）同组，归类不对。
    细线是 `.library-tabs` 里的静态 vnode `f("span",{class:"xcat-rail-sep"},null,-1)`，
    把它从「画布管理」**前**移到「资产管理」**前**即可，按钮顺序与 children 数量
    都不变（pure move，`delta=+0 bytes`，不涉及 patchFlag）：
    `退出画布 | 提示词 资产库 日志 画布管理 ┃ 资产管理 工作流配置`。
    脚本 `.workbuddy/tmp/patch/patch_rail_sep.py`（幂等，备份
    `index-BXU58XDe.rail-sep.bak.js`）。分隔线样式 `margin:6px 0` 与位置无关，
    CSS 只改了注释。

23. **画布管理面板头部：去掉「已保存」与 ×，「删除所选」占 × 的位置**：
    `.cm-bar`（`header` + `.cm-state` + `.cm-bar-right`）整行改成
    `position:absolute; top:16px; right:16px`（16 = (64−32)/2，标题栏 64px；
    right 16 与标题左内距对称），`.cm-state{display:none}`、`.float-close{display:none}`。
    因为按钮仍挂在 `.float-body`（`.cm` 的祖先）里，`.float-body` 必须
    `overflow:visible`，否则浮上去的按钮被整块裁掉 —— 和之前分段浮标题栏同一个坑；
    滚动改由 `.cm-list` 自己承担。头部行移出文档流后 `.cm` 的 `padding-top` 从 8 → 0、
    `gap` 8 → 0，`.cm-list` 自己补 `padding:8px 0 0`（列表 y=102 起，卡片 110）。
    另外补 `.cm-btn:disabled`（透明底 + `--cg-muted-fg` + `opacity:.55`）：按钮现在
    常驻标题栏，没勾选时若不压一下会落到 `.cm-btn` 的 secondary 底、看着像能点。
    关闭方式：再点一次栏内「画布管理」（同提示词 / 资产库）或 Esc。

24. **侧栏入口改名「画布」+ 与面板 tab 互斥**：`LibraryDock` 里那一项的
    `title` 与 `.xcat-tab-label` 文字都由「画布管理」改成「画布」（面板标题仍是
    「画布管理」，没动）。连带把栏内高亮选择器
    `[title="画布管理"]` 改成 `[title="画布"]`。
    同时修一个交互 bug：画布管理打开时点「提示词 / 资产库 / 日志」它不会关
    —— 这三个 tab 走的是 `xp()` 的 `toggle(o)`，跟画布那套 `Ja/Qa/Ul` 是两个
    独立状态。三个 handler 改成切面板前先 `Ja("canvas")&&Qa("canvas")`。
    反向原本就是对的（画布按钮先 `xcatCloseDock()`）。脚本
    `.workbuddy/tmp/patch/patch_rail_name_close.py`（幂等，备份
    `index-BXU58XDe.rail-name.rail-close.bak.js`），`delta=+83 bytes`。

25. **提示词输入卡片：上面补分隔线、下面那条去掉**：上游 `.lib-compose`
    （提示词面板底部那张「未命名 / 输入要收藏的提示词… / 收藏」卡片）完全没有边界，
    列表最后一张卡直接顶着输入卡片，层级看不出来。给 `.lib-compose` 补
    `border-top:1px solid var(--cg-line)` + `padding-top:8px`（线画在通宽容器自身上，
    所以和 `.lib-head` 的 `border-b`、原 `.lib-foot` 的 `border-t` 一样通到面板左右边缘；
    8px 与 `.lib-foot` 的 `padding-top` 同一节奏）。同时用户要求卡片**下面**那条不要了，
    用相邻兄弟 `#app .library-dock .lib-compose + .lib-foot{border-top:0}` 精准命中
    提示词面板的 footer —— 资产库 / 任务队列的 footer 没有 `.lib-compose` 前邻，
    顶线保持不动（实测 `提示词 footBorderTop=0px none`、`资产库/日志=1px solid`）。
    结果：分隔线只在输入卡片上方一条，卡片不再被上下两条线夹住。
    列表高度由 601 → 592（线 1px + 上间距 8px 从列表让出），卡片 rect 不变
    327×112 @ (73,703)，只是整体下移 9px；对比图
    `.workbuddy/tmp/patch/compose_line_compare.png`（暗/亮 × 前/后）。

26. **资产管理改成参考图的「满铺左栏 + 通栏顶栏」**（纯 CSS，用户给参考图）：

    - **左栏色块满铺**：`.float-window:has(.am) .float-body{position:absolute;inset:0}`
      把内容区顶到窗口顶边（原来排在 72px 高的标题栏下面，左栏色块上沿露出一条
      `--background`）；`.am` 行改 `80px minmax(0,1fr)`，`.am-side` 仍跨
      `1/1/3/2` → 色块从窗口顶铺到底。左栏 `padding-top:92`（= 顶栏 80 + 12），
      分类列表与网格第一行卡片同基线（实测都在 y=188）。
    - **标题压到色块上**：`.float-head` 改绝对定位浮层（`inset:0 0 auto 0`、
      高 80、`pointer-events:none`、`z-index:4`），`.float-title` 左 24 / 垂直居中，
      `.float-close` 右 16 / top 24 / 32×32。
    - **刷新 / 批量管理 / 搜索上顶栏**：`.am-bar` 从「中列第一行」改成
      `grid-area:1/2/2/4`（跨中栏+右栏，因为搜索框要伸到右栏上方），
      `padding:0 64px 0 24px`、`gap:8`；`.am-search` 改用 `margin-left:auto`
      靠右 + `flex:0 1 464px`，`.am-btn` 跟在后面，关闭按钮在最右。
    - **删掉「N / N 个素材」计数**：`.am-bar .am-total{display:none}`。
    - **删掉「文件类型」小标题**：`.am-side-title{display:none}`。
    - **input / output 移出色块**：`.am-side > .am-tabs` 从 `top:-50/left:100`
      改 `top:26px / left:248px` —— 槽左缘正好压在网格第一张卡的左缘上
      （实测槽 x=324、卡片 x=324）。
    - **右栏让出顶栏**：`.am-right` 由 `1/3/3/4` 改 `2/3/3/4`，否则它把顶栏
      右半条整个盖住（现象很坑：「刷新 / 批量管理」`getBoundingClientRect` 明明
      有值、`visibility:visible`，截图里就是不显示）；底色同时改 `transparent`，
      与中栏同底（参考图右栏没有独立色块）。
    - 列表项 `.am-cat` 行高 1.2 → 1.4（项高 41 → 44）、圆角 6 → 8；网格
      `padding:12px 24px 24px`（顶部 12 与左栏分类同一基线，底部 40 → 24）。
    - 实测（1500×950）：`side[76,96,224,758]`（窗口 95→855，满铺）、
      `bar[300,96,1124,80]`、`search[760,118,464,36]`、
      刷新 `[1232,120,48,32]`、批量管理 `[1288,120,72,32]`、关闭 `[1376,120,32,32]`；
      批量管理模式下 5 个按钮（全选 / 删除 / 下载 / 刷新 / 退出管理）也放得下，
      搜索框自动收缩；1280×800 窗口不换行、不重叠。

27. **工作流配置用同一套「满铺左栏 + 通栏顶栏」**（纯 CSS）：

    - **左栏色块通高**：`.wf-left` 从「0 内边距的 flex 项 + 里面一张 `.wf-block`
      卡片」改成**整栏色块** —— `padding:92px 12px 12px`（顶部 92 = 顶栏 80 + 12）、
      `background:var(--cg-secondary)`、`gap:12`，窗口顶边一路铺到底
      （`[76,96,224,758]`，与资产管理的 `.am-side` 完全同一档）。
    - **`.wf-block` 不再是卡片**：底色已由整栏承担，块本身 `padding/border/
      border-radius` 全部归零、`background:transparent`，只留分组语义；
      `.wf-left .wf-label` 补 `padding:0 12px 8px`，小标题与列表项文字同一左缘
      （x=100，标题 `float-title` 也是 100）。
    - **内容区顶到窗口顶边**：`.float-window:has(.wf-config) .float-body`
      `position:absolute;inset:0`；`.float-head` 改绝对定位浮层（`inset:0 0 auto 0`、
      高 80、`pointer-events:none`、`z-index:4`），`.float-title` 左 24 / 垂直居中，
      `.float-close` 右 16 / top 24 / 32×32。`.wf-config` 的 `padding` 由
      `0 24px 40px` 改 `0`、`gap` 16 → **0**（栏间距离交给右栏的 padding-left），
      右栏自己 `padding:92px 24px 24px`。
    - **四边对齐**（相对窗口内边，单位 px）：内容左 **248**（= 左栏 224 + 24）、
      右 **24**、顶 **92**（= 顶栏 80 + 12）、底 **24**，与资产管理的网格
      （`248 / 24 / 92 / 24`）逐个相同；左栏色块内 `padding:92px 12px 12px`，
      列表项左右各 12（宽 200，原来只有 180 —— 见下条 gutter）。
    - **`.wf-left` / `.wf-list` 的 `scrollbar-gutter` 要改回 `auto`**：文件末尾
      「弹窗滚动容器」那段给它们统一写了 `stable`，没溢出时也各留 10px，
      两层叠起来右侧就比左侧多 20px，左栏看着「左窄右宽」。那条规则在文件末尾、
      特异性相同，所以用 `#app .float-window:has(.wf-config) .wf-left/.wf-list`
      抬一层覆盖（`auto` 只在真溢出时才占宽）。资产管理的 `.am-side-inner`
      同一个坑（胶囊 190 / 容器 200，左 12 右 22），一并改成 `auto` ——
      现在两栏的导航项都是 `l=12 / w=200`，左右各 12。
    - **「保存配置 / 重命名 / 删除」上提到顶栏**、排在关闭按钮左侧 —— 与资产管理的
      「刷新 / 批量管理」同一个位置。`.wf-right` 上游就是 `position:relative`，
      绝对定位以它的 padding box 为参照，所以 `top:24` 与 32px 关闭按钮同高、
      `right:60` = 关闭 32 + 右 16 + 间距 12。头卡 `.wf-head` 里因此只剩工作流名与副标题。
    - **左栏列表项不再显示「N 个节点」**：`.wf-item-meta{display:none}`，
      `.wf-item-name` 补 `flex:1 1 auto; min-width:0` + 单行 ellipsis（名字占满整行）；
      名字节点同时带上 `title`（`f("span",{class:"wf-item-name",title:ze.name},…)`），
      截断时 hover 能看到全名。
    - **右侧新增「重命名」**（这条动了后端）：`infinite_canvas/__init__.py` 加
      `POST /infinite_canvas/api/workflows/{name}/rename`，body `{"name": 新名}` ——
      `os.replace` 改 json、同名的 `.fields.json` 跟着改名、`canvas_settings.json` 的
      `workflow_order` 就地换名（不把工作流踢到末尾）；重名 409、空名 400、源不存在 404、
      新名与旧名相同直接成功。只改文件名不动内容，所以列表里的「更新时间」不变。
      前端由 `.workbuddy/tmp/patch/patch_wf_rename.py` 注入（幂等，备份
      `index-BXU58XDe.wfrename.bak.js`，`delta=+1672 bytes`）：setup 里加
      `xcatRenameWorkflow()`，模板 `.wf-actions` 里插一枚 `class="wf-rename"` 按钮
      （`key:2`，排在「保存配置」与「删除」之间）。弹层是**原生 DOM**（不经过 Vue）：
      320 宽卡片 + 标题 + 输入框（预填当前名、自动聚焦全选）+ 取消 / 确定，
      Enter 提交、Esc 关闭、点遮罩关闭；成功后 `V(新名)` 再 `B()` 刷新列表。
      样式在 CSS 里用 `.xcat-rn-*`（不带 `.wf-` 前缀，因为它不在组件模板里）。
    - 实测（1500×950，窗口 `[75,95,1350,760]`）：`left[76,96,224,758]`、
      `right[300,96,1124,758]`、`wf-head[340,188,1060,62]`、
      `preview[340,262,1060,568]`、列表项 `[88,221,200,33]`（左右各 12）；
      左栏小标题与右栏头卡同为 y=188 起。1200×760 / 1280×800 与亮面均正常，
      切到资产库 / 资产管理再切回来布局不丢。改名链路实测：`xcat_rn_test` →
      `xcat_rn_renamed` 后头卡与列表同步、弹层三种关闭方式都正常；
      后端 curl 覆盖 200 / 400 / 404 / 409 与 `.fields.json`、`workflow_order` 迁移。

28. **删除唯一打开的画布后，顶部条补出 Unsaved Canvas 标签**：现象是删掉那个
    唯一打开的已保存画布后，顶部标签条一条都不剩（既没有 Unsaved，也没有别的），
    画布区留在空白而无法命名 / 保存。根因是两个状态没对上：
    ① store 的 `remove()` 删到当前画布时只做 `resetCanvas()` + `currentId=""`，
    **不动 `window.__xcatOpenTabs`**，被删 id 一直留在数组里；
    ② `sync()` 渲染时 `id===""` 的 Unsaved 标签在 `realOpen.length>0` 时被跳过，
    而残留的 id 又因为 `list` 里找不到而被跳过 —— 两边都不画，标签条就空了。
    三处补丁（`patch_tabs_del.py`，幂等，备份 `.deltab.bak.js`）：
    A. `remove()` 末尾 `__xcatPruneTabs(O)`，且若已无真实标签把数组重置为 `[""]`；
    B. `sync()` 先 `filter(id => id==="" || list 里有它)`，任何路径的残留 id 都不留空栏；
    C. `sync()` 里 Unsaved 的隐藏条件加 `qt.currentId.value!==""` —— 当前停在 Unsaved
    时（删掉当前画布后就是这样）即使还有别的标签也显示它，保证总有 active 标签。
    实测：删唯一画布 → `openTabs:[""]`、标签条 `[Unsaved Canvas(active)]`；
    两个标签时删当前 → `[Unsaved Canvas(active), 另一个]`，被删 id 已出数组；
    切标签、`+` 新建、`×` 关闭均正常。

29. **连线中点补一个圆点，点它断开这条线**：圆点半径 5、线色实心、随缩放变，
   `zoom<0.6` 隐藏 —— 全部照 ComfyUI `pathRenderer.drawCenterMarker()` 的源码；
   点击走 `flow.removeEdges([id])`，与 Delete 删边同一条 action（自动存盘生效）。
   hover 命中圆 ⇒ 镂空成**圆环**（外径不变、中间挖黑孔）；上游那个悬停就冒出来、
   hover 变红的 `.edge-delete`（18px 圆 + 红叉）整块隐藏。
   实现是新文件 `assets/xcat-edge-mid.js` + `xcat-overrides.css` 里的
   `.xcat-edge-mid` / `.xcat-edge-mid-hit` 几条规则，详见下节「连线中点圆点」。

30. **框选键改回 `Ctrl + 拖`、剪线只认 `Alt + 拖`**（bundle 两处）：上游把
   `Ctrl` 和 `Alt` 都当剪线套索，早先只能让框选退到 `Shift`。现在
   剪线入口 `me()` 只判断 `altKey`；框选后来整层改成自管
   （`assets/xcat-marquee.js`，Vue Flow 内部框选关掉），语义照 ComfyUI。
   详见「选择 / 拖拽 的功能语义」与「框选照 ComfyUI」两节。

31. **一个节点只对应一个素材 / 一对节点只能连一条线**（bundle 九处）：
   `appendMedia` / `appendItems` 从「往后追加数组」改成「只留一个」（拖到已有素材的
   节点上 = 替换）；空白处一次拖入多个文件 = 每个文件建一个节点、横向排开
   （间距 `节点宽 + 48`，注意要先把基准点换算成画布坐标再加偏移，否则会跟着
   zoom 一起缩水）；`addEdge` 入口按**无序点对**去重。详见下节同名小节。

32. **顶部操作按钮按素材类型出现**（bundle 一处 + 新增 `xcatFanActions()`）：
   裁切 / 扩图 / 宫格只在 `kind === "image"` 时渲染，下载要有当前素材，全部下载要
   ≥2 个素材；无素材的节点只剩「预览」一枚（删除节点由
   `xcat-node-actionbar.js` 追加在行末）。   面板左侧工具列共用同一份过滤结果。
   详见「操作按钮按素材类型出现」节。

33. **拖进来的素材节点不再挂生成参数**（bundle 七处 + 两段 CSS）：上游 `baseData()`
   给每个新节点都塞 `workflow = 默认工作流`，于是「拖一张图进画布」得到的节点也带
   提示词框、高宽比 / 百万像素参数和「运行」按钮。现在建素材节点时 `workflow = ""`，
   面板里的提示词 / 参数网格 / 运行行只在 `data.workflow` 非空时渲染（`xcatIsGen()`），
   面板宽度跟着收缩成一条素材条。详见「素材节点 vs 生成节点」节。

改动集中在五个文件：

| 文件 | 改动 |
| --- | --- |
| `__init__.py`（子包后端） | 新增 `POST /infinite_canvas/api/workflows/{name}/rename`：`os.replace` 改 json、`.fields.json` 跟着改名、`canvas_settings.json` 的 `workflow_order` 就地换名；重名 409 / 空名 400 / 源不存在 404 |
| `frontend/dist/index.html` | 多引一个 `<link>` 指向 `assets/xcat-overrides.css`；再引 `xcat-edge-mid.js`（正文里的 `#xcat-link-halo` 滤镜也在这里） |
| `frontend/dist/assets/xcat-edge-mid.js` | 新增文件：给每条边插中点一个实心 `<circle>` + 一个 r=10 的透明命中圆（命中圆叠在上面，hover 时圆点 `.is-hot` 镂空成圆环）、`cx/cy = path.getPointAtLength(len/2)`、`zoom<0.6` 隐藏、点击 `removeEdges` 断开；边是「一条一个 svg」，必须全局按 `data-id` 遍历，另加 500ms 兜底轮询补首次渲染漏掉的边 |
| `frontend/dist/assets/xcat-overrides.css` | 新增文件：`--cg-*` 的 ComfyUI 语义色、侧栏尺度变量、`.library-dock` 左侧通高栏、`.canvas-menu` 沉到底部、栏底主题项的双图标 / 双文案按 `html[data-theme]` 显隐、分组细线、面板内 `--c-*` 令牌重映射、右下角工具条与两个弹层、`html.xcat-links-hidden`、`@font-face` 按官方同名注册 Inter（normal + italic，另留 `"XCat Inter"` 别名）+ `html,body` 全量 Inter 栈 + `#app textarea/select` 字体继承、资产管理右侧预览区等比完整显示（`.am-preview-body img/video` 绝对定位铺满 + `width/height:100%` + `object-fit:contain`，修上游 `max-height:100%` 在 grid auto 行里失效、竖向图片/视频只按宽度撑开被裁的问题；`.am-preview-tools` 补 `z-index:2`）、面板滚动条（`.lib-list` / `.asset-grid` / `.am-grid`，以及弹窗内的 `.cm-list` / `.am-side-inner` / `.am-prompt-body` / `.wf-left` / `.wf-list`：`scrollbar-width:auto` 复位全局 none + `::-webkit-scrollbar` 10px 轨道 / 6px 圆角滑块 / 隐藏 button / `background-clip:padding-box`，`--cg-scroll` 暗 `--muted` 亮 `--border`；配合 `overflow-x:hidden`、`scrollbar-gutter:stable`（**不含 `.float-body`**：它已不滚动，留着 gutter 会在弹窗右侧空出 10px））、画布底色 `--c-bg` 按 ComfyUI dark/light
   调色板改 `#222222` / `#dddddd`、主题项双图标显隐选择器泛化成 `#app .xcat-ico-*` / `#app .xcat-lbl-*`（按钮已从 `.lib-tab` 移到 `.cm-item`）、`xcat-canvas-hand` 只读模式（节点 / 边 / handle 的 `pointer-events:none` 与 grab/grabbing 光标）、非只读 pane 的 default / crosshair 光标、`.tb-mi:focus-visible`、`.xcat-exit-tab` 文字与 svg 按 `var(--cg-fg)` 取色（暗白亮黑，hover 不回落）、`--xcat-rail-icon: 19.2px`（官方 `1.2em`）、`.xcat-tab-label` 按官方 `side-bar-button-label` 的 10px / leading-none / text-center / w-max / max-width 52px / line-clamp-2 / whitespace-normal、`.library-tabs` padding 改 `4px 0`、`.lib-head` 改官方 `min-h-16` 64px 垂直居中 + `.library-panel > .lib-head + *` 补 `pt-2` 8px（三面板顶部留白）、`.lib-title` 16px/700、`.lib-cats` gap 8px + wrap、`.lib-cat` 按官方 Tab 改 14px / 32px / 10px / 8px / 无边框 / shrink-0、⑪ 六类内容块（`.lib-cats` / `.lib-list` / `.asset-grid` / `.lib-compose` / `.lib-foot` / `.lib-head`）水平边距统一 `px-4` 16px、header gap 与块间距统一 8px（4px 网格）、空态 16px / 更多 8px、`.asset-cell` 圆角 8px、三个弹窗的内容区按模板对话框 / 资产浏览器重排（容器 `px-6 pb-10`、按钮 `h-8 rounded-lg text-xs`、输入 `h-9`、左栏 224px + NavItem、右面板 352px、网格 `minmax(15rem)` / `minmax(min(240px,30vw))`、卡片 `rounded-lg p-2`、空态 40px mask 图标、弹窗 `max-width:1400px`、标题栏 `border-bottom:0`；亮面按钮 / 当前卡底改 `--muted` 并用 `:not()` 排除 `inverted` / `destructive`，详见下节）；画布管理贴栏侧滑面板（`.float-mask:has(+ .float-window .cm)` 隐藏遮罩、`.float-window:has(.cm)` 固定定位 57/38→底 + `min(360px,40vw)` + 64px 头 + 无圆角右边线、`.cm` 两行清单项 `.cm-card` 的 grid 重排与 `.cm-card-meta` 跨两列、`.cm-brand` 隐藏、栏内高亮 `#app:has(.float-window .cm) .lib-tab[title="画布管理"]`、亮面 `.cm-card.is-current` 用 `--cg-muted`、头部 `.cm-bar` 绝对定位浮到标题栏右侧 + `.cm-state` 与 `.float-close` 隐藏 + `.cm-btn:disabled` 弱化、`.float-body` 改 `overflow:visible`） |
| `frontend/dist/assets/index-*.js` | 三十处，注释 `xcat:` 可搜的几处：① `.cm-pop` 的渲染条件 `o.value?` 改成 `!0?`（菜单常驻）；② 菜单里「亮色模式」按钮改为放进 `.cm-pop`（2026-11-12 起是该菜单唯一一项）；③ 菜单里「释放显存」按钮置空；④「退出画布」去掉 `is-danger` 类，之后又整体移出 `.cm-pop`（见㉑）；⑤ `TM()` 里把 Vue Flow 实例挂到 `window.__xcatFlow`；⑥ 底栏组件 `bk` 整段重写（保留 `__name: "index"` 与 `emits`，图标 SVG 用 lucide 的 path；2026-11-12 又按 ComfyUI `read_only` 语义重写了选择 / 拖拽接线：V/H/空格、菜单 aria、只读光标类，详见「选择 / 拖拽 的功能语义」）；⑦ 底栏删掉「聚焦节点」「工作流配置」两个按钮。另十三处无注释：⑧ `LibraryDock` 的 setup 取 `close` 与 `qa().toggleTheme`，在 `.library-tabs` 末尾追加分组细线 + 画布管理 / 资产管理 / 工作流 / 亮色模式四个按钮；⑨⑩ 底栏删掉画布管理、资产管理、亮色模式三个按钮（连同末尾的分隔符）；⑪ 三处 `width:"92vw",height:"86vh"` → `90vw` / `80vh`；⑫ 浮窗组件 `WS` 的根改成 `[div.float-mask, div.float-window]` Fragment 并补 `aria-modal`（弹窗遮罩）；⑬ App 的 setup 里追加顶部画布切换条（`onMounted` 里插 DOM + `watch` 同步，见下节）；⑭ 在 ⑬ 基础上重做（详见下节「顶部画布切换条」）：store 注入 `saveAsNew` / `duplicate` / `resetToUnsaved` 三方法，并把 `open` / `create` / `remove` 接到 `window.__xcatOpenTabs`（**open-tabs 模型**）。**Unsaved Canvas 用 `id=""` 作为常驻标签始终排在首位**——打开 / 新建画布只会往后面追加，不会把它挤掉；关闭掉最后一个真实画布后它自动回到首位（保证至少 1 个标签）。顶部条**每个标签（含 Unsaved）都带 × 关闭按钮**：关闭图标严格照 ComfyUI `WorkflowTab.vue` 用 `lucide--x`（16px、`right-2`/`size-4`、`top-50%` 垂直居中、`text-muted-foreground`），可见性规则＝当前且无脏标记常显、其余（含当前脏）hover 显；末尾「＋」新建按钮 2026-11-12 起改用 ComfyUI 前端包的 `lucide--plus` 细线加号（原先照 `WorkflowTabs.vue` 用 PrimeIcons `pi-plus` 实心加号，为与侧栏 / 面板图标统一已换，见㉔）。画布管理面板恢复为上游**卡片网格**（`.cm-list` 仍是 `grid; minmax(214px,1fr)`），卡片右上角内联 **复制 / 编辑名称 / 删除** 三枚 `.cm-icon` 按钮（`duplicate` 从 `canvasStore` 注入 `CanvasManager` 的 setup）；头部「新建画布」按钮与自定义右击菜单（`.xcat-cm-menu`）已删除，新建只走顶部标签栏「+」（`bootstrap` 无画布时默认进 Unsaved Canvas；`window` 上挂 `keydown` 捕获 Ctrl/Cmd+S 保存，有 `currentId` 走 `saveNow`、否则 `saveAsNew`）。所有新代码集中在旧顶部条注入块 `const canvasTabBusy=te(!1);` 到 `canvasTabsSync()});` 这一段，store 注入在 `w.value=!0}}const q=F=>` 之前，可用注释 `xcat:` 检索；⑮-⑳ 画布背景与栏底主题：`qa()` 把 `canvasGridColor` 换成 ComfyUI 调色板线色并新增 `canvasGridMajorColor`，App setup 解构后者；主画布 `<Background>` 由 20px 点阵换成两层 `variant:"lines"`（`gap:10` / `gap:100`，强调层传 `id:"xcat-major"` 避免 pattern id 撞车），工作流预览小画布同样换 10px 线格；`.library-tabs` 里的主题按钮连同 分组细线删除，按钮移进 `CanvasMenu` 的 `.cm-pop`、排在「退出画布」之前（复用 setup 里已有的 `u()` → `toggleTheme`）；㉑ **退出画布挪到侧栏顶部**：`CanvasMenu` 的 `.cm-pop` 里删掉该 `cm-item` 及 setup 里的 `c()`，在 `LibraryDock` 的 `.library-tabs` 首位插入 `.lib-tab.xcat-exit-tab`（沿用原退出 svg；`onClick` 内联 `window.self!==window.top` → postMessage / `history.back()` / `/`），CSS 按 `var(--cg-fg)` 给文字与 svg 取色（暗白亮黑）；㉒ 侧栏 9 枚图标全换 lucide，由 `.workbuddy/tmp/patch_rail_lucide.py` 解 ComfyUI 前端包 CSS 的 `--svg` 后按按钮顺序替换（保留 `xcat-ico-sun` / `xcat-ico-moon` 的 class）；㉓ `.library-tabs` 的 7 个 `On(" 文字 ",-1)` 裸文本节点换成 `f("span",{class:"xcat-tab-label"},"文字",-1)`，让字号 / 行高 / 换行 / 居中能单独按官方设置；㉔ 面板内 12 枚 `f("svg")` 整体换成 lucide（保留 width/height/class/-1，`viewBox` 统一 24、`stroke` 由 data URI 的 black 改 `currentColor`），顶部标签栏 `innerHTML` 的实心「+」换 `lucide--plus`，由 `.workbuddy/tmp/patch_panel_lucide.py` 完成；㉕ `AssetManager` 的 input/output 分段 `f("div",GS,...)` 整体从 `.am-bar` 移到 `.am-side` 首子节点（「文件类型」上方）、左栏折叠按钮 `f("button",{class:"am-side-toggle"...})` 整段删除（`a` 仍是 `te(!0)`、`.am-side` 的 `is-collapsed` 判断保留但恒 false），并把手改过的 aside children patchFlag 由 `2`(CLASS) 降为 `0`(全量 diff) 防优化跳过，；㉖ 画布管理侧栏按钮的 onClick 由 `xcatCloseDock(),Ul("canvas")` 改成 `xcatCloseDock(),Ja("canvas")?Qa("canvas"):Ul("canvas")`（再点一次关闭，与其它 tab 一致），由 `.workbuddy/tmp/patch/patch_cm_toggle.py` 完成；㉗ `.library-tabs` 的分组细线 `f("span",{class:"xcat-rail-sep"},null,-1)` 从「画布管理」前移到「资产管理」前（画布管理归入上面那组贴栏面板），由 `.workbuddy/tmp/patch/patch_rail_sep.py` 完成；㉘ 侧栏那一项的 `title` 与 `.xcat-tab-label` 文字「画布管理」→「画布」，且「提示词 / 资产库 / 日志」三个 tab 的 onClick 改成切换前先 `Ja("canvas")&&Qa("canvas")`（画布面板开着时点面板 tab 会自动关掉），由 `.workbuddy/tmp/patch/patch_rail_name_close.py` 完成由 `.workbuddy/tmp/patch_tabs_to_rail.py` 完成；㉙ `WorkflowConfig` 加重命名：setup 里注入 `xcatRenameWorkflow()`（原生 DOM 弹层 + `POST /workflows/{name}/rename`），`.wf-actions` 里插 `class="wf-rename"` 按钮（`key:2`，夹在「保存配置」与「删除」之间），由 `.workbuddy/tmp/patch/patch_wf_rename.py` 完成（备份 `index-BXU58XDe.wfrename.bak.js`）；㉚ **删除画布后顶部条不出 Unsaved Canvas 的修复**（三处）：store 的 `remove` 末尾补 `window.__xcatPruneTabs(O)`，并在已无真实标签时把 `__xcatOpenTabs` 重置为 `[""]`；顶部条 `sync()` 渲染前先过滤掉 list 里已不存在的 id（`filter(id => id==="" || list 里有它)`），别处删除也不留空标签栏；`sync()` 里 Unsaved 的隐藏条件补上 `qt.currentId.value!==""`（当前就停在 Unsaved 时，即使还有别的标签也把它显示出来，避免"没有任何 active 标签"）。由 `.workbuddy/tmp/patch/patch_tabs_del.py` 完成（幂等，备份 `index-BXU58XDe.deltab.bak.js`） |

### 画布背景：抄 ComfyUI 调色板

真源全部来自 ComfyUI 前端包的 sourcemap（`*.js.map` 的 `sourcesContent`），不是照截图猜：

- `src/assets/palettes/{dark,light}.json` → `colors.litegraph_base.BACKGROUND_IMAGE`
  （100×100 平铺 PNG / GIF）与 `CLEAR_BACKGROUND_COLOR`
- `src/services/colorPaletteService.ts` → `loadLiteGraphColorPalette()` 把两者交给 litegraph
- `coreSettings.ts` → `Comfy.ColorPalette` 默认值 `'dark'`，所以 dark 是默认画布

把 `BACKGROUND_IMAGE` 解码放大 4 倍逐像素看过：**100px 块内每 10px 一条 1px 细线，
块边缘（每 100px）一条更深的强调线 —— 是线格，不是点阵。**

| 主题 | 底色 | 10px 细线 | 100px 强调线 |
| --- | --- | --- | --- |
| dark | `#222222` | `#191919` | `#141414` |
| light | `#dddddd` | `#e6e6e6` | `#ebebeb` |

本包是 Vue Flow 不是 litegraph，所以用两层 `<Background variant="lines">`（`gap:10` /
`gap:100`，强调层传 `id:"xcat-major"` 避免两个 pattern id 撞车）复刻；`scaledGap = gap × zoom`，
网格和 litegraph 一样随缩放 / 平移。线色由 `qa()` 的 `canvasGridColor` /
`canvasGridMajorColor` 两个 computed 按主题返回，底色由 `xcat-overrides.css` 覆盖 `--c-bg`
（上游 `body{background:var(--c-bg)}` 是画布唯一底色来源，侧栏 / 面板用 `--cg-*`，不受影响）。

**升级上游 dist 或 `npm run build` 后要照这张表重做**：JS 的两层 Background + 两个线色
computed、CSS 的两条 `--c-bg` 覆盖，缺一都会退回原来的 20px 点阵或错色。

### 字体：与 ComfyUI 同一套 Inter

ComfyUI 的 UI 字体不是系统字体栈，是真·Inter：

```css
/* main-*.css */
@font-face { font-family: Inter; src: url(../fonts/inter-latin-normal.woff2) format("woff2");
             font-weight: 100 900; font-style: normal; font-display: swap; }
@font-face { font-family: Inter; src: url(../fonts/inter-latin-italic.woff2) format("woff2");
             font-weight: 100 900; font-style: italic; font-display: swap; }
body { font-family: Inter, Arial, sans-serif; }
```

字体文件在 `comfyui_frontend_package/static/fonts/`，由 `server.py` 的
`web.static('/', self.web_root)` 直接挂在根路由，所以 `/fonts/inter-latin-normal.woff2`
可以直取（实测 200，72920 字节）。

**iframe 是独立文档，主页面已经加载的字体在里面不存在**，所以本包必须自己再声明一遍
`@font-face`，否则写 `font-family: Inter` 只会静默回落到 Arial。上游 dist 的 body 原本是

```css
font-family: -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif;
```

在 Windows 上落到 Segoe UI，和主界面并排看就是"不是一套字"（同一串
`Wm 123 ABC xyz 字体测试` 在 20px / 500 下量宽：Inter 244.08px vs Segoe UI 236.68px，
差 3%，字距和字母形态都能看出来）。

落地方式（`xcat-overrides.css`）：

| 项 | 做法 |
| --- | --- |
| `@font-face` | 按**官方同名 `Inter`** 注册 normal + italic（同一份 woff2），另保留 `"XCat Inter"` 作侧栏令牌 `--xcat-rail-font` 的别名 |
| 根元素 | `html, body { font-family: "XCat Inter", Inter, Arial, sans-serif }`，与官方 `Inter, Arial, sans-serif` 同一顺序 |
| 表单控件 | 上游只 reset 了 `button,input{font:inherit}`，补 `#app textarea, #app select { font-family: inherit }` |

顺带修好一处旧遗漏：dist 里本来就有两处写死 `font-family: Inter, Arial, sans-serif`
（顶部画布切换条、保存工作流弹窗），以前因为 `Inter` 这个名字没注册，一直在走 Arial，
现在才真的命中字体。

**字号刻意没有对齐**：官方 body 不设 `font-size`（默认 16px），本包沿用上游的 13px 基准
（大量节点 / 右键菜单按 13px 排版，改根字号会整体放大）。面板与三个弹窗内的关键文字
都显式写了 14px / 12px，与官方的 `text-sm` / `text-xs` 一致。

**验证方法**：`file://` 下测不了（`/fonts/...` 会变成 `file:///fonts/...`），要起一个
模拟 ComfyUI 根路由的临时 http（`/fonts/` + `/app/assets/`），然后看 `document.fonts`
里 `Inter` 这张 face 的 `status` 是不是 `loaded`，再用 canvas `measureText` 对比
Inter 与 Arial 的宽度是否不同（相同就说明回落了）。

### 左侧栏的尺度与配色从哪来

不是目测的，取自 ComfyUI 前端包本身：

- 组件源码：`comfyui_frontend_package/static/assets/GraphView-*.js.map` 里的
  `src/components/sidebar/SidebarIcon.vue`、`SideToolbar.vue`、`tabs/SidebarTabTemplate.vue`，
  以及 `packages/design-system/src/button.variants.ts`。
- 变量定义：同目录 `main-*.css` 的 `:root`（调色板 `charcoal-*` / `smoke-*` 与语义变量）。
- 颜色：语义变量 + 用 CDP 在运行中的实例上读了一遍 `getComputedStyle` 复核。

| 项 | ComfyUI | 本包 |
| --- | --- | --- |
| 栏宽 | `--sidebar-width` = 48 + 4×2 = **56px** | 56px |
| 项高 | `--sidebar-item-height` = **56px** | 56px |
| 图标字号 | `--sidebar-icon-size` = 1rem = **16px**（`.side-bar-button-icon` 的 font-size） | 16px |
| 图标实际尺寸 | `icon-[lucide--*]` / `icon-[comfy--*]` 的 `width:1.2em;height:1.2em` → **19.2px**（实测 19.1875px）；只有 PrimeIcons 是 16px | 19.2px |
| 标签 | 独立 span：`text-2xs` **10px** + `leading-none` + `text-center` + `w-max` + `max-w-[52px]` + `line-clamp-2` | `.xcat-tab-label`，10px / line-height 1 / 居中 / 两行截断 |
| 图标与标签间距 | `gap-2` = **8px** | 8px |
| 按钮内边距 | `p-2` = **8px** | 8px |
| 圆角 | `rounded-none` = **0** | 0 |
| 未选中文字 | `--muted-foreground` = smoke-800 `#8a8a8a` | 同 |
| 选中 | `bg-muted` `#3c3d42` + `text-foreground` `#fff` | 同 |
| hover | `bg-accent` `#313235` + `text-foreground` `#fff` | 同 |
| 栏底色 | `--background` = charcoal-800 `#171718` | 同 |
| 右边线 | `border-border/50` = `#494a50` 50% | 同 |
| 投影 | `shadow-md` = `1px 1px 8px 0 rgba(0,0,0,.4)` | 同 |
| 面板底色 | `bg-background` `#171718`（与栏同色，靠 header 的 `border-b` 分区） | 同 |
| 输入框 | `--input` = charcoal-400 `#313235`，`rounded-lg` 8px | 同 |
| 主操作按钮 | `Button` 的 `secondary` 变体：`bg-secondary` `#262729` + `text-foreground` `#fff` | 同（面板「收藏」用它） |
| 焦点环 | `--ring` = `--muted-foreground` `#8a8a8a`（灰，不是蓝色光晕） | 同 |
| 强调色 | 见下方「为什么不用蓝色」 | 中性 |
| 字体 | `Inter, Arial, sans-serif`，字重 500 | 同（`@font-face` 取自 `/fonts/inter-latin-normal.woff2`） |

亮色：ComfyUI 这套前端包**只出暗色**（`main-*.css` 里没有 light 主题块，`:root` 本身就是 dark），
所以亮面按同一套色阶做镜像，不自造颜色：底 smoke-100 `#f3f3f3`、线 smoke-600 `#b4b4b4`、
选中 smoke-400 `#d9d9d9`、hover smoke-200 `#e9e9e9`、次要字 charcoal-100 `#55565e`、
正文 charcoal-950 `#09090a`、输入框 white。

### 为什么界面里"没有蓝色"

ComfyUI 的 `--primary` 确实是 azure-600 `#0b8ce9`，但它在官方 UI 里出现得极少：全仓
`variant="primary"` 只用于 `ExecuteButton`、`ConfirmationDialog`、`CreateWorkspaceDialog` 这
类**真正的确认动作**（63 处引用全是这一种语义）。列表选中、tab、徽章、对话框里的保存/加载/
删除，用的都是中性件：

| 场景 | ComfyUI 实际用的 | 本项目 |
| --- | --- | --- |
| 列表 / 卡片选中 | `bg-secondary`（charcoal-600 `#262729`）+ `border-foreground/60` | 同 |
| tab / 分段控件选中 | `bg-muted`（`#3c3d42`）+ `text-foreground` | 同 |
| 徽章 / 标签 | `bg-muted` + `text-foreground`；或 `border-border` + `text-muted-foreground` | 同 |
| 面板内的动作按钮（收藏 / 保存配置） | `Button` 的 `secondary` 变体 | 同 |
| 输入框焦点 | `--ring` = `--muted-foreground`（灰） | 同 |
| 复选框勾选 | 前景色实块 + 深色勾 | 同 |

上游这三个面板把 `--c-accent` 当"主题色"撒在了选中卡、`当前` 徽章、input/output 分段、
保存配置按钮上；早先把 `--c-accent` 指到 `--primary` 就带出了一片蓝。现在 `--c-accent`
在面板内指向 `--foreground`，再由 `#app .float-window` 下的逐类规则落到上表的每一档。

工作流配置里的小节点图另有问题：上游按 `class_type` 哈希取色相（`hsl(var(--n-hue) …)`），
一屏彩虹。`--n-hue` 是行内 style 绑定的，改它无效，所以覆盖的是消费端声明
（`.preview-node` 底色/描边、`.preview-handle`、`.preview-id`），统一成 `--secondary` / `--border` /
`--muted-foreground`。

### 顶部画布切换条的尺度从哪来

出处：`GraphCanvas.vue` 里 workflow-tabs 的容器
`flex h-(--workflow-tabs-height) w-full items-center border-b border-border/50 bg-background shadow-md`，
以及 `WorkflowTabs.vue` / `WorkflowTab.vue` / `tabs.variants.ts`。

| 项 | ComfyUI | 本包 |
| --- | --- | --- |
| 栏高 | `--workflow-tabs-height: 2.375rem` = **38px** | 38px |
| 栏底色 / 下边线 / 阴影 | `bg-background` + `border-border/50` + `shadow-md` | `--cg-bg` + `--cg-line` + `1px 1px 8px rgba(0,0,0,.4)` |
| 栏内边距 / 间距 | `px-1`(4) + `gap-1`(4) | 4 / 4 |
| 标签 | `h-full min-w-22.5`(90px) `pl-3 pr-2`，`rounded-lg`(8)，`text-sm`(14) | 同 |
| 选中 / 未选中 | `data-[state=active]:bg-secondary` + 白字；未选中 `text-muted-foreground` | 同（亮色选中取下一档 `--cg-muted`） |
| 标签文字 | `max-w-[150px] truncate` | 同（省略号） |
| 未保存 | 8px 圆点，当前标签用 `bg-foreground` | 同（`currentColor` = 当前标签字色） |
| 新建 | `Button variant="muted-textonly" size="icon"` = 32×32、透明底、hover 出 `bg-accent` | 同 |
| 「+」位置 | 紧跟在最后一个标签右侧，不贴最右 | 同（`flex: 0 1 auto`） |

行为：点标签 → `store.open(id)`；点「+」→ `store.create()`；两者切换前若 `dirty` 会先
`saveNow()` 静默保存，避免切走时丢内容；点任意标签上的 × → `xcatCloseTab(id)`（当前标签带脏标记时 × 仅在 hover 出现，与 ComfyUI 一致）
（关闭后若关的是当前且仍有其它标签则打开相邻项，否则进 Unsaved Canvas）。
顶部条**只同步 `window.__xcatOpenTabs`**（已打开画布 id 数组，`open` / `create` 时 push、
`remove` 时 prune），不显示 `store.list` 里的全部画布；列表变化 / 当前画布变化 / 未保存状态变化都会重建这条栏。

**Ctrl / Cmd+S 保存**：在 `window` 上捕获 `keydown`（capture 阶段），命中 `ctrl/cmd + s`
时 `preventDefault`，当前有 `currentId` 走 `store.saveNow()`，否则走注入的 `saveAsNew()`
（新建一个「画布 N」并写入当前内容），保存后的画布随即出现在画布管理列表里。

**画布管理用卡片网格 + 内联按钮**：画布管理面板（`.float-window .cm-list`）是上游的卡片网格
（`grid; minmax(214px,1fr)`），每张卡片含名称 + `Infinite_canvas` 品牌标签（上游的 `.cm-current`
「当前」徽章已删除，当前画布仍靠 `.cm-card.is-current` 高亮描边区分），
`.cm-card-actions` 里从左到右是 **复制 / 编辑名称 / 删除** 三枚 `.cm-icon` 按钮（点击均
`stopPropagation`，不会误触发卡片本身的「打开」）。编辑名称走上游内联输入框，删除走
`window.confirm`；复制调 `canvasStore.duplicate()`（GET 原画布 → POST 新建「<名字> 副本」→
PUT 把原画布内容整体覆盖过去 → `refresh()`，无需新后端），在 `CanvasManager` 的 setup 里
额外解构 `duplicate:dupCanvas` 注入。头部的「新建画布」按钮已删，空态文案改为「还没有画布」；
自定义右击菜单（`.xcat-cm-menu` + 全局 `contextmenu` 监听）及其 CSS 一并移除，
新建画布统一走顶部标签栏「+」。

**无画布默认进 Unsaved Canvas**：`bootstrap` 被重写为——拉取列表后，若 `localStorage`
的 `infinite-canvas:last` 指向存在的画布则打开它，否则若有画布打开第一个，否则调用注入的
`resetToUnsaved()`（清空 `currentId` / `currentName`，顶部条退化为单个 Unsaved Canvas 标签）。

#### 为什么它是命令式挂载，而不是写进模板

App 的根节点是 **block**（`openBlock()` + `createElementBlock`），Vue 更新时只走
`patchBlockChildren`，而 `patchElement` 里传下来的 `optimized = true` 会让
`else if (!optimized) patchChildren(...)` 直接跳过——手写进 children 的 vnode 的子孙节点
（哪怕加了 `patchFlag`、哪怕换了 `key`）都不会被重新 diff。实测：render 确实重跑了
（打点计数 +1）、`store.list` 里也确实有 6 个画布，但这条栏的 DOM 一直停在首渲染的空状态。

所以这条栏改成：`onMounted` 里 `document.createElement` + `page.prepend(strip)`，
再用 `watch([__xcatOpenTabs, list, currentId, dirty, busy], sync, { flush: 'post' })` 重建内容。
好处是不受 block 优化影响；代价是它不在 Vue 的 vnode 树里，样式必须走全局
`#app .canvas-tabs-strip`（不能用 scoped）。注意：画布管理卡片的模板改动（增删
`.cm-card-actions` 里的按钮）不受此限制，直接改渲染函数即可生效。

### 右下角工具条的尺度与图标从哪来

- 组件源码：`GraphView-*.js.map` 里的 `src/components/graph/GraphCanvasMenu.vue`
  与同目录 `CanvasModeSelector.vue`、`modals/ZoomControlsModal.vue`。
- 容器：`main-*.css` 的 `.floating-panel` = `border-radius: var(--radius-xl)`（12px）
  + `padding: var(--spacing)`（4px）+ `background: var(--background)`
  + `box-shadow: var(--shadow-inset-highlight), 0 2px 16px 0 var(--shadow-color)`
  （`inset 0 1px 0 0 #ffffff1a` 与 `#0006`）。外层 `gap-1` = 4px。
- 外边距：官方是 `inset-x-0 bottom-0` + `ml-auto`，贴着画布右下角没有额外留白；本包画布是
  独立 iframe、底下没有 ComfyUI 的底部面板，所以留 8px 对称外边距（`right` / `bottom` 同为
  8px，落在 4px 网格上）。内部间距不另设：`padding` 4px、相邻项 `gap` 4px，与官方一致。
- 图标：不是重画的，取自 `main-*.css` 里 `icon-[lucide--*]` 规则内的
  `--svg:url("data:image/svg+xml,…")`（`mouse-pointer-2` / `hand` / `focus` /
  `chevron-down` / `route-off` / `grid-3x3`），解出 path 后内联进渲染函数。
- **图标颜色**：`icon-[lucide--*]` 规则里带 `background-color: currentColor`（只是 mask），
  所以图标永远跟随所在元素的 `color`。工具条上的按钮都是 Button 的 `secondary` 变体
  （`bg-secondary text-foreground hover:bg-accent`）再被 `bg-transparent` 覆盖底色，
  **文字色是 `text-foreground`（white），不是 `text-muted-foreground`**。
  左侧栏的 `.side-bar-button` 才用 `text-muted-foreground`，两处不能混。

| 项 | ComfyUI | 本包 |
| --- | --- | --- |
| 容器圆角 | `--radius-xl` = **12px** | 12px |
| 容器内边距 / 间距 | `--spacing` / `gap-1` = **4px** | 4px |
| 按钮 | `size-8` = **32×32**，`rounded-lg` = 8px | 同 |
| 图标 | `size-4` = **16px** | 16px |
| 分隔线 | `h-[27px] w-px bg-border` | 27 × 1，`--border` `#494a50` |
| 模式按钮 | 32×32 的 `bg-muted` 图标块 + 16px 箭头 + `pr-0.5` | 同（合计 54 × 32） |
| 缩放按钮 | `h-8 w-15` = **32×60**，`text-xs` 12px | 同 |
| 图标 / 文字颜色 | `text-foreground`（dark = white `#fff`） | 同，`--cg-fg` |
| hover | `hover:bg-accent`，文字仍是 `text-foreground` | 同 |
| 开关激活 | `not-active:bg-muted`（`:not(:active)`） | `.is-on` → `bg-muted`，hover 仍转 `accent`（与官方层叠顺序一致） |
| 弹层 | `Popover side="top" sideOffset=8`，`p-1` + border + 8px 圆角 | 同（缩放面板 250px 宽、12px 圆角） |

功能接线（都走 `window.__xcatFlow`，即 Vue Flow 的 store，不模拟点击）：

| 按钮 | 实现 |
| --- | --- |
| 选择 / 拖拽 | 见下节「选择 / 拖拽 的功能语义」：`V` / `H` 与空格临时切换，`panOnDrag` 恒为 `[0,1,2]`；选择 = 可编辑，拖拽 = 只读平移 |
| 适应视图 | `fitView({ padding: .18, includeHiddenNodes: false })` |
| 缩放控制 | 显示 `viewport.zoom`，弹层里 `zoomTo`，输入框按百分比换算 |
| 网格吸附 | `snapToGrid` 开关，`snapGrid` 沿用画布默认 `[15,15]` |
| 隐藏连接线 | 给 `<html>` 加 `xcat-links-hidden`，CSS 关掉 `.vue-flow__edge` 的显示（不碰 Vue 管的 class） |

#### 选择 / 拖拽 的功能语义（2026-11-12 按官方源码重做）

抄的是源码，不是截图。真源都在 `comfyui_frontend_package/static/assets/*.js.map`
的 `sourcesContent` 里：

| 官方源码 | 结论 |
| --- | --- |
| `src/components/graph/CanvasModeSelector.vue` | 「选择」= `Comfy.Canvas.Unlock`（`canvas.read_only = false`），「拖拽」= `Comfy.Canvas.Lock`（`read_only = true`）；菜单是 `role=menu` + 两个 `menuitemradio`，打开聚焦选中项，上下键换焦点，Esc 关闭并还焦点；快捷键提示取命令绑定的 key |
| `src/composables/useCoreCommands.ts` | `Comfy.Canvas.Lock/Unlock` 只是切 `app.canvas.read_only` |
| `src/platform/keybindings/defaults.ts` | `V` = Unlock，`H` = Lock（与菜单里的 V / H 一致） |
| `src/platform/settings/constants/coreSettings.ts` | `Comfy.Canvas.LeftMouseClickBehavior` 默认 `panning` → 左键拖空白是**平移画布**，不是框选；`Ctrl/Cmd + 左键拖` 才框选 |
| `src/lib/litegraph/src/LGraphCanvas.ts` | `_processPrimaryButton()` 里 `read_only` 时左键在**任何位置（含节点上）**都转成 `dragging_canvas`；`_updateCursorStyle()` 给只读 `grab` / `grabbing`；空格按住临时把 `read_only` 置真，松开还原 |
| `src/renderer/core/canvas/useCanvasInteractions.ts` | `handleLeftButtonReadOnlyPointer` 把只读态左键事件转发给画布 |
| `src/locales/zh/main.json` | `graphCanvasMenu.select = 选择`、`graphCanvasMenu.hand = 拖拽` |

本包是 Vue Flow 不是 litegraph，`bk` 组件的 `applyMode()` 用 store 选项等价实现：
`panOnDrag = [0,1,2]`（两模式左键都平移）；选择时
`nodesDraggable / nodesConnectable / elementsSelectable / edgesUpdatable = true`、
`deleteKeyCode = ["Backspace","Delete"]`；拖拽时这些全关，
`deleteKeyCode = null`，并给 `<html>` 加 `xcat-canvas-hand`
（CSS 让 `.vue-flow__node / edge / handle / nodesselection-rect` 全部
`pointer-events:none`，事件落到 pane 由 d3-zoom 平移；光标 `grab` / `grabbing`）。
非只读时 pane 光标 `default`、拖画布时 `grabbing`。
模式持久化在 `localStorage["xcat:canvas-toolbar"]`。

**`selectionKeyCode` 已固定为 `"xcat-none"`**（永不匹配的键名）：框选整层改由
`assets/xcat-marquee.js` 自管，Vue Flow 内部框选关掉，原因与做法见下一节。

**键位分工（与 ComfyUI 一致）**：`Ctrl + 左键拖` = 框选（空白或节点上都可），
`Alt + 左键拖` = 剪线，`Delete` / `Backspace` = 删除选中节点与连线（见后面两节）。

### 框选照 ComfyUI（2026-11-13 23:5x）

用户：「框选 参考 comfyui」。先把两边的真实行为都量了一遍。

**ComfyUI 的语义（源码 `LGraphCanvas.ts` / `selectionIntent.ts`）**：

| 环节 | 官方实现 |
| --- | --- |
| 触发 | `_processPrimaryButton()`：`e.ctrlKey \|\| e.metaKey` 且 `!e.altKey` 且 `LiteGraph.leftMouseClickBehavior === 'panning'` → `_setupNodeSelectionDrag()`；**空白和节点上都起框**。不按 Ctrl 时 `setupCanvasDrag()` → `dragging_canvas = true`（平移） |
| 命中 | `_getItemsInRect()` 用 `overlapBounding(rect, node.boundingRect)` —— 矩形与节点**相交**就算；group 要求 `containsRect` 完全包含；reroute 看中心点 |
| 实时 | `Comfy.Graph.LiveSelection` 默认 **true**，`handleLiveSelect()` 拖动中逐帧改选中 |
| 修饰键 | `resolveMarqueeSelection()`：Shift = `add`、Alt = `subtract`、无 = `replace` |
| 单击 | `resolveClickSelection()`：带 toggle 修饰（shift/ctrl/meta）时，未选中 → `add`、已选中 → `remove` |
| 矩形外观 | canvas 绘制：半透明蓝填充 + 1px 实线蓝框、直角 |

**本包原来的差距**（Vue Flow 自带框选）：

1. `selectionMode` 默认 `'full'` —— 节点必须被框**完全包住**才选中，轻划到边选不上；
2. 只看 `selectionMode`，**不看修饰键** —— Shift 加选、Alt 减选都没有；
3. 只在 pane 空白起拖才启动（`Pane` 的 `le()` 要求 `ne.target === H.value`）——
   从节点上 Ctrl+拖会**拖节点**；
4. Ctrl 单击已选中节点不会取消（`multiSelectionKeyCode` 只做加选）；
5. 矩形是 `rgba(0,89,220,.08)` + `1px dotted` 虚线，几乎看不见。

**做法（两层）**：

- `index-BXU58XDe.js`：把 `selectionKeyCode` 设成 `"xcat-none"`（`useKeyPress` 永不匹配
  → 关闭内部框选，避免出现两个矩形）。保留 `selectionMode: "partial"` 作兜底：
  万一自管脚本没加载，`applyMode()` 会退回 `"Control"`，仍能用 Ctrl 拖框选。
- 新增 `assets/xcat-marquee.js`（独立脚本，`index.html` 里 `defer` 引入）：
  `document` 捕获阶段拦 `pointerdown`（`button===0 && (ctrlKey||metaKey)`），
  `stopPropagation` 阻止节点拖动，自己画矩形、自己算命中。

自管层的要点：

| 点 | 实现 |
| --- | --- |
| 不抢的场景 | `input / textarea / select / [contenteditable]`（选文字）、`button / a / .vue-flow__handle / .nodrag / .card-delete / .media-dot`（连线与节点内控件）、只读态（`html.xcat-canvas-hand`）、`Alt` 按下（让位上游剪线） |
| 命中 | `getBoundingClientRect()` 两两相交（`overlap()`），等价于 `overlapBounding`，不换算 flow 坐标 |
| 矩形 | 追加一个 `div#xcat-marquee-box.vue-flow__selection` 到 `.vue-flow`，用样式类复用外观 |
| 修饰键 | pointerdown 时快照 `base` 选中集合，逐帧按 Shift（并集）/ Alt（差集）/ 无（替换）算目标 |
| 单击 | `moved` 为假时按「按下那一刻」的 `pressWasSelected` 取反，并延后一帧写入（Vue Flow 的 click 会在 pointerup 之后跑一次，同步写会被覆盖） |
| 收尾 | `pointerup` / `pointercancel` / `Esc` 移除监听并隐藏矩形 |

**矩形样式**（`xcat-overrides.css`，暗色 / 亮色两套）：

```css
#app .vue-flow__selection {
    background: rgba(120, 170, 255, 0.3);
    border: 1px solid rgba(160, 200, 255, 0.95);
    border-radius: 0;
}
html[data-theme="light"] #app .vue-flow__selection {
    background: rgba(11, 140, 233, 0.14);
    border: 1px solid #0b8ce9;
}
```

填充值是反推来的：真实 ComfyUI 截图里画布底 `(21,21,21)`、框内 `(49,65,92)`，
解得 `rgb(120,170,255) @ 0.30` 叠在深灰上正好是 `(51,66,91)`。

**验证** `verify-marquee.js`（CDP 真键鼠，20 项 ALL PASS）：

| 场景 | 结果 |
| --- | --- |
| Ctrl+拖只盖住节点左上 1/4 | 拖动中即选中该节点（相交判定） |
| 矩形样式 | `rgba(120,170,255,0.3)` / `1px solid` / `0px` 圆角；且不再出现 Vue Flow 的第二个矩形 |
| 从节点内部起拖 | 出现框选矩形，节点位置不变（不拖动） |
| 先选中 C，再 Shift+Ctrl 框 A | 结果 `["A","C"]`（加选） |
| 不按 Ctrl 拖空白 | 画布平移、无矩形、无误选 |
| 框住 A+B 大半、C 在框外 | `["A","B"]` |
| Ctrl 单击未选中节点 / 再点一次 | `["B"]` → `[]`（toggle） |
| Alt+Ctrl 拖 | 不进框选（与 panning 模式下 `!e.altKey` 判断一致） |
| 只读 H | 不出矩形、不选中；V 切回后恢复 |

另跑 `verify-del-key` / `verify-ring-align` / `verify-node-size` /
`verify-strip-input-only` / `verify-rerun-overwrite` / `verify-gen-result` 六套回归全 PASS。


### 多选包围框（2026-11-14）

用户：「多选的时候怎么没有框啊？comfyui 有的」。实测确认：ComfyUI 选中 ≥2 个节点时，
会围绕所有选中节点画一圈**灰色虚线框**（`--border` #494a50、2px、虚线 5/5、圆角 8px）。
真源是前端包 `core-*.js` 里的内置扩展 `Comfy.SelectionBorder`：

```js
function drawSelectionBorder(ctx, canvas) {
    const n = canvas.selectedItems;
    if (n.size <= 1) return;                       // 单选不画
    const r = createBounds(n, 10);                 // 包围盒外扩 10 个画布单位
    ctx.lineWidth = 2 / canvas.ds.scale;           // 屏幕恒 2px
    ctx.strokeStyle = getComputedStyle(:root).getPropertyValue('--border') || '#ffffff66';
    const d = 5 / canvas.ds.scale;
    ctx.setLineDash([d, d]);                       // 屏幕 5 实 5 空
    ctx.roundRect(r[0], r[1], r[2], r[3], 8 / canvas.ds.scale);  // 屏幕 8px 圆角
    ctx.stroke();
}
```

**做法**：新增 `assets/xcat-selborder.js`（`index.html` 里 `defer` 引入），
往 `.vue-flow` 追加一层 `<div id="xcat-selborder"><svg><rect></svg></div>`
（`position:absolute; inset:0; pointer-events:none; z-index:6`，与 ComfyUI 把边框画在
canvas 前景、节点之上同理），参数逐条对齐上表：

| 项 | 值 |
| --- | --- |
| 触发条件 | 选中 **> 1** 个节点；1 个或 0 个时整层 `display:none` |
| 外扩 | `10 × zoom` 屏幕像素（等价于 10 个画布单位） |
| 线宽 | 2px（屏幕常量，不随缩放） |
| 虚线 | `stroke-dasharray: 5 5`（屏幕常量） |
| 圆角 | `rx = ry = 8`（屏幕常量） |
| 颜色 | `var(--cg-border)` = `--border`（暗 #494a50 / 亮 #b4b4b4） |

**刷新机制不用 rAF 轮询**：节点选中态是 `class`、位置与视口是 `style` 的 `transform`，
全都落在 `.vue-flow` 子树内，用 `MutationObserver`（`attributes: ['class','style']` +
`subtree` + `childList`）在变更时 `setTimeout(0)` 合并重算即可，覆盖选中变化 / 拖节点 /
平移缩放 / 增删节点 / 窗口 resize。**踩坑**：第一版用 `requestAnimationFrame` 常驻轮询，
在无头 Chrome（后台标签页同样）里 rAF 被浏览器暂停，框一次都不出现 —— 事件驱动才可靠。
回调里要跳过目标在 `#xcat-selborder` 内的 mutation，否则自己写 `style` 会触发自我循环。

**验证** `verify-selborder.js`（CDP，17 项 ALL PASS）：

| 场景 | 结果 |
| --- | --- |
| 选 A+B | 层 `display:block`、`pointer-events:none`、`z-index:6` |
| 几何 | 外扩 = `10 × zoom`，宽高 = 节点并集 + 20×zoom（误差 ≤ 3px） |
| 样式 | `rgb(73,74,80)` / `2px` / `5px,5px` / `rx=8` |
| 单选 / 无选中 | `display:none`（对齐 `size<=1 return`） |
| 移动节点 | 框跟随（y 与高度同步变化） |
| `zoomTo(1.5)` | 外扩随新 zoom 变化（diff 0.04px） |
| Ctrl+拖框选过程中 | 框选矩形（蓝）与多选包围框（灰虚）同时存在，与 ComfyUI 一致 |

另有真实鼠标拖拽验证：多选后拖 A 移动 `(100,60)`，框同步位移 `(100,60)`。


### 多选只留主体（2026-11-14）

用户：「多选的状态下，生成节点不显示主体以外的东西，包括顶部的操作按钮以及底部的提示词之类的」。

**现象**（改前截图 `multihover-2.png`）：多选时**每个**节点都会渲染并展开
`.node-panel`（工作流列表 + 接入素材条 + 提示词 + 运行，实测 724×233 的浮层），
顶部 `.node-actions` 也全开（裁剪 / 宫格切分 / 镜像 / 调整 / 下载 / 删除…），
两个节点并排时两块面板直接连成一片盖住画布下半部，节点本体只占上面一小条。

**做法**：`assets/xcat-selborder.js` 的 `update()` 在选中 ≥2 时给 `#app` 挂根类
`.xcat-multi-select`（回到 ≤1 即摘掉，与包围框同一份状态），
`xcat-overrides.css` 据此收起节点上的全部浮层：

```css
#app.xcat-multi-select .demo-node > .node-actions,   /* 顶部操作按钮条 */
#app.xcat-multi-select .demo-node > .node-panel,     /* 底部：工作流 / 素材条 / 提示词 / 运行 */
#app.xcat-multi-select .demo-node > .node-delete,    /* 右上 ×（上游默认 none，留作兜底） */
#app.xcat-multi-select .demo-node > .node-resize,    /* 右下缩放手柄 */
#app.xcat-multi-select .card-delete {                /* 媒体卡片右上 ×（多选时唯一还露着的按钮） */
    display: none !important;
}
```

**为什么可以纯 CSS 隐藏**：这几个元素全是 `position:absolute` 浮层（`.node-panel`
是 `.demo-node` 的直接子元素，`position:absolute`，不参与布局），
所以节点尺寸、连线端点、多选包围框全都不变 —— 实测多选前后节点都是 `496×279`。

**保留**：主体（`.node-media` / `.node-empty`）、左上角文件名标签 `xcat-node-name`
（多选时还要靠它认节点）、左右连接端口。

**验证** `verify-multi-hide.js`（CDP 真鼠标，19 项 ALL PASS）：

| 场景 | 结果 |
| --- | --- |
| 单选 | 无根类；`.node-panel` 与 `.card-delete` 照常可见 |
| 多选 2 个 | 根类挂上；两节点的 `.node-actions` / `.node-panel` / `.node-delete` / `.node-resize` / `.card-delete` 全 `display:none` |
| 节点尺寸 | 多选前后同为 `496×279`（浮层不占布局） |
| 包围框 | 照常出现，位置尺寸不变 |
| 多选下真实 hover 节点 | 浮层仍不出现 |
| 回单选 / 取消选中 | 根类移除，面板与按钮恢复 |

截图 `multi-hide-on.png`（多选只留主体）/ `multi-hide-off.png`（单选恢复）/
`multi-hide-compare.png`（前后对比）。


### Delete 删除节点 / 连线（2026-11-13 23:40）

上游只把 `Backspace` 交给 Vue Flow（store 默认 `deleteKeyCode:"Backspace"`），
`Delete` 按下去没有任何反应 —— 而 `Mn()` 那个 keydown 监听里其实早就写了
`v.key!=="Backspace"&&v.key!=="Delete"`，只是拿它拍撤销快照，没真删。

**改法（两处）**：

| 位置 | 原 | 现 |
| --- | --- | --- |
| store 默认值 | `deleteKeyCode:"Backspace"` | `deleteKeyCode:["Backspace","Delete"]` |
| `applyMode()` | `F.deleteKeyCode.value = hand ? null : "Backspace"` | `hand ? null : ["Backspace","Delete"]` |

`is()` 的键盘过滤器本身支持数组（`Array.isArray(e)?e.some(...)`），不需要另写监听。
删除动作走上游 Pane 的那条链路：`removeNodes(选中节点)` + `removeEdges(选中边)`，
所以**关联边自动清理**、下游 `inputMedia` 里的接入项也会一并消失（实测确认）。

**输入框保护**：Pane 里 `is(deleteKeyCode,{actInsideInputWithModifier:!1})` 会先查
`ga()`（`INPUT/SELECT/TEXTAREA`、`contenteditable`、`.nokey`），命中就 return。
所以在提示词框里按 Delete 只删文字，不会删节点；`xcat-text-edit.js` 退出编辑时也会主动
`blur()`，避免 Delete / 方向键被 textarea 吃掉。

**撤销顺序坑**：`Mn()` 原本挂在 `window` 的**冒泡**阶段，而 Vue Flow 的删除在
`document` 阶段就执行完了 —— 快照拍到的是「已经删掉」的状态，`Ctrl+Z` 只会跳到更早的一步
（实测删完按 Ctrl+Z，回来的是上上个画布状态）。把监听改成捕获阶段
（`addEventListener("keydown",Mn,!0)`）后，快照先于删除，`Ctrl+Z` 才能恢复被删的节点。

**只读模式**：拖拽（hand）态下 `deleteKeyCode = null`，按 Delete 不会删。

**验证**（`verify-del-key.js`，11 项 ALL PASS，8198 + CDP 真键鼠）：

| 场景 | 结果 |
| --- | --- |
| 选中节点按 Delete | 节点消失、关联边一起消失、其它节点不动 |
| Backspace | 仍可删除（原快捷键不回退） |
| 提示词框聚焦时按 Delete | 节点保留（文字编辑优先） |
| 失焦后再按 Delete | 正常删除 |
| 只读模式（H）按 Delete | 不删 |
| 删除上游后 | 边清空，下游 `inputMedia` 不再残留已删节点的素材 |
| 多选后 Delete | 一次性删除选中项 |
| 删除后 Ctrl+Z | 节点恢复 |

对照图 `del-key-before-after.png`。纯前端，刷新即可。

上游无限画布的 `canvasGraph` 原本把 `Ctrl` 和 `Alt` **都**当「切断连线」套索
（`me()` 在 pointerdown 捕获阶段 `preventDefault + stopPropagation`，会挡掉
Vue Flow 的框选），所以早先这一项只能退让成 `Shift + 拖`。现在改回来了，两处
bundle 补丁（`patch_selection_keys.py`，幂等，备份 `.selkeys.bak.js`）：

| 位置 | 原 | 现 |
|---|---|---|
| `applyMode()` | `selectionKeyCode = "Shift"` | `"xcat-none"`（框选交给 `assets/xcat-marquee.js`） |
| `canvasGraph` 剪线入口 `me()` | `if (button!==0 \|\| !(ctrlKey\|\|altKey)) return` | `if (button!==0 \|\| !altKey) return` |

`multiSelectionKeyCode` 保持上游默认（非 mac `Control` / mac `Meta`），但已不参与框选：
自管层自己读 `e.shiftKey / e.altKey / e.ctrlKey`，`Ctrl + 点节点` 的切换语义也在那里实现
（详见「框选照 ComfyUI」节）。

按钮顺序（从左到右）：模式选择 │ 适应视图 缩放控制 │ 网格吸附 隐藏连接线 —— 两个开关按
ComfyUI 的做法把「隐藏连接线」收在末尾（官方工具栏也是 minimap / link visibility 收尾）。

「工作流配置」已从工具条移到左侧栏，走 `Ul("workflow")` —— 和画布管理 `Ul("canvas")`、
资产管理 `Ul("assets")` 是同一个面板 store。

### 画布管理 / 资产管理 / 工作流配置：居中弹窗

这三项**不走贴栏面板**：上游给它们各写了一个 `float-window` 浮层组件（`role="dialog"`，
`position: fixed; left/top 50% + translate(-50%,-50%)`），点开就是居中弹窗，与
「提示词 / 资产库 / 日志」那种紧贴竖栏的通高面板不同。

尺度按 ComfyUI 的 `BaseModalLayout`（模板对话框 `WorkflowTemplateSelectorDialog` 用的就是它，
`size="md"`）对齐，实测官方弹窗在 1424×805 视口里是 1282×644：

| 项 | ComfyUI `BaseModalLayout` | 本包 |
| --- | --- | --- |
| 尺寸 | `h-[80vh] w-[90vw] max-w-[1400px]` | `90vw` × `80vh`（三处调用传参） |
| 圆角 | `rounded-2xl` = 16px | 16px |
| 底色 / 边框 | `bg-background` + `border` | `--cg-bg` + `--cg-border` |
| 阴影 | `shadow-lg`，被 ComfyUI 覆盖成 `0 2px 16px #0006` | 同 |
| 标题栏 | `h-18` = 72px、`px-6`、`text-base font-semibold`（16px / 600）、**无 `border-b`** | 72px、`0 12px 0 24px`、16px / 600、`border-bottom:0` |
| 关闭按钮 | `w-10`（40×40）+ 16px 图标 | 40×40 + 16px |

标题栏下面**没有横线**：官方 `BaseModalLayout` 的 header 是 `h-18 px-6`，与内容区共用
`bg-background`，靠 72px 高的留白分区，没有 `border-b`。上游原来画了一条 1px `--cg-line`，
已经改成 `border-bottom:0`（高度仍是 72px，不会因为少了 1px 边框而变 73px）。

**遮罩**：ComfyUI 的弹窗是原生 `<dialog>` + `showModal()`，变暗来自 `main-*.css` 里的
`dialog::backdrop { background: #00000080 }`（50% 黑），"其他区域不可点"则由原生 modal 的顶层
特性自带。之前只看 `role="dialog"` 那个元素、发现它自身透明就以为没有遮罩，是漏读了 `::backdrop`。

上游这三个面板只是普通 fixed div，没有这层，所以补了两件事：

- **渲染**：`WS`（浮窗组件）的根从单个 `div.float-window` 改成 Fragment
  `[div.float-mask, div.float-window]`，遮罩带 `onClick → emit("close")`，等同原生 dialog 点
  backdrop 关闭；顺带给窗口补 `aria-modal="true"`。
- **样式**：`#app .float-mask { position: fixed; inset: 0; background: #00000080 }`，
  层级 900（窗口 910）—— 压过工具条 30 / 预览气泡 40，低于全屏素材预览 `asset-mask` 999 与
  `node-ghost` 9999。颜色直接取官方的 `#00000080`，暗亮两套主题共用同一个值。

实测：遮罩 1424×805 铺满视口、`rgba(0,0,0,0.5)`；`elementFromPoint` 在左侧栏 / 工具条 / 画布
空白处返回的都是 `float-mask`；真实点一下工具条「网格吸附」的位置 → 吸附状态没变、弹窗关掉
（点击被遮罩吃掉）；点弹窗内部不会关。

窗口内的 `--c-*` 令牌在 `#app .float-window` 上重映射成 `--cg-*`，与左侧栏面板同一套
ComfyUI 语义色。

#### 三个弹窗的内容区：照模板对话框 / 资产浏览器

外框对齐之后，里面仍是上游自己那套尺寸，和 ComfyUI 放在一起很割裂。2026-11-12 按
`WorkflowTemplateSelectorDialog.vue`（模板）与 `AssetBrowserModal.vue`（资产）把内容区
重排了一遍，只改 CSS，不动 DOM：

| 项 | ComfyUI 真值（出处） | 本包 |
| --- | --- | --- |
| 弹窗骨架 | `BaseModalLayout` 是三列 grid：`nav`（通高）/ 中列（header + contentFilter + content）/ 右栏 `#rightPanel`（通高） | `.am` 改 `grid-template-columns: 224px / 1fr / 352px`，`.am-body` 用 `display:contents` 把三块提成网格项；第 26 条起：行改 `80px / 1fr`，`.am-bar` 跨 `1/2/2/4`（通栏顶栏），`.am-side` 跨两行满铺，`.am-right` 只占第 2 行 |
| 内容区高度 | 弹窗 `h-[80vh]`，内容区吃满「减去 72px 标题栏」的剩余高度 | 第 26 条起 `.float-window:has(.am) .float-body` 改 `position:absolute; inset:0`（内容区顶到窗口顶边，标题栏变绝对定位浮层），`.am` 仍 `height:100%` |
| 内容容器 | `px-6 pb-10`，自身滚动（`BaseModalLayout.contentContainerClass`） | `.float-body` 改 `padding:0`、`overflow:visible`（内容区不滚，滚动下放到各面板；`visible` 是为了让浮出的分段 / 标题栏不被裁），并显式 `scrollbar-gutter:auto` |
| 过滤条 | 模板 `px-6 pb-4`；资产 `px-6 pt-2 pb-6`（`AssetFilterBar.vue`），**只在中列** | `.cm-bar` 高 32px、无内边距（由 `.cm` 的 24px 管）；`.am-bar` = `padding:0 64px 0 24px`、高 80（顶栏，右 64 给关闭按钮让位） |
| 按钮 | `size="md"`：`h-8 rounded-lg text-xs`（`button.variants.ts`） | 32px / 8px / 12px；`secondary` 底 = `--secondary`，hover `--accent` |
| 选中态 | `variant="inverted"`：`bg-foreground text-background` | 前景色实底 + 反色字（亮面即黑底白字） |
| 危险动作 | `destructive-textonly`：透明底 + `--destructive`（coral-700 `#b33a3a`） | 同 |
| 输入 / 搜索 | `SearchInput` `h-9` + `border-border/50` + 透明底，在 header **最左**、`flex-1 max-w-lg` | 36px / 8px 圆角 / `--cg-line`；第 26 条起 `margin-left:auto` 靠右、`flex:0 1 464px`，右侧接刷新 / 批量管理 / 关闭 |
| 左栏 | `LeftSidePanel`：`w=14rem(224px)`、`bg-card`、`px-3`，**通高** | `.am-side` 190 → 224px、`--secondary` 底、无右边框、`grid-area: 1/1/3/2`（从窗口顶铺到底）；「文件类型」小标题已隐藏（`.am-side-title{display:none}`），只剩分类列表，`padding-top:92` 与网格第一行同基线 |
| 切换按钮（input / output） | 官方 `ToggleGroup`（`toggleGroup.variants.ts` + `WidgetToggleSwitch.vue`，带标签布尔控件）的内核，圆角改胶囊 | 胶囊槽 `--cg-input`(#313235) + `padding/gap:2px`、28px 高；选中块 `--cg-bg`(#171718) 圆角 999px + 前景字（12px）、未选中透明 + `--cg-muted-fg`；亮面槽 `--cg-muted`(#d9d9d9)、选中块 `--cg-bg`(#f3f3f3)。第 26 条起在**顶栏、左栏色块的右外侧**（`.am-side > .am-tabs` 绝对定位 `top:26px / left:248px`），左缘与网格第一张卡对齐 |
| 导航项 | `NavItem.vue`：`px-4 py-3 text-sm rounded-md`，active `bg-muted` / hover `bg-accent` | 12/16 / 14px / 行高 1.4（项高 44）/ 圆角 8px |
| 右面板 | `BaseModalLayout` `w-72`(288px)，**通高** | `.am-right` 340 → **352px**、`grid-area: 2/3/3/4`（让出顶栏）、无左边框、底色 `transparent`（与中栏同底） |
| 工作流配置 | 与资产同源的「通高左栏 + 右栏」骨架（`LeftSidePanel` + `#rightPanel`） | `.wf-left` 通高色块 224px、`--secondary` 底、`padding:92px 12px 12px`；`.wf-block` 去卡片（透明 / 无圆角 / 无内边距）；右栏 `padding:92px 24px 40px`；「保存配置 / 删除」绝对定位到顶栏 `top:24 / right:60`（关闭按钮左侧） |
| 卡片网格 | `AssetGrid`：`minmax(15rem,1fr)` + `gap-4`；媒体网格 `minmax(min(240px,30vw),1fr)` + `gap-2` | `.cm-list` 15rem/16px；`.am-grid` `min(160px,25vw)`/8px（官方 240 → 收到 160，中列 4 列、每格约 185px，缩略图更小） |
| 预览区 | `AssetPreview`：媒体按容器等比、可长可方 | `.am-preview-body` 锁 `aspect-ratio:1/1`，`width:min(100%,46vh)` → 352 栏宽下 **328×328**（原 256），高度不再跟 58% 分比走，剩余高度给提示词区；亮面补 1px `--cg-line` 勾边 |
| 卡片 | 模板卡 `rounded-lg p-2` + hover `bg-secondary/50`；`AssetCard` `rounded-2xl p-2`；`MediaAssetCard` `rounded-lg p-2` | `.cm-card` 8px/8px；`.am-cell` 8px |
| 徽章 / 标签 | `Tag`：`h-6 px-2 text-xs rounded-sm bg-muted`；模板卡角标 `h-6 px-2 rounded-md bg-zinc-700/50` | `.cm-current` / `.cm-brand` 同值 |
| 空态 | `AssetGrid`：图标 40px + `text-lg`(18px) 标题 + `text-sm`(14px) 说明 | `::before` 用 mask 画 lucide 图标（layers / search），文案 14px |
| 字号 | 对话框正文 `text-sm`(14px)、次要信息 `text-xs`(12px) | 14 / 12，不再出现 10–13px 混排 |
| 弹窗上限 | `size="md"` = `h-[80vh] w-[90vw] max-w-[1400px]` | 补 `max-width:1400px` / `max-height:80vh` |

**为什么资产管理的「骨架」要动**：上游是「一条横跨整个弹窗宽度的工具条 + 下面一条
flex 三栏」，于是左右两栏被压到工具条下面、起点比中列低一整行，三列关系是断的
（左栏悬在中间、右栏也跟着下沉）。官方 `BaseModalLayout` 是**三列 grid**：`nav` 从
标题栏下方直接通到底，中列自己再分 header / filter / content，右栏也通高。这里把
`.am` 改成同样的 grid，`.am-body` 用 `display:contents` 把 `.am-side` / `.am-grid` /
`.am-right` 提成 `.am` 的网格项直接定位。**bundle 在这一轮动过一次**：把
input/output 分段从 `.am-bar` 移到 `.am-side` 首项、删掉左栏折叠按钮
`.am-side-toggle`，四处运行副本的 bundle 现为 `f914d6cf`。分段后来又被
`position:absolute` 浮到标题栏，但那是纯 CSS，DOM 没再改。

亮面要单独说一句：ComfyUI 官方只有暗色一套主题，亮面是本包按同一套 charcoal / smoke
色阶镜像的，镜像后 `--secondary`(#e9e9e9) 压在 `--background`(#f3f3f3) 上对比只有 1.09，
按钮和「当前卡」几乎看不出边界。所以亮面下这两类底改用 `--muted`(smoke-400 `#d9d9d9`)，
暗面对应关系不变；`inverted` / `destructive` 两个语义在亮面照旧（黑底白字 / 红字透明底），
用 `:not()` 把它们从那条灰色覆盖里排掉，否则 `html[data-theme]` 的前缀会把权重抬过
`.is-active` 把它一起刷灰。

各面板自己的工具条仍在弹窗内容区顶部（画布管理只剩「删除所选」，「新建画布」「保存当前」均已删；保存走 `Ctrl/Cmd+S` 弹窗或切换标签自动保存）；
画布列表本身是 `repeat(auto-fill, minmax(240px,1fr))`、`gap:16px` 的卡片网格（照 `AssetGrid`），画布多了会自动铺满多列。

三项开关状态存在 `localStorage` 的 `xcat:canvas-toolbar`（`mode` / `snap` / `links`）。

注意十点：

- 上游样式是 scoped 的（`.cm-pop[data-v-xxx]`，权重 0,2,0），属性选择器按 class 计数，
  所以覆盖规则用 `#app` 前缀才压得住，`body` / `html` 前缀反而更低。
- 面板里的类（`lib-*` / `compose-*` / `asset-*`）在上游全都引用画布自己的 `--c-*` 令牌，
  所以配色没有逐类去覆盖，而是在 `#app .library-dock` 上把 `--c-*` 就地指向 `--cg-*`
  （`--c-surface`→`--background`、`--c-surface-3`→`--input`、`--c-text`→`--foreground`、
  `--c-muted`→`--muted-foreground`、`--c-line`→`border/50`、`--c-accent`→`--foreground`
  —— 不是 `--primary`，理由见上一节）。
  升级上游 dist 后这段仍然有效，不用重新数类名。
- 栏底菜单的主题项在切主题时**不会重新渲染**（实测 `Ai` 变了但 DOM 不动），
  所以图标与文案不能写成模板三元表达式，而是两组都渲染、由 `html[data-theme]` 决定显示谁。
  （右下角工具条是重写过的组件，渲染函数本身会跟着 `viewport` / 开关状态重跑，不受这条限制。）
- iframe 是独立文档，ComfyUI 主页面加载的 Inter 不生效，得在覆盖样式里再 `@font-face`
  声明一次，地址是 ComfyUI 根路由 `/fonts/inter-latin-normal.woff2`。
- 本机跑起来的 ComfyUI 侧栏是 `small-sidebar` 档（48px 项高、无标签），而界面要求的
  是 default 档（56px + 标签）；`--sidebar-icon-size` 不随档位变，两档都是 16px，
  但 `icon-[...]` 类把它按 `1.2em` 放大到 **19.2px** 渲染（8199 实测），别把字号当成渲染尺寸。
- 重新 `npm run build` 会生成新的 hash 文件名，`index.html` 里的引用与 JS 里那十四处都要重做一遍。
- 右下角工具条依赖 `window.__xcatFlow`（在 `TM()` 开头挂的 Vue Flow store）；只重做 CSS
  而漏掉这行，按钮点击会静默无效（`F` 为 `null`）。同理，升级后 `bk` 组件重写也要重做，
  否则工具条会退回上游那三个按钮。
- 隐藏连接线是给 `<html>` 加类、由 CSS 关 `.vue-flow__edge`；不要改成往 `.vue-flow` 上
  `classList.add`，那个 class 归 Vue 管，下一次 patch 会把外部加的类抹掉。
- 弹窗遮罩是**改渲染函数**得来的，不是 CSS 能凑出来的：`.float-window` 上有 `transform:
  translate(-50%,-50%)`，任何 `position:fixed` 的伪元素都会被这个 transform 关进窗口盒子，
  盖不到视口。所以只能把根节点换成 `[mask, window]` 的 Fragment。改的时候注意别动
  `s[0]` / `s[1]` 那组缓存槽（关闭按钮在用），遮罩的 onClick 直接写成箭头函数。
- 顶部画布切换条**必须命令式挂载**，别试图写回模板：App 根是 block
  （`openBlock` + `createElementBlock`），更新走 `patchBlockChildren`，`patchElement`
  传下来的 `optimized = true` 会直接跳过 children 的 diff——往 children 里塞 vnode，
  加 `patchFlag`、换 `key`、在 render 顶层读 ref 全都试过，DOM 纹丝不动（render 确实
  重跑，`store.list` 也有数据，只是不 patch）。所以是 `onMounted` 里 `createElement` +
  `prepend`，再 `watch([__xcatOpenTabs, list, currentId, dirty, busy], sync, { flush: 'post' })` 重建；
  代价是不在 vnode 树里，样式只能走全局 `#app .canvas-tabs-strip`（关闭按钮、未保存圆点、
  Unsaved 标签同理）。升级上游 dist 后 `TM()` / App setup 两处补丁都要重新对位重打，且新增的
  store 注入（`saveAsNew` / `duplicate` / `resetToUnsaved`）与 `bootstrap` 重写也要重新对位。

### 节点外观：去灰框 / 内容铺满 / resize 吸附网格（2026-11-12）

上游 `demo` 节点是一张「灰色卡片套卡片」：`.demo-node` 自带 `border:1px solid var(--c-line)`
\+ `padding:10px` + `radius:20px`，内部 `.media-stack-card` 再缩到 `width:84%` 且自带
1px 边框 / 深色底，于是图片四周留出一整圈灰框；空节点还有一圈虚线灰框。选中态只改
`border-color`，边框一旦去掉就没有任何选中提示。

**CSS（`assets/xcat-overrides.css` 末尾，幂等标记「节点改造：去掉灰色边框」）**

- `#app .demo-node`：`border:0 / padding:0 / radius:12`，保留 `background:var(--c-panel-2)`
  仅供空节点识别区域（有媒体时被完全盖住）；不能再给节点加 `overflow:hidden`，
  `.node-delete` / `.node-resize` / `.node-panel` 都是它的绝对定位子元素，会被裁掉。
- `#app .vue-flow__node.selected .demo-node`：用 `box-shadow:0 0 0 1px var(--xcat-sel)`
  的白色细环（宽度与 ComfyUI `strokeShape` 的 `lineWidth:1` 一致）；
  `.is-connect-hot:hover` 仍用 `0 0 0 2px var(--c-accent)` 的黄色环 —— 那是「可连接」语义。
- `.media-stack` 半径同步 12px，靠它自带的 `overflow:hidden` 统一裁切；`.media-stack-card`
  改 `width:100%` + 无边框 + 透明底 + 无阴影，图片 `object-fit:cover` 于是边缘到边缘铺满。
- 空节点 `.node-upload` 去掉虚线框、拉到 `100%×100%`，整个节点都是拖入/点击上传命中区。
- 音频没有画面可铺，`<audio>` 是替换元素，`left+right+width:auto` 会得到 **0 宽**，
  必须写死 `width:calc(100% - 24px)` 才能垂直居中显示原生控件。
- **图片等比 + 黑边（同视频）**：上游 `.media-stack-card img` 是 `object-fit:cover`，
  节点一改尺寸就裁图；而活动视频走的是独立组件 `.vp-video`，它自己写了
  `object-fit:contain;background:#000`，所以视频有黑边、图片没有。给卡片内的 `img`
  补上同样的 `contain + #000` 即可——`img` 本身是 100%×100%，背景色正好填满 contain
  留出的空白。**不要给卡片或节点加黑底**，否则空节点和音频节点也会整块变黑。
  只改节点内的 `img`：素材条 `.strip-item img`、悬停预览 `.preview-bubble img`
  仍按缩略图语义保留 `cover`。
- **视频控制条避让 resize**：`.vp-bar` 通宽贴底（`padding:7px 10px 8px`），最右侧是
  静音按钮；`.node-resize` 固定在 `right:4px / bottom:4px`、22×22、`z-index:21`。
  内容铺满后两者压在同一个角上，实测重叠 **16×18px**，`elementFromPoint` 在音量按钮
  中心命中的是 resize 的 svg，音量根本点不到。给 `.vp-bar` 加 `padding-right:36px`
  （独立幂等标记「视频控制条避让 resize 手柄」）：静音按钮与 `.vp-seek` 右端一起左移，
  右下角 26px 让给 resize，二者之间还留 10px 间隙。**没有移动 resize 的位置**（仍是
  右下角、拖动语义不变），也没有改 JS；图片 / 音频 / 空节点不受影响。
- 副作用：卡片 100% 宽后，非活动素材卡完全被活动卡盖住，左右「露头」的堆叠效果消失，
  多素材仍靠底部 `.media-dots` 与悬浮工具条切换。

**JS（`assets/index-BXU58XDe.js` 两处）**

- 默认 `snapGrid:[15,15]` → `[10,10]`：可见线格是 `Background gap:10`，
  原来的 15 会让拖动吸附和网格线错位；改成 10 后拖动落点也是 10 的倍数。
- 节点组件的 resize 处理器 `function w(S)`：原来只做
  `t.data.w=Math.round(Math.max(Pc,Ee))`，现在读 `n.snapToGrid.value` / `n.snapGrid.value`，
  开启吸附时宽高按网格取整，并用 `Math.ceil(min/g)*g` 兜住最小值（`Pc=400 / Ac=225`
  → 吸附态下限 400 / 230），关闭时完全保持原来的自由尺寸。`n=mt("demo")` 与工具条
  `window.__xcatFlow` 是同一个 store，所以底栏「网格吸附」开关直接生效。

验证（8199 + CDP）：`border=0 / padding=0 / cardW=nodeW=454 / 留白=0`、图片盒子与节点
盒子完全重合；开吸附 resize `+37/+23 → 490×250`、`-63/+41 → 400×270`（均 10 的倍数），
关吸附 `+37/+23 → 491×249`（自由）；开吸附拖动落点 130,140，关吸附 158,163；
暗/亮主题、多素材、音频节点、控制台无报错均通过。
图片黑边另测：3:1 图在 454×226 节点内显示 454×151（上下各 37px 黑边），
在 454×400 内显示 454×151（上下各 124px）；2:3 竖图在 454×226 内显示 151×226
（左右各 152px）；真实拖动 resize 到 574×316 后显示 574×191（上下各 62px），
`object-fit=contain`、背景 `rgb(0,0,0)`，截图采样黑边像素为纯 `#000`，
左右黄色/绿色边缘标记均完整可见（不再裁切）；亮色主题下空节点与音频节点仍是白底。
音量 / resize 分离另测：修复前重叠 16×18px，修复后 `overlap=false`，
`elementFromPoint` 命中 `.vp-btn` 内的 path；真实点击静音按钮 title 由「静音」变
「取消静音」且 `video.muted=true`；resize 自由拖 `454×226 → 515×269`、
开吸附 → `550×290`（10 的倍数）；多素材 `.media-dots` 与 resize 同样不重叠；
暗 / 亮主题、图片 `contain`、音频控件 430px 宽、空节点 100%×100%、控制台无报错均通过。

### 音频波形节点：用波形代替原生进度条（2026-11-12）

上游把活动音频卡渲染成 `<audio class="media-audio" controls>`，双击打开的大预览也是
`<audio controls>`，都是浏览器原生条。现在改成参考图那种「深灰圆角卡片 + 灰色圆头竖条
波形 + 蓝色播放头」：已播放的竖条变蓝。波形上**只有播放头能拖**（后来的改动，
见「播放头改成可拖动的滑块」小节），点波形其它位置不跳；控制条还有一条与视频
相同的细进度线也能拖。

**架构：不动 Vue 组件，用独立扩展接管 DOM**

dist 只有压缩后的单行 ESM bundle，没有源码也没有 `node_modules`，重建代价大。所以：

| 文件 | 改动 |
| --- | --- |
| `assets/index-BXU58XDe.js` | 两处 `<audio controls>` → 空 `<div class="xcat-audio-wave" data-src="...">`；动态 props 常量 `yx` / `Ub` 从 `["src"]` 改 `["data-src"]` |
| `assets/xcat-audio-wave.js` | **新增**，普通脚本（无 import / 无 Vue 依赖），波形实现 |
| `assets/xcat-overrides.css` | 新增 `--xw-*` 主题令牌与波形样式；`.media-audio` 从「居中 54px 原生条」改为 `inset:0` 铺满卡片 |
| `dist/index.html` | 追加 `<script defer src=".../xcat-audio-wave.js">` |

扩展用 `MutationObserver` 找容器并注入 `canvas + button + audio`。关键是 Vue 对
**children=null 的 element vnode 不管理 innerHTML**，所以节点数据更新、翻页、缩放时
注入的 DOM 不会被清掉；换素材（`data-src` 变化）由每个实例自己的 observer 处理。

**波形数据**：`fetch(src)` → `AudioContext.decodeAudioData` → 按 1600 桶取峰值（按 src
缓存），绘制时按当前宽度降采样到 `宽度/5` 根竖条。`Math.pow(x, 1.15)` 放大动态，
否则恒定振幅的音频会被画成一整块规整椭圆。解码失败 / 无 src 时用按 src 哈希生成的
确定性伪波形占位，视觉不空。颜色全部读 CSS 变量，`data-theme` 变化时统一重绘。

**几个必须注意的坑**

- `pointerdown / mousedown / click / wheel` 要在**冒泡阶段** `stopPropagation`：
  写在捕获阶段会连播放按钮自己的 click 一起吃掉；冒泡阶段则按钮先执行、再阻止事件
  传到 Vue Flow 节点包装器（拖节点）、卡片（切素材）和预览舞台（平移缩放）。
- `dblclick` **不拦**，保留双击打开大预览。
- 大预览弹窗 Teleport 到 `body`，不在 `#app` 内，`.is-preview` 的选择器**不能带
  `#app` 前缀**，否则会退化成铺满整个预览舞台（实测变成 954×694）。
- 播放按钮放**左下角**：右上是删除、右下是 resize、左上是播放头圆点，都会打架。

**验证**（8199 + CDP 真实鼠标，测试音为本地生成的 2.5s 带节奏 WAV）：
`decoded=true`（真实解码）、`duration=2.5s`、canvas 与节点同为 454×226；
点击播放 0.7s 后 `progress=0.265`、暂停生效；点击 72% → `progress=0.734 /
currentTime=1.836s`；在波形上拖动 seek 到 0.553 且**节点位置仍是 70,90**（没误拖节点）；
resize 到 544×286 后 canvas 同步重绘，已播放竖条变蓝；大预览波形居中 922×160；
亮色主题 `#eceef2` 底 / `#6f7684` 竖条 / `#2f8fff` 播放头对比清晰；
图片 `contain`、空节点、节点边框 0 均未回退；控制台无报错。

**未改**：资产库侧栏详情里的音频预览仍用原生 `<audio controls>`（不是画布节点）；
非活动音频卡仍是「音频」文字占位。需要的话可以一并换成同一套波形。

### 音频波形底部控制条 + 音量调节（2026-11-12）

口径：**只改音频节点底部，视频节点本身保持原样**；波形必须保留。另外视频节点的
音量按钮原本只有「静音 / 取消静音」两个状态，要能调音量大小，音频节点同样。

实现新增 `assets/xcat-media-controls.js`，**压缩 bundle 一行未改**：
视频 `.vp-bar` 末尾追加 `.xcat-vol` 音量滑块（绑定同一个 `<video>.volume`）；
音频 `.xcat-audio-wave` 底部追加 `.xcat-aw-bar`（播放/暂停、时间、静音、音量滑块）。

- **v2：两条控制条逐像素一致**。用户对比截图后发现 v1 的音频条播放/喇叭图标是
  18px（视频 14px），中间是 0px 的 `.xcat-aw-spacer`（视频是 222.7px `.vp-seek`
  灰线 + 黄点）。改为音频条内部元素直接复用上游 `.vp-btn` / `.vp-time` /
  `.vp-seek` 三个 class，并补上 `data-v-5b5d8e84`（VideoPlayer.vue 的 scoped id）
  让 `index-*.css` 的规则原样命中；图标 path 也按上游 14×14 照抄。
  `xcat-overrides.css` 里自抄的那几条 `.xcat-mc-btn` / `.xcat-aw-time` /
  `.xcat-aw-spacer` 规则已删除，避免以后数值再跑偏。
- 顺序与视频完全一致：「播放 / 时间 / 进度条 / 静音 / 音量」。波形仍在节点主体，
  控制条里的细线只是同一个 `<audio>` 的 seek 入口，与波形**双向同步**：波形拖动
  → 细线 `value` / `--progress` 更新；细线拖动 → 改 `audio.currentTime` 并派发
  `timeupdate` 让波形立刻重绘（暂停时 `timeupdate` 不一定触发，必须手动派发）。
  这样既保留「波形代替原生进度条」的初衷，两条控制条也长得一样。
- `.xcat-aw-bar` 外壳仍用自写样式（黑渐变贴底、8px gap、`7px 36px 8px 10px`，
  右侧 36px 给 `.node-resize` 让位），数值与 `.vp-bar` 一致；大预览没有 resize
  手柄，`.is-preview` 下右内边距回到 10px。
- 波形左下角原来的 `.xcat-wave-play` 小按钮由 CSS 隐藏，避免两个播放入口；
  **canvas、蓝色播放头、已播变色全部原样保留**（当时的「点击任意位置
  seek」后来已改成「只能拖播放头」，见最后一节）。
- 音量滑块与 `.vp-seek` 同一套视觉（`--accent-yellow` 填充 + 9px 圆点），填充走
  `--vol`。静音时滑块归零、取消静音恢复原值，拖到 >0 自动解除静音。视频静音按钮
  仍归 Vue 管（靠 `volumechange` 同步滑块），音频静音按钮由本脚本切换，不会双重 toggle。
- Vue 的 `.vp-bar` 有真实 vnode children，滑块**追加到末尾**而不是插进中间；Vue 按
  vnode 数组 patch，不会清理额外 DOM，播放 / 时间 / 进度更新照常。
- 注入用 `MutationObserver` + `rAF` 全量幂等扫描：波形脚本会先清空容器再建
  `<audio>`，扫描到 `.xcat-wave-audio` 存在才装控制条，执行顺序颠倒也能自愈。

**验证**（8199 + CDP 真实鼠标，本地生成 2.5s WAV 与 MediaRecorder webm）：
两条控制条实测同为 `454×35 / pl10 pr36 pt7 pb8 gap8 / 同款渐变`，子元素相对
x 与尺寸逐个相等：按钮 `10, 20×20`（svg 14×14）、时间 `38, 53.3×10`（10px）、
进度条 `99.3, 222.7×3`、静音 `330, 20×20`、音量 `358, 60×3`；
`audioBtn/videoBtn`、`audioTime/videoTime`、`audioSeek/videoSeek` 计算样式全等。
canvas 仍 454×226、蓝色播放头保留；波形点 72% → 1.84s 且细线同步 73.446%，
细线点 30% → 0.73s 且波形重绘；真实拖细线到 80% → 2.03s，节点位置始终
60,360（不误拖），音量滑块中心命中 `INPUT.xcat-vol`（不被 resize 抢走）。
视频音量 30% → 0.26、静音/恢复 0.26；音频播放 0.85s / 暂停 / 音量 50% /
静音归零；点时间文字 `currentTime` 变化 0；大预览、亮 / 暗主题、控制台无报错。

### 节点名称 / 操作按钮一行 / 音频条去细线（2026-11-12）

三处小改造，**压缩 bundle 仍未改**，只动 `xcat-media-controls.js`、
`xcat-overrides.css`、新增 `assets/xcat-node-names.js` 与 `index.html` 一行 script。

- **音频控制条中间的细进度线去掉**：波形本身已有蓝色播放头（当时还是
  点哪跳哪，后来改成只拖播放头），控制条里那条 `.vp-seek` 是重复信息。删掉 `xcat-media-controls.js` 里创建
  `<input class="vp-seek xcat-aw-seek">` 的代码与细线 seek / 手动派发
  `timeupdate` 逻辑，改成透明的 `<span class="xcat-aw-spacer">`（`flex:1`，
  实测仍占 222.7px）。播放 / 时间 / 静音 / 音量的 x 与尺寸逐项不变；
  时间文本改由 `loadedmetadata / durationchange / timeupdate / seeked / ended`
  直接刷新。视频条的 `.vp-seek` **保留**，两条条从此中间不同：这是刻意的。
- **节点顶部左侧名称**：新增 `xcat-node-names.js`，从
  `window.__xcatFlow.getNodes.value` 按 `data-id` 取名称 —— 有素材显示当前
  `media[index].name`（或 `ref.filename`），没素材显示 `data.label`（纯数字
  序号补成「节点 N」）。注入 `.xcat-node-name` 到 `.demo-node` 末尾，
  `pointer-events:none`，`MutationObserver(attributes:['title'])` + 1s 兜底
  定时刷新，切素材 / 改名后自动跟上。左上角胶囊：8px 内缩、22px 高、
  12px 白字、`rgba(12,14,18,.62)` 底，亮暗主题都可读。
  ⚠️ **z-index 必须 ≥ 30**：上游 `.media-stack-card.is-active` 是
  `z-index:10`，用 6 时只有空节点看得见名称（空节点没有媒体卡片层）；
  `node-ring(12) / node-delete(20) / node-resize(21) / node-actions(25)`
  也都在同一层叠上下文里。
- **上方操作按钮改成一行**：上游 `.node-actions` 用 inline style 把 6 枚
  `.fan-btn` 排成扇形（`left -120…120`、`top -28…-48`、尺寸 `30…38`，
  中间高两边低）。`xcat-overrides.css` 把容器改成节点正上方通宽 flex 行
  （`bottom:100%` / `gap:8px` / `padding-bottom:8px` / 居中），按钮统一
  `32×32`、svg `16×16`。inline 的 `left / top / width / height / transform`
  只能用 `!important` 压过；容器的 `width:0;height:0;left:50%` 同理。
  `opacity` 淡入与 `is-open` 时 `pointer-events:auto` 沿用上游规则。

**验证**（8199 + CDP 真实鼠标 / 截图，暗 + 亮主题）：6 枚按钮实测
`y=78` 全部相同、各 `32×32`、间距 8、svg `16×16`，`elementFromPoint`
命中自身且点「预览」能弹出 `.asset-mask`；名称 3 个节点分别为
`风景图.png` / `配乐.wav` / `节点 9`，改名后 1.4s 内刷新，拖节点后标签跟随；
音频条 `454×35`，子元素 x = `10 / 38 / 99.3(spacer) / 330 / 358`，
`.vp-seek` 0 个、spacer 1 个；视频条 `.vp-seek` 与 `.xcat-vol` 各 1 个未受影响；
波形点 72% → 1.84s、时间文本 `0:01 / 0:02`、节点不误拖；控制台无报错。

### 删除节点并入操作行末尾 / 波形上下留白（2026-11-12 续）

- **删除节点成为第 7 枚操作按钮**。上游 `.node-delete` 是 `.demo-node` 的独立
  子元素（右上 `top/right:-17px`、38×38、hover 才出现），直接把它的 DOM 挪进
  `.node-actions` 不可行：它由 `v-if(hover)` 渲染，鼠标离开再回来 Vue 会重新
  创建并插回原位。改为新增 `assets/xcat-node-actionbar.js`：
  CSS 隐藏原 `.node-delete`（**保留在 DOM**，事件 handler 还在），往
  `.node-actions` 末尾注入一枚 `.fan-btn.xcat-act-delete`（带 scoped id
  `data-v-abbe9e2b` 命中上游样式），点击时调用原按钮的 `.click()`，删除逻辑
  完全走上游（清进度 / 连线 / 素材引用）；原按钮缺失时兜底
  `__xcatFlow.removeNodes([id])`。注入同样用 `MutationObserver` 幂等扫描 +
  1s 兜底，hover 重建后会自动补上。按钮 hover 变 `--c-danger`，未 hover 时
  整个 `.node-actions` 被 Vue 卸载，仍是「hover 才可用」。
  ⚠️ 右上角那枚 **× 是 `.card-delete`「删除这张素材」（单张素材），不是删除
  节点**，按用户要求保持原样，不要一起隐藏。
- **音频波形上下留白**。原来 `PAD_Y=12` 上下各 12px，且播放头蓝线
  `moveTo(x,0)→lineTo(x,h)` 贯穿全高，视觉上顶天立地；底部 12px 还被
  35px 控制条盖住。`xcat-audio-wave.js` 改成 `plotBox(h)`：
  顶部 `clamp(h*.16, 34, 44)`（让 8~30px 的名称胶囊与半径 5px 的播放头圆点
  都落在留白里）、底部 `clamp(h*.20, 44, 56)`（控制条 35px + 9px 间隙），
  竖条与播放头线都只画在绘图区内。226px 节点实测非透明像素
  `y=31…182`：上留白 31px、下留白 44px，控制条高 35px；亮暗主题、
  resize、大预览按同一比例自适应。

**验证**：7 枚按钮 `y=78` 全对齐、各 `32×32` / svg `16×16`，最后一枚
`title=删除节点`；hover 后 `color/border=rgb(255,107,107)`、命中自身，
移开后 `actionsRemoved:true / deleteBtn:false`；hover 离开再进入按钮仍存在，
点击后节点数 `2→1`（删的是目标节点）；canvas alpha 扫描确认上下留白；
控制台无报错。脚本 `cdp_delete_btn.js` / `cdp_del_hover.js` /
`cdp_wave_padding.js`，截图 `delbtn-dark.png` / `wave-pad-dark.png` /
`wave-pad-light.png`。

### 操作按钮按素材类型出现 / 无素材只留「预览」（2026-11-12 续 3）

用户要求：**「单节点、无素材的时候，顶部功能只显示预览和删除节点；加载不同素材
显示不同功能，裁切、扩图、宫格只适合图片，其他素材不需要显示」**。上游的做法是
6 枚按钮恒定渲染、不适用的置灰（`isDisabled`），所以空节点上也挂着裁切 / 扩图 /
宫格 / 下载 / 全部下载五枚灰按钮。现在改成**按类型过滤，不适用的直接不渲染**。

- 改动只有一处：bundle 里 `NodeActions` 的渲染 `st(L, …)` 换成
  `st(xcatFanActions(), …)`（**两处**：节点上方按钮行 + 面板左侧工具列，共用同一份
  结果），另外新增 `xcatFanActions()` 过滤动作表 `L`。补丁脚本
  `.workbuddy/tmp/patch_fan_by_kind.py`（幂等，备份 `index-BXU58XDe.js.fanfilter.bak.js`）。
- 规则（`xcatFanActions()` 内，`kind` 取当前素材 `media[index].kind`）：

  | 按钮 | 出现条件 |
  | --- | --- |
  | 预览 | 恒在；**无素材时它就是唯一一枚** |
  | 裁切 / 扩图 / 宫格 | `kind === "image"` |
  | 下载 | 有当前素材（图片 / 视频 / 音频及其它类型都给，`/view` 能取二进制） |
  | 全部下载 | `media.length >= 2`（本包已限「一个节点一个素材」，实际基本不出现） |

- 「删除节点」不在这张表里：它仍由 `xcat-node-actionbar.js` 注入在按钮行末尾，
  所以空节点的行 = `预览 ▸ 删除节点` 两枚，正好是用户要的样子。
- 按钮行本身是通宽 flex 居中（见上节），数量变了自动重新居中；
  **不用重排坐标** —— 上游 inline 的扇形 `left/top/width` 已被 `!important` 压掉。

**验证**（8198 隔离实例，测试画布手工造了「空 / 图片 / 视频 / 音频」四个节点，
真实 `mouseMoved` 悬停后读 DOM）：

| 节点 | 素材 | 按钮行 |
| --- | --- | --- |
| 92 | 无 | 预览 / 删除节点（2 枚，`cx` 371·421，`y` 同高） |
| 93 | image | 裁切 / 扩图 / 预览 / 宫格 / 下载 / 删除节点（6 枚） |
| 94 | video | 预览 / 下载 / 删除节点（3 枚） |
| 95 | audio | 预览 / 下载 / 删除节点（3 枚） |

面板左侧工具列同步过滤：视频节点打开预览 → `预览 / 下载`；空节点 → 只有 `预览`，
预览区显示上游的「暂无素材」。截图 `.workbuddy/tmp/fan-92.png` / `fan-93.png` /
`fan-94.png`，脚本 `verify-fan.js` / `verify-fan-panel.js`。

### 音频播放头改成可拖动的滑块（2026-11-12 续 2）

用户要求：**「不能鼠标点哪里，滑块到哪里，而是鼠标移动到滑块上，出现左右箭头，
然后拉动」**。只改 `assets/xcat-audio-wave.js` + `xcat-overrides.css` /
`xcat-media-controls.js` 的注释与令牌，压缩 bundle 与 index.html 未动。

- **命中判定**：新增 `headX(inst)` / `hitHead(inst, clientX, clientY)`。
  只有指针落在蓝色播放线水平 `±9px`、且纵向在绘图区（上下各外扩 12px）
  内才算「在滑块上」。`pointerdown` 不命中就直接 return —— 点竖条 / 留白 /
  控制条都不再跳进度；`el` 原有的冒泡拦截保留，节点也不会被误拖。
- **视觉反馈**：平时只画半径 5px 的蓝色小圆点；`hoverHead || dragging` 时
  圆点换成 **32×18 蓝色圆角胶囊 + 白色左右 chevron 箭头**，播放线加粗到
  3px，容器光标 `ew-resize`（基线 `cursor:default`）。新增 `--xw-head-fg`
  令牌控制箭头颜色（亮暗主题都是白）。胶囊 x 被 `clamp(hx-16, 1, w-33)`
  夹在容器内，拖到 0% / 100% 也不会被 `overflow:hidden` 切掉半边。
- **拖动**：按下时记 `dragDX = clientX - (rect.left + headX)`，避免起手瞬间
  跳到指针位置；`setPointerCapture` 后 `pointermove` 用 `clientX - dragDX`
  调 `seekAt`。`timeupdate` / rAF `loop` 在拖动中跳过 `sync()`，否则音频
  当前时间会把播放头拽回去。松手后按当前位置重算 hover。
- **播放时自动收起**：新增 `lastX/lastY` + `refreshHover()`，每次 `sync()`
  后按最后鼠标位置重算命中。播放头自己往前跑、鼠标不动时，跑出 9px 命中区
  箭头就消失并复位光标，不会留下一个跟着蓝线漂走的假手柄。
- 控制条时间文本仍由 `timeupdate` 独立刷新，不受上面 guard 影响；已播放
  竖条变蓝、点击 / 拖动波形 seek 的旧语义全部**作废**（控制条细线的拖拽
  seek 在下一节又恢复了）。

### 音频条恢复细进度线 / 节点恢复可拖（2026-11-12 续 3）

用户两点反馈：**「音频节点底部细滑块恢复和视频节点一样」**、
**「音频节点鼠标放上去为什么是箭头，视频图片都是一只手，并且可以拖动」**。

- **细进度线恢复**：`xcat-media-controls.js` 的音频条把透明 `.xcat-aw-spacer`
  换回 `.vp-seek xcat-aw-seek`（`type=range`、带 `data-v-5b5d8e84`），并恢复
  `syncSeek()` / `input` 监听。实测两条条逐项同几何：bar `454×35`、
  `pl10 pr36 pt7 pb8 gap8`；子元素 `播放 10/20×20`、`时间 38/53.3×10/10px`、
  `进度 99.3/222.7×3`、`静音 330/20×20`、`音量 358/60×3`，即与视频条完全一致。
  细线与波形播放头**双向同步**：拖细线改 `currentTime` 并派发 `timeupdate`，
  波形立刻重绘；拖波形播放头改 `currentTime`，`seeked` 让细线跟上。
- **节点能拖了**：根因是上游把 `<audio>` 渲染成
  `class="media-audio xcat-audio-wave nodrag"`，`nodrag` 是 Vue Flow 的
  「不许拖节点」标记，`event.target.closest('.nodrag')` 命中后整块区域都不拖。
  `xcat-audio-wave.js` 在 init 里 `el.classList.remove('nodrag')`，并用
  `attributeFilter:['class']` 的 MutationObserver 持续摘掉（Vue patch 会写回）。
  控制条 `bar` 与内部按钮 / 滑块自己带 `nodrag`，所以条内操作不会拖节点；
  只有按住播放头时才 `stopPropagation + preventDefault`（pointerdown 与
  mousedown 各拦一次，d3-drag 走 mousedown）。
- **光标对齐**：上一版给 `.xcat-audio-wave` 写了 `cursor: default`（箭头），
  视频 / 图片节点继承 `.media-stack-card` 的 `pointer`（一只手），所以不一致。
  改成 `cursor: inherit`，音频节点与视频 / 图片一样是手型、一样的拖拽手感；
  hover 播放头时 JS 仍 inline 覆盖成 `ew-resize`，移开清掉 inline 回到手型。

**验证**（8199 + CDP 真实鼠标，4s WAV，脚本 `cdp_audio_parity2.js` /
`cdp_drag_diag.js` / `cdp_bar_parity.js`）：音频 `cursor:pointer`、节点
`cursor:grab`；波形空白按下拖动节点 `60,80 → 120,110` 且进度保持 0；
hover 播放头 `ew-resize`；拖播放头到 50% → `currentTime 2.0 / seek.value 2 /
progress 0.5`；点细线 75% → `3.04s / progress 0.76`、节点不动；
两条控制条子元素几何全等；暗 / 亮主题、控制台无报错。

**验证**（8199 + CDP 真实鼠标，本地 4s WAV，脚本 `cdp_wave_grab.js`）：
点波形空白 `currentTime 0→0 / progress 0→0`、节点坐标 `60,80` 不变；
hover 播放头 `hoverHead:true / cursor:ew-resize`，截图确认圆点→箭头胶囊
（暗色、亮色、最左端夹边都完整）；从播放头拖到 75% → `progress 0.75 /
currentTime 3.00s / duration 4s`，松手保持、节点不误拖；移开后
`hoverHead:false / cursor:default`；0.1 倍速播放时鼠标不动、播放头走远后
`hoverHead` 自动 false；控制台无报错。截图 `wave-grab-*.png`。

### 控制条整体重做：视频 / 音频共用一套自绘（2026-11-12 续 4）

前面几轮一直在「修」借用上游 `.vp-*` 的音频条，用户最终判定方向不对，直接
下令：**「或者你直接删除这几个控件，重新做一组」**。于是音频条整组换成自绘
（`5b7ec0a`），接着用户补了一句 **「视频节点也一样要改啊」**，视频条同步替换。

- **视频条怎么换**：`.vp-bar` 是压缩 bundle 里 `VideoPlayer` 的渲染产物
  （`.video-player` 下 `[video.vp-video, div.vp-bar]`），改它等于重写渲染函数。
  做法与节点操作按钮一致 —— **把原条隐藏但留在 DOM 里**（`display:none` +
  `data-xcat-off="1"`，Vue 的 patch 仍以它为锚点，children 按 vnode 数组管理、
  不按 childNodes 索引重排，所以不会报错），再往同一个 `.video-player` 里追加
  自己的 `div.xcat-mbar.xcat-vbar`。原条里的 `input.vp-seek` 仍在、仍会被
  `timeupdate` 写值，但 `display:none` 不进渲染、不产生任何像素。
- **两套条共用一份实现**：`xcat-media-controls.js` 里 `buildBar(media, cls)`
  只管 `<video>` / `<audio>` 的事件与时间，几何全部来自 `.xcat-mbar`；
  音频挂 `.xcat-aw-bar`、视频挂 `.xcat-vbar`，内部统一 `.xaw-*`。
- **几何**：`padding: 7px 10px 8px` + `gap 8`；节点里
  `.demo-node .xcat-mbar { padding-right: 36px }` 让开 `.node-resize`
  （right 4 / bottom 4 / 22×22 / z-index 21），大预览里没有手柄就回到 10px。
  子元素：按钮 20×20 / 时间 53.28（三段 `22+9+22`）/ 进度 222.72×14（其中线 3px）
  / 音量条 60。
- **为什么必须是自绘**：原生 `input[type=range]` 的 thumb 按整像素吸附、内缩
  4.5px，222.72px 的条播放 99.88s 每秒只走 1.55px，看起来就是每秒一顿；
  `--progress` 渐变同理只能整像素跳；时间串宽度随数字变化还会挤动右侧元素，
  被压窄时浏览器直接画省略号（就是用户看到的「三个蓝点」）。
  新实现：轨道 / 填充 / 圆点三个 `span`，位置只写
  `transform: scaleX()` + `translate3d()`（亚像素、合成层、不触发布局），
  宽度缓存在 `spanPx`（`ResizeObserver` 更新），paint 每帧不读 `clientWidth`。
- **播放跟随**：不再只吃 `timeupdate` 的 ~4Hz，播放中 `requestAnimationFrame`
  每帧刷进度；秒数没变就不碰文本节点。

**实测**（8199 + CDP 真实鼠标，节点 `81` = `11月9日(1).mp4`，缩放归 1）：

| 指标 | 结果 |
|---|---|
| bar | 454×35，`pad 7px 36px 8px 10px`，gap 8 |
| 时间 / 进度 / 音量 | 53.28 / 222.72 / 60（与音频条逐项相同） |
| 40 帧采样 | 39 帧有位移，**整数位移帧 0%**，步长 0.10~0.30px 连续 |
| 时间宽度 | 全程恒定 53.28（`0:00/0:15` → `0:01/0:15` 不变） |
| 拖动 | 30%→80% ⇒ `currentTime 12.19 / thumb translate3d(173.9px)`，节点坐标不变 |
| 静音 / 播放 | `muted` 双向切换、图标与 title 同步；播放 / 暂停图标正常 |
| 上游条 | `display:none`，`height:0`，不占位不吞事件 |
| 控制台 | 无报错 |

`index.html` 资源版本：`xcat-overrides.css?v=20261112g`、
`xcat-media-controls.js?v=20261112g`（改这两份文件后必须同时改版本号，
否则浏览器会拿旧缓存）。

### 连线与连接点：全部照 ComfyUI litegraph 源码取值（2026-11-12 续 12 / 14 / 15）

用户要求：**「接线的虚线实在看不清，参考 comfyui 的接线；节点选中时不要黄色，用白色」**
→ **「参考 comfyui 的连线方式，你参考了吗？接头颜色与线的颜色也要一致」**
→ **「我让你去 comfyui 看源代码，不要给我看着截图抄」**。

> **取值方式（这条是硬规矩）**：不看截图目测，从前端包
> `python_embeded/Lib/site-packages/comfyui_frontend_package/static/assets/*.js.map`
> 的 `sourcesContent` 里解出 litegraph 原始 TS，再照抄。
> 导出脚本 `.workbuddy/tmp/extract_litegraph.py`，解出的源码落在
> `.workbuddy/tmp/comfy-src/`（`LGraphCanvas.ts`、`NodeSlot.ts`、`SlotBase.ts`、
> `linkSnapGeometry.ts`、`pathRenderer.ts`、`litegraphLinkAdapter.ts`）。

#### 源码依据（文件 : 行）

| 规范 | 源码出处 | 原文 |
|---|---|---|
| 贝塞尔控制点 | `canvas/linkSnapGeometry.ts:6,92-101` | `SPLINE_CONTROL_RATIO = 0.25`；`distance = Math.hypot(dx,dy) * 0.25`，两端各按方向偏移 |
| 渲染模式 | `LGraphCanvas.ts:1394` | `links_render_mode = LinkRenderType.SPLINE_LINK` |
| 线宽 | `LGraphCanvas.ts:1400` | `connections_width = 3` |
| 外描边开关 | `LGraphCanvas.ts:1387` | `render_connections_border = true` |
| 外描边宽度 | `litegraphLinkAdapter.ts:100` | `borderWidth: context.renderBorder ? 4 : undefined` |
| 外描边颜色 / 画法 | `pathRenderer.ts:185-203` | 先 `connectionWidth + borderWidth` 描 `rgba(0,0,0,0.5)`，再画 `connectionWidth` 本色 |
| 线帽 / 拐角 | `LGraphCanvas.ts:6542`、`pathRenderer.ts:183` | `lineCap='round'`、`lineJoin='round'` |
| 高亮色 | `litegraphLinkAdapter.ts:115` | `highlighted: '#FFF'`（**只换色，线宽不变**） |
| slot 圆点半径 | `node/NodeSlot.ts:189` | `radius = highlight ? 5 : 4` ⇒ 直径 8px，hover 10px |
| slot 圆点颜色 | `node/SlotBase.ts:44-48`、`NodeSlot.ts:190-196` | 已连接 `color_on \|\| getConnectedColor(type)`；未连接 `color_off \|\| getDisconnectedColor(type)` |
| slot 默认色表 | `LGraphCanvas.ts:561` 附近 | `default_connection_color = { input_on:'#7F7', output_off:'#778', output_on:'#7F7' }` |
| slot 描边 | `NodeSlot.ts:130,233` | `doStroke` 默认 **false**，圆点无描边 |

#### 本包实现

| 项 | ComfyUI | 本包 |
|---|---|---|
| 连线颜色 | `LINK_COLOR #9A9` | `--xcat-link` = `#99aa99`，3px 实线，round |
| 拖拽线 | `CONNECTING_LINK_COLOR #AFA` | `--xcat-link-connecting` = `#aaffaa`，3px |
| 外描边 | 7px（3+4）`rgba(0,0,0,.5)` | **SVG filter `#xcat-link-halo`**：`feMorphology dilate radius=2` + `feFlood #000 / .5` + `feMerge`（3 + 2×2 = 7px，同宽） |
| hover 连线 | `#FFF`，宽度不变 | `--xcat-link-hot`，**不再加粗**（原 4px 已删） |
| 选中节点 | 白色描边 `#FFF`、`lineWidth:1`、`globalAlpha:.8`、外扩 `padding:6` | `box-shadow: 0 0 0 1px var(--xcat-sel)`（宽度照源码，不再是我拍的 2px；环紧贴节点边，未做 6px 外扩） |
| **选中节点的连线** | `highlighted_links` → `#FFF`，宽度不变 | `.xcat-edge-hot` → `--xcat-link-hot`（见「选中节点时连线一起高亮」） |

- 外描边用 SVG filter 是因为一条 `<path>` 只能一层 stroke，而 ComfyUI 是 canvas 画两遍；
  filter 定义内联在 `index.html` 的 `<body>` 里（`#xcat-link-halo`），
  `edge-path` 与 `connection-path` 都挂 `filter: url(#xcat-link-halo)`。
- 上游画布原本是 `--c-edge`（#3c3c48）+ `stroke-dasharray: 6 5` 的虚线，深底上几乎看不见。
- `.demo-node.is-connect-hot:hover` 的黄色仍然保留 —— 那是「可连接」语义，不是选中。
- 亮色主题按同色阶镜像：`--xcat-link: #6f7f6f`、`--xcat-link-hot: #111318`
  （白线/白环压在浅底上等于看不见）。接头颜色见下一节（`--xcat-slot`）。

**选中描边宽度为什么是 1px**（2026-11-12 续 18）
- `src/lib/litegraph/src/LGraphNode.ts:1217` `_getSelectedStrokeStyle()` 只返回
  `{ padding: has_errors ? 20 : undefined }`，**不传 lineWidth / color**；
- 落到 `src/lib/litegraph/src/draw.ts:69` `strokeShape()` 的默认值：
  `lineWidth: 1`、`color = NODE_BOX_OUTLINE_COLOR`（实为 `#FFF`）、`padding: 6`、
  `ctx.globalAlpha = 0.8`；
- 对照：`running`（`litegraphService.ts:268`）与 `executionError`（`:278`）才显式
  `lineWidth: 3` —— 所以 3px 是「运行中 / 报错」，不是选中。
- 结论：选中白环 = **1px**，且画在节点外 6px、80% 不透明。本包用
  `box-shadow: 0 0 0 1px`（紧贴节点边、纯白），缩放时是固定 CSS px，
  而 ComfyUI 是 canvas 图内尺寸、随缩放变粗。

#### 选中节点时，相连的线一起变白（2026-11-12 续 17）

ComfyUI 的语义在 `LGraphCanvas.selectionView`：

```ts
const keys  = selectionStore.selectedKeys(graphScopeOf(graph))
const nodes = items.filter(item => item instanceof LGraphNode)
const linkIds = nodes.flatMap(node => nodeLinkIds(graph, node))   // ← 选中节点的所有 link
// renderLink: colors.highlighted = '#FFF'，线宽不变
```

Vue Flow 没有这个联动，边与节点又是两棵兄弟子树，CSS 选不到 ⇒ 加一层 DOM 桥接
`xcat-edge-hot.js`（`defer` 引入，纯前端、不写盘）：

1. `.vue-flow__node.selected` → 选中节点 id 集合；
2. `window.__xcatFlow.getEdges.value` → `edge.id / source / target`；
3. 命中的 `.vue-flow__edge[data-id]` 加 `.xcat-edge-hot`；
4. `MutationObserver`（只看 `.vue-flow__nodes` / `.vue-flow__edges` 的 `class` 变化）
   \+ `pointerup / keydown / keyup` 兜底，`requestAnimationFrame` 合并节流。

样式只有一条：`#app .flow-wrap .vue-flow__edge.xcat-edge-hot .vue-flow__edge-path
{ stroke: var(--xcat-link-hot) }` —— 只换色不加粗，与 ComfyUI 一致。

实测（8199，fitView 后真实点击）：点节点 94 → `selected=[94]`、`e21 hot=true
rgb(255,255,255)`、`e20 hot=false rgb(153,170,153)`；再点节点 92 → 两条都白；
点空白 → 全部 `hot=false` 回到 `rgb(153,170,153)`，节点白环同时消失。


#### 曲率：把 Vue Flow 的贝塞尔换成 litegraph 公式

上游 edge 的 `type` 是 `"canvas"`，但 `edgeTypes:{}` 是空的 ⇒ Vue Flow 回退到默认
bezier 曲线，控制点按 **`offset = 0.5 × dx`** 算，S 形比 ComfyUI 夸张得多。

补丁 bundle 里的 `Ec`（Vue Flow `getControlWithCurvature`，
`il` / `DefaultBezierEdge` 与 connection-line 预览共用它），
`qs(dx, curvature)` → `D = 0.25 * Math.hypot(dx, dy)`，四个方向分别 ±D：

```js
function Ec({pos:e,x1:t,y1:n,x2:o,y2:i,c:s}){let r,l,D=.25*Math.hypot(o-t,i-n);
  switch(e){case Ue.Left:r=t-D,l=n;break;case Ue.Right:r=t+D,l=n;break;
  case Ue.Top:r=t,l=n-D;break;case Ue.Bottom:r=t,l=n+D;break}return[r,l]}
```

- 脚本：`.workbuddy/tmp/patch_edge_curvature.py`（幂等，首次自动备份
  `index-BXU58XDe.js.edgecurr.bak.js`）。
- 成品线和拖拽预览线共用同一个 `Ec`，曲率天然一致。
- 注意：改 bundle 后文件名不变，必须同时改 `index.html` 里主 js 的 `?v=`
  （已从无版本号改为 `?v=20261112n`），否则浏览器吃旧缓存。

#### 实测（8199，缩放 2）

```
edge  : d="M754,133 C799.04,133 874.96,63 920,63"    // dx166 / dy-70 → D=45.05 ✓
        stroke rgb(153,170,153) / 3px / linecap round / linejoin round
        filter url("#xcat-link-halo")，filter 元素存在（4 个子节点）
handle: 10px，`rgb(170,170,170)` + `inset rgb(178,178,178) 1px`（详见下一节）
        hover → 12px，颜色不变（与 NodeSlot 的 r4→5 同比例）
```

放大 4 倍的截面截图确认：3px 灰绿芯线 + 两侧各 2px 半透明黑描边（`halo-crop.png`）。

### 连接点：10px 灰圆点（#AAA + 亮边），圆心压在边框线上、线贴圆边（2026-11-12 续 5 / 11 / 13 / 16）

需求演进：**「两个接头，圆形小圆点（10），不紧贴侧面」** → **「在框里了，我要在框外」**
→ **「接头圆心给我在边框上，不偏移」** → 最终 **「接头是这样的，而且线和接头是连在一起的」**
（附 ComfyUI 放大截图：灰圆盘 + 一圈更亮的细边，绿线从圆周长出、无缝）。

#### 1. 几何：定位盒尺寸 = 圆点直径（这是「线连上圆点」的关键）

上游 `.node-port` 是 **20×20** 的透明定位盒，`left:0/right:0` + `translate(∓50%)`，
可见部分由 `::before` 画 20px 圆再 `clip-path` 切一半 —— 「半个圆饼贴着侧边」。

- **方向**：盒子被 `translate(-50%)` 平移半个宽度，所以
  **「圆心相对边缘的偏移 = left / right 的值」**，正值向内、负值向外。
  `10px` → 落进框内（错）；`-10px` → 整体框外（也不要）；**`0` → 圆心压在边框线**（最终）。
- **端点由盒子矩形决定，不是圆心**：Vue Flow 的 `getHandleBounds` 给
  `position:right` 取 `box.x + box.width`、`left` 取 `box.x`。盒子 20px 时端点落在
  边框外 **10px**，而圆点半径只有 5px ⇒ **线和圆点之间空 5px 缝**（上一版就是这样，
  用户直接指出「线没连上」）。
  ⇒ 把盒子 `width/height` 设为 **10px（= 圆点直径）**，端点正好落在
  「边框 ±5px」= **圆周上**，线从圆边长出。
- 命中区不受影响：那是 `.port-hit`（72×72 独立子元素，`pointer-events` 由
  hover / `.is-on` 控制），与盒子尺寸无关；实测 hover 仍命中 `port-hit`。
- **必须补 hover 来源**：上游圆点「`.demo-node:hover` 才淡入」，圆点在边框上后鼠标
  一移出去就 `opacity:0`，等于点不到。故 `.node-port` 常驻 `pointer-events:all` +
  `:hover{opacity:1}` + `:hover .port-hit{pointer-events:all}`。
- `z-index:15`：圆点一半在卡片内，必须压过 `.media-stack-card`(10)；
  仍低于删除(20)/缩放(21)/操作行(25)/名称(30)。

#### 2. 外观：`#AAAAAA` 圆盘 + `#B2B2B2` 亮边

源码依据：`NodeSlot.draw` 里 `radius = highlight ? 5 : 4`、`doStroke` 默认 false；
`SlotBase.renderingColor()` → comfy 的 `getSlotColor(type)` =
`` `var(--color-datatype-${T}, #AAA)` `` —— 画布节点没有 datatype 变量，**落回 `#AAA`**，
与是否已连接无关（`color_on/color_off` 为空）。

用户截图实测（10 倍放大）：圆盘 `(170,170,170)` = `#AAA`，外圈 `(178,178,178)` ≈ `#B2B2B2`，
边厚约为直径的 1/8；线芯 `(153,170,153)`，线宽/直径 = 3/8。

- 圆点：`background: var(--xcat-slot)`（暗 `#aaaaaa` / 亮 `#8f8f8f`）
  \+ `box-shadow: inset 0 0 0 1px var(--xcat-slot-rim)`（暗 `#b2b2b2` / 亮 `#a3a3a3`）。
  **必须用 inset shadow 而不是 border**：border 会撑大外径、把圆心挤偏。
- hover 只放大 10→12px、不改色（照 `NodeSlot` 的 4→5，`highlight` 不影响填充色）。
- 上一版「已连接=线色 / 未连接=#778788」作废（用户明确接头就是 `#AAAAAA`）。

#### 3. 实测（8199，缩放 1.149）

| 项 | 值 |
|---|---|
| handle 盒 | `10 × 10`（CSS px），圆心与节点右边框偏移 **0px** |
| 圆点 | `10px` / `rgb(170,170,170)` / `inset rgb(178,178,178) 0 0 0 1px` |
| edge 起点 | 距边框 **5px**、距圆心 **5px** = 半径 ⇒ **正好在圆周上，无缝隙** |
| `handleBounds` | `source {x:449,width:10}`、`target {x:-5,width:10}`（节点宽 454） |
| hover | `opacity 1` / 12px / `port-hit` 命中 `pointer-events:all` |

1:1 像素扫描（圆心横切）：`x34 卡片(51,51,51)` → `x35 亮边(176)` → `x36~43 圆盘(170)`
→ `x44 亮边(177)` → `x45 起绿线(135,150,135)→(150,166,150)` —— **圆点直径 10px、
亮边 1px、线紧接圆边无空隙**。8 倍放大图见 `.workbuddy/tmp/final-port-z1x8.png`。

### 连线中点圆点：点一下断开这条线（2026-11-12 续 17）

需求：**「线的中间要有（圆点），点击可以断开线」**（附 ComfyUI 10 倍放大截图：
线色实心圆骑在线上，周围没有黑描边）。

#### 源码真值（`renderer/core/canvas/pathRenderer.ts`）

```ts
calculateCenterPoint()
  spline ⇒ findPointOnBezier(0.5, startPoint, cp[0], cp[1], endPoint)  // 曲线参数中点
drawCenterMarker()
  if (centerMarkerShape === 'arrow') … else ctx.arc(pos.x, pos.y, 5, 0, 2π)
  ctx.fillStyle = color   // 就是这条线的颜色；disabled 时才用条纹图案
```

- 半径 **5**（画布图内单位 ⇒ 随缩放变），**填充线色**，无描边、不套那圈 7px 黑 halo
  （直径 10 > 3 本色 + 4 外描边 = 7，正好把线盖干净，所以放大看边缘是干净的圆弧）。
- 绘制条件：`showCenterMarker && scale >= 0.6 && highQuality`；
  `linkMarkerShape` 默认 `Circle`。
- 交互：画布上这是 link 的命中点，点它等于删掉该 link。

#### 实现（`xcat-edge-mid.js` + `xcat-overrides.css`）

- 往每条边的 `<g class="vue-flow__edge" data-id>` 里塞**两个** `<circle>`：
  - `.xcat-edge-mid`（`r=5`）—— 显示的实心圆点，`fill: var(--xcat-link)`；
  - `.xcat-edge-mid-hit`（`r=10`，`fill: transparent`、`pointer-events: all`）——
    透明命中圆，**append 在圆点之后 = 叠在它上面**接鼠标（见踩坑第 3 条）。
  - `cx/cy = path.getPointAtLength(len/2)`（任何 path 都成立，且与参数中点等价）。
    circle 挂在 viewport 的 transform 里 ⇒ **平移/缩放自动跟随，半径天然是图内单位**。
- 样式：选中节点相连 / 边选中时走 `--xcat-link-hot`（ComfyUI 同一套 `colors.highlighted`）；
  `cursor: pointer`。
  **不套 `filter: url(#xcat-link-halo)`** —— 套了圆点会被黑边包一圈。
- `zoom < 0.6` 时两个 circle 一起 `display:none`（对齐源码的 scale 阈值）。
- 点击：`window` 的 `pointerdown` 捕获阶段拦下（命中圆、圆点都认），
  `flow.removeEdges([id])` —— 与 Delete 删边同一条 action，上游自动存盘链路直接生效。
- hover 命中圆 ⇒ 圆点加 `.is-hot`：**实心圆镂空成圆环**（替掉上游的红色叉号按钮），
  详见下节。

#### hover 的圆环，替掉上游那个红色叉号

用户：**「删除连线的时候（红色圆环 + 红叉）看着很不舒服，换成（空心圆环）」**。
那张红的是上游 `index-*.css` 里的 `.edge-delete`：18px 圆 + 9px X 图标，
`hover` 时 `color / border-color` 都变 `--c-danger`，**悬停到整条线上就浮出来**
（`.edge-hit` 是 24px 宽的透明描边路径，一碰整条线 `is-on` 就亮）。

- `.edge-tool` 整块 `display: none`（teleport 到 `.vue-flow__edge-labels`，
  `#app .flow-wrap .edge-tool` 能命中，特异性 (1,2,0) > 上游 `[data-v-*]` (0,2,0)）。
  删除只保留中点这一处，不再有红点闪现。
- 圆环几何照用户给的参考图量：环外径 / 线宽 = **3.4**、环宽 / 线宽 = **0.7**、
  孔径 / 外径 = **0.6**。线宽 3 ⇒ 外径 10、环宽 2、孔径 6 ⇒ `r: 4` + `stroke-width: 2`
  （外沿 4+1=5，与实心时半径一致，所以 hover 时**外轮廓不跳**）。
- `fill: var(--xcat-link-hole)`（暗 `#000`、亮 `#1b1d1f`）：纯黑孔盖住线，
  线不往洞里穿，读起来像「线上开了一个可删的洞」。
- 圆环颜色跟线：hover 圆环时给 `<g>` 加 `.xcat-edge-marker-hot`，
  把 Vue Flow 那条 `.vue-flow__edge:hover .vue-flow__edge-path{stroke:white}`
  压回 `--xcat-link`，环与线同色；选中节点相连的边（`.xcat-edge-hot`）仍保持白。
- 实测（8198 隔离实例，真实鼠标）：静止 `r 5 / fill rgb(153,170,153)`；
  hover 圆心 `r 4 / fill rgb(0,0,0) / stroke rgb(153,170,153) / stroke-width 2px`，
  线仍是 `rgb(153,170,153)`；`.edge-tool` 全程 `display:none`；点一下 `edges 2 → 1`、
  圆点与命中圆同步消失；亮色主题下 `fill rgb(27,29,31) / stroke rgb(111,127,111)`。

#### 踩坑

- **`.vue-flow__edges` 不是「一个」svg**：Vue Flow 给**每条边单独建一个**
  `<svg class="vue-flow__edges">`。先取 `document.querySelector('.vue-flow__edges')`
  再往里找，永远只能拿到第一条边 ⇒ 改成全局
  `document.querySelectorAll('.vue-flow__edge[data-id]')`，observer 挂到公共父级
  `.vue-flow__transformationpane`。
- 首次渲染时序也对不上（`<g>` 先挂、`path` 后写 `d`），观察器容易漏一次，
  另加 500ms 兜底轮询（边数量级小，开销可忽略）。
- **命中圆必须叠在圆点上面**：先按「命中圆在下、圆点在上」写，实测 hover 圆心无效、
  只有圆点边缘一圈能用 —— 指针落在圆心那 10px 里命中测试拿到的是圆点本身，
  命中圆收不到 `pointerenter`。把 append 顺序换成 `dot` 后 `hit` 才对。
  反过来（命中圆在下）还会抖：圆点被 hover 镂空变小后指针落到圆点上 ⇒ 命中圆
  `pointerleave` ⇒ 圆点复原 ⇒ 指针又回到命中圆，来回闪。

#### 实测（8198 隔离实例，缩放 1.2596 / 0.8 / 0.5）

| 项 | 值 |
|---|---|
| 圆点屏幕直径 | `12.60px` @ zoom 1.2596、`8px` @ 0.8 ⇒ 严格 `10 × zoom` |
| 位置 | `cx/cy` 与 `getPointAtLength(len/2)` 完全一致；拖节点后两者仍一致（各动一半） |
| 填充 | `rgb(153,170,153)` = `--xcat-link` |
| 缩放阈值 | `zoom 0.5 → display:none`，`0.8 → inline` |
| 点击 | 点 e21 的圆点 ⇒ store/DOM 都只剩 e20，圆点同步消失，画布 json 的 `edges` 已写盘 |

#### 剪线（Alt/Ctrl + 拖动划断）不用红色

上游 `index-*.css` 里两处红：`.cut-line{stroke:#ff3b3b}`（跟随鼠标的轨迹，
2.5px + 红发光）和 `... .vue-flow__edge.is-cutting .vue-flow__edge-path{stroke:#ff3b3b}`。
本包整套只有「线 `#99AA99` / 高亮白」两个语义色，红是唯一跳出来的，统一收到
`--xcat-link-hot`、线宽跟 `--xcat-link-w`（原来 2.5/3 混着）：

```css
#app .flow-wrap .vue-flow__edge.is-cutting .vue-flow__edge-path { stroke: var(--xcat-link-hot); }
#app .cut-line { stroke: var(--xcat-link-hot); stroke-width: var(--xcat-link-w); }
```

特异性 `(1,n,0)` 高于上游 `(0,5,0)`，不需要 `!important`；`cut-line` 是纯
`class="cut-line"` 无内联 `stroke`，CSS 能覆盖。
实测（Alt + 拖动真实鼠标事件穿线）：`.cut-line` / `is-cutting` 边都是
`rgb(255,255,255)` 3px。

### 一个节点一个素材、一对节点一条线（2026-11-12 续 23）

需求：**「每个节点只能对应一个素材」「两个节点只能连接一次」**。

上游原本是「节点 = 素材堆叠卡片」（`data.media` 是数组，卡片右上角还能翻页），
连线也完全不判重（`addEdge` 直接往后 push），所以同一对节点能连出无数条。

改法全在 `useGraph` 那段压缩代码里（函数名没被 mangle，按签名定位；
补丁脚本 `.workbuddy/tmp/patch_one_asset_one_link.py`，备份 `.oneasset.bak.js`）：

| 函数 | 原 | 现 |
|---|---|---|
| `ke` addEdge | 直接 push | 先按**无序点对**判重：`A→B` 或 `B→A` 已存在就 return |
| `V` appendMedia（拖素材到已有节点） | `media = [...old, ...new]` | `media = [new[0]]`，只上传/适配这一张 |
| `O` appendItems（资产库拖入 / 执行产物） | `media = [...old, ...items]` | `media = [items[0]]` |
| `g` addMediaNode | 收下整批文件 | `files.slice(0,1)` |
| `$e` importMedia（空白处拖入） | 一批文件 → 一个节点 | 一个文件一个节点，横向按 `节点宽 + 48` 排开 |
| `ue` / `ui` / `Os` / `Ot`（派生 / 旁挂 / 复制） | `media` 原样带过去 | 只带第一个 |

细节：

- **替换**语义是用户选的（不是「忽略」也不是「另建节点」）：`appendMedia` 里仍然
  先 `captureUndo()`，所以替换可 `Ctrl+Z` 回退；换素材后重新 `fitNodeToFirstImage`，
  节点尺寸跟着新图比例走。
- `data.index` 一律归 0（单素材没有翻页状态）。
- 执行产物也限 1 张（同样是用户定的）：`finishPrompt → appendItems` 只保留第一张，
  旧图被顶掉；下游通过 `syncDownstream`（`oe`）自动换成新素材。
- 多文件拖入的排布**必须先把基准点换算成画布坐标**，再在画布坐标里加偏移：
  我第一版是在屏幕坐标上加 `i*(w+48)` 再换算，结果偏移被 zoom 除掉
  （zoom 1.207 时间距 502 → 416 < 节点宽 454，节点重叠 38px）。
- 连线判重放在 `ke` 这一个入口即可：`onConnect`（`Ge`）、拖到节点松手的两条兜底
  （`ce`/`Ie`）、复制节点、粘贴都走它。被判重挡掉时，紧随其后的 `inheritMedia`
  （`le`）仍会跑，但它按素材 id 去重，重复调用无副作用。
- 方向不敏感：`92→93` 存在时，`93→92` 也建不出来（要反向先删原连线）。

实测（8198 隔离实例，真实鼠标拖拽 + 合成 `DragEvent` 带 `DataTransfer` 文件）：

| 场景 | 结果 |
|---|---|
| 已连的 `92→93` 再拖一次 | `edges` 数量不变，仍是 `e20/e21` |
| 新的 `93→94` 连两次 | 第一次 `+e22`，第二次不再新增 |
| `94→92`（`92→94` 已存在） | 不新增（反向也判重） |
| 已有一张图的节点再拖 1 个文件 | `media` 1 → 1，素材 id 变了（替换） |
| 空白处拖 3 个文件 | 建 3 个节点（95/96/97），各 `media:1` |
| 空白处拖 2 个文件 | 节点宽 454、间距 502 ⇒ 间隙 48，不重叠 |

### 素材节点 vs 生成节点：拖进来的素材不显示提示词 / 参数 / 运行（2026-11-12 续 25）

需求：**「拖进来的素材不需要显示这些，需要生成图片、视频、音频的节点才需要显示这些」**
（附的截图正是「提示词框 + 提示词优化 / 高宽比 / 百万像素 + 运行」这一整块）。

根因不在模板，而在 `useGraph` 的 `baseData()`：

```js
function baseData(label) {
  return { label, workflow: defaultWorkflow(), params: {}, randomFields: {}, inputMedia: [] };
}
```

`defaultWorkflow()` 返回工作流列表第一条，所以**任何**新建节点（包括拖素材进来的）
都自动绑上了工作流，面板自然把提示词、参数、运行全渲染出来。要区分「素材节点」和
「生成节点」，就得让素材节点真的没有工作流。

补丁 `.workbuddy/tmp/patch_asset_node_panel.py`（幂等，备份 `.assetpanel.bak.js`）：

| 位置 | 原 | 现 |
|---|---|---|
| `g` addMediaNode（拖入素材 / 资产库拖入） | `{...baseData(), media, index:0}` | 多一个 `workflow:""` |
| `Ot` duplicateNode | `workflow: source.workflow \|\| defaultWorkflow()` | `\|\| ""`（复制素材节点仍是素材节点） |
| 拖素材卡片到空白处 | 同上 | `\|\| ""` |
| 从节点输出口拖连线到空白处 | 同上 | **保持** `\|\| defaultWorkflow()`：这是「接上一个素材 → 建一个生成节点」 |
| 面板提示词块 | 常渲染 | `xcatIsGen(data) ? … : 空` |
| 面板参数网格 | `gridFields.length` 才渲染 | `xcatIsGen(data) && gridFields.length` |
| 运行按钮行 | 常渲染 | `xcatIsGen(data) ? … : 空` |

`xcatIsGen(d)` 加在 bundle 末尾（函数声明会提升，模块内哪儿都能引用）：
`!!(d && typeof d.workflow === "string" && d.workflow.trim())`。

样式（`xcat-overrides.css` 末尾）：

```css
/* 只剩素材条：宽度跟内容收缩，水平居中（用 translate 独立属性，
   不跟 panel-fade 的 transform 打架） */
#app .flow-wrap .node-panel:not(:has(.panel-prompt)) {
    width: auto; max-width: 700px; left: 50%; right: auto; translate: -50% 0;
}
/* 空素材节点：面板里什么也没有，直接不显示 */
#app .flow-wrap .node-panel:not(:has(.panel-prompt)):not(:has(.media-strip)) { display: none; }
```

顺带把「删除节点」按钮的 hover 从 `--c-danger` 改成 `--xcat-link-hot`
（暗色白 / 亮色近黑）：用户明确讨厌删除相关的红色。

实测（8198 隔离实例，手工造三种节点 + 合成 `DragEvent` 真拖一张图进来）：

| 节点 | 工作流 | 面板 | 上方按钮 |
|---|---|---|---|
| 拖入图片 | `""` | 80×80，只有素材条，无提示词/参数/运行 | 裁切/扩图/预览/宫格/下载/删除 |
| 绑定工作流 | `image_minimax_h3_image_t2i` | 663×310，提示词 + 3 个参数 + 运行 | 同上 |
| 空节点 | `""` | `display:none` | 预览 / 删除 |

注意：
- 这套判定只认 `data.workflow`。**旧画布里已经带上默认工作流的素材节点不会被自动改**，
  把图重新拖一次即可（或者删掉重建）。截图 `.workbuddy/tmp/panel-92/93/fresh.png`。
- 素材节点面板里仍保留左侧的工作流胶囊列表（hover 才滑出），选中一个就能把素材节点
  升级成生成节点——这是上游原本就有的入口，没有删。
- `promptEl` 在素材节点上不存在（模板条件渲染），相关代码本来就判空
  （`insertIntoPrompt` 里 `el?.selectionStart ?? …`、`if (!el) return`），不会报错。

### 节点拆成六种类型：素材 / 生成 × 图片 / 视频 / 音频（2026-11-13，文本见下一节）

上一节「靠 `workflow` 是否为空来猜」被推翻了：拖进来的素材仍会出现提示词/参数/运行，
因为整个包里**新建节点有 7 条路径**（拖文件、资产库拖入、从节点拖出、复制、粘贴、点 + 新建、
加载画布），上一版只堵了 3 条。用户给的方案是**做成六种明确类型**，不再猜。

`data.role` 六值（**2026-11-13 02:30 追加**：后又加了 `asset-text` 与 `gen-text`，
现在实际是八值，见文末「第八种节点：生成文本」）：

| role | 含义 | 工作流 | 面板 |
|---|---|---|---|
| `asset-image` | 素材图片 | 恒为 `""` | **整个面板不显示** |
| `asset-video` | 素材视频 | 恒为 `""` | **整个面板不显示** |
| `asset-audio` | 素材音频 | 恒为 `""` | **整个面板不显示** |
| `gen-image` | 生成图片 | 有 | 工作流列表 + 提示词 + 参数 + 运行 |
| `gen-video` | 生成视频 | 有 | 同上 |
| `gen-audio` | 生成音频 | 有 | 同上 |

bundle 末尾的判定函数（`patch_node_roles.py`，幂等，备份 `.roles.bak.js`）：

```js
function xcatRole(d){
  var R=['asset-image','asset-video','asset-audio','gen-image','gen-video','gen-audio'];
  var r=d&&d.role; if(R.indexOf(r)>=0) return r;
  // 没有 role 的旧节点：一律降为素材节点（用户明确「原来的节点不保留」）
  var k=(d&&d.media&&d.media[0]&&d.media[0].kind)||'image';
  if(k!=='image'&&k!=='video'&&k!=='audio') k='image';
  return 'asset-'+k;
}
function xcatIsGen(d){ return xcatRole(d).indexOf('gen-')===0 }
```

创建路径全部补 `role`（素材类同时补 `workflow:""`）：

| 路径 | 函数 | role |
|---|---|---|
| 拖文件到空白 | `g` / addMediaNode | `asset-` + `media[0].kind` |
| 资产库 / 多文件拖入 | `ui` / spawnItemsNodeAt | 同上 |
| 从节点拖出成新节点 | `spawnMediaNodeAt` 内联 | 同上 |
| 派生 / 复制节点 | `ue` / spawnChildNode | 继承源节点 `role` |
| 点 + 新建 | `_` / addNode | `gen-image` |
| 加载画布 | 原样保留（`...tt` 覆盖） | 旧数据无 role → 走兜底 |

面板四块全部改成 `xcatIsGen(e.data)` 条件：工作流胶囊列表、提示词、参数网格、运行按钮。
上一版漏了**工作流列表**，素材节点上还挂着胶囊。

左栏「新建节点」六选一（`assets/xcat-new-node.js`，新增；随后加了素材文本成七项、
生成文本成八项）：
- 注入位置在 `.library-tabs` 里「退出画布」之后；节点带 `data-v-1b766fe4`，直接命中上游
  scoped 样式，不用重写 `.lib-tab`。
- 菜单挂在 `#app` 内（`--cg-*` 令牌定义在 `#app` 上），六项分「素材节点」和「生成节点」两组。
- 建节点走 `window.__xcatFlow.addNodes()`，id 取现有最大数字 id + 1，
  位置 = 视口中心换算成画布坐标；生成类自动取工作流列表第一条。
- 备份脚本 `.workbuddy/tmp/verify-newnode.js`（CDP 真点击）。

**第二个入口：画布空白处双击（2026-11-13 02:20）**，同一个菜单、同一套 `role` 契约：

- 上游 `zoomOnDoubleClick` 会放大，所以在 **document 捕获阶段**拦 `dblclick`
  （`preventDefault` + `stopPropagation`），改成弹面板；这条也是文本节点双击编辑不冲突的前提——
  处理器里先排除 `.vue-flow__node` 再放行，`xcat-text-edit.js` 才收得到。
- 弹出位置贴鼠标（+8px），越界自动向左/上翻转，最后再 clamp 进视口；面板比左栏下拉更宽
  （304px）、两列卡片（`.xcat-nodemenu.is-canvas`，底色比画布抬一层，暗色混白 12%、
  亮色用 `--cg-input` 混 60% 出白卡片），头部右侧写「Esc 关闭」。
- 落点：面板选项点击时用 `screenToFlowCoordinate({x: clientX, y: clientY})` 换算，
  节点 **以双击点为中心**（`- NODE_W/2`, `- NODE_H/2`）；左栏入口仍用视口中心。
- 关闭：点菜单外（`pointerdown` 捕获，立即收起）、滚轮、Esc、窗口 resize；
  菜单开着时再双击空白 = 关闭。刚被点空白关掉的那一串双击用 `lastClosed`(350ms) 吞掉，
  不会关了又开。
- 不触发的区域：节点内部（交给文本编辑/拖拽）、`.vue-flow__panel`（右下浮动工具条）、
  节点面板、左栏。实测 (1380,760) 落在工具条上不弹、(700,480) 落在节点上不弹。

实测（8198 隔离实例，真实 `Input.dispatchMouseEvent` 双击）：

| 动作 | 结果 |
|---|---|
| 空白 (700,480) 双击 | 面板出现在 (708,488)，7 项，`is-canvas` |
| 点「素材图片」 | 节点 480×270（zoom 0.7 → 336×189），**中心正好 (700,480)**，`role=asset-image`、`workflow=""` |
| 点「生成视频」 | `role=gen-video`，`workflow` 取列表第一条（隔离实例无工作流故为空串） |
| 双击文本节点 | 进编辑（`.xcat-text-editing` + textarea 获焦），**不弹面板** |
| 菜单开着再双击空白 | 关闭，不重开 |
| 右边 (1400,200) 双击 | 面板向左翻，right=1392 < 视口 1424 |

素材节点连面板一起不显示（2026-11-13 01:20 追加）：素材本身已经铺满节点，面板里再挂一条
缩略图带纯属多余，用户要求去掉。CSS 从「宽度收缩居中」改成整块隐藏：

```css
#app .flow-wrap .node-panel:not(:has(.panel-prompt)) { display: none; }
```

素材节点 = 没有提示词块，所以这条选择器等价于「素材类面板全隐藏」；生成类恒有提示词块，不受影响。
实测：素材节点 `display:none`（高度 0），生成节点 `display:flex`（高 145）。

实测（8198 隔离实例，真实拖入 + 真实点击菜单）：

| 来源 | role | 提示词 | 参数 | 运行 | 工作流列表 | 顶部按钮 |
|---|---|---|---|---|---|---|
| 拖入 png | asset-image | 无 | 0 | 无 | 无 | 裁切/扩图/预览/宫格/下载/删除 |
| 拖入 mp4 | asset-video | 无 | 0 | 无 | 无 | 预览/下载/删除 |
| 拖入 mp3 | asset-audio | 无 | 0 | 无 | 无 | 预览/下载/删除 |
| 新建「生成视频」 | gen-video | 有 | 3 | 有 | 有 | 预览/删除 |
| 旧节点（无 role） | 兜底 asset-* | **无** | 0 | 无 | 无 | 按素材 kind |

注意：
- 旧画布节点的 `data.workflow` 字段**不动**（只隐藏 UI），以后要恢复成生成节点只需补 `role`。
- 素材节点目前没有「升级为生成节点」的入口，需要生成能力请用左栏「新建节点」。
- 生成图片 / 视频 / 音频三种除了 `role` 目前行为一致：后端 `/api/workflows` 只返回
  `name/nodes/updated`，没有产物类型字段，无法按类型过滤工作流列表。

把 ComfyUI 变成一块「无限画布」：每个节点绑定一条工作流，在画布上直接跑图、出视频，产出的素材还能拖到下一个节点继续用。

前端是 Vue 3 + Vue Flow，后端是一个轻量 aiohttp 扩展，只负责托管页面、读写配置、代理执行与缩略图生成。

![ComfyUI 页面右侧的 Infinite-Canvas 悬浮入口](docs/images/entry.png)

![画布总览](docs/images/canvas.jpg)

### 节点尺寸 480×270 / 素材节点无输入口 / 水平连线不可见（2026-11-13 01:35）

**1. 尺寸**：默认与下限都改成 480×270（原来 454×226，下限 400×225），只能放大不能缩小。

```js
const Pc=480,Ac=270,dk=480,fk=270;   // MIN_W, MIN_H, DEFAULT_W, DEFAULT_H
const Ht=480,ln=270,Dc=72;           // 排布用宽高
```

`index-5rMw4exW.css` 的 `.demo-node{width:454px;height:226px}` 同步改成 480/270
（实际宽高由 inline style 的 `nodeW/nodeH` 决定，CSS 只是兜底；**升级上游重建 dist 后要重做**）。

> **只改常量还不够**：上游有 `fitNodeToFirstImage`（bundle 里是 `async function F(v,T)`），
> 图片 onload 后按首图宽高比改写 `data.w/h`，所以拖进来永远不是 480×270。
> 上游原公式（`Zs=22` 内边距、`Bc=.84` 卡片占宽比、`Rc=900` 上限）：
> `h = 22 + (w-22)*0.84*(imgH/imgW)`，高度不足 270 时封顶高度并反向补宽；
> 旧结果 16:9 → 547×270、1:1 → 480×407。**该公式已于 23:00 按本包布局改写，
> 见下一节。** 2026-11-13 01:55 起在 `F` 开头加判定：`xcatRole(node.data)` 前缀为
> `asset-` 直接 `return false`，素材类固定 480×270；生成类按产物比例自适应。

### 节点尺寸公式：22 与 0.84 都是废弃前提（2026-11-13 23:00）

**那两个数是什么**：`22` = 上游 `.demo-node{padding:10px; border:1px}` 的左右合计
（`10×2 + 1×2`，全站 `*{box-sizing:border-box}`，所以 `width:480` 里内容区只有 458）；
`0.84` = `.media-stack-card{width:84%; left:50%}` 的卡片占宽比（多素材层叠时左右各露 8%）。
两者相乘的含义是「按图片真实显示宽度算高」：

```
节点高 = 上下装饰 22 + 图片实际显示宽 × (图高/图宽)
        = 22 + (w − 22) × 0.84 × ratio
```

**为什么不再成立**：本包为了「图片铺满卡片」早已改成
`#app .demo-node { padding:0 !important; border:0 !important }` 与
`.demo-node .media-stack-card { width:100% }`。实测（8198，480 宽节点）
`clientWidth = 480`、卡片宽 `480`，而公式仍按 `458 × 0.84` 算 → 节点比图片**矮约 19%**，
`object-fit:contain` 之后方图左右各留 36px 黑边（1:1 被算成 480×407）。

**改法**（`index-BXU58XDe.js` 的 `F(v,T)`，常量 `Ht=480 / ln=270 / Rc=900 / Lc=.02 / zc=3` 保留）：

```js
let w = Math.max(480, data.w || 480);
let h = Math.round(w * (imgH / imgW));      // 原来是 22 + (w-22)*0.84*ratio
if (h > 900) h = 900;                        // 封顶，宽度不回算
else if (h < 270) { h = 270; w = Math.round(h / ratio); }   // 顶到下限反推宽
w = Math.max(480, w);
```

防抖阈值 `|Δ| <= max(3, 2%)` 未动：算出来正好等于 480×270 时不写 `data.w/h`（节点本来就是默认值）。

**实测**（`verify-node-size.js`，5 张已知尺寸图 + 换图重算 + 素材节点，11 项 ALL PASS）：

| 图片 | 旧 | 新 | 铺满 |
| --- | --- | --- | --- |
| 1024×1024 | 480×407 | **480×480** | 无黑边 |
| 1920×1080 | 547×270 | **480×270** | 无黑边（正好等于默认值，防抖不写入） |
| 512×1024 | 480×791 | **480×900** | 留边，960 撞 900 上限 |
| 1024×4096 | 480×900 | 480×900 | 留边，1920 撞 900 上限 |
| 4096×1024 | 1203×270 | **1080×270** | 无黑边 |

能铺满的区间被两个硬约束夹出：宽 ≥ 480、高 ≤ 900 → 图片比例须落在
`480:900 ~ 宽上限` 之间；9:16 竖图会留左右各 15px，1:4 长条会留更多。
要彻底铺满只能放宽 480 最小宽或提高 900 上限（会改变节点默认观感，暂不动）。
对照图 `square-before-after.png`；纯前端，刷新即可。

**2. 素材节点只有右侧输出口**：不能把 target handle 从 DOM 里删掉——Vue Flow 靠 handle 的
bounding box 算连线终点，删掉后原有连线的末端会退到节点左上角（实测截图确认悬空）。
改成「幽灵端口」：handle 保留，加 `.xcat-port-hidden`：

```css
#app .flow-wrap .node-port.xcat-port-hidden { opacity: 0; pointer-events: none; }
#app .flow-wrap .node-port.xcat-port-hidden .port-hit { pointer-events: none; }
```

bundle 里 target 的 class 加 `"xcat-port-hidden": !xcatIsGen(e.data)`。
视觉不可见、拖线吸附不到，但几何位置照常参与计算。生成节点仍是左右双口。

**3. 完全水平的连线不可见**：根因是 halo 描边用的 SVG 滤镜
`filterUnits="objectBoundingBox"` —— 路径 bbox 高度为 0（完全水平）时，
按 SVG 规范整个元素不渲染。两处 `filter: url(#xcat-link-halo)` 已删除，
线回到单层 3px（浅色主题 `#6f7f6f` / 暗色 `#99aa99`）。
实测：把某条边的 `d` 改成水平（bbox 高度 0），截图里线段正常显示。

> 想恢复描边的话，必须换成 `userSpaceOnUse` + 绝对值区域，或者用 JS 插一条兄弟 path
> 做双层描边；不能再回到 objectBoundingBox。

### 第七种节点：素材文本（2026-11-13 01:50）

左栏「新建节点」的素材组多了 **素材文本**，`data.role = 'asset-text'`。
它不挂工作流、没有媒体卡片，节点内部就是一个铺满的 `<textarea>`。
**默认不可编辑**（和图片/视频节点一样可拖动），**双击**才进入编辑（2026-11-13 02:05 改）。

**数据契约**：文本存在 `data.text`（字符串），不放 `data.media`。
放 media 会被上传/缩略图/删除按钮那一整套逻辑牵连（`kind` 只认 image/video/audio）。

**渲染**：`Node` 组件 render 里在媒体分支**之前**插一个文本分支
（`xcatIsText(e.data)` 为真就渲染 `.xcat-text-wrap > textarea`）：

```js
xcatIsText(e.data)?($(),P("div",{key:"xcat-text",class:"xcat-text-wrap"},[
  f("textarea",{class:"xcat-text-area nodrag nowheel",placeholder:"输入文本…",
    value:e.data.text||"",onInput:eo=>xcatTextInput(e,eo.target.value),...},null,8,["value"])
])):!Mn.value&&H.value.length?( /* 原来的媒体分支 */ )
```

- `nodrag` / `nowheel` 让 Vue Flow 不管拖拽和缩放；编辑态里 `mousedown` / `dblclick`
  一律 `stopPropagation`，否则点字就变成拖节点。
- 写回走 `xcatTextInput(data, v)`：先直接写 `data.text`（不触发重渲染，光标不跳），
  400ms 后 `updateNodeData` 同步给 store，自动保存/导出都能带上。
- 顶部按钮：`xcatFanActions` 里 `if(xcatNodeRole(o.nodeId)==='asset-text')return!1;`
  —— 六个扇形按钮全不渲染，只剩模板里那个独立的删除按钮。
- 左上角名称胶囊会压住第一行字，所以 `:has(.xcat-text-wrap) > .xcat-node-name{display:none}`。
- 拖文件到文本节点上：`xcat-new-node.js` 在 **捕获阶段** 拦 `drop` 并吞掉，
  避免 media 里塞进看不见的数据。

**双击进入编辑（`assets/xcat-text-edit.js`，2026-11-13 02:05）**

textarea 默认 `pointer-events:none`，鼠标穿透到 `.demo-node`，于是 hover 是 `grab`、
按住能拖、单击能选中——和图片节点完全一致。双击节点时给 `.demo-node` 加
`.xcat-text-editing`，textarea 才接管鼠标：

```css
#app .flow-wrap .xcat-text-area { pointer-events: none; cursor: inherit; user-select: none; caret-color: transparent; }
#app .flow-wrap .demo-node.xcat-text-editing .xcat-text-area { pointer-events: auto; cursor: text; user-select: text; caret-color: auto; }
```

脚本用 document 捕获阶段监听：`dblclick` 进入（`preventDefault` + `stopPropagation`，
顺便挡掉 Vue Flow 的 `zoomOnDoubleClick`）、`pointerdown` 落在节点外退出、
`Esc` 退出、`focusin` 跑到别处退出。退出时必须 `blur()`，否则 Delete / 方向键会被
textarea 吃掉，节点删不掉。进入时光标放在文本末尾。

实测（8198 隔离实例 + 真实鼠标）：hover `pointer-events:none` 且 `cursor:grab`、
拖拽 position 从 (0,0) → (56,28)、双击后 `.xcat-text-editing` 出现且 textarea 获焦、
画布 zoom 1.781 未变（没触发双击缩放）、键盘输入写回 `data.text`、
点空白退出后 `pointer-events` 回到 none 且焦点释放、退出后仍可拖动。

**样式**（`xcat-overrides.css`）：14px / 行高 1.65 / padding 8×10 / 无边框无背景，
颜色 `var(--c-text)`（暗 `#e6e6ea`、亮 `#23232b`），滚动条按面板那套 6px 细条。

**按 Markdown 渲染显示（`assets/xcat-markdown.js`，2026-11-13 02:50）**

`asset-text` / `gen-text` 平时显示**解析后的排版**，双击才回到 Markdown 源码编辑。
实现不改 bundle：脚本往 `.xcat-text-wrap` 追加一块 `.xcat-text-render`，读
`textarea.value` 解析成 HTML；平时 textarea `opacity:0`（DOM 与 Vue 绑定都保留），
`.xcat-text-editing` 时反转——渲染层 `display:none`、textarea 恢复不透明。
渲染层恒定 `pointer-events:none`，这是「鼠标放上去与其它节点一致、可拖动」的前提；
实测命中元素是 `.xcat-text-wrap`、不带 `.nodrag`，文本节点与素材图片节点的拖拽位移一致。

- **自带解析器**，不引 CDN / npm（画布是离线 iframe，上游 bundle 里也没有
  marked / markdown-it）。支持 ATX 标题、段落、粗体 / 斜体 / 删除线、行内代码、
  围栏代码块、引用（可嵌套）、有序 / 无序列表（缩进嵌套 + 任务列表）、GFM 表格
  （含对齐）、分割线、链接 / 图片 / 自动链接、反斜杠转义。
  段落内单换行渲染 `<br>`（GFM `breaks:true`）——画布里写提示词逐行换行是刚需，
  CommonMark 默认「软换行 = 空格」不好用。
- **安全**：文本先整体 HTML 转义再解析；行内代码、图片、链接生成的标签先抽成
  占位符，避免内容被强调规则二次改写（也防 URL 里的 `_` 被当斜体）；
  `javascript:` / `data:` / `file:` 链接一律退化成纯文本；
  `<a>` 带 `rel="noopener noreferrer"`。
- **同步**：`input` 捕获事件即时重绘，`MutationObserver` 负责新节点 / 画布恢复 /
  复制节点挂载渲染层，另有 300ms 定时兜底撤销 / `updateNodeData` 这类不走
  input 的程序性改值（比对 `_xcatMdSrc` 短路）。
- **长文本滚动**：渲染层 `pointer-events:none` 收不到滚轮，脚本在 document 捕获
  阶段按坐标判断是否落在文本区，把滚轮改写成渲染层 `scrollTop` 并
  `stopPropagation` 挡住 Vue Flow 缩放；到顶 / 到底时放行，画布仍可正常缩放。
- 样式走 `--cg-*` 语义色（标题下边框 `var(--cg-line)`、代码底 `var(--cg-muted)`、
  引用 `var(--cg-muted-fg)`、链接 `var(--cg-primary)`），暗 / 亮两套都实测可读。
- 空节点显示「双击输入 Markdown 文本…」；**markdown 只是显示层，存储仍是
  `data.text` 里的原始字符串**，旧画布 / 复制 / 保存 / 连线都不受影响。

限制：不是完整 CommonMark（不支持 HTML 块、脚注、定义列表、代码块语法高亮）；
渲染层不可选中文字、链接不可点（`pointer-events:none` 的代价），要复制内容请
双击进入源码编辑。

实测（8198 隔离实例）：菜单七项、新建 role/`workflow:""`/`text:""` 正确、
真实键盘输入写回 `data.text` 且焦点不丢、顶部只剩删除、面板 `display:none`、
名称胶囊 `display:none`、拖入 `preventDefault` 且 media 仍为 0、
刷新后 `text` 仍在（`toObject()` 的 data 含 `text` 键）。

### 画布内 Ctrl+V 粘贴外部内容（2026-11-13 02:10）

上游的粘贴只认它内存里的 clipboard（复制节点/连线），系统剪贴板里的图片、
视频、音频、文字完全不处理。补一条 `paste` 监听（`assets/xcat-paste.js`）：

| 剪贴板内容 | 结果 |
|---|---|
| 文件（image/*、video/*、audio/*） | 每个文件建一个素材节点，`role = asset-image/video/audio` |
| 文件（`.txt` / `.md` 等） | 读文件内容建一个**素材文本**节点 `asset-text`，内容写进 `data.text`（见下节） |
| 只有纯文本 | 建一个素材文本节点，内容写进 `data.text` |
| 在输入框 / 文本节点里粘贴 | 完全不拦，正常粘文字 |
| 画布内部复制的节点 | 上游在 keydown 里 `preventDefault`，浏览器不派发 paste，不会撞车 |

要点：

1. **上传复用上游链路**：`window.__xcatGraph.appendMedia(id, [file])`，
   先本地占位、后台补传、失败可在卡片上重试。为此给 bundle 打了
   `go("canvasGraph",{` → `go("canvasGraph",window.__xcatGraph={`（1 处），
   把画布 store 挂到 window 上。
2. **必须延迟一拍再上传**：`flow.addNodes` 立刻进 `getNodes`，但 canvasGraph 的
   `nodes` 要等 watch 同步，立刻 `appendMedia` 会找不到节点、静默返回 false。
   用 `setTimeout(…, 80)`。
3. **落点**：鼠标最后在 `.vue-flow` 内的位置，没有记录就用视口中心。
   多个文件按 `480 + 48`（flow 坐标）横向排开；落点已被占用（±80px 内有节点）
   就继续右移，避免连续粘贴完全叠在一起（`placeClear`）。
4. 文件类型判定：mime 前缀优先，扩展名兜底（webm/mkv/m4a/opus 这些都有）。

实测（新用户目录的干净实例）：一次粘两个 PNG → 两个 `asset-image` 节点
x=777/1305（差 528）、上传完成后 `pending:false` 且 `ref` 有文件名；
再粘 mp4 → `asset-video` 自动挪到 x=1833；粘纯文本 → `asset-text`，`data.text` 为粘贴内容；
在文本节点的 textarea 里粘文本 → `prevented:false`，节点数不变。

#### 粘贴 / 拖入 txt、md 文件 → 素材文本节点（2026-11-13 03:00）

`assets/xcat-paste.js` 增加文本文件分支：扩展名 `.txt/.text/.md/.markdown/.mdown/.mkd/.mdx`，
或 mime 为 `text/plain` / `text/markdown`（兼容没有扩展名的剪贴板文件）。
判成文本文件就**不走上载**，直接读字节 → 建 **`asset-text`（素材文本）** 节点，
`data.text` 为文件内容，`workflow` 留空——和「只粘贴纯文本」完全是同一种节点，
不挂工作流、不出现生成面板，也不是 `gen-text`。

- **编码**：UTF-8 / UTF-8 BOM / UTF-16 LE·BE BOM / GBK 自动识别。先用
  `TextDecoder('utf-8',{fatal:true})` 严格解码，抛错就退 GBK；BOM 单独剥掉，
  避免中文 Windows 记事本的 ANSI 文件乱码或开头多一个 `\uFEFF`。
- **拖入也支持**：`drop` 捕获阶段只在「落在画布空白处 + 这批文件里含文本文件」
  时接管，落点用事件的 `clientX/clientY`；纯媒体文件仍完全交给上游 `onDrop`，
  落在节点上不接管（由 `xcat-no-media-import.js` 决定拒收）。`dragover` 只补
  `dropEffect='copy'`。
- **整批串行**：解码是异步的，`handleFiles` 用 `for … await` 串行，否则多个
  `createTextFile` 在 await 之间会算出重复的 `nextId()`。
- 混合剪贴板（md + png）会同时建 `asset-text` 和 `asset-image`，仍按 528px 横排；
  连续两次粘贴由 `placeClear` 自动错开；纯文本粘贴仍是 `asset-text`（未改）。
- 新节点的内容会通过 `xcat-markdown.js` 自动按 Markdown 渲染，双击仍可编辑源码。

实测（8198 干净实例 + 合成 ClipboardEvent / DragEvent）：`.md` / `.txt` / UTF-8 BOM /
GBK（「中文测试」不乱码）全部得到 `asset-text` 且 `data.text` 正确、渲染层有 `h1`；
md+png 混合 → `asset-text` + `asset-image(media:1)`；纯文本 → `asset-text`；
输入框内粘贴 `prevented:false` 且节点数不变；拖 .md 到空白 → `asset-text`；
拖纯 png → 上游建 `asset-image`、无多余文本节点；连续两次粘贴 x=777/1305 不重叠。
汇总断言 `genText:0 / assetText:2 / allWfEmpty:true / allRendered:true`，
选中节点下方截图确认没有生成面板与运行按钮。

### 第八种节点：生成文本 `gen-text`（2026-11-13 02:30）

用户要求补上与「生成图片 / 视频 / 音频」并列的文本类型，并确认外观 = **文本区 + 生成面板**
（不是只多一个 role）。也就是：节点主体是双击可编辑的文本区，同时又保留生成类的工作流列表、
提示词、参数、运行按钮和**左侧输入端口**。

四处改动：

| 位置 | 改动 |
|---|---|
| `index-BXU58XDe.js` `xcatRole` 白名单 `R` | 加 `'gen-text'`，否则会兜底成 `asset-image`；`xcatIsGen` 靠 `gen-` 前缀自动成立 |
| `xcatIsText(d)` | `xcatRole(d)==='asset-text'` → 同时认 `gen-text`，两种文本节点共用同一块 textarea |
| `xcatFanActions` | 过滤条件加 `gen-text`，文本节点顶部只留「删除节点」，不显示预览/下载等媒体按钮 |
| `fitNodeToFirstImage` (`F`) | 早退条件加 `gen-text`，往节点里塞图也不会按比例把 480×270 撑开 |

补丁脚本 `.workbuddy/tmp/patch_gentext.py`（幂等），备份
`index-BXU58XDe.js.gentext.bak.js`。`xcat-new-node.js` 生成组加第 4 项（两列正好 2×2），
`createNode` 的 `text:''` 条件扩到 `gen-text`；`xcat-text-edit.js` 按 `.xcat-text-area`
判定，不需要改就自动支持双击编辑。

面板显示条件沿用上游：`panelOpen = selected && !boxSelectedIds.has(id)`，所以**选中节点时
生成面板才展开**（生成图片/视频/音频也是这个行为），新建节点会自动选中。

实测（8198 干净实例 + CDP 真双击）：菜单 8 项；`window.__xcatRole({role:'gen-text'})` =
`'gen-text'`、`__xcatIsText` = true；新建节点 480×270（zoom .7 → 336×189）、
`data.text=""`、文本区存在；选中态面板 490×132 且含 `.panel-prompt` / `.panel-run`；
左侧 target 端口无 `xcat-port-hidden`；顶部只剩「删除节点」；双击进编辑、输入写回
`data.text`、点外部退出后 `pointer-events:none`；往节点 appendMedia 一张 800×800 PNG 后
`data.w/h` 仍未写、尺寸依旧 336×189。

限制：后端 `/api/execute` 只回传媒体文件，没有文本产物通道，所以工作流运行出来的文字
**不会自动写进文本区**；这里的文本区目前由用户手动填写 / 编辑。

### 生成节点禁止导入素材（2026-11-13 02:40）

用户要求：生成节点不允许导入图片 / 视频 / 音频，不能拖进节点里。先查清上游能把媒体塞进
**已有节点**的路径只有三条（`App.vue` / `Node/index.vue` 源码）：

| 入口 | 上游处理 |
|---|---|
| 系统文件拖到节点 | `App.vue onDrop` → `appendMedia(nodeId, files)` |
| 资产库素材拖到节点 | `App.vue onDrop` (`FILE_ASSET_DRAG_TYPE`) → `appendItems(targetId, …)` |
| 空节点「点击上传」 | `file input` → `onFilesPicked` → `appendMedia` |

（从节点媒体条拖出的 `ASSET_DRAG_TYPE` 落到节点上，上游本来就 `return`，不构成导入。）

改动：

- 新增 `assets/xcat-no-media-import.js`：在 **document 捕获阶段**拦 `dragover` / `drop`，
  命中 `gen-*` 或 `asset-text` 就 `preventDefault + stopPropagation`，`dropEffect='none'`
  （浏览器直接显示禁止光标），上游 `onDrop` 收不到。`click` / `change` 两道兜底防止
  以后又冒出新的上传入口。原来写在 `xcat-new-node.js` 里的 asset-text 拦截并到这里。
- bundle 空状态模板（`patch_gen_empty.py`，备份 `.genempty.bak.js`）：
  `P("div",Ex,[xcatIsGen(e.data)?f("div",{class:"xcat-gen-empty"},"选择工作流并运行，生成结果会显示在这里",-1):f("button",{class:"node-upload",…`
  —— 生成类空节点不再显示「点击上传」按钮，换成运行提示。
- CSS：`.xcat-gen-empty` 居中灰字；拒绝时 `.xcat-drop-denied` 给节点描红并用 `::after`
  显示 `data-xcat-deny-text`（生成类「生成节点不接受素材，请在下方运行工作流」，
  文本节点「文本节点不接受图片 / 视频 / 音频」），1.5s 后或 dragend 时清掉。

**刻意保留**的四条路径：

1. 工作流运行产物走 `useGraph.appendItems`（`useGraph.js:1677`），完全不经过这些 DOM 事件；
2. 连线输入写的是 `inputMedia`，不是 `media`；
3. 面板素材条 `.media-strip` 内部 `ASSET_DRAG_TYPE` 且无文件的排序拖放放行，
   否则已有素材顺序会拖不动；
4. 拖到画布空白处新建素材节点、素材节点自身接收拖入，都不受影响。

`?v=20261113n`(bundle) / `?v=20261113m`(css) / `?v=20261113l`(new-node) / 新脚本 `?v=20261113a`。

实测（8198 干净实例）：生成节点无 `.node-upload`、有 `.xcat-gen-empty`；拖文件 / 资产库
素材 → `dropEffect=none`、`.flow-wrap` 收不到 drop（探针 0）、`media` 恒 0、节点描红；
文件框 `change` 被吞（`files=0`）；素材图片节点拖同样文件 → `media: 0→1`、探针 1（无误伤）；
`appendItems` 手动塞运行产物 → `media: 0→1`（未堵）；选中生成节点后 `.strip-item`
的 ASSET 拖放 → dragover/drop 均到达 `.flow-wrap`、不描红（排序放行）；
`gen-text` 与 `asset-text` 拖文件同样拦下。

## 功能

**画布**

- 无限平移 / 缩放，支持全览与单节点聚焦

- 多画布管理：顶部条只显示已打开的画布（可逐个 × 关闭，全关后退化为 Unsaved Canvas）；画布管理面板是卡片网格，卡片右上角内联「复制 / 编辑名称 / 删除」（无右击菜单；批量删除仍用列表头的选择 + 「删除所选」）；新建、切换、改动自动保存；Ctrl/Cmd+S 可保存（无当前画布时自动新建并保存）

- 节点素材可以拖出画布空白处新建节点，拖到别的节点上则替换该节点的素材（一个节点只保留一个素材；一次拖入多个文件会按「一个文件一个节点」排开）

- 撤销：`Ctrl/Cmd + Z` 回退上一步（新建 / 删除节点、连线、拖动、改参数、粘贴等，最多 40 步，连续输入合并为一步）

- 复制粘贴：`Ctrl/Cmd + C` / `V` 复制选中节点（连同选中节点之间的内部连线；不带上游连线）

- 按住 `Ctrl`（macOS 也可用 `Option`）在空白处拖出一条红线，划过的连线直接切断

**节点**

- 一个节点 = 一条 ComfyUI **API 格式**工作流，运行时整个节点变成进度条（排队 / 进度 / 报错）

- 节点面板：切换工作流、填写提示词、按字段类型自动渲染控件（文本、数字、滑块、下拉、开关）

- 工作流里哪些字段暴露到画布，由「工作流配置」逐条勾选

- 支持图片 / 视频 / 音频结果，多条素材以扇形卡片堆叠展示

**资产库**

- 读取ComfyUI `input` / `output` 目录，可切分 图片 / 视频 / 音频

- 分页懒加载（每页 60 条，滚动到底自动加载下一页）

- 服务端生成并缓存 WebP 缩略图，视频自动抽帧做封面，网格只加载缩略图

- 悬停气泡快速预览（图片用缩略图秒开，视频原片静音循环）

- 拖到画布空白处新建节点、拖到节点上追加素材 —— 拖出来用的始终是**原图 / 原文件**，缩略图只用于面板展示

**资产管理**

- 左侧栏「资产管理」打开全屏面板，按 `input` / `output` 两个 Tab 管理 ComfyUI 的真实文件

- 左侧按 全部 / 图片 / 视频 / 音频 分类并显示数量，中间网格分页加载，支持关键字搜索与刷新

- 右侧上方预览原文件并显示大小、修改时间，下方读取文件内嵌的 ComfyUI 工作流 JSON（PNG / WebP / 视频 元数据）；预览区图片与视频一律**等比完整显示**（横向按宽、竖向按高，居中留白，不裁长边）——由 `xcat-overrides.css` 的 `.am-preview-body img/video` 修正，升级上游或重新 build 后需照上表重做

- 批量管理模式下可勾选任意素材，批量删除或打包下载（后端打成一个 zip）

- 画布上删除节点 / 删除素材只移除引用，不会删除 `input` / `output` 里的文件；需要清理磁盘空间时在资产管理面板里勾选删除

![资产管理面板](docs/images/asset-manager.jpg)

**提示词库**

- 手动收藏、持久化保存

- 节点提示词框里输入 `@` 打开资产库、`/` 打开提示词库，点击条目直接插入

**左侧栏**

| 入口    | 作用                       |
| ----- | ------------------------ |
| 退出画布 | 关闭画布弹窗；独立打开时返回上一页或 ComfyUI 首页。文字与图标暗色白 / 亮色黑，排在「提示词」**上方** |
| 提示词   | 收藏的提示词，点击插入到选中节点         |
| 资产库   | 浏览 `input` / `output` 素材，拖到画布 |
| 日志    | 任务队列与运行历史                |
| 画布    | 多画布的增删改与切换（侧栏入口名，面板标题仍是「画布管理」） |
| 资产管理  | 管理 `input` / `output` 文件：预览、查看工作流、批量删除/下载 |
| 工作流    | 工作流配置：上传 / 排序 / 配置工作流字段   |


**左侧栏图标：统一 lucide（2026-11-12）**

竖栏 7 项 + 栏底主题 2 枚 + 隐藏的汉堡按钮，全部换成 lucide。SVG 不是手画：从
ComfyUI 前端包 `main-BHksRiL4.css` 的 `.icon-[lucide--*]` 规则里取出 `--svg`
data URI，解析后转成 Vue `h()` 内联（画布是独立 iframe，用不了 UnoCSS 的图标类）。
ComfyUI 官方侧栏用的也是这一套（另有 `icon-[comfy--*]` 自绘集与 PrimeIcons
`pi pi-*`），以 CSS mask + `background-color:currentColor` 渲染；侧栏图标是 `1.2em` = 19.2px，右下工具条才显式 `size-4` = 16px。

| 入口 | lucide 图标 | ComfyUI 官方对应位置参考 |
| --- | --- | --- |
| 退出画布 | `log-out` | 官方登出是 `pi pi-sign-out`（PrimeIcons） |
| 提示词 | `text` | — |
| 资产库 | `image` | 官方资产侧栏是 `comfy--image-ai-edit` |
| 日志 | `history` | 官方任务历史侧栏正是 `lucide--history` |
| 画布（原画布管理） | `layers` | 官方工作流侧栏是 `comfy--workflow` |
| 资产管理 | `folder-open` | — |
| 工作流 | `workflow` | 官方 `comfy--workflow`（lucide 同名图标也在包里） |
| 亮色 / 暗色 | `sun` / `moon` | 官方 `Comfy.ToggleTheme` 用 `pi pi-moon` |
| 隐藏汉堡 | `menu` | — |


**尺寸与位置对齐官方侧栏**

之前侧栏图标写死 16px、文字是带首尾空格的裸文本节点，都和官方不一致。现在按
`SidebarIcon.vue` + `main-*.css` 的真值对齐（8199 实例逐个量过）：

| 项 | ComfyUI | 本包 |
| --- | --- | --- |
| `.side-bar-button-icon` 的 font-size | 16px（`--sidebar-icon-size`） | 同 |
| 图标实际渲染尺寸 | `icon-[...]` 的 `width:1.2em;height:1.2em` = **19.2px**（实测 19.1875px） | `--xcat-rail-icon: 19.2px`（竖栏与栏底主题项共用） |
| 标签 | 独立 `<span class="side-bar-button-label">`：`text-2xs` 10px、`leading-none`、`text-center`、`w-max`、`max-w-[52px]`、`line-clamp-2`、`whitespace-normal` | 独立 `<span class="xcat-tab-label">`，同套属性；去掉上游的首尾空格 |
| 图标↔标签 / 按钮内边距 / 项高 | `gap-2` 8px / `p-2` 8px / 56px | 8px / 8px / 56px，实测间距 7.99px |
| 栏容器 padding | connected-sidebar `4px 0` | `4px 0`（原来只写了上边距） |
| 水平居中 | 图标与标签中心都在 28px | 28.01px / 28px |

右下角工具条是另一套（`GraphCanvasMenu.vue` 显式 `size-4` = 16px），不受这里的
19.2px 影响，本次未动。

`moon` 是唯一例外：该前端包只打包了 255 个 lucide 图标、没有 `moon`（官方主题切换
走 PrimeIcons），这一枚用标准 lucide 的 `moon` path。右下角工具条本来就照
`GraphCanvasMenu.vue` 抄了 lucide（`mouse-pointer-2` / `hand` / `chevron-down` /
`focus` / `route-off` / `grid-3x3`），本次未动；注意官方该工具条第 5 项是
`lucide--map`（小地图），`grid-3x3` 是我们给「网格吸附」另选的。



**标题文字大小：照「画廊」/ 官方 Tab**

用户给的参考截图是旧「历史画廊」的分类行（全部 / 图片 / 视频 / 音频）。那套样式当初
就是照 ComfyUI 官方 `components/tab/Tab.vue` + `tab.variants.ts` + `TabList.vue`
做的，所以这里直接以官方源码为真值，不照像素猜：

| 项 | 官方 / 画廊真值 | 修改前 | 现在 |
| --- | --- | --- | --- |
| 面板标题 | `SidebarTabTemplate.vue` 的 `truncate font-bold`，继承 `--text-base` = **16px/700** | 13px / 600 | **16px / 700** |
| 分类文字 | `tab.variants.ts` 的 `text-sm` = `--text-sm:.875rem` = **14px** | 11px | **14px** |
| 胶囊 | `Tab.vue` `h-8` 32px / `px-2.5` 10px / `rounded-lg` 8px / `border-none` / `shrink-0` | 24px 药丸 999px / 12px / 1px 边框 | **32px / 10px / 8px / 无边框 / `flex:0 0 auto`** |
| 行 | `TabList.vue` `gap-2` = 8px；画廊 `.xog-tabs` 还会 wrap | gap 6px | **8px + `flex-wrap:wrap`** |
| 状态 | active `bg-accent text-foreground`；inactive `bg-transparent text-muted-foreground hover:bg-accent` | active `bg-muted`、hover/选中都有 1px 边框 | 按官方：`--cg-accent` / 透明 / 无边框 |

只放大字号会把 14px 字塞进 24px 药丸，所以尺寸一并对齐；`shrink-0` 与 wrap 是防窄面板
挤压/溢出。`.lib-head` 64px、`pt-2` 8px 保持不变；水平边距随后在第 13 条统一改成 16px
（见「边距与间距」节），改字号那一步没有动它。
`.lib-title` 是三个贴栏面板共用类，所以提示词 / 任务队列的标题也一起变成 16px/700，
与官方侧栏一致、彼此不参差；`.lib-count`（60 / 460）与 `.lib-switch`（input / output）
仍是 11px 小字，未被这次改动波及。

**面板顶部留白：对齐官方侧栏 header**

用户反馈「提示词和资产库没有预留顶部边距，看起来贴在一起」，任务队列同样。8199
实例实测：`.lib-head` 只有 `padding:12px 12px 8px`（高 38~47px），而它后面第一块
内容（提示词 `.lib-list` / 资产库 `.lib-cats` / 任务队列 `.lib-list.history-list`）
`padding-top` 全是 0，`gapHeadFirst = 0` —— 第一个控件直接压在 header 的 `border-b`
上，标题又紧贴上方 38px 的画布标签栏。

官方真值（`SidebarTabTemplate.vue` + `main-*.css`，`--spacing:.25rem` = 4px）：

| 项 | ComfyUI | 本包 |
| --- | --- | --- |
| header | `flex min-h-16 items-center justify-between border-b px-4` → **64px**、垂直居中 | `.lib-head { min-height:64px; padding:0 16px; gap:8px }`（最初是 12px，见第 13 条） |
| header slot 内容 | `TabList` `px-4 pt-2 pb-px`、`SidebarTopArea` / `JobFilterActions` `px-4 py-2` → 顶部 **8px** | `.library-panel > .lib-head + * { padding-top:8px }` |

补顶部留白那一步只动上下，水平 padding 一律没动；后来第 13 条把 header 与所有
内容块一起提到官方 `px-4` 的 16px，标题与分类胶囊 / 列表项左边缘仍对齐（实测都在 72px）。浮窗
（画布管理 / 资产管理 / 工作流配置）用 `.float-window` 不是 `.library-panel`，不受影响。
结果：标题距面板顶 23px（原来 12~16.5px），第一控件距分隔线 8px（原来 0）。

**边距与间距：对齐画廊 / 官方 4px 网格**

标题放大到 16px 后，左右还留 12px 显挤，且各块间距混着 10px / 18px / 6px / 9px，
不落在官方的 4px 网格上。真值取自画廊 `web/history_gallery.js`（git `0b40374`）
与 ComfyUI `SidebarTabTemplate.vue` / `SidebarTopArea.vue` / `TabList.vue`：

| 项 | 画廊 | ComfyUI 官方 | 本包（现在） |
| --- | --- | --- | --- |
| header 水平边距 | `.xog-head` `padding:0 16px` | `px-4` = 16px | `.lib-head` **16px** |
| header 内部间距 | `.xog-head` `gap:8px` | `gap-2` = 8px | **8px**（上游 10px） |
| header 高度 | `.xog-head` `min-height:64px` | `min-h-16` = 64px | 64px（未动） |
| 内容区水平边距 | `.xog-tabs` / `.xog-searchrow` 16px | `px-4` = 16px | `.lib-cats` / `.lib-list` / `.asset-grid` / `.lib-compose` / `.lib-foot` 全 **16px** |
| 内容区顶部 | `.xog-tabs` `padding:8px 16px 1px` | `pt-2` = 8px | 8px（未动） |
| 分类行 → 网格 | `pb-px` 1px + 一整行 32px 搜索框 `padding:8px 16px` | `py-2` = 8px | **8px**：本面板没有搜索行、分类行直接接网格，取 8px 既不贴线也不空一大截 |
| 网格 / 列表 gap | `.xog-grid` `gap:8px` | `gap-2` = 8px | 8px（未动） |
| 页脚 / 输入区下边距 | — | `py-2` = 8px | **8px**（上游 10px） |
| 空态 / 更多 | `.xog-empty` `padding:24px 16px` | 4px 网格 | `margin:16px 0` / `8px 0`（原 18px / 4px+8px） |
| 卡片圆角 | `.xog-card` 8px | `rounded-lg` 8px | **8px**（上游 9px） |

一次把六类内容块的左右 padding 提到 16px，标题 / 胶囊 / 卡片 / 列表项左边缘统一在
**72px**（面板左边缘 56+1 + 16），彼此不再错开。`.lib-list.history-list` 的
`gap:0` 是上游按日期分组刻意的（由 `.history-day` 的 `margin:10px 0 4px` 分组），
**没有**强推 8px。浮窗 `.float-window` 不是 `.library-panel`，不受影响。
窄面板（`min(360px,40vw)` = 168px）下可用宽只剩 136px，四枚 48px 胶囊靠
`flex:0 0 auto` + `flex-wrap:wrap` 换成 2×2，实测不挤扁、不溢出、不裁字。

**面板滚动条：照 ComfyUI 的 `scrollbar-custom`（2026-11-12）**

上游 `index-*.css` 开头有一条全局清空，把整站滚动条都藏了：

```css
* { scrollbar-width: none; -ms-overflow-style: none }
* ::-webkit-scrollbar { width: 0; height: 0; display: none }
```

所以 `.lib-list`（提示词 / 任务队列）、`.asset-grid`（资产库）、`.float-body`、
`.am-grid`（画布管理 / 资产管理 / 工作流配置）虽然都是 `overflow:auto`、滚轮也能滚，
界面上却完全没有滑块，看不出「还能往下翻」。官方侧栏的 body 挂的是
`.scrollbar-custom`（`SidebarTabTemplate.vue`：
`class="comfy-vue-side-bar-body scrollbar-custom h-0 grow overflow-x-hidden"`），
真值见 `main-BHksRiL4.css`：`scrollbar-width:thin` + `scrollbar-color:var(--muted) transparent`
+ `::-webkit-scrollbar{width:10px}` + thumb `background:var(--muted); border:2px solid #0000; border-radius:9999px`。

两个坑都是实测出来的（`.workbuddy/tmp/probe_scrollbar_variants.cjs`，四种写法对照）：

1. **只写 `width` 不够** —— 全局那条 `display:none` 仍然生效，必须显式
   `display:block`，否则滑块依然不出现。
2. **不能照抄 `scrollbar-width: thin` / `scrollbar-color`** —— Windows 的 Chromium
   一看到这两个标准属性就切回「原生细滚动条」、忽略 `::-webkit-scrollbar`，结果
   轨道两端多出上下箭头（▲▼）、滑块变方头。所以本包改用
   `scrollbar-width: auto`（把全局那条 `none` 复位）＋ `::-webkit-scrollbar-*`
   自绘；另外还要 `::-webkit-scrollbar-button { display:none }`，否则两端仍有箭头。
3. 官方那条 `border:2px solid #0000` 在 Chromium 里默认 `background-clip:border-box`，
   底色会画到透明边框下面，实测是满轨道 **10px** 的粗条；显式
   `background-clip: padding-box` 才是那 2px 边框本来要的「10px 轨道里 6px 细条」。

| 项 | 官方 / 现在 |
| --- | --- |
| 轨道宽 | 10px（`::-webkit-scrollbar{width:10px;height:10px}`） |
| 滑块可见宽 | **6px**（2px 透明边框内缩），像素量过 x 407..412 |
| 滑块形状 | `border-radius:9999px` 两端全圆角 |
| 滑块颜色 | 暗色 `--muted` = `#3c3d42`；**亮色改用 `--border` = `#b4b4b4`** |
| 轨道 | 透明（`background:transparent`），无箭头按钮 |
| 溢出轴 | `overflow-y:auto` + `overflow-x:hidden`（官方侧栏 body 也这么写） |
| 抖动 | `scrollbar-gutter:stable`（官方 `NodeLibrarySidebarTabV2` 的做法） |

亮色为什么不用 `--muted`：亮面的 `--muted` 是 smoke-400 `#d9d9d9`，压在 `#f3f3f3`
面板上对比度只有 1.2，几乎看不见；`--border`（smoke-600 `#b4b4b4`）是 1.75，与暗色
`#3c3d42` 压 `#171718` 的 1.62 相当，仍是官方色阶里的颜色，不另造色。
所以 `#app` 上多了一个 `--cg-scroll` 令牌：暗色 `var(--cg-muted)`、亮色 `var(--cg-border)`。

**面板内图标统一 lucide（2026-11-12）**

侧栏展开的面板、浮动窗口、画布管理卡片、工作流列表里原本还有 12 枚上游手写 SVG，
外加顶部标签栏的「+」（FontAwesome 512 viewBox 的**实心**加号），一并由
`.workbuddy/tmp/dump_panel_lucide.py` 从 ComfyUI 前端包 `main-BHksRiL4.css` 的
`.icon-[lucide--*]` 解出 `--svg` 真值，再由 `patch_panel_lucide.py` 内联进 bundle。

| 位置 | lucide 图标 | 保留尺寸 |
| --- | --- | --- |
| 资产面板 关闭 / 素材卡片 删除 / 缩略条 删除 / 浮动窗口 关闭 | `x` | 16 / 12 / 10 / 14px |
| 资产面板 对比 | `chevrons-left-right` | 14px |
| 工作流参数 随机 | `shuffle` | 14px |
| 资产预览 下载 / 删除 | `download` / `trash-2` | 15px |
| 画布管理卡片 复制 / 编辑名称 / 删除 | `copy` / `pencil` / `trash-2` | 13px |
| 工作流列表项 | `workflow` | 14px |
| 顶部标签栏 新建 | `plus` | 16px |

技术要点：

- 整体替换 `f("svg",{...},[...],-1)` 表达式，**只换图形、不换尺寸**：原 `width` /
  `height` 字面量、`class`、Vue 静态 patch flag `-1` 全部保留，`viewBox` 统一成
  lucide 的 `0 0 24 24`；描边统一 `fill:none` / `stroke:currentColor` / `stroke-width:2`。
- 官方 data URI 里 `stroke='black'` 只是 CSS mask 的占位色，**内联 SVG 必须换成
  `currentColor`**，否则暗色下是黑块、亮色下也不跟随主题。`<g>` 上的描边属性展开到
  svg 根，保证 `rect` / `circle` 同样描边。
- 顶部标签栏「+」写在 `innerHTML` 字符串里（不是 `f("svg")`），单独替换；标签关闭 ×
  与保存弹窗关闭 × 本来就是 lucide `x`（两条 path 的写法），未动。
- 画布节点本体上的 6 枚（`cmp-handle` / `node-upload` / `node-progress-icon` /
  `node-delete` / `node-resize` / `edge-tool`）是节点交互控件，尺寸 9~22px、viewBox
  各异，不属于侧栏面板，本次未动。

验证：源码层 `.workbuddy/tmp/verify_panel_lucide.py` **61/61**（13 枚 path 与官方逐字
一致、尺寸不变、其余 16 枚 `f("svg")` 表达式完全未改）；浏览器层
`.workbuddy/tmp/test_panel_lucide.cjs` **21/21**（临时建一个画布让 `.cm-card` 渲染，
验完即删），暗 / 亮截图确认图标清晰、线条粗细一致。

**右下角工具条**

| 图标 | 作用 |
| --- | --- |
| 指针 / 手 + 箭头 | 画布模式：`V` 选择（可编辑，左键拖空白平移、Ctrl+拖框选、Alt+拖剪线、点连线中点断开）或 `H` 拖拽（只读，左键任意位置平移、节点不可选/拖/连）；空格按住临时进入拖拽。菜单里显示 V / H |
| 取景框 | 适应视图：缩放到能看到整块画布 |
| `70%` + 箭头 | 缩放控制：放大 / 缩小 / 适应视图 / 直接输入百分比 |
| 断链 | 隐藏或显示节点之间的连接线 |
| 九宫格 | 网格吸附：拖动节点时对齐到 15px 网格 |

**左侧栏底部菜单**

| 菜单项  | 作用                                                       |
| ---- | -------------------------------------------------------- |
| 亮色 / 暗色 | 切换画布主题（暗色下显示太阳与「亮色模式」，亮色下相反）；菜单现在只有这一项 |

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/YangShu2103/ComfyUI-Infinite-Canvas.git ComfyUI-Infinite-Canvas
```

重启 ComfyUI，页面右侧会出现悬浮的 `Infinite-Canvas` 圆形入口，点击即可打开画布。

- 前端构建产物已随仓库提交（`frontend/dist`），**普通用户不需要 Node.js 环境**。

### 可选依赖

| 用途    | 依赖                     | 说明                                   |
| ----- | ---------------------- | ------------------------------------ |
| 图片缩略图 | Pillow                 | ComfyUI 自带，必需                        |
| 视频封面  | `av` 或 `opencv-python` | 二选一即可（`pip install av`）；都没有时视频显示占位图标 |

## 使用

1. 打开入口 → **工作流配置**：上传 ComfyUI 导出的 **API 格式** 工作流 JSON（`Workflow → Export (API)`），并勾选要暴露到画布的字段。

   ![工作流配置](docs/images/workflow-config.jpg)

2. 画布空白处双击新建节点，在参数面板左侧工作流列表选择一条工作流。

3. 在节点面板里填提示词、调参数，点运行，产出会直接出现在节点上。

4. 把节点上的素材拖到下一个节点，即可衔接下一条工作流。

## 推荐搭配：[ComfyUI\_image\_picker](https://github.com/YangShu2103/ComfyUI_image_picker)

工作流里需要一次性接收 **多张图（图像列表）** 时，推荐配合 [ComfyUI\_image\_picker](https://github.com/YangShu2103/ComfyUI_image_picker) 节点使用：

![Image Picker 字段配置](docs/images/image-picker.jpg)

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/YangShu2103/ComfyUI_image_picker.git ComfyUI_image_picker
```

- 它提供 `img_1` … `img_9` 共 9 个 `IMAGE` 输出，正好对应画布节点上追加的多张素材（按素材顺序依次送入）

- 带可视化的图库弹窗（`input` / `output` 多选、缩略图、拖拽排序），不用为每张图单独挂一个 `LoadImage`

## 数据存放

插件的持久化数据不在节点目录里，而是放在 ComfyUI 的用户目录下，重装 / 更新节点不会丢：

```
<user_directory>/ComfyUI-Infinite-Canvas/
├── canvas_settings.json   # 画布设置、工作流排序
├── prompts.json           # 提示词库
├── workflows/             # API 格式工作流 + <名称>.fields.json
├── canvases/              # 画布
└── thumbs/                # 缩略图缓存（可随时整目录删除，会自动重建）
```

`<user_directory>` 即 `folder_paths.get_user_directory()` 返回的目录（通常是 `ComfyUI/user`）。

缩略图按「源文件路径哈希 + 修改时间 + 大小」命名，源文件变了会自动生成新缓存；缓存总量超过 10000 个文件或 200MB 时，按最旧优先清理。

## 开发

```bash
cd frontend
npm install
npm run dev     # 本地调试：http://localhost:5173
npm run build   # 构建到 frontend/dist，ComfyUI 直接加载
```

- `vite dev` 下「工作流配置」可以填后端地址；打包上线后固定用当前 ComfyUI。

- 改完前端记得 `npm run build`；改 `web/infinite_canvas.js` 或 `__init__.py` 需要**重启 ComfyUI**。

### 目录结构

```
ComfyUI-Infinite-Canvas/
├── __init__.py            # 后端：路由、工作流/画布读写、缩略图
├── web/infinite_canvas.js # 本包自己的前端扩展：菜单栏入口 + iframe 弹窗（上游同名文件已重写）
├── docs/images/           # README 里的截图
├── frontend/              # Vue 3 + Vue Flow 源码
│   ├── src/components/    # 节点、边、工具栏、资产库、弹窗
│   ├── src/composables/   # 图操作、画布、资产库（useGraph/useCanvas/useLibrary）
│   └── dist/              # 构建产物（ComfyUI 托管 /infinite_canvas/app）
├── README.md
└── LICENSE
```

### 主要接口

| 方法              | 路径                                             | 说明             |
| --------------- | ---------------------------------------------- | -------------- |
| GET             | `/infinite_canvas/api/settings`                | 读取画布设置         |
| POST            | `/infinite_canvas/api/settings`                | 保存画布设置         |
| GET/POST        | `/infinite_canvas/api/workflows`               | 工作流列表 / 上传     |
| PUT             | `/infinite_canvas/api/workflows/order`         | 拖动排序           |
| POST            | `/infinite_canvas/api/workflows/{name}/category` | 改分类（六类，见「工作流分类」节） |
| POST            | `/infinite_canvas/api/workflows/{name}/rename` | 重命名            |
| GET/PUT         | `/infinite_canvas/api/workflows/{name}/fields` | 字段配置读写         |
| GET/POST        | `/infinite_canvas/api/canvases`                | 画布列表 / 新建      |
| GET/PUT         | `/infinite_canvas/api/canvases/{id}`           | 读取 / 保存画布      |
| GET             | `/infinite_canvas/api/library/assets`          | 资产列表（分页 + 分类）  |
| GET             | `/infinite_canvas/api/library/thumb`           | 素材缩略图（WebP 缓存） |
| GET/POST/DELETE | `/infinite_canvas/api/library/prompts`         | 提示词库           |
| POST            | `/infinite_canvas/api/execute`                 | 提交工作流执行        |
| GET             | `/infinite_canvas/api/prompts/{id}`            | 查询执行结果         |
| POST            | `/infinite_canvas/api/free`                    | 卸载模型并释放显存 / 内存（转发 ComfyUI 的 `/free`） |
| POST            | `/infinite_canvas/api/audio/process`           | 音频截取 / 变速（FFmpeg，见下节） |

## 音频节点：截取与变速（2026-11-13）

参考 `Toonflow-app` 的 `packages/nodes/audioNode`。素材音频 `asset-audio` 与生成音频
`gen-audio` **都可用**：只要节点当前素材是音频，上方操作行就多出「截取」「变速」两枚
按钮（与删除按钮同款 `.fan-btn`，非音频节点自动隐藏）。

**交互**
- 截取弹窗：真实波形（`fetch` + `OfflineAudioContext.decodeAudioData`，解码失败退化为
  `<audio>` 时长 + 占位波形）+ 6 格时间刻度 + 片段轨道 + 红色播放头。点刻度 / 片段定位，
  拖播放头微调；「分割」按播放头切两段，「粘合」与相邻片段合并，「删除片段」留下缺口；
  撤销 Ctrl+Z / 重做 Ctrl+Y，←/→ 每次 0.1 秒，空格试听。试听会按片段跳过被删掉的区间。
- 变速弹窗：0.1×–4× 滑块 + 数字输入 + 6 个预设，实时显示原时长与预计时长。
- 两者导出后**在原节点右侧新建一个 `asset-audio` 节点**（自动向下避让已有节点），
  原音频不变。关闭只走右上 × / 取消 / Esc，遮罩不关闭。

**后端** `POST /infinite_canvas/api/audio/process`（`__init__.py` 的 `process_audio`）：

```json
{"ref": {"filename": "...", "subfolder": "", "type": "input"},
 "action": "clip", "segments": [{"start": 0, "end": 2}, {"start": 4, "end": 6}]}
{"ref": {"filename": "...", "type": "output"}, "action": "speed", "speed": 1.5}
```

- 源用 `_resolve_media_path()` 按 `type` 解析到 input / output / temp 目录，逐段校验文件名、
  子目录与 `..`，`os.path.commonpath` 兜住越界；结果写回 input 目录，文件名带 uuid，
  **不覆盖原素材**。返回 `{filename, name, subfolder:"", type:"input", duration}`。
- 变速用分级 `atempo`（每级 0.5–2，链式相乘等于目标速度，保持音调）；截取用
  `atrim=start=..:end=..,asetpts=PTS-STARTPTS` + `concat=n=N:v=0:a=1`；统一
  `-vn -c:a aac -b:a 192k -f ipod -movflags +faststart` 导出 m4a。
- FFmpeg 走 `asyncio.create_subprocess_exec`（Windows 加 `CREATE_NO_WINDOW`），300 秒超时，
  失败删掉半成品；`shutil.which` 找不到时回退 `imageio_ffmpeg.get_ffmpeg_exe()`。
- 校验：action 白名单、speed 0.1–4、segments 1–64 且 `0 ≤ start < end ≤ 时长`。
  实测 1.5× → 4.00s、0.1× → 59.80s、4× → 1.50s、`0–2 + 4–6` → 4.00s；
  7 组非法参数全部 400。

**前端** `assets/xcat-audio-edit.js`（`?v=20261113c`）+ `xcat-overrides.css` 的
`.xcat-ae-*` 段（`?v=20261113o`）。片段模型与参考一致：`groups` 是「片段 → 源时间区间」
的二维数组，导出时展开成一维 `segments`。弹窗挂在 `#app` 内才能拿到 `--cg-*` 令牌；
亮色单独抬成白卡片。

三个必须注意的坑：
1. `addNodes` 后 `appendItems` 要等 ~120ms（Vue Flow store 同步延迟），否则静默返回 false，
   留下空节点；失败时回滚删掉新节点。
2. 模态期间在 **window 捕获阶段**吞掉 `dblclick`：否则双击遮罩第一击关窗、第二击落到画布，
   被 `xcat-new-node.js` 的 document 捕获当成「双击空白新建节点」。`keydown` 不能无差别
   `stopPropagation`（会连输入框自己的按键一起吞），只挡 Delete / 剪辑快捷键。
3. `xcat-paste.js` 的 paste 捕获也在 document 上，弹窗非输入区要挡；输入框内放行。

限制：处理中取消只中止前端 fetch，后端 FFmpeg 会跑完并留下一个无人引用的文件；
没有 PCM 裸流参数面板、没有波形内片段级重绘、没有导出格式选择（固定 m4a/AAC 192k）。

### 节点上方操作按钮改成文字按钮（2026-11-13）

用户「将上面的按钮都改成文字按钮」，并明确是**节点上方那一排原本显示图标的
`.fan-btn`**（不是截取 / 变速弹窗里的按钮，那些本来就是文字）。整行 9 枚
（上游 6 枚 + 删除 / 截取 / 变速）全部改成文字，圆角矩形替代圆形。

| 按钮 | 做法 |
|---|---|
| 上游 6 枚（裁切 / 扩图 / 预览 / 宫格 / 下载 / 全部下载） | **不动 bundle**：上游模板把 label 只放在 `title` 里、子节点只有 svg。CSS 隐藏 `svg`，用 `.fan-btn:not([data-xcat-text])::after{content:attr(title)}` 显示文字。Vue 每次 hover 重建按钮也不会失效。 |
| 自注入 3 枚（删除 / 截取 / 变速） | JS 直接写 `textContent`，打 `data-xcat-text` 跳过伪元素；`title` 缩成「删除」「截取」「变速」，全称留在 `aria-label`。 |

样式（`xcat-overrides.css` 末尾）：宽高交给内容 / `height:28px` /
`padding:0 11px` / `border-radius:8px` / **13px 字号**（画布默认 zoom .7，
11px 会被压到 7.7px 读不清）/ gap 6px / `flex-wrap:wrap` 兜底。
三枚注入按钮补 `is-enabled` class，才能和上游 6 枚同款强调色描边；
`.fan-btn.is-enabled` 的文字色统一回 `--cg-fg`（上游把「可用」染成
`--c-accent` 黄绿，亮色下文字糊），hover 用 `--cg-primary`（删除按钮用
`:not(.xcat-act-delete)` 排除，保留自己的 hover 规则）。上游 `.is-enabled`
是 10% 强调色的半透明底，亮色画布的密集网格会透到字底下，所以
`.is-enabled` / hover 统一改成 `var(--c-surface-3)` **实底**。

版本号：`xcat-node-actionbar.js?v=20261113b`、
`xcat-audio-edit.js?v=20261113e`、`xcat-overrides.css?v=20261113s`。

验证（8198 干净实例 + CDP 真鼠标）：音频节点行 = 预览 / 下载 / 删除 /
截取 / 变速；图片节点行 = 裁切 / 扩图 / 预览 / 宫格 / 下载 / 删除；
全部 `svg display:none`、13px、8px 圆角、单行不换行、总宽 199 / 240px
（节点屏幕宽 336px）、无重复文字；真点「截取」「变速」弹窗正常、
Esc / 取消可关、真点「删除」节点被删；亮色文字 `rgb(9,9,10)`、
实底 `rgb(247,247,250)`，暗 / 亮两套截图确认。

> 上面 2026-11-12 几个小节里「按钮 32×32 / svg 16×16 / `title=删除节点`」
> 是改文字按钮之前的旧状态，以本节为准。
> 本节记录的是**刚改完文字按钮时**的顺序；随后又按下节调整过，顺序以新节为准。

### 音频节点去掉预览 + 操作行固定顺序（2026-11-13）

用户「音频节点不需要预览，截取和变速放在下载和删除前面，下载和删除永远放在后面」。

| 项 | 做法 |
|---|---|
| 不要「预览」 | 改 bundle 里我们自己的 `xcatFanActions()` 过滤：角色为 `asset-audio` / `gen-audio`，或当前素材 `kind === "audio"` 时，`a.key === "preview"` 直接 `return !1`。按角色命中，所以**还没生成结果的 gen-audio 空节点也没有预览**；图片 / 视频 / 空节点不受影响。同一个函数也供预览面板左侧工具列使用，音频节点那列自然同步。 |
| 固定顺序 | **不用 JS 搬节点**：上游 6 枚由 Vue 每次 hover 重建，删除 / 截取 / 变速 是三个脚本各自 `appendChild` 的，DOM 顺序随加载与 patch 时机变。`.node-actions` 是 flex，直接给子项定 `order`（`xcat-overrides.css` 末尾）：`截取 -2` → `变速 -1` → 其余操作 `0` → `下载 90` / `全部下载 91` → `删除 99`。`flex-wrap` 下同样生效，Vue 重建后也无需重排，也不会闪。 |

```css
#app .demo-node .node-actions .fan-btn.xcat-ae-clip  { order: -2; }
#app .demo-node .node-actions .fan-btn.xcat-ae-speed { order: -1; }
#app .demo-node .node-actions .fan-btn[title="下载"]     { order: 90; }
#app .demo-node .node-actions .fan-btn[title="全部下载"] { order: 91; }
#app .demo-node .node-actions .fan-btn.xcat-act-delete   { order: 99; }
```

DOM 里注入按钮仍 append 在末尾（实测 `下载 / 删除 / 截取 / 变速`），**视觉顺序**
靠 order 纠正。`xcat-node-actionbar.js` 的注释已同步（不再声称「append 即排最后」）。

版本号：`index-BXU58XDe.js?v=20261113p`（预览过滤）、
`xcat-overrides.css?v=20261113t`（order）、
`xcat-node-actionbar.js?v=20261113c`（注释）。

验证（8198 干净实例 + CDP 真鼠标，按屏幕坐标读视觉顺序）：
素材音频 = **截取 / 变速 / 下载 / 删除**（`order -2/-1/90/99`，无「预览」）；
空 gen-audio = **删除**（无预览、截取变速因无音频隐藏）；
素材图片 = 裁切 / 扩图 / 预览 / 宫格 / 下载 / 删除（下载 90、删除 99 仍在末尾；
**这是当时的结果，图片 / 视频的「预览」已在后面「视频 / 图片节点也去掉预览」一节一并去掉**）。
全部单行、总宽 158 / 240px < 节点 336px；真点「截取」弹窗正常、Esc 可关、
真点「删除」节点真的被删；暗 / 亮两套截图 `barorder-clean-{dark,light}.png`。
本包限制「一个节点一个素材」，`appendItems` 同一 ref 会去重，多素材的
「全部下载」实际不出现，但 order 91 已为它留好位置。

### 节点内强调色 #F2FF59 → #0B8CE9（2026-11-13）

用户「节点中的 #F2FF59 改成 #0B8CE9」。这个黄绿不是某处硬编码，而是上游
`index-5rMw4exW.css` 暗色 `:root` 的 `--accent-yellow:#f2ff59`
（亮色 `html[data-theme=light]` 是一整套橄榄黄 `#c6d300 / #6f7a00 / #1f2200`），
`--c-accent` 直接指向它。左侧栏 `.library-dock` 与浮窗 `.float-window` 早前
已被我们重映射成中性前景色，所以黄绿只剩在**节点区域**：音频进度/音量滑块
`.xaw-*`、fan-btn 描边、选中描边、进度环、素材点、参数滑块与开关、
运行按钮 `.panel-run`、上传入口等。

做法：在 `xcat-overrides.css` 末尾按「节点」作用域重定义变量，**不改上游
CSS 字面量**（dist 保持纯净，升级上游 / 重新 build 后照本文件重做）：

```css
#app .vue-flow__node,
#app .flow-wrap .node-panel {
    --accent-yellow: #0b8ce9;
    --c-accent: #0b8ce9;
    --c-accent-weak: color-mix(in srgb, #0b8ce9 12%, transparent);
    --c-accent-ink: #0b8ce9;
    --c-on-accent: #ffffff;   /* 原 #14140f 深墨字是配亮黄底的，蓝底要白字 */
}
```

暗 / 亮两套主题统一成同一个蓝。`#0b8ce9` 就是本包 `--cg-primary`
（ComfyUI `--primary` = azure-600），与弹窗、工具条里的蓝一致。
端口圆点 `.node-port::before` 不受影响：它早已按 ComfyUI
`getSlotColor` 改成中性灰 `--xcat-slot`(#AAA)，不是这个黄绿。
**菜单栏 `Infinite Canvas` 按钮**（`web/monitor.js` 的 `CANVAS_BG`）仍是
`#F2FF59`，它不在节点里，本轮未改。

版本号：`xcat-overrides.css?v=20261113v`。

验证（8198 干净实例 + CDP）：节点上 `--accent-yellow / --c-accent` 解析为
`#0b8ce9`，`.xaw-seek-thumb / .xaw-seek-fill / .xaw-vol-fill`、
fan-btn 描边全部 `rgb(11,140,233)`；带 scoped 属性临时造的 `.panel-run` /
`.panel-slider-thumb` 也是 `rgb(11,140,233)`、文字 `rgb(255,255,255)`
（隔离实例没有工作流，真实运行按钮渲染不出来，用合成元素验 CSS 解析）；
遍历节点全部后代的 color / background / border / fill / stroke / 伪元素，
暗色与亮色均**没有任何 `242,255,89` 残留**；上一节的按钮顺序仍为
「截取 变速 下载 删除」。截图 `bluenode-{dark,light}.png`。

### 后端未重启防呆 + 节点媒体编辑公共内核（2026-11-13）

用户实测音频「截取 / 变速」点击后报 `JSONDecodeError 第1行第4列 出现意外非空白字符`。
原因不是 JSON，是**后端 Python 新路由没重启**：旧进程把
`POST /infinite_canvas/api/audio/process` 落到静态文件路由，返回 `text/plain`
的 `405: Method Not Allowed`（`405` 三字符后第 4 位正是 `:`），前端直接
`res.json()` 就炸。**改后端 Python 必须完全重启 ComfyUI，刷新浏览器无效。**

做法（现抽成 `assets/xcat-media-core.js`，音频与视频共用）：

- `createProbe(api)`：用 `POST {}` 看 `content-type` 是否 JSON，判后端是否就绪；
  失败不缓存，重启后重开窗口即恢复。
- `request(api, payload, signal, label)`：`res.text()` → `JSON.parse`，非 JSON 抛
  「后端 Python 尚未重启，请完全重启 ComfyUI 后重试（只刷新浏览器无效）」。
- `setWarn()` / `.xcat-ae-warn` 横幅：未就绪时禁用导出并给出可操作提示。
- `makeButton()` / `installButtons()` / `activeMedia()` / `warnHtml()` /
  `buildResultNodes()`。

版本号：`xcat-media-core.js?v=20261113e`、`xcat-audio-edit.js?v=20261113g`、
`xcat-video-edit.js?v=20261113a`、`xcat-overrides.css?v=20261113x`。

### 视频节点：提取音轨 / 音视分离 / 截取 / 抽帧（2026-11-13）

> 2026-11-14 按用户要求改名：原「截取片段」→「截取」，原「截取帧」→「抽帧」，
> 抽帧菜单三项同步为「抽取当前帧 / 抽取首帧 / 抽取尾帧」。`action` 取值（`trim` / `frame`）不变。

用户要求参考 Toonflow 项目，交互按用户三项选择定稿：

| 工具 | 交互 | 产物 |
| --- | --- | --- |
| 提取音轨 | 点击直接执行 + 进度弹窗（可取消） | 1 个 `asset-audio`（m4a） |
| 音视分离 | 同上 | 2 个：`asset-audio` + 静音 `asset-video` |
| 截取 | 单段起止：视频预览 + 10 张缩略图条 + 双拖拽手柄 + 数字输入 | 1 个 `asset-video`（mp4） |
| 抽帧 | 点击弹三选一：当前帧 / 首帧 / 尾帧 | 1 个 `asset-image`（png） |

四者都**保留原视频、产物是右侧新节点**。操作行按钮用 CSS flex `order` 固定：
`-6 提取音轨 / -5 音视分离 / -4 截取 / -3 抽帧`，下载 `90`、
全部下载 `91`、删除 `99` 永远在末尾。缩略图固定 10 张，用离屏 `<video>` +
canvas `160×96` JPEG，不随视频时长增长。

后端 `POST /infinite_canvas/api/video/process`：请求
`{ref:{filename,subfolder,type}, action, start, end, frame, time}`，返回
`{action, files:[{filename,name,subfolder,type,role,duration}]}`。FFmpeg 参数照
Toonflow：音频 `-map 0:a:0 -vn -c:a aac -b:a 192k -f ipod -movflags +faststart`；
视频 `libx264 -preset fast -crf 18 -vf pad=ceil(iw/2)*2:ceil(ih/2)*2
-pix_fmt yuv420p -f mp4`；截帧 `-frames:v 1 -c:v png -f image2 -update 1`。
**尾帧不能用 `-ss duration-0.001`**（最后一帧通常早于该时间点，会输出空文件），
改用 `-sseof -1 -i src` + `-update 1` 逐帧覆盖同一 PNG，留下真正最后一帧。

#### 产物节点「toast 成功但凭空消失」：视口外的节点根本加不进去

本轮最费时的坑，别再走回头路。`buildResultNodes()` 先后试过四种写法都失败：

1. `addNodes` + 延迟 80ms `appendItems` —— `appendItems` 操作的是上游
   `useGraph` 自己的 `t=te([])`，而 `__xcatFlow` 是 Vue Flow 实例，两侧靠
   watch + nextTick 双向同步，延迟期间新节点已被旧快照覆盖。
2. `setNodes(旧.concat(新))` 整体赋值 —— 触发正/反向 watch 的 pause/resume
   竞争；hook 日志显示 `setNodes` 后 `after:"1,2,3,4,5"`，下一拍
   `appendItems` 的 `before` 又退回 `"1,2,3,4"`。
3. 上游 `spawnDetachedNode()` —— 虽改真源 `t.value`，但用闭包自增计数器 `r`
   （初始 0）分配 id，和 `xcat-new-node.js` 的 `nextId()`（按现有节点 max+1）
   不同步，菜单建的节点 id 为 `"1"` 时会撞出重复 id。
4. 同一个 tick 内 `setNodes` + `appendItems` —— 仍被异步同步清掉。

真正根因（用 `video-debug7/9/10/12` 四组对照 + hook 定位）：**视口外的节点会
被 Vue Flow / 上游丢弃**。`zoom .7`、窗口 1424×805 时可见 flow 区域仅约
`2034×1150`；实测 `y=2000` 的节点 `addNodes` 后 `getNodes` 里直接没有，
`y=200` 的则正常。老 `placeClear()` 只会无限向下累加 `y`，连续第 4 个产物
（`y≈1395`）必然掉出可见区，于是「前 3 个成功、第 4 个起 toast 成功但节点不见」。

正解（照上游 `spawnItemsNodeAt`）：**节点自带 `data.media`，一次 `addNodes`
增量添加，完全不经过 `appendItems`；`placeClear()` 改成在当前视口的可见区网格
里找离期望点最近的空位**，不再累加 y。`visibleRect()` 从
`__xcatFlow.viewport.value` 与 `innerWidth/innerHeight` 反算 flow 矩形，
`cols/rows` 按 `NODE_W+GAP_X` / `NODE_H+GAP_Y` 铺网格，候选点按曼哈顿距离排序。

验证（8198 干净实例 + CDP 9333）：`video-debug11.js` 连续 6 次
`buildResultNodes` 全部落盘；`verify-video-tools.js` 四工具端到端得到 6 个节点
（`asset-video` 源 + `asset-audio`×2 + 静音 `asset-video` + 截取 `asset-video`
+ 首帧 `asset-image`），媒体文件名与角色均正确；`verify-audiofix-ok.js`
音频回归通过（预检正常、真点导出生成新音频节点、变速预检正常）。
四处（工作区 + Main/Lab/TTS）哈希一致。

#### 截取：预览必须与选区联动（2026-11-13 补齐）

初版只做了「静态时间轴 + 起止输入」，用户反馈「截取没有做到位」。对照
`Toonflow/packages/nodes/videoNode/src/components/videoActions.vue` 的 trim
分支逐条补齐，缺的是这些：

| 能力 | Toonflow 真源 | 本包落地 |
| --- | --- | --- |
| 播放只在选区内 | `@play` → `playSelection` 越界跳回 start；`@timeupdate` → `readTime` 到 end 暂停 | `onPlaySelection` / `onTimeUpdate` |
| 拖边界时预览跟随 | `beginDrag` / `setBoundary` 里 `seekPreview` | `setBoundary` 末尾 `seekPreview(edge==='start'?start:end)` |
| 改输入框时预览跟随 | `@input="seekPreview(valueAsNumber)"` | `onTimeInput` 按触发源跳 start 或 end（原来一律跳 start） |
| 点击时间轴定位 | `@pointerdown="seekTrack"` | `seekTrack`，clamp 在 `[start,end]` |
| 播放头 | `.playhead` 随 `currentTime` 移动 | `.xcat-ve-playhead` + `paintPlayhead` |
| 时间刻度尺 | 5 个 `formatTime(d*i/4)` | `.xcat-ve-ruler` + `buildRuler` |
| 边界约束 | `clipLimit=floor(d*100)/100`、`minimumLength=min(0.01,clipLimit)`、`start<=end-minLen` | `S.limit` / `S.minLen` / `setBoundary`；`valid()` 不再放宽 `+0.05` |
| 键盘微调 | 方向键 ±0.1 / Shift ±1 / Home / End，`role=slider` + aria | `changeBoundary` + `aria-valuenow/min/max` |
| 手柄拖拽 | pointer capture + **相对位移**换算 | `bindHandle` 记 `x0/t0`，避免抓边缘先跳一下 |
| 处理中冻结 | `:disabled="processing"` | `lockTrim` 禁用输入/手柄 + `.is-busy` 半透明 |
| 缩略图不变形 | cover 等比居中绘制 | `scale=max(160/vw,96/vh)` 居中 `drawImage` |

样式同时对齐参考：弹窗 760px、时间轴头部「原视频 mm:ss.cc」、选中区上下
3px 主色边 + 10% 主色底、16px 实色手柄（白竖条 / hover / 聚焦描边）、
10 张缩略图带分隔线、5 点刻度尺。**轨道必须 `overflow:visible`**，否则贴在
100% 的结束手柄右半边会被切掉抓不住；圆角改由 `.xcat-ve-strip` 自己裁。
`fmt()` 补成 `mm:ss.cc`（分钟两位）。`buildThumbs()` 增加 `alive()` 回调，
弹窗关闭后立刻停止后台解码；`close()` 主动暂停预览视频。

验证 `verify-trim-parity.js`（8198 + CDP 真鼠标 / 真键盘，6 秒带音轨素材）：
结构 10 缩略图 / 5 刻度 / 播放头 / role=slider 全部到位；输入 start=1 →
预览 1.000、输入 end=3.5 → 预览 3.500、点轨道 45% → 2.697、拖结束手柄
+90px → end 3.5→4.28 且预览 4.28、ArrowLeft → 0.9、Shift+ArrowRight
→ 1.9、从 0 播放跳回 1 并在 2.199 自动暂停、真点执行生成带时间段的视频节点。
暗 / 亮截图 `trim-parity-{dark,light}.png`；`verify-video-tools.js` 四工具
回归 6 个节点全通过。

### 视频 / 图片节点也去掉「预览」（2026-11-13）

用户「视频的预览也不需要，图片也不需要」—— 接上一节音频去预览的「也」。
改 bundle 里我们自己的 `xcatFanActions()`，把原来只针对音频的条件扩成
音频 / 视频 / 图片三类，各自按角色（`asset-*` / `gen-*`）命中，并保留当前
素材 `kind` 兜底：

```js
if(a.key==="preview"&&(
  xnr==="asset-audio"||xnr==="gen-audio"||kind==="audio"||
  xnr==="asset-video"||xnr==="gen-video"||kind==="video"||
  xnr==="asset-image"||xnr==="gen-image"||kind==="image"
))return!1;
```

按角色命中，所以**还没生成结果的 gen-* 空节点也没有预览**；文本节点早前已被
同一函数整体排除。无素材、且不属于这三类的节点仍保留预览（本次没动）。

版本号 `index-BXU58XDe.js?v=20261113q`（上一版 `p` 只过滤音频）。

验证（8198 + CDP 真鼠标 hover，脚本 `verify-no-preview.js`，暗 / 亮截图
`nopreview-{dark,light}.png`）：

| 节点 | 操作行 |
| --- | --- |
| 素材图片 | 裁切 / 扩图 / 宫格 / 下载 / 删除 |
| 素材视频 | 提取音轨 / 音视分离 / 截取 / 抽帧 / 下载 / 删除 |
| 素材音频 | 截取 / 变速 / 下载 / 删除（回归） |
| gen-image / gen-video / gen-audio 空节点 | 删除 |

（上表为当时的结果；裁切 / 扩图 / 宫格已在后面「删除图片节点的裁切 / 扩图 / 宫格」
一节删掉，现在素材图片只剩 `下载 / 删除`。）

六类节点**均无「预览」**，下载 `90`、删除 `99` 仍在末尾，视频四工具
`-6/-5/-4/-3`、音频 `-2/-1` 顺序不变。只改前端 bundle，四处同步后刷新即可。

### 删除图片节点的裁切 / 扩图 / 宫格（2026-11-13）

用户「删除现有的节点功能：裁剪、扩图、宫格」。其中「裁剪」对应上游按钮
`key:"crop"`、label「裁切」；三个 key 是 `crop` / `expand` / `grid`。

**做法**：不改 `L` 按钮定义、不动上游弹窗组件，只在补丁函数 `xcatFanActions()`
里把这三个 key 一律过滤掉（`return!1`），和此前「去预览」同一处。这个函数同时
被两处调用 —— 节点操作栏 `.node-actions` 与预览面板内的 `.tool-btn` 工具条 ——
所以两处入口一并消失。后端本来就没有 crop / expand / grid 路由，其它注入脚本
也没有引用；上游三个弹窗组件保留在 bundle 里成为不可达死代码，要恢复只需把
这一行改回 `return kind==="image"`。

删除后**素材图片节点只剩「下载 / 删除」**；视频、音频、文本节点按钮行不受影响：
视频 `提取音轨 / 音视分离 / 截取 / 抽帧 / 下载 / 删除`，音频
`截取 / 变速 / 下载 / 删除`。`order` 规则没动（下载 `90`、删除 `99` 仍在末尾）。

注意：右下浮动工具条的「九宫格」（网格吸附，15px 对齐）与这里的 `grid` 宫格
不是同一功能，未动。

版本 `index-BXU58XDe.js?v=20261113q→r`、`xcat-overrides.css?v=20261113z→aa`（CSS 只改注释）。
只改前端，四处同步后刷新浏览器即可。

## 图片节点三个工具：宫格切分 / 镜像 / 调整（2026-11-13）

参考 **`E:\Toonflow\packages\nodeShared\src\`**（注意不是旧的
`C:\Users\41325\Downloads\Toonflow-app-master`，那个版本没有「镜像 / 调整」）：

| 功能 | 参考真源 | 交互 | 产物 |
| --- | --- | --- | --- |
| 宫格切分 | `components/imageGridSplit.vue` | 2/3/4/5 宫格预设 + 行数/列数各 1~10 自定义 + 原图上叠加网格线与序号实时预览 + 「共 N 张图片 / 从左到右，逐行切分」汇总 | 一次切出 N 张 PNG，N 个 `asset-image` 节点，名 `原名 · 行-列` |
| 镜像 | `components/imageMirror.vue` | 左右翻转 / 上下翻转 / 顺时针 90° / 逆时针 90° / 180° 五选一，悬停或聚焦时 CSS transform 实时预览，点即执行 | 1 张 PNG，名 `原名 · 左右翻转` 等；90° 旋转交换宽高 |
| 调整 | `components/imageAdjust.vue` + `imageAdjust.ts` | 11 个滑块（亮度 / 曝光 / 对比度 / 高光 / 阴影 / 饱和度 / 自然饱和度 / 暖色 / 淡色 / 清晰度 / 晕影，除晕影 0~1 外都是 -1~1、step 0.01）+ 重置 + 512px canvas 实时预览 | 1 张 PNG，名 `原名 · 调整 亮度·对比度·…`（取前三项） |

三者共同约定与参考一致：**只搬像素、生成新节点、原图保留、输出 PNG**。

### 架构决策：纯前端，后端零改动

参考实现本来就是 Vue 组件里 `new Image() + canvas.drawImage + toBlob`，
没有后端依赖。本包 dist 是编译产物（无 node_modules、无法注册 Vue 组件），
所以改成两个独立注入脚本：

- `xcat-image-adjust-core.js`：把 `imageAdjust.ts` 的 11 项算法**逐行移植成纯 JS**。
  魔数（saturation 的 `0.213/0.715/0.072`、vignette 的 `inner .20 / outer 1.1 /
  curvature .65`、highlights 的 `-0.76 / -0.8`）与合并顺序全部照抄；像素在
  **[0,1] 线性光**空间算，入口 sRGB 解码、出口编码，中间必须 `Float32Array`
  中转（直接用 8bit ImageData 会把暗部量化吃掉，与 GPU 差 20~40 灰阶）。
  预览走 512px 下采样副本、每次从副本重算；导出按原图全分辨率重算一次
  （清晰度这类局部对比算子必须在原分辨率做才准）。
- `xcat-image-tools.js`：按钮注入 + 三个弹窗 + Canvas 处理 + 上传 + 建节点。

产物落盘**复用本包已有的 `POST /infinite_canvas/api/media`**（JSON
`{name, data: dataURL}` → 写进 `input/`，返回 `{name, filename, subfolder, type}`），
再交给 `xcat-media-core.js` 的 `buildResultNodes()` 生成 `asset-image` 节点。
因此**没有新增后端路由、不需要重启 ComfyUI，刷新浏览器即可生效**。
失败时会用 `DELETE /api/media/{filename}` 清掉已上传的孤儿 PNG。

### 踩过的坑

1. **`commit()` 的 Promise 链必须累积结果**：逐张串行上传时若每个 `.then`
   只返回单个对象，最后传给 `buildResultNodes()` 的就是对象而不是数组，
   报 `files.forEach is not a function`。用 `results[]` 累积。
2. **大批量切分要先把视口缩小，且可见区必须包含源节点**。上游 Vue Flow 会
   丢掉视口外没能完成初始化的节点（见「视频节点四工具」节第 4 条坑），
   `buildResultNodes()` 的 `placeClear()` 又是按 `visibleRect()` 找空位。
   `ensureViewportFor(count)` 在 >9 个产物时按
   `side=ceil(sqrt(count))` 计算所需 flow 宽高，调 `setViewport()` 缩小 zoom
   并平移。**第一版把可见区左上角设在源节点右侧，结果源节点自己被推出可见区
   清掉，连带打乱 id 分配（25 张只剩 24 张、`1-1` 丢失）**；改成从源节点
   左上角起算后 5×5 = 25 张全部留住（zoom 0.7→0.418）。
3. **滑块列表不要内层滚动**：初版给 `.xcat-im-adjust-list` 设 `max-height:250px`，
   11 行里最后一行「晕影」被切掉半截。改成不设高度、由外层
   `.xcat-ae-body`（已有 `overflow-y:auto`）承担滚动，并按项目约定给它补回
   10px 轨道 / 6px 圆角滑块（`scrollbar-width:auto` 复位 +
   `::-webkit-scrollbar-button{display:none}` + `background-clip:padding-box`）。
4. 镜像弹窗的「暂无图片」占位在有图时必须移除，否则会露在预览图下方。
5. 图标用内联 SVG + `stroke="currentColor"`（参考用 Tabler 图标组件，
   独立 iframe 里用不了），暗亮主题自动跟随。

按钮 CSS `order` 为 `-9 / -8 / -7`，排在视频四工具 `-6..-3`、音频 `-2/-1`
之前；下载 `90`、删除 `99` 永远在末尾。版本号
`xcat-image-tools.js?v=20261113d`、`xcat-image-adjust-core.js?v=20261113a`、
`xcat-overrides.css?v=20261113ac`。

### 验证（8198 干净实例 + CDP 9333 真鼠标）

- `verify-image-tools.js` 全通过：按钮行 `宫格切分 / 镜像 / 调整 / 下载 / 删除`
  且 order 为 `-9/-8/-7/90/99`；宫格预设 2→2×2/4 格、3→3×3/9 格，
  切分生成 9 个节点、切片尺寸 213×120（640/3、360/3）、编号 `1-1`…`3-3`；
  悬停镜像 `scaleX(-1)`、真点后像素红→蓝且宽高不变 640×360；
  调整 11 滑块、亮度 +0.50 预览均值 112.6→157.2、导出全分辨率且确实变亮；
  视频节点按钮行不变。
- `check-adjust-core.js` 26 项像素级自检全通过（恒等 / 各滑块正负值 /
  无 NaN / 亮度方向 / alpha 不变）。
- `verify-image-grid-bulk.js`：5×5 = 25 张全部留住且都带 media，26 个节点。
- 回归：视频四工具 `8 DONE`（6 个产物节点）、音频截取导出生成新 m4a 节点。
- 截图 `image-tools-{grid,mirror,adjust}-dark.png`、`image-tools-adjust-light.png`。

## 图片节点第四个工具：裁剪（2026-11-13，分支 `feat/image-crop`）

用户「增加裁剪功能」。因为上一轮刚把上游的「裁切 / 扩图 / 宫格」三个入口删掉，
这里存在两条路，先按约定问过再动手，用户选 **「按新体系重做」**：
不走上游那个被过滤的 `crop` 弹窗，而是和宫格切分 / 镜像 / 调整共用
`xcat-image-tools.js` 的同一套弹窗骨架、`upload()` / `commit()` / `buildResultNodes()`
内核。**`E:\Toonflow` 里没有独立的图片裁剪组件**（`imageEditor.vue` 是标记 / 局部重绘，
`imageOutpaint.ts` 是扩图提示词），所以只借交互定位，实现是本包自研。

| 项 | 做法 |
| --- | --- |
| 按钮 | `裁剪`，文字按钮，`order:-10`，排在宫格切分 `-9` 之前；弹窗宽 520px |
| 选区 | 拖拽新建 / 框内拖动 / 四角 + 四边共 8 个手柄缩放，带三分构图参考线，框外用 `box-shadow: 0 0 0 9999px rgba(0,0,0,.55)` 压暗 |
| 比例 | **12 项**：自由 / 原图 / 1:1 / 4:3 / **3:4** / 3:2 / **2:3** / 16:9 / 9:16 / **21:9** / **9:21** / 自定义。横竖成对，锁定时以拖拽方向的「对边 / 对角」为固定点，按宽度反推高度，再按到边界的可用空间统一收缩 |
| 自定义比例 | 选中「自定义」胶囊后展开「宽 : 高」两个整数输入（默认 5:4），实时显示 `21 : 9 · 2.333` 这类比值并立即重算选区；非法值（0 / 空 / 非数）退回自由比例并提示。任何比例都能锁定，不必再逐个补预设 |
| 数值 | X / Y / 宽 / 高 四个原图像素输入，与选区双向联动、越界自动 clamp；方向键微调 1px，Shift 10px；「全选」按当前比例取最大内接矩形 |
| 输出 | 初始居中 80% 选区；`drawImage(img, sx,sy,sw,sh, 0,0,sw,sh)` 按**原图全分辨率**裁切 → PNG → `/api/media` → 1 个 `asset-image` 节点，名 `原名 · 裁剪 W×H`，原图保留 |

### 关键技术点

1. **坐标系一律用原图像素**。`S.rect` 存 `{x,y,w,h}`（原图），只在 `paintCrop()`
   渲染时乘 `S.scale`；导出直接取整交给 `drawImage` 九参数形式，预览缩放不引入
   取整误差。
2. **预览框尺寸由 JS 显式算出**，`.xcat-im-crop-frame` 直接设 `width/height`
   （`scale = min(availW/natW, availH/natH)`），图片 `position:absolute; inset:0;
   width:100%; height:100%`。照旧避开「父级 `display:grid` + `max-height:100%`
   退化成 none，竖向媒体被裁」的坑。实测 640×360 → 416×234，比例误差 < 0.02。
3. **8 个手柄 + 比例锁定共用一套 `cropResize()`**：由 `dir` 里的 `n/s/e/w`
   推出固定点 `fx/fy` 与方向 `dx/dy`，锁比例时 `w = max(w, h*r); h = w/r`，
   再用 `lim = min(availW, availH*r)` 收缩，最后 clamp 回画布内。
4. **纯前端、后端零改动**，沿用 `POST /infinite_canvas/api/media`，刷新浏览器即可。

### 踩过的坑

- **命中浏览器缓存时「应用」按钮被压成 disabled**：`openCrop()` 末尾那行
  `run.disabled = true` 排在 `init()` 之后。图片未缓存时 `load` 事件异步、最后
  由 `paintCrop()` 设回可用；**已缓存时 `img.complete` 为真、`init()` 同步跑完，
  随后被这行覆盖成禁用**，表现为「打开裁剪什么都没干，按钮却点不了」。
  把禁用挪到 `init()` 之前即修复，并在验证脚本里加了「第二次打开」的专项回归。
- 整图选区（点了「全选」）时直接填 `X` 会被 clamp 到 0，因为宽度已占满、
  选区不能右移 —— 这是裁剪器的正常行为，不是联动失效；先缩小宽高再填 X/Y 即可。
- 数值输入隐藏了原生 `::-webkit-*` spin button，否则四列布局里箭头会挤掉数字。

版本号 `xcat-image-tools.js?v=20261113d→g`（e 首版、f 修缓存 bug、g 补比例）、
`xcat-overrides.css?v=20261113ac→ae`。`index.html` 注释同步改成「四者」。

### 验证（8198 干净实例 + CDP 9333 真鼠标 / 真键盘）

- `verify-image-crop.js` **全部通过**：按钮行 `裁剪/宫格切分/镜像/调整/下载/删除`
  且 order `-10/-9/-8/-7/90/99`；弹窗 12 比例 / 4 输入 / 8 手柄 / 4 三分线、
  frame 与 img 同为 416×234、等比无裁切；真拖拽框选换算误差 <6px；拖 se 手柄
  放大；**10 个预设逐个真点击校验 w/h（误差 <0.02 且选区不越界）**；自定义
  7:5 生效、非法值回退、切回自由后收起；全选 / 四格数值联动 / 越界 clamp /
  → 与 Shift+→ 微调；导出 300×220，**五个取样点跨红蓝白三色块全部与源图对应
  坐标像素一致**（证明是全分辨率裁切而非缩放、且位置正确）；缓存命中再次打开
  「应用」仍可用；亮色主题截图；视频按钮行与宫格切分弹窗回归不变。
- `verify-image-tools.js` 更新按钮行期望后**回归全通过**：9 张切片 213×120、
  镜像红→蓝、调整 11 滑块均值 112.6→157.2、导出 640×360。
- 截图 `image-crop-dark.png`、`image-crop-light.png`、
  `image-crop-custom-dark.png`、`image-crop-before-apply.png`。
- `node --check` 通过、CSS 括号配对 720/720；四处 `index.html` /
  `xcat-image-tools.js` / `xcat-overrides.css` 哈希一致。只改前端，刷新即可。

### 补齐比例预设与自定义比例（同日，用户反馈）

用户「怎么只有 1:1、4:3、3:2、16:9、9:16，3:4 呢？2:3 呢？21:9 呢？」——
首版只给了横版 + 一个竖版 `9:16`，**漏了所有镜像比例和超宽**。补法：

- `CROP_RATIOS` 扩到 **12 项**：在原 7 项基础上补 `3:4 / 2:3 / 21:9 / 9:21`，
  形成 `4:3↔3:4`、`3:2↔2:3`、`16:9↔9:16`、`21:9↔9:21` 四组横竖对称；
  胶囊行 `flex-wrap` 自动折成两行（第一行 9 项、第二行 3 项），实测无重叠。
- 再加第 12 项 **「自定义」**，点开后展开「宽 : 高」两个整数输入（默认 5:4），
  `S.customRatio = w/h`，`ratioValue()` 对它单独分支；输入即重算选区并实时显示
  `21 : 9 · 2.333`，非法值退回自由比例并提示。这样任何比例都不必再补预设。
- **坑**：`.xcat-im-crop-custom` 设了 `display:flex`，会盖掉浏览器 UA 的
  `[hidden]{display:none}`，必须自己再写一条
  `#app .xcat-im-crop-custom[hidden] { display: none; }`，否则这行永远收不起来。
- 展开自定义后 `.xcat-ae-body` 高 554px = `scrollHeight` 554px，内容完整可见、
  不会把底部按钮挤出弹窗。`21:9` 实测选区 640×274（Y=43 居中）。

## 画布缩放上限 200% → 1000%（2026-11-13，分支 `feat/zoom-range`）

用户「画布放大 200 就不能放大了，我希望像 comfyui 一样可以放大到 1000」。

**数值不是猜的**：解 ComfyUI 前端包 `treeUtil-D1drLutg.js.map` 的
`sourcesContent`，真源 `src/lib/litegraph/src/DragAndScale.ts` 构造函数里是
`this.max_scale = 10` / `this.min_scale = 0.1`，即 **10%～1000%**。
本包是 Vue Flow 不是 litegraph，但语义一一对应。

**卡在 200% 的是四处独立上限，缺一不可**：

| 位置 | 原来 | 现在 |
| --- | --- | --- |
| 主画布 `<VueFlow id="demo">` props | `min-zoom:.02` / `max-zoom:2` | `max-zoom:10`（下界不动） |
| 工作流预览 `<VueFlow id="wf-preview">` props | `min-zoom:.2` / `max-zoom:2` | `max-zoom:10` |
| 预览弹层 `h(w)` 里的 `zoomTo` clamp | `Math.min(Math.max(w,.2),2)` | 上界 10 |
| 右下工具条 `setZoom(z)` | `Math.min(2,Math.max(.02,z))` | `Math.min(10,Math.max(.02,z))` |
| Vue Flow store 内置默认值（兜底） | `minZoom:.5,maxZoom:2` | `minZoom:.1,maxZoom:10` |

props 优先于 store 默认值：两个 VueFlow 都显式传了 `min-zoom`/`max-zoom`，
store 默认只在初始化瞬间生效，所以**只改 store 默认值不解决问题**；反过来
只改 props 也行，但把 store 一起对齐可避免以后新增未传 props 的实例又卡 2。
d3 在 `Viewport` mounted 时 `scaleExtent([store.minZoom, store.maxZoom])`，
实测 `d3Zoom.scaleExtent() === [0.02, 10]`。下界刻意保留主画布原有的
`.02`（2%）和预览的 `.2`，不因为对齐 ComfyUI 就削弱已有能力。

**UI 配套**：
- 工具条百分比输入本来就是 `min:1,max:1000`，但被 `setZoom` 的 2 砍掉，
  现改成 `min:2,max:1000`，与下界 `.02` 对齐；填 1000 直接到 1000%。
- `.tb-zoom` 从固定 `width:60px` 改成 `width:auto;min-width:60px`，
  `.tb-zoom-val` 加 `white-space:nowrap`。官方按钮按最多 3 位（100%）设计，
  `1000%` 是 4 位，固定宽度会把下拉箭头挤出按钮（实测改后按钮 76px =
  文字 40px + caret 16px + gap 4px + padding 16px，无重叠）。
- **顺手修一个边界 bug**：「放大 / 缩小」原来用四舍五入后的百分比
  `zpct/100*1.2` 算步进，在 2% 时 `2×1.2=2.4%` 又被取整成 2%，连点放大
  永远卡在下界；改用真实 `viewport.zoom*1.2`。

**验证**（8198 干净实例 + CDP 9333 真滚轮 / 真鼠标，`verify-zoom-range.js`
**25 项全通过**）：
- `scaleExtent = [0.02,10]`；真滚轮 36 次把 `0.7 → 10`、再滚 8 次仍 10；
  反向 60 次停在 `0.02`。`.vue-flow__transformationpane` 的 transform 实测
  `matrix(10,0,0,10,…)`。
- 两层网格 `pattern` 宽度从 `10/100` 变成 `100/1000`（`scaledGap=gap×zoom`），
  无摩尔纹、无 pattern id 撞车。
- 工具条显示 `1000%`、输入 `2000` 收敛到 1000、`500` 精确生效（旧版卡 200）、
  输入 `1` 收敛到 2%；2% 点放大脱离下界、1000% 点缩小到 833%；
  有节点时「适应视图」把 1000% 收敛到 2.722。
- 注入一个 480×270 素材文本节点，1000% 下 DOM 尺寸 `4800×2700`
  （比值精确 10.000），截图里文字清晰锐利，不是位图拉伸。
- **两个验证手法坑**（不是产品 bug，记下来免得以后误判）：
  ① 缩放 transform 挂在 `.vue-flow__transformationpane`，不是
  `.vue-flow__viewport`；② 切主题必须点真实 `.cm-item`（它会更新 Vue 的
  `theme` ref → `patternColor`），只 `setAttribute('data-theme','light')`
  会让 CSS 底色变亮但网格线仍是暗色 `#191919`，截出错误的"亮色网格"。
  真实亮色下两层线是 `#e6e6e6` / `#ebebeb`。

**改动文件**：`index-BXU58XDe.js`（5 处字面量 + 2 处按钮步进）、
`xcat-overrides.css`（按钮宽度）、`index.html`（bundle `r→s`、
overrides `ae→af`）。**纯前端，后端零改动、不用重启，刷新即可**。
截图 `zoom-popup-1000-dark.png`、`zoom-1000-light-real.png`、
`zoom-node-content-1000-dark.png`。四处哈希一致。

## 工作流配置自动识别分辨率选择器（2026-11-13，分支 `feat/workflow-resolution-autofill`）

用户实际在用的 `image_minimax_h3_image_t2i.json` 里有 `class_type: "ResolutionSelector"`
（inputs `aspect_ratio / megapixels / multiple`），手工配置的 `.fields.json` 里
「高宽比」只有 `options: ["1:1 (Square)"]` 一项、「百万像素」没有 min/max/step，
于是画布节点上的比例下拉只有一个选项。现在上传 / 打开工作流配置时自动识别并补全。

**识别规则（用户选定）**：不看 `class_type`，只要一个节点同时有
`aspect_ratio` 与 `megapixels` 两个输入就按分辨率选择器处理。官方
`ResolutionSelector`、本包 `🐈‍⬛ResolutionSelector`（DynamicCombo / Custom）
和同结构的第三方节点都覆盖。

| 环节 | 行为 |
| --- | --- |
| 后端 `GET /workflows/{name}/fields` | 该节点从没配置过 → 自动注入 `aspect_ratio`（select，`auto:true`）与 `megapixels`（number，`auto:true`）两条；已配置过则只补内容、不擅自改动用户的勾选 |
| `aspect_ratio` | 自动填完整比例 + 中文名「高宽比」；默认 `1:1 / 2:3 / 3:2 / 3:4 / 4:3 / 9:16 / 16:9 / 21:9` 八项，本包 `🐈‍⬛` 节点追加 `Custom` 共九项。用户自定义过的额外选项保留在末尾 |
| `megapixels` | 自动填中文名「百万像素」与 `min / max / step`：官方 `0.1 / 16 / 0.01`，本包节点 `0 / 16 / 0.01`（对齐 `nodes/resolution_selector.py` 的 0.01 步长） |
| 默认值 | 取工作流里的当前值；DynamicCombo 的 dict 值取其中的 `aspect_ratio` 选中项 |
| 前端字段弹窗 | 两条自动勾上、完整选项与数值直接显示，footer 追加「· 已自动识别分辨率选择器」，并置脏让「保存配置」可落盘 |
| 选项真源 | 弹窗打开时再 `fetch('/object_info/<class_type>')`，用节点真实定义的 `options` 与 `min/max/step` 覆盖自动字段（第三方节点也能对），失败静默回退内置表 |
| 执行时回填 | `_apply_params` 对 dict 型 `aspect_ratio` 只替换 `{"aspect_ratio": 选中值}`，保留 `custom_width/custom_height`，避免把 DynamicCombo 写成字符串导致 API 400 |

**不擅自改用户文件**：自动填入只在读取时动态生效，所以已有的
`.fields.json`（即使只有一项选项）不用重新保存，画布节点刷新即可选到全部比例；
只有点「保存配置」才把补全结果写进 `<name>.fields.json`。
前端 `Bo()` 与节点预览会过滤掉内部哨兵记录，画布不会多出控件。

**取消自动的机制**：把两条自动字段都取消勾选并保存，会写入
`{"nodeId": id, "key": "__xcat_no_auto__"}` 哨兵（`fields` 数组 +
顶层 `noAutoResolution` 都写），后端跳过注入、弹窗不再自动勾，但仍可手动勾选；
删掉工作流重新上传 / 清空配置即恢复自动。哨兵必须随 `GET → PUT` 往返，
只写顶层会「关不掉」（第一版踩过，已修）。

**改动文件**：`__init__.py`（识别 / 补全 / 注入 / 哨兵 / `_apply_params` dict 回填）、
`index-BXU58XDe.js`（`NodeFields` 的 `p()` 允许 dict 型 `aspect_ratio` 成为字段行、
`auto` 标记与哨兵输出、footer 提示、`xcatEnhance()` 读 object_info、
`Bo()` 过滤哨兵）、`dist/index.html`（bundle `s→t`）。**改了后端 Python，
三处部署副本已同步，自己的 ComfyUI 必须重启才生效。**

**验证**：`verify-resolution-fields.py` 26 项全通过（注入 / 残缺补全 / 哨兵 /
本包 dict / 第三方 / 普通节点不误伤 / `_apply_params` dict 回填）；
`verify-resolution-ui.js` 33 项全通过（弹窗自动填入与落盘、本包 9 项含 Custom、
画布节点下拉 8 项与 16:9 写回 params、取消自动不复发、暗亮主题）。
截图 `resolution-config-dark.png`、`resolution-config-light.png`。
只改前后端逻辑，CSS 未动（overrides 版本仍是 `af`）。

## 画布顶部状态条：菜单栏监视器进画布（2026-11-13，分支 `feat/canvas-monitor`）

用户给了一张 ComfyUI 菜单栏截图，要求「这些也出现在画布里」——即
`RAM Cleanup / VRAM Cleanup ┃ CPU / RAM / GPU / VRAM / TEMP` 整套状态条。

**位置**：画布顶部 `.canvas-tabs-strip`（38px 高）右侧的整段空白，绝对定位
`top:3px; right:12px`，宽 346px、高 32px，与 ComfyUI 菜单栏里的位置一一对应，
不占标签栏的 flex 流、不遮画布内容、不覆盖「+」新建画布按钮。
顶部标签栏与 `.vue-flow` 是兄弟节点，所以状态条天然不在画布图层里。

**实现**：新增 `frontend/dist/assets/xcat-monitor.js`，`index.html` 以
`?v=20261113a→b` 注入。外观（配色、38×30 段、50×30 两行按钮、1×22 分隔符、
数值格式、tooltip、峰值记录）逐字段对齐 `web/monitor.js`，读数是同一份数据源：

```
GET  /xxxxxlcat-monitor   500ms 轮询，cpu / ram / gpus / disk / ts
POST /prompt              RAM Cleanup → 🐈‍⬛RAMReclaim（clean_file_cache、
                          clean_processes、clean_dlls、retry_times:3）
                          VRAM Cleanup → 🐈‍⬛VRAMSweep（offload_model、
                          offload_cache），client_id = xxxxxlcat-canvas-monitor
```

画布是独立 iframe，拿不到 ComfyUI 前端的 `app` / `api` 模块，所以直接用**同源
fetch**（实测 iframe 内 `/xxxxxlcat-monitor` 返回 200，字段完整），不需要父页面
桥接、不需要改后端、不需要新增路由。清理按钮点下去是真正排入 ComfyUI 队列执行，
不是摆设；两个按钮各自独立禁用 800ms，互不吞点击（首版误用了全局 busy 标志，
已修）。

**两处必要的适配**：
- 深色底板 `rgba(23,23,24,.94)` + 6px 圆角：状态段原本是
  `rgba(255,255,255,.07)` 半透明白底 + 白字，那是针对 ComfyUI 深色菜单栏写的；
  画布亮色主题下顶栏是浅灰，会白字白底看不见。给整条一个深色底板后，暗/亮
  两种主题都可读，观感也与菜单栏一致。
- 每次轮询都检查 `root.isConnected`：Vue 重渲染 / 主题切换可能换掉标签栏子节点，
  掉了就在 500ms 内自动挂回（验证里手动 remove 过一次）。

**手势隔离**：状态条在 `.vue-flow` 之外，但上游把双击建节点、滚轮缩放等监听绑在
window 上，所以在**冒泡阶段**拦 `pointerdown / mousedown / dblclick / wheel /
contextmenu`。注意不能在 capture 阶段拦 —— 祖先节点 capture 里
`stopPropagation()` 会让事件到不了按钮自身，清理按钮就点不动了。

**验证**（8198 干净实例 + CDP 真鼠标，`verify-canvas-monitor.js` **全部通过**）：
挂载父节点与 z-index、7 项结构与文案顺序、位置（`strip.right - root.right = 12`、
底边 35 ≤ 38、不覆盖「+」）、五格数值与 tooltip 逐项对照实时遥测（CPU 14%、
RAM 48%、VRAM 29.1G / 91.5% 填充、TEMP 39°C）、填充高度误差 <0.2%、
手动移除后 500ms 自动重挂、双击不弹新建节点菜单也不建节点、滚轮不缩放、
两个清理按钮的 `/prompt` 载荷与独立禁用恢复、真实 `.cm-item` 切亮色后的底板色、
标签栏 / 左栏 / 右下工具条 / 缩放上限 10 全部回归。
截图 `canvas-monitor-{dark,light}.png`、`canvas-monitor-strip-{dark,light}.png`（3× 放大）。

**只改前端，后端零改动，刷新即可**；三处部署副本已逐文件同步，四处哈希一致。
`web/monitor.js` 未动，菜单栏原状态条保持原样，两边各读各的接口、互不依赖。

## 生成产物留在节点自己的框里 + 素材节点真正禁连（2026-11-13，分支 `feat/gen-result-new-node`）

用户反馈三件事：① 点「运行」后产物要落在**原节点里**，不要新建节点；② 产物不该出现在
接入端口，第一行显示**接入的素材**；③ 素材节点虽然没有左侧接入口，却仍然能接线。

**先分清楚节点里的两个「框」**（上游组件，看 DOM 实测）：

| DOM | 位置 | 数据 | 作用 |
| --- | --- | --- | --- |
| `.node-media > .media-stack` | 节点本体（收起态就可见的大缩略图区） | `data.media` | **节点自己的产物框**；为空时生成节点显示 `.xcat-gen-empty`「选择工作流并运行，生成结果会显示在这里」 |
| `.node-panel > .media-strip` | 点击节点展开的面板第一行（**提示词框上方那条**） | `q()` 过滤后的 `data.inputMedia` | **接入端口**：只列带 `sourceId` 的项（= 其他节点连线接过来的素材）；节点自身的上传 / 粘贴 / 生成产物一律不进来 |

我第一版把「产物留在原节点」理解反了，改成给每个产物新建 `asset-*` 节点——所以产物
跑到节点外面去了。正确行为是产物写回**原节点自己的产物框**，第一行只保留接入素材。

**根因**：
- 执行成功回调 `Oi()` → `O(v,se)`，而上游 `O()` 是 `W.data.media=[T[0]]`，只取第一个
  产物；并且 `q()` 把 `data.media` 也塞进第一行的 `own` 组，于是产物同时出现在
  「接入端口」和产物框里，第一行就被生成结果占掉了。
- 素材节点的左侧 target handle 只加了 `xcat-port-hidden` class（CSS `opacity:0;
  pointer-events:none`），**DOM 必须保留**（删掉会让已有连线的末端退到节点左上角
  悬空）。但 Vue Flow 靠 `handleBounds` 找端口，`pointer-events:none` 挡不住；更关键
  的是上游 `onConnectEnd` 有一段「拖到节点本体就直接建边」的兜底逻辑，完全绕过 handle
  检测 —— 这才是「没有接入口还能接线」的真凶。

**改动**（`frontend/dist/assets/index-BXU58XDe.js`，bundle `x↔y`、`xcat-overrides.css?v=ag`）：
1. `O()` 还原并补全：`W.data.media = T`（**全部**产物，不再只取 `[0]`）、
   `index = 0`、`F(v,[T[0]])`。**不新建节点、不碰 `inputMedia`、不自动连线。**
2. `q()`：**只返回 `inputMedia` 中带 `sourceId` 的项**（所有角色统一，不再区分 `gen-`/`asset-`），
   即第一行只显示「其他节点接过来的素材」；`data.media`（自身上传 / 粘贴 / 生成产物）
   完全不进第一行，只在产物框里显示。见下一节「二次纠正」。
3. 素材节点禁连四重拦截：节点渲染给 target handle 传 `connectable:xcatIsGen(e.data)`；
   `xcatIsAssetTarget(id)` 判定 + 在 `onConnect` (`Ge`)、`onConnectEnd`（节点本体兜底
   分支）、`le()`（同步 `inputMedia`）、`oe()`（媒体变化同步下游）四处拦掉 `asset-*`
   目标。`xcat-port-hidden` 的 CSS 保留，已有连线的几何不受影响。
   调试钩子 `window.__xcatIsAssetTarget` / `window.__xcatSpawnResults`。

**验证**（8198 + CDP 真鼠标，`verify-gen-result.js` **ALL PASS**）：
- `O()` 写回后节点总数不变（4→4，`before=4 after=4`）；原节点 `media` 拿到两个产物、
  `inputMedia` 仍是「接入素材.png」、坐标不变；边缘数不变（不自动连线）。
- 产物框 `.media-stack-card` title = `生成结果 1.png, 生成结果 2.png`。
- 点开节点面板后第一行 `.media-strip .strip-item` = `["接入素材.png"]`（无产物）；
  素材节点 B = `["素材B.png"]`；无接入素材的生成节点 D 第一行为空、产物框仍显示自身产物；
  无产物的生成节点 C 显示 `.xcat-gen-empty` 占位。
- 端口 class：生成节点 target handle 带 `connectable`，素材节点不带（只有
  `xcat-port-hidden`）；`xcatIsAssetTarget` 判定正确。
- 真鼠标从生成节点拖到素材节点本体 / 隐藏左端口都不建边且 `inputMedia` 不被污染；
  生成节点 → 生成节点仍能连线，`le()` 同步未被误伤。
- 状态条、缩放上限 10（1000%）、左栏、右下工具条回归。
- 截图 `gen-own-box-dark.png` / `gen-own-box-light.png`。

**纯前端，后端零改动，刷新即可**；三处部署副本已同步，四处哈希一致。
`Oi()` 仍调用 `O(v,se)`，真实执行完成链路走的就是这套逻辑。

### 二次纠正：第一行「只认接入素材」，不是「节点自身的素材」（2026-11-13 晚）

用户第二轮反馈原话：「我说的是**提示词上面那个区域**里的内容！！」「`@image#1:Clipboard_Screenshot.png`
这里是显示**接入的素材**，而不是显示**生成的素材**！！！接入是指**其他节点接过来的素材**在这里显示，
**不是节点自身生成的内容**」。

定位：那一条就是 `.node-panel > .media-strip`，`q()` 是唯一数据源。上一版只对 `gen-*` 收窄，
留下两个口子：① 素材节点（`asset-*`）第一行照旧显示自己的 `media`；② `gen-*` 的 `inputMedia`
里若混进**没有 `sourceId`** 的项（历史数据 / 自身上传残留），也照样显示。

改法（一行过滤，`q()` 不再看 `role`）：

```js
q = computed(() => L.value                       // L = data.inputMedia
  .map((N, i) => ({ item: N, group: 'input', i, sep: false }))
  .filter(x => !!(x.item && x.item.sourceId)));  // 只有连线接进来的才算「接入」
```

`sourceId` 正是 `le()`（连线）/ `ye()` watch（上游媒体变化同步下游）写进 `inputMedia` 时打的标记，
所以「有 `sourceId`」= 来自其他节点，语义与用户说的一致。`group:'own'` 那套（把 `media` 塞进
第一行、拖动排序、`sep` 分隔线）全部不再产生——自身素材的删除/切换走产物框
`.media-stack-card` 上的 `.card-delete` 与 `.media-dot`，入口没丢。

**验证**（`verify-strip-input-only.js`，8198 + CDP 真鼠标，**12 项 ALL PASS**）：

| 场景 | 期望 | 结果 |
| --- | --- | --- |
| 生成节点 `inputMedia=[无 sourceId 的 Clipboard_Screenshot.png]` + 产物 | 接入条空、产物在产物框 | 条 `[]`、产物框 `["自身产物.png"]` |
| 生成节点 `inputMedia=[带 sourceId 的接入图]` | 接入条显示接入图 | `["接入图.png"]` |
| 素材节点 `media=[自有素材]` | 接入条空、素材在产物框 | 条 `[]`、产物框 `["自有素材.png"]` |
| 真鼠标连线 上游→下游 | 下游接入条出现上游素材、条目带 `sourceId` | `["上游素材.png"]` / `sourceId=n-src` |
| 下游再运行出产物 | 产物进产物框，接入条不变、`inputMedia` 不被污染 | 产物框 `["新产物.png"]`、条 `["上游素材.png"]` |

截图 `strip-input-only.png`；改前对照 `probe-strip-own.png`（主图 8190/8188 实例需刷新一次
才能拿到 `index-BXU58XDe.js?v=20261113aa`）。

## 再次运行 = 覆盖原节点，不再新建子节点（2026-11-13，同一分支）

用户要求：「当生成节点已经生成之后，再次点击运行，那么覆盖原来的内容，而不是创建新节点。」

**根因**在节点组件的运行函数 `Nn()` 第一行（上游原始逻辑，链式生成设计）：

```js
const S = H.value.length ? pe.spawnChildNode(t.id) : t.id;   // H = data.media
```

只要节点**已经有产物**（`media` 非空），就 `spawnChildNode(t.id)` 派生一个子节点接结果。
`spawnChildNode`（store 内 `ue()`）做三件事：把**源节点现有产物**复制成新节点的
`inputMedia` 并打 `sourceId`、复制 `workflow/params/randomFields/role`、**自动建一条边**。
所以第二次点运行就长出一个带接入素材、已连线的新节点——这也是之前「生成的素材出现在接入端口」
的另一半来源。

**改动**（bundle `z→aa`）：`Nn()` 里固定 `const S = t.id;`，其余分支本来就有 `S!==t.id`
判断（`markUploading` / `clearUploading` / 失败时 `removeNodes([S])`），自动全部跳过。
完成回调 `Oi(v,T,images)` → `O(v,se)` 本来就是 `W.data.media = T` 全量替换，所以是**覆盖**不是追加。

`spawnChildNode` 函数本身保留（其他派生入口不受影响），只是运行按钮不再调用它。

**验证**（`verify-rerun-overwrite.js`，8198 + CDP 真鼠标点击「运行」，`fetch` 本地 stub：
`POST /api/execute` 返回假 `prompt_id`，`GET /api/prompts/<id>` 直接返回 `done + images`）：

| 场景 | 结果 |
| --- | --- |
| 节点已有 `media=["旧产物.png"]` + `inputMedia=["接入图.png"]` | 起始 1 节点 / 0 边 |
| 第 1 次点运行 | 仍 1 节点、id 不变、0 边 → `media=["结果1.png"]`（旧产物被覆盖）、`inputMedia` 不变 |
| 第 2 次点运行 | 仍 1 节点、0 边 → `media=["结果2.png"]`（**覆盖**，不是 `结果1+结果2`） |

截图 `rerun-overwrite.png`。纯前端，刷新即可；三副本已同步，四处哈希一致。

### 硬规则：任何地方都不得把「节点已有产物」写成「接入素材」（bundle `aa→ab`）

用户要求：「不允许将当前节点已有产物当作『接入素材』，找到这些代码，并删除类似的代码。」

全量排查 bundle 里所有写 `sourceId`（接入标记）的位置，只有 4 处，其中**只有 1 处是违规的**：

| 位置 | 行为 | 处理 |
| --- | --- | --- |
| `ue()` = `spawnChildNode` | 把源节点 `data.media` 复制成新节点 `inputMedia`（打 `sourceId`）+ **自动建边** | **删除**：`const X=[]`，并去掉 `ke(v,null,he,null)` 自动连线；派生节点不再继承任何接入项 |
| `le()` = `onConnect` | 连线时把**源节点**当前产物写进目标 `inputMedia` | 保留（这是「其他节点接过来」的正当接入） |
| `oe()` = 上游媒体变化 watch | 上游产物更新时同步到已连线的下游 `inputMedia` | 保留（同上，方向永远 source→target） |
| `Se()` = 断线清理 | 按 `sourceId` 移除断开的接入项 | 保留 |

排查时同时确认：`O(v,T)`（完成写回）只碰 `data.media`；`F(v,T)` 只是按产物宽高比调节点尺寸；
`I()` 是素材条同组内排序；`xcat-paste.js` / `xcat-media-core.js` / `xcat-new-node.js` 建节点时
`inputMedia` 一律初始化为 `[]`；扩展脚本里没有任何 `spawnChildNode` 调用。

**验证**（`verify-no-own-input.js`，8198 + CDP，**8 项 ALL PASS**）：直接调用
`window.__xcatGraph.spawnChildNode('own-src')`（源节点 `media=["我的产物.png"]`、
`inputMedia=["接入图.png"]`）→ 新节点 `inputMedia=[]`、`media=[]`、边数仍 0；源节点两列表都不变；
再调 `O()` 写一个新产物 → `media` 被覆盖、`inputMedia` 仍是接入图。
另跑 `verify-strip-input-only.js`（12 项）、`verify-rerun-overwrite.js`（12 项）、
`verify-gen-result.js`（其中「素材节点第一行显示自己素材」的旧断言已按新规则改为「应为空」）全 PASS。

## 运行进度环 = 选中高亮框，两条线要重合（2026-11-13，`xcat-overrides.css` `ag→ah`）

用户：「节点运行中的进度 与高亮的框不重叠，应该要重叠才对。」

**两者本是两条不同几何的描边**：

| 元素 | 画法 | 占据的像素带 |
| --- | --- | --- |
| 选中高亮框（`.vue-flow__node.selected .demo-node`） | `box-shadow: 0 0 0 3px`，**向外**扩、无模糊 | 盒子外沿起 `[-3px, 0]` |
| 运行进度环（`.node-ring` 里的 `<rect>`） | SVG `inset:0` + `stroke-width:3`，**以盒子边缘为中心线** | `[-1.5px, +1.5px]` |

于是画面上白框在外、蓝弧在内，肉眼是两条错位的线（截图 `probe-running-node.png`）。

改法（纯 CSS，写在 `xcat-overrides.css`，不动 dist 上游文件）：

```css
#app .demo-node > .node-ring {
    inset: calc(var(--xcat-link-w) / -2);            /* -1.5px，反向外扩半个线宽 */
    width: calc(100% + var(--xcat-link-w));          /* 不能写 auto：SVG 会退回固有 300×150 */
    height: calc(100% + var(--xcat-link-w));
}
#app .demo-node > .node-ring rect {
    stroke-width: var(--xcat-link-w);
    rx: calc(12px + var(--xcat-link-w) / 2);         /* 节点 radius 12，上游写死 19 是配 radius 20 的 */
    ry: calc(12px + var(--xcat-link-w) / 2);
}
#app .vue-flow__node.selected .demo-node .node-ring-track { stroke: transparent; }
```

- 线宽全部走 `--xcat-link-w`（3px），改一处，**高亮框 / 连线 / 进度环**三者同步；
- 环的中心线因此落在高亮带正中，外缘 = 盒子 +3px、内缘 = 盒子，与 `box-shadow` 完全重合；
- 选中时白框本身就是「轨道」，再叠 20% accent 轨道会把白框染脏灰，故隐藏 `.node-ring-track`；
- 未选中时环仍在盒子外 1.5px（不跳变），只是没有白框垫底。

**验证**（`verify-ring-align.js`，8198 + CDP，真鼠标点运行，11 项 ALL PASS）：SVG `inset=-1.5px`、
尺寸 `483×273`（480/270 + 线宽）、`stroke-width=3`、`rx=13.5`；按缩放折算后左/右外扩各 `1.500`，
环外缘外扩 `3.000`、内缘 `0.000`，与白框带完全一致；取消选中后偏移仍 `1.5`。
改前 / 改后对照图 `ring-align-compare.png`。

## 画布「LoRA 栈」节点（2026-11-14）

画布上的节点一直是「一条工作流 + 素材 + 字段」的模型，没有「改模型」的位置。
新增的第九种节点 `role = "lora"` 补上这一层：它自己**不跑工作流**，只保存一份
LoRA 列表，运行时由后端把整条链插进下游生成节点的工作流里 —— 位置正是
「UNet / Checkpoint 加载器之后」。

### 数据契约

```jsonc
// node.data
{
  "role": "lora",
  "workflow": "",                 // 控制类节点不带工作流
  "loras": [                      // 顺序即应用顺序
    { "name": "Krea2/35mmKrea2.safetensors", "strength": 0.75, "enabled": true }
  ]
}
```

- `name` 直接取自 `/object_info/LoraLoaderModelOnly` 的 `lora_name` 选项，
  与 ComfyUI 自己的下拉完全同源（含 `Krea2\xxx.safetensors` 这类子目录写法）；
- `strength` 夹在 `±100`，`0` 与 `enabled:false` 都表示「跳过」；
- 目录里已删除/改名的文件在运行前被过滤（只打一行日志，不让整条工作流失败）。

### 后端：把链插到 MODEL 源头之后

`_inject_loras(workflow, loras)`（`infinite_canvas/__init__.py`）：

1. **找插入点不靠 class_type 白名单**：所有 `"model": [上游id, 0]` 都是连线，
   顺藤反查来源；那个「被 `model` 引用、自己又没有 `model` 输入」的节点就是
   MODEL 链的源头 —— `UNETLoader` / `CheckpointLoaderSimple` / GGUF / 第三方
   加载器一视同仁。多个源头时优先名字里带 `loader` / `checkpoint` 的。
2. **先记下要被改接的连线，再插节点**：插完再扫会把新链自己的 `model` 也改掉，
   直接自环。
3. 逐个插 `LoraLoaderModelOnly`，`id` 取现有纯数字 id 的最大值 + 1
   （`23:1` 这类带冒号的跳过，不会撞）。
4. 原本吃源头 MODEL 的连线全部改吃链尾。

改完即 `加载器 → LoRA1 → LoRA2 → … → 原消费方`，`CheckpointLoaderSimple` 的
CLIP / VAE 输出不受影响。函数返回插入条数，`POST /api/execute` 的响应里带
`{"prompt_id": …, "loras": n}` 便于排查。

### 前端：`assets/xcat-lora.js` + CSS

- 面板 `.xcat-lora-body` 是 `.vue-flow__node` 的**直接子元素**（与 `.demo-node`
  平级），`position:absolute; inset:0` 铺满节点；节点拖动/缩放的 `transform`
  在父级上，面板自动跟随，**不需要任何位置监听**。
- **面板本身带 `nopan` 但不带 `nodrag`**：Vue Flow 认定 `.nodrag` 的按下是「点在
  控件上」，面板铺满整个节点时若挂了 `nodrag`，节点就彻底拖不动。只有里面的
  按钮 / 输入框各自标 `nodrag nopan`，空白处（标题、行间距）照常拖着走。
- 每行：选文件（点开是一个 320px 的下拉，带搜索框，选中项置顶、只渲染前 300 条）
  + 强度步进器（`−` / 两位小数 / `+`，每次 `±0.01`，数值也可直接输入，上下键同样
  走 0.01）+ 启用开关 + 删除。改强度只更新数值不整块重画，连续点不会断；写数据
  按 index 重新取条目（`updateNodeData` 会换掉 `data` 副本，闭包里的旧对象会变孤儿）。
- **节点高度随行数增长**：`.demo-node` 的内联 `480×270` 由 CSS 变量
  `--xcat-lora-h` 覆盖（`!important`），变量值在每次重绘后由 `fitHeight()` 量出
  ——把面板临时设成 `height:auto` 读 `offsetHeight` 再还原。只保底 270，**不锁
  上限**，加多少行就长多高（实测 8 行 460、16 行 812），列表因此永远不需要滚动；
  端口、选中高亮框、连线端点都跟着新高度走。
- 写入走 `flow.updateNodeData(id, { loras })`，画布自动保存与撤销栈照常；面板
  每 400ms 比对一次数据签名，被外部改（撤销 / 加载画布 / 粘贴）就重绘，正在
  输入时不重绘。
- 运行收集：`window.__xcatLorasFor(nodeId)` 沿上游连线找 `role==="lora"` 的节点，
  串联时先递归更上游的，再拼自己（离加载器越近越先应用），带 visited 防环。
- bundle 里只改两处：`xcatRole` 的合法 role 表加 `'lora'`；`submitExecution`
  调用多传一个 `loras`（`window.__xcatLorasFor` 不存在时为空数组，老缓存下也不会崩）。
- 节点原有 UI 全部收起（纯 CSS，靠 `:has(> .xcat-lora-body)` 命中）：
  `.node-media` / `.node-empty`（上传按钮就在里面）/ `.node-actions` /
  `.node-name` / `.node-delete` / `.node-resize` / `.node-panel`。
- 左侧「新建节点」菜单新增第三组「控制节点」，项为「LoRA 栈」（lucide `layers`）。

### 验证（`verify-lora-node.js` + `verify-lora-drag.js`，8198 + CDP 真 DOM）

`verify-lora-node.js` 27 项 ALL PASS：role / 默认一行 / 面板挂载 / 原生 UI 收起 →
下拉 273 项（与目录一致）/ 搜索过滤 123 项 → 选中写回数据、行上显示 basename →
添加第二行 → 步进器默认 `1.00`、点一次减号 `0.99`、加号回 `1.00`、手输 `0.65`
规范成两位小数 → 开关停用/恢复、行变暗 → 删行 → 真鼠标从 source 口拖到生成节点
target 口连线成功 → `__xcatLorasFor` 收集 1 条、停用时不收集 → 拦截 fetch 确认
`/api/execute` 的 payload 带 `loras` → 删节点后无残留面板。

`verify-lora-drag.js` 26 项 ALL PASS：高度自适应（空节点 270 / 4 行 284 / 6 行
全部可见 / 16 行 812 不锁高 / 删回 1 行回落 270）；强度步进器（两位小数、`±0.01`
无浮点抖、手输规范、改强度后点开关不丢值、连点 20 次不断链）；拖动（抓标题区能
移动且位移与鼠标一致、拖输入框与文件名按钮不移动节点、单击空白仍能选中、端口跟
高度居中、多选不误伤 LoRA 面板）。

回归：`verify-selborder`（17 项）、`verify-del-key`（11 项）、`verify-marquee`
（20 项）、`verify-ring-align`（11 项）、`verify-node-size`（11 项）、
`verify-strip-input-only`（12 项）、`verify-rerun-overwrite`（12 项）、
`verify-gen-result`、`verify-multi-hide`（19 项）全 PASS。

后端另有离线单测 `.workbuddy/tmp/test-inject-loras.py`：拿真实的
`文生图-MiniMax-H3-Image.json` 跑注入，断言链首接回 `23:1 UNETLoader`、
第二环接第一环、`KSampler.model` 改吃链尾、无自环；并覆盖空栈、单条、强度越界、
停用/0 强度/空名/路径穿越的清洗。

### 坑

- **`removeNodes()` 是异步生效的**：同一句里 `removeNodes()` 紧跟 `addNodes()`，
  新节点会被随后的清理一起吞掉（表现为「加了但 `getNodes` 是空」）。测试里必须
  分两次 evaluate，中间隔 400ms。
- 面板挂在 `.vue-flow__node` 上而不是 `.demo-node` 里：后者由 Vue 渲染，任何
  重绘都可能把我们插的节点 patch 掉。
- **`.demo-node` 的宽高是内联样式**（`width:480px;height:270px`，媒体节点默认值），
  想改高度只能靠 CSS `!important` 或 `style.setProperty(..., 'important')`；普通
  的 `el.style.height = ...` 会被 Vue 下次 patch 覆盖。
- **`updateNodeData` 会换掉 `data` 副本**：事件闭包里抓到的 `item` 引用在第一次
  写回后就成了孤儿，后续再改它不会进入数据。所有写操作都要 `loraList(node)[index]`
  重新取。
- 节点的 target（左侧）端口对非 `gen-` 角色是 `xcat-port-hidden`（`pointer-events:none`），
  所以 LoRA 节点**只能作为上游**（右侧 source 口）连到生成节点，方向是对的。

## 工作流分类：六类（2026-11-14，同一分支）

导入的工作流按用途分**六类**，顺序就是界面顺序：

`文生图像 · 图像编辑 · 文生视频 · 参考生视频 · 图像放大 · 图像反推`

分类**只影响列表分组，不改工作流本身**（JSON 文件一个字节都不动），存在
`user/<id>/ComfyUI-Infinite-Canvas/canvas_settings.json` 的 `workflow_categories`
里（`{工作流名: 类别}`）；重命名时跟着搬、删除时清掉。

### 后端（`__init__.py`）

- 常量 `WORKFLOW_CATEGORIES` / `_DEFAULT_WORKFLOW_CATEGORY`；`_normalize_category()`
  只放行六类，其余（含空、乱写）返回空串。
- **自动识别** `_detect_workflow_category()`：只看 `class_type`（小写子串），顺序是
  ① 取标题/打标签（`caption|tagger|interrogat|florence|blip|joytag|wd14|promptgen|reverseprompt`）
  → 图像反推；② 放大（`upscale|imagescale|resizeimagemask|imageresize|seedvr|esrgan|swinir|superresolution`
  等）→ 图像放大；③ 有视频产物（`savevideo|videocombine|savewebm|animatedwebp|createvideo`）
  → 有 `LoadImage` 类输入是参考生视频，否则文生视频；④ 有图像产物 → 有图像输入是图像编辑，
  否则文生图像；⑤ 都没有 → 文生图像。
- `_list_workflows()` 每条多返回 `category`：**存过的优先，没存过的现场推断**
  （所以老工作流不用迁移就自动有分类）。
- `POST /workflows` 收 `category`（不传或非法就自动识别），响应回 `category`；
  新增 `POST /workflows/{name}/category`（非法 400、不存在 404，成功后回
  `{name, category, workflows}`）；`DELETE` / `rename` 同步维护 `workflow_categories`。

### 前端（bundle 补丁 + CSS）

- 左栏列表从「扁平 v-for」改成 `xcatWFGrouped(l.value)`：按六类顺序摊成
  「组标题行 + 组内条目」，组标题复用 `.wf-item` 的盒模型、加 `xcat-wf-group`
  类（藏图标、字 11px/600、右侧显示「N 个工作流」、`pointer-events:none`）。
  没有条目的类别不出现。
- **拖拽排序改成按名称**（原来是数组下标，加了组标题就错位）：`q/y/F/g` 四个函数
  改成传工作流名，`F()` 先 `findIndex` 出源/目标位置再 splice；**跨组拖拽会顺带改分类**
  （拖到别的类别上＝归到那一类），最后照旧 `PUT /workflows/order`。
  ⚠️ 目标对象必须在 `splice` **之前**取（`const tgt=Le[ti]`），插入位置按
  `si<ti ? ti-1 : ti` 折算——先删再取 `Le[ti]`，往下拖时会拿到目标后面那条，
  跨组拖拽就归错类（2026-11-14 修）。
- 右栏动作条多一枚 `分类 · <当前类>`（`key:3`，夹在「保存配置」与「重命名」之间）。
  点它弹原生 DOM 卡片（`.xcat-wfcat-mask`，与「重命名」同款遮罩），六类单选、当前项
  `is-active`，选中后 `POST .../category` → `B()` 重取列表 → 提示条「已归类为 X」。
- 节点底部的工作流药丸（`.panel-workflows`）也按分类分段：`xcatWFRemember()` 在
  `ul()` 拉列表时把 `name→category` 记进 `window.__xcatWfCats`，`xcatWFPills()`
  摊成「类别标签 + 该类药丸」，标签带 `xcat-wf-pill-g`（无边框、10px、muted、点了
  不选中工作流）。
- 导入提示从「已保存 X」变成「已保存 X（分类）」，一眼能看出被归到哪。

### 生成节点只接对应类别的工作流（2026-11-14 补充）

用户要求「生成节点分开对应不同的工作流」：

| 节点 | 可用类别 |
| --- | --- |
| `gen-image`（生成图片） | 文生图像 · 图像编辑 |
| `gen-video`（生成视频） | 文生视频 · 参考生视频 |
| 其余（`gen-audio` / `gen-text` / 素材节点） | 不限制（六类全列） |

三处一起改，缺一处就会「列表过滤了、默认值还挂着别类」：

1. **药丸过滤**：`xcatWFPills(names, role, current)`——渲染处传 `e.data.role` 与
   `e.data.workflow`，按 `xcatWFScope(role)` 过滤；类别取自 `window.__xcatWfCats`。
2. **默认值**：`Qs()` → `Qs(role)`。`qi` 从「名字数组」改成 `/workflows` 的原始对象
   数组（带 category），`xcatWFDefaultFor(qi, role)` 取**该类别下的第一条**（保持后端
   顺序）。原来的 `Qs()` 恒返回 `qi[0]`，等于新建生成视频节点也挂文生图工作流。
   `w(v)` → `w(v, role)`，`data:{...w(`${r}`,"gen-image")}` 显式传；派生节点用
   `Qs(W.data.role)`。
3. **新建菜单**：`xcat-new-node.js` 的 `defaultWorkflow(role)` 同样按类别挑，
   真源是 bundle 暴露的 `window.__xcatWFScopeFor`（脚本先于 bundle 执行时有内嵌回退）。

**越类怎么办**：旧画布上已经挂着越类工作流的节点，不是静默隐藏——`xcatWFPills` 会把
当前项 `unshift` 到列表最前并打 `off:true`，渲染成 `xcat-wf-pill-off`：虚线边框、
去色、`opacity:.9`，`title` 写「<名字> · 不属于此节点的类别」。这样节点看起来仍是
「有选中工作流」的状态，用户点一下同组的就换掉了；**不自动改用户数据**。

`__xcatWFScopeFor` 是唯一真源，新增/调整映射只改这里（+ `xcat-new-node.js` 的回退副本）。

验证：`verify-wf-scope.js` **22 项**——映射与 scope 函数、图片节点只出两类且默认值属
图片类、视频节点同理、越类项置顶/带 off/title 有提示/不算分组标签、其余仍只有两类、
点药丸能切换且选中态唯一、左栏「工作流配置」仍列全部六类不受影响。

### 坑

- **`P("button", {…}, "动态文本")` 必须带 patchFlag `1`（TEXT）**：放在 block 的
  `dynamicChildren` 里做优化 patch 时，`patchFlag <= 0` 且无 `dynamicChildren`
  的 vnode，**子节点根本不 diff**——组件重渲染了、列表也变了，就只有这枚按钮的字
  停在旧值。加 `,1` 后才走 `hostSetElementText`。（`xe(x)` 那类写法编译器本来就会带 1，
  手写新增的 vnode 容易漏。）
- 组标题行的 `.wf-item-meta` 要单独 `display:inline` 放出来——本包全局把它藏了
  （左栏列表项只留名字一条到底）。
- 分类弹层的遮罩挂在 `.float-window` 里（`position:absolute; inset:0`），和
  「重命名」一致，别挂 `body`。

### 验证（`verify-wf-category.js` 31 项 + `verify-wf-category2.js` 17 项）

`verify-wf-category.js`：API 每条带合法 category 且六类齐 → 左栏 6 个分组标题按序、
每组条目与后端一致、标题带条数、标题不可点/无图标 → 动作条「分类 · X」文案与顺序 →
弹层 6 项按序、仅当前项高亮、挂在浮窗内 → 改到另一类后后端生效、列表重新分组、
条目落到新组、按钮文案跟着变、提示条出现 → 非法分类 400 / 不存在 404 → 重载后保持
→ 节点药丸：分类标签与有内容的类别一致、顺序＝分组顺序、标签不参与选中、点标签不改
工作流、点药丸能选中并高亮。

`verify-wf-category2.js`：POST 不带类别 → 自动识别文生图像 / 参考生视频；带 `category`
→ 指定优先；带乱写类别 → 退回自动识别；列表按预期归组；同组拖拽改顺序（后端 order
落盘）；**跨组拖拽改分类**（后端 category 落盘、原组里消失）；删除后条目与分类记录
一起清掉。

回归：`verify-selborder`（17）、`verify-lora-node`（27）、`verify-multi-hide`（19）全 PASS。

## 常见问题

**找不到入口？**
入口在本包自己的菜单栏上（`Infinite-Canvas` 按钮，位于 RAM Cleanup 左侧，用分隔符隔开）。
上游右侧的悬浮圆形按钮及其拖拽位置记忆已移除。若菜单栏按钮没出现，重启 ComfyUI 并查看浏览器控制台的 `[Infinite-Canvas]` 日志。

**缩略图不更新？**
缓存按源文件 mtime + 大小失效，正常会自行重建；必要时直接删掉 `thumbs/` 目录。

## 许可证

[MIT](LICENSE) © 2026 YangShu2103
