# -*- coding: utf-8 -*-
"""Load LoRA Stack (Model and CLIP)🐈‍⬛ — rows that patch both sides.

The CLIP-aware twin of Load LoRA Stack 🐈‍⬛: same rows, but each row carries **two**
strengths — one for the model and one for the CLIP — which is what the official
"Load LoRA (Model and CLIP)" node does. Style LoRAs usually need this: the text
encoder has to see the style too, otherwise the prompt keeps describing the old
look, and how strongly it should see it is a separate decision from how strongly
the model does.

Everything the two stacks share — row schema, row reader, loaded-file cache —
comes from ``lora_rows``. This module owns the half that is about the subject:

* one key map built from **both** the model and the CLIP, then
* one model clone *and* one CLIP clone, patched in row order.

So the same three guarantees hold as for the model-only stack:

* the model and the CLIP are cloned **once each**, not once per LoRA;
* off / empty rows are never read from disk and never patched, and a side whose
  strength is 0 is left alone entirely (that is what the model-only node is for);
* every row logs how many of its keys landed, per side.
"""

from comfy_api.latest import io

import comfy.lora
import folder_paths

from .lora_rows import (
    EMPTY,
    FIELD_LORA,
    FIELD_ON,
    MAX_ROWS,
    active_rows,
    report_row,
    resolve_row_lora,
    row_inputs,
)

LOG = "[Load LoRA Stack Model+CLIP]"

# Model strength first, then CLIP strength — the same order as the official node.
ROW_FIELDS = (FIELD_LORA, "strength_model", "strength_clip", FIELD_ON)


class XXXXXLCatStackLorasClip(io.ComfyNode):
    """Apply several LoRAs to one model and its text encoder, row by row."""

    @classmethod
    def define_schema(cls):
        # Re-read on every /object_info request, so a LoRA dropped into
        # models/loras shows up after a page refresh instead of a restart.
        choices = [EMPTY] + list(folder_paths.get_filename_list("loras"))

        inputs = [
            io.Model.Input(
                "model",
                tooltip="The diffusion model every enabled row is applied to.",
            ),
            io.Clip.Input(
                "clip",
                tooltip="The text encoder every enabled row is applied to as well.",
            ),
        ]
        for index in range(1, MAX_ROWS + 1):
            inputs.extend(row_inputs(choices, index, ROW_FIELDS))

        return io.Schema(
            node_id="🐈‍⬛StackLorasClip",
            display_name="Load LoRA Stack (Model and CLIP) 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/lora",
            description=(
                "Apply several LoRAs to a MODEL and a CLIP in a single node — one row "
                "per LoRA with its own model strength, CLIP strength and on/off switch. "
                "Rows run top to bottom and match chaining Load LoRA (Model and CLIP) "
                "nodes, except the model and the CLIP are each cloned once instead of "
                "once per LoRA, off or empty rows are never read from disk, a side at "
                "strength 0 is not patched at all, loaded files are cached, and every "
                "row logs how many of its keys matched each side. Use the model-only "
                "Load LoRA Stack 🐈‍⬛ when the text encoder must not be touched."
            ),
            search_aliases=[
                "lora", "load lora", "load lora clip", "lora stack clip",
                "lora stack", "multi lora", "clip lora", "lora strength clip",
            ],
            inputs=inputs,
            outputs=[
                io.Model.Output(
                    display_name="model",
                    tooltip="The model with every enabled row applied, in row order.",
                ),
                io.Clip.Output(
                    display_name="clip",
                    tooltip="The CLIP with every enabled row applied, in row order.",
                ),
            ],
        )

    @classmethod
    def execute(cls, model, clip, **kwargs):
        rows = active_rows(kwargs, LOG, ROW_FIELDS)
        if not rows:
            # Hand back the same objects so downstream caches stay valid.
            return io.NodeOutput(model, clip)

        # One key map covering both subjects: a LoRA's unet keys land on the
        # model, its text-encoder keys land on the CLIP. Keys that match neither
        # are dropped by load_lora and reported per row below.
        key_map = {}
        key_map = comfy.lora.model_lora_keys_unet(model.model, key_map)
        key_map = comfy.lora.model_lora_keys_clip(clip.cond_stage_model, key_map)

        # One clone each, shared by every row — the whole point of stacking.
        patched_model = model.clone()
        patched_clip = clip.clone()

        for slot, name, strengths in rows:
            loaded, metadata = resolve_row_lora(name, key_map, LOG, slot)
            if loaded is None:
                continue

            model_strength = strengths["strength_model"]
            clip_strength = strengths["strength_clip"]

            # A side left at 0 is not patched at all: appending zero-strength
            # patches would compute the same weights for more work, and the log
            # shows "-" for that side so it cannot read as "nothing matched".
            on_model = patched_model.add_patches(loaded, model_strength) if model_strength else None
            on_clip = patched_clip.add_patches(loaded, clip_strength) if clip_strength else None

            if metadata:
                # Same attachment the official loader sets, on both sides; the
                # last row wins, exactly as it would when chaining those nodes.
                patched_model.set_attachments("lora_metadata", metadata)
                try:
                    patched_clip.patcher.set_attachments("lora_metadata", metadata)
                except AttributeError:
                    pass

            report_row(
                LOG, slot, name, strengths, len(loaded),
                len(on_model) if on_model is not None else None,
                len(on_clip) if on_clip is not None else None,
            )

        return io.NodeOutput(patched_model, patched_clip)
