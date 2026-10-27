/* Shared zh/en lookup for the 🐈‍⬛ front-end panels.

   ComfyUI's own language list has no `zh-CN`: Simplified Chinese is the `zh`
   bundle, Traditional is `zh-TW`. Anything that is not Chinese falls back to
   English, which is also what the node bundles do server-side.

   The language never changes at runtime (ComfyUI reloads the page when the
   setting changes), so the value is resolved once and cached.
*/

let _lang = null;

export function langCode() {
    if (_lang) return _lang;
    let probe = "";
    try {
        probe = localStorage.getItem("Comfy.Locale") || "";
    } catch {
        probe = "";
    }
    if (!probe) probe = document.documentElement?.lang || "";
    if (!probe) probe = navigator.language || "";
    _lang = String(probe).toLowerCase().startsWith("zh") ? "zh" : "en";
    return _lang;
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
