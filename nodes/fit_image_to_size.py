# -*- coding: utf-8 -*-
"""Fit Image to Size 🐈‍⬛ — size an image from aspect ratio + megapixels, then
crop or pad onto exactly that size.

The target size is computed the same way Resolution Selector does it — an
aspect ratio and a megapixel target, rounded to the nearest ``multiple`` — so
the two nodes agree pixel for pixel. The one addition is an **Auto** ratio that
takes its ratio from the image itself, which makes the node useful on its own:
the picture is rescaled to the requested pixel count at its own proportions, so
nothing is cropped or padded beyond the rounding.

Two modes decide what happens when the target ratio and the image ratio differ:

* ``crop`` — scale to **cover** the target box (aspect preserved, uniform scale
  ``max(tw/w, th/h)``) and centre-crop the overflow. No borders, loses edge
  content.
* ``pad``  — scale to **contain** the target box (uniform scale
  ``min(tw/w, th/h)``) and centre the result on a ``pad_color`` canvas. Keeps
  every pixel, adds borders.

Both modes scale by a single uniform factor, so the input is never stretched —
feeding a model a pre-stretched image bakes the distortion in, while crop/pad
leaves the subject at its true proportions.

``multiple`` snaps the computed size to that grid (nearest, clamped). Diffusers
style models — Qwen-Image included — re-align the image inside their own
pipeline anyway, so a target that is not already on their grid gets silently
re-scaled and softened. The default of 32 makes the size we output the size the
model actually sees; set it to 1 to keep the raw megapixel result.

The outputs echo the size that was actually produced (after ``multiple``), plus
``resolution`` — the equivalent square edge, ``round(sqrt(width*height))``,
which is 1024 for a 1 MP 1024x1024 result. That is the scalar form models and
samplers usually want when they ask for a resolution.

Resizing itself is delegated to ``comfy.utils.common_upscale`` (the same lanczos
path the official scale nodes use) rather than a hand-rolled interpolate, so
quality matches the rest of the graph.
"""

import math

import torch

from comfy_api.latest import io

import comfy.utils


CROP = "crop"
PAD = "pad"
AUTO = "Auto (from image)"

# Same table as Resolution Selector 🐈‍⬛, so the two nodes stay interchangeable.
ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


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


def _target_size(ratio_w: int, ratio_h: int, megapixels: float, multiple: int) -> tuple[int, int]:
    """Aspect ratio + megapixel target -> (width, height), snapped to ``multiple``.

    Mirrors Resolution Selector's arithmetic exactly, so the same ratio and
    megapixel value give the same size on both nodes.
    """
    total_pixels = megapixels * 1024 * 1024
    scale = math.sqrt(total_pixels / (ratio_w * ratio_h))
    width = round(ratio_w * scale / multiple) * multiple
    height = round(ratio_h * scale / multiple) * multiple
    # A zero megapixel target would collapse the canvas; keep one tile instead.
    return max(multiple, width), max(multiple, height)


def _image_size(image: torch.Tensor) -> tuple[int, int]:
    """(width, height) of an IMAGE tensor, which ComfyUI hands over as [B,H,W,C]."""
    if image.dim() == 4:
        return int(image.shape[2]), int(image.shape[1])
    return int(image.shape[1]), int(image.shape[0])


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
    """Size an image from aspect ratio + megapixels, then crop or pad onto it without stretching."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛FitImageToSize",
            display_name="Fit Image to Size 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/image",
            search_aliases=[
                "fit", "resize", "crop", "pad", "letterbox", "aspect ratio",
                "cover", "contain", "canvas", "megapixel", "resolution", "align",
            ],
            description=(
                "Work out a target size from aspect ratio + megapixels exactly as Resolution Selector "
                "does (same ratios, same 0.01 megapixel step, same rounding to the multiple), then "
                "scale the image onto it without stretching. 'Auto' takes the ratio from the image "
                "itself, so the picture is rescaled to the requested pixel count at its own "
                "proportions. 'crop' covers the target box and centre-crops the overflow; 'pad' fits "
                "inside it and centres the result on a pad_color border. Committing to a size already "
                "on the multiple grid avoids a second, softer resize inside the diffusion pipeline. "
                "Outputs the image, the size actually produced, and resolution — the equivalent "
                "square edge, round(sqrt(width*height)), i.e. 1024 for a 1 MP 1024x1024. A live "
                "preview inside the node shows the resulting size as the inputs change."
            ),
            inputs=[
                io.Image.Input("image", tooltip="Image to fit."),
                io.Combo.Input(
                    "aspect_ratio",
                    options=[AUTO, *ASPECT_RATIOS],
                    default=AUTO,
                    tooltip="Ratio used to derive the target size. 'Auto' uses the input image's own ratio.",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.01,
                    max=16.0,
                    step=0.01,
                    tooltip="Target total megapixels, adjustable to two decimal places. 1.0 MP gives 1024x1024 for a square ratio. Same input as Resolution Selector.",
                ),
                io.ResolutionPreview.Input(
                    "preview",
                    # The built-in preview can only derive a size from
                    # (ratio, megapixels, multiple). Our ratio selector is a
                    # plain combo whose "Auto" option is not a ratio at all, so
                    # the preview is pointed at two internal widgets that
                    # `web/fit_image_to_size.js` keeps filled: in Auto mode with
                    # the source image's pixel size (which is the ratio the node
                    # itself computes with), otherwise with the chosen ratio.
                    ratio_widget="preview_ratio",
                    megapixels_widget="preview_megapixels",
                    multiple_widget="multiple",
                    tooltip="Live preview of the target size this node will produce.",
                ),
                io.Int.Input(
                    "multiple",
                    default=32,
                    min=1,
                    max=256,
                    step=1,
                    advanced=True,
                    tooltip="Snap the computed size to the nearest multiple of this value. Default 32 matches the grid Qwen-Image and other diffusion pipelines align to internally; set 1 to keep the raw megapixel result.",
                ),
                io.DynamicCombo.Input(
                    "fit_mode",
                    options=_mode_options(),
                    tooltip="'crop' covers the target box and cuts the overflow; 'pad' fits inside it and fills the rest with pad_color.",
                ),
                # Internal feeds for the preview widget above; always hidden by
                # the front end and never meant to be edited by hand. Optional
                # so that hand-written API prompts are not forced to supply
                # them — the graph always sends them, and `execute` ignores them
                # either way.
                io.String.Input(
                    "preview_ratio",
                    default="1:1",
                    optional=True,
                    socketless=True,
                    tooltip="Internal: the ratio the resolution preview reads.",
                ),
                io.Float.Input(
                    "preview_megapixels",
                    default=1.0,
                    min=0.0,
                    max=1024.0,
                    step=0.000001,
                    optional=True,
                    socketless=True,
                    tooltip="Internal: the megapixel value the resolution preview reads.",
                ),
            ],
            outputs=[
                io.Image.Output("image", tooltip="Image scaled onto the computed canvas."),
                io.Int.Output(
                    "out_width",
                    display_name="width",
                    tooltip="Width actually produced, after rounding to the multiple.",
                ),
                io.Int.Output(
                    "out_height",
                    display_name="height",
                    tooltip="Height actually produced, after rounding to the multiple.",
                ),
                io.Int.Output(
                    "out_resolution",
                    display_name="resolution",
                    tooltip="Equivalent square edge of the result, round(sqrt(width*height)). 1024 for a 1 MP square.",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        aspect_ratio,
        megapixels,
        multiple,
        fit_mode,
        preview=None,
        preview_ratio=None,
        preview_megapixels=None,
    ) -> io.NodeOutput:
        selected = fit_mode["fit_mode"]
        pad_color = float(fit_mode.get("pad_color", 0.0))

        if aspect_ratio == AUTO:
            # The image's own ratio: scaling to the megapixel target then costs
            # no crop and no padding beyond the rounding to `multiple`.
            src_w, src_h = _image_size(image)
            ratio_w, ratio_h = src_w, src_h
        else:
            ratio_w, ratio_h = ASPECT_RATIOS[aspect_ratio]

        width, height = _target_size(ratio_w, ratio_h, megapixels, multiple)
        fitted = _fit(image, width, height, selected, pad_color)
        resolution = int(round(math.sqrt(width * height)))
        return io.NodeOutput(fitted, width, height, resolution)
