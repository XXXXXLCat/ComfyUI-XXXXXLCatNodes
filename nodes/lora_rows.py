# -*- coding: utf-8 -*-
"""Shared engine behind the LoRA stack nodes.

Both stacks lay out the same thing: rows of a LoRA plus its strengths plus an
on/off switch, applied top to bottom. What a row *contains* is declared by the
caller as a field list, so the model-only stack has one strength and the
model+CLIP stack has two, while everything else stays in one place: the row
schema, the row reader, the loaded-file cache and the per-row load/report
helpers. That way the two nodes cannot drift apart.

Each node module keeps the half that is about its own subject: which objects get
cloned and patched (a MODEL, or a MODEL and a CLIP) and how the patches land.
"""

import logging
import os
from collections import OrderedDict

from comfy_api.latest import io

import comfy.lora
import comfy.lora_convert
import comfy.utils
import folder_paths

MAX_ROWS = 12

# Same empty sentinel the LoRA stack nodes in the wild use, so a dropdown can
# express "this row does nothing" without an extra boolean widget.
EMPTY = "None"

FIELD_LORA = "lora"
FIELD_ON = "on"

# Display name / tooltip tail per strength field. A row's strengths are applied
# to different subjects, so the label has to say which is which.
_STRENGTH_LABELS = {
    "strength": "Strength",
    "strength_model": "Model Strength",
    "strength_clip": "CLIP Strength",
}
_STRENGTH_SUBJECTS = {
    "strength": "the model",
    "strength_model": "the model",
    "strength_clip": "the CLIP (text encoder)",
}


def strength_fields(fields):
    return [f for f in fields if f.startswith("strength")]


# ─────────────────────────────────────────────────────────────────────────────
# Loaded-file cache
# ─────────────────────────────────────────────────────────────────────────────

# Keyed by absolute path, validated against (mtime_ns, size) so editing or
# replacing a .safetensors on disk is picked up automatically. Bounded twice: by
# file count and by total tensor bytes, because a handful of large LoRAs can
# otherwise pin gigabytes of host RAM for the whole session.
_CACHE = OrderedDict()
_CACHE_MAX_FILES = 3
_CACHE_MAX_BYTES = 512 * 1024 * 1024


def _stamp(path):
    st = os.stat(path)
    return (st.st_mtime_ns, st.st_size)


def _lora_bytes(lora):
    total = 0
    for value in lora.values():
        numel = getattr(value, "numel", None)
        itemsize = getattr(value, "element_size", None)
        if numel is not None and itemsize is not None:
            total += numel() * itemsize()
    return total


def _evict():
    total = sum(entry[3] for entry in _CACHE.values())
    while _CACHE and (len(_CACHE) > _CACHE_MAX_FILES or (total > _CACHE_MAX_BYTES and len(_CACHE) > 1)):
        _, dropped = _CACHE.popitem(last=False)
        total -= dropped[3]


def load_cached_lora(path):
    """Return ``(converted_lora, metadata)``, cached until the file changes."""
    stamp = _stamp(path)
    hit = _CACHE.get(path)
    if hit is not None and hit[0] == stamp:
        _CACHE.move_to_end(path)
        return hit[1], hit[2]

    raw, metadata = comfy.utils.load_torch_file(path, safe_load=True, return_metadata=True)
    # convert_lora is cached too: it rebuilds tensors, so re-running it per queue
    # would throw away most of the point of caching the file in the first place.
    lora = comfy.lora_convert.convert_lora(raw)
    _CACHE[path] = (stamp, lora, metadata, _lora_bytes(lora))
    _evict()
    return lora, metadata


# ─────────────────────────────────────────────────────────────────────────────
# Rows
# ─────────────────────────────────────────────────────────────────────────────

def row_id(index):
    return f"{index:02d}"


def row_inputs(choices, index, fields):
    """The widgets of one row, in order, shared by both nodes' schemas."""
    slot = row_id(index)
    widgets = []
    for field in fields:
        if field == FIELD_LORA:
            widgets.append(
                io.Combo.Input(
                    f"lora_{slot}",
                    options=choices,
                    default=EMPTY,
                    display_name=f"LoRA {index}",
                    tooltip=(
                        f"Row {index}: the LoRA file to apply. Leave it at None to "
                        "skip this row; rows run top to bottom."
                    ),
                )
            )
        elif field == FIELD_ON:
            widgets.append(
                io.Boolean.Input(
                    f"on_{slot}",
                    default=True,
                    display_name=f"On {index}",
                    tooltip=(
                        f"Row {index}: switch this row on or off. Switching a row off "
                        "skips it entirely — the file is not even opened."
                    ),
                )
            )
        elif field in _STRENGTH_LABELS:
            widget = io.Float.Input(
                f"{field}_{slot}",
                default=1.0,
                min=-10.0,
                max=10.0,
                step=0.01,
                display_name=f"{_STRENGTH_LABELS[field]} {index}",
                tooltip=(
                    f"Row {index}: how strongly the LoRA is applied to "
                    f"{_STRENGTH_SUBJECTS[field]}. Negative values invert it; the row "
                    "is skipped (without reading the file) only when every strength "
                    "on it is 0."
                ),
            )
            widgets.append(widget)
        else:
            raise ValueError(f"unknown LoRA row field: {field!r}")
    return widgets


def active_rows(values, log, fields):
    """Rows that should actually be applied, in display order.

    Returns ``[(slot, name, {strength_field: float}), ...]``. Unused rows are
    dropped here, so nothing downstream has to know that a row might be empty,
    switched off, or all zeros.
    """
    strengths_of = strength_fields(fields)
    rows = []
    for index in range(1, MAX_ROWS + 1):
        slot = row_id(index)
        name = values.get(f"lora_{slot}")
        if not name or name == EMPTY:
            continue
        if not values.get(f"on_{slot}", True):
            continue

        strengths = {}
        bad = False
        for field in strengths_of:
            raw = values.get(f"{field}_{slot}")
            try:
                strengths[field] = float(raw or 0.0)
            except (TypeError, ValueError):
                logging.warning("%s row %s: %s %r is not a number, skipping", log, slot, field, raw)
                bad = True
                break
        if bad:
            continue
        # Same rule as the official loader: a row at 0 everywhere does nothing,
        # so it is skipped rather than patched with zeroes.
        if strengths_of and all(value == 0 for value in strengths.values()):
            continue

        rows.append((slot, name, strengths))
    return rows


def resolve_row_lora(name, key_map, log, slot):
    """Resolve one row's file and turn it into patches for this key map.

    Returns ``(loaded, metadata)``; ``loaded`` is None when the row cannot be
    used, in which case the caller skips it. A bad row never aborts the stack —
    that is the whole reason the checks are warnings instead of exceptions.
    """
    path = folder_paths.get_full_path("loras", name)
    if path is None:
        logging.warning("%s row %s: LoRA %r not found, skipping this row", log, slot, name)
        return None, None
    try:
        lora, metadata = load_cached_lora(path)
    except Exception as err:  # unreadable or unparseable file
        logging.warning("%s row %s: could not read %r (%s), skipping this row", log, slot, name, err)
        return None, None

    loaded = comfy.lora.load_lora(lora, key_map)
    if not loaded:
        logging.warning("%s row %s: %r has no keys this object understands, skipping this row", log, slot, name)
        return None, None
    return loaded, metadata


def report_row(log, slot, name, strengths, total, *applied_counts):
    """One log line per applied row: how many of the LoRA's keys landed where.

    A count of ``None`` means that subject was skipped on purpose (its strength
    is 0), which is shown as ``-`` so it cannot be mistaken for "nothing
    matched".
    """
    shown = ", ".join(f"{field}={value:.2f}" for field, value in strengths.items())
    detail = " / ".join("-" if count is None else str(count) for count in applied_counts)
    logging.info("%s row %s: %s (%s) -> %s of %d keys used", log, slot, name, shown, detail, total)
