/**
 * shadcn-vue 节点面板的独立构建配置（阶段 3 试点 + 阶段 4 铺开）。
 *
 * 画布应用主体是 src/xcat/app/canvas-app.js（上游 v0.1.3 的固化模块），
 * src/components/ 下的上游 SFC 是参考源码、不在运行时组件树里。因此新面板
 * 用这里单独打成 IIFE，输出到 public/assets/xcat-panels.js，由 index.html 像
 * 其它 xcat-*.js 一样用 <script defer> 引入。产物自带一份 Vue runtime，与主
 * 应用的 Vue 互不干扰；八个面板共用这一份，不重复打包。
 *
 * 样式不在这里产出：组件全部用 Tailwind 工具类，由主工程的 @tailwindcss/vite
 * 扫描 src/ 时统一生成，随主样式一起注入页面（主题变量同样来自主工程 style.css）。
 *
 * 阶段 11 / batch 5 已让补丁插件退役，但独立构建仍保留：面板继续以影子控件
 * 桥接方式工作，不依赖固化应用的内部实现。
 */
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // outDir 就在 public 里，必须关掉 publicDir，否则 Vite 会把 public 复制进自己
  publicDir: false,
  // lib/IIFE 产物不会经过 Vite app 模式的环境变量替换：Vue / reka-ui /
  // @vueuse/core 的源码里 234 处 process.env.NODE_ENV 会原样留下，浏览器没有
  // process，脚本一加载就 ReferenceError 整段挂掉。这里显式定死为 production。
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: "public/assets",
    // 千万别清空：public/assets 里还有 22 个随插件交付的 xcat-*.js
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL("./src/xcat/panels/main.js", import.meta.url)),
      name: "XcatPanels",
      formats: ["iife"],
      fileName: () => "xcat-panels.js",
    },
  },
});
