# -*- coding: utf-8 -*-
"""Background telemetry sampler and the menu-bar data route.

A daemon thread polls the Windows sensors on a fixed interval and keeps the
latest readings in a shared, lock-protected dict. The dict is served verbatim
to web/monitor.js through a GET route registered on the ComfyUI PromptServer.
"""

import threading
import time

from aiohttp import web
from server import PromptServer

from . import sensors

_telemetry = {}
_telemetry_lock = threading.Lock()
_prev_cpu_times = None
_last_gpu_poll = 0.0


def _collect_sample():
    """Poll every sensor once and merge fresh readings into the cache.

    GPU is polled at most once per second to avoid spamming nvidia-smi; on any
    read failure the previous value is kept so the front end never flickers to
    a blank/zero state.
    """
    global _prev_cpu_times, _last_gpu_poll
    snapshot = {}
    now = time.time()

    mem = sensors._read_physical_memory()
    if mem is not None:
        snapshot["ram"] = mem

    if now - _last_gpu_poll >= 1.0:
        _last_gpu_poll = now
        gpus = sensors._read_gpu()
        if gpus is not None:
            snapshot["gpus"] = gpus

    ticks = sensors._read_cpu_times()
    if ticks is not None:
        if _prev_cpu_times is not None:
            p_idle, p_kern, p_user = _prev_cpu_times
            c_idle, c_kern, c_user = ticks
            delta_idle = c_idle - p_idle
            delta_total = (c_kern - p_kern) + (c_user - p_user)
            if delta_total > 0:
                snapshot["cpu"] = {"percent": round(100.0 * (1.0 - delta_idle / delta_total), 1)}
        _prev_cpu_times = ticks

    disk = sensors._read_disk_space()
    if disk is not None:
        snapshot["disk"] = disk

    snapshot["ts"] = now
    with _telemetry_lock:
        # update, not replace: keeps last good GPU/disk values if a poll fails
        _telemetry.update(snapshot)


def _sampler_loop():
    """Endless sample loop; never raises out of the thread."""
    while True:
        try:
            _collect_sample()
        except Exception:
            pass
        time.sleep(0.5)


threading.Thread(target=_sampler_loop, daemon=True).start()


@PromptServer.instance.routes.get("/xxxxxlcat-monitor")
async def _telemetry_route(request):
    """Serve the current telemetry snapshot as JSON for the menu bar."""
    with _telemetry_lock:
        return web.json_response(dict(_telemetry))
