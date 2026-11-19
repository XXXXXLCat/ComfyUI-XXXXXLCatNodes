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

# Namespace folder for this plugin's data inside ``user/<用户>/``. Canvas
# documents (in canvases/), api_settings.json and the user's workflow templates
# (in api/) all live under it. The plugin ships no workflow templates; users
# add their own through the API dialog.
PLUGIN_DATA_DIR = "Cat-Nodes"

# Canvas names come from unconflictedName()/duplicateDoc() as e.g.
# "Unsaved Canva (3)" and "Foo (Copy)", and users may type Chinese names.
# Reject only characters that are illegal in a file name (plus the ".."
# traversal check in _safe_name); this mirrors WF_NAME_RE used by workflows.
NAME_RE = re.compile(r"^[^/\\:*?\"<>|]{1,120}$")
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


def _current_user() -> str:
    """当前用户 id；未开启多用户或无用户上下文时返回 ``default``。

    画布数据与 api_settings 都按这个身份分目录：多用户下每个账号独立，单用户
    下统一落到 ``default``。与 input/output 的素材隔离共用同一个 contextvar。
    """
    try:
        from .nodes.multi_user_assets import current_user_id
    except Exception:
        try:
            from nodes.multi_user_assets import current_user_id
        except Exception:
            current_user_id = None
    if callable(current_user_id):
        try:
            uid = current_user_id()
            if uid:
                return str(uid)
        except Exception:
            pass
    return "default"


def _user_root() -> str:
    """用户私有根：``user/<用户>``（多用户）或 ``user/default``（单用户）。

    优先用 ComfyUI 原生的 ``get_public_user_directory(uid)``，它的拼接规则与
    宿主一致（含 SYSTEM_USER_PREFIX 等边界）；拿不到时退回手工拼接。
    """
    uid = _current_user()
    getter = getattr(folder_paths, "get_public_user_directory", None)
    if callable(getter):
        try:
            path = getter(uid)
            if path:
                return path
        except Exception:
            pass
    base = folder_paths.get_user_directory()
    return os.path.join(base, uid)


def _canvas_dir() -> str:
    path = os.path.join(_user_root(), PLUGIN_DATA_DIR, "canvases")
    os.makedirs(path, exist_ok=True)
    return path


def _workflow_dir() -> str:
    """Per-user workflow templates, under user/<用户>/Cat-Nodes/api/.

    No bundled templates are seeded: the plugin deliberately ships none, and
    users add workflows through the API dialog. The directory is created empty
    on first access so the dialog can list/save into it.
    """
    path = os.path.join(_user_root(), PLUGIN_DATA_DIR, "api")
    os.makedirs(path, exist_ok=True)
    return path


def _upload_dir() -> str:
    """上传/导入素材直接落在 input 的用户根，不再多套一层 infcanvas。

    多用户下 ``get_input_directory()`` 已被隔离补丁解析为 ``input/<用户>``，
    单用户下就是全局 ``input`` —— 正好对应「按用户分类、单用户放 input 下」。
    """
    path = folder_paths.get_input_directory()
    os.makedirs(path, exist_ok=True)
    return path


def _safe_name(name: Any) -> str:
    if not isinstance(name, str):
        raise web.HTTPBadRequest(reason="Invalid name")
    value = name.strip()
    if (
        not NAME_RE.fullmatch(value)
        or value in (".", "..")
        or ".." in value
        or any(ord(ch) < 32 for ch in value)
    ):
        raise web.HTTPBadRequest(reason="Invalid name")
    return value


def _canvas_path(name: str) -> str:
    return os.path.join(_canvas_dir(), _safe_name(name) + ".json")


def _kind_of(filename: str) -> str | None:
    return KIND_BY_EXT.get(os.path.splitext(filename)[1].lower())


def _user_segment() -> str:
    """多用户素材隔离下，input/output 的"当前根"其实在 <全局根>/<user>。

    浏览器 <img> 无法带 comfy-user 头，只给 filename 的话宿主 /view 会按全局
    目录解析，正好命中全局池里的同名旧文件（生成结果因此显示成别人的图）。
    把用户段塞进 subfolder，URL 自己就带上了身份——这也是宿主 assets API 的
    形状。单用户模式两处根相同，返回空串，行为不变。"""
    try:
        import folder_paths
        root = os.path.abspath(folder_paths.input_directory)
        current = os.path.abspath(folder_paths.get_input_directory())
        if current != root:
            return os.path.basename(current)
    except Exception:
        pass
    return ""


def _view_url(filename: str, subfolder: str, folder_type: str) -> str:
    user = _user_segment()
    sub = str(subfolder or "")
    if user and sub != user and not sub.startswith(user + "/"):
        sub = "%s/%s" % (user, sub) if sub else user
    query = urllib.parse.urlencode(
        {"filename": filename, "subfolder": sub, "type": folder_type}
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
        "subfolder": "",
        "type": "input",
        "kind": KIND_BY_EXT[extension],
        "size": len(payload),
        "mtime": int(time.time()),
        "url": _view_url(final, "", "input"),
        "path": final,
    }
    return web.json_response({"ok": True, "asset": asset})


async def list_assets(request: web.Request) -> web.Response:
    items = _scan_assets(_upload_dir(), "input")
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
    return os.path.join(_user_root(), PLUGIN_DATA_DIR, API_SETTINGS_FILE)


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
    return os.path.join(_workflow_dir(), name + ".json")


# Workflow categories shown in the API dialog and used by the generate nodes
# to filter their API selector. Keep this list in sync with the node tabs.
WORKFLOW_CATEGORIES = [
    "文生图", "图像编辑", "图像放大", "背景移除",
    "参考生视频", "文生视频", "图生视频", "首尾帧视频",
    "文生音乐", "音乐翻唱", "语音合成", "语音克隆",
    "智能对话", "语音转录",
    "视频反推", "图像反推", "视频插帧", "文生音效", "视频编辑",
    "视频放大", "图像重打光", "图像多角度", "局部重绘", "全景图",
    "扩图", "去水印", "抠图",
]

# Renamed 2026-11-17 (twice: the original names, then a clarity pass). Old
# fields.json / category_defaults / saved nodes may still carry ANY previous
# name, including the intermediate ones from the first pass. Map every alias
# straight to the FINAL name so a single lookup is enough (no chained renames).
CATEGORY_RENAMES = {
    "图片生成": "文生图", "图片编辑": "图像编辑", "图片放大": "图像放大",
    "移除背景": "背景移除", "全能参考": "参考生视频", "参考视频": "参考生视频",
    "首帧": "图生视频", "首尾帧": "首尾帧视频", "音乐设计": "文生音乐",
    "音乐翻唱": "音乐翻唱", "语音设计": "语音合成", "TTS": "语音合成",
    "语音克隆": "语音克隆", "LLM": "智能对话", "LLM对话": "智能对话",
}


def _normalize_category(value: Any) -> str:
    text = str(value or "").strip()
    return CATEGORY_RENAMES.get(text, text)


def _fields_path(name: str) -> str:
    return os.path.join(_workflow_dir(), name + ".fields.json")


def _load_raw_fields(name: str) -> dict:
    """Raw fields.json as a dict ({fields, category}); {} when absent/invalid."""
    try:
        with open(_fields_path(name), "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _load_category(name: str) -> str:
    category = _normalize_category(_load_raw_fields(name).get("category", ""))
    return category if category in WORKFLOW_CATEGORIES else ""


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
        # 高级参数：由 API 配置里的那个勾选框决定，节点面板据此决定收不收进
        # 「显示高级输入」。老 fields.json 没有这个键，就不写——前端按标签白名单
        # 兜底，行为与加入本字段之前一致。
        if isinstance(item.get("advanced"), bool):
            field["advanced"] = item["advanced"]
        if item.get("options") is not None:
            field["options"] = [str(v) for v in item["options"]] if isinstance(item["options"], list) else []
        for numeric in ("min", "max", "step"):
            value = item.get(numeric)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                field[numeric] = value
        cleaned.append(field)
    return cleaned


def _coerce_default(text: Any, current: Any) -> Any:
    """Parse the inspector's text back into the type the template already holds.

    The dialog can only give us strings, while an input may be an int seed, a
    float CFG, a bool switch or a string prompt. Casting everything to str would
    make ComfyUI reject the prompt ("expected INT, got '20'"), so the current
    value decides the type. Returns None when the text does not fit.
    """
    if isinstance(current, bool):
        if isinstance(text, bool):
            return text
        low = str(text).strip().lower()
        if low in ("true", "1", "yes", "on"):
            return True
        if low in ("false", "0", "no", "off"):
            return False
        return None
    if isinstance(current, int):
        raw = str(text).strip()
        try:
            return int(raw)
        except ValueError:
            pass
        try:
            return int(float(raw))
        except ValueError:
            return None
    if isinstance(current, float):
        try:
            return float(str(text).strip())
        except ValueError:
            return None
    return str(text)


def _apply_field_defaults(workflow: dict, raw: Any, fields: list[dict]) -> int:
    """Write edited defaults back into the workflow file, return how many changed.

    The default of an exposed parameter IS the value stored in the template --
    that is the single source of truth every consumer reads (the node panel's
    untouched row, the run that never touches the field, the value-control
    baseline). Keeping a second copy in fields.json would only drift.
    """
    nodes = _api_nodes(workflow)
    allowed = {(f["nodeId"], f["key"]): f for f in fields}
    changed = 0
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or "default" not in item:
            continue
        node_id = str(item.get("nodeId") or "")
        key = str(item.get("key") or "")
        spec = allowed.get((node_id, key))
        if spec is None:
            continue
        inputs = (nodes.get(node_id) or {}).get("inputs")
        if not isinstance(inputs, dict) or key not in inputs:
            continue
        current = inputs[key]
        # Links and nested groups cannot be exposed at all; a placeholder is
        # filled at run time and must keep its {{token}}.
        if isinstance(current, (list, dict)):
            continue
        if isinstance(current, str) and "{{" in current:
            continue
        value = _coerce_default(item.get("default"), current)
        if value is None and current is not None:
            continue
        if isinstance(value, str) and "{{" in value:
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            low, high = spec.get("min"), spec.get("max")
            if isinstance(low, (int, float)) and not isinstance(low, bool) and value < low:
                value = int(low) if isinstance(current, int) else low
            if isinstance(high, (int, float)) and not isinstance(high, bool) and value > high:
                value = int(high) if isinstance(current, int) else high
        if value == current and isinstance(value, bool) == isinstance(current, bool):
            continue
        inputs[key] = value
        changed += 1
    return changed


def _node_input_options(class_type: str, key: str) -> dict:
    """Live options (min / max / step) for one input, straight from the node class.

    A seed ceiling belongs to the node, not to the workflow file: on one install
    KSampler reports 2^64-1, SeedNode 2^63-1 and several Flux nodes 2^32-1. A
    fields.json keeps whatever was current when the field was ticked, so the
    range is refreshed from INPUT_TYPES on every read instead of drifting.
    """
    if not class_type:
        return {}
    try:
        # Local import: ComfyUI registers custom nodes after this module loads.
        import nodes as comfy_nodes
        cls = comfy_nodes.NODE_CLASS_MAPPINGS.get(class_type)
        if cls is None:
            return {}
        spec = cls.INPUT_TYPES()
    except Exception:
        return {}
    for section in ("required", "optional"):
        entry = (spec.get(section) or {}).get(key)
        if isinstance(entry, (list, tuple)) and len(entry) > 1 and isinstance(entry[1], dict):
            return entry[1]
    return {}


def _public_fields(name: str, workflow: dict) -> list[dict]:
    """Field list with the workflow's current value attached as `default`."""
    fields = _clean_fields(_load_fields(name), workflow)
    nodes = _api_nodes(workflow)
    for field in fields:
        node = nodes.get(field["nodeId"]) or {}
        if field.get("type") == "random":
            options = _node_input_options(str(node.get("class_type") or ""), field["key"])
            for numeric in ("min", "max", "step"):
                value = options.get(numeric)
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    field[numeric] = value
        value = (node.get("inputs") or {}).get(field["key"])
        field["default"] = value if isinstance(value, (str, int, float, bool)) else ""
    return fields


def _has_prompt_placeholder(workflow: dict) -> bool:
    """模板里有没有接提示词的占位符（`{{prompt}}` / `{{text}}`）。

    老式模板靠占位符收提示词，不在 fields.json 里暴露参数；新式模板反过来。
    两者都没有时，节点上那个提示词框填了也送不进工作流，前端据此不画它。
    """
    try:
        text = json.dumps(workflow, ensure_ascii=False)
    except Exception:
        return False
    return "{{prompt}}" in text or "{{text}}" in text


def _save_fields(name: str, fields: list[dict]) -> None:
    path = _fields_path(name)
    category = _load_category(name)
    if not fields and not category:
        if os.path.isfile(path):
            os.remove(path)
        return
    os.makedirs(_workflow_dir(), exist_ok=True)
    payload = {}
    if fields:
        payload["fields"] = fields
    if category:
        payload["category"] = category
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


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
    os.makedirs(_workflow_dir(), exist_ok=True)
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
    # Keep the saved drag order and the category default map free of dangling
    # references; the list falls back to the category's first entry on its own.
    settings = _load_api_settings()
    patch: dict[str, Any] = {}
    order = settings.get("workflow_order")
    if isinstance(order, list) and name in [str(item) for item in order]:
        patch["workflow_order"] = [item for item in order if str(item) != name]
    defaults = settings.get("category_defaults")
    if isinstance(defaults, dict) and name in [str(v) for v in defaults.values()]:
        patch["category_defaults"] = {
            key: value for key, value in defaults.items() if str(value) != name
        }
    if patch:
        _save_api_settings(**patch)
    return web.json_response({"ok": True})


async def api_set_default(request: web.Request) -> web.Response:
    """Mark a workflow as the default one of its category.

    One default per category, stored in api_settings.json as
    {"category_defaults": {category: workflow}}. A workflow must already carry a
    category -- there is no "default of nothing" slot -- and the list response
    falls back to the first workflow of the category (in saved drag order) when
    nothing has been pinned yet.
    """
    name = _safe_workflow_name(request.match_info.get("name", ""))
    if not os.path.isfile(_workflow_path(name)):
        return web.json_response({"error": "工作流不存在"}, status=404)
    category = _load_category(name)
    if not category:
        return web.json_response({"error": "请先给这个工作流设置分类"}, status=400)
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if isinstance(payload, dict) and payload.get("clear"):
        defaults = _load_api_settings().get("category_defaults") or {}
        if isinstance(defaults, dict) and defaults.get(category) == name:
            defaults.pop(category, None)
            _save_api_settings(category_defaults=defaults)
        return await list_workflows(request)
    defaults = _load_api_settings().get("category_defaults") or {}
    if not isinstance(defaults, dict):
        defaults = {}
    defaults[category] = name
    _save_api_settings(category_defaults=defaults)
    return await list_workflows(request)


async def api_rename_workflow(request: web.Request) -> web.Response:
    """Rename a workflow: the title IS the file stem, so this moves
    <name>.json and <name>.fields.json and rewrites the saved drag order.
    Nodes reference the same stem, so the client retargets them afterwards."""
    name = _safe_workflow_name(request.match_info.get("name", ""))
    if not os.path.isfile(_workflow_path(name)):
        return web.json_response({"error": "工作流不存在"}, status=404)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
    try:
        target = _safe_workflow_name(str(payload.get("to", "") or ""))
    except web.HTTPBadRequest:
        return web.json_response({"error": "工作流名称不合法"}, status=400)
    if target == name:
        return web.json_response({"name": target, "previous": name, "unchanged": True})
    if os.path.isfile(_workflow_path(target)) or os.path.isfile(_fields_path(target)):
        return web.json_response({"error": "已存在同名工作流"}, status=409)
    try:
        os.replace(_workflow_path(name), _workflow_path(target))
        if os.path.isfile(_fields_path(name)):
            os.replace(_fields_path(name), _fields_path(target))
    except OSError as error:
        return web.json_response({"error": f"重命名失败：{error}"}, status=500)
    order = _load_api_settings().get("workflow_order")
    if isinstance(order, list) and name in order:
        _save_api_settings(workflow_order=[
            target if str(item) == name else item for item in order
        ])
    defaults = _load_api_settings().get("category_defaults")
    if isinstance(defaults, dict) and name in [str(v) for v in defaults.values()]:
        _save_api_settings(category_defaults={
            key: (target if str(value) == name else value)
            for key, value in defaults.items()
        })
    return web.json_response({"name": target, "previous": name})


async def api_get_fields(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    workflow = _read_workflow_data(name)
    if workflow is None:
        return web.json_response({"error": "工作流不存在"}, status=404)
    return web.json_response({
        "fields": _public_fields(name, workflow),
        "category": _load_category(name),
        "categories": WORKFLOW_CATEGORIES,
        "prompt_placeholder": _has_prompt_placeholder(workflow),
    })


async def api_save_category(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    if not os.path.isfile(_workflow_path(name)):
        return web.json_response({"error": "工作流不存在"}, status=404)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
    category = str(payload.get("category", "") or "")
    if category and category not in WORKFLOW_CATEGORIES:
        return web.json_response({"error": "未知分类"}, status=400)
    os.makedirs(_workflow_dir(), exist_ok=True)
    raw = _load_raw_fields(name)
    fields = raw.get("fields") or []
    if not fields and not category:
        if os.path.isfile(_fields_path(name)):
            os.remove(_fields_path(name))
    else:
        payload_out = {}
        if fields:
            payload_out["fields"] = _clean_fields(fields, _read_workflow_data(name) or {})
        if category:
            payload_out["category"] = category
        with open(_fields_path(name), "w", encoding="utf-8") as handle:
            json.dump(payload_out, handle, ensure_ascii=False, indent=2)
    return web.json_response({"category": category})


async def api_save_fields(request: web.Request) -> web.Response:
    name = _safe_workflow_name(request.match_info.get("name", ""))
    workflow = _read_workflow_data(name)
    if workflow is None:
        return web.json_response({"error": "工作流不存在"}, status=404)
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
    raw = payload.get("fields")
    fields = _clean_fields(raw, workflow)
    changed = _apply_field_defaults(workflow, raw, fields)
    if changed:
        os.makedirs(_workflow_dir(), exist_ok=True)
        with open(_workflow_path(name), "w", encoding="utf-8") as handle:
            json.dump(workflow, handle, ensure_ascii=False, indent=2)
        # Re-read so the returned defaults are exactly what is on disk now.
        workflow = _read_workflow_data(name) or workflow
    _save_fields(name, fields)
    return web.json_response({
        "fields": _public_fields(name, workflow),
        "defaults_changed": changed,
    })


async def list_workflows(request: web.Request) -> web.Response:
    """Workflow list for both the generate-node selector and the API dialog.

    Keeps the original id/kind/name/requires_config/hint shape, adds `nodes`,
    `filename` and `updated`, and applies the dialog's drag order.
    """
    order = _load_api_settings().get("workflow_order") or []
    ranked = {str(name): index for index, name in enumerate(order)}
    workflows = []
    wf_dir = _workflow_dir()
    if os.path.isdir(wf_dir):
        for filename in sorted(os.listdir(wf_dir)):
            if not filename.endswith(".json") or filename.endswith(".fields.json"):
                continue
            path = os.path.join(wf_dir, filename)
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
                "category": _load_category(name),
                "builtin": False,
            })
    workflows.sort(key=lambda item: (ranked.get(item["id"], len(ranked)), item["id"]))
    # One default per category. A pinned name wins; otherwise the category's
    # first workflow in saved drag order is the fallback, so a freshly imported
    # set of templates already behaves as if every category had a default.
    pinned = _load_api_settings().get("category_defaults")
    pinned = pinned if isinstance(pinned, dict) else {}
    # category_defaults was keyed by the old names; normalise so pins survive
    # the rename without touching the user's settings file.
    pinned = {_normalize_category(key): value for key, value in pinned.items()}
    first_of: dict[str, str] = {}
    for item in workflows:
        category = item.get("category") or ""
        if category and category not in first_of:
            first_of[category] = item["id"]
    effective: dict[str, str] = {}
    for category, fallback in first_of.items():
        chosen = pinned.get(category)
        effective[category] = chosen if chosen in {
            entry["id"] for entry in workflows if (entry.get("category") or "") == category
        } else fallback
    for item in workflows:
        category = item.get("category") or ""
        item["is_default"] = bool(category) and effective.get(category) == item["id"]
        item["default_pinned"] = bool(category) and pinned.get(category) == item["id"]
    return web.json_response({
        "workflows": workflows, "defaults": effective, "categories": WORKFLOW_CATEGORIES,
    })


async def get_workflow(request: web.Request) -> web.Response:
    name = _safe_name(request.query.get("name", ""))
    path = os.path.join(_workflow_dir(), name + ".json")
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
# Outputs are UUID-named files in the input user root, so the existing asset
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
        try:
            vw = int((video or {}).get("width") or 0)
            vh = int((video or {}).get("height") or 0)
        except (TypeError, ValueError):
            vw = vh = 0
        return {
            "duration": duration if duration > 0 else None,
            "width": vw or None,
            "height": vh or None,
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
        "subfolder": "",
        "type": "input",
        "kind": _kind_of(filename),
        "role": role,
        "size": os.path.getsize(path) if os.path.isfile(path) else 0,
        "mtime": int(time.time()),
        "url": _view_url(filename, "", "input"),
        "path": filename,
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


def _import_target(source: str, filename: str) -> tuple[str, bool]:
    """Name inside the input user root for a copy of `source`, and whether to copy.

    Same name + same byte size means this exact file was imported before, so it
    is reused — upscaling the same result twice must not pile up
    `..._1.png` / `..._2.png`. A DIFFERENT file that happens to share the name
    gets a `_N` suffix instead of clobbering the older copy.
    """
    base = os.path.basename(filename) or "asset.bin"
    stem, ext = os.path.splitext(base)
    try:
        size = os.path.getsize(source)
    except OSError:
        size = -1
    for index in range(0, 500):
        candidate = base if index == 0 else "%s_%d%s" % (stem, index, ext)
        path = os.path.join(_upload_dir(), candidate)
        if not os.path.exists(path):
            return candidate, True
        if size >= 0 and os.path.getsize(path) == size:
            return candidate, False
    return "%s_%s%s" % (stem, uuid.uuid4().hex[:6], ext), True


async def media_import(request: web.Request) -> web.Response:
    """POST /api/infcanvas/media/import  body: {filename, subfolder, type}

    Copy a canvas asset into the input user root and return it as an input ref.

    LoadImage / LoadVideo / LoadAudio only read the input directory, while every
    generated result lands in output — so chaining 「生成 → 放大 / 编辑 / 再生成」
    used to fail with 「图像素材需来自 input 目录」and the user had to re-drop the
    same picture onto the canvas just to upload it again. Now the run loop calls
    this first and feeds the copy to the template.

    Idempotent: a ref already inside input is returned untouched; a copy that
    already exists under the same name is reused instead of duplicated.
    """
    payload = await _read_payload(request)
    filename = str(payload.get("filename") or "")
    try:
        source = _resolve_media_path(
            filename, payload.get("subfolder", ""), payload.get("type", "input"))
    except MediaError as exc:
        return web.json_response({"error": str(exc), "detail": exc.detail}, status=404)
    except ValueError as exc:
        return web.json_response({"error": str(exc)}, status=400)

    real = os.path.realpath(source)
    base_input = os.path.realpath(_dir_for_type("input"))
    if real.startswith(base_input + os.sep):
        rel = os.path.relpath(os.path.dirname(real), base_input).replace("\\", "/")
        return web.json_response({
            "asset": {
                "filename": os.path.basename(real),
                "subfolder": "" if rel == "." else rel,
                "type": "input",
                "copied": False,
                "url": _view_url(os.path.basename(real), "" if rel == "." else rel, "input"),
            }
        })

    name, needs_copy = _import_target(real, filename)
    target = os.path.join(_upload_dir(), name)
    if needs_copy:
        try:
            shutil.copyfile(real, target)
        except OSError as exc:
            return web.json_response({"error": "复制失败：%s" % exc}, status=500)
    return web.json_response({
        "asset": {
            "filename": name,
            "subfolder": "",
            "type": "input",
            "copied": needs_copy,
            "url": _view_url(name, "", "input"),
        }
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
    body: {ref, action: "extractAudio"|"crop"|"speed"|"reverse"|"rotate"|"trim"|"frame",
           start?, end?, frame?: "current"|"first"|"last", time?,
           x?, y?, w?, h?, speed?, angle?, mode?}
    rotate: mode = "flipX"|"flipY"|"90"|"180"|"270" (angle is the legacy alias).
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
    if action not in ("extractAudio", "crop", "speed", "reverse", "rotate", "trim", "frame"):
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

    if action == "extractAudio":
        if info is not None and not info["has_audio"]:
            return web.json_response({"error": "该视频没有音轨"}, status=400)
        audio_path = add_out("m4a", "asset-audio", "音轨", duration)
        cmd = base + ["-i", src] + _AUDIO_OUT_ARGS + [audio_path]
    elif action in ("crop", "speed", "reverse", "rotate"):
        # All four keep the video (and its audio when present) in one mp4 and
        # share the same libx264/faststart output; only the filter chain and
        # the expected duration differ. Audio presence comes from the probe:
        # areverse/atempo must be skipped for silent videos or ffmpeg fails.
        vf_parts: list[str] = []
        af_parts: list[str] = []
        out_duration = duration
        label = {"crop": "裁剪", "speed": "倍数", "reverse": "倒放", "rotate": "旋转"}[action]
        has_audio = bool((info or {}).get("has_audio"))

        if action == "crop":
            try:
                x, y, w, h = (int(payload.get(k)) for k in ("x", "y", "w", "h"))
            except (TypeError, ValueError):
                return web.json_response({"error": "裁剪参数错误"}, status=400)
            if min(x, y) < 0 or w < 2 or h < 2:
                return web.json_response({"error": "裁剪区域无效"}, status=400)
            iw, ih = (info or {}).get("width"), (info or {}).get("height")
            if iw and ih and (x + w > iw + 1 or y + h > ih + 1):
                return web.json_response({"error": "裁剪区域超出画面"}, status=400)
            vf_parts.append(f"crop={w}:{h}:{x}:{y}")
            label = f"裁剪 {w}×{h}"
        elif action == "speed":
            try:
                speed = float(payload.get("speed"))
            except (TypeError, ValueError):
                return web.json_response({"error": "倍数参数错误"}, status=400)
            if not (speed == speed and abs(speed) != float("inf")) or not (0.1 <= speed <= 4):
                return web.json_response({"error": "倍数须在 0.1–4 之间"}, status=400)
            vf_parts.append(f"setpts=PTS/{speed:.6f}")
            # atempo accepts 0.5–2 per filter; chain for the full 0.1–4 range.
            remaining, tempo = speed, []
            while remaining < 0.5 - 1e-9:
                tempo.append("0.5"); remaining /= 0.5
            while remaining > 2 + 1e-9:
                tempo.append("2"); remaining /= 2
            if abs(remaining - 1.0) > 1e-9:
                tempo.append(f"{remaining:.6f}")
            if has_audio and tempo:
                af_parts.append(",".join("atempo=" + v for v in tempo))
            out_duration = (duration / speed) if duration else None
            label = f"{speed:g}× 倍数"
        elif action == "reverse":
            vf_parts.append("reverse")
            if has_audio:
                af_parts.append("areverse")
        else:  # rotate — mirrors + turns, same five transforms as the image tool.
            # mode is the primary key; angle is the legacy numeric alias.
            mode = payload.get("mode")
            if mode is None and payload.get("angle") is not None:
                mode = str(payload.get("angle"))
            rotations = {
                "flipX": (["hflip"], "左右翻转"),
                "flipY": (["vflip"], "上下翻转"),
                "90": (["transpose=1"], "顺时针 90°"),
                "270": (["transpose=2"], "逆时针 90°"),
                "180": (["hflip", "vflip"], "旋转 180°"),
                "rotate90": (["transpose=1"], "顺时针 90°"),
                "rotate270": (["transpose=2"], "逆时针 90°"),
                "rotate180": (["hflip", "vflip"], "旋转 180°"),
            }
            key = str(mode) if mode is not None else ""
            if key not in rotations:
                return web.json_response({"error": "旋转方式错误"}, status=400)
            filters, label = rotations[key]
            vf_parts.extend(filters)

        # Normalise even dimensions for yuv420p after crop/transpose.
        vf_parts.append("pad=ceil(iw/2)*2:ceil(ih/2)*2")
        video_path = add_out("mp4", "asset-video", label, out_duration)
        cmd = base + ["-i", src, "-map", "0:V:0"]
        if has_audio:
            cmd += ["-map", "0:a:0?"]
        cmd += ["-vf", ",".join(vf_parts)]
        if af_parts:
            cmd += ["-af", ",".join(af_parts)]
        cmd += [
            "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k",
            "-f", "mp4", "-movflags", "+faststart", video_path,
        ]
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


# --- LORA library (canvas sidebar browser) -----------------------------------
# The lora list itself comes from ComfyUI's own folder_paths (this honours
# extra_model_paths.yaml, e.g. a shared E:\Comfy-Org\Models\loras). Each entry
# is a path relative to a lora root, e.g. "Krea2\35mmKrea2.safetensors", so the
# subfolder prefix IS the on-disk category. Previews are the sibling files with
# the same basename (Civitai puts <name>.jpeg/.webp/.png next to the weights).
LORA_MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".bin", ".gguf")
LORA_PREVIEW_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".mp4", ".webm")
_lora_cache: dict[str, Any] = {"stamp": 0.0, "items": []}


def _lora_roots() -> list[str]:
    """All configured lora roots (defaults + extra_model_paths)."""
    try:
        paths = folder_paths.get_folder_paths("loras")
    except Exception:
        paths = []
    roots = []
    for p in paths or []:
        try:
            roots.append(os.path.abspath(p))
        except Exception:
            continue
    return roots


def _lora_preview_abs(rel: str) -> str | None:
    """Return the absolute path of a lora-relative sibling preview if it exists.

    ``rel`` is the lora path with a non-model extension, e.g.
    "Krea2\\35mmKrea2.jpeg". Check every configured root (the shared library may
    be mounted via extra_model_paths) and reject traversal.
    """
    rel_norm = str(rel or "").replace("/", os.sep)
    if not rel_norm or os.path.isabs(rel_norm) or ".." in rel_norm.split(os.sep):
        return None
    for root in _lora_roots():
        candidate = os.path.abspath(os.path.join(root, rel_norm))
        try:
            if os.path.commonpath((candidate, root)) != root:
                continue
        except ValueError:
            continue
        if os.path.isfile(candidate):
            return candidate
    return None


async def list_loras(request) -> web.Response:
    """Return the lora library grouped by its on-disk subfolder.

    Response: ``{"items":[{name, file, stem, subfolder, category, preview}], ...}``
    where ``name`` is the exact lora_name to feed the workflow and ``preview``
    is a same-basename sibling image/video path (lora-relative) or null.
    """
    try:
        names = folder_paths.get_filename_list("loras") or []
    except Exception:
        names = []

    # Cheap cache keyed on the roots' mtimes so repeated panel opens don't walk
    # a few hundred files each time, but a newly added lora shows up promptly.
    stamp = 0.0
    for root in _lora_roots():
        try:
            stamp = max(stamp, os.path.getmtime(root))
        except Exception:
            pass
    if _lora_cache["stamp"] == stamp and _lora_cache["items"]:
        return web.json_response({"items": _lora_cache["items"]})

    items: list[dict] = []
    for raw in names:
        name = str(raw)
        if os.path.splitext(name)[1].lower() not in LORA_MODEL_EXTS:
            continue
        norm = name.replace("/", "\\")
        directory, base = os.path.split(norm)
        stem, _ext = os.path.splitext(base)
        category = directory or "根目录"
        preview: str | None = None
        for ext in LORA_PREVIEW_EXTS:
            candidate = (directory + "\\" if directory else "") + stem + ext
            if _lora_preview_abs(candidate):
                preview = candidate.replace("\\", "/")
                break
        items.append({
            "name": name,
            "file": base,
            "stem": stem,
            "subfolder": directory.replace("\\", "/"),
            "category": category,
            "preview": preview,
        })
    items.sort(key=lambda x: (x["category"], x["stem"].lower()))
    _lora_cache["stamp"] = stamp
    _lora_cache["items"] = items
    return web.json_response({"items": items})


async def lora_preview(request) -> web.Response:
    """Serve a lora's same-basename preview file via a path-validated proxy.

    ComfyUI's /view cannot serve type=loras (get_directory_by_type has no loras
    branch), so this is the minimal controlled equivalent. Only paths that
    resolve under a configured lora root and carry an image/video extension
    are served.
    """
    rel = request.rel_url.query.get("file", "")
    ext = os.path.splitext(rel)[1].lower()
    if ext not in LORA_PREVIEW_EXTS:
        return web.Response(status=400)
    path = _lora_preview_abs(rel)
    if not path:
        return web.Response(status=404)
    return web.FileResponse(path)


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
        ("POST", "/api/infcanvas/media/import", media_import),
        ("POST", "/api/infcanvas/audio/process", process_audio),
        ("POST", "/api/infcanvas/video/process", process_video),
        ("GET", "/api/infcanvas/assets", list_assets),
        ("GET", "/api/infcanvas/loras", list_loras),
        ("GET", "/api/infcanvas/lora/preview", lora_preview),
        # API 配置弹窗：静态 /order 与 /fields 先于动态 /{name} 注册。
        ("GET", "/api/infcanvas/settings", api_config_ready),
        ("PUT", "/api/infcanvas/workflows/order", api_reorder_workflows),
        ("POST", "/api/infcanvas/workflows", api_save_workflow),
        ("GET", "/api/infcanvas/workflows/{name}/fields", api_get_fields),
        ("PUT", "/api/infcanvas/workflows/{name}/fields", api_save_fields),
        ("PUT", "/api/infcanvas/workflows/{name}/category", api_save_category),
        ("POST", "/api/infcanvas/workflows/{name}/rename", api_rename_workflow),
        ("POST", "/api/infcanvas/workflows/{name}/default", api_set_default),
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
