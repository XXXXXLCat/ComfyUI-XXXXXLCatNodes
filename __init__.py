# -*- coding: utf-8 -*-
"""ComfyUI-XXXXXLCatNodes — lightweight system telemetry and resource reclamation.

Zero third-party dependencies: the standard library, ctypes, and an nvidia-smi
subprocess. Nothing like psutil is pulled in.
- A background sampler thread continuously collects CPU load, physical RAM,
  per-GPU utilization / VRAM / temperature, and system-drive free space.
- The menu bar (web/monitor.js) renders these live and offers one-tap VRAM / RAM
  cleanup buttons executed inside the ComfyUI process.
- Four custom nodes under the 🐈‍⬛XXXXXLCat brand (🐈‍⬛XXXXXLCat/Memory,
  🐈‍⬛XXXXXLCat/Sampling), all built on the new V3 node API (comfy_api /
  io.ComfyNode): Meow Stats🐈‍⬛, Purr VRAM🐈‍⬛, Tidy RAM🐈‍⬛,
  and H3 Image to Video🐈‍⬛.

Implementation is split across submodules: sensors (ctypes readers), telemetry
(sampler + route), reclamation (VRAM/RAM engine), and nodes (one class per file).
This file is only the entry point: it prints the banner, imports those modules,
and exposes the ComfyUI extension via ``comfy_entrypoint``.
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
    XXXXXLCatSystemMonitor,
    XXXXXLCatVRAMSweep,
    XXXXXLCatRAMReclaim,
    XXXXXLCatH3ImageToVideo,
)


# ============================================================ V3 扩展入口

from comfy_api.latest import ComfyExtension  # noqa: E402


class XXXXXLCatExtension(ComfyExtension):
    """Registers all 🐈‍⬛XXXXXLCat nodes through the new V3 node API."""

    async def get_node_list(self):
        return [
            XXXXXLCatSystemMonitor,
            XXXXXLCatVRAMSweep,
            XXXXXLCatRAMReclaim,
            XXXXXLCatH3ImageToVideo,
        ]


async def comfy_entrypoint() -> XXXXXLCatExtension:
    return XXXXXLCatExtension()


# ============================================================ 加载完成日志

try:
    import tomllib
    with open(os.path.join(os.path.dirname(__file__), "pyproject.toml"), "rb") as _pf:
        _PKG_VERSION = tomllib.load(_pf).get("project", {}).get("version", "unknown")
except Exception:
    _PKG_VERSION = "unknown"

print(f"[XXXXXLCat] ComfyUI-XXXXXLCatNodes v{_PKG_VERSION} loaded")
print("[XXXXXLCat] 4 nodes registered via comfy_entrypoint (new V3 node API)")
print("[XXXXXLCat] Menu-bar telemetry ready at /xxxxxlcat-monitor")
