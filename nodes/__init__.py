# -*- coding: utf-8 -*-
"""Node classes for ComfyUI-XXXXXLCatNodes, one module per node."""

from .vram_sweep import XXXXXLCatVRAMSweep
from .ram_reclaim import XXXXXLCatRAMReclaim
from .h3_image_to_video import XXXXXLCatH3ImageToVideo
from .any_switch import XXXXXLCatAnySwitch
from .group_control import XXXXXLCatGroupControl
from .node_control import XXXXXLCatNodeControl
from .lora_stack import XXXXXLCatStackLoras
from .lora_stack_clip import XXXXXLCatStackLorasClip
from .text_generate import XXXXXLCatTextGenerate
from .resolution_selector import XXXXXLCatResolutionSelector

__all__ = [
    "XXXXXLCatVRAMSweep",
    "XXXXXLCatRAMReclaim",
    "XXXXXLCatH3ImageToVideo",
    "XXXXXLCatAnySwitch",
    "XXXXXLCatGroupControl",
    "XXXXXLCatNodeControl",
    "XXXXXLCatStackLoras",
    "XXXXXLCatStackLorasClip",
    "XXXXXLCatTextGenerate",
    "XXXXXLCatResolutionSelector",
]
