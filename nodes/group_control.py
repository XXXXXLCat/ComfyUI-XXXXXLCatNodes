# -*- coding: utf-8 -*-
"""Group Control 🐈‍⬛ — one compact panel that opens or closes canvas groups.

Canvas groups are the only way most people keep a big workflow readable, but
switching a whole group on and off by hand means visiting every node inside it.
This node brings that switch onto the node itself:

- Every group on the canvas becomes a row with its name and one toggle.
- The list can be narrowed by group colour and by a name keyword, and ordered
  either by name or by canvas position.
- Three modes decide how the toggles interact: free control, always exactly one
  open, or at most one open.
- "Closing" a group is configurable: either bypass its nodes or mute them.

Everything happens in the browser — the panel reads and writes ``node.mode``
directly, exactly as if every member had been muted / bypassed by hand. The
backend therefore does no work at all: ``signal`` goes in one side and out the
other so the node can sit inside an execution chain without changing the data
that flows through it. All of the behaviour lives in the companion front-end
script ``web/group_control.js``.
"""

from comfy_api.latest import io


class XXXXXLCatGroupControl(io.ComfyNode):
    """One panel to open or close whole canvas groups at once."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛GroupControl",
            display_name="Group Control 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/group",
            description=(
                "Open or close canvas groups from a single panel. Each group on the "
                "canvas (including subgraphs) becomes a row with its name and one "
                "toggle; the list can be filtered by group colour and name keyword and "
                "ordered by name or canvas position. A mode decides how toggles "
                "interact: free control, always exactly one open, or at most one open. "
                "Closing a group either bypasses or mutes every node inside it, which "
                "is chosen in the panel settings. The signal input is a pass-through so "
                "the node can live inside an execution chain without changing the data "
                "that flows through it; all group switching happens in the front end."
            ),
            inputs=[
                io.AnyType.Input(
                    "signal",
                    optional=True,
                    display_name="signal",
                    tooltip=(
                        "Optional pass-through. Whatever is wired here is returned "
                        "unchanged so the node can sit inside a chain; it is not "
                        "involved in group switching."
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="signal"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        # Group switching is handled entirely by the front end; the backend only
        # relays the optional signal.
        return io.NodeOutput(kwargs.get("signal", None))
