# VueNodes / App 模式兼容性重构规划（P3）

> 配套：节点审计报告 `docs/node-audit.md` 第 3 节「兼容性风险」与第 7 节「P3（长期）」。
> 本文件是 P3 的**规划 + 已落地安全加固**交付，不是盲目重写。
> 状态：P2（F4/F5/F6）已在分支 `fix/audit-p2-p3` 完成；本规划的高风险重写项**待开启 VueNodes 的测试实例后逐期执行**，不在本仓库当前运行时（VueNodes 默认关闭）盲改。

## 0. 背景与判定线

- 本机 ComfyUI 前端 1.57.6 **已内置 VueNodes 新渲染器**，开关 `Comfy.VueNodes.Enabled`，**当前默认关**（litegraph 仍是主渲染器）。未来该开关翻转后，依赖 litegraph 内部对象的前端代码会失效。
- frontend 技能确认的事实：
  - **DOM widget 在 VueNodes 下仍渲染**（官方 `node.addDOMWidget` 路径存活）；
  - 但 `node.mode` 切换、`node.inputs` 遍历/增删、`app.graph._nodes` 直接访问**不会**在 App 模式下工作。
- **判定线**：代码是否在 litegraph 层直接操作 `node` / `app.graph` 对象（读写 `node.mode`、`flags.disabled`、`node.size`、`app.graph._nodes`、`app.graph.change`、裸 `addInput/removeInput`、注入 `app.menu`）。是 → 翻转后失效；否（DOM widget、官方 `registerSidebarTab`、官方 `surfaces` 隐藏）→ 安全。

## 1. 逐模块盘点（带实际行号）

### 1.1 🐈‍⬛GroupControl / 🐈‍⬛NodeControl + `web/control_panel.js`（最大风险）
面板本身用官方 `node.addDOMWidget` 挂载（`control_panel.js:831`），**渲染在 VueNodes 下存活**。失效的是逻辑层：

| 位置 | 用法 | VueNodes 影响 |
|---|---|---|
| `group_control.js:42,55` / `node_control.js:43,107` | `app.graph` 遍历所有节点 | `_nodes` 直读在 App 模式不可用 |
| `group_control.js:128` / `node_control.js:136` | 写 `n.flags.disabled = false` 启停节点 | App 模式禁用以不同机制管理 |
| `control_panel.js:111` | 读 `n.mode` 判断 bypass/never | `node.mode` 在 App 模式不驱动渲染 |
| `control_panel.js:309,496,509-512` | `node.size` / `node.setSize` 控制宽度 | App 模式尺寸由 Vue 布局接管，手动写被忽略/打架 |
| `control_panel.js:476,783-825` | **monkeypatch `app.graph.change`** 侦测属性变化以实时刷新面板；teardown 还原 | 重写 litegraph 图对象方法，App 模式图对象不同 → 失效 |
| `control_panel.js:843-861` | `node.onResize` 覆盖记宽度 | App 模式 onResize 语义可能变 |

**结论**：渲染（DOM widget）安全；但「静音/旁路/禁用节点 + 实时刷新 + 手动宽度」整条逻辑链在 App 模式断裂。

### 1.2 🐈‍⬛AnySwitch + `web/any_switch.js`（硬阻塞）
- `any_switch.js:60-98` 用 `node.addInput` / `node.removeInput` 增删端口，`node.inputs` 数组直接操作；`slot.link` / `slot.type` / `node.outputs` / `node.graph.links`（`any_switch.js:52,62,64,108,111`）裸读。
- VueNodes 下端口由 schema 驱动，裸 litegraph 端口增删**不反映**到渲染。
- 与 F2 评估一致：官方 `io.Autogrow`（后端模板端口）是唯一 VueNodes 兼容路径，但其「强制连接 + min 必填」语义与 AnySwitch「空槽可选、只转发唯一有值端口」不契合——需在 VueNodes 运行时重新评估 + 可能改后端 schema。

### 1.3 History Gallery `web/history_gallery.js`（107KB，高风险）
- **安全**：侧栏 Tab 用官方 `registerSidebarTab`（`history_gallery.js:2933,2961`），VueNodes 下存活。
- **失效**：
  - `app.graph.add(node)`（`history_gallery.js:1665`）把预览「作为节点插入画布」——创建裸 `LGraphNode`，App 模式不支持；
  - `app.canvas`（`history_gallery.js:1689`）、`app.graph.setDirtyCanvas`（`history_gallery.js:1692`）、`node.size`（`history_gallery.js:1670`）——canvas 专用 API，App 模式不存在。

### 1.4 Monitor `web/monitor.js`（中风险）
- 菜单栏浮动条注入 `app.menu.settingsGroup.element`（`monitor.js:227-230`）——ComfyUI 菜单内部结构，App 模式顶栏组件可能不同 → 失效。
- 已有 `querySelector` + 固定悬浮条兜底（`monitor.js` 既有守卫），降级不崩，但注入点需换官方 `app.menu.addItem` / 命令注册。

### 1.5 已 VueNodes 安全（无需改）
- 🐈‍⬛ResolutionSelector / 🐈‍⬛FitImageToSize 预览喂值：只读 `node.inputs[].link` + `node.graph.links` 找上游、用 `app.graph?._nodes` 遍历同步（`fit_image_to_size.js:116-121,245`）——**只读且带空值守卫**，数据模型在 App 模式仍可能保留；且隐藏用官方 `surfaces`（F6 已加固）。
- 所有隐藏 widget 已迁移到 `surfaces`（F6）。

## 2. 官方替代 API 索引（已知 / 待实测）

| 失效用法 | 候选官方替代 | 成熟度 |
|---|---|---|
| `node.addDOMWidget` | 同（已用） | ✅ 安全 |
| `registerSidebarTab` | 同（已用） | ✅ 安全 |
| 隐藏 widget | `surfaces: {canvas/vueNode/panel: "never"}` | ✅ 已用（F6） |
| 静音/旁路/禁用节点 | `node.mode` / 节点 store action（需实测 App 模式是否存在） | ⚠️ 待验证 |
| 动态端口 | `io.Autogrow` + `io.MatchType`（后端） | ⚠️ 语义需重评 |
| 菜单项 | `app.menu.addItem` / 命令注册 | ⚠️ 待验证 |
| 图遍历 | 官方 `app.graph` 响应式 API / `app.graph.nodes`（若有），非 `._nodes` | ⚠️ 待验证 |
| 插入节点 | App 模式节点创建 API（待查） | ❌ 未明 |

## 3. 分期序列

- **Phase 0（已随 P2 落地）**：跨渲染器加固——F6 `surfaces` 隐藏；确认 DOM widget / sidebar tab 已走官方路径。
- **Phase 1（低风险，开启 VueNodes 后做）**：
  - `fit_image_to_size.js` 上游查找：从 `graph._nodes` / `node.inputs[].link` 改为最稳的公共 API，验证 App 模式取值。
  - `monitor.js`：菜单注入迁到官方 `app.menu.addItem` / 命令注册，保留降级兜底。
- **Phase 2（中风险）**：`🐈‍⬛AnySwitch` 用 `io.Autogrow` + `io.MatchType` 重做端口增长（改后端 schema + 前端），在 VueNodes 运行时验证。
- **Phase 3（高风险，大）**：`control_panel.js` + `group_control.js` + `node_control.js` 重写静音/旁路/禁用/实时刷新/宽度逻辑，改用 App 模式节点状态 API（约 34KB 面板逻辑）。
- **Phase 4（高风险，大）**：`history_gallery.js` 移除 `app.graph.add(node)` / `app.canvas` / 裸 `LGraphNode`，重设计「插入为节点」；保留 sidebar tab + DOM 列表（约 107KB）。

## 4. 验证策略（强制）

- **不开盲改**：当前仓库运行时 VueNodes 默认关闭，任何「VueNodes 重写」都**无法在本机验证**。重写前必须先在一个**独立测试实例**开启 `Comfy.VueNodes.Enabled`（不要动用户的 8188 主实例）。
- 逐期：开启 → 加载对应节点 → 核对渲染 + 行为（截图）→ 修复 → 关回主线对比。
- Phase 3/4 体量巨大，建议拆成独立功能分支（如 `feat/vue-nodes-control-panel`、`feat/vue-nodes-history-gallery`），各自走「建分支 → 测试实例验证 → 合入」流程。

## 5. 本次（P2/P3）已落地项

- F4：`install()` 迁 `on_load()`（`__init__.py`）。
- F5：前端 import 路径统一为 `../../scripts/app.js`（5 文件）。
- F6：`resolution_selector.js` / `fit_image_to_size.js` 隐藏 widget 改用官方 `surfaces`（VueNodes 安全）。
- P3 规划文档（本文件）+ 安全项确认（DOM widget / sidebar tab 已官方路径）。
- **未动**：Phase 1-4 高风险重写（待 VueNodes 测试实例）。
