# -*- coding: utf-8 -*-
"""Resolution Selector 🐈‍⬛ — the official ResolutionSelector node with a finer
megapixel step and a Custom aspect-ratio mode.

This mirrors ``comfy_extras/nodes_resolution.py`` except for a few things:

1. The ``megapixels`` float input steps by 0.01 instead of 0.1, so the target
   resolution can be set to two decimal places (e.g. 1.05 MP) rather than one;
   0 is also accepted and yields a 0×0 size.
2. The aspect-ratio selector is a ``DynamicCombo`` that adds a ``Custom`` option.
   When ``Custom`` is picked, two integer inputs (width / height) appear below and
   are used directly (rounded to the nearest ``multiple``); all other aspect
   ratios keep the original megapixel-based calculation.
3. The megapixel input is hidden while ``Custom`` is selected, because it has no
   effect on the result in that mode.

Everything else — the live resolution preview, the nearest-``multiple`` rounding,
and the integer width/height outputs — is unchanged.

The built-in preview can only turn (ratio, megapixels, multiple) into a size, and
"Custom" is not a ratio, so on its own it would show a dash in Custom mode. To
keep using it, the preview is pointed at two socketless inputs — ``preview_ratio``
and ``preview_megapixels`` — that ``web/resolution_selector.js`` keeps filled with
the effective ratio and megapixel target of whatever the node is doing. In Custom
mode those become "width:height" and width*height/1048576, which makes the
preview's own scale factor exactly 1, so it reproduces the node's rounding to the
nearest multiple. Both inputs are hidden by that script and ignored by ``execute``.
"""

import math
from enum import Enum
from typing_extensions import override
from comfy_api.latest import io


class AspectRatio(str, Enum):
    SQUARE = "1:1 (Square)"
    PHOTO_V = "2:3 (Portrait Photo)"
    PHOTO_H = "3:2 (Photo)"
    STANDARD_V = "3:4 (Portrait Standard)"
    STANDARD_H = "4:3 (Standard)"
    WIDESCREEN_V = "9:16 (Portrait Widescreen)"
    WIDESCREEN_H = "16:9 (Widescreen)"
    ULTRAWIDE_H = "21:9 (Ultrawide)"
    CUSTOM = "Custom"


ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    AspectRatio.SQUARE.value: (1, 1),
    AspectRatio.PHOTO_V.value: (2, 3),
    AspectRatio.PHOTO_H.value: (3, 2),
    AspectRatio.STANDARD_V.value: (3, 4),
    AspectRatio.STANDARD_H.value: (4, 3),
    AspectRatio.WIDESCREEN_V.value: (9, 16),
    AspectRatio.WIDESCREEN_H.value: (16, 9),
    AspectRatio.ULTRAWIDE_H.value: (21, 9),
}


def _aspect_ratio_options() -> list[io.DynamicCombo.Option]:
    # All fixed ratios first (no extra inputs), then the Custom option which
    # reveals editable width/height fields.
    options = [
        io.DynamicCombo.Option(value.value, [])
        for value in AspectRatio
        if value is not AspectRatio.CUSTOM
    ]
    options.append(
        io.DynamicCombo.Option(
            AspectRatio.CUSTOM.value,
            [
                io.Int.Input(
                    "custom_width",
                    default=1024,
                    min=1,
                    max=16384,
                    step=1,
                    display_name="宽度",
                    tooltip="Custom output width in pixels (rounded to the nearest multiple).",
                ),
                io.Int.Input(
                    "custom_height",
                    default=1024,
                    min=1,
                    max=16384,
                    step=1,
                    display_name="高度",
                    tooltip="Custom output height in pixels (rounded to the nearest multiple).",
                ),
            ],
        )
    )
    return options


class XXXXXLCatResolutionSelector(io.ComfyNode):
    """Calculate width and height from aspect ratio and megapixel target (2-decimal step, with a Custom size mode)."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛ResolutionSelector",
            display_name="Resolution Selector 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/utilities",
            search_aliases=["resolution", "megapixel", "aspect ratio", "width", "height", "empty latent size", "custom"],
            description=(
                "Calculate width and height from aspect ratio and megapixel target, with the "
                "megapixel target adjustable in steps of 0.01 (two decimal places) instead of the "
                "official node's 0.1; 0 is also accepted and yields a 0×0 size. Pick the 'Custom' "
                "aspect ratio to enter an explicit width and height instead of a megapixel target. "
                "Otherwise identical to the official Resolution Selector: same aspect ratios, live "
                "resolution preview, and nearest-multiple rounding of the result."
            ),
            inputs=[
                io.DynamicCombo.Input(
                    "aspect_ratio",
                    options=_aspect_ratio_options(),
                    tooltip="The aspect ratio for the output dimensions. Choose 'Custom' to set an explicit width and height.",
                ),
                io.Float.Input(
                    "megapixels",
                    default=1.0,
                    min=0.0,
                    max=16.0,
                    step=0.01,
                    tooltip="Target total megapixels, adjustable to two decimal places (0.01 steps). 1.0 MP ≈ 1024x1024 for square. 0 is allowed and yields a 0×0 size. Ignored when aspect ratio is 'Custom'.",
                ),
                io.ResolutionPreview.Input(
                    "preview",
                    # The built-in preview only knows how to derive a size from
                    # (ratio, megapixels, multiple), so it is pointed at two
                    # internal widgets that `web/resolution_selector.js` keeps
                    # filled with the effective ratio and megapixels of whatever
                    # the node is currently doing — including Custom mode, where
                    # the ratio is the entered width:height.
                    ratio_widget="preview_ratio",
                    megapixels_widget="preview_megapixels",
                    multiple_widget="multiple",
                    tooltip="Live preview of the calculated output resolution.",
                ),
                io.Int.Input(
                    id="multiple",
                    default=8,
                    min=8,
                    max=128,
                    step=4,
                    tooltip="Nearest multiple of the result to set the selected resolution to.",
                    advanced=True,
                ),
                # Internal feeds for the preview widget above; always hidden by
                # the front end and never meant to be edited by hand. Optional so
                # that hand-written API prompts are not forced to supply them —
                # the graph always sends them, and `execute` falls back to them
                # being absent anyway.
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
                    # Fine enough that no target derived from width*height is
                    # ever rounded on its way to the preview.
                    step=0.000001,
                    optional=True,
                    socketless=True,
                    tooltip="Internal: the megapixel value the resolution preview reads.",
                ),
            ],
            outputs=[
                io.Int.Output(
                    "width", tooltip="Calculated width in pixels multiplied by the selected multiple."
                ),
                io.Int.Output(
                    "height", tooltip="Calculated height in pixels multiplied by the selected multiple."
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        aspect_ratio: dict,
        megapixels: float,
        multiple: int,
        preview=None,
        preview_ratio=None,
        preview_megapixels=None,
    ) -> io.NodeOutput:
        selected = aspect_ratio["aspect_ratio"]
        if selected == AspectRatio.CUSTOM.value:
            width = round(aspect_ratio.get("custom_width", 1024) / multiple) * multiple
            height = round(aspect_ratio.get("custom_height", 1024) / multiple) * multiple
            return io.NodeOutput(width, height)

        w_ratio, h_ratio = ASPECT_RATIOS[selected]
        total_pixels = megapixels * 1024 * 1024
        scale = math.sqrt(total_pixels / (w_ratio * h_ratio))
        width = round(w_ratio * scale / multiple) * multiple
        height = round(h_ratio * scale / multiple) * multiple
        return io.NodeOutput(width, height)
