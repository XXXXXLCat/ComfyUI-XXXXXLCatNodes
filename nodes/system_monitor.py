# -*- coding: utf-8 -*-
"""Meow Stats🐈‍⬛ — expose live telemetry as workflow outputs."""

from comfy_api.latest import io

from ..telemetry import _telemetry, _telemetry_lock


class XXXXXLCatSystemMonitor(io.ComfyNode):
    """Expose live telemetry as workflow outputs.

    Returns the same six values shown in the menu bar — CPU, RAM, GPU, VRAM,
    temperature, and system-drive free space — as plain strings, so downstream
    nodes or captions can consume them directly.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛SystemMonitor",
            display_name="Meow Stats🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/Memory",
            description=(
                "Expose live system telemetry as six string outputs (cpu, ram, gpu, "
                "vram, temp, disk), mirroring the menu-bar monitor. An optional "
                "passthrough carries any value through unchanged."
            ),
            inputs=[
                io.AnyType.Input(
                    "passthrough",
                    optional=True,
                    tooltip="Optional value passed through unchanged.",
                ),
            ],
            outputs=[
                io.String.Output(display_name="cpu"),
                io.String.Output(display_name="ram"),
                io.String.Output(display_name="gpu"),
                io.String.Output(display_name="vram"),
                io.String.Output(display_name="temp"),
                io.String.Output(display_name="disk"),
            ],
        )

    @classmethod
    def execute(cls, passthrough=None, **kwargs):
        with _telemetry_lock:
            c = dict(_telemetry)

        def pct(d, key):
            v = d.get(key) if d else None
            return "N/A" if v is None else f"{v:.0f}%"

        def gb(v):
            return "N/A" if v is None else f"{v:.1f}G"

        cpu = pct(c.get("cpu"), "percent")
        ram_d = c.get("ram")
        ram = "N/A" if not ram_d else f"{gb(ram_d['used_gb'])}/{gb(ram_d['total_gb'])}"
        gpu_d = (c.get("gpus") or [None])[0]
        if gpu_d:
            gpu = pct(gpu_d, "usage")
            vram = f"{gb(gpu_d['vram_used_gb'])}/{gb(gpu_d['vram_total_gb'])}"
            temp = "N/A" if gpu_d.get("temp") is None else f"{gpu_d['temp']:.0f}°C"
        else:
            gpu = vram = temp = "N/A"
        disk_d = c.get("disk")
        disk = "N/A" if not disk_d else f"{gb(disk_d['free_gb'])}/{gb(disk_d['total_gb'])}"
        return io.NodeOutput(cpu, ram, gpu, vram, temp, disk)
