# -*- coding: utf-8 -*-
"""Tidy RAM🐈‍⬛ — on-demand physical memory reclamation node."""

from comfy_api.latest import io

from ..reclamation import _reclaim_ram
from .. import sensors


class XXXXXLCatRAMReclaim(io.ComfyNode):
    """Reclaim physical memory on demand and report what was recovered.

    Three independent toggles select which passes run — system file cache,
    every process's working set, and this process's own DLLs — plus an integer
    Retry times that repeats the selected pass(es). A Dry Run toggle skips the
    actual trimming and only reports the current physical-memory baseline,
    useful for checking headroom before a heavy generation. Windows-only (ctypes
    APIs); every pass is skipped silently on other platforms. The freed amount
    is returned both to the console and as a STRING report output.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛RAMReclaim",
            display_name="Tidy RAM🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/Memory",
            description=(
                "Reclaim physical memory on demand and return a STRING report of what "
                "was recovered. Three toggles pick the passes (file cache, process "
                "working sets, own DLLs); Retry times repeats them. Dry Run reports the "
                "baseline without trimming. Windows-only (ctypes); no-ops elsewhere."
            ),
            is_output_node=True,
            not_idempotent=True,
            inputs=[
                io.Boolean.Input(
                    "clean_file_cache",
                    default=True,
                    display_name="Clean file cache",
                    tooltip="Trim the system file cache.",
                ),
                io.Boolean.Input(
                    "clean_processes",
                    default=True,
                    display_name="Trim process working sets",
                    tooltip="Trim every process's working set.",
                ),
                io.Boolean.Input(
                    "clean_dlls",
                    default=True,
                    display_name="Trim own DLLs",
                    tooltip="Trim this process's own loaded DLLs.",
                ),
                io.Int.Input(
                    "retry_times",
                    default=3,
                    min=1,
                    max=10,
                    step=1,
                    display_name="Retry times",
                    tooltip="How many times to repeat the selected pass(es).",
                ),
                io.Boolean.Input(
                    "dry_run",
                    default=False,
                    optional=True,
                    display_name="Dry Run",
                    tooltip="Skip the actual trimming and only report the current physical-memory baseline.",
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
    def execute(cls, clean_file_cache, clean_processes, clean_dlls, retry_times, dry_run=False, anything=None, **kwargs):
        parts = []
        try:
            if dry_run:
                snap = sensors._read_physical_memory()
                if snap:
                    parts.append(
                        f"Dry run: no changes applied · baseline {snap['percent']}% used "
                        f"({snap['used_gb']:.1f}/{snap['total_gb']:.1f} GB)"
                    )
                    print(f"[XXXXXLCat] RAM dry run — baseline {snap['percent']}% used ({snap['used_gb']:.1f}/{snap['total_gb']:.1f} GB)")
                else:
                    parts.append("Dry run: no changes applied")
                    print("[XXXXXLCat] RAM dry run — no sensor data")
            else:
                before, after = _reclaim_ram(
                    trim_cache=clean_file_cache, trim_processes=clean_processes,
                    trim_dlls=clean_dlls, passes=retry_times,
                )
                if before and after:
                    freed = round(before["used_gb"] - after["used_gb"], 1)
                    print(
                        f"[XXXXXLCat] RAM released [{before['percent']}% -> {after['percent']}%, ~{freed:.1f} GB freed]"
                    )
                    parts.append(
                        f"RAM freed ~{freed:.1f} GB [{before['percent']}% -> {after['percent']}%]"
                    )
                else:
                    print("[XXXXXLCat] RAM release finished")
                    parts.append("RAM release finished")
        except Exception as exc:
            print(f"[XXXXXLCat] RAM release failed: {exc}")
            parts.append(f"RAM release failed: {exc}")
        report = " | ".join(parts) if parts else "RAM release finished"
        return io.NodeOutput(anything, report)
