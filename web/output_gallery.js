// Output Gallery 🐈‍⬛ — a sidebar tab that lists every file in ComfyUI's
// output/ tree, not just the ones the Assets panel saw during this session.
//
// Data comes from the read-only endpoint installed by nodes/output_gallery.py
// (`GET /xcat/outputs` + `GET /xcat/outputs/file`). Under --multi-user the
// server scopes the listing to the signed-in account and marks the legacy
// global pool as "shared"; here we only render what it returns.
//
// The panel is plain DOM (no Vue) because custom sidebar tabs are mounted with
// `render(el)`; kept deliberately dependency-free so it works on every
// frontend version that has `app.extensionManager.registerSidebarTab`.

import { app } from "../../scripts/app.js";

const LIST_URL = "/xcat/outputs";
const FILE_URL = "/xcat/outputs/file";
const TAB_ID = "xcat-output-gallery";
const BATCH = 60;
const CACHE_TTL = 5000;

// ------------------------------------------------------------------ strings

const STRINGS = {
    zh: {
        title: "输出画廊",
        tooltip: "浏览 output 目录里的所有文件",
        all: "全部",
        image: "图片",
        video: "视频",
        audio: "音频",
        other: "其他",
        search: "搜索文件名…",
        refresh: "刷新",
        shared: "共享",
        files: "个文件",
        showing: "显示前",
        empty: "这里还没有文件",
        emptyHint: "生成或上传文件后会显示在这里",
        noMatch: "没有符合条件的文件",
        loading: "读取中…",
        unauthorized: "登录已过期，请重新登录",
        failed: "读取失败",
        open: "打开原文件",
        download: "下载",
        close: "关闭",
        loadingMore: "继续滚动加载…",
    },
    en: {
        title: "Output Gallery",
        tooltip: "Browse every file in the output directory",
        all: "All",
        image: "Images",
        video: "Videos",
        audio: "Audio",
        other: "Other",
        search: "Search filename…",
        refresh: "Refresh",
        shared: "Shared",
        files: "files",
        showing: "showing first",
        empty: "No files here yet",
        emptyHint: "Generated or uploaded files will show up here",
        noMatch: "No matching files",
        loading: "Loading…",
        unauthorized: "Session expired — sign in again",
        failed: "Failed to load",
        open: "Open in new tab",
        download: "Download",
        close: "Close",
        loadingMore: "Scroll for more…",
    },
};

let _lang = null;
function lang() {
    if (_lang) return _lang;
    try {
        const stored = localStorage.getItem("Comfy.Locale") || "";
        const nav = navigator.language || "";
        const probe = (stored || nav || document.documentElement.lang || "en").toLowerCase();
        _lang = probe.startsWith("zh") ? "zh" : "en";
    } catch {
        _lang = "en";
    }
    return _lang;
}
const t = (key) => (STRINGS[lang()] || STRINGS.en)[key] ?? key;

// ------------------------------------------------------------------ helpers

function fmtSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = n / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function fmtTime(ts) {
    const d = new Date((Number(ts) || 0) * 1000);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const pad = (v) => String(v).padStart(2, "0");
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return sameYear
        ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
        : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fileUrl(file, preview) {
    const params = new URLSearchParams({
        scope: file.scope || "all",
        subfolder: file.subfolder || "",
        filename: file.filename || "",
    });
    if (preview) params.set("preview", "1");
    return `${FILE_URL}?${params.toString()}`;
}

function relPath(file) {
    return file.subfolder ? `${file.subfolder}/${file.filename}` : file.filename;
}

// ------------------------------------------------------------------ styles

const CSS = `
.xog {
    --xog-fg: var(--text-primary, var(--fg-color, #e8e8e8));
    --xog-muted: var(--text-secondary, color-mix(in srgb, var(--fg-color, #e8e8e8) 62%, transparent));
    --xog-line: var(--interface-stroke, color-mix(in srgb, var(--fg-color, #e8e8e8) 18%, transparent));
    --xog-surface: var(--secondary-background, var(--comfy-input-bg, rgba(127, 127, 127, 0.14)));
    --xog-surface-hover: var(--secondary-background-hover, rgba(127, 127, 127, 0.22));
    --xog-tab-active: var(--interface-menu-component-surface-hovered, rgba(127, 127, 127, 0.22));
    --xog-accent: var(--border-default, var(--p-primary-color, #4a9eff));
    display: flex;
    flex-direction: column;
    gap: 0;
    min-height: 100%;
    padding: 0;
    box-sizing: border-box;
    color: var(--xog-fg);
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;
}
.xog-bar {
    position: sticky;
    top: 0;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 0;
    background: var(--comfy-menu-bg, var(--bg-color, #171718));
    border-bottom: 1px solid var(--xog-line);
}
.xog-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 64px;
    padding: 0 16px;
}
.xog-title {
    flex: 1;
    min-width: 0;
    color: var(--xog-fg);
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-count {
    flex: none;
    color: var(--xog-muted);
    font-size: 12px;
    white-space: nowrap;
}
.xog-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: none;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: var(--xog-surface);
    color: var(--xog-fg);
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
}
.xog-btn:hover { background: var(--xog-surface-hover); }
.xog-btn:focus-visible { outline: 1px solid var(--xog-accent); outline-offset: 0; }
.xog-btn .pi { font-size: 16px; }
.xog-tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 1px;
    overflow-x: auto;
    scrollbar-width: none;
}
.xog-tabs::-webkit-scrollbar { display: none; }
.xog-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--xog-muted);
    font-family: inherit;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
}
.xog-chip:hover { background: var(--button-hover-surface, var(--xog-surface)); }
.xog-chip[data-active="true"] {
    background: var(--xog-tab-active);
    color: var(--xog-fg);
}
.xog-searchrow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
}
.xog-searchbox {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 6px 8px;
    border-radius: 8px;
    background: var(--xog-surface);
    box-sizing: border-box;
}
.xog-searchbox:focus-within { box-shadow: inset 0 0 0 1px var(--xog-accent); }
.xog-search-icon {
    position: absolute;
    inset-inline-start: 10px;
    color: var(--xog-muted);
    font-size: 16px;
    pointer-events: none;
}
.xog-search {
    width: 100%;
    height: 100%;
    min-width: 0;
    padding: 0;
    padding-inline-start: 32px;
    border: none;
    background: transparent;
    color: var(--xog-fg);
    font-family: inherit;
    font-size: 12px;
    outline: none;
}
.xog-search::placeholder { color: var(--xog-muted); }
.xog-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 8px;
    padding: 16px;
}
.xog-card {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 8px;
    background: var(--xog-surface);
    color: inherit;
    font-family: inherit;
    text-align: start;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.12s ease;
}
.xog-card:hover { border-color: var(--xog-accent); }
.xog-card:focus-visible { outline: 1px solid var(--xog-accent); outline-offset: 0; }
.xog-thumb {
    position: relative;
    aspect-ratio: 1 / 1;
    width: 100%;
    background: color-mix(in srgb, var(--xog-fg) 8%, transparent);
    overflow: hidden;
}
.xog-thumb img,
.xog-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}
.xog-glyph {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--xog-muted);
}
.xog-glyph .pi { font-size: 24px; }
.xog-badge {
    position: absolute;
    inset-block-start: 4px;
    inset-inline-start: 4px;
    padding: 0 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.62);
    color: #f2f2f2;
    font-size: 11px;
    line-height: 16px;
}
.xog-meta {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px 8px;
    min-width: 0;
}
.xog-name {
    display: block;
    color: var(--xog-fg);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-sub {
    display: block;
    color: var(--xog-muted);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-status {
    padding: 24px 16px;
    color: var(--xog-muted);
    font-size: 14px;
    text-align: center;
}
.xog-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 16px;
    color: var(--xog-fg);
    text-align: center;
}
.xog-empty .pi {
    margin-bottom: 16px;
    font-size: 48px;
}
.xog-empty h3 {
    margin: 0 0 8px;
    color: var(--xog-fg);
    font-size: 18px;
    font-weight: 700;
}
.xog-empty p {
    margin: 0;
    color: var(--xog-fg);
    font-size: 16px;
}
.xog-sentinel { height: 1px; }

.xog-lb {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.72);
    box-sizing: border-box;
}
.xog-lb[hidden] { display: none; }
.xog-lb-panel {
    display: flex;
    flex-direction: column;
    max-width: min(1100px, 94vw);
    max-height: 92vh;
    border: 1px solid var(--xog-line);
    border-radius: 8px;
    background: var(--comfy-menu-bg, var(--dialog-surface, #171718));
    color: var(--xog-fg);
    overflow: hidden;
    font-family: inherit;
    font-size: 14px;
}
.xog-lb-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 64px;
    padding: 0 16px;
    border-bottom: 1px solid var(--xog-line);
}
.xog-lb-name {
    flex: 1;
    min-width: 0;
    color: var(--xog-fg);
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-lb-actions { display: flex; gap: 8px; }
.xog-lb-body {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d0d;
    min-width: 260px;
    min-height: 120px;
    overflow: auto;
}
.xog-lb-body img,
.xog-lb-body video {
    display: block;
    max-width: min(1000px, 90vw);
    max-height: 76vh;
    object-fit: contain;
}
.xog-lb-body audio { width: min(480px, 80vw); margin: 24px; }
.xog-lb-foot {
    padding: 8px 16px;
    border-top: 1px solid var(--xog-line);
    color: var(--xog-muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog ::-webkit-scrollbar { width: 8px; height: 8px; }
.xog ::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--xog-fg) 24%, transparent);
    border-radius: 4px;
}
.xog ::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--xog-fg) 38%, transparent);
}
.xog ::-webkit-scrollbar-track { background: transparent; }
`;

function ensureStyle() {
    if (document.getElementById("xog-style")) return;
    const style = document.createElement("style");
    style.id = "xog-style";
    style.textContent = CSS;
    document.head.appendChild(style);
}

// ------------------------------------------------------------------ lightbox

let lightbox = null;

function ensureLightbox() {
    if (lightbox) return lightbox;
    ensureStyle();

    const el = document.createElement("div");
    el.className = "xog-lb";
    el.hidden = true;
    el.innerHTML = `
        <div class="xog-lb-panel">
            <div class="xog-lb-head">
                <span class="xog-lb-name"></span>
                <div class="xog-lb-actions">
                    <button class="xog-btn xog-lb-open" type="button"></button>
                    <button class="xog-btn xog-lb-download" type="button"></button>
                    <button class="xog-btn xog-lb-close" type="button"></button>
                </div>
            </div>
            <div class="xog-lb-body"></div>
            <div class="xog-lb-foot"></div>
        </div>`;
    document.body.appendChild(el);

    const openBtn = el.querySelector(".xog-lb-open");
    const downloadBtn = el.querySelector(".xog-lb-download");
    const closeBtn = el.querySelector(".xog-lb-close");
    openBtn.title = t("open");
    openBtn.innerHTML = '<i class="pi pi-external-link"></i>';
    downloadBtn.title = t("download");
    downloadBtn.innerHTML = '<i class="pi pi-download"></i>';
    closeBtn.title = t("close");
    closeBtn.innerHTML = '<i class="pi pi-times"></i>';

    const close = () => {
        el.hidden = true;
        el.querySelector(".xog-lb-body").replaceChildren();
    };
    closeBtn.addEventListener("click", close);
    el.addEventListener("click", (ev) => {
        if (ev.target === el) close();
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !el.hidden) close();
    });

    lightbox = {
        el,
        open(file) {
            const url = fileUrl(file, false);
            el.querySelector(".xog-lb-name").textContent = file.filename || "";
            el.querySelector(".xog-lb-foot").textContent =
                `${relPath(file)} · ${fmtSize(file.size)} · ${fmtTime(file.mtime)}`;

            const body = el.querySelector(".xog-lb-body");
            body.replaceChildren();
            let node;
            if (file.kind === "image") {
                node = document.createElement("img");
                node.src = url;
                node.alt = file.filename || "";
            } else if (file.kind === "video") {
                node = document.createElement("video");
                node.src = url;
                node.controls = true;
                node.autoplay = true;
                node.loop = true;
                node.playsInline = true;
            } else if (file.kind === "audio") {
                node = document.createElement("audio");
                node.src = url;
                node.controls = true;
                node.autoplay = true;
            } else {
                node = document.createElement("div");
                node.className = "xog-status";
                node.textContent = t("open");
            }
            body.appendChild(node);

            openBtn.onclick = () => window.open(url, "_blank", "noopener");
            downloadBtn.onclick = () => {
                const a = document.createElement("a");
                a.href = url;
                a.download = file.filename || "download";
                document.body.appendChild(a);
                a.click();
                a.remove();
            };
            el.hidden = false;
        },
    };
    return lightbox;
}

// ------------------------------------------------------------------ panel

// Last manifest, so switching tabs repaints instantly instead of flashing.
let cache = { at: 0, data: null };

function buildPanel(host) {
    ensureStyle();
    host.classList.add("xog");

    host.innerHTML = `
        <div class="xog-bar">
            <div class="xog-head">
                <span class="xog-title"></span>
                <span class="xog-count"></span>
                <button class="xog-btn xog-refresh" type="button"></button>
            </div>
            <div class="xog-tabs"></div>
            <div class="xog-searchrow">
                <div class="xog-searchbox">
                    <i class="pi pi-search xog-search-icon"></i>
                    <input class="xog-search" type="search" />
                </div>
            </div>
        </div>
        <div class="xog-grid"></div>
        <div class="xog-status"></div>
        <div class="xog-sentinel"></div>`;

    host.querySelector(".xog-title").textContent = t("title");
    const refreshBtn = host.querySelector(".xog-refresh");
    refreshBtn.title = t("refresh");
    refreshBtn.setAttribute("aria-label", t("refresh"));
    refreshBtn.innerHTML = '<i class="pi pi-refresh"></i>';

    const search = host.querySelector(".xog-search");
    search.placeholder = t("search");

    const filters = host.querySelector(".xog-tabs");
    const kinds = ["all", "image", "video", "audio", "other"];
    filters.replaceChildren(
        ...kinds.map((kind) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "xog-chip";
            btn.dataset.kind = kind;
            btn.dataset.active = String(kind === "all");
            btn.textContent = t(kind);
            return btn;
        })
    );

    const grid = host.querySelector(".xog-grid");
    const status = host.querySelector(".xog-status");
    const count = host.querySelector(".xog-count");
    const sentinel = host.querySelector(".xog-sentinel");

    const state = { files: [], filter: "all", query: "", matched: [], shown: 0 };

    function setStatus(text) {
        status.replaceChildren();
        status.textContent = text || "";
        status.style.display = text ? "" : "none";
    }

    // Mirrors the native Assets panel's empty state: big info glyph, heading,
    // one-line hint.
    function setEmpty() {
        const box = document.createElement("div");
        box.className = "xog-empty";
        const icon = document.createElement("i");
        icon.className = "pi pi-info-circle";
        const heading = document.createElement("h3");
        heading.textContent = t("empty");
        const hint = document.createElement("p");
        hint.textContent = t("emptyHint");
        box.append(icon, heading, hint);
        status.replaceChildren(box);
        status.style.display = "";
    }

    function makeCard(file) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "xog-card";
        card.title = relPath(file);

        const thumb = document.createElement("div");
        thumb.className = "xog-thumb";

        if (file.kind === "image") {
            const img = document.createElement("img");
            img.loading = "lazy";
            img.decoding = "async";
            img.alt = file.filename;
            img.src = fileUrl(file, true);
            thumb.appendChild(img);
        } else {
            const glyph = document.createElement("div");
            glyph.className = "xog-glyph";
            const icon = document.createElement("i");
            icon.className =
                file.kind === "video"
                    ? "pi pi-video"
                    : file.kind === "audio"
                      ? "pi pi-volume-up"
                      : "pi pi-file";
            glyph.appendChild(icon);
            thumb.appendChild(glyph);
        }

        if (file.scope === "shared") {
            const badge = document.createElement("span");
            badge.className = "xog-badge";
            badge.textContent = t("shared");
            thumb.appendChild(badge);
        }

        const meta = document.createElement("div");
        meta.className = "xog-meta";
        const name = document.createElement("span");
        name.className = "xog-name";
        name.textContent = file.filename;
        const sub = document.createElement("span");
        sub.className = "xog-sub";
        sub.textContent = `${fmtSize(file.size)} · ${fmtTime(file.mtime)}`;
        meta.append(name, sub);

        card.append(thumb, meta);
        card.addEventListener("click", () => ensureLightbox().open(file));
        return card;
    }

    function renderNext() {
        if (state.shown >= state.matched.length) {
            if (state.matched.length > 0) setStatus("");
            return;
        }
        const slice = state.matched.slice(state.shown, state.shown + BATCH);
        const frag = document.createDocumentFragment();
        for (const file of slice) frag.appendChild(makeCard(file));
        grid.appendChild(frag);
        state.shown += slice.length;
        if (state.shown >= state.matched.length) setStatus("");
    }

    // A tall sidebar can show more than one batch at once; the IntersectionObserver
    // only fires on transitions, so top up until the sentinel is safely below the
    // fold (or everything is rendered).
    function fillViewport() {
        for (let guard = 0; guard < 40; guard += 1) {
            if (state.shown >= state.matched.length) break;
            if (sentinel.getBoundingClientRect().top > window.innerHeight + 300) break;
            renderNext();
        }
    }

    function applyFilter() {
        const q = state.query.trim().toLowerCase();
        state.matched = state.files.filter((file) => {
            if (state.filter !== "all" && file.kind !== state.filter) return false;
            if (!q) return true;
            return `${file.subfolder || ""}/${file.filename}`.toLowerCase().includes(q);
        });
        state.shown = 0;
        grid.replaceChildren();

        if (state.matched.length === 0) {
            if (state.files.length === 0) setEmpty();
            else setStatus(t("noMatch"));
        } else {
            setStatus("");
        }
        renderNext();
        fillViewport();
    }

    function paintCount() {
        const total = cache.data?.total ?? state.files.length;
        const shown = state.matched.length;
        let text = `${shown} / ${total} ${t("files")}`;
        if (cache.data?.truncated) text += ` (${t("showing")} ${state.files.length})`;
        count.textContent = text;
    }

    async function load() {
        count.textContent = "";
        if (!state.files.length) setStatus(t("loading"));
        try {
            const res = await fetch(LIST_URL, {
                cache: "no-store",
                credentials: "same-origin",
            });
            if (res.status === 401) {
                setStatus(t("unauthorized"));
                return;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            cache = { at: Date.now(), data };
            state.files = Array.isArray(data.files) ? data.files : [];
            applyFilter();
            paintCount();
        } catch (err) {
            setStatus(`${t("failed")}: ${err?.message || err}`);
        }
    }

    // Infinite scroll: pull the next batch when the sentinel enters the viewport.
    const observer = new IntersectionObserver(
        (entries) => {
            if (!entries.some((e) => e.isIntersecting)) return;
            if (state.shown < state.matched.length) {
                renderNext();
                fillViewport();
            }
        },
        { root: null, rootMargin: "200px" }
    );
    observer.observe(sentinel);

    refreshBtn.addEventListener("click", () => {
        cache = { at: 0, data: null };
        load();
    });

    search.addEventListener("input", () => {
        state.query = search.value;
        applyFilter();
        paintCount();
    });

    filters.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".xog-chip");
        if (!btn) return;
        state.filter = btn.dataset.kind || "all";
        for (const chip of filters.children) {
            chip.dataset.active = String(chip === btn);
        }
        applyFilter();
        paintCount();
    });

    // Warm-start from the previous fetch, then revalidate in the background.
    if (cache.data && Date.now() - cache.at < CACHE_TTL) {
        state.files = Array.isArray(cache.data.files) ? cache.data.files : [];
        applyFilter();
        paintCount();
        load();
    } else {
        load();
    }

    return () => observer.disconnect();
}

// ------------------------------------------------------------------ register

// Sit just above the "Assets" tab. Core exposes the tab list as a reactive
// array, so splicing it re-renders the icon strip — no core patching involved.
function sidebarTabArray() {
    const manager = app?.extensionManager;
    const ref = manager?.getSidebarTabs?.();
    const tabs = Array.isArray(ref) ? ref : ref?.value || manager?.sidebarTab?.sidebarTabs;
    return Array.isArray(tabs) ? tabs : null;
}

function placeAboveAssets() {
    const tabs = sidebarTabArray();
    if (!tabs) return false;
    const from = tabs.findIndex((tab) => tab?.id === TAB_ID);
    const anchor = tabs.findIndex((tab) => tab?.id === "assets");
    if (from < 0) return false;
    // No Assets tab (very old frontend) — keep the default append position.
    if (anchor < 0 || from === anchor - 1) return true;
    const [mine] = tabs.splice(from, 1);
    // Removing a tab above the anchor shifts the anchor down by one.
    tabs.splice(from < anchor ? anchor - 1 : anchor, 0, mine);
    return true;
}

function registerTab() {
    const manager = app?.extensionManager;
    if (!manager || typeof manager.registerSidebarTab !== "function") return false;
    const tabs = sidebarTabArray();
    if (tabs && tabs.some((tab) => tab?.id === TAB_ID)) {
        placeAboveAssets();
        return true;
    }

    let cleanup = null;
    manager.registerSidebarTab({
        id: TAB_ID,
        icon: "pi pi-images",
        title: t("title"),
        tooltip: t("tooltip"),
        type: "custom",
        render: (el) => {
            cleanup?.();
            cleanup = buildPanel(el);
        },
        destroy: () => {
            cleanup?.();
            cleanup = null;
        },
    });
    placeAboveAssets();
    // Extensions load in folder-name order, so a tab registered later could
    // still land above us — re-assert the slot once the dust settles.
    setTimeout(placeAboveAssets, 1000);
    return true;
}

app.registerExtension({
    name: "XXXXXLCat.OutputGallery",
    async setup() {
        if (registerTab()) return;
        // Older/lazier boot orders may not have the manager yet — retry briefly.
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (registerTab() || tries > 40) clearInterval(timer);
        }, 250);
    },
});
