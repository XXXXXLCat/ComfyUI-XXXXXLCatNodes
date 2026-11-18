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

``GET /xcat/gallery/prompt?source=&path=&token=``
    Reads the prompt/parameter fields ComfyUI embeds in generated images and
    audio/video containers. Returns ``{found, models, prompts, params, count}``
with each field ``{node, class, key, value, kind}``. Only three groups surface:
``models`` (CheckPoint/UNet/LoRA selectors), ``prompts`` (the positive prompt
only — system/task/negative text is dropped) and ``params`` (seed only, resolved
from the sampler's active input path).
Every other literal in the graph is dropped —
    the strip is a short summary, not a workflow dump. Imported files and media
    without metadata return ``found: false``. Derived from the embedded graph,
    not the in-memory history, so it survives restarts.

``POST /xcat/gallery/zip``
    Packs the requested files into a ZIP (stored, not deflated — media is
    already compressed) and returns it in one response.

``POST /xcat/gallery/delete``
    Moves the requested files to the Recycle Bin (``SHFileOperationW`` with
    ``FOF_ALLOWUNDO``), so a mistaken delete can be undone from Explorer. Every
    path is re-resolved through the same resolver the read routes use, so a
    crafted request can only touch files the caller could already read.

``POST /xcat/gallery/insert``
    Prepares one file for use inside a workflow: ``LoadImage`` / ``LoadVideo``
    / ``LoadAudio`` only read from the input directory, so a file that lives in
    ``output/`` (or in a sub-folder) is hard-linked — or copied, when linking is
    not possible — into the account's input root. The reply names the file the
    caller should put into the node's widget.

``GET/POST /xcat/media/folder`` and ``POST /xcat/media/folder/pick``
    The sidebar 媒体 panel lets the user pick an arbitrary local directory as
    the save target for node content. It is stored per account next to
    api_settings.json and exposed to the gallery as the ``media`` source, so
    previews/downloads reuse the signed file route. The picker runs a tiny
    tkinter helper with a system Python, because ComfyUI's embedded Python
    has no tkinter and headless COM dialogs could stay invisible.

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
import ctypes
import hashlib
import hmac
import io
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import time
import uuid
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
PROMPT_ROUTE = "/xcat/gallery/prompt"
ZIP_ROUTE = "/xcat/gallery/zip"
DELETE_ROUTE = "/xcat/gallery/delete"
INSERT_ROUTE = "/xcat/gallery/insert"
# Sidebar 媒体 panel: the user-chosen folder is exposed as a third gallery
# source, so previews/downloads/inserts reuse the exact same pipeline.
MEDIA_SOURCE = "media"
MEDIA_FOLDER_FILE = "media_folder.json"
MEDIA_FOLDER_ROUTE = "/xcat/media/folder"
MEDIA_PICK_ROUTE = "/xcat/media/folder/pick"
# Node / group / selection "添加到收藏": copy the asset bytes into the
# user-chosen 收藏 folder, sorted into text/image/video/audio sub-folders.
FAVORITES_ADD_ROUTE = "/xcat/favorites/add"
# Sidebar 提示词 panel: a per-account list of saved {title, text} snippets,
# stored in one JSON file under the user's Cat-Nodes data dir.
PROMPTS_FILE = "prompts.json"
PROMPTS_ROUTE = "/xcat/prompts"
# Folder names are the four Chinese category labels the user listed; the
# 收藏 panel lists everything under the chosen root recursively anyway.
_FAVORITES_KIND_DIR = {
    "text": "文本",
    "image": "图像",
    "video": "视频",
    "audio": "音频",
}

# Only a deliberately small set of widget values is surfaced in the lightbox:
# the model/LoRA choices, the prompt text, and the four sampling knobs. Every
# other literal in the graph (image paths, resize modes, dtype, custom-node
# toggles, ...) is intentionally dropped — the info strip is a summary, not a
# dump of the whole workflow.
#
# Text widgets. `value` is shared with booleans/numbers, so it only counts on a
# node whose class name says text/string/prompt/caption/lyrics.
_PROMPT_INPUT_KEYS = ("text", "caption", "lyrics", "prompt", "positive", "negative")
_TEXT_NODE_HINTS = ("text", "string", "prompt", "caption", "lyrics", "note")
# Only the positive prompt is worth showing. System-prep prompts (the "you are
# a prompt engineer" strings), negative prompts and captions/lyrics are all
# dropped here rather than cluttering the lightbox with a second wall of text.
_PROMPT_DENY_HINTS = (
    "system", "系统",
    "task_prompt", "task prompt", "taskprompt", "任务提示",
    "negative", "neg_", "negprompt", "负面", "反向",
)
_PROMPT_POSITIVE_HINTS = ("positive", "正向", "正面", "主提示", "提示词", "prompt")
# Titles are missing on many API-format graphs, so names alone cannot decide.
# These are the raw widget keys a positive prompt can sit in, including the
# fragments of a composed prompt (Switch / StringConcatenate nodes).
_PROMPT_FRAGMENT_KEYS = ("string_a", "string_b", "on_false", "on_true")
# System prompts are recognisable by their opening boilerplate even when the
# node has no title at all. Checked before the length heuristics.
_SYSTEM_TEXT_MARKERS = (
    "you are ", "your task", "think step by step", "reason in the thinking",
    "first \u2014", "first -", "expert prompt engineer", "prompt engineer",
    "system prompt", "the visible final", "instructions:", "detailed description",
    # MiniMax H3 ships a long "prompt writing guide" as a separate text node.
    "prompt writing guide", "视频提示词编写指南", "edit propagation:",
)
# Model/LoRA selectors. LoRAs come in three shapes in the wild:
#   LoraLoaderModelOnly: lora_name / strength_model
#   LoadLoraModel (list): loras.N.lora_name / loras.N.strength / loras.N.enabled
#   🐈‍⬛StackLoras:        lora_NN / strength_NN / on_NN
_MODEL_CLASS_HINTS = ("checkpointloader", "unetloader", "lora")
_MODEL_KEY_HINTS = ("checkpoint_name", "unet_name", "lora_name", "lora_", "strength", "model_strength")
# A LoRA entry is only real when its companion enable flag says so. The flags
# ship inside the same API node for list-style loaders (``loras.N.enabled``)
# and stack nodes (``on_NN``); a whole UI node can additionally be muted or
# bypassed via ``mode``, which the ``workflow`` chunk records.
_LORA_OFF_VALUES = {"", "0", "false", "off", "no", "none", "null"}
_LORA_NAME_PLACEHOLDERS = {"", "none", "null", "undefined", "无"}
# Only the seed is worth showing now, and only via a sampler's input port.
# ``SamplerCustomAdvanced.noise`` leads to ``RandomNoise.noise_seed``;
# ``KSampler.seed``/generator ``seed`` leads to a SeedNode/PrimitiveInt or
# is a literal. ``steps``/``cfg`` and text-generation knobs are not surfaced.
_SEED_INPUT_PORTS = ("noise", "seed")
_SEED_SOURCE_KEYS = ("seed", "noise_seed")
# Max characters returned for one prompt field — a lightbox caption, not a dump.
_MAX_PROMPT_CHARS = 8000

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


def _user_root_for(uid: str) -> str:
    """User root for an EXPLICIT account id, mirroring server_routes._user_root.

    The context-based ``_user_root()`` reads the current request's identity,
    which is absent for header-free <img> loads of a signed media URL. Signed
    media links carry their owner in ``u`` so we can rebuild the same path.
    """
    import folder_paths

    getter = getattr(folder_paths, "get_public_user_directory", None)
    if callable(getter):
        try:
            path = getter(uid)
            if path:
                return path
        except Exception:
            pass
    return os.path.join(folder_paths.get_user_directory(), uid)


def _media_settings_path(user: Optional[str] = None) -> str:
    """Per-account JSON holding the 媒体 folder, next to api_settings.json.

    With ``user`` given (from a signed URL's owner), read that account's
    settings even when the request carries no identity header — needed for
    <img>/<video> previews, which cannot send Comfy-User.
    """
    try:
        from ..server_routes import PLUGIN_DATA_DIR

        if user:
            root = _user_root_for(user)
        else:
            from ..server_routes import _user_root

            root = _user_root()
    except Exception:  # pragma: no cover - loaded outside the package
        import folder_paths

        root = _user_root_for(user) if user else folder_paths.get_user_directory()
        PLUGIN_DATA_DIR = "Cat-Nodes"
    return os.path.join(root, PLUGIN_DATA_DIR, MEDIA_FOLDER_FILE)


def _load_media_folder(user: Optional[str] = None) -> str:
    try:
        with open(_media_settings_path(user), "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return ""
    if isinstance(data, dict):
        return str(data.get("folder") or "")
    return str(data) if isinstance(data, str) else ""


def _save_media_folder(folder: str) -> str:
    """Validate and persist an absolute directory; return its normalised path."""
    value = os.path.abspath(os.path.expanduser(str(folder).strip()))
    if not value or not os.path.isdir(value):
        raise ValueError("folder does not exist")
    path = _media_settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"folder": value}, handle, ensure_ascii=False, indent=2)
    return value


def _media_root(user: Optional[str] = None) -> Optional[str]:
    folder = _load_media_folder(user)
    if not folder:
        return None
    folder = os.path.abspath(folder)
    return folder if os.path.isdir(folder) else None


def _global_roots(user: Optional[str] = None) -> Dict[str, str]:
    """Un-scoped roots: ``output`` / ``input`` plus the chosen 媒体 folder."""
    import folder_paths

    roots = {
        "output": os.path.abspath(folder_paths.output_directory),
        "input": os.path.abspath(folder_paths.input_directory),
    }
    media = _media_root(user)
    if media:
        roots[MEDIA_SOURCE] = media
    return roots


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


def _sign(source: str, path: str, bucket: int, owner: str = "") -> str:
    # A media folder is per-account absolute state with no user segment in the
    # path, so bind the owner into the signature. `<img>`/`<video>` cannot send
    # Comfy-User; the signed `u` is the only safe way to locate the right folder.
    payload = f"{bucket}|{source}|{path}"
    if owner:
        payload += f"|{owner}"
    return hmac.new(_TOKEN_SECRET, payload.encode("utf-8"), hashlib.sha256).hexdigest()[:24]


def _make_token(source: str, path: str, owner: str = "") -> str:
    bucket = _token_bucket()
    return f"{bucket:x}.{_sign(source, path, bucket, owner)}"


def _check_token(token: str, source: str, path: str, owner: str = "") -> bool:
    try:
        raw_bucket, signature = (token or "").split(".", 1)
        bucket = int(raw_bucket, 16)
    except Exception:
        return False
    if bucket not in (_token_bucket(), _token_bucket() - 1):
        return False
    # The owner (when present) is HMAC-bound: changing `u` in a signed media URL
    # invalidates the signature, so a forged owner cannot resolve another
    # account's 收藏 folder.
    expected = _sign(source, path, bucket, owner)
    return hmac.compare_digest(signature, expected)


def _verify_signed_url(
    token: str, source: str, path: str, owner: str, user: Optional[str]
) -> tuple:
    """Return ``(trusted, resolve_owner)`` for a signed gallery URL.

    ``owner`` (the URL's ``u`` param) is HMAC-bound — if present it MUST verify,
    so a tampered value can never point at another account's 收藏 folder. When
    the URL has no ``u`` but the caller carries an identity, a media URL minted
    with that owner still verifies using ``user``; the legacy no-owner signature
    is accepted last so pre-upgrade URLs keep working for their owner only.
    """
    if owner:
        return (_check_token(token, source, path, owner), owner)
    # No `u` in the URL: rely on the request identity if any.
    candidates = [user, ""] if user else [""]
    for candidate in candidates:
        if _check_token(token, source, path, candidate or ""):
            return (True, candidate or "")
    return (False, "")


def _file_url(source: str, path: str, preview: bool, owner: str = "") -> str:
    params = {"source": source, "path": path}
    if preview:
        params["preview"] = "1"
    if owner:
        params["u"] = owner
    params["token"] = _make_token(source, path, owner)
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
    source: str, path: str, user: Optional[str], require_user: bool = True,
    owner: str = "",
) -> Optional[str]:
    """Map a request back to a real file, refusing anything outside its root.

    ``owner`` is the account id carried (and HMAC-signed) in a media URL; when
    the request has no identity header (plain <img>), it is the only way to
    find that account's per-user 收藏 folder.
    """
    parts = _split_path(path)
    if not parts:
        return None

    # For media, prefer the signed owner so a header-free preview resolves the
    # correct per-account folder. output/input roots are global.
    roots = _global_roots(owner or user) if source == MEDIA_SOURCE else _global_roots()
    base = roots.get(source)
    if not base:
        return None

    # In multi-user mode every output/input path starts with the account
    # directory. The hand-picked 媒体 folder is global and has no such segment.
    if source != MEDIA_SOURCE and require_user and user:
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
    entries: List[dict] = []

    for source, root in roots.items():
        # The 媒体 folder is a user-picked absolute path, not ComfyUI's
        # account-scoped output/input tree — never prefix it with the user id.
        prefix = "" if source == MEDIA_SOURCE else (f"{user}/" if user else "")
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
                        # Media files live in a per-account folder; bind the
                        # owner so header-free previews can resolve it later.
                        "url": _file_url(
                            source, path, False,
                            (user or "") if source == MEDIA_SOURCE else "",
                        ),
                        "preview_url": (
                            _file_url(
                                source, path, True,
                                (user or "") if source == MEDIA_SOURCE else "",
                            )
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


# ------------------------------------------------------ 媒体存放文件夹 -----

async def _h_media_folder(request: web.Request) -> web.Response:
    """Current user-chosen folder (empty string means not configured yet)."""
    folder = _load_media_folder()
    return web.json_response(
        {"folder": folder, "exists": bool(folder and os.path.isdir(folder))},
        headers={"Cache-Control": "no-store"},
    )


async def _h_media_folder_set(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid body"}, status=400)
    folder = str((payload or {}).get("folder") or "").strip()
    if not folder:
        return web.json_response({"error": "empty folder"}, status=400)
    try:
        saved = await asyncio.to_thread(_save_media_folder, folder)
    except ValueError:
        return web.json_response({"error": "folder does not exist"}, status=400)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"folder": saved})


_TK_PYTHON: Optional[str] = None
_PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PICK_SCRIPT = os.path.join(_PLUGIN_ROOT, "pick_folder_tk.py")


def _system_tk_python() -> str:
    """Find a system Python that can show a native tkinter folder dialog.

    ComfyUI's bundled Python deliberately omits tkinter.  A hidden PowerShell
    WinForms dialog and a direct ``SHBrowseForFolderW`` call both stayed
    invisible when the server itself had no visible window, so the chooser is
    delegated to a normal Python process; its Tk window is visible even when
    the launcher console is hidden.  The result is cached per server process.
    """
    global _TK_PYTHON
    if _TK_PYTHON is not None:
        return _TK_PYTHON

    local = os.environ.get("LOCALAPPDATA", "")
    program_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
    candidates: List[str] = []
    versions = ("Python314", "Python313", "Python312", "Python311", "Python310")
    for version in versions:
        candidates.append(os.path.join(local, "Programs", "Python", version, "python.exe"))
        candidates.append(os.path.join(program_files, version, "python.exe"))
        candidates.append(os.path.join("C:\\", version, "python.exe"))
    candidates.append(os.path.join(local, "Python", "bin", "python.exe"))
    on_path = shutil.which("python.exe")
    if on_path:
        candidates.append(on_path)

    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    seen = set()
    for exe in candidates:
        key = os.path.normcase(os.path.abspath(exe))
        if key in seen or not os.path.isfile(exe):
            continue
        seen.add(key)
        try:
            probe = subprocess.run(
                [exe, "-c", "import tkinter"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=3, creationflags=flags,
            )
        except Exception:
            continue
        if probe.returncode == 0:
            _TK_PYTHON = exe
            return exe

    _TK_PYTHON = ""
    return ""


def _pick_folder_blocking() -> str:
    """Native Windows folder dialog; returns '' when the user cancels."""
    if os.name != "nt":
        raise RuntimeError("folder picker requires Windows")
    if not os.path.isfile(_PICK_SCRIPT):
        raise RuntimeError("folder picker helper is missing: " + _PICK_SCRIPT)

    exe = _system_tk_python()
    if not exe:
        raise RuntimeError("no system Python with tkinter was found")
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.run(
        [exe, _PICK_SCRIPT, _load_media_folder()],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=300, creationflags=flags,
    )
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or "").strip() or "folder dialog failed")
    lines = [line.strip() for line in (proc.stdout or "").splitlines() if line.strip()]
    return lines[-1] if lines else ""


async def _h_media_pick(request: web.Request) -> web.Response:
    try:
        folder = await asyncio.to_thread(_pick_folder_blocking)
    except subprocess.TimeoutExpired:
        return web.json_response({"error": "folder picker timed out"}, status=504)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"folder": folder})


def _save_favorite_blocking(root: str, category: str, filename: str, payload: bytes) -> dict:
    """Write one asset into ``root/<category>/`` with collision dedup.

    Same bytes already stored -> report ``reused`` without writing a copy;
    a different file with the same name gets ``_1`` / ``_2`` ... appended.
    """
    folder = os.path.join(root, category)
    os.makedirs(folder, exist_ok=True)
    stem, ext = os.path.splitext(filename)
    candidate = filename
    index = 1
    while True:
        dest = os.path.join(folder, candidate)
        if not os.path.exists(dest):
            break
        # Avoid piling up byte-identical copies of the same asset.
        try:
            if os.path.getsize(dest) == len(payload):
                with open(dest, "rb") as handle:
                    if handle.read() == payload:
                        return {"filename": candidate, "category": category,
                                "path": dest, "reused": True}
        except OSError:
            pass
        if index > 999:
            raise OSError("too many same-named files in 收藏 folder")
        candidate = f"{stem}_{index}{ext}"
        index += 1
    with open(dest, "wb") as handle:
        handle.write(payload)
    return {"filename": candidate, "category": category, "path": dest, "reused": False}


async def _h_favorites_add(request: web.Request) -> web.Response:
    """Save a canvas asset into the user's chosen 收藏 folder by media kind."""
    root = _media_root()
    if not root:
        return web.json_response({"error": "收藏文件夹尚未设置"}, status=409)
    # kind comes from the node (authoritative); fall back to the file name.
    kind = str(request.query.get("kind", "") or "").strip().lower()
    reader = await request.multipart()
    field = None
    async for part in reader:
        if part.name == "file" and part.filename:
            field = part
            break
    if field is None:
        return web.json_response({"error": "missing file field"}, status=400)
    filename = os.path.basename(str(field.filename).replace("\\", "/"))
    if not filename or filename.startswith("."):
        return web.json_response({"error": "invalid filename"}, status=400)
    if kind not in _FAVORITES_KIND_DIR:
        kind = _kind(filename)
    if kind not in _FAVORITES_KIND_DIR:
        return web.json_response({"error": "unsupported media type"}, status=400)
    payload = await field.read()
    if not payload:
        return web.json_response({"error": "empty file"}, status=400)
    if len(payload) > MAX_ZIP_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=MAX_ZIP_BYTES, actual_size=len(payload)
        )
    category = _FAVORITES_KIND_DIR[kind]
    try:
        saved = await asyncio.to_thread(
            _save_favorite_blocking, root, category, filename, payload
        )
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True, **saved})


# ----------------------------------------------------------- 提示词收藏
# A saved-prompt is {id, title, text, created}. All of one account's prompts
# live in a single JSON file under user/<account>/Cat-Nodes/prompts.json, which
# keeps them isolated per account exactly like canvases and media_folder.json.

def _prompts_path() -> str:
    try:
        from ..server_routes import PLUGIN_DATA_DIR, _user_root

        root = _user_root()
    except Exception:  # pragma: no cover - loaded outside the package
        import folder_paths

        root = folder_paths.get_user_directory()
        PLUGIN_DATA_DIR = "Cat-Nodes"
    return os.path.join(root, PLUGIN_DATA_DIR, PROMPTS_FILE)


def _load_prompts() -> List[dict]:
    try:
        with open(_prompts_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    # Keep only well-formed entries so a hand-edited file cannot break the UI.
    return [
        {
            "id": str(item.get("id") or ""),
            "title": str(item.get("title") or ""),
            "text": str(item.get("text") or ""),
            "created": float(item.get("created") or 0),
        }
        for item in data
        if isinstance(item, dict) and item.get("id")
    ]


def _save_prompts(items: List[dict]) -> None:
    path = _prompts_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(items, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


async def _h_prompts_list(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)
    return web.json_response({"items": await asyncio.to_thread(_load_prompts)})


async def _h_prompts_add(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid body"}, status=400)
    payload = payload or {}
    title = str(payload.get("title") or "").strip()
    text = str(payload.get("text") or "")
    if not title and not text.strip():
        return web.json_response({"error": "empty prompt"}, status=400)
    item = {
        "id": uuid.uuid4().hex,
        "title": title[:200],
        "text": text[:100000],
        "created": time.time(),
    }
    try:
        items = await asyncio.to_thread(_load_prompts)
        items.insert(0, item)  # newest first
        await asyncio.to_thread(_save_prompts, items)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True, "item": item})


async def _h_prompts_delete(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)
    item_id = str(request.query.get("id") or "")
    if not item_id:
        return web.json_response({"error": "missing id"}, status=400)
    items = await asyncio.to_thread(_load_prompts)
    kept = [item for item in items if item.get("id") != item_id]
    if len(kept) == len(items):
        return web.json_response({"error": "not found"}, status=404)
    try:
        await asyncio.to_thread(_save_prompts, kept)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True, "id": item_id})


async def _h_prompts_update(request: web.Request) -> web.Response:
    """Edit an existing saved prompt in place (id + new title/text)."""
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        return web.json_response({"error": "unknown user"}, status=401)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid body"}, status=400)
    payload = payload or {}
    item_id = str(payload.get("id") or "")
    if not item_id:
        return web.json_response({"error": "missing id"}, status=400)
    title = str(payload.get("title") or "").strip()
    text = str(payload.get("text") or "")
    if not title and not text.strip():
        return web.json_response({"error": "empty prompt"}, status=400)
    items = await asyncio.to_thread(_load_prompts)
    updated = None
    for item in items:
        if item.get("id") == item_id:
            item["title"] = title[:200]
            item["text"] = text[:100000]
            updated = item
            break
    if updated is None:
        return web.json_response({"error": "not found"}, status=404)
    try:
        await asyncio.to_thread(_save_prompts, items)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)
    return web.json_response({"ok": True, "item": updated})


# ---------------------------------------------------------------- handlers

async def _h_list(request: web.Request) -> web.Response:
    user = _request_user(request)
    if _multi_user_enabled() and not user:
        # Multi-user always carries an account; without one we must not fall
        # back to the shared pool — that would list everybody's files.
        return web.json_response({"error": "unknown user"}, status=401)

    roots = _global_roots()
    if user:
        roots = {
            k: (v if k == MEDIA_SOURCE else os.path.abspath(os.path.join(v, user)))
            for k, v in roots.items()
        }

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
            "media_folder": _load_media_folder() or "",
        },
        headers={"Cache-Control": "no-store"},
    )


async def _h_file(request: web.Request) -> web.Response:
    source = request.query.get("source", "output")
    path = request.query.get("path", "")
    token = request.query.get("token", "")
    owner = str(request.query.get("u", "") or "")
    user = _request_user(request)

    # A signed media URL carries its HMAC-bound owner. Trust it only when the
    # signature verifies for that exact owner — a tampered `u` cannot resolve
    # another account's 收藏 folder.
    signed_ok, resolve_owner = _verify_signed_url(token, source, path, owner, user)

    if signed_ok:
        # Server-issued URL (thumbnails, downloads, media the browser fetches
        # without any header). Still held to the caller's own tree when the
        # request happens to carry an identity.
        target = _resolve(source, path, user, require_user=True, owner=resolve_owner)
    elif owner:
        # A URL that CLAIMS an owner but fails signature verification is forged;
        # never fall through to the request identity (that would let a tampered
        # `u` resolve another account's folder in single-user/global setups).
        target = None
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


def _looks_like_system_prompt(text: str) -> bool:
    """Catch instruction-style system prompts without relying on node titles."""
    lowered = text.strip().lower()
    if lowered.startswith(tuple(_SYSTEM_TEXT_MARKERS)):
        return True
    if len(text.strip()) > 1200 and any(marker in lowered for marker in _SYSTEM_TEXT_MARKERS):
        return True
    return False


def _is_positive_by_content(key: str, text: str) -> bool:
    """Fallback when the node has no usable title/positive marker.

    Field names never mention "system"/"task"/"negative" for a positive
    prompt, and system prompts announce themselves with boilerplate text.
    """
    lower_key = str(key).lower()
    if any(hint in lower_key for hint in _PROMPT_DENY_HINTS):
        return False
    min_len = 12 if lower_key in _PROMPT_FRAGMENT_KEYS else 4
    if len(text.strip()) < min_len:
        return False
    return not _looks_like_system_prompt(text)


def _is_positive_prompt(node: str, class_type: str, key: str) -> bool:
    """Keep only the user's positive prompt; drop system/negative/caption text."""
    combined = f"{node} {class_type} {key}".lower()
    if any(hint in combined for hint in _PROMPT_DENY_HINTS):
        return False
    if any(hint in combined for hint in _PROMPT_POSITIVE_HINTS):
        return True
    # An untitled CLIPTextEncode "text" widget is ComfyUI's first, positive
    # prompt node; anything else without a positive marker stays hidden.
    return "cliptextencode" in class_type.lower() and str(key).lower() == "text"


# Prompt text is classified by *where it is wired*, not by how it reads. A
# string fed into a node's ``system_prompt``/``negative`` input is a system or
# negative prompt no matter what its node is titled; one fed through a
# ``prompt``/``positive`` chain is the user's generation prompt. Walks start at
# every link-bearing prompt-ish port and follow links upstream, carrying the
# branch kind; plain text widgets in the two sets are then unambiguous.
_PROMPT_EDGE_POS_PORTS = ("prompt", "positive", "conditioning", "caption", "lyrics")
_PROMPT_EDGE_SYS_PORTS = (
    "system_prompt", "system", "negative", "task_prompt", "task prompt",
    "taskprompt", "任务提示", "负面", "反向",
)
_PROMPT_EDGE_TEXT_KEYS = _PROMPT_INPUT_KEYS + ("value",) + _PROMPT_FRAGMENT_KEYS


def _prompt_edge_sets(graph: dict) -> Tuple[set, set]:
    """Return ``(positive, system)`` sets of ``(node_id, key)`` text widgets.

    Follows the API graph's links backwards from prompt-bearing inputs. A text
    widget reached through a ``system_prompt``/``negative`` branch lands in the
    system set even when its node is untitled; one on the positive chain lands
    in the positive set. Nodes with no links keep the caller's title/text
    fallback instead of being forced either way.
    """
    positive: set = set()
    system: set = set()
    seeds = []
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        for key, value in (node.get("inputs") or {}).items():
            if not (isinstance(value, list) and len(value) == 2):
                continue
            lower = str(key).lower()
            if any(h in lower for h in _PROMPT_EDGE_SYS_PORTS):
                seeds.append((str(value[0]), True))
            elif any(h in lower for h in _PROMPT_EDGE_POS_PORTS):
                seeds.append((str(value[0]), False))

    visited = set()
    queue = list(seeds)
    while queue:
        node_id, is_system = queue.pop(0)
        state = (node_id, is_system)
        if state in visited:
            continue
        visited.add(state)
        node = graph.get(node_id)
        if not isinstance(node, dict):
            continue
        for key, value in (node.get("inputs") or {}).items():
            lower = str(key).lower()
            branch = is_system
            if any(h in lower for h in _PROMPT_EDGE_SYS_PORTS):
                branch = True
            elif any(h in lower for h in _PROMPT_EDGE_POS_PORTS):
                branch = False
            if isinstance(value, str) and value.strip():
                if lower in _PROMPT_EDGE_TEXT_KEYS:
                    (system if branch else positive).add((node_id, str(key)))
            elif isinstance(value, list) and len(value) == 2 and isinstance(value[0], (str, int)):
                queue.append((str(value[0]), branch))
    return positive, system


# ---------------------------------------------------------------- LoRA state
# ComfyUI stores API-format graphs in the image metadata, so a disabled LoRA
# still leaves its name/strength/flag widgets behind. Showing only the names
# would claim a LoRA was applied when it was not. These helpers read the flag
# that belongs to the SAME entry, not just the same node: a single LoadLoraModel
# node can carry eight independent rows.
def _flag_is_off(value) -> bool:
    """Absent means enabled; only an explicit false-like value disables."""
    if value is None:
        return False
    if isinstance(value, bool):
        return not value
    if isinstance(value, (int, float)):
        return value == 0
    return str(value).strip().lower() in _LORA_OFF_VALUES


def _lora_group(key: str) -> str:
    """Index token shared by a LoRA name, its strength and its enable flag."""
    lower = str(key).lower()
    match = re.search(r"loras?[._-](\d+)", lower)
    if not match:
        match = re.search(r"(?:name|strength|on|enabled?)[._-](\d+)", lower)
    if not match:
        match = re.search(r"\b(\d+)\b", lower)
        if match and not any(hint in lower for hint in ("lora", "strength", "on_")):
            match = None
    return "i" + match.group(1) if match else "single"


def _is_lora_name_key(key_lower: str) -> bool:
    """True for a widget that carries a LoRA filename (not its strength/flag)."""
    if any(hint in key_lower for hint in ("strength", "enable", "active", "on_")):
        return False
    return key_lower.endswith("lora_name") or key_lower.startswith("lora_")


def _lora_flag_keys(group: str, key_lower: str) -> set:
    """Candidate enable-flag widget names for one LoRA entry."""
    if group == "single":
        return {"enabled", "enable", "on", "active", "lora_enabled", "lora_enable", "lora_on"}
    token = group[1:]
    return {
        f"loras.{token}.enabled", f"loras.{token}.enable", f"loras.{token}.on",
        f"lora_{token}_enabled", f"lora_{token}_enable", f"lora_{token}_on",
        f"on_{token}", f"enabled_{token}", f"enable_{token}", f"active_{token}",
    }


def _lora_entry_off(inputs: dict, key: str) -> bool:
    group = _lora_group(key)
    for flag in _lora_flag_keys(group, str(key).lower()):
        if flag in inputs and _flag_is_off(inputs[flag]):
            return True
    return False


def _workflow_node_off(node: dict) -> bool:
    """UI-graph mute/bypass state for one node id.

    Litegraph uses ``0`` for always-on; any other ``mode`` (2 = bypass, 4 =
    mute, 1 = never) means the node did not contribute to the result.
    """
    mode = node.get("mode")
    if mode not in (None, 0, "0", "always"):
        return True
    flags = node.get("flags")
    flags = flags if isinstance(flags, dict) else {}
    for name in ("disabled", "bypassed", "mute", "muted"):
        if node.get(name) is True or flags.get(name) is True:
            return True
    return False


def _is_graph_link(value) -> bool:
    """API-format link reference: ``[source_node_id, output_slot]``."""
    return (
        isinstance(value, (list, tuple)) and len(value) == 2
        and isinstance(value[0], (str, int)) and isinstance(value[1], int)
    )


def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _active_link_target(graph: dict, value, disabled_ids: set,
                        seen: Optional[set] = None):
    """Node id actually feeding a link, following switch nodes by state.

    Video workflows often switch between ``BasicScheduler`` and
    ``ManualSigmas``. Reading parameters off both branches would report a
    step count that was not used, so only the selected branch is followed.
    """
    if not _is_graph_link(value):
        return None
    seen = set() if seen is None else seen
    node_id = str(value[0])
    if node_id in disabled_ids or node_id in seen:
        return None
    seen.add(node_id)
    node = graph.get(node_id)
    if not isinstance(node, dict):
        return None
    inputs = node.get("inputs") or {}
    class_lower = str(node.get("class_type") or "").lower()
    if "switch" in class_lower and isinstance(inputs, dict):
        chosen = inputs.get("on_true") if _truthy(inputs.get("switch")) else inputs.get("on_false")
        if not _is_graph_link(chosen):
            return None
        return _active_link_target(graph, chosen, disabled_ids, seen)
    return node_id


def _scalar_from_node(graph: dict, node_id, keys, disabled_ids: set,
                      seen: Optional[set] = None):
    """Find the first scalar behind a primitive/seed/sampler source node."""
    if node_id is None:
        return None
    node_id = str(node_id)
    if node_id in disabled_ids:
        return None
    node = graph.get(node_id)
    if not isinstance(node, dict):
        return None
    inputs = node.get("inputs") or {}
    if not isinstance(inputs, dict):
        return None
    seen = set() if seen is None else seen
    if node_id in seen:
        return None
    seen.add(node_id)
    search_keys = tuple(dict.fromkeys(tuple(keys) + ("value", "seed", "noise_seed")))
    for key in search_keys:
        candidate = inputs.get(key)
        if isinstance(candidate, (str, int, float, bool)):
            if str(candidate).strip():
                return candidate
        elif _is_graph_link(candidate):
            target = _active_link_target(graph, candidate, disabled_ids)
            if target is not None:
                found = _scalar_from_node(graph, target, keys, disabled_ids, set(seen))
                if found is not None:
                    return found
    return None


# Nodes that consume a seed. Sources (noise/seed/primitive/switch nodes) are
# only followed from one of these consumers, never reported on their own.
_PARAM_ROOT_HINTS = ("sampler", "generatemusic", "generateabc", "generateaudio")


def _sampler_fields(graph: dict, disabled_ids: set) -> List[dict]:
    """Resolve the seed from a sampler's *active* input path."""
    fields: List[dict] = []
    seen = set()

    def add(label: str, value, node_id: str, title: str, class_type: str):
        if value is None:
            return
        text = str(value).strip()
        if not text:
            return
        identity = (label, text)
        if identity in seen:
            return
        seen.add(identity)
        fields.append({
            "node": title,
            "id": str(node_id),
            "group": "",
            "class": class_type,
            "key": label,
            "value": text,
            "kind": "param",
        })

    for node_id, node in graph.items():
        if not isinstance(node, dict) or str(node_id) in disabled_ids:
            continue
        class_type = str(node.get("class_type") or "")
        class_lower = class_type.lower()
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        title = str((node.get("_meta") or {}).get("title") or class_type or node_id)
        has_seed_port = any(port in inputs for port in _SEED_INPUT_PORTS)
        is_root = (
            (any(hint in class_lower for hint in _PARAM_ROOT_HINTS) and "select" not in class_lower)
            or has_seed_port
        )
        if not is_root:
            continue

        # Seed is read only from the sampler's own input ports, then followed
        # upstream through the active branch — never from a loose widget with
        # a matching name elsewhere in the graph.
        for port in _SEED_INPUT_PORTS:
            value = inputs.get(port)
            if value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                add("seed", value, node_id, title, class_type)
            elif _is_graph_link(value):
                target = _active_link_target(graph, value, disabled_ids)
                add("seed", _scalar_from_node(graph, target, _SEED_SOURCE_KEYS, disabled_ids),
                    node_id, title, class_type)

    return fields


def _prompt_fields(graph: dict, titles: Optional[Dict[str, str]] = None,
                   disabled_ids: Optional[set] = None) -> List[dict]:
    """Pick the few fields worth showing from an API-format prompt graph.

    ComfyUI embeds this graph in generated PNGs under ``prompt``. Model/LoRA
    and prompt widgets are literals; the seed may be wired to a primitive node
    or reached through a switch, so it is resolved from the sampler's active
    input path instead. We keep only three groups — model/LoRA, the positive
    prompt, and the seed — and drop everything else. Node titles come from
    ``_meta.title``, then the ``workflow`` graph, then the class type.
    """
    fields: List[dict] = []
    titles = titles or {}
    disabled_ids = disabled_ids or set()
    param_fields = _sampler_fields(graph, disabled_ids)
    edge_positive, edge_system = _prompt_edge_sets(graph)
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            continue
        if str(node_id) in disabled_ids:
            continue
        class_type = str(node.get("class_type") or "")
        class_lower = class_type.lower()
        title = str(
            (node.get("_meta") or {}).get("title")
            or titles.get(str(node_id))
            or class_type
            or node_id
        )
        inputs = node.get("inputs") or {}
        if not isinstance(inputs, dict):
            continue
        is_text_node = any(h in class_lower for h in _TEXT_NODE_HINTS)
        is_model_node = any(h in class_lower for h in _MODEL_CLASS_HINTS)
        # Placeholder rows ("None") carry a strength widget too; dropping only
        # the filename would leave an orphan "强度" badge behind.
        placeholder_groups = set()
        if is_model_node:
            for widget, widget_value in inputs.items():
                if (_is_lora_name_key(str(widget).lower())
                        and str(widget_value).strip().lower() in _LORA_NAME_PLACEHOLDERS):
                    placeholder_groups.add(_lora_group(widget))
        for key, value in inputs.items():
            key_lower = str(key).lower()
            # Links and nested structures are graph plumbing, not parameters.
            if not isinstance(value, (str, int, float, bool)):
                continue
            text = str(value)
            if not text.strip():
                continue

            kind: Optional[str] = None
            label = str(key)
            group = ""

            if is_model_node:
                # Only model/LoRA selectors on a model node. Skip the node's
                # unrelated knobs (weight_dtype, enabled flags, etc.).
                if any(h in key_lower for h in _MODEL_KEY_HINTS):
                    name_key = _is_lora_name_key(key_lower)
                    strength_key = "strength" in key_lower
                    if name_key or strength_key:
                        group = _lora_group(key_lower)
                        # An off row must not contribute either its filename
                        # or its strength, or the next row would borrow it.
                        if _lora_entry_off(inputs, key):
                            continue
                        if name_key and text.strip().lower() in _LORA_NAME_PLACEHOLDERS:
                            continue
                        if strength_key and group in placeholder_groups:
                            continue
                    kind = "model"
                    if name_key:
                        label = "LoRA"
                    elif "checkpoint" in key_lower:
                        label = "Checkpoint"
                    elif "unet" in key_lower:
                        label = "UNet"
                    elif strength_key:
                        label = "强度"
            elif is_text_node:
                if key_lower in _PROMPT_INPUT_KEYS or key_lower == "value":
                    kind = "prompt"
            elif key_lower in _PROMPT_INPUT_KEYS:
                kind = "prompt"
            elif key_lower in _PROMPT_FRAGMENT_KEYS:
                # Switch / StringConcatenate fragments: these nodes often have
                # no title, so the text itself decides below.
                kind = "prompt"

            if kind is None:
                continue
            if kind == "prompt":
                slot = (str(node_id), str(key))
                # Two independent guards, system always wins:
                #  1. Text shape — instruction boilerplate ("you are ...",
                #     "edit propagation:", a prompt-writing guide) is a system
                #     instruction even when its widget is literally named
                #     "prompt" and is wired as a literal (no link to trace).
                #  2. Wiring — a widget reached from a system_prompt/negative
                #     branch is out regardless of title or length.
                if slot in edge_system or _looks_like_system_prompt(text):
                    continue
                if slot in edge_positive:
                    pass
                elif not _is_positive_prompt(title, class_type, key) and not _is_positive_by_content(key, text):
                    # Fallback for widgets with no usable link (older/flat
                    # graphs): let the node title / field name decide.
                    continue
            if len(text) > _MAX_PROMPT_CHARS:
                text = text[:_MAX_PROMPT_CHARS] + "…"
            fields.append({
                "node": title,
                "id": str(node_id),
                "group": group,
                "class": class_type,
                "key": label,
                "value": text,
                "kind": kind,
            })

    # One workflow can feed the same seed to several samplers (e.g. YuE2).
    # Show each distinct value once instead of stacking identical badges.
    deduped: List[dict] = []
    seen_params = set()
    for field in fields + param_fields:
        if field["kind"] == "param":
            identity = (field["key"], field["value"])
            if identity in seen_params:
                continue
            seen_params.add(identity)
        deduped.append(field)
    return deduped


# ComfyUI writes the API graph into image text chunks, and into the container
# metadata of videos/audio saved through SaveVideo / SaveAudio*. Both use the
# same two keys: ``prompt`` (API graph) and ``workflow`` (UI graph titles).
_IMAGE_META_EXTS = (".png", ".webp", ".jpg", ".jpeg")
_AV_META_EXTS = (
    ".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v",
    ".mp3", ".flac", ".opus", ".ogg", ".wav", ".m4a", ".aac",
)


def _extract_metadata(target: str) -> Optional[dict]:
    """Read prompt/parameter fields from a generated file's embedded metadata.

    Returns ``None`` when the file carries no metadata (imported files, files
    saved with ``--disable-metadata``, text/unknown kinds). Images expose the
    ComfyUI text chunks through PIL; videos and audio expose the same keys
    through PyAV container metadata.
    """
    ext = os.path.splitext(target)[1].lower()
    try:
        if ext in _IMAGE_META_EXTS:
            from PIL import Image

            with Image.open(target) as image:
                info = dict(image.info or {})
        elif ext in _AV_META_EXTS:
            import av

            with av.open(target) as container:
                info = dict(container.metadata or {})
        else:
            return None
    except Exception:
        return None

    raw_prompt = info.get("prompt")
    if not raw_prompt:
        return None
    try:
        graph = json.loads(raw_prompt) if isinstance(raw_prompt, str) else raw_prompt
    except Exception:
        return None
    if not isinstance(graph, dict) or not graph:
        return None

    # Workflow titles enrich the bare API graph: match node id -> title. The
    # same nodes carry their mute/bypass mode, so a disabled branch is skipped
    # even when an older file still embedded its widgets in the prompt graph.
    raw_workflow = info.get("workflow")
    titles: Dict[str, str] = {}
    disabled_ids: set = set()
    if raw_workflow:
        try:
            workflow = json.loads(raw_workflow) if isinstance(raw_workflow, str) else raw_workflow
            for node in (workflow.get("nodes") or []):
                nid = str(node.get("id"))
                if not nid:
                    continue
                title = node.get("title") or node.get("type") or ""
                if title:
                    titles[nid] = str(title)
                if _workflow_node_off(node):
                    disabled_ids.add(nid)
        except Exception:
            titles = {}
            disabled_ids = set()

    fields = _prompt_fields(graph, titles, disabled_ids)
    if not fields:
        return None

    models = [f for f in fields if f["kind"] == "model"]
    prompts = []
    seen_prompts = set()
    for field in fields:
        if field["kind"] != "prompt":
            continue
        # A composed graph often exposes the same text twice: once through a
        # Switch/StringConcatenate fragment and once through the text generator.
        if field["value"] in seen_prompts:
            continue
        seen_prompts.add(field["value"])
        prompts.append(field)
    params = [f for f in fields if f["kind"] == "param"]
    return {
        "models": models,
        "prompts": prompts,
        "params": params,
        "count": len(fields),
    }


async def _h_prompt(request: web.Request) -> web.Response:
    """Return prompt/parameter fields embedded in a generated file."""
    source = request.query.get("source", "output")
    path = request.query.get("path", "")
    token = request.query.get("token", "")
    owner = str(request.query.get("u", "") or "")
    user = _request_user(request)

    signed_ok, resolve_owner = _verify_signed_url(token, source, path, owner, user)

    if signed_ok:
        target = _resolve(source, path, user, require_user=True, owner=resolve_owner)
    elif owner:
        target = None  # forged owner — never fall through to request identity
    elif user:
        target = _resolve(source, path, user, require_user=True)
    else:
        target = None
    if target is None:
        return web.Response(status=404)

    try:
        data = await asyncio.to_thread(_extract_metadata, target)
    except Exception:
        data = None
    if data is None:
        return web.json_response({"found": False, "models": [], "prompts": [], "params": [], "count": 0})
    return web.json_response(
        {"found": True, **data},
        headers={"Cache-Control": "private, max-age=300"},
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
        members.append((
            target,
            _zip_name(item["path"], None if item["source"] == MEDIA_SOURCE else user),
        ))

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


# ------------------------------------------------------------ recycle bin

_FO_DELETE = 0x0003
_FOF_SILENT = 0x0004
_FOF_NOCONFIRMATION = 0x0010
_FOF_ALLOWUNDO = 0x0040
_FOF_NOERRORUI = 0x0400


class _SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("wFunc", ctypes.c_uint),
        ("pFrom", ctypes.c_wchar_p),
        ("pTo", ctypes.c_wchar_p),
        ("fFlags", ctypes.c_ushort),
        ("fAnyOperationsAborted", ctypes.c_int),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", ctypes.c_wchar_p),
    ]


def _recycle(paths: List[str]) -> Optional[str]:
    """Move ``paths`` to the Recycle Bin. Returns an error message, else ``None``.

    ``SHFileOperationW`` with ``FOF_ALLOWUNDO`` is the shell's own delete path,
    so the entry keeps its original name, size and deletion time and can be
    restored from the Recycle Bin. Called through ``asyncio.to_thread``: the
    COM apartment this opens belongs to the worker thread, never to the event
    loop.
    """
    if not paths:
        return None
    if os.name != "nt":
        return "the Recycle Bin is only available on Windows"

    # SHFileOperation takes a double-NUL terminated list of absolute paths.
    from_list = "\0".join(os.path.abspath(p) for p in paths) + "\0\0"
    op = _SHFILEOPSTRUCTW(
        hwnd=None,
        wFunc=_FO_DELETE,
        pFrom=from_list,
        pTo=None,
        fFlags=_FOF_ALLOWUNDO | _FOF_NOCONFIRMATION | _FOF_SILENT | _FOF_NOERRORUI,
        fAnyOperationsAborted=0,
        hNameMappings=None,
        lpszProgressTitle=None,
    )

    shell32 = ctypes.windll.shell32
    shell32.SHFileOperationW.argtypes = [ctypes.POINTER(_SHFILEOPSTRUCTW)]
    shell32.SHFileOperationW.restype = ctypes.c_int

    ole32 = ctypes.windll.ole32
    ole32.CoInitializeEx.restype = ctypes.c_long
    # S_OK / S_FALSE mean this call opened the apartment and must close it;
    # RPC_E_CHANGED_MODE means one was already open, which we must leave alone.
    opened = ole32.CoInitializeEx(None, 0) in (0, 1)
    try:
        code = shell32.SHFileOperationW(ctypes.byref(op))
    finally:
        if opened:
            ole32.CoUninitialize()

    if code:
        return f"shell error 0x{code:04X}"
    if op.fAnyOperationsAborted:
        return "recycle aborted"
    return None


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

    pending: List[Tuple[dict, str]] = []
    failed: List[dict] = []
    for item in items:
        target = _resolve(item["source"], item["path"], user, require_user=True)
        if target is None:
            failed.append({**item, "error": "not found"})
            continue
        pending.append((item, target))

    deleted: List[str] = []
    if pending:
        # One shell call for the whole batch: the Recycle Bin entry is written
        # once, and either the batch is recycled or it is not.
        error = await asyncio.to_thread(_recycle, [p for _, p in pending])
        if error:
            for item, _target in pending:
                failed.append({**item, "error": error})
        else:
            for item, target in pending:
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

def _node_input_dir() -> str:
    """The input directory a Load* node of this caller will actually read.

    Asked of ComfyUI itself rather than rebuilt from the account id: under
    ``--multi-user`` the isolation layer scopes this getter, and a file staged
    anywhere else leaves the node with a value its resolver cannot open
    ("Invalid image file", shown in the UI as a missing input).
    """
    try:
        import folder_paths

        return os.path.abspath(folder_paths.get_input_directory())
    except Exception:
        return _global_roots()["input"]


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


def _place_in_input(target: str, dest_dir: str) -> Tuple[str, bool]:
    """Make ``target`` readable by LoadImage / LoadVideo / LoadAudio.

    Those nodes resolve through ``get_annotated_filepath`` — the input
    directory — and the frontend combo only lists files sitting directly in its
    root, so an output file (or one buried in a sub-folder) is hard-linked next
    to it. Hard-linking keeps the input tree free of duplicated bytes; a plain
    copy is used when the volumes differ.

    ``dest_dir`` must be the directory the loader itself would resolve (see
    :func:`_node_input_dir`); staging anywhere else yields a node whose value
    cannot be opened.

    Returns ``(filename, reused)`` where ``reused`` means nothing was written.
    """
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


def _node_can_open(filename: str, dest_dir: str) -> bool:
    """Whether the loader's own resolver would open ``filename`` right now."""
    try:
        import folder_paths

        return bool(folder_paths.exists_annotated_filepath(filename))
    except ValueError:
        # `[name]rest` would be read as an annotated path; such a value can
        # never resolve inside the input directory.
        return False
    except Exception:
        return os.path.isfile(os.path.join(dest_dir, filename))


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

    # Resolved here, on the request's own coroutine: the isolation layer keeps
    # the account in a context variable, and this is the directory the node
    # itself will look in when the prompt runs.
    dest_dir = _node_input_dir()
    try:
        filename, reused = await asyncio.to_thread(_place_in_input, target, dest_dir)
    except OSError as exc:
        return web.json_response({"error": str(exc)}, status=500)

    # A node holding a filename its resolver rejects shows up as a missing
    # input, so refuse to hand out a value that cannot be opened.
    if not _node_can_open(filename, dest_dir):
        return web.json_response(
            {"error": "staged file is not visible to the loader", "dir": dest_dir},
            status=500,
        )

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
            app.router.add_route("GET", prefix + PROMPT_ROUTE, _h_prompt)
            app.router.add_route("POST", prefix + ZIP_ROUTE, _h_zip)
            app.router.add_route("POST", prefix + DELETE_ROUTE, _h_delete)
            app.router.add_route("POST", prefix + INSERT_ROUTE, _h_insert)
            app.router.add_route("GET", prefix + MEDIA_FOLDER_ROUTE, _h_media_folder)
            app.router.add_route("POST", prefix + MEDIA_FOLDER_ROUTE, _h_media_folder_set)
            app.router.add_route("POST", prefix + MEDIA_PICK_ROUTE, _h_media_pick)
            app.router.add_route("POST", prefix + FAVORITES_ADD_ROUTE, _h_favorites_add)
            app.router.add_route("GET", prefix + PROMPTS_ROUTE, _h_prompts_list)
            app.router.add_route("POST", prefix + PROMPTS_ROUTE, _h_prompts_add)
            app.router.add_route("PUT", prefix + PROMPTS_ROUTE, _h_prompts_update)
            app.router.add_route("DELETE", prefix + PROMPTS_ROUTE, _h_prompts_delete)
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
