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
- Seven custom nodes under the 🐈‍⬛XXXXXLCat brand (🐈‍⬛XXXXXLCat/Memory,
  🐈‍⬛XXXXXLCat/Sampling, 🐈‍⬛XXXXXLCat/switch, 🐈‍⬛XXXXXLCat/group,
  🐈‍⬛XXXXXLCat/node, 🐈‍⬛XXXXXLCat/utilities): all built on the new V3 node API
  (comfy_api / io.ComfyNode) — Sweep VRAM 🐈‍⬛, Reclaim RAM 🐈‍⬛,
  H3 Image to Video 🐈‍⬛, Any Switch 🐈‍⬛, Group Control 🐈‍⬛,
  Node Control 🐈‍⬛, and Resolution Selector 🐈‍⬛ (the official
  resolution node, with a 2-decimal megapixel step).

Implementation is split across submodules: sensors (ctypes readers), telemetry
(sampler + route), reclamation (VRAM/RAM engine), and nodes (one class per file).
This file is only the entry point: it prints the banner, imports those modules,
and exposes the ComfyUI extension via ``comfy_entrypoint`` (the 7 V3 nodes).
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
)


# ============================================================ V3 扩展入口

from comfy_api.latest import ComfyExtension  # noqa: E402


class XXXXXLCatExtension(ComfyExtension):
    """Registers the V3 🐈‍⬛XXXXXLCat nodes through the new V3 node API."""

    async def get_node_list(self):
        return list(_NODE_CLASSES)


# Kept in one place so the load log can never drift from the real registration.
_NODE_CLASSES = [
    XXXXXLCatVRAMSweep,
    XXXXXLCatRAMReclaim,
    XXXXXLCatH3ImageToVideo,
    XXXXXLCatAnySwitch,
    XXXXXLCatGroupControl,
    XXXXXLCatNodeControl,
    XXXXXLCatResolutionSelector,
]


async def comfy_entrypoint() -> XXXXXLCatExtension:
    # The packs only ship zh + en, and core looks a bundle up by its exact folder
    # name — so a zh-TW UI would show our nodes in English. Alias every zh-*
    # locale to the zh bundle (matches what web/i18n.js and the login page do).
    try:
        from . import locale_alias

        locale_alias.install()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[XXXXXLCat] zh-* locale alias skipped: {exc}")

    # Per-user password auth gate — must be installed BEFORE the asset-isolation
    # patches so the validated user id feeds input/<user>/ & output/<user>/.
    # Only active when ComfyUI is launched with --multi-user.
    try:
        from .nodes import multi_user_auth

        multi_user_auth.install()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[XXXXXLCat] multi-user password auth skipped: {exc}")

    # Per-user asset isolation (input/<user>/ & output/<user>/) — only when
    # ComfyUI is launched with --multi-user. No-op (and zero impact) otherwise.
    try:
        from .nodes import multi_user_assets

        multi_user_assets.install()
    except Exception as exc:  # pragma: no cover - defensive
        print(f"[XXXXXLCat] multi-user asset isolation skipped: {exc}")

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
