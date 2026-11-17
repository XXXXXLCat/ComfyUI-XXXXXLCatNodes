# 改造记录（2026-11）

按时间倒序的逐项改造说明与实测数据。使用说明见上级 [README](../../README.md)。

## 组选中、高亮与 Delete（2026-11-17）

- 组现在是可选项：点标题栏或组矩形内的空白处（节点仍优先命中）即选中组，默认不连带选里面的节点（`LiteGraph.Group.SelectChildrenOnClick` 默认 false）。节点/组互斥：选节点或点空白画布会取消组选中。
- 选中样式照宿主 `LGraphGroup.draw()` 的 `strokeShape`：1px 白色半透明外框、向外扩 6 世界像素，标题文字转白；缩放时外扩距离随 zoom 变。
- `Delete` / `Backspace` 在组选中时只删组矩形、保留其中节点，与右键「删除组」同一通路；删除后选中态清空。
- 真机验证：真实鼠标点矩形内空白 → 选中态 1、节点选中 0、`outline: rgba(255,255,255,.8) solid 1px / offset 6px`；选节点 → 组取消；点标题 → 组选中；Delete → 组数 0、节点仍 3、选中态清空；点画布空白 → 组取消；无页面异常。

## 分组标题改名、删除组与 Ctrl+G（2026-11-17）

- 标题是用户数据：创建组时按当前界面语言生成一次默认标题（中文「分组」/ 英文 `Group`），显示直接渲染 `group.title`，不再走 `$t()`；改名后切语言保持用户写的文字。
- 双击组标题栏就地编辑（TitleEditor.vue 同款语义）：Enter / 失焦提交 trim 后的非空值，Esc 取消；右键标题栏菜单为「重命名 / 删除组」（对应宿主 `LGraphGroup.getMenuOptions()` 的 Title / Remove）。删除组只移除矩形，节点原位不动；改名与删组都触发 `markDirty` + `history.schedule`，随草稿 / 文件 / 撤销栈持久化。
- 多选 2 个及以上节点按 `Ctrl/Cmd+G` 直接成组，复用工具条的 `createGroup`；单选无效。快捷键接在 `core.js` 的 `onKeyDown`，继续沿用输入框 / 弹窗 / Hand 模式的现有保护。
- 真机验证：单选 Ctrl+G 分组数 0；多选分组数 1、title=分组、nodes=2、snapshot=1；双击出现输入框，改名 `我的分组A` 后 DOM / 快照同步；Esc 保持原名；菜单中英为 重命名/删除组、Rename/Delete Group；删组后节点仍 3 个；英文新建组标题 `Group`，右键菜单rename 也能打开编辑器；无页面异常。
- 坑：`#infcanvas-stage` 的全局 dblclick 捕获监听（打开添加节点菜单）早于组标题的 `@dblclick`，会 `stopPropagation()` 吞掉双击；已对 `.ic-group, .ic-selection-tools` 早退。Root setup 的 return 里新增 ref 时必须同步定义局部 `const`（本次漏 `groupEditing` 导致整画布挂载失败，`ReferenceError: groupEditing is not defined`）。

## 多选工具条：打组 / 排列 / 批量下载 / 批量删除（2026-11-17）

- 虚线框上方 10px 新增浮动工具条，四项照宿主 `SelectionToolbox.vue` 的幅面（32px 高、居中、floating-panel 风格）；中英文分别为 打组/Group、排列/Arrange、批量下载/Download、批量删除/Delete。
- **打组**照 `core-DH0IDsaY.js.map` 的 `Add Group For Selected Nodes` + `LGraphGroup.resizeTo`：选中节点外接矩形左右各留 10px，顶部再抬 30px 作标题栏；默认色 `#3f789e`、填充 alpha .25、整色边框与标题、右下角实心三角。分组是视觉层（在节点下方，不连线不改布局），`{id,title,x,y,w,h,nodes}` 随画布保存到 draft / 文件 / 撤销栈。
- **排列**照 `useArrangeNodes.ts`：垂直 / 水平 / 网格三种，默认间距 12px，锚点为 `x+y` 最小节点，网格列数 `ceil(sqrt(n))`，每次 `setNodePosition` 写回 Vue Flow 与源数组。
- **批量下载**逐个取 `data.result || data.asset` 的 URL 走 `registry.download`，文本节点用 Blob + `.txt`；**批量删除**清空选择、删节点与相关边、移除只剩空组的分组。
- 真机验证：工具条距虚线框正好 10px 且居中；中英标签/提示正确；生成分组几何 `x=110,y=80,w=920,h=630`、填充/边框与宿主一致且在节点下方；水平排列后三个节点 x=120/452/784；下载触发 3 次；删除后节点与分组归零、工具条消失；分组进入 snapshot 与 doc。语法 / ESM / i18n 缺键全过，`check_add_menu.js`、`check_slots_all.js` 通过。

## 多选节点时隐藏节点控件 + 虚线选择框（2026-11-17）

- 选中 2 个及以上节点时，给 VueFlow 根节点加 `is-multi-select`，隐藏每个节点上方的 `.icn__tools` 操作行和下方的 `.icn__genpanel` 参数面板；回到单选立即恢复。多选只用于移动/删除，不让这些控件盖住相邻卡片。
- 真机验证：单选两控件 `display:flex / visibility:visible`；多选 `display:none`；再单选恢复。语法与 i18n 检查全过。
- 追加虚线选择框：照宿主 `core-DH0IDsaY.js.map → src/extensions/core/selectionBorder.ts` + `treeUtil` 的 `createBounds(items, 10)` 实现。屏幕空间测量所有选中 `.vue-flow__node` 的外接矩形，四周留 `10 × zoom` px；SVG `rect` 用 `var(--border, #ffffff66)`、`stroke-width:2`、`stroke-dasharray:5 5`、`rx=8`——对应宿主的 `2/scale`、`5/scale`、`8/scale` 常量像素。rAF 只在多选期间跑，跟手更新拖拽/缩放。
- 真机像素比对：虚线颜色 `rgb(73,74,80)` 与用户给的 ComfyUI 参考图完全一致；单选无框，2 选时 rect 与按节点外接矩形 + 留白计算的值一致，缩放后留白随 zoom 变。

## 添加节点菜单去掉描述文案（2026-11-17）

- 侧栏「添加节点」抽屉此前已删掉行内描述和底部说明；这次把双击画布弹出的「添加节点」菜单里最后残留的 `button.title = t(spec.desc)` 也去掉，文本 / 图像 / 视频 / 音频四项都不再显示「图片素材，或调用 ComfyUI 生成图片」一类的悬浮说明。
- 真机检查菜单四项 `title` 均为空，顺序与图标不变；静态 i18n 缺键 0。

## 侧栏 API 按钮文字裁切修复（2026-11-17）

- 用户发现英文 `API Config` 的最后那个 g 下半截被吃掉。根因是宿主 `SidebarIcon.vue` 的标签类串含 `line-clamp-2 leading-none`：10px 字号配 10px 行高，配合 `overflow: hidden` 把 1px 的降部裁掉（实测 `clientHeight=10 / scrollHeight=11`）。
- 只在 `#infcanvas-sidebar` 内覆盖 `line-height: 1.2; overflow: visible;`，宿主类串照旧保留。真机中英两态标签高度与滚动高度都变成 12px，截图确认 g 降部完整。

## 侧栏 API 按钮改名（2026-11-17）

- 侧栏按钮 `API` 改为走普通 i18n：中文显示 **API 配置**，英文显示 **API Config**（tooltip 同文案）；不再用无空格的旧 key「API配置」，字典中该条已删除，复用已有「API 配置」条。
- 真机（8188）中英两态均验证：中文 rail `… / API 配置 / English`，英文 rail `… / API Config / 中文`；静态字典缺键 0，回归 `check_i18n.js` 19 PASS / 0 FAIL。

## API 配置英文界面的类型下拉（2026-11-17）

- 用户反馈参数类型下拉仍是中文。根因和 `tools.js` 老坑一样：`api-config.js` 比 `i18n.js` 先加载，顶层 `TYPE_OPTIONS` / `MEDIA_LABELS` 里的 `t()` 在模块求值时就 fallback 成中文，之后切语言/重建弹窗都不会再解析。
- 两处常量改为只存中文源 key，在渲染点调 `t()`：`option.textContent = t(label)`；媒体说明句改成整句 key + `{label}` 插值（字典补 EN）。
- 真机（8188）英文界面验证：类型选项为 Text / Multiline Text / Number / Slider / Dropdown / Toggle / Image (single) / Image List / Audio / Video / Random；工作流分类下拉也已是 T2I / Image Edit / … / Uncategorized；插件 UI 无 i18n 缺键告警。预览图里的「保存图像 / CLIP文本编码」等是工作流 JSON 里的节点标题（数据），不翻译。

## 语言按钮移到侧栏真正底部（2026-11-17）

- 用户指出按钮原先紧跟在 API 下方，不算「侧栏底部」。改为照宿主 `SideToolbar.vue` 的 `bottomToolbarRef` 写法：主按钮组之后再加一个 `sidebar-item-group mt-auto …` 容器放语言按钮，由 flex 空白推到最底。
- 真机测量：侧栏 38–905px，API 底部 323px，语言按钮 844–900px，与 API 间隔 521px、距侧栏底 5px（border/padding），视觉上贴底。

## 语言按钮改为显示目标语言（2026-11-17）

- 用户在「目标语言 / 固定双语 / 动作式 / 纯图标」中选了**目标语言**：中文界面显示 `English`，英文界面显示 `中文`，点完会切到哪种语言一目了然。
- `ui.js` 新增 `displayOf(value)`：label/tip 支持函数，按 `NS.i18n.current()` 在首次渲染和每次语言切换时解析；tooltip 同步为「切换到英文 / Switch to Chinese」。顺带修好语言按钮原先**运行时切语言不重绘**的问题（它本来就通过 `makeSideButton` 注册进了 `sideRefs`）。
- 字典删掉 3 个废弃键（中英切换 / 当前语言：中文 / 当前语言：English）；`check_i18n.js` 按 `data-lang-toggle` 排除语言按钮再做裸中文扫描，新增两条目标语言断言，并修正此前漏改的节点 tab 缩写期望。
- 真机（8189 临时实例）17 PASS / 0 FAIL；实例已关闭、端口已释放。

## 添加节点侧栏面板精简（2026-11-17）

- 「新建节点」全量改名「添加节点」：侧栏按钮 label/tip、抽屉标题、双击菜单 `aria-label`、进入画布 toast；i18n EN 同步为 Add Node。
- 侧栏节点面板不再按 `role` 分成「媒体节点 / 文本节点」两栏：只留 文本 / 图像 / 视频 / 音频 四行，固定顺序平铺（与双击空画布的菜单一致），去掉每行描述文字和底部「点击添加到画布…」长说明。
- 字典删掉 4 个已无引用的废弃键；README、`check_i18n.js` 的文案期望同步更新。
- 侧栏四行的图标改用与双击菜单同一套 lucide SVG（text-pen / image / video / audio-lines），16px、白色（继承行文字色），不再用 `pi pi-*`；`style.js` 加 `.ic-item > svg` 规则。
- 真机（8188 headless CDP）验证：中文侧栏/标题均为「添加节点」，4 行顺序正确，`ic-section` / `ic-item-desc` / `ic-hint` 计数均为 0；切英文后为 Add Node / Text·Image·Video·Audio。侧栏与弹出菜单四个图标的 path/rect/circle 数、16px 尺寸、白色完全一致。语法、缺键、字典检查全过。

## i18n 中文残留第二轮补漏（2026-11-17）

- 用户截图发现 API 配置预览缩放控件的「适应」按钮是中文：`api-config.js` fitBtn 文本没包 `t()`，已修（字典已有"适应"="Fit"）。
- 用精准静态扫描（UI 显示位：el 文本参数/textContent/属性/文本节点）+ 真机全 DOM 扫描（切 en 后遍历 #infcanvas-root + dialog 的 textContent/title/placeholder/aria-label）一次性找全其余残留。
- 修复项：
  - `flow.js` 空态「当前 API 未暴露参数…」文本节点（3 处）改 `{{ $t() }}`；API 参数 tooltip 改 `$t('API 参数（{n} 项）')`。
  - `flow.js` 节点头 `title="$t('双击标题可重命名')"` 是 Vue 模板里的字面量（会显示 `$t(...)` 原文），改 `:title="$t(...)"` 绑定语法 —— 真机扫描抓到 `$t('…')` 字面文本才暴露。
  - `flow.js` modeReason tooltip 里媒体类型名（`KIND_CN.label`="图片"）和量词没翻译，改 `t(cn.label)`/`t(cn.measure)`（量词英文词条是空串），tooltip 从 `"Image Editing" needs 1 图片` 变成全英文。
  - `tools.js` / `media-tools.js` 工具弹层一批裸中文：裁剪/宫格/镜像面板标签（比例/宽/高/预设/自定义/行数/列数/变换/镜像效果预览/撤销/试听）、进度文案、ADJUST_FIELDS 的 11 个滑块 label、错误消息、setStatus 提示、进度 sub 文案，全部 t() 化；错误消息拆句改成 `{param}` 整句插值（不拆成多段 t）。
  - `tools.js` 的 `WARN_HTML`（含 `<strong>` 的媒体未就绪横幅）改成 `warnHtml()` 函数、调用时按当前语言生成，`media-tools.js` 4 处 `warn:` 改用它——常量在模块加载时 t() 会 fallback 中文。
  - `api-config.js` 弹窗 `aria-label="API 配置"` 改 `t()`。
- 字典 EN 补 19 个新词条（→504 条，唯一 498）。静态全过：缺键 0、无重复冲突、占位符合法、9 个 JS 语法 OK、ESM import 正常。
- 真机（8189）全 DOM 扫描：插件 UI 零裸中文残留、无 JS 异常、无缺键告警。剩余中文均为**宿主 ComfyUI 模板库面板**（模板名/分类）或语言按钮的「中文 / English」设计文案，不属插件覆盖范围。新增回归 `tools/checks/oneoff/check_i18n_bare.js`。一次性扫描/替换脚本已清理。

## 英文分类名缩写（2026-11-17）

- 用户嫌英文全称太长（如 Text to Image），要求简写成 T2I 这类缩写。最终按「有通用缩写才缩，没有的保留全称」收敛。
- `infcanvas-i18n.js` 新增 `CAT_SHORT`（12 项）：文生图 T2I、参考生视频 R2V、文生视频 T2V、图生视频 I2V、首尾帧视频 FLF2V、文生音乐 T2M、语音合成 TTS、语音克隆 VC、智能对话 LLM、语音转录 STT、背景移除 RMBG、图像编辑 Image Edit。保留全称 2 项（无标准简写）：图像放大 Image Upscale、音乐翻唱 Music Cover。
- 用户后续微调：背景移除由 Remove Background→RMBG、图像编辑由 Image Editing→Image Edit；`check_i18n_dict.js` 的缩写值正则相应放宽以容纳含空格的 `Image Edit`。
- `cat(name)` 改为：中文模式仍返回中文原文；英文模式先归一化历史别名，再优先取缩写值，无缩写则回退字典全称。历史别名（图片生成→T2I、首帧→I2V…）自动继承。
- **缩写只作用于分类标签**（节点 tab / API 分组标题 / 分类下拉 / 顶部标签 / tooltip）；**提示文案与错误句保留全称**——`t("智能对话")`="LLM Chat" 不变，节点 tab 的 tooltip「切换到 Text to Image」也是全称。
- `infcanvas-flow.js`：注入 `$cat` 到 globalProperties，节点模式 tab 的按钮文本 `{{ $t(m) }}`→`{{ $cat(m) }}`（3 处：image/video/text+audio）；title 里的 `$t(m)` 不动。
- 验证：`check_i18n_dict.js` 增补 CAT_SHORT 校验（key 必须是合法分类 key、值须大写 token）；`check_i18n_categories.js` 期望值改缩写并加节点 tab 检查。8189 真机 **8 PASS / 0 FAIL**（tab 显示 T2I/Image Editing…、tooltip 全称、24 个别名归一化、下拉 15 项、抽帧标签未受影响、无异常/缺键）。
- 中文模式零变化、内部标识（中文 key/data.mode/后端 category）零变化。临时实例已关。

## API 配置分类名英文化（兼容旧后端，2026-11-17）

- 用户实测（旧 8188 后端未重启）发现 API 配置弹窗左侧分组标题、分类下拉仍是中文，且显示的是**改名前的历史分类名**（图片生成/全能参考/首帧…）。根因：这些显示点没走 `t()`；且字典只有最终名，旧名即使 `t()` 也会回退。
- 在 `infcanvas-i18n.js` 加 `cat(name)`：先把历史别名归一化到最终分类名（映射同 `core.js LEGACY_MODE_NAMES` / `server_routes.py CATEGORY_RENAMES`），再翻译；空值→Uncategorized。**不靠字典补旧名**——因为「首帧」同时是媒体工具的抽帧标签（`t("首帧")`="First Frame"），补字典会串味；`cat("首帧")`="Image to Video" 只作用于分类显示。
- api-config.js 所有分类显示点改 `cat()`：左侧分组标题、分类下拉 label、顶部标签、列表 tooltip、3 处提示插值。内部值（`S.category`、下拉 value、写后端的 category）保持中文不变。
- 验证 `check_i18n_categories.js` 真机 6 PASS/0 FAIL：22 个分类名（含全部历史别名）归一化正确、`t("首帧")` 未受影响、弹窗分组+下拉 15 项全英文、无异常无缺键。

## i18n 中文残留补漏（2026-11-17）

首轮 i18n 改造后实测发现两处界面仍显示中文，补齐：

- **节点库面板 / 添加节点菜单**：`SPECS` 的 `title`/`desc`（图像/视频/音频/文本及其描述）是可变数据，静态扫描抓不到——改为显示时 `t(spec.title)` / `t(spec.desc)`（`showNodePickMenu` 与 `renderNodeLibrary` 两处），菜单标题 `options.title || "添加节点"` 也补 `t()`。字典补 6 个动态 key。
- **flow.js 种子控制弹层**：`自动更新该值 / 之后 / 正在运行工作流` 及 8 处静态 `title=`/`aria-label=` 改 `$t()`。
- **媒体工具**：时间轴裁剪 / 变速弹层的 innerHTML 中文改 `${t()}`；其中 `title="$t('播放 / 暂停试听')"` 原是 bug（`$t` 在非 Vue 模板字符串中会原样显示），改 `${t()}`。
- 共补 22 个字典 key（总数 459→484 条，唯一 478）。验证：`check_i18n_leftover.js` 真机 9 PASS / 0 FAIL（节点库标题/描述/分组、菜单标题/4 项/tooltip 全英文，无 JS 异常、无缺键告警）。

## 中英切换 + 全界面 i18n（2026-11-17）

- 侧栏 `#infcanvas-sidebar` 底部新增语言切换按钮（照搬 `side-bar-button` 原样类串 + `pi pi-language`），点击在 zh/en 间切换，语言持久化到 `localStorage['InfCanvas.Lang']`。
- 新增 `js/infcanvas-i18n.js`：从同一 `vendor/vueflow.bundle.mjs` import Vue，用共享 `ref` 做响应式语言状态——Vue 模板通过 `app.config.globalProperties.$t` 注入，切语言自动重渲染；原生 DOM 层通过 `NS.i18n.onChange()` 订阅重绘。
- **中文是源语言**：`t(key)` 在 zh 模式直接返回 key（无裸键风险、回退始终可读），en 模式查 EN 字典（459 条），缺键回退中文并 console 告警。带插值的用 `{param}` 占位符。
- **内部标识保持中文**：14 个分类名、`data.imageMode/videoMode/audioMode/textMode`、规则表 key、后端 `category`、`@图片N` mention token 一律不翻译；只在显示层 `t('文生图')` / 模板 `$t(m)`。
- 覆盖 8 个 JS 文件的界面文案：侧栏/画布 tab/面板、画布工具栏、生成节点模板与提示词/toast、API 配置弹窗（字段类型/语义标签/按钮/确认框/重启横幅）、媒体工具与图像工具（裁剪/宫格/镜像/调整/LUT、音轨提取/分离/截取/抽帧/变速）、core 的保存/打开/生成确认与 toast。
- 加载顺序坑：i18n.js 按字母序在 api-config/controls/core/flow 之后加载，顶层订阅会被跳过 → 各模块的 `onChange` 订阅移到 `open()` / `mount()` 等运行时函数里。
- 弹窗开着时切语言：api-config 订阅 onChange → 记住当前工作流名 → close+open 重建 → 恢复选中。节点参数面板/toast 都是打开/触发时按当前语言渲染。
- 原生 DOM 重绘：ui.js `repaintLocale()`（侧栏 + 面板）；controls.js `repaintLocale()`（卸载重建工具栏，偏好从 localStorage 恢复）；api-config 重建。
- 校验：`tools/check_i18n_dict.js`（459 词条、无冲突、占位符合法）、`tools/find_missing_i18n.js`（0 缺失）；ESM import 全部 `ReferenceError: window is not defined`（模板串未截断）。真机 `check_i18n.js`（8189 临时实例）14 PASS / 0 FAIL——侧栏/节点 tab 英汉互切、内部 key 不变、localStorage 持久化、无异常、无缺键告警；`diag_i18n_live.js` 验证弹窗开着时切换会重建英文化。回归 `check_api_config` 7 项通过、输入规则/插槽脚本内部 mode 仍中文。
- 宿主菜单文案（infcanvas.js 的 command label / settings name）注册时确定、无法随切换动态更新（ComfyUI 不重渲染命令标签），保持中文；画布内部界面全部可切换。
- **前端改动刷新浏览器即可**（Ctrl+F5）；8188 主实例的后端分类改名仍需完全重启才生效。

## 分类命名二次微调（2026-11-17）

第一次改名后仍有「中英混排 + 命名维度不统一 + 有歧义」三点别扭，再微调 4 项：`参考视频→参考生视频`、`首尾帧→首尾帧视频`、`TTS→语音合成`、`LLM对话→智能对话`。`语音转录` 保留（与「语音合成 / 语音克隆」构成「语音 + 两字专业词」的一致组，且本身无歧义）。

- 后端 `server_routes.py`：`WORKFLOW_CATEGORIES` 与 `CATEGORY_RENAMES` 更新为**最终名**；别名映射把最早旧名和第一次的中间名**一起直接映射到最终名**，单跳查表，不依赖链式改名。`_normalize_category()` 逻辑不变。
- 前端 `js/infcanvas-flow.js`：`VIDEO_INPUT_RULES` / `MODE_ASSET_SLOTS` / `AUDIO_INPUT_RULES` / `AUDIO_MODE_ASSET_SLOTS` / `TEXT_INPUT_RULES` / `TEXT_MODE_ASSET_SLOTS` / `TEXT_MODES` / `videoModes` 各表 key 与切模式、文案里的名字全量替换。`js/infcanvas-core.js`：`LEGACY_MODE_NAMES` 同时收录最早旧名与中间名，老画布停在任一版都能载入后映射成最终名。
- 检查脚本：`oneoff/check_category_rename.js` 的 `NEW14` / `OLD` 更新，`OLD` 补入 4 个中间名；tab 检查由子串 `includes` 改整串 `includes`（否则新名「首尾帧视频」会因含「首尾帧」被误判旧名）。`make_seg_demo.js`、`docs/输入接入规则.md` 同步。
- **8188 主实例仍需完全重启**后端才能让新分类名生效；前端改完 Ctrl+F5。

## 分类全局改名 + 左侧按名称排序（2026-11-17）

14 个分类全部改名并固定排序：`图片生成→文生图`、`图片编辑→图像编辑`、`图片放大→图像放大`、`移除背景→背景移除`、`全能参考→参考视频`、文生视频不变、`首帧→图生视频`、首尾帧不变、`音乐设计→文生音乐`、音乐翻唱不变、`语音设计→TTS`、语音克隆不变、`LLM→LLM对话`、语音转录不变。新顺序即用户给的顺序。

- 后端 `server_routes.py`：`WORKFLOW_CATEGORIES` 换成新 14 项与顺序；新增 `CATEGORY_RENAMES` + `_normalize_category()`，`_load_category` 与 list 的 `category_defaults` key 读取时映射旧名，老数据免迁移可用；`/workflows` 增返 `categories`。11 个 `api/*.fields.json` 的 `category` 值已批量迁移。
- 前端 `js/infcanvas-flow.js`：模式表 / 输入规则 / 插槽表 / 文案里的旧名全量替换；`TEXT_INPUT_RULES.LLM` 属性改方括号访问（新名非合法标识符）；`audioFamily` 的 `indexOf("音乐")===0` 三处改 `isMusicMode()` 显式集合（"文生音乐"不再以"音乐"开头）。`js/infcanvas-core.js`：`normalizeNodeData` 增 mode 迁移，老画布节点的 imageMode/videoMode/audioMode/textMode 旧值载入时映射。
- API 配置左侧（`infcanvas-api-config.js`）：分组标题按后端 `categories` 新顺序，组内工作流按名称 `localeCompare('zh-Hans-CN')` 排序；`index` 仍是 `S.workflows` 原索引，拖拽排序不受影响。
- 验证：`oneoff/check_category_rename.js`（8189 临时实例，后端改动需重启）7 PASS / 0 FAIL——分类表顺序、工作流分类迁移、左侧分组顺序、组内名称排序、节点 tab 新名、无 JS 异常。
- **8188 主实例仍是旧后端，必须完全重启**才能让新分类生效；重启前前端/fields.json 新、后端旧会出现分类不匹配的假象，回归脚本在旧后端上不可靠。

## API 配置里提示词的默认值，预填到新节点提示词框（2026-11-17）

用户诉求：API 配置里给提示词字段填了默认值，新建节点的提示词框里没出现。查下来不是被屏蔽——提示词框只读 `data.prompt`，而默认值挂在字段 `default` 上，提示词字段又被从设置弹窗参数行里排除（`apiBarFields` mark 掉），所以默认值在节点上没有任何显示通路。

实现（`js/infcanvas-flow.js`）：`seedPromptDefault()` 在 `loadApiFields` 成功拉到字段后，把提示词字段（音频取 `audioFieldSlots.a`，其它取 `promptField`）的 `default` 写进 `data.prompt`（`silent`，不进 undo），框随 `watch(data.prompt)` 渲染。规则沿用"是否已产出内容"：已产出节点走冻结路径直接 return，不填；未产出/新建节点每次 `workflows-changed` 重读最新 default。`setField("prompt")` 顺带置 `data.promptEdited`，用户手输过的值永不被默认值覆盖；老版本从齿轮行迁移的手输文字也标记 `promptEdited`。`{{prompt}}` 占位符模板没有暴露字段，不填充，保持模板原样。

验证：`oneoff/check_prompt_default.js` 自建自删探针 `zpd-a`，8 PASS / 0 FAIL（预填、promptMap、未标记手输、改默认值跟随、手输不被覆盖、新节点取最新、已产出冻结、零异常）。回归 `check_field_freeze` 14、`check_prompt_visibility` 16、`check_api_config` 7 全过。`check_node_default` 8/10，2 项失败是脚本把"列表第一个"当默认、但列表已按更新时间排序（新增 Birefnet）的假设过时，与本次改动无关（本次只写 `data.prompt`，不碰 `data.workflow`）。

只改前端 JS，Ctrl+F5 生效；后端不用重启。

## 模式无工作流：框内提示 + 设置禁用（2026-11-17）

节点切到某个模式后，如果该分类下没有任何工作流：

- 底栏左侧的 API 选择器不再是下拉按钮，而是**直接在框里显示「该分类下暂无工作流」**（灰色、无箭头、不可点）；
- 右侧设置齿轮**禁用**（`disabled` + `is-disabled`），点不开参数弹层；
- 如果设置弹层原本开着，切到空分类时会**自动收起**。

判据是 `noWorkflow = 当前模式有分类 && wfOptions 为空`。已产出节点那条「模板被删也不消失」的冻结项仍算有效选项，所以不会误判成空分类。

### 验收

- 新脚本 `oneoff/check_empty_category.js` **10 项全绿**：框内文案、无箭头、齿轮禁用、点击不弹下拉、点击不弹设置；切回有工作流的分类后恢复显示 `SeedVR2-Upscale` 且设置可用；开着设置切到空分类自动关闭；零 JS 异常。
- 回归：`check_node_default` 10、`check_field_freeze` 14、`check_input_rules`、`check_api_config` 全过。
- 只改前端 JS，Ctrl+F5 生效。

## 工作流没有提示词入口时，节点不画提示词区（2026-11-17）

**判定**：选中的 API 工作流既没有暴露提示词字段，也没有 `{{prompt}}` / `{{text}}` 字面占位符 → 生成节点里那块提示词输入区**隐藏**（不是禁用）。面板高度自然收回，不再留灰框。

- 后端 `server_routes.py`：`GET /api/infcanvas/workflows/<name>/fields` 增返 `prompt_placeholder`，由 `_has_prompt_placeholder()` 扫模板 JSON 得出。改了 Python，**必须完全重启 ComfyUI**。
- 前端 `js/infcanvas-flow.js`：节点新增 `hasPromptArea` computed；视频 / 图像 / 音频·文本三处提示词 DOM 加 `v-if`。提示词入口和参数一样写进 `data.fieldSnapshot.promptSlot`，已产出节点冻结、未产出节点跟随最新。
- 文本线门：模块级 `workflowAcceptsText()` 读同一份快照；`imageWireReason` / `audioWireReason` / `textWireReason` 在文本素材入口统一拒绝「当前工作流没有提示词输入，无法接入文本素材」，拖线与落下两处都生效，避免线接上却静默丢弃。

### 验收

- 新脚本 `oneoff/check_prompt_visibility.js` 在 8189 临时实例 **16 项全绿**：后端三种标记、三种工作流的显隐、快照 `promptSlot`、文本线门（含**真鼠标拖拽**：无入口不接线、有入口接线成功）、已产出节点冻结、同模板新节点隐藏、零 JS 异常。探针 `zpr-none` / `zpr-field` / `zpr-slot` 自建自删。
- 回归：`check_field_freeze` 14、`check_api_config` 7、`check_save_state` 9、`check_node_default` 10、`check_field_advanced` 13、`check_input_rules`、`check_result_inline` 6 全过。
- 只改前端 JS 时 Ctrl+F5 即可；后端这条 `prompt_placeholder` 要重启才生效——旧后端下没有占位符的模板会退回「按暴露字段判断」，不会报错。

## 参数配置只改模板，节点按「是否已产出内容」决定跟不跟（2026-11-17）

API 配置里的所有参数调整（暴露/取消、类型、范围、默认值、「高级」勾选）**只改工作流模板本身**，不再回头去改已经建好的节点。

节点分两类，判据只有一个——**这个节点有没有产出过内容**（`data.result` 在不在），跟创建先后无关：

| 节点 | 参数配置被改写 | 模板改名 | 模板删除 |
|---|---|---|---|
| 已产出过内容 | **冻结**：参数行、默认值、高级归属一律保持它出图那一刻的样子 | 跟着改名 | **下拉里也不消失**，仍是它的当前选中项 |
| 未产出（新建 / 建了没跑） | **跟随最新**：保存完立刻按新配置重排 | 跟着改名 | 下拉里消失，落到分类默认 |

### 实现

| 位置 | 改动 |
|---|---|
| `js/infcanvas-flow.js` | 新增 `data.fieldSnapshot = {workflow, name, list}`：每次成功拉到 `/fields` 都写快照；有 `data.result` 的节点直接**从快照渲染并跳过请求**，模板再改也进不来 |
| `js/infcanvas-flow.js` | `frozenWf` + `wfOptions`：已产出节点引用的模板若已从全局列表消失，把它按快照里的名字补回下拉首位（`missing:true`），`wfLabel` 也回落到这个名字 |
| `js/infcanvas-flow.js` | `adoptDefaultWorkflow`：`cur` 已不在列表里但节点有 `data.result` → 不换默认 |
| `js/infcanvas-flow.js` | `renameWorkflowRefs`：改名时连带把 `fieldSnapshot.workflow`（和同名的 `name`）一起改，已产出节点不会因为改名被当成「换了模板」而重拉 |
| `js/infcanvas-flow.js` | `syncFieldSpecs()` 抽出来，新拉和冻结两条通路都喂它——随机数范围（core 算下一颗种子要用）不会因为冻结而丢失 |

几个必须守住的点：

- **冻结的是「节点」，不是全局缓存**：同一时刻新建的另一个节点拿到的仍然是模板最新配置，两条路径互不影响。
- **改名 ≠ 换模板**：改名只是文件挪位置，快照跟着改 id，内容不重拉（否则已产出节点的参数集会被当前配置覆盖）。
- **删除后的引用是死引用**：保留下来只为不丢用户的选择，真去运行会因为模板不存在而报「读取生成模板失败」——这是「不消失」的代价，不是 bug。
- **老画布第一次打开会就地冻结在当时的配置上**：加入快照之前没有存过历史配置，只能按第一次拉到的结果锁。

### 验证

- `oneoff/check_field_freeze.js`（14 项，主实例 8188，全程自建/自删探针工作流 `zfrz-a` → `zfrz-b`）：新节点快照 = 模板当前 2 项 → 模板加参数后未产出节点跟到 3 项 → 给它一个 result 后模板删参数，节点仍 3 项且**面板真的还渲染 `3:seed` 行** → 同时新建的另一节点是 2 项（节点级冻结，不是全局缓存）→ 改名后两个节点都指向新名、已产出节点快照内容不变 → 删除后已产出节点下拉里仍有该项且是选中项、未产出节点下拉里已无该项并落到 `Krea-2`。
- 回归：`check_api_config`（7 项）、`check_save_state`（9 项）、`check_node_default`（10 项）、`check_result_inline`（6 项，真跑两轮）、`check_input_rules` 全部通过，零 JS 异常；探针工作流与 `api_settings.json` 无残留。
- 只改前端 JS，**Ctrl+F5 即可**，不需要重启后端。


## API 配置里可以直接改参数的默认值（2026-11-17）

以前参数行只有一句只读的「默认值: 940169639409978」，想换个初值只能去改模板 JSON。现在它是一个输入框，改完按「保存配置」就写回模板——节点没手动填过的参数直接显示新值，运行也用新值。

### 改法

| 位置 | 改动 |
|---|---|
| `js/infcanvas-api-config.js` | 节点参数面板每行新增「默认值」编辑框（下拉 / 开关按原值类型给选择器）；`collectNodeFields()` 把编辑后的文本一起回传 |
| `server_routes.py` | 新增 `_coerce_default()` + `_apply_field_defaults()`：按模板**现有值的类型**解析文本（INT / FLOAT / BOOL / STR），只写真正变了的字段，并夹进字段自己的 min/max |
| `api/<name>.json` | 默认值就是模板里 `inputs[key]` 的值，保存时改的就是它；`<name>.fields.json` 不另存副本（两份必然漂移） |

几个必须守住的点：

- **类型不能丢**：弹窗只能给字符串，直接写 `"20"` 会让 ComfyUI 报 `expected INT`。原值是 int / float / bool 就解析回对应类型；64 位种子（`940169639409978`）走 `int()`，不能被浮点化。
- **占位符只读**：`{{image}}` / `{{prompt}}` 是运行时替换的，输入框禁用并标注「运行时由连线填」，后端也拒绝把占位符写进别的字段。
- **未保存不回弹**：面板重建时默认值优先取 `S.fields` 里的草稿，而不是模板值——否则「改 → 完成 → 再打开」会跳回旧数。
- **底栏提示未保存**：改了没保存时显示「已启用 5 个字段（4 个高级） · 未保存」。节点面板的「完成」只是收起面板，**不落盘**，要按弹窗底部的「保存配置」。
- 已建节点上手动填过的值（`apiValues`）仍然优先，默认值改的是「没填过时用什么」。

### 验证

- `oneoff/check_field_default.js`（16 项）：默认值框显示模板原值 → 改 33 / 大整数种子 → 未保存重开仍是新值、底栏提示未保存 → 保存后后端 `default` 是**数字** 33、种子精确 → 磁盘 `54.inputs.steps === 33`、没改的 `negative_prompt` 原样、节点数不变 → `{{image}}` 字段禁用。
- `oneoff/check_field_default_run.js`（9 项，真跑一次）：把放大模板的 `82:resize_type.multiplier` 默认值 4 改成 2，**只写 1 个字段**；新建的「图片放大」节点 `apiValues` 为空、面板显示 2 → 提交的 prompt 里 `82.inputs.resize_type.multiplier === 2` → 768×768 出 1536×1536。
- 回归：`check_field_advanced`（13 项）、`check_api_config`（7 项）、`check_save_state`（9 项）全绿，夹具按备份还原。

⚠️ 这次动了 `server_routes.py`，必须**完全重启 ComfyUI**；只刷新浏览器的话，保存时 `default` 会被旧后端丢掉，看起来就像「改了没生效」。

## 生成结果只回显在生成节点，不再新建结果节点（2026-11-17）

用户点一次运行，画布上同时出现两张一样的图：中间连线着的生成节点一张，右边没连线的「图像」节点一张。查画布数据确认两者引用同一个文件（`seedvr2_upscale_00004_.png`）——生成器本来就把 `data.result` 当画面显示，旁边那个结果节点是同一张图的副本。

### 改法

| 位置 | 改动 |
|---|---|
| `js/infcanvas-core.js` `attachResults()` | 输出只写回 `node.data.result`，不再建结果节点；一次跑出多个输出（批量）时，第 2 张起才各占一个节点 |
| `js/infcanvas-core.js` `collectInputs()` | 连线取素材改成 `source.data.asset \|\| source.data.result`——**这一步是关键**：以前只读 `asset`，生成器没有 `asset`，所以「回显图接下一个生成节点」根本取不到东西 |
| `js/infcanvas-flow.js` `incomingAssets()` / `assetKindOf()` | 同上，素材槽与连线类型判断都认 `result`，回显图在槽位里显示为「图片1」 |
| `js/infcanvas-flow.js` 文本节点 | `isGenText` 不再排除 `data.result`（有结果仍是生成器，面板留着能再跑）；正文 `textHtml` 读 `result.text`，文本结果同样回显 |
| `js/infcanvas-core.js` `foldResultNodes()`（载入时） | 老画布上 `data.resultOf` 指向生成器、且生成器已有 `result` 的结果节点直接收走，连线一并清理；生成器的 `resultNodes` 清空 |
| `js/infcanvas-core.js` toast | 「N 个结果已覆盖到画布」→「已回显到节点」 |

### 实测（`oneoff/check_result_inline.js` 6 项、`oneoff/check_result_fold.js` 4 项、回归 13 项）

- 放大跑完：节点数 2 → 2，`stray`（带 `resultOf` 的节点）为 0，生成器 `data.result = seedvr2_upscale_00007_.png`；
- 把生成器的 `out` 接到第二个图片放大节点：槽位显示 `图片1`、模式「图片放大」可选，运行提交的 `1.image = infcanvas/seedvr2_upscale_00007_.png`——**回显图确实当素材传下去了**，第二张结果 `00008_.png` 正常出图，节点数仍是 3；
- 老画布折叠：造一个「素材 + 生成器(有 result) + 结果节点(resultOf)」的文档，`openByName` 载入后只剩 2 个节点、`result` 保留、`resultNodes` 为空；
- `check_overwrite_seed` 13 项全 PASS（B1–B4 改为「节点数不变、无结果节点、回显换新文件」），`check_input_rules` 0 FAIL、`check_slots_all` 无 FAIL、`check_textgen_seed` 全绿。

## 多用户下「放大的还是猫」：素材预览串台到全局同名文件（2026-11-17）

用户接了一张女孩图做放大，画布上显示的却是猫，怀疑素材没替换。**实际工作流是对的**：磁盘上 `output/<user>/seedvr2_upscale_00003_.png` 就是女孩的放大图（2688×3136，另一次是 4352×7680 的男人图），但画布显示成了猫。

根因是素材预览地址：素材隔离把文件放到 `input|output/<user>/`，而浏览器的 `<img>` **无法带 `comfy-user` 请求头**。我们只给了 `filename`，宿主 `/view` 便按**全局** `output/` 解析，正好命中全局池里的同名旧文件——两次运行恰好都叫 `seedvr2_upscale_00001_/00002_.png`，于是显示成之前留在全局池里的猫图。

宿主 assets API 的做法是把用户段塞进 `subfolder`（`subfolder=<user>[/子目录]`），它的 `/view` 兜底也按这个形状解析。我们跟上：

| 位置 | 改动 |
|---|---|
| `js/infcanvas-core.js` `viewUrl()` | 用 `comfyAPI.api.api.user`（多用户下的当前用户，单用户为 null）把用户段前缀到 `subfolder`：`""` → `<user>`、`infcanvas` → `<user>/infcanvas`。URL 自己就能说明身份 |
| `js/infcanvas-core.js` `refreshViewUrl()` | 只重算本机 `/view` 地址（外部链接 / blob 不动），用于①新上传/生成的结果②**旧画布**——载入时 `normalizeNodeData()` 会把老的无用户段地址重算一次，不用重新拖素材 |
| `server_routes.py` `_view_url()` | 新增 `_user_segment()`（比较 `folder_paths.get_input_directory()` 与全局根，单用户返回空串），所有后端生成的 URL（上传、`/media/import`、`/media/resolve`、素材列表）同样带用户段 |

顺带补上「覆盖」改动的迁移：老版本建的结果节点没有 `data.resultOf`，升级后第一次运行会先按「同一份素材（文件名+目录+类型）」**认领**旧节点，而不是再长一张。（后来改成结果只回显在生成器里，旧结果节点由 `foldResultNodes()` 载入时直接收走，见顶部条目。）

**实测**（新增 `oneoff/check_multiuser_view.js`，6 项全 PASS；后端在临时实例 8189 验）

- 造两个同名不同内容的文件：`output/<user>/mv_collide.png`=64×48、`output/mv_collide.png`=32×24。新地址取到 64×48（用户的），老地址取到 32×24（全局的）——复现并锁死了这个 bug；
- 画布素材节点显示 64×48；把 URL 改回老地址、保存、刷新页面后，`normalizeNodeData` 重算成带用户段的地址，仍是 64×48；
- 8189 上 `POST /media/import`、`GET /media/resolve`、`GET /assets` 返回的 URL 都带 `subfolder=<user>…`；回归 `check_media_import`（8 项）全绿。

## 再次运行覆盖旧结果 + 种子值控制真的会动（2026-11-17）

> 下面第 1 节「结果节点改为覆盖写」已被顶部条目「生成结果只回显在生成节点」取代：现在连结果节点都不建了。种子值控制那部分仍然有效。

用户：「当已经生成内容后，再次点击运行，生成的内容应该覆盖原内容。种子选择固定，那么每次生成种子不变，当选择递增、递减，随机，为什么也是不变的？？？」

两个独立的问题，根因都在「每次运行之后该写回哪里」：

### 1. 结果节点改为覆盖写

`attachResult()` 以前每收到一个输出就 `addNodeByType()` 新建一个素材节点（位置按 `state.results % 5` 往下错 46px），所以连点三次运行就在画布上留下三张图，旧图还得手动删。

现在 `attachResults(node, assets)`：

- 生成器节点记 `data.resultNodes: string[]`（第 N 个输出 → 第 N 个节点 id），结果节点反过来记 `data.resultOf = 生成器 id`；
- 同一槽位已存在 → `updateNodeData` 就地换 `asset / kind / text`，位置、标题和用户接在这个结果节点上的连线全部保留（下游下次跑拿到的就是新素材）；
- 用户删掉了结果节点 → 下一次运行自动新建（`resultOf` 校验，不会误写别人的节点）；批量从 4 张降到 1 张时，多出来的旧节点一并收走；
- 生成器自己面板里的预览（`data.result`）同样跟着覆盖。

### 2. 种子：模式选了却不动

两处都断了，叠在一起表现成「三种模式全都不变」：

| 位置 | 病根 |
|---|---|
| `infcanvas-core.js` `applyAfterQueue()` | 只遍历 `data.fieldModes` 的键。而 `fieldMode()` 的**默认值**是 `randomize`（宿主 `WidgetControlMode` 默认），用户没点过徽标 → `fieldModes` 是空对象 → 直接 `return`，一个值都不推进 |
| 同上 | 就算点了徽标，`current = values[id]` 取的是 `apiValues`，而用户没手填过种子时这里没有条目 → `Number(undefined)` = NaN → `nextControlledValue` 返回 `undefined` → 跳过 |

修法：`ids` 取 `fieldSpecs` 与 `fieldModes` 的并集，模式缺省按 `randomize`；当前值的兜底是 **specs 里的模板默认值**（`infcanvas-flow.js` 在写 `fieldSpecs` 时补上 `default: field.default`，也就是面板上正显示的那个数）。另外随机取值收到 `Number.MAX_SAFE_INTEGER` 以内——浮点存不下 2^64-1，贴着上界取整会四舍五入成 2^64，ComfyUI 会以 `value_bigger_than_max` 拒掉。

**实测**（主实例 8188，新增 `oneoff/check_overwrite_seed.js`，14 项全 PASS）

- 逻辑：Krea-2 的 `54:seed` 规格现在带 `default: 940169639409978`；递增 → +1、递减 → -1、固定 → 不写 `apiValues`、随机 → 换成另一个 ≤2^53 的安全整数、**没点过徽标**也按默认随机变；面板读到的值 = 写入值。
- 真机：图片放大连跑两次 → 结果节点数恒为 1、复用同一个 id、素材从 `seedvr2_upscale_00004_.png` 换成 `_00005_.png`，生成器预览同步；把放大模板的 `80:seed` 设成递增后，两次提交的 prompt 里 seed 是 `[0, 1]`。
- 回归：`check_upscale_run`、`check_input_rules`（0 FAIL）、`check_slots_all`（0 FAIL）、`check_node_default`（10 项）全绿。

## 生成结果直接接进节点就能跑：运行前自动导入 input（2026-11-17）

用户报「构建工作流失败 Error: 图像素材需来自 input 目录；请先把该素材拖入画布上传一次」。

这句话来自 `buildPrompt`：`LoadImage / LoadVideo / LoadAudio` 只读 ComfyUI 的 **input** 目录，而每一次生成的结果都落在 **output**（`type: "output"`）。于是「生成 → 放大 / 编辑 / 再生成」这条最自然的链路必然失败，唯一的绕法是让用户把刚生成的那张图再拖回画布一次——那次拖拽只是为了重新上传一份到 input。

| 位置 | 改动 |
|---|---|
| `server_routes.py` | 新增 `POST /api/infcanvas/media/import`：body `{filename, subfolder, type}`，把素材解析出来（`_resolve_media_path`，容忍错标的 subfolder/type）→ 复制进 `input/infcanvas/` → 返回 `{asset:{filename, subfolder:"infcanvas", type:"input", copied, url}}`。已在 input 的直接原样返回（`copied:false`，带上它真实的 subfolder） |
| `js/infcanvas-core.js` | `buildPrompt` 里新增 `ensureInputAsset()`：素材 `type !== "input"` 时先请求上面那条路由，用返回的 ref 去填 `{{image}} / {{video}} / {{audio}}`；路由不存在（旧后端）或解析失败时保持原来那句报错 |

三个刻意的设计：

- **幂等**：`_import_target()` 用「同名 + 同字节数」判定重复（放大的还是同一张结果，不该堆出 `_1.png` / `_2.png`）；同名但不是同一份文件才加 `_N`，绝不覆盖用户已有的 input 素材。
- **只搬模板真会用的素材**：文本节点也接受图片/视频（LLM ≤50 图 / ≤100 视频），但它的模板里没有 `{{image}}` 占位符，为一个用不上的 100MB 视频做拷贝纯属浪费——按模板文本里有没有该占位符决定搬不搬（老式 `3/4/5` VAEEncode 模板也算「用图」）。
- **多用户安全**：目标目录走 `_upload_dir()`（已按 `comfy-user` 落到 `input/<user>/infcanvas/`），与手工拖拽上传完全一致。

**实测**（临时实例 8189；新增 `oneoff/check_media_import.js`，8 项全 PASS）

- 路由四种情形（curl）：output → input 复制、重复请求 `copied:false`、已在 input 不复制、文件不存在 404。
- 端到端：把 `input/example.png`（768×768）拷进当前用户的 **output** 目录当「刚生成的结果」，画布上以 `type:'output'` 引用 → 接到图片放大 → 运行：请求 `/media/import` 1 次、不再报错、出图、`input/<user>/infcanvas/gen_result_00001_.png` 落盘、结果 1536×1536（×2）。
- 顺带发现（**未改，非本次引入**）：`<img src="/view?...&type=output">` 不带 `comfy-user` 头，多用户实例下会落到全局 output 里同名旧文件；检查脚本因此改成读落盘文件判尺寸。

## 「高级参数」改由暴露时勾选决定（2026-11-17）

用户：「api配置里，选择暴露参数的时候前面加一个勾选，是否高级参数的勾选，勾选的在节点的设置中属于高级参数」。

以前节点里哪些参数折进「显示高级输入」是**写死的前端标签表** `BASIC_LABELS`（提示词优化 / 提示词 / 高宽比 / 百万像素 / 放大倍数 / 种子），换一个模板、改一个显示名就得回去改代码。现在这条判断跟着参数本身走：

| 位置 | 改动 |
|---|---|
| `api/<name>.fields.json` | 每条字段多一个 `advanced` 布尔值 |
| `server_routes.py` `_clean_fields()` | 原样透传 `advanced`（只在是 bool 时写；老文件没有这个键就继续不写） |
| `js/infcanvas-api-config.js` | 每个已启用参数行在名字右边多一个「高级」勾选框（`checkboxEl()` 与「启用」共用 Checkbox.vue 的类串）；勾选状态 `entry.advanced`，保存时 `collectNodeFields()` **一律写明确布尔**；自动识别出来的参数在 `detectFields()` 里按老标签表预置，所以行为不变 |
| `js/infcanvas-flow.js` | `isAdvancedField()`：`advanced` 是布尔就以它为准，否则回落到 `BASIC_LABELS`（老 fields.json 的兼容路径） |

设计取舍：

- **勾选框只在「已启用」后出现**——没暴露的参数谈不上高级；状态留在 `entry` 上，取消启用再勾回来不丢。
- **行的结构从 `<label>` 改成 `div + label`**：两个勾选框不能嵌套在同一个 `<label>` 里（点「高级」会连带切换「启用」）。顺带把 `默认值` 限宽 40%，避免一条 200 字的提示词把整行吃掉。
- **兜底表必须两边一致**：配置弹窗里的勾选框初始态用 `LEGACY_BASIC_LABELS`（与 flow.js 的 `BASIC_LABELS` 同表），否则会出现「勾选框没勾、节点里却藏着」。用户一保存就落成明确布尔值，此后以文件为准。
- 新勾选的参数默认算**普通**（用户刚暴露它，应当看得见），要藏就自己勾「高级」。

**实测**（临时实例 8189，Python 改动不动主实例 8188；新增 `oneoff/check_field_advanced.js`，13 项全 PASS）：54 号 KSampler 的 5 行各带「高级」（steps/cfg 勾选、seed 未勾）；真鼠标点 49 号 `aspect_ratio` 的「高级」→ 保存 → `GET /fields` 返回 `advanced:true`（toast「配置已保存」）；回到画布该节点齿轮弹层只剩 `种子 / 提示词优化 / 百万像素`，点「显示高级输入」后 11 行里出现 `高宽比`。回归 `check_api_config`（7 项）、`check_save_state`（9 项）全绿。夹具文件 `api/Krea-2.fields.json` 测后按备份还原。

## 图片放大分类首个工作流：SeedVR2 7B（2026-11-17）

用户提供 `utility_seedvr2_7b_int8_upscale_image.json`，说明「multiplier 是放大倍数」。落成 `api/SeedVR2-Upscale.json` + `api/SeedVR2-Upscale.fields.json`，`category: 图片放大`，于是它成为「图片放大」模式唯一（也是默认）模板。

| 改动 | 内容 |
|---|---|
| `1 LoadImage.image` | `indoor_portrait.png` → `{{image}}`，由 core 的占位符 pass 替换成 `assetPath()`（`subfolder/filename`） |
| `9 SaveImage.filename_prefix` | `seedvr2_after/image` → `seedvr2_upscale` |
| `80 KSampler.seed` | 模板原值 `18446744073709552000` 超过 2^64-1（JSON 存不下 2^64-1），ComfyUI 直接 400 `value_bigger_than_max` → 改 `0` |
| `.fields.json` | 只暴露 `82:resize_type.multiplier`（放大倍数，0.01–8 / step 0.1，default 4 取自模板；节点真实规格是 `COMFY_DYNAMICCOMBO_V3` 的 `scale by multiplier.multiplier` FLOAT） |

配套两处前端修正：

- **`adoptDefaultWorkflow` 改成按当前分类池 `wfPool` 判定**（原来按 `wfList` 全集）。以前所有模板同属「图片生成」，切模式不会暴露问题；加入「图片放大」后，节点切过去仍死抱 `Krea-2`——下拉被分类过滤成只有 SeedVR2，标签却写 Krea-2、参数弹层显示 Krea-2 的字段，运行必错。现在「切模式 → 换到该分类模板，改默认 pin → 不动已建节点」，`wfPool` 在分类为空时回落全集，所以暂无模板的模式（图片编辑 / 移除背景）行为不变。
- **`BASIC_LABELS` 增加「放大倍数」**，否则它被归入高级参数藏在「显示高级输入」后面，弹层显示 0 项。

**实测**（CDP 真鼠标）：切到图片放大后标签自动变 `SeedVR2-Upscale`、下拉唯一项且打勾、齿轮弹层 1 行 `82:resize_type.multiplier = 4.0`、加两次步进后落 `apiValues` = 4.2；端到端跑通画布节点 768×1376 →×2→ 1536×2752（热态 10s，结果回贴画布）；直连 4x = 3072×5504 / 15s，默认值可承受。回归 `check_node_default`(10) / `check_api_config` / `check_catmenu` / `check_slots_all` / `check_input_rules` / `check_mention` / `check_edges` / `check_audio_wiring` 全绿；新增 `oneoff/check_upscale_api.js`、`oneoff/check_upscale_run.js`。

**环境坑**：本机 `--multi-user` 生效，且 XXXXL 的 `multi_user_assets` 把 `input/output` 隔离成 `input/<name>_<uuid>/`（全局 `input/` 对所有账号不可见）。夹具丢在全局 `input/` 时浏览器会话必报 `Invalid image file`，而直连 `POST /prompt`（无 `comfy-user` 头）却能通过——是假失败。夹具要放 `input/<localStorage['Comfy.userId']>/infcanvas/`，并给 asset 带 `subfolder:'infcanvas'`。

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

## 英文模式：新建节点标题、组与 @ 引用

- 添加节点菜单和新建分组本来就已随语言显示 Text/Image/Video/Audio、Group；本次补齐两处英文模式仍为中文的界面：
- **节点标题**：`data.title` 继续存中文内部 key（`文本/图像/视频/音频`），显示层新增 `displayTitle` 做 `t()`；双击重命名时用 `canonicalTitle()` 把 Text/Image/Video/Audio/Node 折回内部 key，切换语言不会把默认名误判成用户自定义名。
- **提示词 @ 引用**：候选标签改为 `t(图片/视频/音频)+序号`（英文 Image1/Video1/Audio1），插入芯片与提示词文本使用当前语言的 token；解析正则同时接受中英拼法，`@图片1` 与 `@Image1` 互换语言后仍能匹配到同一素材、保留缩略图。
- 空节点上传提示改为整句插值 `点击上传{kind}`，英文显示 Click to upload Image/Video/Audio/Text。
- 验证：全 JS 语法与 ESM 加载、i18n 缺键 0；8188 真机英文模式四项菜单/标题、Group、@Image1 芯片与跨语言兼容均通过。

## 分组视觉与交互改版

- 去掉蓝色与右下角三角：白色半透明边框/填充、12px 圆角（与节点一致）、30px 整条标题栏；选中仍是白色外框。
- 标题栏双击任意位置改名；按住标题栏拖动时，组和组内节点同步位移（等同宿主 `LGraphGroup.move()`）。
- 四角加入与节点同款缩放手柄，拖动时对边固定、组内节点不随缩放移动。
- 实现上拆成背景层 `.ic-group`（留在节点下方）和交互层 `.ic-group-ui`（浮在节点上方），两者共用同一份 bounds；否则标题/手柄会被 Vue Flow 层挡住收不到鼠标事件。
- 8188 真机验证：样式数值、双击改名、标题拖动同步、SE/NW 缩放固定边、选中高亮均通过；i18n 回归 19 PASS / 0 FAIL。
- 修复缩放时组的圆角漂移：根因是组在 VueFlow 缩放层外、手动乘 zoom 时漏了圆角/边框/手柄。最终把组背景、交互层和多选工具条全部移进 VueFlow 的 `#zoom-pane` 插槽（transformationpane 内部），坐标改回纯图单位，所有尺寸由 CSS 随 pane 统一缩放。层叠改为背景 z=-1、交互层 z=3（节点 z=0）。真机验证 0.5x/1x/2x 下组与节点圆角完全一致（6/12/24px），交互回归全过。
- 修复组移动时的坐标漂移：原来只对组坐标取整、子节点仍用带小数的原始位移，非整数缩放下逐次累积偏差。改为先按 10px 网格吸附组位置，再用吸附后的实际位移同步所有子节点，任何缩放级别下组与节点严格一致。组拉伸也补上和节点一致的「移动边吸附网格、对边固定」。真机 8/8 通过。
- 修复拖组标题栏时画布跟着平移：组移进缩放层后，标题栏和四角手柄只拦了 pointerdown、没拦 mousedown，而画布平移走 d3-zoom 的 mousedown.zoom，导致拖组时画布同时平移、坐标换算错乱。给标题栏和手柄补上 nopan/nodrag class 与 @mousedown.stop。真机验证拖组前后 viewport 完全不变，吸附/子节点同步/拉伸 9/9 通过。
- 组配色按 ComfyUI 组规则改为白色：主体 25% 白、标题栏叠加成约 44%、边框 100% 不透明白，对齐宿主 `LGraphGroup` 的 alpha 规则。
- 节点阴影对齐 Nodes 2.0：宿主 Vue 节点用 `drop-shadow-lg` 滤镜 `filter: drop-shadow(0 9px 7px rgba(0,0,0,.4))`，不是旧 canvas 节点的 2px/3px 投影。节点改用该滤镜，选中白环保留为独立 box-shadow。真机 9/9 通过。
- 组透明度按用户要求调为两层各 10%：主体 10% 白、标题栏再叠 10%（视觉约 19%），边框仍不透明白。真机 `check_group_opacity.js` 4/4。
- 单选节点上方控件 `.icn__tools` 样式对齐框选工具条 `.ic-selection-tools`：从散开的独立灰块改为一整块深色面板（1px 边框 `--border`、8px 圆角、`--ic-panel` 底、`0 6px 20px rgba(0,0,0,.45)` 阴影、32px 高、2px padding/gap），按钮透明底 hover 高亮、6px 圆角、12px 字、26px 高；面板用 `left:50% + translate(-50%,…)` 居中并携带显隐动画，悬于节点上方 10px。真机 `check_node_toolbar.js` 12/12：逐项样式与框选工具条一致、居中、间距正确。
- 节点工具条改名 + 加图标：镜像→旋转、调整→调色、抽帧→捕捉帧、分离→音频分离、宫格→宫格裁剪（按钮 label / hover 提示 / 弹窗 title / 进度 title / i18n 字典全同步，保留旧 key 兼容）。`TOOL_ICONS` 把 13 个工具 key 映射到 Lucide 图标名，ICONS 表补 11 个矢量 path（upload 复用已有）。按用户给的 5 张截图定制：旋转=环形箭头、调色=光圈、捕捉帧=相机、音频分离=波形加斜杠、宫格裁剪=九宫格。按钮模板加 `<IcIcon :name="action.icon" :size="14">` + `.icn__tool-icon` 对齐样式。真机 `check_tool_icons.js` 33/33：中英双语新名字、13 按钮全有图标 path、英文无残留中文。截图 `.workbuddy/tmp/tool-icons.png`。
