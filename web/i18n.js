/* Shared zh/en lookup for the 🐈‍⬛ front-end panels.

   The language comes from ComfyUI's own `Comfy.Locale` **setting** — that is the
   only authoritative source: the current frontend keeps settings on the server
   (`/api/settings`), and `localStorage["Comfy.Locale"]` is a leftover from older
   versions that is never updated (it can hold a stale "zh" while the UI runs in
   English). So: setting first, localStorage / <html lang> / navigator only as
   fallbacks for the first paint or an older frontend.

   ComfyUI's language list has no `zh-CN`: Simplified Chinese is `zh`, Traditional
   is `zh-TW`. Anything that starts with `zh` is treated as Chinese, matching the
   server-side `locale_alias.py` that fills `zh-TW` from the `zh` bundle.

   The language never changes mid-render, but it *can* change mid-session: newer
   frontends (1.5x) switch `Comfy.Locale` in place instead of reloading, so
   anything captured as a plain string when a node/tab was created keeps the old
   language. Resolve the value on every lookup, or expose labels as accessors
   (see `bindLiveLabels` in `output_gallery.js`) so a re-render picks them up.
   Only a value that came from a real source is cached, never a guess made before
   `app` was ready.
*/

import { app } from "../../scripts/app.js";

let _lang = null;

function norm(value) {
    return String(value || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function fromSetting() {
    try {
        const value = app?.extensionManager?.setting?.get?.("Comfy.Locale");
        if (value) return value;
    } catch {
        /* extensionManager not ready */
    }
    try {
        const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
        if (value) return value;
    } catch {
        /* legacy settings API gone */
    }
    return "";
}

function fromStorage() {
    try {
        // `xcat.locale` is written by us from the real setting, so it beats the
        // stale `Comfy.Locale` key older frontends used to keep in sync.
        return localStorage.getItem("xcat.locale") || localStorage.getItem("Comfy.Locale") || "";
    } catch {
        return "";
    }
}

/* Last locale we rendered in, kept for the server-rendered login page: that page
   is served before sign-in, so `/api/settings` is out of reach there. */
function remember(lang) {
    try {
        localStorage.setItem("xcat.locale", lang);
    } catch {
        /* private mode */
    }
}

export function langCode() {
    // Always ask the setting first, even when a value is already cached: the
    // extension can be imported before `/api/settings` resolves, and anything we
    // cached at that moment would otherwise stick for the whole page.
    const setting = fromSetting();
    if (setting) {
        const lang = norm(setting);
        // Only touch localStorage when the value actually moved: this runs on
        // every label lookup, which is a lot of renders during a session.
        if (_lang !== lang) {
            _lang = lang;
            remember(lang);
        }
        return lang;
    }

    if (_lang) return _lang;

    // `xcat.locale` / `Comfy.Locale` are leftovers from the previous page load —
    // good enough for the first paint, but they must NOT be cached: switching the
    // language and reloading leaves them stale until the new setting is read.
    const stored = fromStorage();
    if (stored) return norm(stored);

    return norm(document.documentElement?.lang || navigator.language || "");
}

/* `pick({ zh, en })` → the string for the current language. Plain strings pass
   through, so callers can mix literal and translated labels. */
export function pick(pair) {
    if (pair == null) return "";
    if (typeof pair === "string") return pair;
    return pair[langCode()] ?? pair.en ?? "";
}

/* `makeT({ zh: {...}, en: {...} })` → key lookup for flat string tables. */
export function makeT(table) {
    const lang = langCode();
    return (key) => table[lang]?.[key] ?? table.en?.[key] ?? key;
}
