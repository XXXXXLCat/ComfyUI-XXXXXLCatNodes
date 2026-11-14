/**
 * shadcn-vue 面板统一入口（阶段 4 起，阶段 11 batch 2 增至八个）。
 *
 * 八个挂载器共用一份 Vue runtime、同一个 IIFE：
 *   - audio-panel/   : gen-audio 的专用双输入面板（阶段 3）
 *   - node-panel/    : 其余生成节点的通用面板（阶段 4）
 *   - lora-panel/    : LoRA 栈节点面板（阶段 4）
 *   - asset-actions/ : 节点上方操作按钮行（阶段 5）
 *   - asset-dialog/  : 资产弹层侧栏关闭 / 工具按钮（阶段 5）
 *   - tool-dialog/   : 7 个工具弹窗的通用控件（阶段 6）
 *   - tool-shell/    : 7 个工具弹窗的官方 Dialog 外壳（阶段 7）
 *   - save-dialog/   : 「保存画布」的官方 Dialog（阶段 11 batch 2）
 *
 * 八者彼此独立：各自判定 role / 容器、各自维护 Map，互不干扰。
 * 主 chunk 不 import 这里任何东西：这些面板由 vite.panel.config.js 单独构建，
 * 与固化的画布应用主体零耦合。
 */
import "../audio-panel/main.js";
import "../node-panel/main.js";
import "../lora-panel/main.js";
import "../asset-actions/main.js";
import "../asset-dialog/main.js";
import "../tool-dialog/main.js";
import "../tool-shell/main.js";
import "../save-dialog/main.js";
