/*
 * Infinite Canvas — full-screen board entry.
 *
 * Upstream: https://github.com/YangShu2103/ComfyUI-Infinite-Canvas
 * MIT License, © 2026 YangShu2103. Vendored into ComfyUI-XXXXXLCatNodes and
 * trimmed: the upstream floating button (with its drag and position memory) is
 * gone, because the entry now lives in the menu bar — see web/monitor.js. The
 * board page itself (frontend/dist, served at /infinite_canvas/app) is untouched.
 */

import { app } from "/scripts/app.js";

const MODAL_ID = "infinite-canvas-modal";
const STYLE_ID = "infinite-canvas-style";
const LOG = "[Infinite-Canvas]";
const READY_FLAG = "__INFINITE_CANVAS_READY__";
const BRIDGE_NAME = "__XXXXXLCatInfiniteCanvas";

// The Vue build output, served by infinite_canvas/__init__.py.
const PAGE_CANDIDATES = ["/infinite_canvas/app/index.html"];

let resolvedPageUrl = null;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#${MODAL_ID} {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
#${MODAL_ID}.ic-open { display: flex; }
#${MODAL_ID} .ic-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--comfy-menu-bg, #202020);
}
#${MODAL_ID} .ic-frame {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  border: 0;
  background: #181818;
}
`;
    document.head.appendChild(style);
}

function buildModal() {
    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.innerHTML = `
<div class="ic-panel">
  <iframe
    class="ic-frame"
    title="Infinite-Canvas"
    src="about:blank"
    allow="clipboard-write; clipboard-read"
  ></iframe>
</div>`;

    // Clicking the dark margin closes the board, same as upstream.
    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) closeModal();
    });

    document.body.appendChild(overlay);
    return overlay;
}

async function resolvePageUrl() {
    if (resolvedPageUrl) return resolvedPageUrl;
    for (const url of PAGE_CANDIDATES) {
        try {
            const res = await fetch(url, { cache: "no-store" });
            if (res.ok) {
                resolvedPageUrl = url;
                return url;
            }
        } catch {
            // try the next candidate
        }
    }
    resolvedPageUrl = PAGE_CANDIDATES[0];
    return resolvedPageUrl;
}

function openModal() {
    const overlay = document.getElementById(MODAL_ID) || buildModal();
    overlay.classList.add("ic-open");
    const frame = overlay.querySelector(".ic-frame");
    resolvePageUrl().then((url) => {
        // Timestamp defeats the cache so a rebuilt page shows up immediately.
        frame.src = `${url}?t=${Date.now()}`;
    });
}

function closeModal() {
    const overlay = document.getElementById(MODAL_ID);
    if (!overlay) return;
    overlay.classList.remove("ic-open");
    const frame = overlay.querySelector(".ic-frame");
    if (frame) frame.src = "about:blank";
}

function toggleModal() {
    const overlay = document.getElementById(MODAL_ID);
    if (overlay && overlay.classList.contains("ic-open")) closeModal();
    else openModal();
}

function isOpen() {
    const overlay = document.getElementById(MODAL_ID);
    return !!overlay && overlay.classList.contains("ic-open");
}

// The board's own bottom-right menu asks the host page to close the overlay.
window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "infinite-canvas:close") return;
    closeModal();
});

app.registerExtension({
    name: "ComfyUI.InfiniteCanvas.Entry",

    setup() {
        if (window[READY_FLAG]) {
            console.log(LOG, "已初始化，跳过重复注入");
            return;
        }
        window[READY_FLAG] = true;

        injectStyles();
        // The menu-bar button in web/monitor.js talks to the board through this.
        window[BRIDGE_NAME] = {
            open: openModal,
            close: closeModal,
            toggle: toggleModal,
            isOpen,
        };
        // The button may have been clicked before this module finished setup.
        const pending = window.__XXXXXLCatInfiniteCanvasPending;
        if (Array.isArray(pending)) {
            window.__XXXXXLCatInfiniteCanvasPending = [];
            for (const action of pending) {
                if (action === "toggle") toggleModal();
            }
        }
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeModal();
        });

        console.log(LOG, "扩展已启动（入口：菜单栏）");
    },
});
