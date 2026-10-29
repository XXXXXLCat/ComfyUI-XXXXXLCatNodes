# ComfyUI-XXXXXLCatNodes 节点审计

> 审计基准：`comfyui-node-*` 技能集（basics / inputs / outputs / lifecycle / frontend / advanced），从 `jtydhr88/comfyui-custom-node-skills` 安装到用户级 skills。
> 审计对象：仓库内 8 个 V3 节点 + 两个非节点模块（`nodes/multi_user_assets.py`、`nodes/history_gallery.py`、`web/history_gallery.js`）。
> 环境：本机 ComfyUI 前端 1.57.6（已内置 VueNodes 新渲染器，开关 `Comfy.VueNodes.Enabled`，当前默认关）。

## 0. 总体结论

**结构正确性：合格。** 8 个节点全部继承 `io.ComfyNode`、用 `ComfyExtension` + `comfy_entrypoint()` 注册、`node_id` 全局唯一、`execute` 与 schema 对应、`io.NodeOutput` 数量匹配、i18n 覆盖完整（zh+en + zh-* 别名）。

**必须修 1 项**（正确性缺陷）：VRAM/RAM 释放节点的副作用会被缓存跳过。

**建议改 3 项**（健壮性/规范）：Any Switch 动态端口应迁移到官方 `Autogrow`；若干内部 API 依赖标注版本边界；导入路径与隐藏 widget 方式统一为官方约定。

**兼容性风险**（VueNodes/App 模式翻转后失效）：Group/Node Control、Any Switch、History Gallery、Monitor 大量依赖 litegraph 内部（`node.mode`、`node.inputs`、`app.graph._nodes`、`app.menu` 等），届时需重写。

---

## 1. 必改（正确性缺陷）

### F1 — VRAM / RAM 释放节点的副作用会被缓存跳过　【中高优先级】

- **文件**：`nodes/vram_sweep.py`、`nodes/ram_reclaim.py`
- **现象**：两节点都设了 `is_output_node=True` 且 `not_idempotent=True`，但**没有实现 `fingerprint_inputs`**。
- **依据**（lifecycle 技能原文）："`not_idempotent=True` does **not** prevent a node from reusing its own cached output on subsequent runs. It only prevents cache sharing between different instances … To force re-execution every run … you must also implement `fingerprint_inputs` … returning a unique value each time."
- **后果**：释放显存/内存是副作用。监控按钮（`web/monitor.js`）每次点击都 POST 一份输入完全相同的新 prompt，但 ComfyUI 的缓存键基于**节点输入**而非 prompt_id——输入不变即命中缓存，**第二次起不再真正执行释放**。
- **修复**：
  ```python
  @classmethod
  def fingerprint_inputs(cls, offload_model, offload_cache, force_gc=False, anything=None, **kwargs):
      import time
      return time.time()   # 每次都不同 → 永远重新执行
  ```
  或者维护一个自增计数器。`not_idempotent=True` 可保留（防跨实例串缓存），但**单凭它无法保证每次都跑**。

> **状态：✅ 已修复并合入 main（合并提交 `cbbd164`，2026-10-29）。** 两个文件均已补 `@classmethod fingerprint_inputs(cls, **kwargs)` 返回 `time.monotonic()`（每次不同的时间戳，使缓存键永远失效）。已用 ComfyUI 真实 `first_real_override` 机制验证 override 被识别、返回值随时间变化、基类占位不被误判；四个改动文件 `py_compile` 通过。**已在 8188 实例（RTX 5090，无 `--cache` 关闭）做 A/B 对照实测实锤**：相同输入连跑两次，对照 `PreviewAny`（无 fingerprint）RUN2 命中 `["1"]` 被复用，目标 `🐈‍⬛VRAMSweep`（有 fingerprint）RUN2 命中 `[]` 仍执行。

---

## 2. 建议改（健壮性 / 规范）

### F2 — Any Switch 动态端口用裸 litegraph 操作，应迁移到官方 `Autogrow`　【中】

- **文件**：`nodes/any_switch.py` + `web/any_switch.js`
- **现象**：后端声明 9 个可选 `io.AnyType` 输入，前端用 `node.addInput/removeInput` 增删端口；`execute(cls, *args, **kwargs)` 用兜底收集。
- **依据**：advanced 技能的官方动态端口做法是 `io.Autogrow`（TemplatePrefix，硬上限 100 槽），配 `io.MatchType` 可实现"任意类型单端口转发"。
- **影响**：当前做法在 litegraph 渲染器下可用，但**无法在 VueNodes/App 模式下工作**，且与官方缓存/校验路径不完全对齐。
- **建议**：评估迁移到 `Autogrow` + `MatchType`；短期至少把"这是兼容取舍"写进注释，避免后续误解。

> **状态：✅ 已评估并加注释并合入 main（合并提交 `cbbd164`，2026-10-29）。** 经核对官方 `io.Autogrow`（`comfy_api/latest/_io.py:1094`）与前端的原生增长支持：Autogrow 模板槽为"强制连接 + min 必填"，与 AnySwitch"空槽可选、只转发唯一有值端口"语义不契合；且其前端增长同样基于 litegraph 渲染器，VueNodes 下可用性未验证——迁移并不能消除 VueNodes 兼容风险。故保持现状，已在 `any_switch.py` 模块注释与 `any_switch.js` 顶部 `COMPAT NOTE` 中记录评估结论与未来迁移路径。

### F3 — 内部 API 依赖，标注版本边界　【低–中】

- `nodes/h3_image_to_video.py` 直接 import 内部 `comfy.nested_tensor`、`comfy.model_management`、`node_helpers`。已在 docstring 说明刻意镜像 H3 数学以避开 `comfy_extras` 私有 API——方向正确，但仍依赖内部符号，前端/核心大版本升级有风险。**建议在文件头注释里写明"依赖 ComfyUI X 版本的内部符号，升级时需回测"**。
- `web/fit_image_to_size.js` 用 `app.nodeOutputs?.[id]?.images`（内部属性）；`web/monitor.js` 用 `app.menu.settingsGroup.element`（内部菜单结构，但已有 `querySelector` + 固定悬浮条兜底）。属前端内部 API，前端大版本可能变动。

> **状态：✅ 已加版本边界注释并合入 main（合并提交 `cbbd164`，2026-10-29）。** `h3_image_to_video.py` 在 `comfy.model_management / comfy.nested_tensor / comfy.utils / node_helpers` 等内部 import 前补了"核心大版本升级需回测"注释；`fit_image_to_size.js` 的 `app.nodeOutputs` 用法、`monitor.js` 的 `app.menu.settingsGroup.element` 注入点均补了"前端内部 API、大版本可能变动、已做空值守卫"的注释。

### F4 — `comfy_entrypoint` 内安装补丁，建议改到 `on_load`　【低】

- `__init__.py` 的 `comfy_entrypoint()` 在返回扩展的同时安装了 `locale_alias` / `multi_user_assets` / `history_gallery` 的 monkeypatch。非标准但可行。basics 技能把"升级/安装期"的逻辑放在 `ComfyExtension.on_load()`（`@override async def on_load`），语义更贴切，且保证在 core 就绪后执行。**建议**把三类 `install()` 迁移到 `on_load()`。

> **状态：✅ 已迁移（分支 `fix/audit-p2-p3`，2026-10-29）。** 三处 `install()`（locale_alias / multi_user_assets / history_gallery）已从 `comfy_entrypoint()` 迁到 `XXXXXLCatExtension.on_load()`（async），`comfy_entrypoint` 现在只 `return XXXXXLCatExtension()`。已核实 `ComfyExtension.on_load` 是官方加载钩子（`comfy_api/latest/__init__.py:117`），`nodes.py:2329` 在 entrypoint 返回后、`get_node_list` 前 `await` 调用——迁移等价且语义更贴切；各 `install` 自带幂等守卫，安全。`py_compile` 通过。需重启实例生效。

### F5 — 前端导入路径不统一　【低 · 确认无功能影响】

- `web/` 下对 `scripts/app.js` 的引用有两种：`../../scripts/app.js`（any_switch、i18n、monitor、history_gallery）与 `../../../scripts/app.js`（其余 5 个文件）。
- 经核实扩展静态挂载在 `/extensions/<包名>/`（不含 `web/` 段），浏览器对超出根的 `..` 会**钳制到根**，所以两种最终都解析到 `/scripts/app.js`，**不构成 bug**。但应统一为 ComfyUI 官方约定的 `../../scripts/app.js`，避免 Vite 开发服务器等环境的边缘差异。

> **状态：✅ 已统一（分支 `fix/audit-p2-p3`，2026-10-29）。** 5 个文件（`control_panel.js`、`group_control.js`、`fit_image_to_size.js`、`node_control.js`、`resolution_selector.js`）的 `../../../scripts/app.js` 全部改为官方 `../../scripts/app.js`；其余 4 个（`any_switch.js`、`monitor.js`、`history_gallery.js`、`i18n.js`）本就是 `../../`，未动。`node --check` 全过。刷新即生效，行为保持。

### F6 — ResolutionPreview 内部 feed 的隐藏方式　【低】

- `resolution_selector.js` / `fit_image_to_size.js` 用手动 `widget.hidden` + `widget.options.hidden` + 重写 `computeSize` 来隐藏 `preview_ratio`/`preview_megapixels`。frontend 技能推荐用 `surfaces: { canvas: "never", vueNode: "never", panel: "never" }`（v1.55.6+）或 `widget.hidden = true`。当前写法可用，但 `surfaces` 更稳、更贴近官方。

> **状态：✅ 已改用 `surfaces`（分支 `fix/audit-p2-p3`，2026-10-29）。** 两文件的 `setHidden` 在保留 `widget.hidden` + `widget.options.hidden` + 重写 `computeSize` 折叠（litegraph 高度仍靠它）的基础上，额外设置官方 `surfaces: { canvas: "never", vueNode: "never", panel: "never" }`——隐藏 widget 在 VueNodes/面板渲染面也消失；首次隐藏时存原 `surfaces`、显示时还原。`node --check` 全过。刷新即生效。

---

## 3. 兼容性风险（VueNodes / App 模式翻转后失效）

本机前端已内置 VueNodes 新渲染器，开关 `Comfy.VueNodes.Enabled` 未来会翻转。以下节点大量依赖 litegraph 内部，翻转后需重写（frontend 技能确认 DOM widget 在 VueNodes 下仍渲染，但 `node.mode` 切换、`node.inputs` 遍历不会）：

- **Group/Node Control + control_panel.js**：直接写 `node.mode`、`n.flags.disabled`、`app.graph.change`、`node.size`、`app.graph._nodes`，DOM widget 内嵌。
- **Any Switch**：`node.inputs`/`node.outputs` 手动增删 + `slot.type`/`slot.link`。
- **History Gallery**（107KB）：侧栏 Tab 用官方 `registerSidebarTab`（这部分 OK），但列表/拖拽/选区全是 litegraph/DOM 操作。
- **Monitor**：菜单栏注入用 `app.menu` 内部。

**建议**：把"是否在 litegraph 层操作"作为后续重构的判定线；新写功能优先走 DOM widget / 官方组件，少碰 `node.mode`、`node.inputs`、`app.graph._nodes` 等底层。

> **状态：✅ 已产出重构规划（分支 `fix/audit-p2-p3`，2026-10-29）。** 见 `docs/vue-nodes-migration-plan.md`：逐模块带行号盘点（control_panel / group_control / node_control / any_switch / history_gallery / monitor）+ 官方替代 API + Phase 0–4 分期 + 验证策略。核心结论：控制面板用官方 `node.addDOMWidget`（VueNodes 渲染存活，破的是逻辑层 `node.mode`/`flags.disabled`/`app.graph.change` 重写/`node.size`）；AnySwitch 裸 `addInput/removeInput` 是硬阻塞（VueNodes 端口由 schema 驱动）；History Gallery `registerSidebarTab` 安全但 `app.graph.add`/`app.canvas` 失效；Monitor 注入 `app.menu.settingsGroup.element` 脆弱。**高风险重写（control_panel 34KB、history_gallery 107KB、any_switch 端口、monitor 菜单）显式延后**：当前 VueNodes 默认关闭、无运行时可验证，盲改会破坏现工作应用；规则是开独立测试实例（`Comfy.VueNodes.Enabled`）逐期验证，不碰 8188 主实例。P2 已落的跨渲染器加固（`surfaces`）即时受益。

---

## 4. i18n（一致，确认无误）

- `locales/zh` 与 `locales/en` 的 `nodeDefs.json` 都覆盖**全部 8 个节点**，键与 `node_id` 完全一致（含品牌 emoji `🐈‍⬛`）。
- 仅 zh+en 两包；`locale_alias.py` 在 `comfy_entrypoint` 中安装，把 zh 条目 `setdefault` 补齐到 zh-*（含 zh-TW）。**这符合本项目"zh+en + 别名"的设计**（注意：与另一项目 Launcher 的 5-locale 同步规则是两套不同约定，不要混用）。
- 前端 `web/i18n.js` 以 `Comfy.Locale` setting 为准、localStorage/`navigator` 兜底，且 `pick()` 每次查询实时解析——能应对会话内切换语言，实现正确。

---

## 5. 分节点逐项核对表

| 节点 | V3 结构 | `execute` ↔ schema | 输出匹配 | 缓存/副作用 | 前端 | i18n | 结论 |
|---|---|---|---|---|---|---|---|
| 🐈‍⬛VRAMSweep | ✅ `io.ComfyNode` | ✅ 4 输入对应 + `**kwargs` | ✅ 2 输出 | ⚠️ `not_idempotent` 缺 `fingerprint_inputs` → **F1** | — | ✅ zh/en | **必改 F1** |
| 🐈‍⬛RAMReclaim | ✅ | ✅ 对应 + `**kwargs` | ✅ 2 输出 | ⚠️ 同 F1 | — | ✅ | **必改 F1** |
| 🐈‍⬛H3ImageToVideo | ✅ | ✅ 9 输入完全对应 | ✅ 3 输出 | ✅ 确定性（无 `not_idempotent`，正确） | — | ✅ | ✅ 仅标注内部 API（F3） |
| 🐈‍⬛AnySwitch | ✅ 9×可选 AnyType | ⚠️ `*args/**kwargs` 兜底（合理偏差） | ✅ 1 输出 | ✅ 纯转发，无副作用 | ⚠️ 裸 litegraph 端口增删（F2） | ✅ | 建议迁移 Autogrow（F2） |
| 🐈‍⬛GroupControl | ✅ 单可选 signal | ✅ `**kwargs` 转发 | ✅ 1 输出 | ✅ 无副作用 | ⚠️ 重 litegraph（兼容风险） | ✅ | 兼容风险 |
| 🐈‍⬛NodeControl | ✅ 单可选 signal | ✅ 转发 | ✅ 1 输出 | ✅ 无副作用 | ⚠️ 重 litegraph（兼容风险） | ✅ | 兼容风险 |
| 🐈‍⬛ResolutionSelector | ✅ | ✅ 含 `preview=None` | ✅ 2 输出 | ✅ 确定性 | ✅ 官方 `DynamicCombo` + 喂 preview（F6） | ✅ | ✅ 仅隐藏方式（F6） |
| 🐈‍⬛FitImageToSize | ✅ | ✅ 4 输入对应 | ✅ 4 输出 | ✅ 确定性 | ✅ 喂 preview（F3 内部 API） | ✅ | ✅ F3/F6 |

---

## 6. 值得肯定的做法（对照技能）

- 8 个节点全部用 V3 `io.ComfyNode` + `ComfyExtension`/`comfy_entrypoint`，与 basics 技能注册方式**完全一致**。
- ResolutionSelector 正确使用了 advanced 技能的官方 `io.DynamicCombo`（条件输入）——这是模板级正确用法。
- `node_id` 全局唯一（品牌 emoji 非常规但 ComfyUI 支持，且 `locale_alias` 已按此键对齐）。
- 多用户隔离 / 历史画廊的 monkeypatch 全部带 `try/except` + 幂等守卫（`_INSTALLED`/`_ROUTES_DONE`/`_xuser_patched`），且只在 `--multi-user` 等条件满足时激活——工程稳健（虽不在"节点"范畴，但作为包质量很高）。
- 预览脚本（resolution_selector/fit_image_to_size）对 `onNodeCreated`/`onConfigure`/`onConnectionsChange` 都用 `base?.apply(this, arguments)` 包裹，避免覆盖 core 既有钩子，符合 frontend 技能"链式挂载"建议。

---

## 7. 整改优先级

1. **P0（必须）**：F1 — ✅ 已修复并合入 main（合并提交 `cbbd164`）：VRAMSweep / RAMReclaim 补 `@classmethod fingerprint_inputs` 返回 `time.monotonic()`，已在 8188 实例 A/B 对照实锤每次重跑生效。
2. **P1（建议）**：F2 — ✅ 已评估并加注释（保持现状，记录 VueNodes 迁移路径）；F3 — ✅ 已加版本边界注释（h3 / fit_image_to_size / monitor 三处）。两项均已合入 main（合并提交 `cbbd164`）。
3. **P2（规范）**：F4 `on_load`（✅ 已迁移）、F5 统一导入路径（✅ 已统一）、F6 `surfaces` 隐藏 widget（✅ 已改用）—— 三项全部完成于分支 `fix/audit-p2-p3`，待合入 main。
4. **P3（长期）**：针对 VueNodes/App 模式 —— ✅ 已产出重构规划 `docs/vue-nodes-migration-plan.md`（分支 `fix/audit-p2-p3`）；高风险重写延后至开启 VueNodes 的测试实例逐期执行。
