/**
 * 阶段 11 / batch 5 之后的应用入口。
 *
 * 旧入口是「编译 src/App.vue 等上游 SFC → 再用 17 组文本补丁改写压缩产物」。
 * 现在补丁机制已退役：应用主体是 src/xcat/app/canvas-app.js（自包含、自行
 * mount("#app")），src/App.vue 与 src/components/ 保留为上游 v0.1.3 的
 * 可读参考源码，不再参与生产构建。
 *
 * CSS 顺序有讲究：canvas-app.css 是与应用主体同源的上游组件样式（含 scoped
 * data-v-* 哈希），必须排在最前；本包的全局覆盖 xcat-overrides.css 排最后，
 * 才能压住上游规则。shadcn 隔离样式 style.css 不含 preflight，不会污染上游
 * html[data-theme] / --c-* 主题。
 *
 * import 按书写顺序求值：apply-theme.js 必须在 canvas-app.js 之前。
 */
import "./xcat/app/canvas-app.css";
import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "./styles/base.css";
import "./style.css";
import "./styles/xcat-overrides.css";

import "./xcat/app/apply-theme.js";
import "./xcat/app/canvas-app.js";
