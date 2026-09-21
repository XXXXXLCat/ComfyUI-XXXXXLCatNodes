# -*- coding: utf-8 -*-
"""Load LoRA Stack🐈‍⬛ — every LoRA as a row: name, strength, on/off.

Replaces a chain of the official "Load LoRA" (model only) nodes with one node
that lays the same work out as rows. Rows run top to bottom, and the result is
*identical* to chaining the official node, because patches end up in the same
per-key list in the same order (``ModelPatcher.add_patches`` appends, and
``comfy.lora.calculate_weight`` walks that list in order).

Four things this does that a chain of official nodes does not:

* **One model clone, not N.** ``comfy.sd.load_lora_for_models`` clones the model
  patcher once *per LoRA*, deep-copying the patch dict and ``model_options``
  every time. Here the model is cloned once and each enabled row is appended to
  that single clone, so the final patch list is the same while N-1 clones and
  their deep copies disappear.
* **Row-level skip.** A row that is off, empty, or at strength 0 is never read
  from disk and never patched. The official node still clones for it.
* **File cache.** The official loader only remembers the last file it opened, so
  a stack re-reads every file on every run. Loaded (already converted) tensors
  are kept in the shared mtime-checked LRU.
* **Per-row hit report.** ``add_patches`` returns the keys that actually landed,
  so each row logs how many of the LoRA's keys were used. An XL-era LoRA on a
  newer model shows up as 0 hits instead of silently doing nothing.

Only the model is touched — see Load LoRA Stack (Model and CLIP) 🐈‍⬛ for the
variant that also patches the text encoder.

The row schema, the row reader and the file cache live in ``lora_rows`` and are
shared with that variant; this module only owns the model half.
"""

import logging

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

LOG = "[Load LoRA Stack]"

# One strength only: this node patches the model and nothing else.
ROW_FIELDS = (FIELD_LORA, "strength", FIELD_ON)


class XXXXXLCatStackLoras(io.ComfyNode):
    """Apply several LoRAs to one model, row by row, in one node."""

    @classmethod
    def define_schema(cls):
        # Re-read on every /object_info request: ComfyUI calls define_schema()
        # again for each one, so a LoRA dropped into models/loras shows up after
        # a page refresh instead of needing a restart.
        choices = [EMPTY] + list(folder_paths.get_filename_list("loras"))

        inputs = [
            io.Model.Input(
                "model",
                tooltip="The diffusion model every enabled row is applied to.",
            ),
        ]
        for index in range(1, MAX_ROWS + 1):
            inputs.extend(row_inputs(choices, index, ROW_FIELDS))

        return io.Schema(
            node_id="🐈‍⬛StackLoras",
            display_name="Load LoRA Stack 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/lora",
            description=(
                "Apply several LoRAs to one MODEL in a single node — one row per LoRA "
                "with its own strength and on/off switch. Rows run top to bottom and "
                "give exactly the same result as chaining Load LoRA nodes, but the "
                "model is cloned once instead of once per LoRA, off or empty rows are "
                "never read from disk, loaded files are cached, and every row logs how "
                "many of its keys matched the model. MODEL only — use Load LoRA Stack "
                "(Model and CLIP) 🐈‍⬛ when the text encoder must be patched too."
            ),
            search_aliases=["lora", "load lora", "load lora stack", "lora stack", "stack loras", "multi lora"],
            inputs=inputs,
            outputs=[
                io.Model.Output(
                    display_name="model",
                    tooltip="The model with every enabled row applied, in row order.",
                )
            ],
        )

    @classmethod
    def execute(cls, model, **kwargs):
        rows = active_rows(kwargs, LOG, ROW_FIELDS)
        if not rows:
            # Nothing to do: hand back the same object so the sampler can reuse
            # its cache instead of seeing a fresh clone.
            return io.NodeOutput(model)

        key_map = comfy.lora.model_lora_keys_unet(model.model, {})

        # The single clone every row is appended to. Equivalent to chaining the
        # official node, minus the N-1 extra clones and model_options copies.
        patched = model.clone()

        for slot, name, strengths in rows:
            loaded, metadata = resolve_row_lora(name, key_map, LOG, slot)
            if loaded is None:
                continue

            applied = patched.add_patches(loaded, strengths["strength"])
            if metadata:
                # Mirrors what the official loader attaches; the last row wins,
                # exactly as it would when chaining those nodes.
                patched.set_attachments("lora_metadata", metadata)

            report_row(LOG, slot, name, strengths, len(loaded), len(applied))

        return io.NodeOutput(patched)
