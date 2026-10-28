# -*- coding: utf-8 -*-
"""Serve the Simplified Chinese bundle to every other ``zh-*`` locale.

ComfyUI's language list ships ``zh`` (Simplified) and ``zh-TW`` (Traditional),
but a custom node pack normally only carries one of them. Core resolves the
bundle by the exact folder name (``app/custom_node_manager.py``), so a ``zh-TW``
UI silently drops every translated node back to English.

The front end (``web/i18n.js``) and this module agree on one
rule: **any locale that starts with ``zh`` is Chinese**. So instead of shipping a
duplicated Traditional bundle, we copy the entries we own from ``zh`` into the
``zh-TW`` bundle when that bundle has no entry for a given node.

Only node ids we are responsible for (the keys of our own ``locales/zh``) are
filled in, and only when the target locale has no value yet — a pack that ships
its own ``zh-TW`` file keeps every one of its strings.
"""

import json
import os

_installed = False
_our_ids = None


def _our_node_ids():
    """Node ids we translate = the keys of our bundled ``locales/zh`` file."""
    global _our_ids
    if _our_ids is None:
        path = os.path.join(os.path.dirname(__file__), "locales", "zh", "nodeDefs.json")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            _our_ids = tuple(data.keys()) if isinstance(data, dict) else ()
        except Exception:
            _our_ids = ()
    return _our_ids


def _fill_aliases(translations):
    """Add our ``zh`` node definitions to ``zh-TW`` (and any other ``zh-*``)."""
    if not isinstance(translations, dict):
        return translations

    zh_bundle = translations.get("zh")
    if not isinstance(zh_bundle, dict):
        return translations
    zh_defs = zh_bundle.get("nodeDefs")
    if not isinstance(zh_defs, dict):
        return translations

    ours = {nid: zh_defs[nid] for nid in _our_node_ids() if nid in zh_defs}
    if not ours:
        return translations

    # Every zh-* bundle that already exists, plus zh-TW which core offers in its
    # language list even when no custom node pack ships it.
    targets = {
        lang
        for lang in translations
        if isinstance(lang, str) and lang.lower().startswith("zh") and lang != "zh"
    }
    targets.add("zh-TW")

    for lang in targets:
        bundle = translations.get(lang)
        if not isinstance(bundle, dict):
            bundle = translations[lang] = {}
        defs = bundle.get("nodeDefs")
        if not isinstance(defs, dict):
            defs = bundle["nodeDefs"] = {}
        for node_id, entry in ours.items():
            defs.setdefault(node_id, entry)
    return translations


def install():
    """Wrap ``CustomNodeManager.build_translations`` — safe to call twice."""
    global _installed
    if _installed:
        return True

    try:
        from app.custom_node_manager import CustomNodeManager
    except Exception as exc:  # pragma: no cover - core moved the symbol
        print(f"[XXXXXLCat] zh-* locale alias skipped: {exc}")
        return False

    original = getattr(CustomNodeManager, "build_translations", None)
    if not callable(original):
        print("[XXXXXLCat] zh-* locale alias skipped: build_translations not found")
        return False
    if getattr(original, "_xcat_locale_alias", False):
        _installed = True
        return True

    # ``original`` is the lru_cache-wrapped method, so calling it keeps core's
    # caching; the dict it returns is mutated in place, which is idempotent.
    def build_translations(self):
        data = original(self)
        try:
            _fill_aliases(data)
        except Exception:
            pass
        return data

    build_translations._xcat_locale_alias = True
    CustomNodeManager.build_translations = build_translations
    _installed = True
    print("[XXXXXLCat] zh-TW locale falls back to the zh bundle")
    return True
