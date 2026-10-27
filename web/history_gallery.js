// History Gallery 🐈‍⬛ — a sidebar tab that lists every file in ComfyUI's
// output/ tree, not just the ones the Assets panel saw during this session.
//
// Data comes from the read-only endpoint installed by nodes/history_gallery.py
// (`GET /xcat/outputs` + `GET /xcat/outputs/file`). Under --multi-user the
// server scopes the listing to the signed-in account and marks the legacy
// global pool as "shared"; here we only render what it returns.
//
// The panel is plain DOM (no Vue) because custom sidebar tabs are mounted with
// `render(el)`; kept deliberately dependency-free so it works on every
// frontend version that has `app.extensionManager.registerSidebarTab`.

import { app } from "../../scripts/app.js";
import { langCode } from "./i18n.js";

const LIST_URL = "/xcat/outputs";
const FILE_URL = "/xcat/outputs/file";
const TAB_ID = "xcat-output-gallery";
const BATCH = 60;
const CACHE_TTL = 5000;

// ------------------------------------------------------------------ strings

const STRINGS = {
    zh: {
        // Sidebar strip label is deliberately short — the full name would wrap
        // to two lines and push the whole tab column around.
        title: "画廊",
        panelTitle: "历史画廊",
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
        viewMenu: "视图设置",
        viewList: "列表视图",
        viewGridSmall: "网格（小）",
        viewGridLarge: "网格（大）",
        audioFace: "音频",
        threeDFace: "3D 模型",
        play: "播放",
        pause: "暂停",
    },
    en: {
        title: "Gallery",
        panelTitle: "History Gallery",
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
        viewMenu: "View settings",
        viewList: "List view",
        viewGridSmall: "Grid (small)",
        viewGridLarge: "Grid (large)",
        audioFace: "Audio",
        threeDFace: "3D model",
        play: "Play",
        pause: "Pause",
    },
};

// Resolved per call — `langCode()` caches itself once the setting is readable,
// and returns a guess (uncached) while the app is still booting.
const t = (key) => (STRINGS[langCode()] || STRINGS.en)[key] ?? key;

// ------------------------------------------------------------------- icons

// The native Assets panel draws lucide glyphs through CSS masks; inlining the
// same paths keeps the panel identical without depending on the frontend's
// icon utilities being loaded.
const ICON_PATHS = {
    search: "<path d='m21 21l-4.34-4.34'/><circle cx='11' cy='11' r='8'/>",
    settings:
        "<path d='M14 17H5M19 7h-9'/><circle cx='17' cy='17' r='3'/><circle cx='7' cy='7' r='3'/>",
    list: "<path d='M16 5H3m13 7H3m13 7H3M21 5h.01M21 12h.01M21 19h.01'/>",
    gridSmall:
        "<rect width='18' height='18' x='3' y='3' rx='2'/><path d='M3 9h18M3 15h18M9 3v18m6-18v18'/>",
    gridLarge:
        "<rect width='7' height='7' x='3' y='3' rx='1'/><rect width='7' height='7' x='14' y='3' rx='1'/><rect width='7' height='7' x='14' y='14' rx='1'/><rect width='7' height='7' x='3' y='14' rx='1'/>",
    check: "<path d='M20 6L9 17l-5-5'/>",
    refresh: "<path d='M21 12a9 9 0 1 1-2.64-6.36'/><path d='M21 3v6h-6'/>",
    play: "<path d='M7 4v16l13-8z'/>",
    pause:
        "<rect x='14' y='4' width='4' height='16' rx='1'/><rect x='6' y='4' width='4' height='16' rx='1'/>",
    music:
        "<path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/>",
    box: "<path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/>",
    text: "<path d='M17 6.1H3'/><path d='M21 12.1H3'/><path d='M15.1 18H3'/>",
    file: "<path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'/><path d='M14 2v4a2 2 0 0 0 2 2h4'/>",
    image:
        "<rect width='18' height='18' x='3' y='3' rx='2' ry='2'/><circle cx='9' cy='9' r='2'/><path d='m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/>",
    video:
        "<path d='m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5'/><rect x='2' y='6' width='14' height='12' rx='2'/>",
};

function svgIcon(name, cls) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 24 24");
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", "2");
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    el.setAttribute("aria-hidden", "true");
    if (cls) el.setAttribute("class", cls);
    el.innerHTML = ICON_PATHS[name] || "";
    return el;
}

// Mirrors the native panel's three view modes. Kept under our own key so the
// two sidebars can be set independently.
const VIEW_KEY = "xcat.gallery.view";
const VIEW_MODES = ["list", "grid-small", "grid"];

// The chips group the six kinds the way a user thinks about them: 3D models and
// text files are "other" (there is no thumbnail for either).
const FILTER_GROUPS = {
    all: null,
    image: ["image"],
    video: ["video"],
    audio: ["audio"],
    other: ["3d", "text", "other"],
};

function getViewMode() {
    try {
        const v = localStorage.getItem(VIEW_KEY);
        return VIEW_MODES.includes(v) ? v : "grid-small";
    } catch {
        return "grid-small";
    }
}

// getMediaAssetGridColumns() from the frontend source, verbatim.
function gridColumns(mode) {
    const minWidth = mode === "grid-small" ? 128 : 240;
    return `repeat(auto-fill, minmax(min(${minWidth}px, 30vw), 1fr))`;
}


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

// "app.json" → "JSON"; a dot-less name has no format to show.
function fileExt(file) {
    const name = file.filename || "";
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return "";
    return name.slice(dot + 1).toUpperCase();
}

// Waveform peaks for an audio tile. Decoding a whole file into an AudioBuffer is
// the only way to get real amplitudes (that is what the native player does too),
// so the call is gated on visibility and on a size ceiling.
const WAVE_DECODE_LIMIT = 40 * 1024 * 1024;

async function decodeWaveform(file, barList) {
    if ((Number(file.size) || 0) > WAVE_DECODE_LIMIT) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    let ctx;
    try {
        const res = await fetch(fileUrl(file, false), {
            credentials: "same-origin",
        });
        if (!res.ok) return;
        const bytes = await res.arrayBuffer();
        ctx = new Ctor();
        const buffer = await ctx.decodeAudioData(bytes);
        const data = buffer.getChannelData(0);
        if (!data.length) return;

        const peaks = [];
        for (let i = 0; i < barList.length; i += 1) {
            const start = Math.floor((i * data.length) / barList.length);
            const end = Math.max(
                start + 1,
                Math.floor(((i + 1) * data.length) / barList.length)
            );
            let sum = 0;
            for (let j = start; j < end && j < data.length; j += 1) {
                sum += Math.abs(data[j]);
            }
            peaks.push(sum / (end - start));
        }
        const max = Math.max(...peaks) || 1;
        peaks.forEach((peak, i) => {
            barList[i].style.height = `${Math.max(8, (peak / max) * 100)}%`;
        });
    } catch {
        /* codec unsupported or decode failed — keep the placeholder bars */
    } finally {
        try {
            await ctx?.close();
        } catch {
            /* already closed */
        }
    }
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
    /* Native card placeholder fill (bg-modal-card-placeholder-background). */
    --xog-placeholder: var(--secondary-background, color-mix(in srgb, var(--fg-color, #e8e8e8) 10%, transparent));
    /* Native card hover tint: bg-modal-card-background-hovered/20 — the token
       flattened to full opacity would be a solid block, far heavier than the
       official panel's faint lift. */
    --xog-card-hover: color-mix(in oklab, var(--modal-card-background-hovered, var(--secondary-background-hover, #313235)) 20%, transparent);
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
}
.xog-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 64px;
    padding: 0 16px;
    border-bottom: 1px solid var(--xog-line);
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
.xog-btn svg { width: 16px; height: 16px; }
.xog-btn .pi { font-size: 16px; }
.xog-tabs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 16px 1px;
}
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
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: var(--xog-fg);
    pointer-events: none;
}
.xog-search-icon svg { width: 16px; height: 16px; }
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
.xog-viewwrap {
    position: relative;
    flex: none;
}
.xog-viewbtn svg { width: 16px; height: 16px; }
.xog-menu {
    position: absolute;
    top: calc(100% + 8px);
    inset-inline-end: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 142px;
    padding: 8px;
    border: 1px solid var(--border-subtle, var(--border-default, #3c3d42));
    border-radius: 8px;
    background: var(--base-background, var(--comfy-menu-bg, #171718));
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
}
.xog-menu[hidden] { display: none; }
.xog-menu-item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 32px;
    padding: 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--xog-fg);
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    box-sizing: border-box;
    transition: background-color 0.12s ease;
}
.xog-menu-item:hover { background: var(--secondary-background-hover, var(--xog-surface-hover)); }
.xog-menu-item:focus-visible { outline: 1px solid var(--xog-accent); outline-offset: 0; }
.xog-menu-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
}
.xog-menu-label svg { width: 16px; height: 16px; flex: none; }
.xog-menu-check {
    width: 16px;
    height: 16px;
    margin-inline-start: auto;
    flex: none;
}
.xog-menu-item[data-active="false"] .xog-menu-check { opacity: 0; }
.xog-grid {
    display: grid;
    gap: 8px;
    padding: 0 8px 12px;
}
.xog-grid[data-view="list"] { grid-template-columns: minmax(0, 1fr); }
.xog-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    text-align: start;
    overflow: hidden;
    cursor: pointer;
    box-sizing: border-box;
    transition: background-color 0.2s ease;
}
.xog-card:hover { background: var(--xog-card-hover); }
.xog-card:focus-visible { outline: 1px solid var(--xog-accent); outline-offset: 0; }
.xog-thumb {
    position: relative;
    aspect-ratio: 1 / 1;
    width: 100%;
    border-radius: 4px;
    background: var(--xog-placeholder);
    overflow: hidden;
}
/* Native draws video tiles on black so letterboxed frames read as film. */
.xog-thumb[data-kind="video"] { background: #000; }
/* Contain, not cover: the whole picture must be visible along its long edge.
   A 1.05 scale on hover is the native card's only motion. */
.xog-thumb > img,
.xog-thumb > video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    transition: transform 0.3s ease;
}
.xog-fill {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--xog-placeholder);
    color: var(--xog-fg);
    transition: transform 0.3s ease;
}
.xog-fill svg {
    width: 30px;
    height: 30px;
    flex: none;
}
.xog-fill span {
    max-width: 100%;
    padding: 0 8px;
    font-size: 12px;
    line-height: 16px;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-card:hover .xog-thumb > img,
.xog-card:hover .xog-thumb > video,
.xog-card:hover .xog-fill {
    transform: scale(1.05);
}
/* Text cards print a real snippet of the file instead of a glyph. */
.xog-text-body {
    display: none;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 8px;
    box-sizing: border-box;
    color: var(--xog-fg);
    font-family: inherit;
    font-size: 12px;
    line-height: 16px;
    text-align: start;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    overflow: hidden;
    /* The snippet stops mid-line otherwise — fade the last row out instead of
       cutting a glyph in half. */
    mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent);
}
.xog-fill[data-snippet="true"] .xog-text-body { display: block; }
.xog-fill[data-snippet="true"] > svg { display: none; }
.xog-play {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.15);
    color: #fff;
    pointer-events: none;
}
.xog-play svg {
    width: 24px;
    height: 24px;
}
/* Compact audio transport, docked to the bottom of the tile (native
   WaveAudioPlayer in its compact variant, minus the time readout which does
   not fit a 128px cell). */
.xog-wave {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 6px;
}
.xog-wave-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--xog-fg) 15%, transparent);
    color: var(--xog-fg);
    cursor: pointer;
    transition: background-color 0.12s ease;
}
.xog-wave-btn:hover { background: color-mix(in srgb, var(--xog-fg) 25%, transparent); }
.xog-wave-btn svg { width: 12px; height: 12px; }
.xog-wave-bars {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    flex: 1;
    min-width: 0;
    height: 20px;
    cursor: pointer;
}
.xog-wave-bars span {
    flex: 1;
    min-width: 0;
    min-height: 2px;
    border-radius: 9999px;
    background: color-mix(in srgb, var(--xog-fg) 40%, transparent);
}
.xog-wave-bars span[data-played="true"] { background: var(--xog-fg); }
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
    gap: 4px;
    padding: 0;
    min-width: 0;
}
.xog-name {
    display: block;
    color: var(--xog-fg);
    font-size: 14px;
    line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-sub {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--xog-muted);
    font-size: 12px;
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-grid[data-view="list"] .xog-card {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    padding: 8px;
    min-height: 48px;
}
.xog-grid[data-view="list"] .xog-thumb {
    flex: none;
    width: 32px;
    height: 32px;
    aspect-ratio: auto;
    border-radius: 4px;
}
.xog-grid[data-view="list"] .xog-meta {
    flex: 1;
    gap: 4px;
}
.xog-grid[data-view="list"] .xog-name {
    font-size: 12px;
    line-height: 12px;
}
/* A 32px row has no room for a snippet or a transport — glyph only. */
.xog-grid[data-view="list"] .xog-fill svg { width: 14px; height: 14px; }
.xog-grid[data-view="list"] .xog-fill span,
.xog-grid[data-view="list"] .xog-text-body,
.xog-grid[data-view="list"] .xog-wave { display: none; }
.xog-grid[data-view="list"] .xog-fill[data-snippet="true"] > svg { display: block; }
.xog-grid[data-view="list"] .xog-play svg { width: 12px; height: 12px; }
.xog-grid[data-view="list"] .xog-badge {
    inset-block-start: auto;
    inset-block-end: 1px;
    inset-inline-start: 1px;
    padding: 0 2px;
    font-size: 8px;
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
.xog-lb-body pre {
    width: min(1000px, 90vw);
    max-height: 76vh;
    margin: 0;
    padding: 16px;
    box-sizing: border-box;
    overflow: auto;
    color: var(--xog-fg);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 18px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.xog-lb-face {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 48px;
    color: var(--xog-fg);
    font-size: 14px;
}
.xog-lb-face svg { width: 48px; height: 48px; }
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
            } else if (file.kind === "text") {
                node = document.createElement("pre");
                node.textContent = t("loading");
                fetch(url, { credentials: "same-origin" })
                    .then((res) => (res.ok ? res.text() : ""))
                    .then((text) => {
                        node.textContent = text.slice(0, 200000) || file.filename;
                    })
                    .catch(() => {
                        node.textContent = file.filename;
                    });
            } else {
                // 3D models and unknown files have no in-browser preview; show
                // the same glyph the grid tile uses, plus the open/download pair
                // in the header.
                node = document.createElement("div");
                node.className = "xog-lb-face";
                node.appendChild(
                    svgIcon(file.kind === "3d" ? "box" : "file")
                );
                const label = document.createElement("span");
                label.textContent =
                    file.kind === "3d" ? t("threeDFace") : fileExt(file);
                node.appendChild(label);
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
                    <span class="xog-search-icon"></span>
                    <input class="xog-search" type="search" />
                </div>
                <div class="xog-viewwrap">
                    <button class="xog-btn xog-viewbtn" type="button" aria-haspopup="menu" aria-expanded="false"></button>
                    <div class="xog-menu" role="menu" hidden></div>
                </div>
            </div>
        </div>
        <div class="xog-grid"></div>
        <div class="xog-status"></div>
        <div class="xog-sentinel"></div>`;

    host.querySelector(".xog-title").textContent = t("panelTitle");
    const refreshBtn = host.querySelector(".xog-refresh");
    refreshBtn.title = t("refresh");
    refreshBtn.setAttribute("aria-label", t("refresh"));
    refreshBtn.replaceChildren(svgIcon("refresh"));

    const search = host.querySelector(".xog-search");
    search.placeholder = t("search");
    host.querySelector(".xog-search-icon").appendChild(svgIcon("search"));

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

    // View switcher — same trigger (lucide settings-2) and menu entries as the
    // native Assets panel's MediaAssetSettingsMenu.
    const viewBtn = host.querySelector(".xog-viewbtn");
    viewBtn.title = t("viewMenu");
    viewBtn.setAttribute("aria-label", t("viewMenu"));
    viewBtn.appendChild(svgIcon("settings"));

    const menu = host.querySelector(".xog-menu");
    menu.replaceChildren(
        ...[
            { mode: "list", icon: "list", label: "viewList" },
            { mode: "grid-small", icon: "gridSmall", label: "viewGridSmall" },
            { mode: "grid", icon: "gridLarge", label: "viewGridLarge" },
        ].map((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "xog-menu-item";
            btn.dataset.mode = item.mode;
            btn.setAttribute("role", "menuitemradio");
            const label = document.createElement("span");
            label.className = "xog-menu-label";
            const text = document.createElement("span");
            text.textContent = t(item.label);
            label.append(svgIcon(item.icon), text);
            btn.append(label, svgIcon("check", "xog-menu-check"));
            btn.addEventListener("click", () => {
                applyView(item.mode);
                closeViewMenu();
            });
            return btn;
        })
    );

    function openViewMenu() {
        menu.hidden = false;
        viewBtn.setAttribute("aria-expanded", "true");
    }

    function closeViewMenu() {
        menu.hidden = true;
        viewBtn.setAttribute("aria-expanded", "false");
    }

    viewBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (menu.hidden) openViewMenu();
        else closeViewMenu();
    });

    const grid = host.querySelector(".xog-grid");
    const status = host.querySelector(".xog-status");
    const count = host.querySelector(".xog-count");
    const sentinel = host.querySelector(".xog-sentinel");

    const state = { files: [], filter: "all", query: "", matched: [], shown: 0 };

    // Column tracks come from the frontend's own getMediaAssetGridColumns().
    function applyView(mode) {
        grid.dataset.view = mode;
        grid.style.gridTemplateColumns =
            mode === "list" ? "minmax(0, 1fr)" : gridColumns(mode);
        for (const btn of menu.children) {
            btn.dataset.active = String(btn.dataset.mode === mode);
        }
        try {
            localStorage.setItem(VIEW_KEY, mode);
        } catch {
            /* storage disabled — view just won't persist */
        }
        // A different column count changes how many cards fill the first screen.
        fillViewport();
    }

    applyView(getViewMode());

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

    // Heavy per-tile work — decoding an audio waveform, reading a text snippet —
    // waits until the tile is actually on screen. A 500-file grid must not fire
    // 500 downloads the moment it paints.
    const lazy = (() => {
        const jobs = new WeakMap();
        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    io.unobserve(entry.target);
                    const job = jobs.get(entry.target);
                    jobs.delete(entry.target);
                    job?.();
                }
            },
            { root: null, rootMargin: "200px" }
        );
        return {
            run(el, job) {
                jobs.set(el, job);
                io.observe(el);
            },
            stop() {
                io.disconnect();
                jobs.clear?.();
            },
        };
    })();

    // Every non-previewable kind gets the same face the native panel draws:
    // a centred glyph plus (for audio / 3D) a one-word label.
    const FACE_ICON = {
        image: "image",
        video: "video",
        audio: "music",
        "3d": "box",
        text: "text",
        other: "file",
    };
    const FACE_LABEL = { audio: "audioFace", "3d": "threeDFace" };

    function makeFace(kind) {
        const fill = document.createElement("div");
        fill.className = "xog-fill";
        fill.dataset.snippet = "false";
        fill.appendChild(svgIcon(FACE_ICON[kind] || "file"));
        const key = FACE_LABEL[kind];
        if (key) {
            const label = document.createElement("span");
            label.textContent = t(key);
            fill.appendChild(label);
        }
        return fill;
    }

    function addPreviewImage(thumb, file) {
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = file.filename;
        img.src = fileUrl(file, true);
        // Undecodable file (or a preview the server could not build) — show the
        // placeholder face instead of an empty tile.
        img.addEventListener("error", () => {
            img.remove();
            thumb.appendChild(makeFace(file.kind === "video" ? "video" : "image"));
        });
        thumb.appendChild(img);
        return img;
    }

    // A frame from the clip plus the native play scrim. Clicking still opens the
    // player in the lightbox rather than playing in a 128px cell.
    function addVideoThumb(thumb, file) {
        addPreviewImage(thumb, file);
        const play = document.createElement("span");
        play.className = "xog-play";
        play.appendChild(svgIcon("play"));
        thumb.appendChild(play);
    }

    function addAudioThumb(thumb, file) {
        thumb.appendChild(makeFace("audio"));

        const wave = document.createElement("div");
        wave.className = "xog-wave";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "xog-wave-btn";
        btn.title = t("play");
        btn.setAttribute("aria-label", t("play"));
        btn.appendChild(svgIcon("play"));

        const bars = document.createElement("div");
        bars.className = "xog-wave-bars";
        const barList = [];
        for (let i = 0; i < 40; i += 1) {
            const bar = document.createElement("span");
            // Same placeholder heights the native player shows before decoding.
            bar.style.height = `${Math.round(Math.random() * 60) + 10}%`;
            bars.appendChild(bar);
            barList.push(bar);
        }

        const audio = document.createElement("audio");
        audio.preload = "none";
        audio.src = fileUrl(file, false);

        const paint = () => {
            const dur = audio.duration;
            const played =
                dur > 0 ? Math.floor((audio.currentTime / dur) * barList.length) - 1 : -1;
            barList.forEach((bar, i) => {
                bar.dataset.played = String(i <= played);
            });
        };
        const setPlaying = (playing) => {
            btn.replaceChildren(svgIcon(playing ? "pause" : "play"));
            const label = t(playing ? "pause" : "play");
            btn.title = label;
            btn.setAttribute("aria-label", label);
        };

        btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            if (audio.paused) void audio.play().catch(() => setPlaying(false));
            else audio.pause();
        });
        bars.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const rect = bars.getBoundingClientRect();
            if (!audio.duration || !rect.width) return;
            const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
            audio.currentTime = ratio * audio.duration;
            paint();
        });
        audio.addEventListener("play", () => setPlaying(true));
        audio.addEventListener("pause", () => setPlaying(false));
        audio.addEventListener("ended", () => setPlaying(false));
        audio.addEventListener("timeupdate", paint);

        // The transport lives inside the card, so its presses must not open the
        // lightbox.
        wave.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        wave.addEventListener("click", (ev) => ev.stopPropagation());
        wave.append(btn, bars);
        thumb.appendChild(wave);
        thumb.appendChild(audio);

        lazy.run(thumb, () => void decodeWaveform(file, barList));
    }

    // Text files print their opening lines, exactly like the native panel's
    // MediaTextTop (first 1000 characters).
    function addTextThumb(thumb, file) {
        const fill = makeFace("text");
        const body = document.createElement("p");
        body.className = "xog-text-body";
        fill.appendChild(body);
        thumb.appendChild(fill);

        lazy.run(thumb, async () => {
            try {
                const res = await fetch(fileUrl(file, true), {
                    credentials: "same-origin",
                });
                if (!res.ok) return;
                const text = (await res.text()).slice(0, 1000).trim();
                if (!text) return;
                body.textContent = text;
                fill.dataset.snippet = "true";
            } catch {
                /* keep the glyph */
            }
        });
    }

    function makeCard(file) {
        const card = document.createElement("div");
        card.className = "xog-card";
        // Native cards show format + size only; the tile is too narrow for a
        // timestamp, so it lives in the tooltip with the full path.
        card.title = `${relPath(file)} · ${fmtTime(file.mtime)}`;
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", file.filename);

        const thumb = document.createElement("div");
        thumb.className = "xog-thumb";
        thumb.dataset.kind = file.kind || "other";

        if (file.kind === "image") {
            addPreviewImage(thumb, file);
        } else if (file.kind === "video") {
            addVideoThumb(thumb, file);
        } else if (file.kind === "audio") {
            addAudioThumb(thumb, file);
        } else if (file.kind === "text") {
            addTextThumb(thumb, file);
        } else {
            // 3D models and unknown files are not previewable here — same face
            // the native panel falls back to.
            thumb.appendChild(makeFace(file.kind === "3d" ? "3d" : "other"));
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
        // Size + timestamp: the extension is already visible in the filename and
        // a third field would push the line past the tile width.
        sub.textContent = `${fmtSize(file.size)} · ${fmtTime(file.mtime)}`;
        meta.append(name, sub);

        const open = () => ensureLightbox().open(file);
        card.append(thumb, meta);
        card.addEventListener("click", open);
        card.addEventListener("keydown", (ev) => {
            if (ev.key !== "Enter" && ev.key !== " ") return;
            ev.preventDefault();
            open();
        });
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
        const group = FILTER_GROUPS[state.filter];
        state.matched = state.files.filter((file) => {
            if (group && !group.includes(file.kind)) return false;
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

    // Dismiss the view menu the way the native popover does: outside press, Esc,
    // or picking an entry.
    const onDocDown = (ev) => {
        if (menu.hidden) return;
        if (menu.contains(ev.target) || viewBtn.contains(ev.target)) return;
        closeViewMenu();
    };
    const onDocKey = (ev) => {
        if (ev.key === "Escape" && !menu.hidden) closeViewMenu();
    };
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onDocKey);

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

    return () => {
        observer.disconnect();
        lazy.stop();
        document.removeEventListener("pointerdown", onDocDown, true);
        document.removeEventListener("keydown", onDocKey);
    };
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

// The tab button renders `tab.title` / `tab.tooltip` as plain strings, and this
// frontend switches language **in place** — no page reload, so nothing re-runs
// our registration and a captured string would stay in the old language for the
// rest of the session (core tabs look fine because theirs are i18n keys resolved
// lazily). Publish both labels as accessors instead: the tab strip re-renders on
// a locale change and reads them again, so the button follows the language with
// no polling and no timers.
function bindLiveLabels(tab) {
    const bind = (key, read) => {
        Object.defineProperty(tab, key, {
            configurable: true,
            enumerable: true,
            get: read,
            // The core may write the field back when re-registering; swallow it
            // so the accessor survives instead of being replaced by a string.
            set() {},
        });
    };
    bind("title", () => t("title"));
    bind("tooltip", () => t("tooltip"));
}

function registerTab() {
    const manager = app?.extensionManager;
    if (!manager || typeof manager.registerSidebarTab !== "function") return false;
    const tabs = sidebarTabArray();
    const existing = tabs?.find((tab) => tab?.id === TAB_ID);
    if (existing) {
        // Another load of this extension beat us to it — make sure its labels
        // still resolve through the current language.
        bindLiveLabels(existing);
        placeAboveAssets();
        return true;
    }

    let cleanup = null;
    const spec = {
        id: TAB_ID,
        icon: "pi pi-images",
        title: "",
        tooltip: "",
        type: "custom",
        render: (el) => {
            cleanup?.();
            cleanup = buildPanel(el);
        },
        destroy: () => {
            cleanup?.();
            cleanup = null;
        },
    };
    bindLiveLabels(spec);
    manager.registerSidebarTab(spec);
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
