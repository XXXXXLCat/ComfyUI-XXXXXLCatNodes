# -*- coding: utf-8 -*-
"""Image batching shared by the 🐈‍⬛XXXXXLCat nodes that feed pictures to a model.

Collect Images 🐈‍⬛ and Generate Text (Multi Image) 🐈‍⬛ promise the same thing —
several inputs in, one batch out, every frame on a common canvas with its aspect
ratio intact — so that promise lives here and the two nodes cannot drift apart.

Why the canvas dance at all: a text encoder that walks a batch computes one
target size from the batch's height and width (``comfy/text_encoders/gemma4.py``,
frame loop around line 1506), so frames must already agree on their size. The
two rules that follow from the use case:

* **Never stretch.** Frames are scaled to fit and padded with a constant fill.
  A stretched face or logo is exactly what a model then describes wrongly.
* **Never enlarge.** A frame smaller than the canvas keeps its own pixels and is
  centered; scaling it up would invent no detail while spending the model's
  per-image token budget on it.

The canvas starts as the largest input (``size_mode``) and is capped by
``max_side``: the tokenizer shrinks each frame to its own budget regardless
(~280 soft tokens, roughly an 800x800 equivalent), so a canvas beyond that only
costs memory before the shrink.
"""

import logging
import re

import torch

from comfy_api.latest import io

import comfy.utils

LOG = "[XXXXXLCat images]"

MAX_IMAGES = 12

SLOT_PREFIX = "image_"

SIZE_MODES = ["largest", "first", "square"]

PAD_COLORS = {"gray": 0.5, "black": 0.0, "white": 1.0}

SIZE_TOOLTIP = (
    "Common canvas: largest = widest and tallest of all inputs; first = the first "
    "socket's size; square = one square holding the largest side. Frames are scaled "
    "to fit and padded with the fill colour, never stretched."
)

PAD_TOOLTIP = "Fill for the padding bars. Mid gray is the least suggestive to describe."

CAP_TOOLTIP = (
    "Cap for the canvas' long side, 0 for no cap. The text encoder shrinks every frame "
    "to its own token budget anyway (roughly an 800x800 equivalent), so a larger canvas "
    "only costs memory before that shrink."
)


def slot_order(name):
    """Sort autogrow slots by their trailing number, not as strings.

    ``image_10`` sorts before ``image_2`` lexicographically, which would silently
    reorder a stack of ten or more images.
    """
    match = re.search(r"(\d+)$", str(name))
    return (0, int(match.group(1))) if match else (1, 0)


def collect_slots(images):
    """Autogrow payload -> list of [B, H, W, C] tensors, in slot order."""
    if not images:
        return []
    tensors = []
    for name in sorted(images, key=slot_order):
        value = images[name]
        if value is None:
            continue
        tensor = value if torch.is_tensor(value) else torch.as_tensor(value)
        if tensor.dim() == 3:
            tensor = tensor.unsqueeze(0)
        if tensor.shape[0] > 0:
            tensors.append(tensor)
    return tensors


def canvas_size(mode, frames):
    """Common canvas for every frame, before the ``max_side`` cap.

    ``frames`` are [1, C, H, W] — the whole pipeline works on that layout and only
    the final batch is put back to ComfyUI's [B, H, W, C].
    """
    height = max(int(frame.shape[2]) for frame in frames)
    width = max(int(frame.shape[3]) for frame in frames)
    if mode == "first":
        height, width = int(frames[0].shape[2]), int(frames[0].shape[3])
    elif mode == "square":
        height = width = max(height, width)
    return height, width


def cap_side(height, width, max_side):
    """Downscale the canvas so its long side stays within ``max_side``."""
    if not max_side or max_side <= 0:
        return height, width
    longest = max(height, width)
    if longest <= max_side:
        return height, width
    scale = max_side / float(longest)
    return max(1, int(height * scale)), max(1, int(width * scale))


def fit_frame(frame, height, width, fill):
    """Scale a [1, C, H, W] frame to fit, centered, on a constant canvas.

    Scale is capped at 1.0: frames are never enlarged. The padding is centered, so
    the leftovers differ by at most one pixel per side.
    """
    _, _, frame_h, frame_w = frame.shape
    scale = min(height / frame_h, width / frame_w, 1.0)
    target_h = max(1, int(round(frame_h * scale)))
    target_w = max(1, int(round(frame_w * scale)))
    out = frame
    if (target_h, target_w) != (frame_h, frame_w):
        out = comfy.utils.common_upscale(out, target_w, target_h, "bilinear", "center")
    top = (height - target_h) // 2
    left = (width - target_w) // 2
    bottom = height - target_h - top
    right = width - target_w - left
    if top or bottom or left or right:
        out = torch.nn.functional.pad(out, (left, right, top, bottom), mode="constant", value=fill)
    return out


def batch_slots(images, size_mode="largest", pad_color="gray", max_side=1024, allow_empty=False, log=LOG):
    """Autogrow payload -> one [N, H, W, C] batch, or None when nothing is connected.

    ``allow_empty`` decides what an empty payload means: None (a node that can also
    run without images) or a ValueError with a readable message (a node whose whole
    job is images).
    """
    slots = collect_slots(images)
    if not slots:
        if allow_empty:
            return None
        raise ValueError(f"{log} no images connected; attach at least one to the images input")

    frames = [slot[i:i + 1].movedim(-1, 1) for slot in slots for i in range(slot.shape[0])]
    if pad_color not in PAD_COLORS:
        logging.warning("%s unknown pad color %r, using gray", log, pad_color)
    fill = PAD_COLORS.get(pad_color, PAD_COLORS["gray"])

    height, width = canvas_size(size_mode if size_mode in SIZE_MODES else "largest", frames)
    height, width = cap_side(height, width, max_side)

    batched = torch.cat([fit_frame(frame, height, width, fill) for frame in frames], dim=0)
    out = batched.movedim(1, -1)

    logging.info(
        "%s %d image(s) from %d socket(s) -> %dx%d canvas (%s, pad=%s)",
        log, out.shape[0], len(slots), width, height, size_mode, pad_color,
    )
    return out


def image_slots_input(tooltip, item_tooltip=None, optional=False, min_images=1, max_images=MAX_IMAGES, id="images"):
    """The multi-socket image input, declared identically by every node that uses it."""
    item = item_tooltip or (
        "One image per socket; sockets appear as you connect them. A batch on a single "
        f"socket counts as several images too (up to {max_images})."
    )
    return io.Autogrow.Input(
        id,
        template=io.Autogrow.TemplatePrefix(
            input=io.Image.Input("image", tooltip=item),
            prefix=SLOT_PREFIX,
            min=min_images,
            max=max_images,
        ),
        tooltip=tooltip,
        optional=optional,
    )


def layout_inputs(max_side_default=1024):
    """Canvas controls shared by every node that batches images."""
    return [
        io.Combo.Input("size_mode", options=SIZE_MODES, default="largest", tooltip=SIZE_TOOLTIP),
        io.Combo.Input("pad_color", options=list(PAD_COLORS), default="gray", tooltip=PAD_TOOLTIP),
        io.Int.Input(
            "max_side",
            default=max_side_default,
            min=0,
            max=8192,
            step=64,
            optional=True,
            tooltip=CAP_TOOLTIP,
        ),
    ]
