# -*- coding: utf-8 -*-
"""Purr VRAM🐈‍⬛ — on-demand GPU VRAM release node."""

import gc

from comfy_api.latest import io

from ..reclamation import _release_vram
from .. import sensors


class XXXXXLCatVRAMSweep(io.ComfyNode):
    """Free GPU VRAM on demand and report what was recovered.

    Two independent toggles drive the release: unload all models and/or sweep
    the CUDA caches. A third toggle, Force GC, runs an extra garbage collection
    and CUDA synchronize afterwards for a more thorough squeeze. Each internal
    stage is isolated, so a failure in one is logged and skipped without
    aborting the rest. The freed amount is returned both to the console and as a
    STRING report output so it can be wired into a workflow.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛VRAMSweep",
            display_name="Purr VRAM🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/Memory",
            description=(
                "Release GPU VRAM on demand and return a STRING report of what was "
                "recovered. Two toggles choose the release scope (unload models, "
                "sweep CUDA caches); Force GC adds an extra collect + synchronize. "
                "Each stage is isolated, so one failing does not abort the rest."
            ),
            is_output_node=True,
            not_idempotent=True,
            inputs=[
                io.Boolean.Input(
                    "offload_model",
                    default=True,
                    display_name="Unload models",
                    tooltip="Unload all models from VRAM before releasing.",
                ),
                io.Boolean.Input(
                    "offload_cache",
                    default=True,
                    display_name="Sweep CUDA caches",
                    tooltip="Sweep CUDA caches before releasing.",
                ),
                io.Boolean.Input(
                    "force_gc",
                    default=False,
                    optional=True,
                    display_name="Force GC",
                    tooltip="Run an extra gc.collect() + cuda.synchronize() afterwards for a deeper squeeze.",
                ),
                io.AnyType.Input(
                    "anything",
                    optional=True,
                    tooltip="Optional value passed through unchanged.",
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="anything"),
                io.String.Output(display_name="report"),
            ],
        )

    @classmethod
    def execute(cls, offload_model, offload_cache, force_gc=False, anything=None, **kwargs):
        parts = []
        try:
            before, after = _release_vram(unload_models=offload_model, sweep_cache=offload_cache)
            if force_gc:
                gc.collect()
                try:
                    import torch
                    torch.cuda.synchronize()
                except Exception:
                    pass
            if before is not None and after is not None:
                freed = (before - after) / (1024 ** 3)
                print(f"[XXXXXLCat] VRAM released ~{freed:.1f} GB (unload={offload_model}, sweep={offload_cache}, gc={force_gc})")
                parts.append(f"VRAM freed ~{freed:.1f} GB")
            else:
                print("[XXXXXLCat] VRAM release finished (no CUDA context to measure)")
                parts.append("VRAM release finished (no CUDA context to measure)")
        except Exception as exc:
            print(f"[XXXXXLCat] VRAM release failed: {exc}")
            parts.append(f"VRAM release failed: {exc}")
        report = " | ".join(parts) if parts else "VRAM release finished"
        return io.NodeOutput(anything, report)
