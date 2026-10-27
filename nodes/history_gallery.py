"""Output gallery — browse every file in ComfyUI's ``output/`` directory.

ComfyUI's sidebar *Assets* panel only lists what the current frontend session
knows about: images produced while the tab has been open (``已生成``) and files
uploaded into ``input/`` (``已导入``). Files that already sit on disk — outputs
from an earlier run, files copied in by hand, videos written by a custom node —
never show up.

This module adds a tiny read-only HTTP API that enumerates the whole output
tree, plus the sidebar tab in ``web/history_gallery.js`` that renders it:

``GET /xcat/outputs``
    JSON manifest: ``{"files": [...], "total": n, "truncated": bool, "user": id}``.
    Each entry is ``{filename, subfolder, scope, kind, size, mtime}``.

``GET /xcat/outputs/file?scope=&subfolder=&filename=[&preview=1]``
    Streams the file. With ``preview=1`` an image is downscaled, a video gets one
    frame decoded (PyAV, already a ComfyUI dependency) — both returned as a
    compact WebP — and a text file yields its opening characters as
    ``text/plain`` (the grid prints that snippet inside the tile). Anything else
    is served as a normal (range-capable) file response, which is what the audio
    player and the lightbox need.

Under ``--multi-user`` the listing follows the same isolation rules as the asset
patch: the caller's own ``output/<user>/`` tree plus the legacy global pool as a
read-only "shared" scope whose entries are served only when the path really
lives outside every account directory. In single-user mode there is one scope
covering the whole output directory.

The whole feature is read-only: no route here writes, renames or deletes.
"""

from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
import os
from typing import Dict, List, Optional, Tuple

from aiohttp import web

logger = logging.getLogger("XXXXXLCat.history_gallery")

# Extensions grouped by how the gallery should present them. The first three
# lists mirror the frontend's own getMediaTypeFromFilename() tables so a file is
# classified identically in both sidebars; the extras are formats ComfyUI nodes
# write that the frontend simply does not know about.
_IMAGE_EXT = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff",
    ".avif", ".jxl", ".svg",
}
_VIDEO_EXT = {
    ".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".mpg", ".mpeg", ".gifv",
}
_AUDIO_EXT = {".mp3", ".wav", ".flac", ".ogg", ".opus", ".m4a", ".aac"}
_THREE_D_EXT = {
    ".obj", ".fbx", ".gltf", ".glb", ".stl", ".usdz", ".ply", ".spz",
    ".splat", ".ksplat",
}
_TEXT_EXT = {".txt", ".md", ".markdown", ".json", ".csv", ".yaml", ".yml", ".xml", ".log"}

# How much of a text file a tile needs to show its opening lines.
TEXT_PREVIEW_CHARS = 1200
TEXT_PREVIEW_BYTES = 8192

# Bookkeeping files ComfyUI drops into output/ — never interesting to a user.
_SKIP_FILES = {"_output_images_will_be_put_here", "desktop.ini", ".DS_Store"}

# Upper bound on one manifest response. Sorted newest-first, so a huge output
# folder still shows its most relevant files instead of timing out.
MAX_FILES = 5000

# Downscale target for grid thumbnails.
PREVIEW_MAX = 512
_PREVIEW_LIMIT = 400  # in-memory thumbnail cache entries

_THUMBS: Dict[Tuple[str, int, int], bytes] = {}
_THUMB_ORDER: List[Tuple[str, int, int]] = []

# Decoding is CPU bound (a video frame costs ~150 ms), so thumbnails run in
# worker threads and only a few at a time — a grid of clips must never stall the
# event loop that also drives prompt execution.
_THUMB_WORKERS = 3
_THUMB_SLOTS: Optional[asyncio.Semaphore] = None


def _thumb_slots() -> asyncio.Semaphore:
    global _THUMB_SLOTS
    if _THUMB_SLOTS is None:
        _THUMB_SLOTS = asyncio.Semaphore(_THUMB_WORKERS)
    return _THUMB_SLOTS

_INSTALLED = False
_ROUTES_DONE = False


# ---------------------------------------------------------------- helpers

def _kind(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext in _IMAGE_EXT:
        return "image"
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _AUDIO_EXT:
        return "audio"
    if ext in _THREE_D_EXT:
        return "3d"
    if ext in _TEXT_EXT:
        return "text"
    return "other"


def _multi_user_enabled() -> bool:
    try:
        from comfy.cli_args import args
    except Exception:
        return False
    return bool(getattr(args, "multi_user", False))


def _global_output_root() -> str:
    import folder_paths

    return os.path.abspath(folder_paths.output_directory)


def _current_user() -> Optional[str]:
    """Active user id, or ``None`` in single-user mode / system accounts."""
    if not _multi_user_enabled():
        return None
    try:
        from . import multi_user_assets as assets

        return assets._current_user()
    except Exception:
        return None


def _known_user_ids() -> set:
    """User ids that own a private directory under the global output root."""
    ids = set()
    try:
        import server

        manager = getattr(server.PromptServer.instance, "user_manager", None)
        users = getattr(manager, "users", None)
        if isinstance(users, dict):
            ids.update(str(k) for k in users)
    except Exception:
        pass
    return ids


def _roots() -> List[Tuple[str, str, str]]:
    """``[(scope, absolute_root, label)]`` for the current request."""
    root = _global_output_root()
    user = _current_user()
    if user:
        return [
            ("mine", os.path.abspath(os.path.join(root, user)), "我的输出"),
            ("shared", root, "共享"),
        ]
    return [("all", root, "输出")]


def _scan(root: str, scope: str, skip_dirs: Optional[set] = None) -> List[dict]:
    """Walk ``root`` and return one manifest entry per file."""
    entries: List[dict] = []
    if not os.path.isdir(root):
        return entries

    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root).replace("\\", "/")
        if rel == ".":
            rel = ""
            if skip_dirs:
                dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        # Hidden folders are caches / VCS noise, never user assets.
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]

        for name in filenames:
            if name in _SKIP_FILES or name.startswith("."):
                continue
            path = os.path.join(dirpath, name)
            try:
                stat = os.stat(path)
            except OSError:
                continue
            entries.append(
                {
                    "filename": name,
                    "subfolder": rel,
                    "scope": scope,
                    "kind": _kind(name),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime,
                }
            )
    return entries


def _resolve(scope: str, subfolder: str, filename: str) -> Optional[str]:
    """Map a request back to a real file, refusing anything outside its root."""
    if not filename or filename in (".", ".."):
        return None
    if "/" in filename or "\\" in filename:
        return None

    roots = {s: r for s, r, _ in _roots()}
    root = roots.get(scope)
    if not root:
        return None

    base = os.path.abspath(root)
    parts = [p for p in (subfolder or "").replace("\\", "/").split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        return None

    path = os.path.abspath(os.path.join(base, *parts, filename))
    if path != base and not path.startswith(base + os.sep):
        return None
    if not os.path.isfile(path):
        return None

    # The shared pool must never leak another account's private directory.
    if scope == "shared" and _multi_user_enabled():
        try:
            first = os.path.relpath(path, base).replace("\\", "/").split("/")[0]
        except ValueError:
            return None
        if first in _known_user_ids() or first == _current_user():
            return None
    return path


def _encode_webp(img) -> bytes:
    from PIL import Image

    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    img.thumbnail((PREVIEW_MAX, PREVIEW_MAX), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=72, method=4)
    return buf.getvalue()


def _video_frame(path: str):
    """One representative frame from a video, as a PIL image.

    PyAV ships with ComfyUI (that is how the video nodes decode), so no extra
    dependency is needed. The frame is taken slightly into the clip because the
    very first frame of a fade-in is often black.
    """
    try:
        import av
    except Exception:
        return None

    try:
        with av.open(path) as container:
            stream = next(
                (s for s in container.streams if s.type == "video"), None
            )
            if stream is None:
                return None

            duration = 0.0
            try:
                if stream.duration and stream.time_base:
                    duration = float(stream.duration * stream.time_base)
            except Exception:
                duration = 0.0

            offset = min(1.0, duration * 0.1) if duration > 0 else 0.0
            if offset > 0.05:
                try:
                    container.seek(
                        int(offset * 1_000_000),
                        stream=stream,
                        backward=True,
                        any_frame=False,
                    )
                except Exception:
                    pass

            for frame in container.decode(stream):
                try:
                    return frame.to_image()
                except Exception:
                    return None
    except Exception as exc:
        logger.debug("[XXXXXLCat] video frame failed for %s: %s", path, exc)
    return None


def _thumbnail(path: str, kind: str = "image") -> Optional[bytes]:
    try:
        stat = os.stat(path)
    except OSError:
        return None

    key = (path, stat.st_mtime_ns, stat.st_size)
    cached = _THUMBS.get(key)
    if cached is not None:
        return cached

    data: Optional[bytes] = None
    if kind == "video":
        frame = _video_frame(path)
        if frame is not None:
            try:
                data = _encode_webp(frame)
            except Exception as exc:
                logger.debug("[XXXXXLCat] video thumb failed for %s: %s", path, exc)
    else:
        try:
            from PIL import Image, ImageOps

            with Image.open(path) as img:
                # JPEGs can be decoded straight at a smaller size — much faster.
                try:
                    img.draft("RGB", (PREVIEW_MAX * 2, PREVIEW_MAX * 2))
                except Exception:
                    pass
                img = ImageOps.exif_transpose(img) or img
                data = _encode_webp(img)
        except Exception as exc:  # unreadable / unsupported image
            logger.debug("[XXXXXLCat] thumbnail failed for %s: %s", path, exc)

    if data is None:
        return None

    if len(_THUMB_ORDER) >= _PREVIEW_LIMIT:
        old = _THUMB_ORDER.pop(0)
        _THUMBS.pop(old, None)
    _THUMBS[key] = data
    _THUMB_ORDER.append(key)
    return data


def _text_head(path: str) -> Optional[str]:
    """First slice of a text file, for the tile snippet / the lightbox pane."""
    try:
        with open(path, "rb") as fh:
            raw = fh.read(TEXT_PREVIEW_BYTES)
    except OSError:
        return None
    text = raw.decode("utf-8", "replace")
    # A cut multi-byte character shows up as U+FFFD on the boundary; drop it.
    return text[:TEXT_PREVIEW_CHARS].rstrip("\ufffd")


# ---------------------------------------------------------------- handlers

async def _h_list(request: web.Request) -> web.Response:
    skip = _known_user_ids()

    def collect() -> List[dict]:
        found: List[dict] = []
        for scope, root, _label in _roots():
            found.extend(_scan(root, scope, skip_dirs=skip if scope == "shared" else None))
        return found

    # big trees take a while to stat — keep the event loop free
    files = await asyncio.to_thread(collect)
    files.sort(key=lambda f: f["mtime"], reverse=True)
    total = len(files)
    truncated = total > MAX_FILES
    if truncated:
        files = files[:MAX_FILES]

    return web.json_response(
        {
            "files": files,
            "total": total,
            "truncated": truncated,
            "user": _current_user(),
            "multi_user": _multi_user_enabled(),
        },
        headers={"Cache-Control": "no-store"},
    )


async def _h_file(request: web.Request) -> web.Response:
    scope = request.query.get("scope", "all")
    filename = request.query.get("filename", "")
    subfolder = request.query.get("subfolder", "")

    path = _resolve(scope, subfolder, filename)
    if path is None:
        return web.Response(status=404)

    if request.query.get("preview") in ("1", "true"):
        kind = _kind(filename)
        if kind in ("image", "video"):
            async with _thumb_slots():
                data = await asyncio.to_thread(_thumbnail, path, kind)
            if data:
                return web.Response(
                    body=data,
                    content_type="image/webp",
                    headers={"Cache-Control": "private, max-age=300"},
                )
        elif kind == "text":
            head = await asyncio.to_thread(_text_head, path)
            if head is not None:
                return web.Response(
                    text=head,
                    content_type="text/plain",
                    charset="utf-8",
                    headers={"Cache-Control": "private, max-age=300"},
                )
        # Non-media (and files we could not decode) fall through to the real
        # file so the grid can still show a download link.

    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return web.FileResponse(
        path,
        headers={
            "Cache-Control": "private, max-age=60",
            "Content-Type": content_type,
        },
    )


# ---------------------------------------------------------------- install

def _attach(server_instance) -> None:
    app = getattr(server_instance, "app", None)
    if app is None:
        return

    global _ROUTES_DONE
    if _ROUTES_DONE:
        return
    try:
        app.router.add_route("GET", "/xcat/outputs", _h_list)
        app.router.add_route("GET", "/xcat/outputs/file", _h_file)
        _ROUTES_DONE = True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[XXXXXLCat] could not add output gallery routes: %s", exc)


def install() -> bool:
    """Attach the read-only gallery routes. Safe to call more than once."""
    global _INSTALLED
    if _INSTALLED:
        return False
    try:
        import server

        orig_init = server.PromptServer.__init__

        def _patched_init(self, *a, **k):
            orig_init(self, *a, **k)
            _attach(self)

        server.PromptServer.__init__ = _patched_init

        inst = getattr(server.PromptServer, "instance", None)
        if inst is not None:
            _attach(inst)

        _INSTALLED = True
        return True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[XXXXXLCat] output gallery not installed: %s", exc)
        return False
