# -*- coding: utf-8 -*-
"""Node Control 🐈‍⬛ — one compact panel that opens or closes single nodes.

Group Control 🐈‍⬛ flips whole canvas groups; this node does the same thing one
level down, for the nodes that never made it into a group:

- Every node on the canvas becomes a row with its title and one toggle.
- The list can be narrowed by node colour and by a name/type keyword (several
  keywords may be given, any one of them matches), and ordered either by name or
  by canvas position.
- Three modes decide how the toggles interact: free control, always exactly one
  open, or at most one open.
- "Closing" a node is configurable: either bypass it or mute it.

Nodes whose mode carries no meaning (notes, reroutes, primitives) and the
control node itself are left out of the list. A node that was never coloured
inherits the colour of the group it sits in, so a colour filter can still pick
up everything inside a coloured group.

Everything happens in the browser — the panel reads and writes ``node.mode``
directly, exactly as if every row had been muted / bypassed by hand. The backend
therefore does no work at all: ``signal`` goes in one side and out the other so
the node can sit inside an execution chain without changing the data that flows
through it. All of the behaviour lives in the companion front-end script
``web/node_control.js`` (sharing its panel engine with ``web/control_panel.js``).
"""

from comfy_api.latest import io


class XXXXXLCatNodeControl(io.ComfyNode):
    """One panel to open or close individual canvas nodes at once."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛NodeControl",
            display_name="Node Control 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/node",
            description=(
                "Open or close individual canvas nodes from a single panel. Each "
                "node on the canvas becomes a row with its title and one toggle; "
                "the list can be filtered by node colour (an uncoloured node "
                "inherits its group's colour) and by name / type keyword, and "
                "ordered by name or canvas position. A mode decides how toggles "
                "interact: free control, always exactly one open, or at most one "
                "open. Closing a node either bypasses or mutes it, which is chosen "
                "in the panel settings. Notes, reroutes, primitives and the control "
                "node itself are never listed. The signal input is a pass-through so "
                "the node can live inside an execution chain without changing the "
                "data that flows through it; all switching happens in the front end."
            ),
            inputs=[
                io.AnyType.Input(
                    "signal",
                    optional=True,
                    display_name="signal",
                    tooltip=(
                        "Optional pass-through. Whatever is wired here is returned "
                        "unchanged so the node can sit inside a chain; it is not "
                        "involved in node switching."
                    ),
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="signal"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs):
        # Node switching is handled entirely by the front end; the backend only
        # relays the optional signal.
        return io.NodeOutput(kwargs.get("signal", None))
