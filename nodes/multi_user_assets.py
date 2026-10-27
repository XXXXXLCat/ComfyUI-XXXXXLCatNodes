"""Per-user asset isolation for ComfyUI ``--multi-user`` mode.

ComfyUI's ``--multi-user`` flag only separates each user's *settings* and
*workflows* (stored under ``user/<user_id>/``). The ``input/`` and ``output/``
directories stay global, so every user reads and writes the same asset pool.

This module makes those two asset directories per-user as well, while keeping
the pre-existing global files readable as a shared "common" pool:

* ``get_input_directory()`` / ``get_output_directory()`` resolve to
  ``input/<user_id>`` / ``output/<user_id>`` whenever a user context is active.
* File *resolution* (``get_annotated_filepath``) and the ``/view`` endpoint fall
  back to the global ``input/`` / ``output/`` when a referenced file is not in
  the caller's own directory — so legacy shared assets still load and display.
* The file pickers (``get_filename_list`` + the built-in ``LoadImage`` family)
  show the union of the user's own files and the shared pool.

The current user is carried through a :class:`contextvars.ContextVar`:

* An aiohttp middleware sets it from the ``comfy-user`` request header for
  request-bound work (``/view``, ``/upload/image``).
* ``PromptServer.trigger_on_prompt`` injects it into the prompt's
  ``extra_data``, and ``PromptExecutor.execute_async`` restores it for the
  duration of that execution so nodes writing outputs (``SaveImage`` etc.)
  land in the right user's directory even though execution runs in its own task.

Everything is installed only when ``--multi-user`` is enabled, so a normal
single-user launch is completely unaffected. Every patch is wrapped in
``try/except`` and degrades to the official behaviour if a future ComfyUI
version moves a patched symbol.
"""

from __future__ import annotations

import contextvars
import logging
import os
from typing import Optional

from aiohttp import web

logger = logging.getLogger("XXXXXLCat.multi_user_assets")

# Carries the active user id for the current request / execution.
_XUSER = contextvars.ContextVar("xuser_assets", default=None)

# Set True once install() has patched everything (idempotent guard).
_INSTALLED = False


def _enabled() -> bool:
    try:
        from comfy.cli_args import args
    except Exception:
        return False
    return bool(getattr(args, "multi_user", False))


def _current_user() -> Optional[str]:
    """Return the validated current user id, or ``None`` when no isolation applies."""
    user = _XUSER.get()
    if not user:
        return None
    try:
        from folder_paths import SYSTEM_USER_PREFIX
    except Exception:
        return user
    # System users (e.g. the queue/agent account) must never get a private pool.
    if user.startswith(SYSTEM_USER_PREFIX):
        return None
    return user


def _global_input_dir() -> str:
    import folder_paths
    return folder_paths.input_directory


def _global_output_dir() -> str:
    import folder_paths
    return folder_paths.output_directory


def _user_dir(global_dir: str, user: str) -> str:
    return os.path.join(global_dir, user)


# ---------------------------------------------------------------- folder_paths

def _install_folder_paths() -> None:
    import folder_paths

    orig_get_input = folder_paths.get_input_directory
    orig_get_output = folder_paths.get_output_directory

    def _patched_get_input_directory():
        user = _current_user()
        if user:
            d = _user_dir(orig_get_input(), user)
            os.makedirs(d, exist_ok=True)
            return d
        return orig_get_input()

    def _patched_get_output_directory():
        user = _current_user()
        if user:
            d = _user_dir(orig_get_output(), user)
            os.makedirs(d, exist_ok=True)
            return d
        return orig_get_output()

    folder_paths.get_input_directory = _patched_get_input_directory
    folder_paths.get_output_directory = _patched_get_output_directory

    # --- resolution fallback to the shared global pool ---------------------
    orig_annotated = folder_paths.get_annotated_filepath

    def _resolve_global(name: str) -> Optional[str]:
        base = os.path.basename(name)
        for gd in (_global_input_dir(), _global_output_dir()):
            cand = os.path.join(gd, base)
            if os.path.isfile(cand):
                return cand
        return None

    def _patched_get_annotated_filepath(name, default_dir=None):
        try:
            path = orig_annotated(name, default_dir)
        except Exception:
            if _current_user():
                g = _resolve_global(name)
                if g:
                    return g
            raise
        if _current_user() and not os.path.isfile(path):
            g = _resolve_global(name)
            if g:
                return g
        return path

    folder_paths.get_annotated_filepath = _patched_get_annotated_filepath

    # exists_annotated_filepath: mirror the fallback so IS_CHANGED etc. agree.
    orig_exists = folder_paths.exists_annotated_filepath

    def _patched_exists_annotated_filepath(name) -> bool:
        if orig_exists(name):
            return True
        if _current_user():
            return _resolve_global(name) is not None
        return False

    folder_paths.exists_annotated_filepath = _patched_exists_annotated_filepath

    # --- listing: union of per-user files and the shared pool --------------
    orig_list = folder_paths.get_filename_list

    def _patched_get_filename_list(folder_name: str) -> list:
        out = orig_list(folder_name)
        user = _current_user()
        if user and folder_name in ("input", "output"):
            global_dir = _global_input_dir() if folder_name == "input" else _global_output_dir()
            user_dir = _user_dir(global_dir, user)
            merged = list(out)
            if os.path.isdir(user_dir):
                for f in os.listdir(user_dir):
                    if os.path.isfile(os.path.join(user_dir, f)) and f not in merged:
                        merged.append(f)
            return merged
        return out

    folder_paths.get_filename_list = _patched_get_filename_list


def _install_loadimage_picker() -> None:
    """Show the shared input pool inside the built-in LoadImage combo.

    The built-in ``LoadImage.INPUT_TYPES`` lists ``os.listdir(get_input_directory())``
    directly, so it needs its own union patch (``get_filename_list`` is not used).
    """
    try:
        import nodes
    except Exception:
        return

    image_exts = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff")

    def _union_input(ret):
        user = _current_user()
        if not user:
            return ret
        slot = ret.get("required", {}).get("image")
        if not (isinstance(slot, (list, tuple)) and len(slot) > 0):
            return ret
        files = list(slot[0])
        gdir = _global_input_dir()
        if os.path.isdir(gdir):
            for f in os.listdir(gdir):
                if os.path.isfile(os.path.join(gdir, f)) and f.lower().endswith(image_exts) and f not in files:
                    files.append(f)
        new_slot = list(slot)
        new_slot[0] = sorted(files)
        ret["required"] = dict(ret["required"])
        ret["required"]["image"] = tuple(new_slot)
        return ret

    targets = ["LoadImage", "LoadImageMask", "LoadImageOutput"]
    for name in targets:
        cls = getattr(nodes, name, None)
        if cls is None or getattr(cls, "_xuser_patched", False):
            continue
        orig_it = cls.INPUT_TYPES

        def _make(orig_it):
            def _it(c, _orig=orig_it):
                return _union_input(_orig())
            return classmethod(_it)

        try:
            cls.INPUT_TYPES = _make(orig_it)
            cls._xuser_patched = True
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("[XXXXXLCat] could not patch %s.INPUT_TYPES: %s", name, exc)


# ---------------------------------------------------------------- request / exec

def _user_from_request(request) -> Optional[str]:
    try:
        from server import PromptServer
    except Exception:
        return None
    inst = getattr(PromptServer, "instance", None)
    mgr = getattr(inst, "user_manager", None)
    if mgr is None:
        return None
    hdr = request.headers.get("comfy-user") if hasattr(request, "headers") else None
    if not hdr:
        return None
    try:
        return mgr.get_request_user_id(request)
    except Exception:
        return None


def _auth_user() -> Optional[str]:
    """Return the password-authenticated user id, if the auth module is active."""
    try:
        from .multi_user_auth import _XAUTH_USER
    except Exception:
        return None
    return _XAUTH_USER.get()


@web.middleware
async def _user_middleware(request, handler):
    # Prefer the password-authenticated identity published by multi_user_auth;
    # only fall back to the (spoofable) comfy-user header when auth is absent.
    user = _auth_user() or _user_from_request(request)
    token = _XUSER.set(user)
    try:
        return await handler(request)
    finally:
        _XUSER.reset(token)


def _install_server_hooks() -> None:
    import server

    # --- middleware: set the user for every request -----------------------
    def _attach_middleware(app):
        try:
            app.middlewares.append(_user_middleware)
            return True
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("[XXXXXLCat] could not attach user middleware: %s", exc)
            return False

    orig_init = server.PromptServer.__init__

    def _patched_init(self, *a, **k):
        orig_init(self, *a, **k)
        _attach_middleware(getattr(self, "app", None))
        _wrap_view_route(getattr(self, "app", None))

    server.PromptServer.__init__ = _patched_init

    inst = getattr(server.PromptServer, "instance", None)
    if inst is not None:
        _attach_middleware(getattr(inst, "app", None))
        _wrap_view_route(getattr(inst, "app", None))

    # --- inject the user into prompt extra_data ---------------------------
    orig_trigger = server.PromptServer.trigger_on_prompt

    def _patched_trigger(self, json_data):
        user = _XUSER.get()
        if user:
            try:
                ed = json_data.setdefault("extra_data", {})
                if isinstance(ed, dict):
                    ed["_xuser_assets"] = user
            except Exception:
                pass
        return orig_trigger(self, json_data)

    server.PromptServer.trigger_on_prompt = _patched_trigger


def _wrap_view_route(app) -> None:
    """Wrap the ``/view`` handler so a missing per-user file falls back to global."""
    if app is None:
        return
    try:
        import folder_paths
    except Exception:
        return

    target = None
    for route in app.router.routes():
        method = getattr(route, "method", None) or getattr(getattr(route, "resource", None), "method", None)
        canonical = getattr(getattr(route, "resource", None), "canonical", None)
        if method == "GET" and canonical == "/view":
            target = route
            break
    if target is None or getattr(target, "_xuser_wrapped", False):
        return

    orig_handler = target.handler

    async def _wrapped_view(request, _orig=orig_handler):
        filename = request.rel_url.query.get("filename", "")
        subfolder = request.rel_url.query.get("subfolder", "")
        ftype = request.rel_url.query.get("type", "output")
        user = _current_user()
        if user and filename and not filename.startswith("blake3:"):
            orig_gdt = folder_paths.get_directory_by_type

            def _gdt(type_name):
                d = orig_gdt(type_name)
                if d and os.path.isdir(d):
                    rel = os.path.join(subfolder, os.path.basename(filename)) if subfolder else os.path.basename(filename)
                    if not os.path.isfile(os.path.join(d, rel)):
                        gdir = _global_output_dir() if type_name == "output" else _global_input_dir()
                        if os.path.isfile(os.path.join(gdir, rel)):
                            return gdir
                return d

            folder_paths.get_directory_by_type = _gdt
            try:
                return await _orig(request)
            finally:
                folder_paths.get_directory_by_type = orig_gdt
        return await _orig(request)

    try:
        target.handler = _wrapped_view
        target._xuser_wrapped = True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[XXXXXLCat] could not wrap /view route: %s", exc)


def _install_executor_hook() -> None:
    import execution

    orig_exec = execution.PromptExecutor.execute_async

    async def _patched_execute_async(self, prompt, prompt_id, extra_data=None, execute_outputs=None):
        extra_data = extra_data or {}
        user = None
        if isinstance(extra_data, dict):
            user = extra_data.get("_xuser_assets")
        token = _XUSER.set(user)
        try:
            return await orig_exec(self, prompt, prompt_id, extra_data, execute_outputs or [])
        finally:
            _XUSER.reset(token)

    execution.PromptExecutor.execute_async = _patched_execute_async


# ---------------------------------------------------------------- public API

def install() -> bool:
    """Install the per-user asset isolation patches.

    Returns ``True`` if patches were applied, ``False`` if multi-user is off or
    already installed.
    """
    global _INSTALLED
    if _INSTALLED:
        return True
    if not _enabled():
        return False

    try:
        _install_folder_paths()
        _install_loadimage_picker()
        _install_server_hooks()
        _install_executor_hook()
        _INSTALLED = True
        logger.info("[XXXXXLCat] multi-user asset isolation enabled "
                    "(input/<user> & output/<user>, global pool kept readable)")
        print("[XXXXXLCat] multi-user asset isolation enabled "
              "(input/<user>/ & output/<user>/; existing global input/ output/ kept as a shared pool)")
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[XXXXXLCat] multi-user asset isolation failed to install: %s", exc)
        return False
