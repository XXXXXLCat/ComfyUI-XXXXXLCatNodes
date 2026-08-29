# -*- coding: utf-8 -*-
"""Shared node primitives: the wildcard input type and a cache-busting tick.

These small helpers are imported by every node module so that input typing and
the always-rerun trigger stay defined in exactly one place.
"""

import time


class AnyType(str):
    """Wildcard input type.

    Behaves like the string "*" for ComfyUI's type system but matches any
    incoming type, which lets an output pass straight through any downstream
    node without a concrete type binding.
    """

    def __eq__(self, _):
        return True

    def __ne__(self, __value):
        return False


any_t = AnyType("*")


def _tick(*_args, **_kwargs):
    """Force ComfyUI to re-execute the node on every run.

    Returns a fresh timestamp each call so the node is never served from the
    result cache, which matters for side-effecting nodes like VRAM/RAM cleanup.
    """
    return float(time.time())
