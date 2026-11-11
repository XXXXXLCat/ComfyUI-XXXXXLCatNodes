"""
Infinite Canvas — vendored sub-package

Upstream: https://github.com/YangShu2103/ComfyUI-Infinite-Canvas (MIT, © 2026 YangShu2103)
Vendored into ComfyUI-XXXXXLCatNodes so the board ships with this package instead
of being installed as a second custom node. Only the runtime parts are kept:

- frontend/dist   Vue build output, served by the backend at /infinite_canvas/app
- this module     aiohttp routes under /infinite_canvas/api plus the static mount

The menu-bar entry now lives in ``web/monitor.js`` (left of the cleanup buttons,
separated by a divider); the upstream floating button and its drag/position
memory are intentionally dropped. The board page itself is untouched.

Data stays in ``<ComfyUI user dir>/ComfyUI-Infinite-Canvas`` so existing boards,
workflows, prompts and thumbnails keep working.

This sub-package does not register its own web directory: ComfyUI only reads
``WEB_DIRECTORY`` from the top-level package, and the entry script lives in
``web/infinite_canvas.js`` of the parent package.
"""

import asyncio
import base64
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import time
import uuid
import zipfile
from urllib.parse import quote

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_NODE_ROOT = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIST = os.path.join(_NODE_ROOT, "frontend", "dist")

# 插件的持久化数据（工作流、画布、画布设置、提示词库、缩略图缓存）统一放在
# ComfyUI 的用户目录下，节点重装/更新不会丢
_DATA_SUBDIR = "ComfyUI-Infinite-Canvas"
_data_dir_cache = None

API_PREFIX = "/infinite_canvas/api"


def _data_dir():
    global _data_dir_cache
    if _data_dir_cache:
        return _data_dir_cache

    base = None
    try:
        import folder_paths

        base = folder_paths.get_user_directory()
    except Exception:
        base = None
    if not base:
        base = os.path.join(_NODE_ROOT, "user")

    root = os.path.join(base, _DATA_SUBDIR)
    os.makedirs(root, exist_ok=True)
    _data_dir_cache = root
    return root


def _workflow_dir():
    return os.path.join(_data_dir(), "workflows")


def _canvas_dir():
    return os.path.join(_data_dir(), "canvases")


def _settings_path():
    return os.path.join(_data_dir(), "canvas_settings.json")


def _prompts_path():
    return os.path.join(_data_dir(), "prompts.json")


# ---------------------------------------------------------------- 数据读写

def _safe_name(name):
    """把工作流名规整成安全的文件名（去掉扩展名和非法字符）"""
    name = (name or "").strip()
    if name.lower().endswith(".json"):
        name = name[:-5]
    name = re.sub(r"[^\w\-.]+", "_", name, flags=re.UNICODE).strip("._")
    return name[:80]


def _workflow_path(name):
    return os.path.join(_workflow_dir(), f"{name}.json")


def _is_api_workflow(data):
    """ComfyUI API 格式：{node_id: {"class_type": ..., "inputs": {...}}}"""
    if not isinstance(data, dict) or not data:
        return False
    return all(
        isinstance(value, dict) and "class_type" in value for value in data.values()
    )


def _list_workflows():
    workflow_dir = _workflow_dir()
    if not os.path.isdir(workflow_dir):
        return []
    items = []
    for filename in sorted(os.listdir(workflow_dir)):
        if not filename.lower().endswith(".json"):
            continue
        # <名称>.fields.json 是字段配置，不是工作流
        if filename.lower().endswith(".fields.json"):
            continue
        path = os.path.join(workflow_dir, filename)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            continue
        items.append(
            {
                "name": filename[:-5],
                "nodes": len(data) if isinstance(data, dict) else 0,
                "updated": int(os.path.getmtime(path)),
            }
        )

    # 用户拖拽调整过的顺序优先，其余（新增的）按名称排在后面
    order = _load_settings().get("workflow_order", [])
    ranked = {name: index for index, name in enumerate(order)}
    items.sort(key=lambda item: (ranked.get(item["name"], len(ranked)), item["name"]))
    return items


def _load_settings():
    settings = {"comfy_address": "", "workflow_order": [], "fab_position": None}
    path = _settings_path()
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            data = {}
        if isinstance(data, dict):
            settings["comfy_address"] = str(data.get("comfy_address", "") or "").strip()
            order = data.get("workflow_order", [])
            if isinstance(order, list):
                settings["workflow_order"] = [str(name) for name in order if name]
            fab = data.get("fab_position")
            if isinstance(fab, dict):
                try:
                    settings["fab_position"] = {
                        "fx": min(max(float(fab.get("fx")), 0.0), 1.0),
                        "fy": min(max(float(fab.get("fy")), 0.0), 1.0),
                        "ts": int(fab.get("ts") or 0),
                    }
                except (TypeError, ValueError):
                    settings["fab_position"] = None
    return settings


def _save_settings(address=None, workflow_order=None, fab_position=None):
    settings = _load_settings()
    if address is not None:
        settings["comfy_address"] = address
    if workflow_order is not None:
        settings["workflow_order"] = [str(name) for name in workflow_order if name]
    if fab_position is not None:
        settings["fab_position"] = fab_position
    os.makedirs(_data_dir(), exist_ok=True)
    with open(_settings_path(), "w", encoding="utf-8") as handle:
        json.dump(settings, handle, ensure_ascii=False, indent=2)
    return _load_settings()


def _comfy_base(request):
    """后端访问 ComfyUI 自身接口用的地址

    经反向代理（https 域名）打开画布时，request.url.origin 是公网域名，
    服务端再回环请求它往往被代理挡掉（表现为 Server disconnected），
    所以优先走本机 127.0.0.1 + 本进程监听的端口。
    """
    try:
        from server import PromptServer

        port = getattr(PromptServer.instance, "port", None)
        if port:
            return f"http://127.0.0.1:{int(port)}"
    except Exception:
        pass
    configured = _load_settings().get("comfy_address", "")
    if configured:
        return configured.rstrip("/")
    return str(request.url.origin())


def _save_workflow(name, workflow):
    os.makedirs(_workflow_dir(), exist_ok=True)
    with open(_workflow_path(name), "w", encoding="utf-8") as handle:
        json.dump(workflow, handle, ensure_ascii=False, indent=2)
    return name


# ---------------------------------------------------------------- 提示词库
# 手动收藏的提示词独立存一个 prompts.json，与画布设置分开，避免互相覆盖

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")
_VIDEO_EXTS = (".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v")
_AUDIO_EXTS = (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac")
_ASSET_EXTS = _IMAGE_EXTS + _VIDEO_EXTS + _AUDIO_EXTS


def _asset_category(filename):
    """把素材分成 photo / video / audio，资产库按这个做二级分类"""
    lower = (filename or "").lower()
    if lower.endswith(_IMAGE_EXTS):
        return "photo"
    if lower.endswith(_VIDEO_EXTS):
        return "video"
    if lower.endswith(_AUDIO_EXTS):
        return "audio"
    return None


def _load_prompt_library():
    path = _prompts_path()
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    items = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        text = str(entry.get("text", "") or "").strip()
        if not text:
            continue
        items.append(
            {
                "id": str(entry.get("id") or uuid.uuid4().hex),
                "name": str(entry.get("name", "") or "").strip(),
                "text": text,
                "created": int(entry.get("created") or 0),
            }
        )
    return items


def _save_prompt_library(items):
    os.makedirs(_data_dir(), exist_ok=True)
    with open(_prompts_path(), "w", encoding="utf-8") as handle:
        json.dump(items, handle, ensure_ascii=False, indent=2)
    return items


def _list_assets(kind):
    """列出 input / output 目录里的素材（含子目录），按修改时间倒序"""
    root = _output_dir() if kind == "output" else _input_dir()
    if not os.path.isdir(root):
        return []

    items = []
    for dirpath, _dirnames, filenames in os.walk(root):
        relative = os.path.relpath(dirpath, root)
        subfolder = "" if relative == "." else relative.replace(os.sep, "/")
        for filename in filenames:
            category = _asset_category(filename)
            if not category:
                continue
            try:
                stat = os.stat(os.path.join(dirpath, filename))
            except OSError:
                continue
            items.append(
                {
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": kind,
                    "category": category,
                    "size": stat.st_size,
                    "updated": int(stat.st_mtime),
                }
            )

    items.sort(key=lambda item: item["updated"], reverse=True)
    return items


# ---------------------------------------------------------------- 缩略图
# 资产库网格只加载缩略图（原图动辄几 MB，直接当缩略图用会很慢），缩略图按
# 「源路径哈希 + mtime + 大小」落盘缓存：源文件变了就是新的缓存文件。
# 拖出画布时前端仍然用原图引用（/view），缩略图只影响面板里的展示。

_THUMB_SIZE = 320
# 允许的缩略图档位：资产库网格用 320，素材条用 640，节点卡片放大后要更清晰就用 960/1280
_THUMB_SIZES = (320, 640, 960, 1280)
_THUMB_QUALITY = 80
_THUMB_MAX_BYTES = 200 * 1024 * 1024
_THUMB_MAX_FILES = 10000
_THUMB_PRUNE_INTERVAL = 60
_last_thumb_prune_at = 0.0


def _thumb_dir():
    return os.path.join(_data_dir(), "thumbs")


def _thumb_hash(real_path):
    return hashlib.md5(real_path.encode("utf-8")).hexdigest()[:16]


def _thumb_file(real_path, stamp, size, max_side=_THUMB_SIZE):
    name = f"{_thumb_hash(real_path)}__{int(stamp)}__{int(size)}__{int(max_side)}.webp"
    return os.path.join(_thumb_dir(), name)


def _video_frame(src_path):
    """取视频 10% 处的一帧当封面，优先 PyAV，退回 OpenCV；都不可用返回 None"""
    try:
        import av

        with av.open(src_path) as container:
            streams = [stream for stream in container.streams if stream.type == "video"]
            if not streams:
                return None
            stream = streams[0]
            # 跳到片中，避开片头黑场
            if container.duration:
                container.seek(int(container.duration * 0.1), stream=stream)
            for index, frame in enumerate(container.decode(stream)):
                if index >= 30:
                    break
                image = frame.to_image()
                if image:
                    return image
    except Exception:
        pass

    try:
        import cv2

        cap = cv2.VideoCapture(src_path)
        try:
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            if total > 0:
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(total * 0.1)))
            ok, frame = cap.read()
            if ok and frame is not None:
                from PIL import Image

                return Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        finally:
            cap.release()
    except Exception:
        pass
    return None


def _encode_thumb(img, dest_path, max_side=_THUMB_SIZE):
    from PIL import Image

    img.thumbnail((max_side, max_side), Image.LANCZOS)
    img.save(dest_path, format="WEBP", quality=_THUMB_QUALITY, method=4)


def _build_thumb(src_path, dest_path, max_side=_THUMB_SIZE):
    """最长边缩到 max_side，先写临时文件再原子替换；视频取一帧当封面"""
    from PIL import Image, ImageOps

    cache_dir = os.path.dirname(dest_path)
    os.makedirs(cache_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=cache_dir, suffix=".webp")
    os.close(fd)
    try:
        if src_path.lower().endswith(_VIDEO_EXTS):
            frame = _video_frame(src_path)
            if frame is None:
                raise RuntimeError("读不到视频帧（需要 PyAV 或 OpenCV）")
            _encode_thumb(frame.convert("RGB"), tmp_path, max_side)
        else:
            with Image.open(src_path) as raw:
                _encode_thumb(ImageOps.exif_transpose(raw).convert("RGB"), tmp_path, max_side)
        os.replace(tmp_path, dest_path)
        tmp_path = None
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def _prune_thumb_cache():
    """缩略图超量时按最旧的先删，避免无限增长（带节流）"""
    global _last_thumb_prune_at
    now = time.time()
    if now - _last_thumb_prune_at < _THUMB_PRUNE_INTERVAL:
        return
    _last_thumb_prune_at = now

    cache_dir = _thumb_dir()
    try:
        entries = []
        total = 0
        with os.scandir(cache_dir) as it:
            for entry in it:
                if not entry.is_file():
                    continue
                try:
                    stat = entry.stat()
                except OSError:
                    continue
                entries.append((stat.st_mtime, stat.st_size, entry.path))
                total += stat.st_size

        if len(entries) <= _THUMB_MAX_FILES and total <= _THUMB_MAX_BYTES:
            return

        entries.sort()
        removed = 0
        for _, fsize, fpath in entries:
            if len(entries) - removed <= _THUMB_MAX_FILES and total <= _THUMB_MAX_BYTES:
                break
            try:
                os.remove(fpath)
                total -= fsize
                removed += 1
            except OSError:
                pass
    except FileNotFoundError:
        pass
    except Exception as exc:
        print(f"[Infinite-Canvas] 缩略图缓存清理失败: {exc}")


def _asset_path(kind, subfolder, filename):
    """按 input/output + 子目录定位素材，并限制在对应根目录内"""
    root = _output_dir() if kind == "output" else _input_dir()
    filename = str(filename or "")
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        return None
    real_root = os.path.realpath(root)
    path = os.path.realpath(os.path.join(root, str(subfolder or ""), filename))
    if not path.startswith(real_root + os.sep):
        return None
    return path if os.path.isfile(path) else None


def _read_embedded_json(path):
    """读取文件里内嵌的 ComfyUI 工作流（PNG/WebP 元数据优先，视频容器尽力而为）"""
    result = {"workflow": None, "prompt": None}
    try:
        from PIL import Image

        with Image.open(path) as img:
            info = dict(img.info or {})
        for key in ("workflow", "prompt"):
            raw = info.get(key)
            if isinstance(raw, str) and raw.strip():
                try:
                    result[key] = json.loads(raw)
                except ValueError:
                    continue
        if result["workflow"] or result["prompt"]:
            return result
    except Exception:
        # 不是图片（视频/音频）或读不了元数据，继续尝试容器 metadata
        pass

    # 图片之外（视频/音频）尝试从容器 metadata 里找；没装 PyAV 或没元数据就返回空
    try:
        import av

        with av.open(path) as container:
            meta = dict(container.metadata or {})
        for key in ("workflow", "prompt", "comment"):
            raw = meta.get(key)
            if not raw:
                continue
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            target = "workflow" if key == "workflow" else "prompt"
            if result[target] is None:
                result[target] = data
    except Exception:
        pass
    return result


# 素材内嵌工作流里「提示词」节点的标题（人为命名，中英文都兼容）
_PROMPT_TITLES = ("提示词", "正向提示词", "prompt", "positive")
# 没有标题时按节点类型兜底：文本节点 / 正向编码节点
_PROMPT_TYPES = (
    "PrimitiveStringMultiline",
    "PrimitiveString",
    "CLIPTextEncode",
    "TextEncodeQwenImage21",
)
# 这些节点里的字符串是文档或预览内容，不是提示词
_SKIP_TYPES = ("ShowText", "PreviewAny", "PreviewText", "StringPreview")
# 命名控件里明确是提示词的键：子图实例、多模态模型节点会把提示词存在这里，
# 即使是个「机器人跳舞」这种很短的中文也能直接认出来
_PROMPT_KEYS = ("prompt", "text", "positive", "caption", "description", "提示词", "正向提示词")
# 文件名 / 链接这类值不可能是提示词
_NOT_PROMPT_RE = re.compile(
    r"^(?:https?://|\S+\.(?:safetensors|ckpt|pt|pth|bin|onnx|png|jpe?g|webp|gif|mp4|webm|mp3|wav|json))$",
    re.IGNORECASE,
)


def _looks_like_prompt(text):
    """粗略判断一段控件值是不是自然语言提示词"""
    value = text.strip()
    if len(value) < 40:
        return False
    if _NOT_PROMPT_RE.match(value):
        return False
    return " " in value


def _prompt_value(mapping):
    """按提示词键名从命名控件值 / 节点 inputs 里取值"""
    if not isinstance(mapping, dict):
        return ""
    for key in _PROMPT_KEYS:
        value = mapping.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _first_text(container):
    """从控件值 / 输入里挑第一个非空字符串"""
    if isinstance(container, dict):
        for key in ("value", "text", "prompt", "string"):
            value = container.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return ""
    if isinstance(container, list):
        for value in container:
            if isinstance(value, str) and value.strip():
                return value
    return ""


def _extract_prompt_text(data):
    """从 UI 或 API 格式的工作流里提取提示词节点的文本"""
    if not isinstance(data, dict):
        return ""

    fallback = ""
    # 命名控件里键名就是提示词的（子图实例 / 多模态节点），优先级仅次于标题命中
    named_hit = ""
    # 有些工作流（比如子图封装）没有标题为「提示词」的节点，提示词只是子图实例
    # 上的一个控件值，这时退而取最长的自然语言字符串
    longest = ""
    # UI 格式：{nodes: [{type, title, widgets_values, widgets_values_named}]}
    if isinstance(data.get("nodes"), list):
        for node in data["nodes"]:
            if not isinstance(node, dict):
                continue
            ntype = str(node.get("type") or "")
            # 说明类的备注节点里是一大段文档，不能当成提示词
            if "Note" in ntype or ntype in _SKIP_TYPES:
                continue
            named = _prompt_value(node.get("widgets_values_named"))
            text = named or _first_text(node.get("widgets_values"))
            if not text:
                continue
            title = str(node.get("title") or "").strip().lower()
            if any(key in title for key in _PROMPT_TITLES):
                return text
            if named and not named_hit:
                named_hit = named
            if not fallback and ntype in _PROMPT_TYPES:
                fallback = text
            if _looks_like_prompt(text) and len(text) > len(longest):
                longest = text
        return named_hit or fallback or longest

    # API 格式：{node_id: {class_type, inputs, _meta:{title}}}
    for node in data.values():
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        named = _prompt_value(inputs)
        text = named or _first_text(inputs)
        if not text:
            continue
        meta = node.get("_meta")
        title = str((meta or {}).get("title") or "").strip().lower() if isinstance(meta, dict) else ""
        if any(key in title for key in _PROMPT_TITLES):
            return text
        if named and not named_hit:
            named_hit = named
        if not fallback and node.get("class_type") in _PROMPT_TYPES:
            fallback = text
        if _looks_like_prompt(text) and len(text) > len(longest):
            longest = text
    return named_hit or fallback or longest


def _read_workflow(name):
    """读取工作流 JSON，不存在或解析失败返回 None"""
    path = _workflow_path(name)
    if not name or not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


# ---------------------------------------------------------------- 字段配置
# 字段配置独立成 <工作流名>.fields.json：工作流 JSON 本身要整份提交给 /prompt，
# 混入额外顶层键会被 ComfyUI 拒绝。

_FIELD_TYPES = {
    "text",
    "textarea",
    "number",
    "slider",
    "select",
    "switch",
    "image",
    "image_list",
    "audio",
    "video",
    "random",
}
_FIELD_NUM_KEYS = ("min", "max", "step")


def _fields_path(name):
    return os.path.join(_workflow_dir(), f"{name}.fields.json")


def _load_fields(name):
    path = _fields_path(name)
    if not os.path.isfile(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except Exception:
        return []
    fields = raw.get("fields") if isinstance(raw, dict) else None
    return [item for item in fields if isinstance(item, dict)] if isinstance(fields, list) else []


def _clean_fields(raw, workflow):
    """只保留工作流里真实存在、且是字面量（不是连线）的输入"""
    cleaned = []
    seen = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        node_id = str(item.get("nodeId") or "")
        key = str(item.get("key") or "")
        node = workflow.get(node_id) if isinstance(workflow, dict) else None
        if not isinstance(node, dict) or not key:
            continue
        value = (node.get("inputs") or {}).get(key)
        if isinstance(value, (list, dict)):
            continue
        marker = (node_id, key)
        if marker in seen:
            continue
        seen.add(marker)

        field_type = str(item.get("type") or "text")
        if field_type not in _FIELD_TYPES:
            field_type = "text"
        title = (node.get("_meta") or {}).get("title")
        entry = {
            "nodeId": node_id,
            "key": key,
            "type": field_type,
            "label": str(item.get("label") or title or key)[:40],
        }
        if field_type == "select":
            options = item.get("options")
            entry["options"] = (
                [str(option)[:40] for option in options][:60]
                if isinstance(options, list)
                else []
            )
        if field_type in ("number", "slider", "random"):
            for num_key in _FIELD_NUM_KEYS:
                num = item.get(num_key)
                if isinstance(num, (int, float)) and not isinstance(num, bool):
                    entry[num_key] = num
        cleaned.append(entry)
    return cleaned


def _public_fields(name, workflow):
    """返回字段配置，并把默认值取成工作流里的当前值"""
    result = []
    for field in _clean_fields(_load_fields(name), workflow):
        value = (workflow[field["nodeId"]].get("inputs") or {}).get(field["key"])
        field["default"] = value if isinstance(value, (str, int, float, bool, list)) else ""
        result.append(field)
    return result


def _save_fields(name, fields):
    if not fields:
        path = _fields_path(name)
        if os.path.isfile(path):
            os.remove(path)
        return
    os.makedirs(_workflow_dir(), exist_ok=True)
    with open(_fields_path(name), "w", encoding="utf-8") as handle:
        json.dump({"fields": fields}, handle, ensure_ascii=False, indent=2)


def _delete_fields(name):
    path = _fields_path(name)
    if os.path.isfile(path):
        os.remove(path)


# ---------------------------------------------------------------- 画布读写

def _canvas_path(canvas_id):
    return os.path.join(_canvas_dir(), f"{_safe_name(canvas_id)}.json")


def _list_canvases():
    """只读每个画布的结构概要，用于管理列表（不加载媒体）"""
    canvas_dir = _canvas_dir()
    if not os.path.isdir(canvas_dir):
        return []
    items = []
    for filename in os.listdir(canvas_dir):
        if not filename.lower().endswith(".json"):
            continue
        path = os.path.join(canvas_dir, filename)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            continue
        items.append(
            {
                "id": filename[:-5],
                "name": str(data.get("name") or filename[:-5]),
                "nodes": len(data.get("nodes") or []),
                "edges": len(data.get("edges") or []),
                "updated": int(data.get("updated") or os.path.getmtime(path)),
            }
        )
    items.sort(key=lambda item: item["updated"], reverse=True)
    return items


def _load_canvas(canvas_id):
    path = _canvas_path(canvas_id)
    if not canvas_id or not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _save_canvas(canvas_id, canvas):
    """原子写入：先写临时文件再替换，避免中断后留下半截 JSON"""
    os.makedirs(_canvas_dir(), exist_ok=True)
    canvas["id"] = canvas_id
    canvas["updated"] = int(time.time())
    path = _canvas_path(canvas_id)
    temp = f"{path}.tmp"
    with open(temp, "w", encoding="utf-8") as handle:
        json.dump(canvas, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, path)
    return canvas


# ---------------------------------------------------------------- 执行工作流

def _input_dir():
    try:
        import folder_paths

        return folder_paths.get_input_directory()
    except Exception:
        return os.path.join(_NODE_ROOT, "input")


def _output_dir():
    try:
        import folder_paths

        return folder_paths.get_output_directory()
    except Exception:
        return os.path.join(_NODE_ROOT, "output")


def _temp_dir():
    try:
        import folder_paths

        return folder_paths.get_temp_directory()
    except Exception:
        return os.path.join(_NODE_ROOT, "temp")


_MEDIA_EXTS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tiff",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}


def _decode_data_url(data_url, fallback_name=""):
    """data:image/png;base64,... -> (bytes, 扩展名)"""
    if not isinstance(data_url, str) or "," not in data_url:
        raise ValueError("无效的文件数据")
    header, encoded = data_url.split(",", 1)
    mime = header[5:].split(";", 1)[0] if header.startswith("data:") else ""
    ext = _MEDIA_EXTS.get(mime.lower(), "")
    if not ext:
        tail = os.path.splitext(fallback_name)[1].lstrip(".")
        ext = tail.lower() if tail else "png"
    return base64.b64decode(encoded), ext


def _save_input_file(name, data_url):
    """把画布素材写进 ComfyUI 的 input 目录，返回可被 /view 引用的文件名"""
    input_dir = _input_dir()
    os.makedirs(input_dir, exist_ok=True)
    raw, ext = _decode_data_url(data_url, name)
    filename = f"infinite_canvas_{uuid.uuid4().hex}.{ext}"
    with open(os.path.join(input_dir, filename), "wb") as handle:
        handle.write(raw)
    return filename


def _input_file_exists(filename):
    """只允许引用 input 目录下的文件名，防止目录穿越"""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return False
    return os.path.isfile(os.path.join(_input_dir(), filename))


def _save_input_images(data_urls):
    """批量保存数据 URL，返回文件名列表"""
    return [_save_input_file("", data_url) for data_url in data_urls]


def _dir_for_type(source_type):
    if source_type == "output":
        return _output_dir()
    if source_type == "temp":
        return _temp_dir()
    return _input_dir()


def _link_into_input(filename, subfolder="", source_type="output"):
    """把 output/temp 里的文件接到 input 目录下（不复制：优先硬链接，失败再复制）

    目标文件名按「来源路径 + 文件 mtime + 大小」做哈希：同一个文件名被重新生成
    （比如输出目录里删掉 ComfyUI_Qwen2.1_00757_.png 后又生成了同名新图）时，
    会得到新的链接文件，不会复用上一次的旧内容。
    """
    if not filename:
        return ""
    source = os.path.join(_dir_for_type(source_type), subfolder or "", filename)
    if not os.path.isfile(source):
        return ""
    try:
        stat = os.stat(source)
    except OSError:
        return ""

    digest = hashlib.sha1(
        f"{source_type}/{subfolder}/{filename}/{stat.st_mtime_ns}/{stat.st_size}".encode("utf-8")
    ).hexdigest()[:16]
    ext = os.path.splitext(filename)[1] or ".png"
    target_name = f"infinite_canvas_{digest}{ext}"
    target = os.path.join(_input_dir(), target_name)
    if os.path.isfile(target):
        return target_name

    try:
        os.makedirs(_input_dir(), exist_ok=True)
        try:
            os.link(source, target)
        except OSError:
            # 跨磁盘或不支持硬链接时退回复制
            shutil.copyfile(source, target)
    except Exception:
        return ""
    return target_name


def _input_ref_filename(ref):
    """把素材引用解析成 input 目录里的文件名；output/temp 的产物按需接入 input"""
    if isinstance(ref, dict):
        filename = str(ref.get("filename") or "")
        subfolder = str(ref.get("subfolder") or "")
        source_type = str(ref.get("type") or "input")
    else:
        # 旧画布/普通字符串："子目录/文件名" 时把子目录拆出来
        subfolder, _, filename = str(ref or "").rpartition("/")
        source_type = "input"
    filename = os.path.basename(filename)
    if not filename:
        return ""

    if source_type == "input":
        path = os.path.join(_input_dir(), subfolder, filename)
        if os.path.isfile(path):
            return f"{subfolder}/{filename}" if subfolder else filename
        # 旧画布只存了文件名：再去 output / temp 找一次
        for kind in ("output", "temp"):
            linked = _link_into_input(filename, subfolder, kind)
            if linked:
                return linked
        return ""

    return _link_into_input(filename, subfolder, source_type)



def _apply_images(workflow, images):
    """载图节点按出现顺序分配素材（素材不够时循环取）"""
    loaders = sorted(
        node_id
        for node_id, node in workflow.items()
        if isinstance(node, dict) and node.get("class_type") in ("LoadImage", "LoadImageMask")
    )
    for index, node_id in enumerate(loaders):
        if not images:
            break
        inputs = workflow[node_id].setdefault("inputs", {})
        inputs["image"] = images[index % len(images)]


def _apply_params(workflow, params):
    """按 {节点id: {输入名: 值}} 覆盖工作流里对应的字面量输入"""
    if not isinstance(params, dict):
        return
    for node_id, values in params.items():
        node = workflow.get(str(node_id))
        if not isinstance(node, dict) or not isinstance(values, dict):
            continue
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        for key, value in values.items():
            # 只覆盖已存在的字面量；不新增键，也不改动连线
            if key in inputs and not isinstance(inputs[key], (list, dict)):
                inputs[key] = value


def _resolve_media_value(value, field_type):
    """图像/音频/视频字段的值来自 output 目录时，复制进 input 后再提交"""
    if field_type == "image_list":
        if isinstance(value, str):
            try:
                items = json.loads(value)
            except Exception:
                return value
            if not isinstance(items, list):
                return value
            resolved = [name for name in (_input_ref_filename(item) for item in items) if name]
            return json.dumps(resolved, ensure_ascii=False)
        if isinstance(value, list):
            return [name for name in (_input_ref_filename(item) for item in value) if name]
        return value

    if isinstance(value, str) and value:
        return _input_ref_filename(value) or value
    return value


def _apply_media_params(workflow, name):
    """按字段配置把媒体类参数转换成 input 目录里的文件名"""
    for field in _clean_fields(_load_fields(name), workflow):
        if field["type"] not in ("image", "image_list", "audio", "video"):
            continue
        node = workflow.get(field["nodeId"])
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(inputs, dict) or field["key"] not in inputs:
            continue
        if isinstance(inputs[field["key"]], (list, dict)):
            continue
        inputs[field["key"]] = _resolve_media_value(inputs[field["key"]], field["type"])


def _prompt_error(body):
    """整理 ComfyUI /prompt 的校验错误"""
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        message = str(error.get("message") or error.get("type") or "提交失败")
        details = error.get("details")
        return f"{message}: {details}" if details else message
    if isinstance(error, str):
        return error
    return "提交工作流失败"


async def _wait_outputs(session, origin, prompt_id, timeout=180):
    """轮询 /history：完成返回 outputs，失败返回 error，未完成返回 running"""
    deadline = time.time() + timeout
    while time.time() < deadline:
        async with session.get(f"{origin}/history/{prompt_id}") as response:
            data = await response.json(content_type=None)
        entry = data.get(prompt_id) if isinstance(data, dict) else None
        if isinstance(entry, dict):
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                messages = status.get("messages") or []
                for item in messages:
                    if isinstance(item, list) and item and item[0] == "execution_error":
                        return {
                            "status": "error",
                            "error": str((item[1] or {}).get("exception_message") or "执行失败"),
                        }
                return {"status": "error", "error": "工作流执行失败"}
            if status.get("status_str") == "success" or status.get("completed") or entry.get("outputs"):
                return {"status": "done", "outputs": entry.get("outputs") or {}}
        await asyncio.sleep(0.4)
    return {"status": "running"}


def _queue_prompt_id(item):
    """ComfyUI /queue 的条目是数组，第 1 项是 prompt_id"""
    if isinstance(item, (list, tuple)) and len(item) > 1:
        return str(item[1])
    if isinstance(item, dict):
        return str(item.get("prompt_id") or "")
    return ""


async def _queue_state(session, origin, prompt_id):
    """在 ComfyUI 队列里定位任务：running / queued（带排队序号）"""
    async with session.get(f"{origin}/queue") as response:
        data = await response.json(content_type=None)
    if not isinstance(data, dict):
        return None
    for item in data.get("queue_running") or []:
        if _queue_prompt_id(item) == prompt_id:
            return {"status": "running"}
    for index, item in enumerate(data.get("queue_pending") or []):
        if _queue_prompt_id(item) == prompt_id:
            return {"status": "queued", "position": index + 1}
    return None


def _history_files(outputs):
    """把 /history 的 outputs 摊平成素材列表

    outputs 是按节点分组的：{ 节点id: { images: [{filename, subfolder, type}], ... } }，
    同一个文件被多个节点输出时只保留一条。
    """
    files = []
    seen = set()
    for value in (outputs or {}).values():
        if not isinstance(value, dict):
            continue
        for items in value.values():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict) or not item.get("filename"):
                    continue
                ref = {
                    "filename": str(item["filename"]),
                    "subfolder": str(item.get("subfolder") or ""),
                    "type": str(item.get("type") or "output"),
                }
                token = (ref["type"], ref["subfolder"], ref["filename"])
                if token in seen:
                    continue
                seen.add(token)
                files.append(ref)
    return files


def _history_times(status):
    """从 status.messages 里取开始/结束时间（毫秒时间戳），拿不到就返回 None"""
    started = None
    finished = None
    for item in (status or {}).get("messages") or []:
        if not isinstance(item, list) or len(item) < 2 or not isinstance(item[1], dict):
            continue
        stamp = item[1].get("timestamp")
        if not isinstance(stamp, (int, float)):
            continue
        if item[0] == "execution_start" and started is None:
            started = stamp
        elif item[0] in ("execution_success", "execution_error", "execution_interrupted"):
            finished = stamp
    return started, finished


def _history_item(prompt_id, entry):
    """把 /history 的一条记录整理成任务队列面板需要的样子"""
    status = entry.get("status") or {}
    started, finished = _history_times(status)
    state = status.get("status_str") or ("success" if status.get("completed") else "unknown")
    error = ""
    interrupted = False
    for item in status.get("messages") or []:
        if not isinstance(item, list) or not item:
            continue
        if item[0] == "execution_interrupted":
            interrupted = True
        elif item[0] == "execution_error" and not error:
            detail = item[1] if len(item) > 1 and isinstance(item[1], dict) else {}
            error = str(detail.get("exception_message") or "执行失败")
    # 手动停止的任务 status_str 也是 error，单独标出来，面板上别显示成执行失败
    if interrupted:
        state = "interrupted"
    duration = None
    if started and finished and finished >= started:
        duration = round((finished - started) / 1000, 2)
    return {
        "promptId": prompt_id,
        "status": state,
        "startedAt": started,
        "finishedAt": finished or started,
        "duration": duration,
        "error": error,
        "files": _history_files(entry.get("outputs")),
    }


_VIDEO_EXTS = (".mp4", ".webm", ".mov", ".mkv", ".avi")
_AUDIO_EXTS = (".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac")


def _output_kind(filename):
    lowered = filename.lower()
    if lowered.endswith(_VIDEO_EXTS):
        return "video"
    if lowered.endswith(_AUDIO_EXTS):
        return "audio"
    return "image"


def _collect_outputs(outputs):
    """把执行产物整理成素材描述（文件留在 ComfyUI 的 output 目录，
    真正被当作输入提交时再接入 input 目录）"""
    result = []
    seen = set()
    for _node_id, node_output in (outputs or {}).items():
        if not isinstance(node_output, dict):
            continue
        for key in ("images", "gifs", "videos", "audio"):
            for item in node_output.get(key) or []:
                if not isinstance(item, dict) or not item.get("filename"):
                    continue
                # 加载类节点（如 VHS_LoadVideo）会把已上传的输入文件也列进 outputs，
                # 那不是本次产物，直接跳过，避免运行后多出一份参考素材
                if item.get("type") == "input":
                    continue
                filename = item["filename"]
                # 同一个文件可能被多个节点/多个 key 同时报告，只保留一条
                dedupe_key = (item.get("type", "output"), item.get("subfolder", ""), filename)
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                result.append(
                    {
                        "name": filename,
                        "filename": filename,
                        "subfolder": item.get("subfolder", ""),
                        "type": item.get("type", "output"),
                        "kind": _output_kind(filename),
                    }
                )
    return result


# ---------------------------------------------------------------- 路由注册

def register_routes(app):
    """把静态资源与 API 挂到 aiohttp app 上（拆出来便于本地测试）"""
    import aiohttp
    from aiohttp import web

    async def get_settings(request):
        return web.json_response(_load_settings())

    async def save_settings(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        address = str(payload.get("comfy_address", "") or "").strip()
        # 允许留空表示"当前 ComfyUI 自身"
        if address and not re.match(r"^https?://[^\s]+$", address):
            if not re.match(r"^[^\s/:]+:\d+$", address):
                return web.json_response(
                    {"error": "地址格式应为 host:port 或 http(s)://host:port"},
                    status=400,
                )
            address = f"http://{address}"
        return web.json_response(_save_settings(address))

    async def get_fab_position(request):
        return web.json_response({"fab_position": _load_settings().get("fab_position")})

    async def save_fab_position(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        try:
            fab = {
                "fx": min(max(float(payload.get("fx")), 0.0), 1.0),
                "fy": min(max(float(payload.get("fy")), 0.0), 1.0),
                "ts": int(payload.get("ts") or 0),
            }
        except (TypeError, ValueError):
            return web.json_response({"error": "位置格式不正确"}, status=400)
        return web.json_response(
            {"fab_position": _save_settings(fab_position=fab)["fab_position"]}
        )

    async def list_workflows(request):
        return web.json_response({"workflows": _list_workflows()})

    async def reorder_workflows(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        names = payload.get("names")
        if not isinstance(names, list):
            return web.json_response({"error": "缺少 names 顺序列表"}, status=400)
        known = {item["name"] for item in _list_workflows()}
        order = [str(name) for name in names if str(name) in known]
        _save_settings(workflow_order=order)
        return web.json_response({"workflows": _list_workflows()})

    async def list_assets(request):
        """资产库：分页列出 input / output 目录里的素材"""
        kind = str(request.query.get("type", "input") or "input")
        if kind not in ("input", "output"):
            return web.json_response({"error": "type 只支持 input / output"}, status=400)

        category = str(request.query.get("category", "all") or "all")
        if category not in ("all", "photo", "video", "audio"):
            category = "all"

        # 关键字搜索：文件名 / 子目录，不区分大小写
        keyword = str(request.query.get("q", "") or "").strip().lower()

        try:
            offset = int(request.query.get("offset", 0) or 0)
        except (TypeError, ValueError):
            offset = 0
        try:
            limit = int(request.query.get("limit", 60) or 60)
        except (TypeError, ValueError):
            limit = 60
        offset = max(0, offset)
        limit = min(max(1, limit), 200)

        files = _list_assets(kind)
        if category != "all":
            files = [item for item in files if item["category"] == category]
        if keyword:
            files = [
                item
                for item in files
                if keyword in item["filename"].lower() or keyword in item["subfolder"].lower()
            ]
        return web.json_response(
            {
                "type": kind,
                "category": category,
                "total": len(files),
                "offset": offset,
                "files": files[offset : offset + limit],
            }
        )

    async def asset_thumb(request):
        """资产缩略图：命中缓存直接返回 webp，没有就按源图生成。

        缩略图只用于资产库网格展示，拖到画布时前端仍然引用原图（/view）。
        """
        kind = str(request.query.get("type", "input") or "input")
        if kind not in ("input", "output"):
            return web.json_response({"error": "type 只支持 input / output"}, status=400)

        filename = request.query.get("filename", "")
        subfolder = request.query.get("subfolder", "")
        src_path = _asset_path(kind, subfolder, filename)
        if not src_path:
            return web.json_response({"error": "素材不存在"}, status=404)
        lower = src_path.lower()
        # 图片直接缩放，视频取一帧当封面；音频没有缩略图
        if not (lower.endswith(_IMAGE_EXTS) or lower.endswith(_VIDEO_EXTS)):
            return web.json_response({"error": "该素材不支持缩略图"}, status=404)

        real_path = os.path.realpath(src_path)
        try:
            stat = os.stat(real_path)
        except OSError:
            return web.json_response({"error": "读取素材失败"}, status=404)

        # 尺寸档位：只接受 320 / 640 / 960 / 1280，避免被拿来做任意尺寸的图片服务
        try:
            wanted = int(request.query.get("size", _THUMB_SIZE))
        except (TypeError, ValueError):
            wanted = _THUMB_SIZE
        max_side = min(_THUMB_SIZES, key=lambda s: abs(s - wanted))

        # 用纳秒级 mtime：同名文件被重新生成时，秒级时间戳可能撞车导致拿到旧缩略图
        cache_file = _thumb_file(real_path, stat.st_mtime_ns, stat.st_size, max_side)
        if not os.path.isfile(cache_file):
            try:
                await asyncio.to_thread(_build_thumb, real_path, cache_file, max_side)
            except Exception as exc:
                print(f"[Infinite-Canvas] 生成缩略图失败 {real_path}: {exc}")
                return web.json_response({"error": "生成缩略图失败"}, status=500)
            _prune_thumb_cache()

        return web.FileResponse(
            cache_file,
            headers={
                "Content-Type": "image/webp",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        )

    async def asset_meta(request):
        """素材内嵌的 ComfyUI 工作流（PNG/WebP 里的 workflow / prompt 元数据）"""
        kind = str(request.query.get("type", "input") or "input")
        if kind not in ("input", "output"):
            return web.json_response({"error": "type 只支持 input / output"}, status=400)
        filename = request.query.get("filename", "")
        subfolder = request.query.get("subfolder", "")
        path = _asset_path(kind, subfolder, filename)
        if not path:
            return web.json_response({"error": "素材不存在"}, status=404)
        data = dict(await asyncio.to_thread(_read_embedded_json, path) or {})
        # 前端右下角直接展示原文，所以顺手把「提示词」节点里的文本挑出来
        source = data.get("workflow") or data.get("prompt")
        data["prompt_text"] = _extract_prompt_text(source)
        return web.json_response(data)

    async def delete_assets(request):
        """资产库批量删除：按 type/subfolder/filename 定位，限制在 input/output 目录内"""
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        removed = 0
        refs = payload.get("refs") if isinstance(payload, dict) else None
        for item in refs if isinstance(refs, list) else []:
            if not isinstance(item, dict):
                continue
            kind = str(item.get("type") or "input")
            if kind not in ("input", "output"):
                continue
            path = _asset_path(kind, str(item.get("subfolder") or ""), str(item.get("filename") or ""))
            if not path:
                continue
            try:
                os.remove(path)
                removed += 1
            except OSError:
                continue
        return web.json_response({"removed": removed})

    async def list_prompts(request):
        return web.json_response({"prompts": _load_prompt_library()})

    async def add_prompt(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        text = str(payload.get("text", "") or "").strip()
        if not text:
            return web.json_response({"error": "提示词不能为空"}, status=400)
        name = str(payload.get("name", "") or "").strip()[:60]

        items = _load_prompt_library()
        # 已收藏过同样的内容就不再重复添加
        if not any(item["text"] == text for item in items):
            items.insert(
                0,
                {
                    "id": uuid.uuid4().hex,
                    "name": name,
                    "text": text,
                    "created": int(time.time()),
                },
            )
            _save_prompt_library(items)
        return web.json_response({"prompts": items})

    async def rename_prompt(request):
        entry_id = request.match_info.get("entry_id", "")
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        name = str(payload.get("name", "") or "").strip()[:60]
        items = _load_prompt_library()
        for item in items:
            if item["id"] == entry_id:
                item["name"] = name
                break
        _save_prompt_library(items)
        return web.json_response({"prompts": items})

    async def delete_prompt(request):
        entry_id = request.match_info.get("entry_id", "")
        items = [item for item in _load_prompt_library() if item["id"] != entry_id]
        _save_prompt_library(items)
        return web.json_response({"prompts": items})

    async def get_workflow(request):
        name = _safe_name(request.match_info.get("name", ""))
        data = _read_workflow(name)
        if data is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        return web.json_response({"name": name, "workflow": data})

    async def save_workflow(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        name = _safe_name(str(payload.get("name", "") or ""))
        workflow = payload.get("workflow")
        if not name:
            return web.json_response({"error": "缺少工作流名称"}, status=400)
        if not _is_api_workflow(workflow):
            return web.json_response(
                {"error": "不是 ComfyUI API 格式工作流（需为 {节点id: {class_type, inputs}}）"},
                status=400,
            )
        _save_workflow(name, workflow)
        return web.json_response({"name": name})

    async def delete_workflow(request):
        name = _safe_name(request.match_info.get("name", ""))
        if _read_workflow(name) is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        os.remove(_workflow_path(name))
        _delete_fields(name)
        return web.json_response({"ok": True})

    async def get_fields(request):
        """某个工作流暴露给画布的字段配置"""
        name = _safe_name(request.match_info.get("name", ""))
        workflow = _read_workflow(name)
        if workflow is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        return web.json_response({"fields": _public_fields(name, workflow)})

    async def save_fields(request):
        name = _safe_name(request.match_info.get("name", ""))
        workflow = _read_workflow(name)
        if workflow is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        fields = _clean_fields(payload.get("fields"), workflow)
        _save_fields(name, fields)
        return web.json_response({"fields": _public_fields(name, workflow)})

    async def upload_media(request):
        """画布素材存进 ComfyUI 的 input 目录，前端只保存 /view 引用"""
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        data_url = payload.get("data")
        name = str(payload.get("name") or "")
        if not data_url:
            return web.json_response({"error": "缺少文件数据"}, status=400)
        try:
            filename = _save_input_file(name, data_url)
        except Exception as exc:
            return web.json_response({"error": f"保存素材失败: {exc}"}, status=400)

        return web.json_response(
            {
                "name": name or filename,
                "filename": filename,
                "subfolder": "",
                "type": "input",
            }
        )

    async def list_canvases(request):
        return web.json_response({"canvases": _list_canvases()})

    async def create_canvas(request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        canvas_id = uuid.uuid4().hex[:10]
        name = str(payload.get("name") or "").strip() or "未命名画布"
        canvas = {
            "id": canvas_id,
            "name": name[:50],
            "version": 1,
            "nodes": [],
            "edges": [],
            "seq": {"node": 0, "edge": 0},
        }
        _save_canvas(canvas_id, canvas)
        return web.json_response(canvas)

    async def get_canvas(request):
        canvas = _load_canvas(request.match_info.get("canvas_id", ""))
        if canvas is None:
            return web.json_response({"error": "画布不存在"}, status=404)
        return web.json_response(canvas)

    async def save_canvas(request):
        canvas_id = request.match_info.get("canvas_id", "")
        existing = _load_canvas(canvas_id)
        if existing is None:
            return web.json_response({"error": "画布不存在"}, status=404)

        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        canvas = payload.get("canvas")
        if not isinstance(canvas, dict):
            return web.json_response({"error": "缺少画布数据"}, status=400)

        # 只改名字时允许不传 nodes/edges（管理列表里的重命名）
        if "nodes" in canvas or "edges" in canvas:
            if not isinstance(canvas.get("nodes"), list) or not isinstance(canvas.get("edges"), list):
                return web.json_response({"error": "nodes / edges 必须是数组"}, status=400)

        merged = dict(existing)
        for key in ("nodes", "edges", "seq"):
            if key in canvas:
                merged[key] = canvas[key]
        # 画布的平移/缩放：只保留数值，避免脏字段
        viewport = canvas.get("viewport")
        if isinstance(viewport, dict):
            try:
                merged["viewport"] = {
                    "x": float(viewport.get("x") or 0),
                    "y": float(viewport.get("y") or 0),
                    "zoom": float(viewport.get("zoom") or 1),
                }
            except (TypeError, ValueError):
                pass
        if isinstance(canvas.get("name"), str) and canvas["name"].strip():
            merged["name"] = canvas["name"].strip()[:50]
        saved = _save_canvas(canvas_id, merged)
        return web.json_response(
            {
                "id": canvas_id,
                "name": saved.get("name", ""),
                "updated": saved.get("updated"),
                "nodes": len(saved.get("nodes") or []),
            }
        )

    async def delete_canvases(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        removed = []
        for raw_id in payload.get("ids") or []:
            canvas_id = _safe_name(str(raw_id or ""))
            path = _canvas_path(canvas_id)
            if canvas_id and os.path.isfile(path):
                os.remove(path)
                removed.append(canvas_id)
        return web.json_response({"removed": removed})

    async def delete_media(request):
        """删除 input 目录里由本插件上传的素材（只允许 infinite_canvas_ 前缀）"""
        filename = request.match_info.get("filename", "")
        if not _input_file_exists(filename) or not filename.startswith("infinite_canvas_"):
            return web.json_response({"error": "文件不存在"}, status=404)
        os.remove(os.path.join(_input_dir(), filename))
        return web.json_response({"ok": True})

    async def package_media(request):
        """把一组素材引用打包成 zip 直接下载（不落地临时文件）"""
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        refs = payload.get("refs") if isinstance(payload, dict) else None
        wanted = []
        for item in refs if isinstance(refs, list) else []:
            if not isinstance(item, dict):
                continue
            filename = str(item.get("filename") or "")
            subfolder = str(item.get("subfolder") or "")
            source_type = str(item.get("type") or "output")
            # 只允许目录内的普通文件名，避免路径穿越
            if not filename or "/" in filename or "\\" in filename or ".." in filename:
                continue
            if ".." in subfolder or subfolder.startswith("/"):
                continue
            path = os.path.join(_dir_for_type(source_type), subfolder, filename)
            if os.path.isfile(path):
                wanted.append(path)
        if not wanted:
            return web.json_response({"error": "没有可打包的文件"}, status=404)

        buffer = io.BytesIO()
        # 重名文件依次加序号，避免 zip 内互相覆盖
        seen = {}
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            for path in wanted:
                base = os.path.basename(path)
                count = seen.get(base, 0) + 1
                seen[base] = count
                if count > 1:
                    stem, ext = os.path.splitext(base)
                    base = f"{stem}-{count}{ext}"
                bundle.write(path, arcname=base)

        zip_name = _safe_name(str(payload.get("name") or "")) or "assets"
        encoded = quote(f"{zip_name}.zip")
        return web.Response(
            body=buffer.getvalue(),
            content_type="application/zip",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="assets.zip"; filename*=UTF-8\'\'{encoded}'
                )
            },
        )

    async def execute_workflow(request):
        """按选中的工作流跑一次：写入素材/暴露参数后提交 ComfyUI，回传产物"""
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        name = _safe_name(str(payload.get("workflow", "") or ""))
        workflow = _read_workflow(name)
        if workflow is None:
            return web.json_response({"error": "工作流不存在"}, status=404)

        try:
            # imageRefs 支持 {filename, subfolder, type}：产物在 output 目录时会先复制进 input
            refs = payload.get("imageRefs") or []
            filenames = [name for name in (_input_ref_filename(ref) for ref in refs) if name]
            if not filenames:
                filenames = _save_input_images(payload.get("images") or [])
        except Exception as exc:
            return web.json_response({"error": f"素材处理失败: {exc}"}, status=400)

        _apply_images(workflow, filenames)
        _apply_params(workflow, payload.get("params"))
        _apply_media_params(workflow, name)

        origin = _comfy_base(request)
        # 前端用同一个 clientId 连 /ws：ComfyUI 的进度消息只推给提交任务的客户端
        raw_client = str(payload.get("clientId") or "").strip()
        client_id = raw_client if re.fullmatch(r"[0-9a-zA-Z_-]{1,64}", raw_client) else uuid.uuid4().hex

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{origin}/prompt",
                    json={"prompt": workflow, "client_id": client_id},
                ) as response:
                    body = await response.json(content_type=None)
                    if response.status != 200:
                        return web.json_response({"error": _prompt_error(body)}, status=400)
                    prompt_id = (body or {}).get("prompt_id")
        except aiohttp.ClientError as exc:
            return web.json_response({"error": f"连接 ComfyUI 失败: {exc}"}, status=502)

        if not prompt_id:
            return web.json_response({"error": "ComfyUI 未返回任务 id"}, status=502)

        # 立即返回任务 id，进度与产物由前端通过 /ws 和 /prompts/{id} 跟进
        return web.json_response({"prompt_id": prompt_id})

    async def prompt_result(request):
        """查询一次任务结果：done 带素材，error 带原因，running 表示还没结束"""
        prompt_id = request.match_info.get("prompt_id", "")
        if not re.fullmatch(r"[0-9a-zA-Z_-]{1,64}", prompt_id):
            return web.json_response({"error": "任务 id 不合法"}, status=400)

        origin = _comfy_base(request)
        try:
            async with aiohttp.ClientSession() as session:
                # 队列里的状态优先：排队中的任务 /history 还是空的
                queued = await _queue_state(session, origin, prompt_id)
                if queued:
                    return web.json_response(queued)
                result = await _wait_outputs(session, origin, prompt_id, timeout=6)
        except aiohttp.ClientError as exc:
            return web.json_response({"status": "running", "detail": str(exc)})

        if result.get("status") == "error":
            return web.json_response({"status": "error", "error": result.get("error")})
        if result.get("status") != "done":
            return web.json_response({"status": "running"})

        images = _collect_outputs(result.get("outputs"))
        return web.json_response({"status": "done", "images": images})

    async def abort_prompt(request):
        """运行中的任务用 /interrupt 取消，排队中的任务直接从 /queue 删掉"""
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        prompt_id = str(payload.get("prompt_id") or "").strip()
        if not re.fullmatch(r"[0-9a-zA-Z_-]{1,64}", prompt_id):
            return web.json_response({"error": "任务 id 不合法"}, status=400)

        origin = _comfy_base(request)
        try:
            async with aiohttp.ClientSession() as session:
                state = await _queue_state(session, origin, prompt_id)
                if state and state.get("status") == "queued":
                    async with session.post(
                        f"{origin}/queue", json={"delete": [prompt_id]}
                    ) as response:
                        await response.read()
                    return web.json_response({"action": "dequeued"})
                if state and state.get("status") == "running":
                    # /interrupt 作用于当前正在执行的任务，上面已确认就是它
                    async with session.post(f"{origin}/interrupt") as response:
                        await response.read()
                    return web.json_response({"action": "interrupted"})
        except aiohttp.ClientError as exc:
            return web.json_response({"error": f"连接 ComfyUI 失败: {exc}"}, status=502)

        # 已经结束（或不在队列里）：前端按本地状态清理即可
        return web.json_response({"action": "finished"})

    async def queue_history(request):
        """ComfyUI 的任务队列：正在运行 / 排队中的任务 + 最近跑完的历史

        直接转发 ComfyUI 的 /queue 与 /history，不做本地落盘：重启 ComfyUI 后清空，
        与 ComfyUI 自带的任务队列面板保持一致。
        """
        try:
            limit = int(request.query.get("limit", 60))
        except (TypeError, ValueError):
            limit = 60
        limit = max(1, min(limit, 200))

        origin = _comfy_base(request)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{origin}/queue") as response:
                    queue = await response.json(content_type=None)
                async with session.get(
                    f"{origin}/history", params={"max_items": str(limit)}
                ) as response:
                    data = await response.json(content_type=None)
        except aiohttp.ClientError as exc:
            return web.json_response({"error": f"连接 ComfyUI 失败: {exc}"}, status=502)

        queue = queue if isinstance(queue, dict) else {}
        running = [
            {"promptId": _queue_prompt_id(item), "status": "running"}
            for item in queue.get("queue_running") or []
            if _queue_prompt_id(item)
        ]
        pending = [
            {"promptId": _queue_prompt_id(item), "status": "pending", "position": index + 1}
            for index, item in enumerate(queue.get("queue_pending") or [])
            if _queue_prompt_id(item)
        ]

        raw = data if isinstance(data, dict) else {}
        items = [
            _history_item(str(prompt_id), entry)
            for prompt_id, entry in raw.items()
            if isinstance(entry, dict)
        ]
        items.sort(key=lambda item: item.get("finishedAt") or 0, reverse=True)
        return web.json_response(
            {"running": running, "pending": pending, "items": items[:limit]}
        )

    async def free_memory(request):
        """卸载已加载的模型并清空显存 / 内存缓存（转发 ComfyUI 自身的 POST /free）

        前端在本地开发（vite dev server）时是同源外的地址，直接调 /free 到不了
        ComfyUI，所以统一走后端这个接口，由后端回环请求本机 ComfyUI。
        """
        origin = _comfy_base(request)
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{origin}/free",
                    json={"unload_models": True, "free_memory": True},
                ) as response:
                    await response.read()
                    if response.status >= 400:
                        return web.json_response({"error": "ComfyUI 显存清理失败"}, status=502)
        except aiohttp.ClientError as exc:
            return web.json_response({"error": f"连接 ComfyUI 失败: {exc}"}, status=502)
        return web.json_response({"ok": True})

    if os.path.isdir(_FRONTEND_DIST):
        app.add_routes([web.static("/infinite_canvas/app", _FRONTEND_DIST)])

    app.add_routes(
        [
            web.get(f"{API_PREFIX}/settings", get_settings),
            web.post(f"{API_PREFIX}/settings", save_settings),
            web.get(f"{API_PREFIX}/fab-position", get_fab_position),
            web.post(f"{API_PREFIX}/fab-position", save_fab_position),
            web.get(f"{API_PREFIX}/workflows", list_workflows),
            web.post(f"{API_PREFIX}/workflows", save_workflow),
            web.put(f"{API_PREFIX}/workflows/order", reorder_workflows),
            web.get(f"{API_PREFIX}/library/assets", list_assets),
            web.get(f"{API_PREFIX}/library/thumb", asset_thumb),
            web.get(f"{API_PREFIX}/library/meta", asset_meta),
            web.post(f"{API_PREFIX}/library/delete", delete_assets),
            web.get(f"{API_PREFIX}/library/prompts", list_prompts),
            web.post(f"{API_PREFIX}/library/prompts", add_prompt),
            web.patch(f"{API_PREFIX}/library/prompts/{{entry_id}}", rename_prompt),
            web.delete(f"{API_PREFIX}/library/prompts/{{entry_id}}", delete_prompt),
            web.get(f"{API_PREFIX}/workflows/{{name}}", get_workflow),
            web.delete(f"{API_PREFIX}/workflows/{{name}}", delete_workflow),
            web.get(f"{API_PREFIX}/workflows/{{name}}/fields", get_fields),
            web.put(f"{API_PREFIX}/workflows/{{name}}/fields", save_fields),
            web.post(f"{API_PREFIX}/media", upload_media),
            web.delete(f"{API_PREFIX}/media/{{filename}}", delete_media),
            web.post(f"{API_PREFIX}/package", package_media),
            web.get(f"{API_PREFIX}/canvases", list_canvases),
            web.post(f"{API_PREFIX}/canvases", create_canvas),
            web.post(f"{API_PREFIX}/canvases/delete", delete_canvases),
            web.get(f"{API_PREFIX}/canvases/{{canvas_id}}", get_canvas),
            web.put(f"{API_PREFIX}/canvases/{{canvas_id}}", save_canvas),
            web.post(f"{API_PREFIX}/execute", execute_workflow),
            web.get(f"{API_PREFIX}/prompts/{{prompt_id}}", prompt_result),
            web.post(f"{API_PREFIX}/queue/abort", abort_prompt),
            web.get(f"{API_PREFIX}/queue/history", queue_history),
            web.post(f"{API_PREFIX}/free", free_memory),
        ]
    )


def _register_routes():
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception as exc:
        print(f"[Infinite-Canvas] 无法导入 aiohttp/server: {exc}")
        return

    app = getattr(PromptServer.instance, "app", None)
    if app is None:
        print("[Infinite-Canvas] PromptServer.app 不可用")
        return

    # Vue 构建产物：web/ 只放扩展入口脚本，页面本体在这里托管
    if os.path.isdir(_FRONTEND_DIST):
        print(f"[Infinite-Canvas] 前端: /infinite_canvas/app -> {_FRONTEND_DIST}")
    else:
        print(
            f"[Infinite-Canvas] 缺少 {_FRONTEND_DIST}，"
            "请先在 frontend/ 执行 npm install && npm run build"
        )

    register_routes(app)
    print(f"[Infinite-Canvas] 工作流目录: {_workflow_dir()}")
    print(f"[Infinite-Canvas] 画布目录: {_canvas_dir()}")


_register_routes()

print("[Infinite-Canvas] 已加载")
