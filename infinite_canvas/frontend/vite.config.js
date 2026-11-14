import { defineConfig, loadEnv } from "vite";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

/**
 * 只调整 HTML 标签顺序，不做任何代码改写（阶段 11 / batch 5 后补丁插件已退役）。
 *
 * Vite 把入口 module script / stylesheet 追加到 <head> 末尾，也就是排在
 * index.html 里 22 个 defer 脚本之后。上游定制要求 Vue 应用先挂载、那些
 * DOM 补丁脚本后跑，所以把这两个标签挪回 <title> 之后。
 * 这是纯 HTML 顺序修正，不是文本补丁：产物 JS 内容完全由 Vite 编译 src/ 得到。
 */
function xcatEntryOrder() {
  return {
    name: "xcat-entry-order",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const scriptRe =
          /<script type="module"[^>]*\bsrc="[^"]*\/assets\/index-[^"]+\.js"[^>]*><\/script>\s*/i;
        const linkRe =
          /<link rel="stylesheet"[^>]*\bhref="[^"]*\/assets\/index-[^"]+\.css"[^>]*>\s*/i;
        const script = html.match(scriptRe)?.[0]?.trim();
        const link = html.match(linkRe)?.[0]?.trim();
        if (!script && !link) return html; // dev server：源码模块，没有 hashed 资源
        const out = html.replace(scriptRe, "").replace(linkRe, "");
        const block = [script, link].filter(Boolean).join("\n  ");
        const anchor = "<title>Infinite-Canvas</title>";
        return out.includes(anchor)
          ? out.replace(anchor, `${anchor}\n  ${block}`)
          : out.replace("<head>", `<head>\n  ${block}`);
      },
    },
  };
}

// 本地开发时接口转发到正在运行的 ComfyUI。
// 默认 127.0.0.1:8188；本机地址写在 frontend/.env.local（已被 git 忽略），不要改这里的默认值
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const COMFYUI_URL = env.COMFYUI_URL || "http://127.0.0.1:8188";

  const proxy = {
    "/infinite_canvas/api": {
      target: COMFYUI_URL,
      changeOrigin: true,
    },
    // 画布素材/产物走 ComfyUI 的 /view（input、output 目录）
    "/view": {
      target: COMFYUI_URL,
      changeOrigin: true,
    },
    // ComfyUI 的进度推送走 /ws，开发服务器必须把 WebSocket 升级一起转发
    "/ws": {
      target: COMFYUI_URL,
      changeOrigin: true,
      ws: true,
    },
    // xcat 脚本 / bundle 直接打同源的 ComfyUI 原生端点（非 /infinite_canvas/api），
    // 少了这几条，dev / preview 里监视器会一直显示 "…"、LoRA 列表也会空。
    "/xxxxxlcat-monitor": { target: COMFYUI_URL, changeOrigin: true },
    "/prompt": { target: COMFYUI_URL, changeOrigin: true },
    "/object_info": { target: COMFYUI_URL, changeOrigin: true },
    "/upload": { target: COMFYUI_URL, changeOrigin: true },
    "/queue": { target: COMFYUI_URL, changeOrigin: true },
    "/history": { target: COMFYUI_URL, changeOrigin: true },
  };

  // ComfyUI 通过 /infinite_canvas/app/ 托管构建产物，base 必须和它一致
  return {
    // 阶段 11 / batch 5：17 组构建期文本补丁已全部退役，产物完全由 src/ 编译得到。
    // xcatEntryOrder 只修正 HTML 标签顺序，不改写任何代码。
    plugins: [vue(), tailwindcss(), xcatEntryOrder()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    base: "/infinite_canvas/app/",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // 产物体积小、同源加载，不需要拆包
      assetsInlineLimit: 4096,
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      proxy,
    },
  };
});
