"""V3 node that brings an asset from the infinite canvas into a workflow."""

from __future__ import annotations

import os

import folder_paths
import numpy as np
import torch
from PIL import Image, ImageOps
from comfy_api.latest import io

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".avif"}


def _resolve(asset: str) -> str:
    base = folder_paths.get_input_directory()
    return os.path.abspath(os.path.join(base, asset))


class InfCanvasAssetLoader(io.ComfyNode):
    """Load a media asset placed on the infinite canvas.

    ``asset`` is a path relative to ComfyUI's ``input`` directory, e.g.
    ``infcanvas/photo_20261115.png``. Images are returned as IMAGE tensors;
    other media types return a neutral placeholder image plus their path so
    downstream text/string nodes can still consume them.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="InfCanvas.AssetLoader",
            display_name="Infinite Canvas Asset",
            category="infinite_canvas",
            description="Load an asset from the embedded infinite canvas.",
            inputs=[
                io.String.Input(
                    "asset",
                    default="",
                    placeholder="infcanvas/photo.png",
                    tooltip="Path relative to ComfyUI input directory",
                ),
            ],
            outputs=[
                io.Image.Output("IMAGE"),
                io.String.Output("PATH"),
            ],
        )

    @classmethod
    def validate_inputs(cls, asset: str):
        if not asset:
            return True
        base = folder_paths.get_input_directory()
        full = _resolve(asset)
        if not folder_paths.is_within_directory(base, full):
            return "Asset path must stay inside the ComfyUI input directory"
        return True

    @classmethod
    def fingerprint_inputs(cls, asset: str):
        full = _resolve(asset)
        if os.path.isfile(full):
            stat = os.stat(full)
            return (asset, stat.st_mtime_ns, stat.st_size)
        return (asset, None, None)

    @classmethod
    def execute(cls, asset: str):
        placeholder = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        if not asset:
            return io.NodeOutput(placeholder, "")
        full = _resolve(asset)
        if os.path.splitext(full)[1].lower() not in IMAGE_EXTS or not os.path.isfile(full):
            return io.NodeOutput(placeholder, asset)
        with Image.open(full) as raw:
            pil = ImageOps.exif_transpose(raw).convert("RGB")
            array = np.asarray(pil, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(array).unsqueeze(0)
        return io.NodeOutput(tensor, asset)
