"""History gallery — browse, download and delete the account's own files.

ComfyUI's sidebar *Assets* panel only lists what the current frontend session
knows about: media produced while the tab has been open (``已生成``) and files
uploaded through the UI (``已导入``). Files that already sit on disk — outputs
from an earlier run, files copied in by hand, videos written by a custom node —
never show up.

This module adds a small HTTP API that enumerates the account's ``output/`` and
``input/`` trees, plus the sidebar tab in ``web/history_gallery.js`` that
renders them with the native media-asset layout:

``GET /xcat/gallery``
    JSON manifest ``{"files": [...], "total": n, "truncated": bool, ...}``.
    Each entry carries ``{id, source, subfolder, filename, path, kind, size,
    mtime, url, preview_url}``. ``source`` is ``"output"`` or ``"input"``;
    ``subfolder`` is relative to the account root (what the UI prints) while
    ``path`` is the same file expressed under the global directory — the form
    the file route takes.

``GET /xcat/gallery/file?source=&path=&token=[&preview=1]``
    Streams the file. With ``preview=1`` an image is downscaled, a video gets
    one frame decoded (PyAV ships with ComfyUI), and a text file yields its
    opening characters — all as a compact payload for the grid. Anything else
    is served as a normal range-capable response, which is what the audio
    player, the lightbox and downloads need.

``POST /xcat/gallery/zip``
    Packs the requested files into a ZIP (stored, not deflated — media is
    already compressed) and returns it in one response.

``POST /xcat/gallery/delete``
    Removes the requested files **from disk**. Every path is re-resolved
    through the same resolver the read routes use, so a crafted request can
    only ever delete files the caller could already read.

``POST /xcat/gallery/insert``
    Prepares one file for use inside a workflow: ``LoadImage`` / ``LoadVideo``
    / ``LoadAudio`` only read from the input directory, so a file that lives in
    ``output/`` (or in a sub-folder) is hard-linked — or copied, when linking is
    not possible — into the account's input root. The reply names the file the
    caller should put into the node's widget.

Identity and isolation
----------------------
Under ``--multi-user`` the listing is scoped to the signed-in account's
``output/<user>/`` and ``input/<user>/`` trees; the legacy global pool stays
hidden. Identity comes from ComfyUI's own ``Comfy-User`` header (the frontend
adds it to every ``api.fetchApi`` call).

Thumbnails and downloads, however, are loaded by the browser through native
``<img>``/``<video>``/``<a download>`` requests, which **cannot** carry that
header. Those URLs are therefore server-issued capabilities: each manifest
entry ships a ``token`` — an HMAC over the file's path — that the file route
accepts on its own. Holding a manifest entry is what grants read access, so a
header-less request can only fetch a file the server itself offered, and never
one belonging to another account. Both routes that mutate (zip is read-only but
scoped, delete) require a real identity and refuse when multi-user mode is on
and no account is attached.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import io
import logging
import mimetypes
import os
import shutil
import time
import zipfile
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode

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

# Upper bound on one manifest response. Sorted newest-first, so a huge tree
# still shows its most relevant files instead of timing out.
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

# ZIP guards: a whole-directory selection must not pin the server on memory.
MAX_ZIP_FILES = 500
MAX_ZIP_BYTES = 2 * 1024 * 1024 * 1024

LIST_ROUTE = "/xcat/gallery"
FILE_ROUTE = "/xcat/gallery/file"
ZIP_ROUTE = "/xcat/gallery/zip"
DELETE_ROUTE = "/xcat/gallery/delete"
INSERT_ROUTE = "/xcat/gallery/insert"

# kind -> (node type, widget the filename goes into). Only core loaders: they
# resolve through get_annotated_filepath(), i.e. the input directory.
_INSERT_NODES = {
    "image": ("LoadImage", "image"),
    "video": ("LoadVideo", "file"),
    "audio": ("LoadAudio", "audio"),
}

# Per-process secret for the capability tokens carried by media URLs. A restart
# invalidates every issued URL, which is fine: the panel refetches its manifest.
_TOKEN_SECRET = os.urandom(32)
# Tokens roll over daily and the previous day's stay valid, so a panel left open
# overnight does not start 404-ing at midnight.
_TOKEN_WINDOW = 86400


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


def _global_roots() -> Dict[str, str]:
    """The un-scoped ``output`` / ``input`` directories, whatever the mode."""
    import folder_paths

    return {
        "output": os.path.abspath(folder_paths.output_directory),
        "input": os.path.abspath(folder_paths.input_directory),
    }


def _current_user() -> Optional[str]:
    """Active account id, or ``None`` in single-user mode / system accounts.

    Must be read from the request's own coroutine: the isolation layer carries
    the identity in a context variable, which worker threads do not inherit.
    """
    if not _multi_user_enabled():
        return None
    try:
        from . import multi_user_assets as assets

        return assets._current_user() or None
    except Exception:
        return None


def _request_user(request: web.Request) -> Optional[str]:
    """Identity for this request, falling back to the raw header."""
    user = _current_user()
    if user:
        return user
    try:
        from server import PromptServer

        manager = getattr(PromptServer.instance, "user_manager", None)
        if manager is None:
            return None
        return manager.get_request_user_id(request)
    except Exception:
        return None


def _token_bucket() -> int:
    return int(time.time()) // _TOKEN_WINDOW


def _sign(source: str, path: str, bucket: int) -> str:
    payload = f"{bucket}|{source}|{path}".encode("utf-8")
    return hmac.new(_TOKEN_SECRET, payload, hashlib.sha256).hexdigest()[:24]


def _make_token(source: str, path: str) -> str:
    bucket = _token_bucket()
    return f"{bucket:x}.{_sign(source, path, bucket)}"


def _check_token(token: str, source: str, path: str) -> bool:
    try:
        raw_bucket, signature = (token or "").split(".", 1)
        bucket = int(raw_bucket, 16)
    except Exception:
        return False
    if bucket not in (_token_bucket(), _token_bucket() - 1):
        return False
    return hmac.compare_digest(signature, _sign(source, path, bucket))


def _file_url(source: str, path: str, preview: bool) -> str:
    params = {"source": source, "path": path}
    if preview:
        params["preview"] = "1"
    params["token"] = _make_token(source, path)
    return f"{FILE_ROUTE}?{urlencode(params)}"


def _split_path(path: str) -> Optional[List[str]]:
    """Normalised path segments, or ``None`` for anything unsafe."""
    if not path:
        return None
    parts = [p for p in path.replace("\\", "/").split("/") if p and p != "."]
    if not parts or any(p == ".." for p in parts):
        return None
    return parts


def _resolve(
    source: str, path: str, user: Optional[str], require_user: bool = True
) -> Optional[str]:
    """Map a request back to a real file, refusing anything outside its root."""
    parts = _split_path(path)
    if not parts:
        return None

    roots = _global_roots()
    base = roots.get(source)
    if not base:
        return None

    # In multi-user mode every scoped path starts with the account directory.
    if require_user and user:
        if len(parts) < 2 or parts[0] != user:
            return None

    target = os.path.abspath(os.path.join(base, *parts))
    if target != base and not target.startswith(base + os.sep):
        return None
    if not os.path.isfile(target):
        return None
    return target


def _collect(roots: Dict[str, str], user: Optional[str]) -> List[dict]:
    """Walk every root and return one manifest entry per file."""
    prefix = f"{user}/" if user else ""
    entries: List[dict] = []

    for source, root in roots.items():
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            # Hidden folders are caches / VCS noise, never user assets.
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            rel = os.path.relpath(dirpath, root).replace("\\", "/")
            rel = "" if rel == "." else rel

            for name in filenames:
                if name in _SKIP_FILES or name.startswith("."):
                    continue
                try:
                    stat = os.stat(os.path.join(dirpath, name))
                except OSError:
                    continue

                scoped = f"{rel}/{name}" if rel else name
                path = prefix + scoped
                kind = _kind(name)
                entries.append(
                    {
                        "id": f"{source}:{path}",
                        "source": source,
                        "subfolder": rel,
                        "filename": name,
                        "path": path,
                        "kind": kind,
                        "size": stat.st_size,
                        "mtime": stat.st_mtime,
                        "url": _file_url(source, path, False),
                        "preview_url": (
                            _file_url(source, path, True)
                            if kind in ("image", "video", "text")
                            else None
                        ),
                    }
                )
    return entries


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
            stream = next((s for s in container.streams if s.type == "video"), None)
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


def _selection(request_payload) -> List[dict]:
    """Normalise the ``{"files": [{source, path}]}`` body every write route takes."""
    if not isinstance(request_payload, dict):
        return []
    items = request_payload.get("files")
    if not isinstance(items, list):
        return []
    out = []
    for item in items:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "output")
        path = str(item.get("path") or "")
        if path:
            out.append({"source": source, "path": path})
    return out


def _zip_name(path: str, user: Optional[str]) -> str:
    """Archive member name: the file's own sub-path, minus the account segment."""
    parts = _split_path(path) or []
    if user and parts and parts[0] == user:
        parts = parts[1:]
    return "/".join(parts) if parts else "file"


def _build_zip(members: List[Tuple[str, str]]) -> bytes:
    buf = io.BytesIO()
    used = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as archive:
        for disk_path, member in members:
            name = member
            if name in used:
                stem, dot, ext = name.rpartition(".")
                base = stem if dot else name
                suffix = ext if dot else ""
                index = 2
                while f"{base} ({index}){suffix}" in used:
                    index += 1
                name = f"{base} ({index}){suffix}"
            used.add(name)
            archive.write(disk_path, name)
    return buf.getvalue()


# ---------------------------------------------------------------- handlers

async def _h_list(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        # Multi-user always carries an account; without one we must not fall
        # back to the shared pool — that would list everybody's files.
        return web.json_response({"error": "unknown user"}, status=401)

    roots = _global_roots()
    if user:
        roots = {k: os.path.abspath(os.path.join(v, user)) for k, v in roots.items()}

    # Big trees take a while to stat — keep the event loop free. Roots and the
    # account id are resolved here (request context) and passed down, because a
    # worker thread does not inherit the identity context variable.
    files = await asyncio.to_thread(_collect, roots, user)
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
            "user": user,
            "multi_user": _multi_user_enabled(),
        },
        headers={"Cache-Control": "no-store"},
    )


async def _h_file(request: web.Request) -> web.Response:
    source = request.query.get("source", "output")
    path = request.query.get("path", "")
    token = request.query.get("token", "")
    user = _request_user(request)

    if _check_token(token, source, path):
        # Server-issued URL (thumbnails, downloads, media the browser fetches
        # without any header). Still held to the caller's own tree when the
        # request happens to carry an identity.
        target = _resolve(source, path, user, require_user=True)
    elif user:
        target = _resolve(source, path, user, require_user=True)
    else:
        target = None

    if target is None:
        return web.Response(status=404)

    filename = os.path.basename(target)

    if request.query.get("preview") in ("1", "true"):
        kind = _kind(filename)
        if kind in ("image", "video"):
            async with _thumb_slots():
                data = await asyncio.to_thread(_thumbnail, target, kind)
            if data:
                return web.Response(
                    body=data,
                    content_type="image/webp",
                    headers={"Cache-Control": "private, max-age=300"},
                )
        elif kind == "text":
            head = await asyncio.to_thread(_text_head, target)
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
        target,
        headers={
            "Cache-Control": "private, max-age=60",
            "Content-Type": content_type,
        },
    )


async def _h_zip(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)

    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid body"}, status=400)

    items = _selection(payload)
    if not items:
        return web.json_response({"error": "no files"}, status=400)
    if len(items) > MAX_ZIP_FILES:
        return web.json_response({"error": "too many files"}, status=413)

    members: List[Tuple[str, str]] = []
    total = 0
    for item in items:
        target = _resolve(item["source"], item["path"], user, require_user=True)
        if target is None:
            continue
        try:
            total += os.path.getsize(target)
        except OSError:
            continue
        members.append((target, _zip_name(item["path"], user)))

    if not members:
        return web.json_response({"error": "no readable files"}, status=404)
    if total > MAX_ZIP_BYTES:
        return web.json_response({"error": "archive too large"}, status=413)

    data = await asyncio.to_thread(_build_zip, members)
    stamp = time.strftime("%Y-%m-%d-%H-%M-%S")
    return web.Response(
        body=data,
        content_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="comfyui-gallery-{stamp}.zip"',
            "Cache-Control": "no-store",
        },
    )


async def _h_delete(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)

    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid body"}, status=400)

    items = _selection(payload)
    if not items:
        return web.json_response({"error": "no files"}, status=400)

    deleted: List[str] = []
    failed: List[dict] = []
    for item in items:
        target = _resolve(item["source"], item["path"], user, require_user=True)
        if target is None:
            failed.append({**item, "error": "not found"})
            continue
        try:
            os.remove(target)
        except OSError as exc:
            failed.append({**item, "error": str(exc)})
            continue
        deleted.append(f"{item['source']}:{item['path']}")
        # Drop the cached thumbnail so a re-created file is not served stale.
        for key in list(_THUMBS):
            if key[0] == target:
                _THUMBS.pop(key, None)
                if key in _THUMB_ORDER:
                    _THUMB_ORDER.remove(key)

    return web.json_response(
        {"deleted": deleted, "failed": failed}, headers={"Cache-Control": "no-store"}
    )


# ---------------------------------------------------------------- insert

def _user_input_dir(user: Optional[str]) -> str:
    """The input directory a node of this account reads from."""
    base = _global_roots()["input"]
    return os.path.join(base, user) if user else base


def _same_bytes(a: str, b: str) -> bool:
    """Identity check that never reads a whole video twice for nothing."""
    try:
        if os.path.getsize(a) != os.path.getsize(b):
            return False
        with open(a, "rb") as fa, open(b, "rb") as fb:
            while True:
                left = fa.read(1 << 20)
                right = fb.read(1 << 20)
                if left != right:
                    return False
                if not left:
                    return True
    except OSError:
        return False


def _place_in_input(target: str, user: Optional[str]) -> Tuple[str, bool]:
    """Make ``target`` readable by LoadImage / LoadVideo / LoadAudio.

    Those nodes resolve through ``get_annotated_filepath`` — the input
    directory — and the frontend combo only lists files sitting directly in its
    root, so an output file (or one buried in a sub-folder) is hard-linked next
    to it. Hard-linking keeps the input tree free of duplicated bytes; a plain
    copy is used when the volumes differ.

    Returns ``(filename, reused)`` where ``reused`` means nothing was written.
    """
    dest_dir = _user_input_dir(user)
    source_dir = os.path.dirname(target)
    name = os.path.basename(target)

    if os.path.normcase(os.path.abspath(source_dir)) == os.path.normcase(
        os.path.abspath(dest_dir)
    ):
        return name, True

    os.makedirs(dest_dir, exist_ok=True)
    stem, ext = os.path.splitext(name)
    candidate = name
    index = 1
    while True:
        dest = os.path.join(dest_dir, candidate)
        if not os.path.exists(dest):
            break
        # Inserting the same file twice must not pile up numbered copies.
        if _same_bytes(target, dest):
            return candidate, True
        if index > 999:
            raise OSError("too many same-named files in input")
        candidate = f"{stem}_{index}{ext}"
        index += 1

    try:
        os.link(target, dest)
    except OSError:
        shutil.copy2(target, dest)
    return candidate, False


async def _h_insert(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)

    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid body"}, status=400)

    items = _selection(payload)
    if not items:
        return web.json_response({"error": "no files"}, status=400)

    item = items[0]
    target = _resolve(item["source"], item["path"], user, require_user=True)
    if target is None:
        return web.json_response({"error": "not found"}, status=404)

    kind = _kind(target)
    typed = _INSERT_NODES.get(kind)
    if typed is None:
        # 3D models / text have no core loader that reads the input directory.
        return web.json_response({"error": "unsupported", "kind": kind}, status=415)

    try:
        filename, reused = await asyncio.to_thread(_place_in_input, target, user)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)

    node, widget = typed
    return web.json_response(
        {
            "filename": filename,
            "kind": kind,
            "node": node,
            "widget": widget,
            "reused": reused,
            "source_filename": os.path.basename(target),
        },
        headers={"Cache-Control": "no-store"},
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
        # Core mirrors every route registered on PromptServer's table under
        # /api as well, but only for the routes that exist when it builds its
        # own tables — ours are added afterwards, so the alias is wired here.
        # `api.fetchApi()` on the frontend always talks to the /api form.
        for prefix in ("", "/api"):
            app.router.add_route("GET", prefix + LIST_ROUTE, _h_list)
            app.router.add_route("GET", prefix + FILE_ROUTE, _h_file)
            app.router.add_route("POST", prefix + ZIP_ROUTE, _h_zip)
            app.router.add_route("POST", prefix + DELETE_ROUTE, _h_delete)
            app.router.add_route("POST", prefix + INSERT_ROUTE, _h_insert)
        _ROUTES_DONE = True
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[XXXXXLCat] could not add history gallery routes: %s", exc)


def install() -> bool:
    """Attach the gallery routes. Safe to call more than once."""
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
        logger.warning("[XXXXXLCat] history gallery not installed: %s", exc)
        return False
