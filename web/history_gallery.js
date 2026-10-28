// History Gallery 🐈‍⬛ — a sidebar tab that lists every file in the account's
// output/ and input/ trees, not just the ones the Assets panel saw this session.
//
// Data comes from nodes/history_gallery.py:
//   GET  /xcat/gallery         manifest (each entry carries its own signed URLs)
//   GET  /xcat/gallery/file    the file itself, or a thumbnail with preview=1
//   POST /xcat/gallery/zip     multi-file download as a single archive
//   POST /xcat/gallery/delete  removes the files from disk
// Under --multi-user the server scopes everything to the signed-in account.
//
// Layout and interaction are ported from the native Assets panel — read those
// sources rather than guessing:
//   AssetsSidebarTab.vue       output/input TabList, empty-space deselect,
//                              marquee rectangle teleported to <body>, context
//                              menu opened with show(event) i.e. at the pointer
//   MediaAssetCard.vue         preview click selects, dblclick zooms, and the
//                              hover-only check / download / ellipsis controls
//   MediaAssetSelectionBar.vue floating bar: x / N selected / download / delete
//   useAssetSelection.ts       shift range, ctrl toggle, plain click collapse
//   useAssetGridSelection.ts   4px threshold, rectsIntersect, suppressNextClick
//   marqueeSelectionUtil.ts    normalise + intersect helpers
//
// The panel is plain DOM (no Vue) because custom sidebar tabs are mounted with
// `render(el)`; kept deliberately dependency-free so it works on every
// frontend version that has `app.extensionManager.registerSidebarTab`.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { langCode } from "./i18n.js";

const LIST_URL = "/xcat/gallery";
const ZIP_URL = "/xcat/gallery/zip";
const DELETE_URL = "/xcat/gallery/delete";
const TAB_ID = "xcat-history-gallery";
const BATCH = 60;
const CACHE_TTL = 5000;

// ------------------------------------------------------------------ strings

const STRINGS = {
    zh: {
        // Sidebar strip label is deliberately short — the full name would wrap
        // to two lines and push the whole tab column around.
        title: "画廊",
        panelTitle: "历史画廊",
        tooltip: "浏览 output 与 input 目录里的所有文件",
        tabOutput: "已生成",
        tabInput: "已导入",
        all: "全部",
        image: "图片",
        video: "视频",
        audio: "音频",
        other: "其他",
        // Native panel builds this as `搜索 {subject}...` — the space is part
        // of the official wording, not a typo.
        search: "搜索 文件名…",
        refresh: "刷新",
        files: "个文件",
        empty: "这里还没有文件",
        noMatch: "没有符合条件的文件",
        loading: "读取中…",
        unauthorized: "登录已过期，请重新登录",
        failed: "读取失败",
        open: "打开原文件",
        close: "关闭",
        viewMenu: "查看设置",
        viewList: "列表视图",
        viewGridSmall: "网格（小）",
        viewGridLarge: "网格（大）",
        audioFace: "音频",
        threeDFace: "3D 模型",
        play: "播放",
        pause: "暂停",
        // Actions below mirror mediaAsset.actions / mediaAsset.selection in the
        // official locale pack, so both panels use the same wording.
        inspect: "查看资产",
        download: "下载",
        moreOptions: "更多选项",
        delete: "删除",
        multipleSelected: "已选择多个资源",
        downloadAll: "全部下载",
        deleteAll: "全部删除",
        deselectAll: "取消全选",
        selectedCount: "已选择资产：{count}",
        deleteItems: "删除这些项目",
        deletePermanent: "它们将被永久移除。",
        cancel: "取消",
        deleteFailed: "删除失败",
    },
    en: {
        title: "Gallery",
        panelTitle: "History Gallery",
        tooltip: "Browse every file in the output and input directories",
        tabOutput: "Generated",
        tabInput: "Imported",
        all: "All",
        image: "Images",
        video: "Videos",
        audio: "Audio",
        other: "Other",
        search: "Search filename…",
        refresh: "Refresh",
        files: "files",
        empty: "No files here yet",
        noMatch: "No matching files",
        loading: "Loading…",
        unauthorized: "Session expired — sign in again",
        failed: "Failed to load",
        open: "Open in new tab",
        close: "Close",
        viewMenu: "View settings",
        viewList: "List view",
        viewGridSmall: "Grid (small)",
        viewGridLarge: "Grid (large)",
        audioFace: "Audio",
        threeDFace: "3D model",
        play: "Play",
        pause: "Pause",
        inspect: "Inspect asset",
        download: "Download",
        moreOptions: "More options",
        delete: "Delete",
        multipleSelected: "Multiple assets selected",
        downloadAll: "Download all",
        deleteAll: "Delete all",
        deselectAll: "Deselect all",
        selectedCount: "Selected assets: {count}",
        deleteItems: "Delete these items",
        deletePermanent: "They will be permanently removed.",
        cancel: "Cancel",
        deleteFailed: "Delete failed",
    },
};

// Resolved per call — `langCode()` caches itself once the setting is readable,
// and returns a guess (uncached) while the app is still booting.
const t = (key) => (STRINGS[langCode()] || STRINGS.en)[key] ?? key;

// ------------------------------------------------------------------- icons

// Same lucide glyphs the native panel draws, extracted from the frontend
// package (stroke rewritten to currentColor so they inherit the theme colour).
const ICON_PATHS = {
    search: "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='m21 21l-4.34-4.34'/><circle cx='11' cy='11' r='8'/></g>",
    settings:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='M14 17H5M19 7h-9'/><circle cx='17' cy='17' r='3'/><circle cx='7' cy='7' r='3'/></g>",
    list: "<path fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M16 5H3m13 7H3m13 7H3M21 5h.01M21 12h.01M21 19h.01'/>",
    gridSmall:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><rect width='18' height='18' x='3' y='3' rx='2'/><path d='M3 9h18M3 15h18M9 3v18m6-18v18'/></g>",
    gridLarge:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><rect width='7' height='7' x='3' y='3' rx='1'/><rect width='7' height='7' x='14' y='3' rx='1'/><rect width='7' height='7' x='14' y='14' rx='1'/><rect width='7' height='7' x='3' y='14' rx='1'/></g>",
    check: "<path fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M20 6L9 17l-5-5'/>",
    refresh:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8'/><path d='M21 3v5h-5m5 4a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16'/><path d='M8 16H3v5'/></g>",
    play: "<path fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'/>",
    pause:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><rect width='5' height='18' x='14' y='3' rx='1'/><rect width='5' height='18' x='5' y='3' rx='1'/></g>",
    music:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='M9 18V5l12-2v13'/><circle cx='6' cy='18' r='3'/><circle cx='18' cy='16' r='3'/></g>",
    box: "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'/><path d='m3.3 7l8.7 5l8.7-5M12 22V12'/></g>",
    text: "<path d='M17 6.1H3'/><path d='M21 12.1H3'/><path d='M15.1 18H3'/>",
    file: "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'/><path d='M14 2v5a1 1 0 0 0 1 1h5'/></g>",
    image:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><rect width='18' height='18' x='3' y='3' rx='2' ry='2'/><circle cx='9' cy='9' r='2'/><path d='m21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21'/></g>",
    video:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='m16 13l5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5'/><rect width='14' height='12' x='2' y='6' rx='2'/></g>",
    download:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><path d='M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><path d='m7 10l5 5l5-5'/></g>",
    trash:
        "<path fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/>",
    x: "<path fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M18 6L6 18M6 6l12 12'/>",
    zoomIn:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><circle cx='11' cy='11' r='8'/><path d='m21 21l-4.35-4.35M11 8v6m-3-3h6'/></g>",
    ellipsis:
        "<g fill='none' stroke='currentColor' stroke-linecap='round' stroke-linejoin='round' stroke-width='2'><circle cx='12' cy='12' r='1'/><circle cx='19' cy='12' r='1'/><circle cx='5' cy='12' r='1'/></g>",
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

// Marquee constants, straight from useAssetGridSelection.ts.
const DRAG_THRESHOLD_PX = 4;
const CARD_SELECTOR = "[data-asset-id]";
const INTERACTIVE_SELECTOR =
    'button, input, textarea, select, a[href], [role="slider"], [role="tab"], [contenteditable]';

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

function fmtCount(template, count) {
    return String(template).replace("{count}", String(count));
}

// Every URL the grid needs is minted by the server (signed), so a native
// <img> / <a download> can fetch it without carrying any identity header.
function fileUrl(file, preview) {
    if (preview) return file?.preview_url || file?.url || "";
    return file?.url || "";
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

function payload(files) {
    return { files: files.map((f) => ({ source: f.source, path: f.path })) };
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
    /* Native selected ring is ring-3 + ring-modal-card-border-highlighted +
       ring-inset. That token is a dead end at runtime: the shipped sheet
       defines it as var(--color-ash-400) (light) / var(--secondary-background-
       selected) (dark), the light block lands last and --color-ash-400 does not
       exist in the palette → the custom property computes to the empty string,
       so Tailwind's var(--tw-ring-color, currentcolor) falls back to the card's
       inherited text colour. Measured on 8188: rgb(255,255,255) 0 0 0 3px inset
       — i.e. a WHITE 3px inner frame (dark theme). Reproduce the computed
       result, not the broken token. */
    --xog-ring: currentColor;
    --xog-placeholder: var(--secondary-background, color-mix(in srgb, var(--fg-color, #e8e8e8) 10%, transparent));
    /* Native card hover tint: bg-modal-card-background-hovered/20 — the token
       flattened to full opacity would be a solid block, far heavier than the
       official panel faint lift. */
    --xog-card-hover: color-mix(in oklab, var(--modal-card-background-hovered, var(--secondary-background-hover, #313235)) 20%, transparent);
    --xog-danger: var(--destructive-foreground, var(--p-button-danger-background, #dc2626));
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
.xog-srctabs {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px 0;
    border-bottom: 1px solid var(--xog-line);
    overflow-x: auto;
    scrollbar-width: none;
}
.xog-srctabs::-webkit-scrollbar { display: none; }
.xog-srctab {
    flex: none;
    padding: 4px 0 6px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--xog-muted);
    font-family: inherit;
    font-size: 14px;
    line-height: 20px;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.2s ease, border-color 0.2s ease;
}
.xog-srctab:hover { color: var(--xog-fg); }
.xog-srctab[data-active="true"] {
    color: var(--xog-fg);
    border-bottom-color: var(--xog-fg);
    font-weight: 500;
}
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
/* No placeholder colour on purpose: the native SearchInput does not set one
   either, so both fall through to the UA default (#757575 in Chromium). Pinning
   a token here made the hint noticeably brighter than the official panel. */
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
.xog-body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-width: 0;
}
.xog-grid {
    display: grid;
    gap: 8px;
    padding: 0 8px 12px;
}
.xog-grid[data-view="list"] { grid-template-columns: minmax(0, 1fr); }
.xog-card {
    position: relative;
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
    user-select: none;
    box-sizing: border-box;
    transition: background-color 0.2s ease;
}
.xog-card:hover { background: var(--xog-card-hover); }
.xog-card:focus-visible { outline: 1px solid var(--xog-accent); outline-offset: 0; }
/* Native selected card: ring-3 ring-modal-card-border-highlighted ring-inset —
   which really paints a white 3px inner frame (see --xog-ring). The hover tint
   is dropped while selected. */
.xog-card[data-selected="true"] {
    box-shadow: inset 0 0 0 3px var(--xog-ring);
}
.xog-card[data-selected="true"]:hover { background: transparent; }
/* Selection control: Button(variant="overlay-white" size="icon") with the
   ring-2/white treatment only while unselected, so picking a card flips it to
   a solid white disc with a gray check — never a coloured fill. */
.xog-check {
    position: absolute;
    inset-block-start: 16px;
    inset-inline-start: 16px;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 9999px;
    background: transparent;
    color: var(--color-white, #fff);
    box-shadow: inset 0 0 0 2px var(--color-white, #fff),
        0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease, background-color 0.12s ease;
}
.xog-check:not([data-on="true"]):hover { background: color-mix(in srgb, var(--color-white, #fff) 20%, transparent); }
.xog-check[data-on="true"] {
    background: var(--color-white, #fff);
    color: var(--color-gray-600, #4a5565);
    box-shadow: none;
}
.xog-check svg {
    width: 16px;
    height: 16px;
    opacity: 0;
}
.xog-check[data-on="true"] svg { opacity: 1; }
/* Native top-right pair: IconGroup(background-class="bg-white") wrapping two
   Button(variant="overlay-white" size="icon"). The group is a rounded-lg
   (8px) white plate with shadow-sm and no padding/gap, so the two 32px
   rounded-lg buttons sit flush and read as one square bar — never a pill. */
.xog-actions {
    position: absolute;
    inset-block-start: 16px;
    inset-inline-end: 16px;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: var(--color-white, #fff);
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
}
.xog-act {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: var(--color-white, #fff);
    color: var(--color-gray-600, #4a5565);
    cursor: pointer;
    transition: background-color 0.12s ease;
}
/* overlay-white hover is bg-white/90 — over the white group plate it only
   lifts the icon a shade, which is exactly what the native card does. */
.xog-act:hover { background: color-mix(in srgb, var(--color-white, #fff) 90%, transparent); }
.xog-act:focus-visible { outline: 1px solid var(--xog-accent); outline-offset: 0; }
.xog-act svg { width: 16px; height: 16px; }
/* The native card reveals both overlays on group hover / keyboard focus only —
   selection alone never pins them open. */
.xog-card:hover .xog-check,
.xog-card:hover .xog-actions,
.xog-card:focus-within .xog-check,
.xog-card:focus-within .xog-actions {
    opacity: 1;
    pointer-events: auto;
}
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
   A 1.05 scale on hover is the native card only motion. */
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
/* The native list row is a different animal from the grid card: it always
   paints hover:bg-secondary-background-hover, and selection adds a 1px (not
   3px) ring plus that same surface fill — getAssetCardClass() in
   AssetsSidebarListView.vue. */
.xog-grid[data-view="list"] .xog-card:hover,
.xog-grid[data-view="list"] .xog-card[data-selected="true"],
.xog-grid[data-view="list"] .xog-card[data-selected="true"]:hover {
    background: var(--xog-surface-hover);
}
.xog-grid[data-view="list"] .xog-card[data-selected="true"] {
    box-shadow: inset 0 0 0 1px var(--xog-ring);
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
/* A list row has no preview corner to hang a checkbox on — selection rides on
   the row itself and only the overflow control stays, docked to the row end
   like the native list item actions slot. */
.xog-grid[data-view="list"] .xog-check { display: none; }
.xog-grid[data-view="list"] .xog-actions {
    inset-block-start: 50%;
    inset-inline-end: 4px;
    transform: translateY(-50%);
    gap: 8px;
    background: transparent;
    box-shadow: none;
}
/* A list row has no media to float over, so the native actions slot uses
   Button(variant="secondary" size="icon") instead of the white overlay —
   theme surface, same 32px rounded-lg box. */
.xog-grid[data-view="list"] .xog-act {
    background: var(--xog-surface);
    color: var(--xog-fg);
}
.xog-grid[data-view="list"] .xog-act:hover { background: var(--xog-surface-hover); }
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
    margin: 0;
    color: var(--xog-fg);
    font-size: 18px;
    font-weight: 700;
}
.xog-sentinel { height: 1px; }

/* Floating selection bar (MediaAssetSelectionBar): max-w-78, bottom-6, centred.
   It is fixed and tracked against the panel rect on purpose: as a sticky child
   of a long grid it stays trapped inside its own (off-screen) parent box, and
   the panel itself is not the scroll container — the sidebar around it is. */
.xog-selbar {
    position: fixed;
    bottom: 24px;
    /* Above the sidebar's own stacking context (the native bar sits inside it
       at z-40); still under the context menu and the delete dialog. */
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 312px;
    padding: 8px;
    border-radius: 8px;
    background: var(--base-foreground, var(--xog-fg, #e8e8e8));
    color: var(--base-background, var(--comfy-menu-bg, #171718));
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
}
.xog-selbar[hidden] { display: none; }
.xog-selbar[data-offscreen="true"] { display: none; }
.xog-selbtn {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background-color 0.12s ease;
}
.xog-selbtn:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
.xog-selbtn svg { width: 16px; height: 16px; }
.xog-selcount {
    padding-inline-end: 24px;
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.xog-selright {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: none;
    margin-inline-start: auto;
}
.xog-seldiv {
    width: 1px;
    height: 24px;
    background: color-mix(in srgb, currentColor 20%, transparent);
}

/* Context menu — the native panel opens it at the pointer via show(event). */
.xog-ctx {
    position: fixed;
    z-index: 10050;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 180px;
    max-width: 280px;
    padding: 8px;
    border: 1px solid var(--border-subtle, var(--border-default, #3c3d42));
    border-radius: 8px;
    background: var(--base-background, var(--comfy-menu-bg, #171718));
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
    box-sizing: border-box;
}
.xog-ctx[hidden] { display: none; }
.xog-ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
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
    text-align: start;
    cursor: pointer;
    box-sizing: border-box;
    transition: background-color 0.12s ease;
}
.xog-ctx-item:hover { background: var(--secondary-background-hover, var(--xog-surface-hover)); }
.xog-ctx-item[disabled] { opacity: 0.5; cursor: default; }
.xog-ctx-item[data-danger="true"] { color: var(--xog-danger); }
.xog-ctx-item svg { width: 16px; height: 16px; flex: none; }
.xog-ctx-sep {
    height: 1px;
    margin: 4px 0;
    background: var(--xog-line);
}

/* Delete confirmation — the native one is a Vue dialogService call we cannot
   reach from a custom tab, so the same shape is rebuilt here. */
.xog-dlg {
    position: fixed;
    inset: 0;
    z-index: 10100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.6);
    box-sizing: border-box;
}
.xog-dlg[hidden] { display: none; }
.xog-dlg-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: min(420px, 92vw);
    max-height: 80vh;
    padding: 24px;
    border: 1px solid var(--xog-line);
    border-radius: 8px;
    background: var(--comfy-menu-bg, var(--dialog-surface, #171718));
    color: var(--xog-fg);
    font-family: inherit;
    font-size: 14px;
    box-sizing: border-box;
}
.xog-dlg-title {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
}
.xog-dlg-msg {
    margin: 0;
    color: var(--xog-muted);
}
.xog-dlg-list {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 180px;
    overflow-y: auto;
    color: var(--xog-muted);
    font-size: 12px;
}
.xog-dlg-list li {
    padding: 2px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.xog-dlg-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
}
.xog-dlg-btn {
    height: 32px;
    padding: 0 16px;
    border: none;
    border-radius: 8px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
}
.xog-dlg-btn[data-kind="cancel"] {
    background: var(--xog-surface);
    color: var(--xog-fg);
}
.xog-dlg-btn[data-kind="delete"] {
    background: var(--xog-danger);
    color: #fff;
}

/* Marquee rectangle, teleported to <body> exactly like AssetsSidebarTab: inside
   the panel it would be swallowed by the cards it floats over. */
.xog-marquee {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    border: 1px solid var(--primary-background, var(--xog-accent));
    background: color-mix(in srgb, var(--primary-background, var(--xog-accent)) 20%, transparent);
}

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
                node.appendChild(svgIcon(file.kind === "3d" ? "box" : "file"));
                const label = document.createElement("span");
                label.textContent =
                    file.kind === "3d" ? t("threeDFace") : fileExt(file);
                node.appendChild(label);
            }
            body.appendChild(node);

            openBtn.onclick = () => window.open(url, "_blank", "noopener");
            downloadBtn.onclick = () => triggerDownload([file]);
            el.hidden = false;
        },
    };
    return lightbox;
}

// ------------------------------------------------------------- download / zip

function filenameFromDisposition(header) {
    const match = /filename\*?=(?:"([^"]+)"|([^;]+))/i.exec(header || "");
    if (!match) return "";
    return decodeURIComponent((match[1] || match[2] || "").trim());
}

function triggerDownload(files) {
    if (!files.length) return;
    if (files.length === 1) {
        const file = files[0];
        const a = document.createElement("a");
        a.href = fileUrl(file, false);
        a.download = file.filename || "download";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }
    void downloadZip(files);
}

async function downloadZip(files) {
    try {
        const res = await api.fetchApi(ZIP_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload(files)),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = href;
        a.download =
            filenameFromDisposition(res.headers.get("Content-Disposition")) ||
            "comfyui-gallery.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch {
        /* download aborted or server refused — nothing to surface here */
    }
}

// ------------------------------------------------------------ delete confirm

let confirmDialog = null;

function ensureConfirmDialog() {
    if (confirmDialog) return confirmDialog;
    ensureStyle();

    const el = document.createElement("div");
    el.className = "xog-dlg";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.innerHTML = `
        <div class="xog-dlg-panel">
            <h3 class="xog-dlg-title"></h3>
            <p class="xog-dlg-msg"></p>
            <ul class="xog-dlg-list"></ul>
            <div class="xog-dlg-actions">
                <button class="xog-dlg-btn" type="button" data-kind="cancel"></button>
                <button class="xog-dlg-btn" type="button" data-kind="delete"></button>
            </div>
        </div>`;
    document.body.appendChild(el);

    const title = el.querySelector(".xog-dlg-title");
    const msg = el.querySelector(".xog-dlg-msg");
    const list = el.querySelector(".xog-dlg-list");
    const cancelBtn = el.querySelector('[data-kind="cancel"]');
    const deleteBtn = el.querySelector('[data-kind="delete"]');

    let resolveFn = null;

    function finish(value) {
        if (!resolveFn) return;
        const fn = resolveFn;
        resolveFn = null;
        el.hidden = true;
        fn(value);
    }

    cancelBtn.addEventListener("click", () => finish(false));
    deleteBtn.addEventListener("click", () => finish(true));
    el.addEventListener("click", (ev) => {
        if (ev.target === el) finish(false);
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !el.hidden) finish(false);
    });

    confirmDialog = {
        /** Resolves true when the user confirms; mirrors dialogService.confirm. */
        ask(files) {
            title.textContent = t("deleteItems");
            msg.textContent = t("deletePermanent");
            list.replaceChildren(
                ...files.slice(0, 50).map((file) => {
                    const li = document.createElement("li");
                    li.textContent = relPath(file);
                    li.title = li.textContent;
                    return li;
                })
            );
            if (files.length > 50) {
                const li = document.createElement("li");
                li.textContent = `… +${files.length - 50}`;
                list.appendChild(li);
            }
            cancelBtn.textContent = t("cancel");
            deleteBtn.textContent = t("delete");
            el.hidden = false;
            deleteBtn.focus();
            return new Promise((resolve) => {
                resolveFn = resolve;
            });
        },
    };
    return confirmDialog;
}

async function deleteFiles(files) {
    if (!files.length) return false;
    const ok = await ensureConfirmDialog().ask(files);
    if (!ok) return false;
    try {
        const res = await api.fetchApi(DELETE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload(files)),
        });
        if (!res.ok) return false;
    } catch {
        return false;
    }
    return true;
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
            <div class="xog-srctabs" role="tablist"></div>
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
            <div class="xog-tabs"></div>
        </div>
        <div class="xog-body">
            <div class="xog-grid"></div>
            <div class="xog-status"></div>
            <div class="xog-sentinel"></div>
        </div>`;

    host.querySelector(".xog-title").textContent = t("panelTitle");
    const refreshBtn = host.querySelector(".xog-refresh");
    refreshBtn.title = t("refresh");
    refreshBtn.setAttribute("aria-label", t("refresh"));
    refreshBtn.replaceChildren(svgIcon("refresh"));

    const search = host.querySelector(".xog-search");
    search.placeholder = t("search");
    host.querySelector(".xog-search-icon").appendChild(svgIcon("search"));

    // Output / input switch, the same pair the native panel puts above its
    // filter bar (sideToolbar.labels.generated / imported).
    const srcTabs = host.querySelector(".xog-srctabs");
    const sources = [
        { source: "output", label: "tabOutput" },
        { source: "input", label: "tabInput" },
    ];
    srcTabs.replaceChildren(
        ...sources.map((item) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "xog-srctab";
            btn.setAttribute("role", "tab");
            btn.dataset.source = item.source;
            btn.dataset.active = String(item.source === "output");
            btn.textContent = t(item.label);
            return btn;
        })
    );

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
    // native Assets panel MediaAssetSettingsMenu.
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

    // The bar floats above the panel, so it lives on <body> — the sidebar
    // around the panel is the scroll container and clips nothing, but a sticky
    // child would be trapped inside its own parent box.
    const selbar = document.createElement("div");
    selbar.className = "xog-selbar";
    selbar.hidden = true;
    selbar.innerHTML = `
        <button class="xog-selbtn xog-sel-clear" type="button"></button>
        <span class="xog-selcount"></span>
        <div class="xog-selright">
            <button class="xog-selbtn xog-sel-download" type="button"></button>
            <span class="xog-seldiv"></span>
            <button class="xog-selbtn xog-sel-delete" type="button"></button>
        </div>`;
    document.body.appendChild(selbar);
    const selCount = selbar.querySelector(".xog-selcount");
    const selClear = selbar.querySelector(".xog-sel-clear");
    const selDownload = selbar.querySelector(".xog-sel-download");
    const selDelete = selbar.querySelector(".xog-sel-delete");

    // Fixed positioning needs the panel rect: the sidebar can be scrolled away
    // or resized, and the bar must follow it (and disappear with it).
    function syncSelbar() {
        if (selbar.hidden) return;
        const r = host.getBoundingClientRect();
        const visible = r.bottom > 64 && r.top < window.innerHeight - 32;
        selbar.dataset.offscreen = String(!visible);
        if (!visible) return;
        selbar.style.left = `${Math.round(r.left + 8)}px`;
        selbar.style.width = `${Math.round(Math.max(140, Math.min(312, r.width - 16)))}px`;
    }
    window.addEventListener("scroll", syncSelbar, true);
    window.addEventListener("resize", syncSelbar);

    selClear.title = t("deselectAll");
    selClear.setAttribute("aria-label", t("deselectAll"));
    selClear.replaceChildren(svgIcon("x"));
    // The bar labels match mediaAsset.selection.downloadSelected / deleteSelected;
    // the bulk context menu is the one that reads "全部下载 / 全部删除".
    selDownload.title = t("download");
    selDownload.setAttribute("aria-label", t("download"));
    selDownload.replaceChildren(svgIcon("download"));
    selDelete.title = t("delete");
    selDelete.setAttribute("aria-label", t("delete"));
    selDelete.replaceChildren(svgIcon("trash"));

    const state = {
        files: [],
        source: "output",
        filter: "all",
        query: "",
        matched: [],
        shown: 0,
    };

    // ---- selection (useAssetSelection.ts)

    const selection = new Set();
    let anchorIndex = -1;
    let anchorIdValue = null;

    function listForSelection() {
        return state.matched;
    }

    function setAnchor(index, id) {
        anchorIndex = index;
        anchorIdValue = id;
    }

    function syncAnchorFromSelection() {
        const list = listForSelection();
        if (!selection.size) {
            setAnchor(-1, null);
            return;
        }
        for (let i = list.length - 1; i >= 0; i -= 1) {
            if (selection.has(list[i].id)) {
                setAnchor(i, list[i].id);
                return;
            }
        }
        setAnchor(-1, null);
    }

    function paintSelection() {
        for (const card of grid.querySelectorAll(CARD_SELECTOR)) {
            const on = selection.has(card.dataset.assetId);
            card.dataset.selected = String(on);
            const check = card.querySelector(".xog-check");
            if (check) check.dataset.on = String(on);
        }
        if (selection.size) {
            selbar.hidden = false;
            selCount.textContent = fmtCount(t("selectedCount"), selection.size);
            syncSelbar();
        } else {
            selbar.hidden = true;
        }
    }

    function setSelection(ids) {
        selection.clear();
        for (const id of ids) selection.add(id);
        syncAnchorFromSelection();
        paintSelection();
    }

    function clearSelection() {
        if (!selection.size) return;
        selection.clear();
        setAnchor(-1, null);
        paintSelection();
    }

    function toggleSelection(id, index) {
        if (selection.has(id)) selection.delete(id);
        else selection.add(id);
        setAnchor(index, id);
        paintSelection();
    }

    function handleCardClick(file, index, ev) {
        const list = listForSelection();
        if (ev.shiftKey && anchorIndex >= 0) {
            const start = Math.min(anchorIndex, index);
            const end = Math.max(anchorIndex, index);
            // A shift range replaces the selection and leaves the anchor put.
            setSelection(list.slice(start, end + 1).map((f) => f.id));
            return;
        }
        if (ev.ctrlKey || ev.metaKey) {
            toggleSelection(file.id, index);
            return;
        }
        // Clicking the only selected asset does not clear the selection.
        if (selection.has(file.id) && selection.size === 1) return;
        setSelection([file.id]);
        setAnchor(index, file.id);
    }

    function selectedFiles() {
        return state.matched.filter((file) => selection.has(file.id));
    }

    // ---- context menu (AssetsSidebarTab.handleAssetContextMenu)

    let ctxMenu = null;

    function ensureCtxMenu() {
        if (ctxMenu) return ctxMenu;
        const el = document.createElement("div");
        el.className = "xog-ctx";
        el.hidden = true;
        document.body.appendChild(el);
        ctxMenu = el;

        const close = () => {
            el.hidden = true;
        };
        const onDown = (ev) => {
            if (el.hidden) return;
            if (el.contains(ev.target)) return;
            close();
        };
        const onKey = (ev) => {
            if (ev.key === "Escape" && !el.hidden) close();
        };
        // Native dismisses the overlay on scroll too.
        const onScroll = () => {
            if (!el.hidden) close();
        };
        document.addEventListener("pointerdown", onDown, true);
        document.addEventListener("keydown", onKey, true);
        window.addEventListener("scroll", onScroll, true);
        return el;
    }

    function menuItem({ icon, label, danger, disabled, onClick }) {
        if (label === "-") {
            const sep = document.createElement("div");
            sep.className = "xog-ctx-sep";
            return sep;
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "xog-ctx-item";
        if (danger) btn.dataset.danger = "true";
        if (disabled) btn.disabled = true;
        if (icon) btn.appendChild(svgIcon(icon));
        const text = document.createElement("span");
        text.textContent = label;
        btn.appendChild(text);
        btn.addEventListener("click", () => {
            ctxMenu.hidden = true;
            onClick?.();
        });
        return btn;
    }

    function openContextMenu(event, file) {
        const el = ensureCtxMenu();
        const chosen = selection.size > 1 && selection.has(file.id)
            ? selectedFiles()
            : [file];
        const isBulk = chosen.length > 1;

        const items = isBulk
            ? [
                  menuItem({ label: t("multipleSelected"), disabled: true }),
                  menuItem({
                      icon: "download",
                      label: t("downloadAll"),
                      onClick: () => {
                          triggerDownload(chosen);
                          clearSelection();
                      },
                  }),
                  menuItem({
                      icon: "trash",
                      label: t("deleteAll"),
                      danger: true,
                      onClick: async () => {
                          const ids = new Set(chosen.map((f) => f.id));
                          const done = await deleteFiles(chosen);
                          if (done) {
                              clearSelection();
                              state.files = state.files.filter(
                                  (f) => !ids.has(f.id)
                              );
                              await load();
                          }
                      },
                  }),
              ]
            : [
                  menuItem({
                      icon: "zoomIn",
                      label: t("inspect"),
                      onClick: () => ensureLightbox().open(file),
                  }),
                  menuItem({
                      icon: "download",
                      label: t("download"),
                      onClick: () => triggerDownload([file]),
                  }),
                  menuItem({ label: "-" }),
                  menuItem({
                      icon: "trash",
                      label: t("delete"),
                      danger: true,
                      onClick: async () => {
                          const done = await deleteFiles([file]);
                          if (done) await load();
                      },
                  }),
              ];

        el.replaceChildren(...items);
        el.hidden = false;

        // The native menu opens at the pointer (contextMenuRef.show(event));
        // clamp so it never hangs off the viewport.
        const rect = el.getBoundingClientRect();
        const x = Math.min(
            event.clientX,
            Math.max(0, window.innerWidth - rect.width - 8)
        );
        const y = Math.min(
            event.clientY,
            Math.max(0, window.innerHeight - rect.height - 8)
        );
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }

    // ---- marquee (useAssetGridSelection.ts + marqueeSelectionUtil.ts)

    const marquee = document.createElement("div");
    marquee.className = "xog-marquee";
    marquee.hidden = true;
    document.body.appendChild(marquee);

    let drag = null;
    let suppressNextClick = false;
    let suppressTimer = null;
    let pointerX = 0;
    let pointerY = 0;
    let hasPointerSample = false;

    function normaliseRect(startX, startY, endX, endY) {
        return {
            left: Math.min(startX, endX),
            top: Math.min(startY, endY),
            right: Math.max(startX, endX),
            bottom: Math.max(startY, endY),
        };
    }

    function clipRect(rect, bounds) {
        return {
            left: Math.max(rect.left, bounds.left),
            top: Math.max(rect.top, bounds.top),
            right: Math.min(rect.right, bounds.right),
            bottom: Math.min(rect.bottom, bounds.bottom),
        };
    }

    function rectsIntersect(a, b) {
        return !(
            a.right < b.left ||
            a.left > b.right ||
            a.bottom < b.top ||
            a.top > b.bottom
        );
    }

    function collectCards() {
        return [...grid.querySelectorAll(CARD_SELECTOR)].flatMap((el) => {
            const id = el.dataset.assetId;
            return id ? [{ id, rect: el.getBoundingClientRect() }] : [];
        });
    }

    function applyMarquee(clientX, clientY) {
        if (!drag) return;
        const rect = clipRect(
            normaliseRect(drag.startX, drag.startY, clientX, clientY),
            drag.bounds
        );
        marquee.hidden = false;
        marquee.style.left = `${rect.left}px`;
        marquee.style.top = `${rect.top}px`;
        marquee.style.width = `${Math.max(0, rect.right - rect.left)}px`;
        marquee.style.height = `${Math.max(0, rect.bottom - rect.top)}px`;

        const hits = new Set(drag.baseIds);
        for (const card of drag.cards) {
            if (!rectsIntersect(card.rect, rect)) continue;
            if (drag.subtract) hits.delete(card.id);
            else hits.add(card.id);
        }
        setSelection([...hits]);
    }

    function onPointerMove(ev) {
        pointerX = ev.clientX;
        pointerY = ev.clientY;
        hasPointerSample = true;
        if (!drag) return;
        if (
            !drag.active &&
            Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) <
                DRAG_THRESHOLD_PX
        ) {
            return;
        }
        if (!drag.active) {
            drag.active = true;
            drag.cards = collectCards();
            drag.bounds = host.getBoundingClientRect();
            try {
                host.setPointerCapture(drag.pointerId);
            } catch {
                /* stale pointer id — window listeners still end the drag */
            }
        }
        applyMarquee(ev.clientX, ev.clientY);
    }

    function endDrag() {
        if (!drag) return;
        const wasActive = drag.active;
        drag = null;
        marquee.hidden = true;
        if (wasActive) {
            // Swallow the click the drag ends with, or it would collapse the
            // selection we just made.
            suppressNextClick = true;
            if (suppressTimer) clearTimeout(suppressTimer);
            suppressTimer = setTimeout(() => {
                suppressNextClick = false;
                suppressTimer = null;
            }, 0);
        }
    }

    function onPointerDown(ev) {
        if (ev.button !== 0 || drag) return;
        if (!grid.querySelector(CARD_SELECTOR)) return;
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest(INTERACTIVE_SELECTOR)) return;
        // Pressing on a card starts a marquee only with a modifier held.
        if (target.closest(CARD_SELECTOR) && !ev.ctrlKey && !ev.metaKey) return;

        drag = {
            startX: ev.clientX,
            startY: ev.clientY,
            pointerId: ev.pointerId,
            baseIds: ev.shiftKey || ev.ctrlKey || ev.metaKey ? [...selection] : [],
            subtract: (ev.ctrlKey || ev.metaKey) && ev.shiftKey,
            active: false,
            cards: [],
            bounds: null,
        };
        if (suppressTimer) clearTimeout(suppressTimer);
        suppressNextClick = false;
    }

    function onClickCapture(ev) {
        if (!suppressNextClick) return;
        suppressNextClick = false;
        if (suppressTimer) clearTimeout(suppressTimer);
        ev.stopImmediatePropagation();
        ev.preventDefault();
    }

    function onDragStart(ev) {
        if (drag) ev.preventDefault();
    }

    function onSelectStart(ev) {
        if (!drag) return;
        if (ev.target instanceof Node && host.contains(ev.target)) {
            ev.preventDefault();
        }
    }

    function isTextEntryTarget(el) {
        return (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            (el instanceof HTMLElement && el.isContentEditable)
        );
    }

    function pointerInsidePanel() {
        if (!hasPointerSample) return false;
        const { left, top, right, bottom } = host.getBoundingClientRect();
        return (
            pointerX >= left &&
            pointerX <= right &&
            pointerY >= top &&
            pointerY <= bottom
        );
    }

    function onKeydown(ev) {
        if (!(ev.ctrlKey || ev.metaKey) || (ev.key !== "a" && ev.key !== "A")) return;
        if (!pointerInsidePanel()) return;
        if (isTextEntryTarget(document.activeElement)) return;
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const list = listForSelection();
        setSelection(list.map((f) => f.id));
    }

    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("dragstart", onDragStart, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("click", onClickCapture, true);
    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("selectstart", onSelectStart, true);

    // ---- rendering

    // Column tracks come from the frontend own getMediaAssetGridColumns().
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
            /* storage disabled — view just will not persist */
        }
        // A different column count changes how many cards fill the first screen.
        fillViewport();
    }

    function setStatus(text) {
        status.replaceChildren();
        status.textContent = text || "";
        status.style.display = text ? "" : "none";
    }

    // Mirrors the native Assets panel empty state: info glyph + heading.
    function setEmpty() {
        const box = document.createElement("div");
        box.className = "xog-empty";
        const icon = document.createElement("i");
        icon.className = "pi pi-info-circle";
        const heading = document.createElement("h3");
        heading.textContent = t("empty");
        box.append(icon, heading);
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

    // Text files print their opening lines, exactly like the native panel
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

    function makeCard(file, index) {
        const card = document.createElement("div");
        card.className = "xog-card";
        card.dataset.assetId = file.id;
        card.dataset.selected = "false";
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

        // Selection checkbox, top-left (MediaAssetCard).
        const check = document.createElement("button");
        check.type = "button";
        check.className = "xog-check";
        check.dataset.on = "false";
        check.tabIndex = -1;
        check.appendChild(svgIcon("check"));
        check.addEventListener("click", (ev) => {
            ev.stopPropagation();
            toggleSelection(file.id, index);
        });

        // Download + more options, top-right — the native IconGroup pair.
        const actions = document.createElement("div");
        actions.className = "xog-actions";
        const dl = document.createElement("button");
        dl.type = "button";
        dl.className = "xog-act";
        dl.tabIndex = -1;
        dl.title = t("download");
        dl.setAttribute("aria-label", t("download"));
        dl.appendChild(svgIcon("download"));
        dl.addEventListener("click", (ev) => {
            ev.stopPropagation();
            triggerDownload([file]);
        });
        const more = document.createElement("button");
        more.type = "button";
        more.className = "xog-act";
        more.tabIndex = -1;
        more.title = t("moreOptions");
        more.setAttribute("aria-label", t("moreOptions"));
        more.appendChild(svgIcon("ellipsis"));
        more.addEventListener("click", (ev) => {
            ev.stopPropagation();
            openContextMenu(ev, file);
        });
        actions.append(dl, more);

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

        // Native card: the preview area selects, a double click inspects, and
        // the info row selects as well.
        thumb.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleCardClick(file, index, ev);
        });
        thumb.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            ensureLightbox().open(file);
        });
        meta.addEventListener("click", (ev) => {
            ev.stopPropagation();
            handleCardClick(file, index, ev);
        });
        card.addEventListener("click", (ev) => ev.stopPropagation());
        card.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openContextMenu(ev, file);
        });
        card.addEventListener("keydown", (ev) => {
            if (ev.key !== "Enter" && ev.key !== " ") return;
            ev.preventDefault();
            handleCardClick(file, index, ev);
        });

        // Overlays belong to the card, not the preview: a 32px list thumb would
        // clip them, and the list row docks them to its own end instead.
        card.append(thumb, meta, check, actions);
        return card;
    }

    function renderNext() {
        if (state.shown >= state.matched.length) {
            if (state.matched.length > 0) setStatus("");
            return;
        }
        const start = state.shown;
        const slice = state.matched.slice(start, start + BATCH);
        const frag = document.createDocumentFragment();
        // The card keeps its index in the current view: shift-range selection
        // works on those positions, not on render order.
        slice.forEach((file, i) => frag.appendChild(makeCard(file, start + i)));
        grid.appendChild(frag);
        state.shown = start + slice.length;
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
            if (file.source !== state.source) return false;
            if (group && !group.includes(file.kind)) return false;
            if (!q) return true;
            return `${file.subfolder || ""}/${file.filename}`.toLowerCase().includes(q);
        });
        state.shown = 0;
        grid.replaceChildren();

        // Selection is scoped to what this view can act on, like the native
        // reconcileSelection pass.
        const visible = new Set(state.matched.map((f) => f.id));
        for (const id of [...selection]) {
            if (!visible.has(id)) selection.delete(id);
        }
        syncAnchorFromSelection();

        if (state.matched.length === 0) {
            if (state.files.length === 0) setEmpty();
            else setStatus(t("noMatch"));
        } else {
            setStatus("");
        }
        renderNext();
        fillViewport();
        paintSelection();
    }

    function paintCount() {
        const inSource = state.files.filter((f) => f.source === state.source).length;
        let text = `${state.matched.length} / ${inSource} ${t("files")}`;
        if (cache.data?.truncated) text += ` (${cache.data.total})`;
        count.textContent = text;
    }

    async function load() {
        count.textContent = "";
        if (!state.files.length) setStatus(t("loading"));
        try {
            const res = await api.fetchApi(LIST_URL, { cache: "no-store" });
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

    // Clicking empty space inside the body clears the selection, the way the
    // native panel body handler does.
    grid.addEventListener("click", (ev) => {
        if (ev.target.closest(CARD_SELECTOR)) return;
        clearSelection();
    });

    refreshBtn.addEventListener("click", () => {
        cache = { at: 0, data: null };
        load();
    });

    search.addEventListener("input", () => {
        state.query = search.value;
        applyFilter();
        paintCount();
    });

    srcTabs.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".xog-srctab");
        if (!btn) return;
        state.source = btn.dataset.source || "output";
        for (const tab of srcTabs.children) {
            tab.dataset.active = String(tab === btn);
        }
        // Switching tabs starts from a clean selection, like the native panel.
        clearSelection();
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

    selClear.addEventListener("click", clearSelection);
    selDownload.addEventListener("click", () => {
        triggerDownload(selectedFiles());
        clearSelection();
    });
    selDelete.addEventListener("click", async () => {
        const chosen = selectedFiles();
        const ids = new Set(chosen.map((f) => f.id));
        const done = await deleteFiles(chosen);
        if (done) {
            clearSelection();
            state.files = state.files.filter((f) => !ids.has(f.id));
            await load();
        }
    });

    applyView(getViewMode());

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
        window.removeEventListener("scroll", syncSelbar, true);
        window.removeEventListener("resize", syncSelbar);
        selbar.remove();
        host.removeEventListener("pointerdown", onPointerDown);
        host.removeEventListener("dragstart", onDragStart, true);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("click", onClickCapture, true);
        window.removeEventListener("keydown", onKeydown, true);
        window.removeEventListener("selectstart", onSelectStart, true);
        marquee.remove();
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
    name: "XXXXXLCat.HistoryGallery",
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
