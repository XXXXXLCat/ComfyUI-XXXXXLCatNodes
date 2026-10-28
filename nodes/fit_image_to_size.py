# -*- coding: utf-8 -*-
"""Fit Image to Size 🐈‍⬛ — force any image onto an exact target canvas.

Takes the target ``width`` / ``height`` from its inputs (typically wired from
Resolution Selector 🐈‍⬛) and returns an image that is *exactly* that size, so a
downstream model never has to resize it again. Two modes:

* ``crop`` — scale to **cover** the target box (aspect preserved, uniform scale
  ``max(tw/w, th/h)``) and centre-crop the overflow. No borders, loses edge
  content when the input ratio differs from the target ratio.
* ``pad``  — scale to **contain** the target box (uniform scale
  ``min(tw/w, th/h)``) and centre the result on a ``pad_color`` canvas. Keeps
  every pixel, adds borders.

Both modes scale by a single uniform factor, so the input is never stretched —
that is the whole point: feeding a model a pre-stretched image bakes the
distortion in, while crop/pad leaves the subject at its true proportions.

``multiple`` snaps the requested size to that grid (nearest, clamped) before
anything is scaled. Diffusers-style models — Qwen-Image included — re-align the
image inside their own pipeline anyway, so a target that is not already on their
grid gets silently re-scaled and softened. Leaving it at the default 32 makes
the size we output the size the model actually sees. Set it to 1 to honour the
requested width/height verbatim.

The outputs echo the size that was actually produced (after ``multiple``), so
they can be wired into latent nodes without recomputing the snap by hand.

Resizing itself is delegated to ``comfy.utils.common_upscale`` (the same lanczos
path the official scale nodes use) rather than a hand-rolled interpolate, so
quality matches the rest of the graph.
"""

import torch

from comfy_api.latest import io

import comfy.utils


MAX_RESOLUTION = 16384

CROP = "crop"
PAD = "pad"


def _mode_options() -> list[io.DynamicCombo.Option]:
    """Crop as the only variant that needs no extra inputs, then pad + its colour.

    As with Resolution Selector, the colour is declared inside the ``pad``
    option so it is only shown — and only sent — when it can actually do
    something.
    """
    return [
        io.DynamicCombo.Option(CROP, []),
        io.DynamicCombo.Option(
            PAD,
            [
                io.Float.Input(
                    "pad_color",
                    default=0.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    display_name="填充颜色",
                    tooltip="Grey level of the border added in pad mode (0 = black, 1 = white).",
                )
            ],
        ),
    ]


def _snap(value: int, multiple: int) -> int:
    """Round to the nearest multiple, never below one multiple."""
    if multiple <= 1:
        return max(1, value)
    return max(multiple, int(round(value / multiple)) * multiple)


def _to_samples(image: torch.Tensor) -> torch.Tensor:
    """[B,H,W,C] / [H,W,C] -> [B,C,H,W]."""
    samples = image if image.dim() == 4 else image.unsqueeze(0)
    return samples.movedim(-1, 1)


def _fit(image: torch.Tensor, width: int, height: int, mode: str, pad_color: float) -> torch.Tensor:
    """Scale ``image`` onto a width x height canvas; returns [B,H,W,C] float tensor."""
    samples = _to_samples(image)
    batch, channels, src_h, src_w = samples.shape

    if src_w == width and src_h == height:
        return samples.movedim(1, -1)

    if mode == PAD:
        # Contain: one uniform scale that makes the image fit inside the box,
        # then centre it on a canvas of the requested colour.
        scale = min(width / src_w, height / src_h)
        inner_w = max(1, min(width, int(round(src_w * scale))))
        inner_h = max(1, min(height, int(round(src_h * scale))))
        # "disabled" is a plain resize — safe here because inner_w/inner_h were
        # derived with a single uniform factor, so no aspect change happens.
        inner = comfy.utils.common_upscale(samples, inner_w, inner_h, "lanczos", "disabled")
        canvas = torch.full(
            (batch, channels, height, width),
            float(pad_color),
            dtype=inner.dtype,
            device=inner.device,
        )
        top = (height - inner_h) // 2
        left = (width - inner_w) // 2
        canvas[:, :, top:top + inner_h, left:left + inner_w] = inner
        return canvas.movedim(1, -1)

    # Crop (default): common_upscale's "center" already does cover-scale +
    # centre-crop in one pass, using the same uniform factor as above.
    return comfy.utils.common_upscale(samples, width, height, "lanczos", "center").movedim(1, -1)


class XXXXXLCatFitImageToSize(io.ComfyNode):
    """Scale an image onto an exact target size by cropping or padding, never stretching it."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛FitImageToSize",
            display_name="Fit Image to Size 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/image",
            search_aliases=[
                "fit", "resize", "crop", "pad", "letterbox", "aspect",
                "cover", "contain", "canvas", "target size", "align",
            ],
            description=(
                "Force an image onto an exact width x height canvas without stretching it. "
                "Target size is taken from the width/height inputs, so it can be wired from "
                "Resolution Selector. 'crop' scales to cover the box and centre-crops the "
                "overflow; 'pad' scales to fit inside it and centres the result on a "
                "pad_color border. 'multiple' snaps the requested size to that grid first "
                "(default 32), because diffusion pipelines re-align the image internally "
                "anyway — outputting a size already on their grid avoids a second, softer "
                "resize. The width/height outputs report the size actually produced."
            ),
            inputs=[
                io.Image.Input("image", tooltip="Image to fit."),
                io.Int.Input(
                    "width",
                    default=1024,
                    min=16,
                    max=MAX_RESOLUTION,
                    step=8,
                    tooltip="Target canvas width. Wire this from Resolution Selector to keep both ends in sync.",
                ),
                io.Int.Input(
                    "height",
                    default=1024,
                    min=16,
                    max=MAX_RESOLUTION,
                    step=8,
                    tooltip="Target canvas height.",
                ),
                io.Int.Input(
                    "multiple",
                    default=32,
                    min=1,
                    max=256,
                    step=1,
                    advanced=True,
                    tooltip="Snap the target size to the nearest multiple of this value before scaling. Default 32 matches what Qwen-Image and other diffusion pipelines align to internally; set 1 to use the requested width/height verbatim.",
                ),
                io.DynamicCombo.Input(
                    "fit_mode",
                    options=_mode_options(),
                    tooltip="'crop' covers the target box and cuts the overflow; 'pad' fits inside it and fills the rest with pad_color.",
                ),
            ],
            outputs=[
                io.Image.Output("image", tooltip="Image scaled onto the target canvas."),
                io.Int.Output(
                    "out_width",
                    display_name="width",
                    tooltip="Width actually produced, after snapping width to the multiple.",
                ),
                io.Int.Output(
                    "out_height",
                    display_name="height",
                    tooltip="Height actually produced, after snapping height to the multiple.",
                ),
            ],
        )

    @classmethod
    def execute(cls, image, width, height, multiple, fit_mode) -> io.NodeOutput:
        selected = fit_mode["fit_mode"]
        pad_color = float(fit_mode.get("pad_color", 0.0))

        target_w = _snap(int(width), int(multiple))
        target_h = _snap(int(height), int(multiple))

        fitted = _fit(image, target_w, target_h, selected, pad_color)
        return io.NodeOutput(fitted, target_w, target_h)
