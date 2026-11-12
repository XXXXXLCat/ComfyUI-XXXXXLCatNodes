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
    - **「保存配置 / 删除」上提到顶栏**、排在关闭按钮左侧 —— 与资产管理的
      「刷新 / 批量管理」同一个位置。`.wf-right` 上游就是 `position:relative`，
      绝对定位以它的 padding box 为参照，所以 `top:24` 与 32px 关闭按钮同高、
      `right:60` = 关闭 32 + 右 16 + 间距 12（实测 `actions[1238,120,126,32]`、
      关闭 `[1376,120,32,32]`）。头卡 `.wf-head` 里因此只剩工作流名与副标题。
    - 实测（1500×950，窗口 `[75,95,1350,760]`）：`left[76,96,224,758]`、
      `right[300,96,1124,758]`、`wf-head[340,188,1060,62]`、
      `preview[340,262,1060,568]`、列表项 `[88,221,200,33]`（左右各 12）；
      左栏小标题与右栏头卡同为 y=188 起。1200×760 / 1280×800 与亮面均正常，
      切到资产库 / 资产管理再切回来布局不丢。

改动集中在三个文件：

| 文件 | 改动 |
| --- | --- |
| `frontend/dist/index.html` | 多引一个 `<link>` 指向 `assets/xcat-overrides.css` |
| `frontend/dist/assets/xcat-overrides.css` | 新增文件：`--cg-*` 的 ComfyUI 语义色、侧栏尺度变量、`.library-dock` 左侧通高栏、`.canvas-menu` 沉到底部、栏底主题项的双图标 / 双文案按 `html[data-theme]` 显隐、分组细线、面板内 `--c-*` 令牌重映射、右下角工具条与两个弹层、`html.xcat-links-hidden`、`@font-face` 按官方同名注册 Inter（normal + italic，另留 `"XCat Inter"` 别名）+ `html,body` 全量 Inter 栈 + `#app textarea/select` 字体继承、资产管理右侧预览区等比完整显示（`.am-preview-body img/video` 绝对定位铺满 + `width/height:100%` + `object-fit:contain`，修上游 `max-height:100%` 在 grid auto 行里失效、竖向图片/视频只按宽度撑开被裁的问题；`.am-preview-tools` 补 `z-index:2`）、面板滚动条（`.lib-list` / `.asset-grid` / `.am-grid`，以及弹窗内的 `.cm-list` / `.am-side-inner` / `.am-prompt-body` / `.wf-left` / `.wf-list`：`scrollbar-width:auto` 复位全局 none + `::-webkit-scrollbar` 10px 轨道 / 6px 圆角滑块 / 隐藏 button / `background-clip:padding-box`，`--cg-scroll` 暗 `--muted` 亮 `--border`；配合 `overflow-x:hidden`、`scrollbar-gutter:stable`（**不含 `.float-body`**：它已不滚动，留着 gutter 会在弹窗右侧空出 10px））、画布底色 `--c-bg` 按 ComfyUI dark/light
   调色板改 `#222222` / `#dddddd`、主题项双图标显隐选择器泛化成 `#app .xcat-ico-*` / `#app .xcat-lbl-*`（按钮已从 `.lib-tab` 移到 `.cm-item`）、`xcat-canvas-hand` 只读模式（节点 / 边 / handle 的 `pointer-events:none` 与 grab/grabbing 光标）、非只读 pane 的 default / crosshair 光标、`.tb-mi:focus-visible`、`.xcat-exit-tab` 文字与 svg 按 `var(--cg-fg)` 取色（暗白亮黑，hover 不回落）、`--xcat-rail-icon: 19.2px`（官方 `1.2em`）、`.xcat-tab-label` 按官方 `side-bar-button-label` 的 10px / leading-none / text-center / w-max / max-width 52px / line-clamp-2 / whitespace-normal、`.library-tabs` padding 改 `4px 0`、`.lib-head` 改官方 `min-h-16` 64px 垂直居中 + `.library-panel > .lib-head + *` 补 `pt-2` 8px（三面板顶部留白）、`.lib-title` 16px/700、`.lib-cats` gap 8px + wrap、`.lib-cat` 按官方 Tab 改 14px / 32px / 10px / 8px / 无边框 / shrink-0、⑪ 六类内容块（`.lib-cats` / `.lib-list` / `.asset-grid` / `.lib-compose` / `.lib-foot` / `.lib-head`）水平边距统一 `px-4` 16px、header gap 与块间距统一 8px（4px 网格）、空态 16px / 更多 8px、`.asset-cell` 圆角 8px、三个弹窗的内容区按模板对话框 / 资产浏览器重排（容器 `px-6 pb-10`、按钮 `h-8 rounded-lg text-xs`、输入 `h-9`、左栏 224px + NavItem、右面板 352px、网格 `minmax(15rem)` / `minmax(min(240px,30vw))`、卡片 `rounded-lg p-2`、空态 40px mask 图标、弹窗 `max-width:1400px`、标题栏 `border-bottom:0`；亮面按钮 / 当前卡底改 `--muted` 并用 `:not()` 排除 `inverted` / `destructive`，详见下节）；画布管理贴栏侧滑面板（`.float-mask:has(+ .float-window .cm)` 隐藏遮罩、`.float-window:has(.cm)` 固定定位 57/38→底 + `min(360px,40vw)` + 64px 头 + 无圆角右边线、`.cm` 两行清单项 `.cm-card` 的 grid 重排与 `.cm-card-meta` 跨两列、`.cm-brand` 隐藏、栏内高亮 `#app:has(.float-window .cm) .lib-tab[title="画布管理"]`、亮面 `.cm-card.is-current` 用 `--cg-muted`、头部 `.cm-bar` 绝对定位浮到标题栏右侧 + `.cm-state` 与 `.float-close` 隐藏 + `.cm-btn:disabled` 弱化、`.float-body` 改 `overflow:visible`） |
| `frontend/dist/assets/index-*.js` | 二十六处，注释 `xcat:` 可搜的几处：① `.cm-pop` 的渲染条件 `o.value?` 改成 `!0?`（菜单常驻）；② 菜单里「亮色模式」按钮改为放进 `.cm-pop`（2026-11-12 起是该菜单唯一一项）；③ 菜单里「释放显存」按钮置空；④「退出画布」去掉 `is-danger` 类，之后又整体移出 `.cm-pop`（见㉑）；⑤ `TM()` 里把 Vue Flow 实例挂到 `window.__xcatFlow`；⑥ 底栏组件 `bk` 整段重写（保留 `__name: "index"` 与 `emits`，图标 SVG 用 lucide 的 path；2026-11-12 又按 ComfyUI `read_only` 语义重写了选择 / 拖拽接线：V/H/空格、菜单 aria、只读光标类，详见「选择 / 拖拽 的功能语义」）；⑦ 底栏删掉「聚焦节点」「工作流配置」两个按钮。另十三处无注释：⑧ `LibraryDock` 的 setup 取 `close` 与 `qa().toggleTheme`，在 `.library-tabs` 末尾追加分组细线 + 画布管理 / 资产管理 / 工作流 / 亮色模式四个按钮；⑨⑩ 底栏删掉画布管理、资产管理、亮色模式三个按钮（连同末尾的分隔符）；⑪ 三处 `width:"92vw",height:"86vh"` → `90vw` / `80vh`；⑫ 浮窗组件 `WS` 的根改成 `[div.float-mask, div.float-window]` Fragment 并补 `aria-modal`（弹窗遮罩）；⑬ App 的 setup 里追加顶部画布切换条（`onMounted` 里插 DOM + `watch` 同步，见下节）；⑭ 在 ⑬ 基础上重做（详见下节「顶部画布切换条」）：store 注入 `saveAsNew` / `duplicate` / `resetToUnsaved` 三方法，并把 `open` / `create` / `remove` 接到 `window.__xcatOpenTabs`（**open-tabs 模型**）。**Unsaved Canvas 用 `id=""` 作为常驻标签始终排在首位**——打开 / 新建画布只会往后面追加，不会把它挤掉；关闭掉最后一个真实画布后它自动回到首位（保证至少 1 个标签）。顶部条**每个标签（含 Unsaved）都带 × 关闭按钮**：关闭图标严格照 ComfyUI `WorkflowTab.vue` 用 `lucide--x`（16px、`right-2`/`size-4`、`top-50%` 垂直居中、`text-muted-foreground`），可见性规则＝当前且无脏标记常显、其余（含当前脏）hover 显；末尾「＋」新建按钮 2026-11-12 起改用 ComfyUI 前端包的 `lucide--plus` 细线加号（原先照 `WorkflowTabs.vue` 用 PrimeIcons `pi-plus` 实心加号，为与侧栏 / 面板图标统一已换，见㉔）。画布管理面板恢复为上游**卡片网格**（`.cm-list` 仍是 `grid; minmax(214px,1fr)`），卡片右上角内联 **复制 / 编辑名称 / 删除** 三枚 `.cm-icon` 按钮（`duplicate` 从 `canvasStore` 注入 `CanvasManager` 的 setup）；头部「新建画布」按钮与自定义右击菜单（`.xcat-cm-menu`）已删除，新建只走顶部标签栏「+」（`bootstrap` 无画布时默认进 Unsaved Canvas；`window` 上挂 `keydown` 捕获 Ctrl/Cmd+S 保存，有 `currentId` 走 `saveNow`、否则 `saveAsNew`）。所有新代码集中在旧顶部条注入块 `const canvasTabBusy=te(!1);` 到 `canvasTabsSync()});` 这一段，store 注入在 `w.value=!0}}const q=F=>` 之前，可用注释 `xcat:` 检索；⑮-⑳ 画布背景与栏底主题：`qa()` 把 `canvasGridColor` 换成 ComfyUI 调色板线色并新增 `canvasGridMajorColor`，App setup 解构后者；主画布 `<Background>` 由 20px 点阵换成两层 `variant:"lines"`（`gap:10` / `gap:100`，强调层传 `id:"xcat-major"` 避免 pattern id 撞车），工作流预览小画布同样换 10px 线格；`.library-tabs` 里的主题按钮连同 分组细线删除，按钮移进 `CanvasMenu` 的 `.cm-pop`、排在「退出画布」之前（复用 setup 里已有的 `u()` → `toggleTheme`）；㉑ **退出画布挪到侧栏顶部**：`CanvasMenu` 的 `.cm-pop` 里删掉该 `cm-item` 及 setup 里的 `c()`，在 `LibraryDock` 的 `.library-tabs` 首位插入 `.lib-tab.xcat-exit-tab`（沿用原退出 svg；`onClick` 内联 `window.self!==window.top` → postMessage / `history.back()` / `/`），CSS 按 `var(--cg-fg)` 给文字与 svg 取色（暗白亮黑）；㉒ 侧栏 9 枚图标全换 lucide，由 `.workbuddy/tmp/patch_rail_lucide.py` 解 ComfyUI 前端包 CSS 的 `--svg` 后按按钮顺序替换（保留 `xcat-ico-sun` / `xcat-ico-moon` 的 class）；㉓ `.library-tabs` 的 7 个 `On(" 文字 ",-1)` 裸文本节点换成 `f("span",{class:"xcat-tab-label"},"文字",-1)`，让字号 / 行高 / 换行 / 居中能单独按官方设置；㉔ 面板内 12 枚 `f("svg")` 整体换成 lucide（保留 width/height/class/-1，`viewBox` 统一 24、`stroke` 由 data URI 的 black 改 `currentColor`），顶部标签栏 `innerHTML` 的实心「+」换 `lucide--plus`，由 `.workbuddy/tmp/patch_panel_lucide.py` 完成；㉕ `AssetManager` 的 input/output 分段 `f("div",GS,...)` 整体从 `.am-bar` 移到 `.am-side` 首子节点（「文件类型」上方）、左栏折叠按钮 `f("button",{class:"am-side-toggle"...})` 整段删除（`a` 仍是 `te(!0)`、`.am-side` 的 `is-collapsed` 判断保留但恒 false），并把手改过的 aside children patchFlag 由 `2`(CLASS) 降为 `0`(全量 diff) 防优化跳过，；㉖ 画布管理侧栏按钮的 onClick 由 `xcatCloseDock(),Ul("canvas")` 改成 `xcatCloseDock(),Ja("canvas")?Qa("canvas"):Ul("canvas")`（再点一次关闭，与其它 tab 一致），由 `.workbuddy/tmp/patch/patch_cm_toggle.py` 完成；㉗ `.library-tabs` 的分组细线 `f("span",{class:"xcat-rail-sep"},null,-1)` 从「画布管理」前移到「资产管理」前（画布管理归入上面那组贴栏面板），由 `.workbuddy/tmp/patch/patch_rail_sep.py` 完成；㉘ 侧栏那一项的 `title` 与 `.xcat-tab-label` 文字「画布管理」→「画布」，且「提示词 / 资产库 / 日志」三个 tab 的 onClick 改成切换前先 `Ja("canvas")&&Qa("canvas")`（画布面板开着时点面板 tab 会自动关掉），由 `.workbuddy/tmp/patch/patch_rail_name_close.py` 完成由 `.workbuddy/tmp/patch_tabs_to_rail.py` 完成 |

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
`selectionKeyCode = "Shift"`、`deleteKeyCode = "Backspace"`；拖拽时这些全关，
`selectionKeyCode / deleteKeyCode = null`，并给 `<html>` 加 `xcat-canvas-hand`
（CSS 让 `.vue-flow__node / edge / handle / nodesselection-rect` 全部
`pointer-events:none`，事件落到 pane 由 d3-zoom 平移；光标 `grab` / `grabbing`）。
非只读时 pane 光标 `default`、框选时 `crosshair`、拖画布时 `grabbing`。
模式持久化在 `localStorage["xcat:canvas-toolbar"]`。

**唯一与官方不同的按键**：ComfyUI 用 `Ctrl/Cmd + 拖` 框选，但上游无限画布的
`canvasGraph` 把 `Ctrl/Alt + 左键拖` 用作「切断连线」套索（`me()` 在 pointerdown
捕获阶段 `preventDefault + stopPropagation`，会挡住 Vue Flow 的 pointerdown）。
为不破坏这个既有功能，框选沿用 Vue Flow 原生的 `Shift + 拖`，`Ctrl/Alt` 仍归剪线；
`multiSelectionKeyCode` 保持上游默认（`Control` / Mac `Meta`）。

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

把 ComfyUI 变成一块「无限画布」：每个节点绑定一条工作流，在画布上直接跑图、出视频，产出的素材还能拖到下一个节点继续用。

前端是 Vue 3 + Vue Flow，后端是一个轻量 aiohttp 扩展，只负责托管页面、读写配置、代理执行与缩略图生成。

![ComfyUI 页面右侧的 Infinite-Canvas 悬浮入口](docs/images/entry.png)

![画布总览](docs/images/canvas.jpg)

## 功能

**画布**

- 无限平移 / 缩放，支持全览与单节点聚焦

- 多画布管理：顶部条只显示已打开的画布（可逐个 × 关闭，全关后退化为 Unsaved Canvas）；画布管理面板是卡片网格，卡片右上角内联「复制 / 编辑名称 / 删除」（无右击菜单；批量删除仍用列表头的选择 + 「删除所选」）；新建、切换、改动自动保存；Ctrl/Cmd+S 可保存（无当前画布时自动新建并保存）

- 节点素材可以拖出画布空白处新建节点，拖到别的节点上则作为素材追加

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
| 指针 / 手 + 箭头 | 画布模式：`V` 选择（可编辑，左键拖空白平移、Shift+拖框选、Ctrl/Alt+拖剪线）或 `H` 拖拽（只读，左键任意位置平移、节点不可选/拖/连）；空格按住临时进入拖拽。菜单里显示 V / H |
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
| GET/PUT         | `/infinite_canvas/api/workflows/{name}/fields` | 字段配置读写         |
| GET/POST        | `/infinite_canvas/api/canvases`                | 画布列表 / 新建      |
| GET/PUT         | `/infinite_canvas/api/canvases/{id}`           | 读取 / 保存画布      |
| GET             | `/infinite_canvas/api/library/assets`          | 资产列表（分页 + 分类）  |
| GET             | `/infinite_canvas/api/library/thumb`           | 素材缩略图（WebP 缓存） |
| GET/POST/DELETE | `/infinite_canvas/api/library/prompts`         | 提示词库           |
| POST            | `/infinite_canvas/api/execute`                 | 提交工作流执行        |
| GET             | `/infinite_canvas/api/prompts/{id}`            | 查询执行结果         |
| POST            | `/infinite_canvas/api/free`                    | 卸载模型并释放显存 / 内存（转发 ComfyUI 的 `/free`） |

## 常见问题

**找不到入口？**
入口在本包自己的菜单栏上（`Infinite-Canvas` 按钮，位于 RAM Cleanup 左侧，用分隔符隔开）。
上游右侧的悬浮圆形按钮及其拖拽位置记忆已移除。若菜单栏按钮没出现，重启 ComfyUI 并查看浏览器控制台的 `[Infinite-Canvas]` 日志。

**缩略图不更新？**
缓存按源文件 mtime + 大小失效，正常会自行重建；必要时直接删掉 `thumbs/` 目录。

## 许可证

[MIT](LICENSE) © 2026 YangShu2103
