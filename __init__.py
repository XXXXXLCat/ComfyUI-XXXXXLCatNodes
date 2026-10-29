# -*- coding: utf-8 -*-
"""ComfyUI-XXXXXLCatNodes — system telemetry, VRAM/RAM reclamation and workflow nodes.

Zero third-party dependencies: the standard library, ctypes, and an nvidia-smi
subprocess. Nothing like psutil is pulled in.
- A background sampler thread continuously collects CPU load, physical RAM,
  per-GPU utilization / VRAM / temperature, and system-drive free space.
- The menu bar (web/monitor.js) renders these live and offers one-tap VRAM / RAM
  cleanup buttons executed inside the ComfyUI process.
- Front-end strings (node names, descriptions, widget labels and tooltips) are
  localised through ``locales/<lang>/nodeDefs.json``, picked up by the core
  ``/i18n`` route, so they follow the language selected in ComfyUI. Only ``zh``
  and ``en`` bundles exist; ``locale_alias.py`` copies the ``zh`` node entries
  into every other ``zh-*`` locale (``zh-TW`` included) so a Traditional UI shows
  Simplified Chinese instead of falling back to English.
- Eight custom nodes under the 🐈‍⬛XXXXXLCat brand (🐈‍⬛XXXXXLCat/Memory,
  🐈‍⬛XXXXXLCat/Sampling, 🐈‍⬛XXXXXLCat/switch, 🐈‍⬛XXXXXLCat/group,
  🐈‍⬛XXXXXLCat/node, 🐈‍⬛XXXXXLCat/utilities, 🐈‍⬛XXXXXLCat/image): all built on
  the new V3 node API (comfy_api / io.ComfyNode) — Sweep VRAM 🐈‍⬛,
  Reclaim RAM 🐈‍⬛, H3 Image to Video 🐈‍⬛, Any Switch 🐈‍⬛,
  Group Control 🐈‍⬛, Node Control 🐈‍⬛, Resolution Selector 🐈‍⬛ (the
  official resolution node, with a 2-decimal megapixel step), and
  Fit Image to Size 🐈‍⬛ (crop/pad an image onto an exact target canvas).

Implementation is split across submodules: sensors (ctypes readers), telemetry
(sampler + route), reclamation (VRAM/RAM engine), and nodes (one class per file).
This file is only the entry point: it prints the banner, imports those modules,
and exposes the ComfyUI extension via ``comfy_entrypoint`` (the 8 V3 nodes).
"""

import os

WEB_DIRECTORY = "web"


# ============================================================ 启动横幅

_BANNER = r""" _|      _|  _|      _|  _|      _|  _|      _|  _|      _|  _|          _|_|_|              _|
   _|  _|      _|  _|      _|  _|      _|  _|      _|  _|    _|        _|          _|_|_|  _|_|_|_|
     _|          _|          _|          _|          _|      _|        _|        _|    _|    _|
   _|  _|      _|  _|      _|  _|      _|  _|      _|  _|    _|        _|        _|    _|    _|
 _|      _|  _|      _|  _|      _|  _|      _|  _|      _|  _|_|_|_|    _|_|_|    _|_|_|      _|_|"""

_SEP = "-" * 99

print(f"\n{_SEP}\n{_BANNER}\n{_SEP}\n")


# ============================================================ 子模块导入（触发路由注册 / 采样线程）

from . import sensors, telemetry, reclamation, infra  # noqa: E402,F401
from .nodes import (  # noqa: E402
    XXXXXLCatVRAMSweep,
    XXXXXLCatRAMReclaim,
    XXXXXLCatH3ImageToVideo,
    XXXXXLCatAnySwitch,
    XXXXXLCatGroupControl,
    XXXXXLCatNodeControl,
    XXXXXLCatResolutionSelector,
    XXXXXLCatFitImageToSize,
)


# ============================================================ V3 扩展入口

from comfy_api.latest import ComfyExtension  # noqa: E402


class XXXXXLCatExtension(ComfyExtension):
    """Registers the V3 🐈‍⬛XXXXXLCat nodes through the new V3 node API and
    wires up the package-level monkeypatches once ComfyUI core is ready."""

    async def get_node_list(self):
        return list(_NODE_CLASSES)

    async def on_load(self) -> None:
        # Core is up by the time on_load runs: nodes.py awaits it immediately
        # after comfy_entrypoint() returns and before node schemas are
        # collected, so this is the correct home for install-time patches —
        # not comfy_entrypoint() itself. Each install() carries its own
        # idempotency guard, so re-entry (e.g. a reload) is safe.

        # The packs only ship zh + en, and core looks a bundle up by its exact
        # folder name — so a zh-TW UI would show our nodes in English. Alias
        # every zh-* locale to the zh bundle (matches what web/i18n.js does).
        try:
            from . import locale_alias

            locale_alias.install()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[XXXXXLCat] zh-* locale alias skipped: {exc}")

        # Per-user asset isolation (input/<user>/ & output/<user>/; the legacy
        # global input/ output/ pool is hidden from every account). Only takes
        # effect when ComfyUI is launched with --multi-user; no-op otherwise.
        # Login stays on ComfyUI's native "select user" flow — no password gate.
        try:
            from .nodes import multi_user_assets

            multi_user_assets.install()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[XXXXXLCat] multi-user asset isolation skipped: {exc}")

        # History gallery: a sidebar tab listing every file in the account's own
        # output/ and input/ trees, with download and on-disk delete.
        try:
            from .nodes import history_gallery

            history_gallery.install()
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[XXXXXLCat] history gallery skipped: {exc}")


# Kept in one place so the load log can never drift from the real registration.
_NODE_CLASSES = [
    XXXXXLCatVRAMSweep,
    XXXXXLCatRAMReclaim,
    XXXXXLCatH3ImageToVideo,
    XXXXXLCatAnySwitch,
    XXXXXLCatGroupControl,
    XXXXXLCatNodeControl,
    XXXXXLCatResolutionSelector,
    XXXXXLCatFitImageToSize,
]


async def comfy_entrypoint() -> XXXXXLCatExtension:
    # Patches (locale alias, multi-user isolation, history gallery) now live in
    # XXXXXLCatExtension.on_load(), which core awaits right after this returns —
    # so the entry point's only job is to hand back the extension.
    return XXXXXLCatExtension()


# ============================================================ 加载完成日志

try:
    import tomllib

    with open(os.path.join(os.path.dirname(__file__), "pyproject.toml"), "rb") as _pf:
        _PKG_VERSION = tomllib.load(_pf).get("project", {}).get("version", "unknown")
except Exception:
    _PKG_VERSION = "unknown"

print(f"[XXXXXLCat] ComfyUI-XXXXXLCatNodes v{_PKG_VERSION} loaded")
print(
    f"[XXXXXLCat] {len(_NODE_CLASSES)} nodes registered via comfy_entrypoint (new V3 node API)"
)
print("[XXXXXLCat] Menu-bar telemetry ready at /xxxxxlcat-monitor")
