"""Per-user asset isolation for ComfyUI ``--multi-user`` mode.

ComfyUI's ``--multi-user`` flag only separates each user's *settings* and
*workflows* (stored under ``user/<user_id>/``). The ``input/`` and ``output/``
directories stay global, so every user reads and writes the same asset pool.

This module makes those two asset directories per-user as well, and hides the
legacy global pool from every account:

* ``get_input_directory()`` / ``get_output_directory()`` resolve to
  ``input/<user_id>`` / ``output/<user_id>`` whenever a user context is active.
  In multi-user mode *every* request resolves to a user id — either the
  ``comfy-user`` request header or ComfyUI's native ``default`` account — so the
  global ``input/`` / ``output/`` is never used for any user-facing operation.
* The file pickers (``get_filename_list`` + the built-in ``LoadImage`` family)
  only ever list the active user's own ``input/<user>`` / ``output/<user>``.
* The legacy global ``input/`` / ``output/`` pool is **not exposed** to any
  user: it is neither listed, served via ``/view``, nor resolved by
  ``get_annotated_filepath``. Files that lived there before isolation simply
  become invisible to accounts — by design ("原有的全局目录不可见").
* Each user gets their own prompt cache (``CacheSet``) and job listings
  (``/history``, ``/queue``, ``/jobs``), so outputs and history never leak
  between accounts.

The current user is carried through a :class:`contextvars.ContextVar`:

* An aiohttp middleware sets it from ComfyUI's native ``comfy-user`` request
  header — there is no password gate, login uses the official "select user"
  flow.
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

    # Listing: only the active user's own input/ output files. The legacy global
    # pool is intentionally NOT merged in — strict per-user isolation.
    # NOTE: get_filename_list reads from folder_names_and_paths (the cached
    # registered paths), not the patched get_input_directory(), so it must be
    # wrapped directly here.
    orig_list = folder_paths.get_filename_list

    def _patched_get_filename_list(folder_name: str) -> list:
        user = _current_user()
        if user and folder_name in ("input", "output"):
            gdir = _global_input_dir() if folder_name == "input" else _global_output_dir()
            udir = _user_dir(gdir, user)
            if os.path.isdir(udir):
                return sorted(
                    f for f in os.listdir(udir)
                    if os.path.isfile(os.path.join(udir, f))
                )
            return []
        return orig_list(folder_name)

    folder_paths.get_filename_list = _patched_get_filename_list


def _install_loadimage_picker() -> None:
    """Restrict the built-in LoadImage combo to the active user's own input dir.

    ``LoadImage.INPUT_TYPES`` lists ``os.listdir(get_input_directory())``
    directly, so the function patch already makes it per-user when computed
    under a user context. This extra guard filters the combo down to *only* the
    files that physically live in ``input/<user>/``, so a node-def computed
    before a user was selected (or any stray global entry) can never surface
    another account's or the shared pool's files.
    """
    try:
        import nodes
    except Exception:
        return

    image_exts = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff")

    def _user_only(ret):
        user = _current_user()
        if not user:
            return ret
        slot = ret.get("required", {}).get("image")
        if not (isinstance(slot, (list, tuple)) and len(slot) > 0):
            return ret
        # Only filter real local file lists. ``LoadImageOutput`` uses the literal
        # "COMBO" string with a ``/internal/files/output`` remote route — its
        # first slot element is a *string*, not a filename list, and it resolves
        # per-user server-side via ``get_output_directory()``. Touching it would
        # replace the remote combo with an empty list and break the node, so we
        # leave non-list first slots alone.
        if not isinstance(slot[0], (list, tuple)):
            return ret
        udir = _user_dir(_global_input_dir(), user)
        allowed = set()
        if os.path.isdir(udir):
            for f in os.listdir(udir):
                if os.path.isfile(os.path.join(udir, f)) and f.lower().endswith(image_exts):
                    allowed.add(f)
        files = [f for f in slot[0] if f in allowed]
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
                return _user_only(_orig())
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
    try:
        return mgr.get_request_user_id(request)
    except Exception:
        return None


@web.middleware
async def _user_middleware(request, handler):
    # Identity comes from the native ComfyUI multi-user selection (the
    # comfy-user request header), so no password gate is involved.
    user = _user_from_request(request)
    token = _XUSER.set(user)
    try:
        resp = await handler(request)
    finally:
        _XUSER.reset(token)

    # The same file is reachable through four URL shapes (user segment inside
    # subfolder or not; comfy-user header present or not) and the native handler
    # only resolves one of them.  The browser loads thumbnails through a native
    # <img> tag, which cannot carry the comfy-user header at all, and the assets
    # API emits URLs that already contain the user segment.  Re-resolve those
    # misses instead of leaving them as 404s.  Isolation is enforced inside the
    # resolver (candidates must stay in the caller's own pool), not by skipping
    # the fallback, so a known identity never widens access.
    if (resp is not None
            and getattr(resp, "status", None) != 200
            and request.rel_url.path in ("/view", "/api/view")):
        try:
            fb = await _view_fallback(request, resp, user)
        except Exception:
            fb = None
        if fb is not None and getattr(fb, "status", None) == 200:
            resp = fb

    return resp


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

    server.PromptServer.__init__ = _patched_init

    inst = getattr(server.PromptServer, "instance", None)
    if inst is not None:
        _attach_middleware(getattr(inst, "app", None))

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


def _install_executor_hook() -> None:
    import execution

    orig_exec = execution.PromptExecutor.execute_async

    # One cache set per user. Both halves of ComfyUI's prompt cache are unsafe to
    # share between accounts:
    #
    # * ``objects`` keeps one node *instance* per node id for the lifetime of the
    #   server, and many nodes capture their directory in ``__init__`` (the core
    #   ``SaveImage`` does ``self.output_dir = folder_paths.get_output_directory()``).
    #   The instance created by the first user therefore pins that user's folder
    #   and every later user writes into it.
    # * ``outputs`` is keyed by the node's inputs only, so a second user running
    #   an identical prompt is served the *cached* result of the first one: the
    #   node never runs, and the filenames it reports point at the first user's
    #   directory.
    #
    # Giving each user their own ``CacheSet`` fixes both without slowing down the
    # common case (the same user queueing many prompts keeps a warm cache).
    per_user_caches: dict = {}

    def _cache_for(executor, user: str):
        cache = per_user_caches.get(user)
        if cache is not None:
            return cache
        try:
            cache = execution.CacheSet(
                cache_type=getattr(executor, "cache_type", None),
                cache_args=getattr(executor, "cache_args", None) or {},
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("[XXXXXLCat] could not create per-user cache: %s", exc)
            return None
        per_user_caches[user] = cache
        return cache

    async def _patched_execute_async(self, prompt, prompt_id, extra_data=None, execute_outputs=None):
        extra_data = extra_data or {}
        user = None
        if isinstance(extra_data, dict):
            user = extra_data.get("_xuser_assets")

        # Remember the unpatched cache set so the no-user path is untouched.
        base = getattr(self, "_xcat_base_caches", None)
        if base is None:
            base = self.caches
            self._xcat_base_caches = base

        if user:
            cache = _cache_for(self, user)
            if cache is not None:
                self.caches = cache
        else:
            self.caches = base

        token = _XUSER.set(user)
        try:
            return await orig_exec(self, prompt, prompt_id, extra_data, execute_outputs or [])
        finally:
            _XUSER.reset(token)

    execution.PromptExecutor.execute_async = _patched_execute_async

    # ``reset()`` (used by ``/free``) is supposed to drop the prompt caches; drop
    # the per-user ones as well so freeing memory still works.
    orig_reset = execution.PromptExecutor.reset

    def _patched_reset(self):
        orig_reset(self)
        self._xcat_base_caches = self.caches
        per_user_caches.clear()

    execution.PromptExecutor.reset = _patched_reset


def _install_job_visibility() -> None:
    """Show each user only their own jobs (``/history``, ``/queue``, ``/jobs``).

    ComfyUI keeps one history and one queue for the whole server, so without
    this every account sees the others' prompts — and the output filenames in
    them no longer resolve, because each user has a private output folder now.
    Queue items and history entries both carry the prompt's ``extra_data``,
    which is where the executing user is recorded.
    """
    import copy

    import execution

    def _item_user(item):
        try:
            ed = item[3]
        except Exception:
            return None
        return ed.get("_xuser_assets") if isinstance(ed, dict) else None

    def _entry_user(entry):
        try:
            return _item_user(entry["prompt"])
        except Exception:
            return None

    def _mine(item, user, getter):
        return getter(item) == user

    # --- history ---------------------------------------------------------
    orig_history = execution.PromptQueue.get_history

    def _patched_get_history(self, prompt_id=None, max_items=None, offset=-1, map_function=None):
        user = _current_user()
        if not user:
            return orig_history(self, prompt_id, max_items, offset, map_function)

        with self.mutex:
            if prompt_id is not None:
                item = self.history.get(prompt_id)
                if item is None or not _mine(item, user, _entry_user):
                    return {}
                return {prompt_id: map_function(item) if map_function is not None else copy.deepcopy(item)}

            items = [(k, v) for k, v in self.history.items() if _mine(v, user, _entry_user)]
            if offset < 0:
                offset = max(0, len(items) - max_items) if max_items is not None else 0
            items = items[offset:]
            if max_items is not None:
                items = items[:max_items]
            return {
                k: map_function(v) if map_function is not None else v
                for k, v in items
            }

    execution.PromptQueue.get_history = _patched_get_history

    # --- live queue ------------------------------------------------------
    for name in ("get_current_queue", "get_current_queue_volatile"):
        orig_queue = getattr(execution.PromptQueue, name, None)
        if orig_queue is None or getattr(orig_queue, "_xuser_patched", False):
            continue

        def _make(orig_queue):
            def _patched(self, *a, **k):
                running, pending = orig_queue(self, *a, **k)
                user = _current_user()
                if not user:
                    return running, pending
                return (
                    [x for x in running if _mine(x, user, _item_user)],
                    [x for x in pending if _mine(x, user, _item_user)],
                )
            return _patched

        patched = _make(orig_queue)
        patched._xuser_patched = True
        setattr(execution.PromptQueue, name, patched)


def _install_assets_list_filter() -> None:
    """Scope ComfyUI's Assets library listing to the current user.

    ComfyUI's asset database (``app/assets`` + ``user/comfyui.db``) has no
    per-user ownership column, and ``GET /api/assets`` lists every account's
    records. ComfyUI's own ``--multi-user`` never isolated assets, so the media
    panel shows all accounts' media. We cannot edit ComfyUI source, so this
    wraps the list query's filter builder (``build_record_tag_filter_clauses``,
    used only by ``list_records_page``) to add a WHERE on ``AssetContent.path``
    being under the caller's own ``input/<user>/`` or ``output/<user>/`` (this
    module's isolation layout). The clause joins the same filter set that backs
    both the page query and the count query, so pagination and ``total`` stay
    correct. Only applies to an identified user; single-user or system calls
    fall through to the unfiltered official behaviour.
    """
    try:
        import sqlalchemy as sa

        from app.assets.database.models import AssetContent
        from app.assets.database.queries import records as _rec
        from app.assets.helpers import sql_path_under_prefix
    except Exception:
        # Assets system not present (older ComfyUI / --disable-assets) — nothing
        # to scope, so leave the official behaviour untouched.
        return

    orig = getattr(_rec, "build_record_tag_filter_clauses", None)
    if orig is None or getattr(orig, "_xuser_patched", False):
        return

    def _patched(all_tags, any_tags, none_tags):
        clauses = list(orig(all_tags, any_tags, none_tags))
        user = _current_user()
        if user:
            try:
                own = [
                    sql_path_under_prefix(
                        AssetContent.path, _user_dir(_global_input_dir(), user)
                    ),
                    sql_path_under_prefix(
                        AssetContent.path, _user_dir(_global_output_dir(), user)
                    ),
                ]
                clauses.append(sa.or_(*own))
            except Exception:
                pass
        return tuple(clauses)

    _patched._xuser_patched = True
    _rec.build_record_tag_filter_clauses = _patched


# ---------------------------------------------------------------- userdata guard

def _install_userdata_unknown_user_guard() -> None:
    """Return a clean 4xx (instead of a 500) for an unknown / header-less user.

    In ``--multi-user`` mode ComfyUI's own ``index.html`` loads the per-user
    stylesheet with a plain ``<link rel="stylesheet" href="api/userdata/user.css">``.
    A native ``<link>`` request cannot carry the ``comfy-user`` header, so the
    core falls back to the (unregistered) ``default`` account and
    ``UserManager.get_request_user_id`` raises ``KeyError('Unknown user: default')``.
    The core ``/userdata/{file}`` and ``/userdata`` handlers do NOT catch that, so
    it surfaces as an unhandled 500 — which any global API error middleware (e.g.
    LoRA-Manager's) then logs noisily on every single page load.

    We wrap ``UserManager.get_request_user_filepath`` so an unknown user yields
    ``None`` — which the handlers already translate into a clean 403/400 — rather
    than propagating the exception. This is applied at the core handler level, so
    it removes the error regardless of which middleware is installed, and it is
    scoped strictly to the "Unknown user" ``KeyError`` (a valid ``comfy-user``
    header is completely untouched, and other ``KeyError`` values such as
    "Unknown filepath type:" keep their original behaviour).
    """
    try:
        from app.user_manager import UserManager
    except Exception:
        return

    orig = getattr(UserManager, "get_request_user_filepath", None)
    if orig is None or getattr(orig, "_xuser_patched", False):
        return

    def _patched(self, request, file, type="userdata", create_dir=True):
        try:
            return orig(self, request, file, type=type, create_dir=create_dir)
        except KeyError as exc:
            # Only swallow the "Unknown user" KeyError raised by
            # get_request_user_id; re-raise anything else so real bugs stay
            # visible.
            if "Unknown user" in str(exc):
                return None
            raise

    _patched._xuser_patched = True
    UserManager.get_request_user_filepath = _patched


# ---------------------------------------------------------------- assets view URL

def _is_under(child: str, parent: str) -> bool:
    """True when ``child`` is strictly inside ``parent`` (both absolute-able)."""
    return os.path.abspath(child).startswith(os.path.abspath(parent) + os.sep)


def _install_assets_view_url() -> None:
    """Keep the per-user segment inside assets preview URLs.

    ``app.assets.services.preview_rules.view_url`` turns an absolute path into
    ``/api/view?type=...&filename=...&subfolder=...`` by relativising it against
    ``folder_paths.get_input_directory()``.  Under isolation that call returns
    ``input/<user>``, so the user segment gets absorbed into the base and the
    resulting URL loses its ``subfolder`` — yet ``view_url`` documents the
    endpoint as served with *no user header*, i.e. the URL must describe the
    file on its own.  A browser ``<img>`` cannot send ``comfy-user``, so such a
    request resolves against the global directory and 404s: the assets panel
    then shows placeholder icons instead of thumbnails and drags onto the canvas
    fail.  Recompute against the global roots so the URL keeps the subfolder it
    would carry without isolation.
    """
    try:
        from app.assets.services import preview_rules as _pr
        import urllib.parse as _up
    except Exception as exc:  # pragma: no cover - assets module absent
        logger.warning("[XXXXXLCat] assets view_url patch skipped: %s", exc)
        return

    orig = getattr(_pr, "view_url", None)
    if orig is None or getattr(orig, "_xxl_patched", False):
        return

    def _patched_view_url(file_path):
        if file_path:
            fp_abs = os.path.abspath(file_path)
            for namespace, base in (
                ("input", _global_input_dir()),
                ("output", _global_output_dir()),
            ):
                if not base or not _is_under(fp_abs, base):
                    continue
                rel = os.path.relpath(fp_abs, os.path.abspath(base)).replace(os.sep, "/")
                subfolder, _, filename = rel.rpartition("/")
                if not filename:
                    break
                url = "/api/view?type=%s&filename=%s" % (
                    namespace,
                    _up.quote(filename, safe=""),
                )
                if subfolder:
                    url += "&subfolder=%s" % _up.quote(subfolder, safe="")
                return url
        return orig(file_path)

    _patched_view_url._xxl_patched = True
    _pr.view_url = _patched_view_url
    logger.info("[XXXXXLCat] assets preview URLs keep their per-user subfolder")


# ---------------------------------------------------------------- /view fallback

def _serve_image_file(request, file, filename):
    """Serve an image/video file the same way ComfyUI's /view route does.

    Minimal re-implementation of the file-serving tail of the official
    ``/view`` handler (preview re-encoding + rgb channel + raw passthrough) so the
    fallback path behaves identically to the native one.  The raw passthrough
    goes through ``web.FileResponse`` so byte-range seeking keeps working for
    video scrubbing, exactly like the official handler.
    """
    import mimetypes as _mimetypes
    from io import BytesIO

    from PIL import Image

    if "preview" in request.rel_url.query:
        with Image.open(file) as img:
            preview_info = request.rel_url.query["preview"].split(";")
            image_format = preview_info[0]
            if image_format not in ("webp", "jpeg") or "a" in request.rel_url.query.get("channel", ""):
                image_format = "webp"
            quality = 90
            if preview_info[-1].isdigit():
                quality = int(preview_info[-1])
            buffer = BytesIO()
            if image_format in ("jpeg",) or request.rel_url.query.get("channel", "") == "rgb":
                img = img.convert("RGB")
            img.save(buffer, format=image_format, quality=quality)
            buffer.seek(0)
            return web.Response(
                body=buffer.read(),
                content_type=f"image/{image_format}",
                headers={"Content-Disposition": f'filename="{filename}"'},
            )

    channel = request.rel_url.query.get("channel", "rgba")
    if channel == "rgb":
        with Image.open(file) as img:
            img = img.convert("RGB")
        buffer = BytesIO()
        img.save(buffer, format="png")
        buffer.seek(0)
        return web.Response(
            body=buffer.read(),
            content_type="image/png",
            headers={"Content-Disposition": f'filename="{filename}"'},
        )

    ctype, _ = _mimetypes.guess_type(filename)
    if not ctype:
        ctype = "application/octet-stream"
    return web.FileResponse(
        file,
        headers={
            "Content-Type": ctype,
            "Content-Disposition": f'filename="{filename}"',
        },
    )


def _resolve_view_candidates(
    ftype: str, subfolder: str, filename: str, user: Optional[str]
) -> list:
    """Isolation-aware candidate paths for one /view request, best first.

    Under per-user isolation a file lives in ``<root>/<user>/...``, but the very
    same file is reachable through four URL shapes: the user segment may sit
    inside ``subfolder`` (what the assets API emits) or be absent entirely (bare
    node-preview URLs), and the request may or may not carry a ``comfy-user``
    header (a browser ``<img>`` cannot send one).  Only one of those shapes is
    what the native handler resolves, so the rest have to be tried here.

    When ``user`` is known every candidate must stay inside that user's own
    directory, so one account can never preview another's assets.  With no
    identity the subfolder — if present — is the only self-describing locator,
    and a bare URL falls back to scanning user directories by basename.
    """
    base = _global_input_dir() if ftype == "input" else _global_output_dir()
    parts = [p for p in (subfolder or "").replace("\\", "/").split("/") if p and p != "."]
    cands: list = []

    def _add(path: str) -> None:
        path = os.path.abspath(path)
        if path not in cands:
            cands.append(path)

    if user:
        udir = os.path.abspath(_user_dir(base, user))

        def _scoped(path: str) -> None:
            # Reject anything escaping the caller's own pool (cross-user leaks).
            if os.path.abspath(path).startswith(udir + os.sep):
                _add(path)

        # subfolder may already carry the user segment; re-prefixing it would
        # double-nest into <root>/<user>/<user>/.
        _scoped(os.path.join(base, *parts, filename))
        rest = parts[1:] if parts and parts[0] == user else parts
        _scoped(os.path.join(udir, *rest, filename))
    elif parts:
        _add(os.path.join(base, *parts, filename))
    elif os.path.isdir(base):
        # Bare URL, no identity: last resort, look inside each user directory.
        for name in sorted(os.listdir(base)):
            cand = os.path.join(base, name, filename)
            if os.path.isfile(cand):
                _add(cand)

    return [c for c in cands if os.path.isfile(c)]


async def _view_fallback(request, original_resp, user):
    """Re-resolve a /view request the native handler could not serve.

    The native handler resolves against ``folder_paths.get_directory_by_type``,
    which under isolation *is* the user directory, so it only finds the file for
    the one shape that carries a ``comfy-user`` header and omits the user
    segment.  The assets API emits URLs that already contain the segment (double
    nesting), and browser ``<img>`` requests cannot send the header at all.  Try
    every isolation-safe location before giving up.
    """
    filename = request.rel_url.query.get("filename")
    if not filename or filename.startswith("blake3:"):
        return original_resp
    ftype = request.rel_url.query.get("type", "output")
    if ftype not in ("input", "output"):
        return original_resp

    fname = os.path.basename(filename)
    if not fname:
        return original_resp
    subfolder = request.rel_url.query.get("subfolder", "")

    for cand in _resolve_view_candidates(ftype, subfolder, fname, user):
        try:
            return _serve_image_file(request, cand, fname)
        except Exception:
            continue
    return original_resp


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
        _install_job_visibility()
        _install_assets_list_filter()
        _install_assets_view_url()
        _install_userdata_unknown_user_guard()
        _INSTALLED = True
        logger.info("[XXXXXLCat] multi-user asset isolation enabled "
                    "(input/<user>/ & output/<user>/; global pool hidden)")
        print("[XXXXXLCat] multi-user asset isolation enabled "
              "(input/<user>/ & output/<user>/; the legacy global input/ output/ pool is hidden from all accounts)")
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[XXXXXLCat] multi-user asset isolation failed to install: %s", exc)
        return False
