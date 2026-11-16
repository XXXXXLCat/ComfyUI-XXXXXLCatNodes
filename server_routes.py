"""HTTP endpoints backing the embedded infinite canvas frontend.

Routes are registered under ``/api/infcanvas/*`` because ``app.api.fetchApi``
prefixes bare routes with ``/api``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time
import urllib.parse
import uuid
from typing import Any

import folder_paths
from aiohttp import web
from server import PromptServer

PACK_ROOT = os.path.dirname(os.path.realpath(__file__))
WORKFLOW_DIR = os.path.join(PACK_ROOT, "workflows")

NAME_RE = re.compile(r"^[A-Za-z0-9_\-. ]{1,120}$")
STEM_RE = re.compile(r"[^A-Za-z0-9_\- ]")
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
MAX_ASSETS = 600

KIND_BY_EXT = {
    ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image",
    ".gif": "image", ".bmp": "image", ".avif": "image", ".svg": "image",
    ".mp4": "video", ".webm": "video", ".mov": "video", ".mkv": "video",
    ".avi": "video", ".gifv": "video",
    ".mp3": "audio", ".wav": "audio", ".flac": "audio", ".ogg": "audio",
    ".m4a": "audio", ".aac": "audio",
    ".txt": "text", ".md": "text", ".json": "text", ".csv": "text",
}

_registered = False


def _user_root() -> str:
    getter = getattr(folder_paths, "get_user_directory", None)
    if callable(getter):
        try:
            return getter()
        except Exception:
            pass
    return os.path.join(
        os.path.dirname(folder_paths.get_input_directory()), "user", "default"
    )


def _canvas_dir() -> str:
    path = os.path.join(_user_root(), "infinite_canvas", "canvases")
    os.makedirs(path, exist_ok=True)
    return path


def _upload_dir() -> str:
    path = os.path.join(folder_paths.get_input_directory(), "infcanvas")
    os.makedirs(path, exist_ok=True)
    return path


def _safe_name(name: Any) -> str:
    if not isinstance(name, str):
        raise web.HTTPBadRequest(reason="Invalid name")
    value = name.strip()
    if not NAME_RE.fullmatch(value) or value in (".", "..") or ".." in value:
        raise web.HTTPBadRequest(reason="Invalid name")
    return value


def _canvas_path(name: str) -> str:
    return os.path.join(_canvas_dir(), _safe_name(name) + ".json")


def _kind_of(filename: str) -> str | None:
    return KIND_BY_EXT.get(os.path.splitext(filename)[1].lower())


def _view_url(filename: str, subfolder: str, folder_type: str) -> str:
    query = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": folder_type}
    )
    return "/view?" + query


def _scan_assets(root: str, folder_type: str, prefix: str = "") -> list[dict]:
    items: list[dict] = []
    if not os.path.isdir(root):
        return items
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            rel_dir = ""
        elif rel_dir.count(os.sep) >= 2:
            dirnames[:] = []
            continue
        else:
            rel_dir = rel_dir.replace("\\", "/")
        subfolder = "/".join(part for part in (prefix, rel_dir) if part)
        for filename in filenames:
            kind = _kind_of(filename)
            if kind is None:
                continue
            full = os.path.join(dirpath, filename)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            items.append({
                "name": filename,
                "filename": filename,
                "subfolder": subfolder,
                "type": folder_type,
                "kind": kind,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime),
                "url": _view_url(filename, subfolder, folder_type),
                "path": (subfolder + "/" if subfolder else "") + filename,
            })
            if len(items) >= MAX_ASSETS:
                return items
    return items


async def health(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "pack": "ComfyUI_InfiniteCanvas", "version": "0.1.0"})


async def list_canvases(request: web.Request) -> web.Response:
    canvases = []
    for filename in os.listdir(_canvas_dir()):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(_canvas_dir(), filename)
        try:
            stat = os.stat(path)
        except OSError:
            continue
        canvases.append({
            "name": filename[:-5],
            "size": stat.st_size,
            "mtime": int(stat.st_mtime),
        })
    canvases.sort(key=lambda item: item["mtime"], reverse=True)
    return web.json_response({"canvases": canvases})


async def get_canvas(request: web.Request) -> web.Response:
    name = _safe_name(request.query.get("name", ""))
    path = _canvas_path(name)
    if not os.path.isfile(path):
        return web.json_response({"exists": False, "name": name})
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    return web.json_response({"exists": True, "name": name, "data": data})


async def save_canvas(request: web.Request) -> web.Response:
    body = await request.json()
    name = _safe_name(body.get("name", ""))
    data = body.get("data")
    if not isinstance(data, (dict, list)):
        raise web.HTTPBadRequest(reason="Invalid canvas data")
    path = _canvas_path(name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)
    return web.json_response({"ok": True, "name": name})


async def delete_canvas(request: web.Request) -> web.Response:
    name = _safe_name(request.query.get("name", ""))
    path = _canvas_path(name)
    if os.path.isfile(path):
        os.remove(path)
    return web.json_response({"ok": True, "name": name})


async def upload_asset(request: web.Request) -> web.Response:
    if request.content_length and request.content_length > MAX_UPLOAD_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=MAX_UPLOAD_BYTES, actual_size=request.content_length
        )
    reader = await request.multipart()
    field = await reader.next()
    if field is None or not field.filename:
        raise web.HTTPBadRequest(reason="Missing file field")
    filename = os.path.basename(field.filename.replace("\\", "/"))
    extension = os.path.splitext(filename)[1].lower()
    if extension not in KIND_BY_EXT:
        raise web.HTTPBadRequest(reason="Unsupported media type")
    payload = await field.read()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise web.HTTPRequestEntityTooLarge(
            max_size=MAX_UPLOAD_BYTES, actual_size=len(payload)
        )
    stem = STEM_RE.sub("_", os.path.splitext(filename)[0])[:80].strip() or "asset"
    final = f"{stem}_{time.strftime('%Y%m%d%H%M%S')}_{os.getpid() % 1000}{extension}"
    path = os.path.join(_upload_dir(), final)
    with open(path, "wb") as handle:
        handle.write(payload)
    asset = {
        "name": final,
        "filename": final,
        "subfolder": "infcanvas",
        "type": "input",
        "kind": KIND_BY_EXT[extension],
        "size": len(payload),
        "mtime": int(time.time()),
        "url": _view_url(final, "infcanvas", "input"),
        "path": "infcanvas/" + final,
    }
    return web.json_response({"ok": True, "asset": asset})


async def list_assets(request: web.Request) -> web.Response:
    items = _scan_assets(_upload_dir(), "input", "infcanvas")
    items += _scan_assets(folder_paths.get_output_directory(), "output")
    items.sort(key=lambda item: item["mtime"], reverse=True)
    return web.json_response({"assets": items[:MAX_ASSETS]})


# ------------------------------------------------------- API 配置弹窗 -----
# Mirrors the reference project's "工作流配置" backend contract
# (Workspace-XXXXXLCatNodes/infinite_canvas __init__.py):
#   GET /settings (readiness probe), GET/POST /workflows, PUT /workflows/order,
#   GET/DELETE /workflows/{name}, GET/PUT /workflows/{name}/fields
# The older read-only /workflows + /workflow?name= pair above is kept for the
# generate node's workflow selector; these new routes do not change it.

API_SETTINGS_FILE = "api_settings.json"
WF_NAME_RE = re.compile(r"^[^/\\:*?\"<>|]{1,120}$")
# The bundled templates carry manifest keys that are not ComfyUI API nodes.
WF_META_KEYS = {"kind", "name", "hint"}


def _api_settings_path() -> str:
    return os.path.join(_user_root(), "infinite_canvas", API_SETTINGS_FILE)


def _load_api_settings() -> dict:
    try:
        with open(_api_settings_path(), "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_api_settings(**patch: Any) -> dict:
    path = _api_settings_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    settings = _load_api_settings()
    settings.update(patch)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(settings, handle, ensure_ascii=False, indent=2)
    return settings


def _safe_workflow_name(name: Any) -> str:
    if not isinstance(name, str):
        raise web.HTTPBadRequest(reason="Invalid workflow name")
    value = name.strip()
    if (not WF_NAME_RE.fullmatch(value) or value in (".", "..") or ".." in value
            or value.lower().endswith(".fields")):
        raise web.HTTPBadRequest(reason="Invalid workflow name")
    return value


def _workflow_path(name: str) -> str:
    return os.path.join(WORKFLOW_DIR, name + ".json")


def _fields_path(name: str) -> str:
    return os.path.join(WORKFLOW_DIR, name + ".fields.json")


def _read_workflow_data(name: str) -> dict | None:
    path = _workflow_path(name)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def _api_nodes(data: Any) -> dict:
    if not isinstance(data, dict):
        return {}
    return {
        key: value for key, value in data.items()
        if not str(key).startswith("_") and str(key) not in WF_META_KEYS
        and isinstance(value, dict) and "class_type" in value
    }


def _is_api_workflow(data: Any) -> bool:
    return bool(_api_nodes(data))


def _load_fields(name: str) -> list[dict]:
    try:
        with open(_fields_path(name), "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except Exception:
        return []
    fields = raw.get("fields") if isinstance(raw, dict) else None
    return [item for item in fields if isinstance(item, dict)] if isinstance(fields, list) else []


def _clean_fields(raw: Any, workflow: dict) -> list[dict]:
    """Only keep fields that really exist and whose input is a literal value
    (links / nested objects cannot be edited through a form)."""
    nodes = _api_nodes(workflow)
    cleaned: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("nodeId") or "")
        key = str(item.get("key") or "")
        node = nodes.get(node_id)
        if not node or not key or (node_id, key) in seen:
            continue
        inputs = node.get("inputs") or {}
        if key not in inputs or isinstance(inputs[key], (list, dict)):
            continue
        seen.add((node_id, key))
        field = {
            "nodeId": node_id, "key": key,
            "type": str(item.get("type") or "text"),
            "label": str(item.get("label") or key),
        }
        if item.get("options") is not None:
            field["options"] = [str(v) for v in item["options"]] if isinstance(item["options"], list) else []
        for numeric in ("min", "max", "step"):
            value = item.get(numeric)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                field[numeric] = value
        cleaned.append(field)
    return cleaned


def _public_fields(name: str, workflow: dict) -> list[dict]:
    """Field list with the workflow's current value attached as `default`."""
    fields = _clean_fields(_load_fields(name), workflow)
    nodes = _api_nodes(workflow)
    for field in fields:
        value = (nodes[field["nodeId"]].get("inputs") or {}).get(field["key"])
        field["default"] = value if isinstance(value, (str, int, float, bool)) else ""
    return fields


def _save_fields(name: str, fields: list[dict]) -> None:
    path = _fields_path(name)
    if not fields:
        if os.path.isfile(path):
            os.remove(path)
        return
    os.makedirs(WORKFLOW_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"fields": fields}, handle, ensure_ascii=False, indent=2)


async def api_config_ready(request: web.Request) -> web.Response:
    """探针：让前端确认新增路由是否已加载（未完全重启 ComfyUI 时 404）。

    本扩展是 ComfyUI 插件，本来就跑在 ComfyUI 进程里，所有请求天然指向当前
    服务，不存在可配置的「后端地址」。参考项目的地址输入只在 vite dev 下出现，
    这里不提供，也不持久化任何地址字段。
    """
    return web.json_response({"ok": True})


async def api_reorder_workflows(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
    names = payload.get("names")
    if not isinstance(names, list):
        return web.json_response({"error": "缺少 names 顺序列表"}, status=400)
    _save_api_settings(workflow_order=[str(name) for name in names])
    return await list_workflows(request)


async def api_save_workflow(request: web.Request) -> web.Response:
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
    try:
        name = _safe_workflow_name(str(payload.get("name", "") or ""))
    except web.HTTPBadRequest:
        return web.json_response({"error": "工作流名称不合法"}, status=400)
    workflow = payload.get("workflow")
    if not _is_api_workflow(workflow):
        return web.json_response(
            {"error": "不是 ComfyUI API 格式工作流（需为 {节点id: {class_type, inputs}}）"},
            status=400,
        )
    os.makedirs(WORKFLOW_DIR, exist_ok=True)
    with open(_workflow_path(name), "w", encoding="utf-8") as handle:
        json.dump(workflow, handle, ensure_ascii=False, indent=2)
    return web.json_response({"name": name})


async def api_get_workflow(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    data = _read_workflow_data(name)
    if data is None:
        return web.json_response({"error": "工作流不存在"}, status=404)
    return web.json_response({"name": name, "workflow": data})


async def api_delete_workflow(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    if _read_workflow_data(name) is None:
        return web.json_response({"error": "工作流不存在"}, status=404)
    os.remove(_workflow_path(name))
    if os.path.isfile(_fields_path(name)):
        os.remove(_fields_path(name))
    return web.json_response({"ok": True})


async def api_get_fields(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    workflow = _read_workflow_data(name)
    if workflow is None:
        return web.json_response({"error": "工作流不存在"}, status=404)
    return web.json_response({"fields": _public_fields(name, workflow)})


async def api_save_fields(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    workflow = _read_workflow_data(name)
    if workflow is None:
        return web.json_response({"error": "工作流不存在"}, status=404)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
    fields = _clean_fields(payload.get("fields"), workflow)
    _save_fields(name, fields)
    return web.json_response({"fields": _public_fields(name, workflow)})


async def list_workflows(request: web.Request) -> web.Response:
    """Workflow list for both the generate-node selector and the API dialog.

    Keeps the original id/kind/name/requires_config/hint shape, adds `nodes`,
    `filename` and `updated`, and applies the dialog's drag order.
    """
    order = _load_api_settings().get("workflow_order") or []
    ranked = {str(name): index for index, name in enumerate(order)}
    workflows = []
    if os.path.isdir(WORKFLOW_DIR):
        for filename in sorted(os.listdir(WORKFLOW_DIR)):
            if not filename.endswith(".json") or filename.endswith(".fields.json"):
                continue
            path = os.path.join(WORKFLOW_DIR, filename)
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            name = filename[:-5]
            workflows.append({
                "id": name,
                "filename": name,
                "kind": data.get("kind") or data.get("_kind") or name,
                "name": data.get("name") or data.get("_name") or name,
                "requires_config": bool(data.get("_requires_config")),
                "hint": data.get("hint", ""),
                "nodes": len(_api_nodes(data)),
                "updated": int(os.path.getmtime(path)),
                "builtin": False,
            })
    workflows.sort(key=lambda item: (ranked.get(item["id"], len(ranked)), item["id"]))
    return web.json_response({"workflows": workflows})


async def get_workflow(request: web.Request) -> web.Response:
    name = _safe_name(request.query.get("name", ""))
    path = os.path.join(WORKFLOW_DIR, name + ".json")
    if not os.path.isfile(path):
        raise web.HTTPNotFound(reason="Workflow template not found")
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    return web.json_response(data)


# ---------------------------------------------------------------- FFmpeg -----
# Video/audio node tools. The command lines, validation and output contracts are
# ported from the reference project (Workspace-XXXXXLCatNodes/infinite_canvas
# __init__.py: process_audio / process_video):
#   m4a = aac 192k / ipod / +faststart
#   mp4 = libx264 preset fast crf 18 / pad to even edges / yuv420p / +faststart
#   png = image2 -update 1 (one frame)
#   audio clip = atrim + concat; audio speed = chained atempo (0.5..2 per stage)
# Outputs are UUID-named files in input/infcanvas, so the existing asset
# scanner, /view URL shape and node creation path all work unchanged.

_FFMPEG_CACHE: dict[str, str | None] = {}
_AUDIO_PROCESS_TIMEOUT = 300
_VIDEO_PROCESS_TIMEOUT = 600

_AUDIO_OUT_ARGS = [
    "-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k",
    "-f", "ipod", "-movflags", "+faststart",
]
_VIDEO_OUT_ARGS = [
    "-map", "0:V:0", "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p",
    "-f", "mp4", "-movflags", "+faststart",
]
_FRAME_LABELS = {"current": "当前帧", "first": "首帧", "last": "尾帧"}
_ROLE_KIND = {"asset-audio": "audio", "asset-video": "video", "asset-image": "image"}


def _ffmpeg_bin(kind: str = "ffmpeg") -> str | None:
    if kind in _FFMPEG_CACHE:
        return _FFMPEG_CACHE[kind]
    exe = shutil.which(kind)
    if not exe:
        try:
            import imageio_ffmpeg
            bundled = imageio_ffmpeg.get_ffmpeg_exe()
            if kind == "ffmpeg":
                exe = bundled
            else:
                candidate = os.path.join(os.path.dirname(bundled), kind + ".exe")
                exe = candidate if os.path.isfile(candidate) else None
        except Exception:
            exe = None
    _FFMPEG_CACHE[kind] = exe
    return exe


def _subprocess_flags() -> dict[str, int]:
    """Do not let FFmpeg pop a console window on Windows."""
    if os.name != "nt":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}


async def _run_media_cmd(cmd: list[str], timeout: int) -> str:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **_subprocess_flags(),
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise RuntimeError("媒体处理超时，请缩短片段或降低变速倍数")
    if proc.returncode != 0:
        detail = (err or b"").decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError(detail[-1] if detail else f"FFmpeg 退出码 {proc.returncode}")
    return (out or b"").decode("utf-8", "replace").strip()


async def _probe_duration(path: str) -> float | None:
    probe = _ffmpeg_bin("ffprobe")
    if not probe:
        return None
    try:
        text = await _run_media_cmd([
            probe, "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", path,
        ], 30)
        value = float(text.splitlines()[0])
        return value if value > 0 else None
    except Exception:
        return None


async def _probe_video(path: str) -> dict | None:
    """ffprobe: duration / resolution / audio+video presence."""
    probe = _ffmpeg_bin("ffprobe")
    if not probe:
        return None
    try:
        text = await _run_media_cmd([
            probe, "-v", "error", "-show_entries",
            "format=duration:stream=index,codec_type,width,height",
            "-of", "json", path,
        ], 30)
        info = json.loads(text)
        try:
            duration = float((info.get("format") or {}).get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0.0
        streams = info.get("streams") or []
        video = next(
            (s for s in streams
             if s.get("codec_type") == "video"
             and not (s.get("disposition") or {}).get("attached_pic")),
            None,
        )
        return {
            "duration": duration if duration > 0 else None,
            "has_audio": any(s.get("codec_type") == "audio" for s in streams),
            "has_video": video is not None,
        }
    except Exception:
        return None


def _dir_for_type(source_type: str) -> str:
    if source_type == "output":
        return folder_paths.get_output_directory()
    if source_type == "temp":
        getter = getattr(folder_paths, "get_temp_directory", None)
        return getter() if callable(getter) else folder_paths.get_input_directory()
    return folder_paths.get_input_directory()


class MediaError(ValueError):
    """Resolution failure that carries the attempted ref + paths for debugging."""

    def __init__(self, message: str, detail: dict | None = None):
        super().__init__(message)
        self.detail = detail or {}


def _search_basename(base: str, base_name: str, limit: int = 4000) -> str | None:
    """Bounded recursive search for a filename under `base` (depth <= 4)."""
    base = os.path.realpath(base)
    scanned = 0
    for dirpath, dirnames, filenames in os.walk(base):
        depth = dirpath[len(base):].count(os.sep)
        if depth >= 4:
            dirnames[:] = []
        if base_name in filenames:
            return os.path.join(dirpath, base_name)
        scanned += len(filenames)
        if scanned > limit:
            return None
    return None


def _resolve_media_path(filename: str, subfolder: str = "", source_type: str = "input") -> str:
    """Resolve a canvas media ref to a local file, confined to its media dir.

    Tolerant of the messy refs real canvases carry: the filename may itself
    embed a subfolder, the subfolder may be wrong, or the type may be flipped
    between input/output. We try an exact join, a bare-basename join, the
    canonical ComfyUI resolver, and finally a bounded search by basename under
    the declared dir and the other media dir.
    """
    filename = str(filename or "").replace("\\", "/")
    if not filename or ".." in filename.split("/"):
        raise MediaError("文件名非法", {"filename": filename, "subfolder": subfolder, "type": source_type})
    if any(ord(ch) < 32 for ch in filename):
        raise MediaError("文件名非法", {"filename": filename, "subfolder": subfolder, "type": source_type})

    parts = [p for p in filename.split("/") if p and p != "."]
    sub_parts = [p for p in parts[:-1] if p != ".."]
    base_name = parts[-1]
    folder = str(subfolder or "").replace("\\", "/")
    if folder.startswith("/") or ".." in folder.split("/") or any(ord(ch) < 32 for ch in folder):
        raise MediaError("子目录非法", {"filename": filename, "subfolder": subfolder, "type": source_type})

    ref = {"filename": base_name, "subfolder": folder, "type": source_type}
    tried: list[str] = []
    bases = [os.path.realpath(_dir_for_type(source_type))]
    other = "output" if source_type != "output" else "input"
    bases.append(os.path.realpath(_dir_for_type(other)))

    for base in bases:
        candidates: list[str] = [
            os.path.join(base, folder, base_name),
            os.path.join(base, base_name),
        ]
        try:
            gp = folder_paths.get_full_path(
                base_name if not folder else folder + "/" + base_name, source_type)
        except Exception:
            gp = None
        if gp:
            candidates.append(gp)
        found = _search_basename(base, base_name)
        if found:
            candidates.append(found)
        for raw in candidates:
            path = os.path.realpath(raw)
            if path in tried or not os.path.isfile(path):
                tried.append(path)
                continue
            # Containment check that survives Windows case/drive quirks
            # (commonpath raises on case mismatch, which would mis-report
            # "not inside"). normcase folds case so E:/ vs e:/ compare equal.
            if os.path.normcase(path).startswith(os.path.normcase(base) + os.sep):
                return path
            tried.append(path)

    raise MediaError("媒体文件不存在或路径非法", {"ref": ref, "tried": tried})


def _atempo_chain(speed: float) -> str:
    """Each stage must stay in 0.5..2; chained stages multiply to `speed`."""
    tempo = speed
    parts = []
    while tempo < 0.5:
        parts.append("atempo=0.5")
        tempo /= 0.5
    while tempo > 2:
        parts.append("atempo=2")
        tempo /= 2
    parts.append("atempo=%.6f" % tempo)
    return ",".join(parts)


def _clip_filter(segments: list[tuple[float, float]]) -> str:
    parts = [
        "[0:a:0]atrim=start=%.6f:end=%.6f,asetpts=PTS-STARTPTS[p%d]" % (s, e, i)
        for i, (s, e) in enumerate(segments)
    ]
    parts.append("%sconcat=n=%d:v=0:a=1[out]" % (
        "".join("[p%d]" % i for i in range(len(segments))), len(segments)))
    return ";".join(parts)


def _output_name(ext: str) -> str:
    return f"infcanvas_{uuid.uuid4().hex}.{ext}"


def _output_asset(filename: str, name: str, role: str, duration: float | None) -> dict:
    """Build the same asset shape upload_asset()/list_assets() return."""
    path = os.path.join(_upload_dir(), filename)
    return {
        "name": name,
        "filename": filename,
        "subfolder": "infcanvas",
        "type": "input",
        "kind": _kind_of(filename),
        "role": role,
        "size": os.path.getsize(path) if os.path.isfile(path) else 0,
        "mtime": int(time.time()),
        "url": _view_url(filename, "infcanvas", "input"),
        "path": "infcanvas/" + filename,
        "duration": round(duration, 3) if duration else None,
    }


def _cleanup_outputs(paths: list[str]) -> None:
    for path in paths:
        try:
            if os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


async def media_health(request: web.Request) -> web.Response:
    """GET probe: a restarted server has the FFmpeg routes; an old one 404s."""
    return web.json_response({
        "ok": True,
        "ffmpeg": bool(_ffmpeg_bin("ffmpeg")),
        "ffprobe": bool(_ffmpeg_bin("ffprobe")),
        "audio": "/api/infcanvas/audio/process",
        "video": "/api/infcanvas/video/process",
    })


async def media_resolve(request: web.Request) -> web.Response:
    """GET /api/infcanvas/media/resolve?filename=&subfolder=&type=

    Resolves a possibly-mislabelled media ref to a real /view URL. The frontend
    uses this so previews (and the ref sent to FFmpeg) survive wrong subfolder
    or flipped input/output labels on a node's asset descriptor.
    """
    filename = str(request.query.get("filename", "") or "")
    subfolder = str(request.query.get("subfolder", "") or "")
    source_type = str(request.query.get("type", "input") or "input")
    try:
        path = _resolve_media_path(filename, subfolder, source_type)
    except MediaError:
        return web.json_response({"error": "not found"}, status=404)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    norm_path = os.path.realpath(path)
    base_input = os.path.realpath(_dir_for_type("input"))
    base_output = os.path.realpath(_dir_for_type("output"))
    if norm_path.startswith(base_input + os.sep):
        correct_type, correct_base = "input", base_input
    elif norm_path.startswith(base_output + os.sep):
        correct_type, correct_base = "output", base_output
    else:
        correct_type, correct_base = source_type, os.path.realpath(_dir_for_type(source_type))
    rel = os.path.relpath(os.path.dirname(norm_path), correct_base).replace("\\", "/")
    if rel in (".", ""):
        rel = ""
    return web.json_response({
        "url": _view_url(os.path.basename(norm_path), rel, correct_type),
        "filename": os.path.basename(norm_path),
        "subfolder": rel,
        "type": correct_type,
    })


async def _read_payload(request: web.Request) -> dict:
    try:
        return await request.json()
    except Exception:
        raise web.HTTPBadRequest(reason="Invalid JSON body")


async def process_audio(request: web.Request) -> web.Response:
    """POST /api/infcanvas/audio/process
    body: {ref: {filename, subfolder, type}, action: "clip"|"speed",
           segments?: [{start,end}], speed?: number}
    """
    payload = await _read_payload(request)
    ref = payload.get("ref") or {}
    filename = str(ref.get("filename") or payload.get("filename") or "")
    try:
        src = _resolve_media_path(filename, ref.get("subfolder", ""), ref.get("type", "input"))
    except MediaError as exc:
        return web.json_response(
            {"error": str(exc), "detail": exc.detail}, status=400)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)
    action = payload.get("action")
    if action not in ("clip", "speed"):
        return web.json_response({"error": "未知操作，须为 clip 或 speed"}, status=400)

    duration = await _probe_duration(src)
    if duration is not None and duration <= 0:
        return web.json_response({"error": "源音频没有有效音轨"}, status=400)

    cmd = [
        _ffmpeg_bin("ffmpeg") or "ffmpeg",
        "-hide_banner", "-loglevel", "error", "-y", "-i", src,
        "-vn", "-c:a", "aac", "-b:a", "192k", "-f", "ipod",
        "-movflags", "+faststart",
    ]
    if action == "clip":
        raw = payload.get("segments")
        if not isinstance(raw, list) or not (1 <= len(raw) <= 64):
            return web.json_response({"error": "片段数量须在 1 至 64 之间"}, status=400)
        segments = []
        for item in raw:
            try:
                start = float(item["start"])
                end = float(item["end"])
            except (TypeError, ValueError, KeyError):
                return web.json_response({"error": "片段时间格式错误"}, status=400)
            if not (0 <= start < end) or not all(v == v and abs(v) != float("inf") for v in (start, end)):
                return web.json_response({"error": "片段须满足 0 ≤ 开始 < 结束"}, status=400)
            if duration is not None and end > duration + 0.05:
                return web.json_response({"error": "片段结束时间超出音频时长"}, status=400)
            segments.append((start, end))
        cmd += ["-filter_complex", _clip_filter(segments), "-map", "[out]"]
        label = "截取"
        out_duration = sum(e - s for s, e in segments)
    else:
        try:
            speed = float(payload.get("speed"))
        except (TypeError, ValueError):
            return web.json_response({"error": "变速倍数格式错误"}, status=400)
        if not (0.1 <= speed <= 4) or speed != speed or speed == float("inf"):
            return web.json_response({"error": "变速倍数须在 0.1 至 4 之间"}, status=400)
        cmd += ["-filter:a", _atempo_chain(speed), "-map", "0:a:0"]
        label = "%.2f×" % speed
        out_duration = (duration / speed) if duration else None

    out_name = _output_name("m4a")
    out_path = os.path.join(_upload_dir(), out_name)
    cmd.append(out_path)
    try:
        await _run_media_cmd(cmd, _AUDIO_PROCESS_TIMEOUT)
        if not os.path.isfile(out_path) or os.path.getsize(out_path) < 1024:
            raise RuntimeError("生成的音频文件为空")
    except Exception as exc:
        _cleanup_outputs([out_path])
        return web.json_response({"error": f"音频处理失败: {exc}"}, status=500)

    name = f"{os.path.splitext(filename)[0]} · {label}.m4a"
    return web.json_response({
        "ok": True,
        "action": action,
        "files": [_output_asset(out_name, name, "asset-audio", out_duration)],
    })


async def process_video(request: web.Request) -> web.Response:
    """POST /api/infcanvas/video/process
    body: {ref, action: "extractAudio"|"separate"|"trim"|"frame",
           start?, end?, frame?: "current"|"first"|"last", time?}
    """
    payload = await _read_payload(request)
    ref = payload.get("ref") or {}
    filename = str(ref.get("filename") or payload.get("filename") or "")
    try:
        src = _resolve_media_path(filename, ref.get("subfolder", ""), ref.get("type", "input"))
    except MediaError as exc:
        return web.json_response(
            {"error": str(exc), "detail": exc.detail}, status=400)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    action = payload.get("action")
    if action not in ("extractAudio", "separate", "trim", "frame"):
        return web.json_response({"error": "未知操作"}, status=400)

    info = await _probe_video(src)
    if info is not None and not info["has_video"]:
        return web.json_response({"error": "文件不包含视频画面"}, status=400)
    duration = (info or {}).get("duration")

    ffmpeg = _ffmpeg_bin("ffmpeg") or "ffmpeg"
    base = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
    stem = os.path.splitext(filename)[0]
    made: list[dict] = []

    def add_out(ext: str, role: str, label: str, out_duration: float | None = None) -> str:
        name = _output_name(ext)
        item = {
            "path": os.path.join(_upload_dir(), name),
            "name": name, "ext": ext, "role": role,
            "label": label, "duration": out_duration,
        }
        made.append(item)
        return item["path"]

    if action in ("extractAudio", "separate"):
        if info is not None and not info["has_audio"]:
            return web.json_response({"error": "该视频没有音轨"}, status=400)
        audio_path = add_out("m4a", "asset-audio", "音轨", duration)
        cmd = base + ["-i", src] + _AUDIO_OUT_ARGS + [audio_path]
        if action == "separate":
            # One command, two outputs: the second drops the audio track.
            video_path = add_out("mp4", "asset-video", "静音视频", duration)
            cmd += ["-an"] + _VIDEO_OUT_ARGS + [video_path]
    elif action == "trim":
        try:
            start = float(payload.get("start"))
            end = float(payload.get("end"))
        except (TypeError, ValueError):
            return web.json_response({"error": "起止时间格式错误"}, status=400)
        if not all(v == v and abs(v) != float("inf") for v in (start, end)):
            return web.json_response({"error": "起止时间格式错误"}, status=400)
        if not (0 <= start < end):
            return web.json_response({"error": "片段须满足 0 ≤ 开始 < 结束"}, status=400)
        if duration and end > duration + 0.05:
            return web.json_response({"error": "片段结束时间超出视频时长"}, status=400)
        label = f"{start:.2f}–{end:.2f} 秒"
        video_path = add_out("mp4", "asset-video", label, end - start)
        # 0:a:0? makes the audio stream optional for silent videos.
        cmd = base + [
            "-ss", "%.6f" % start, "-i", src, "-t", "%.6f" % (end - start),
            "-map", "0:V:0", "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-f", "mp4", "-movflags", "+faststart", video_path,
        ]
    else:  # frame
        which = str(payload.get("frame") or "current")
        if which not in _FRAME_LABELS:
            return web.json_response({"error": "未知的截帧位置"}, status=400)
        try:
            t = float(payload.get("time") or 0)
        except (TypeError, ValueError):
            return web.json_response({"error": "截帧时间格式错误"}, status=400)
        is_last = which == "last"
        if which == "first":
            t = 0.0
        if not (t == t and abs(t) != float("inf")) or t < 0:
            return web.json_response({"error": "截帧时间格式错误"}, status=400)
        if duration and not is_last:
            t = min(t, max(0.0, duration - 0.001))
        png_path = add_out("png", "asset-image", _FRAME_LABELS[which])
        if is_last:
            cmd = base + [
                "-sseof", "-1", "-i", src,
                "-map", "0:V:0", "-c:v", "png",
                "-f", "image2", "-update", "1", png_path,
            ]
        else:
            cmd = base + [
                "-ss", "%.6f" % t, "-i", src,
                "-map", "0:V:0", "-frames:v", "1", "-c:v", "png",
                "-f", "image2", "-update", "1", png_path,
            ]

    try:
        await _run_media_cmd(cmd, _VIDEO_PROCESS_TIMEOUT)
        for item in made:
            if not os.path.isfile(item["path"]) or os.path.getsize(item["path"]) < 128:
                raise RuntimeError("生成的媒体文件为空")
    except Exception as exc:
        _cleanup_outputs([item["path"] for item in made])
        return web.json_response({"error": f"视频处理失败: {exc}"}, status=500)

    files = [
        _output_asset(
            item["name"],
            f"{stem} · {item['label']}.{item['ext']}",
            item["role"],
            item["duration"],
        )
        for item in made
    ]
    return web.json_response({"ok": True, "action": action, "files": files})


def register_routes() -> None:
    """Idempotently attach routes to the running PromptServer application."""
    global _registered
    if _registered:
        return
    server = getattr(PromptServer, "instance", None)
    app = getattr(server, "app", None)
    if app is None:
        logging.warning("[InfCanvas] PromptServer is not ready; HTTP routes were not registered")
        return
    router = app.router
    routes = (
        ("GET", "/api/infcanvas/health", health),
        ("GET", "/api/infcanvas/canvases", list_canvases),
        ("GET", "/api/infcanvas/canvas", get_canvas),
        ("POST", "/api/infcanvas/canvas", save_canvas),
        ("DELETE", "/api/infcanvas/canvas", delete_canvas),
        ("POST", "/api/infcanvas/upload", upload_asset),
        ("GET", "/api/infcanvas/media/health", media_health),
        ("GET", "/api/infcanvas/media/resolve", media_resolve),
        ("POST", "/api/infcanvas/audio/process", process_audio),
        ("POST", "/api/infcanvas/video/process", process_video),
        ("GET", "/api/infcanvas/assets", list_assets),
        # API 配置弹窗：静态 /order 与 /fields 先于动态 /{name} 注册。
        ("GET", "/api/infcanvas/settings", api_config_ready),
        ("PUT", "/api/infcanvas/workflows/order", api_reorder_workflows),
        ("POST", "/api/infcanvas/workflows", api_save_workflow),
        ("GET", "/api/infcanvas/workflows/{name}/fields", api_get_fields),
        ("PUT", "/api/infcanvas/workflows/{name}/fields", api_save_fields),
        ("GET", "/api/infcanvas/workflows/{name}", api_get_workflow),
        ("DELETE", "/api/infcanvas/workflows/{name}", api_delete_workflow),
        ("GET", "/api/infcanvas/workflows", list_workflows),
        ("GET", "/api/infcanvas/workflow", get_workflow),
    )
    try:
        for method, path, handler in routes:
            getattr(router, "add_" + method.lower())(path, handler)
    except Exception as exc:  # aiohttp freezes the router once the app is running
        logging.warning("[InfCanvas] Could not register HTTP routes: %s", exc)
        return
    _registered = True
    logging.info("[InfCanvas] %d HTTP routes registered", len(routes))
