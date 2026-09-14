# -*- coding: utf-8 -*-
"""Any Switch🐈‍⬛ — forward the single input that carries data, any type.

Wire several branch outputs at once; only the branch that actually ran produces
a value. At runtime the node forwards that one input and errors on zero or many.
Switch branches upstream — no rewiring, no toggle. The first connection decides
the node type, and the front end locks every other port to that same type.
Ports grow automatically as you connect (two by default, up to nine).
"""

from comfy_api.latest import io

try:
    from comfy_execution.graph import ExecutionBlocker
except Exception:  # absent only in standalone schema checks outside ComfyUI
    ExecutionBlocker = ()

_MAX_SLOTS = 9


def _carries_data(value):
    """An unexecuted branch arrives as None or ExecutionBlocker, both empty."""
    if value is None:
        return False
    if ExecutionBlocker and isinstance(value, ExecutionBlocker):
        return False
    return True


class XXXXXLCatAnySwitch(io.ComfyNode):
    """Forward the one populated input; error on zero or many — any data type."""

    @classmethod
    def define_schema(cls):
        inputs = []
        for i in range(1, _MAX_SLOTS + 1):
            inputs.append(
                io.AnyType.Input(
                    f"input_{i}",
                    optional=True,
                    display_name=f"input {i}",
                    tooltip=(
                        f"Candidate #{i}. The first connection decides the node type; "
                        "every other port is then locked to that same type and each port "
                        "(and the output) is labeled with that type name and slot index "
                        "(e.g. LATENT_01). Only the input that actually carries data is "
                        "forwarded."
                    ),
                )
            )
        return io.Schema(
            node_id="🐈‍⬛AnySwitch",
            display_name="Any Switch 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/switch",
            description=(
                "Generic single-active-input switch for ANY data type. Wire several "
                "branch outputs in at once; at runtime forward the single one that "
                "carries data and raise an error if none or more than one is populated. "
                "The first connection decides the node's type: the front end then locks "
                "every port to that same type and labels every port as 类型_序号 "
                "(e.g. LATENT_01) and the output with the type name, so the node visibly "
                "shows what it switches. Ports grow automatically as you connect (two by "
                "default, one extra empty slot each time, up to nine). Flip the active "
                "branch upstream — no rewiring, no toggle."
            ),
            inputs=inputs,
            outputs=[
                io.AnyType.Output(display_name="output"),
            ],
        )

    @classmethod
    def execute(cls, *args, **kwargs):
        values = {}
        # Args follow schema order: input_1 .. input_9.
        for idx, val in enumerate(args):
            if 0 <= idx < _MAX_SLOTS:
                values[f"input_{idx + 1}"] = val
        # Some runtimes also pass inputs by name.
        for key, val in kwargs.items():
            if key and key.startswith("input_"):
                values[key] = val

        present = []
        for i in range(1, _MAX_SLOTS + 1):
            v = values.get(f"input_{i}")
            if _carries_data(v):
                present.append((i, v))

        if not present:
            raise ValueError(
                "Any Switch 🐈‍⬛: no input was passed in. Run the branch you want to use; "
                "exactly one input must carry data."
            )
        if len(present) > 1:
            names = ", ".join(f"input_{i}" for i, _ in present)
            raise ValueError(
                f"Any Switch 🐈‍⬛: more than one input passed in ({names}). "
                "Only one branch may produce a value at a time."
            )

        return io.NodeOutput(present[0][1])
