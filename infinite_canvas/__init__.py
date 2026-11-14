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
import subprocess
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


# ---------------------------------------------------------------- 内置工作流
# 随插件分发的现成工作流（目前是两套文生音乐）只在插件目录里存一份，运行时
# 直接读，**不复制进用户目录**：它们属于「内置」，画布上能用，但不出现在
# 「工作流配置」里，也不能改名 / 删除 / 改字段；用户自己导入的才归用户所有。
_BUILTIN_DIR = os.path.join(_NODE_ROOT, "builtin_workflows")
_builtin_manifest_cache = {"mtime": None, "data": None}


def _builtin_manifest():
    """读内置清单（按文件 mtime 缓存：插件更新后自动失效）"""
    path = os.path.join(_BUILTIN_DIR, "manifest.json")
    if not os.path.isfile(path):
        return None
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    if _builtin_manifest_cache["mtime"] == mtime:
        return _builtin_manifest_cache["data"]
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return None
    data = data if isinstance(data, dict) else None
    _builtin_manifest_cache["mtime"] = mtime
    _builtin_manifest_cache["data"] = data
    return data


def _builtin_items():
    """{名字: 清单条目}，按清单顺序（dict 保序）"""
    items = {}
    manifest = _builtin_manifest() or {}
    for item in manifest.get("items") or []:
        if not isinstance(item, dict):
            continue
        name = _safe_name(str(item.get("name") or ""))
        if name and name not in items:
            items[name] = item
    return items


def _is_builtin(name):
    return bool(name) and name in _builtin_items()


def _builtin_path(name):
    """内置工作流 JSON 路径；不是内置的返回空串"""
    item = _builtin_items().get(name)
    if not item:
        return ""
    filename = str(item.get("file") or "") or f"{name}.json"
    return os.path.join(_BUILTIN_DIR, filename)


def _builtin_fields_path(name):
    return os.path.join(_BUILTIN_DIR, f"{name}.fields.json")


def _field_file_candidates(name):
    """字段配置文件候选：用户目录有同名工作流时只认用户的，否则先内置后备用户"""
    candidates = []
    if not os.path.isfile(_workflow_path(name)):
        candidates.append(_builtin_fields_path(name))
    candidates.append(_fields_path(name))
    return candidates


def _is_api_workflow(data):
    """ComfyUI API 格式：{node_id: {"class_type": ..., "inputs": {...}}}"""
    if not isinstance(data, dict) or not data:
        return False
    return all(
        isinstance(value, dict) and "class_type" in value for value in data.values()
    )


# ---------------------------------------------------------------- 工作流分类
# 导入的工作流按用途分六类，画布左栏按这个分组、节点上的工作流选择器也按它排段。
# 顺序即界面顺序；新增类别只改这里（前端 xcatWFCats() 同步）。
WORKFLOW_CATEGORIES = (
    "文生图像",
    "图像编辑",
    "文生视频",
    "参考生视频",
    "图像放大",
    "图像反推",
    "文生音乐",
)
_DEFAULT_WORKFLOW_CATEGORY = WORKFLOW_CATEGORIES[0]

# 按节点类名（小写子串）推断用途，只用于导入时给个初始分类，用户可随时改
_CATEGORY_HINTS = {
    "图像反推": (
        "caption",
        "tagger",
        "interrogat",
        "florence",
        "blip",
        "joytag",
        "wd14",
        "promptgen",
        "reverseprompt",
    ),
    "图像放大": (
        "upscalemodelloader",
        "imageupscalewithmodel",
        "latentupscale",
        "upscale",
        "imagescale",
        "resizeimagemask",
        "imageresize",
        "seedvr",
        "esrgan",
        "swinir",
        "superresolution",
    ),
}
_AUDIO_OUTPUT_HINTS = (
    "saveaudio",
    "yue2",
    "minimaxmusic",
    "stableaudio",
    "acestep",
    "ace_step",
    "musicgen",
    "audiogen",
    "texttoaudio",
    "latentaudio",
)
_VIDEO_OUTPUT_HINTS = (
    "savevideo",
    "videocombine",
    "savewebm",
    "animatedwebp",
    "createvideo",
    "saveanimated",
)
_IMAGE_OUTPUT_HINTS = ("saveimage", "previewimage")
_IMAGE_INPUT_HINTS = ("loadimage", "loadvideo", "vhs_loadvideo", "loadimagemask")


def _normalize_category(value):
    """只有六类算合法分类，其余（含空）返回空串"""
    text = str(value or "").strip()
    return text if text in WORKFLOW_CATEGORIES else ""


def _detect_workflow_category(workflow):
    """按节点类名猜分类：音频 → 取标题/打标签 → 放大 → 视频（有无参考图）→ 图像（有无参考图）"""
    classes = []
    if isinstance(workflow, dict):
        for node in workflow.values():
            if isinstance(node, dict) and isinstance(node.get("class_type"), str):
                classes.append(node["class_type"].lower())
    if not classes:
        return _DEFAULT_WORKFLOW_CATEGORY

    def has(hints):
        return any(hint in name for name in classes for hint in hints)

    # 音频优先：文生音乐工作流也可能带 PreviewImage 之类的节点
    if has(_AUDIO_OUTPUT_HINTS):
        return "文生音乐"

    for category in ("图像反推", "图像放大"):
        if has(_CATEGORY_HINTS[category]):
            return category

    video_out = has(_VIDEO_OUTPUT_HINTS)
    image_out = has(_IMAGE_OUTPUT_HINTS)
    image_in = has(_IMAGE_INPUT_HINTS)
    if video_out:
        return "参考生视频" if image_in else "文生视频"
    if not image_out:
        return _DEFAULT_WORKFLOW_CATEGORY
    return "图像编辑" if image_in else "文生图像"


def _list_workflows():
    """全部工作流：用户自己的按拖拽顺序排在前面，内置的（只读）固定压尾"""
    workflow_dir = _workflow_dir()
    workflow_categories = _load_settings().get("workflow_categories") or {}
    items = []
    user_names = set()
    if os.path.isdir(workflow_dir):
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
            name = filename[:-5]
            category = _normalize_category(workflow_categories.get(name))
            if not category:
                category = _detect_workflow_category(data)
            user_names.add(name)
            items.append(
                {
                    "name": name,
                    "nodes": len(data) if isinstance(data, dict) else 0,
                    "updated": int(os.path.getmtime(path)),
                    "category": category,
                    "builtin": False,
                }
            )

    builtin_rank = {}
    for index, (name, entry) in enumerate(_builtin_items().items()):
        # 用户自己导入过同名工作流时以用户的为准，内置那份就不列了
        if name in user_names:
            continue
        path = _builtin_path(name)
        if not path or not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            continue
        builtin_rank[name] = index
        items.append(
            {
                "name": name,
                "nodes": len(data) if isinstance(data, dict) else 0,
                "updated": int(os.path.getmtime(path)),
                "category": _normalize_category(entry.get("category"))
                or _detect_workflow_category(data),
                "builtin": True,
            }
        )

    # 用户拖拽调整过的顺序优先，其余（新增的）按名称排在后面；内置固定压尾
    order = _load_settings().get("workflow_order", [])
    ranked = {name: index for index, name in enumerate(order)}

    def sort_key(item):
        if item.get("builtin"):
            return (1, builtin_rank.get(item["name"], 0), "")
        return (0, ranked.get(item["name"], len(ranked)), item["name"])

    items.sort(key=sort_key)
    return items


def _load_settings():
    settings = {
        "comfy_address": "",
        "workflow_order": [],
        "fab_position": None,
        "workflow_categories": {},
        "builtin_installed": {},
        "builtin_migrated": 0,
    }
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
            categories = data.get("workflow_categories")
            if isinstance(categories, dict):
                settings["workflow_categories"] = {
                    str(name): str(category)
                    for name, category in categories.items()
                    if name and str(category) in WORKFLOW_CATEGORIES
                }
            installed = data.get("builtin_installed")
            if isinstance(installed, dict):
                clean = {}
                for name, version in installed.items():
                    try:
                        clean[str(name)] = int(version)
                    except (TypeError, ValueError):
                        continue
                settings["builtin_installed"] = clean
            try:
                settings["builtin_migrated"] = int(data.get("builtin_migrated") or 0)
            except (TypeError, ValueError):
                settings["builtin_migrated"] = 0
    return settings


def _save_settings(
    address=None,
    workflow_order=None,
    fab_position=None,
    workflow_categories=None,
    builtin_installed=None,
    builtin_migrated=None,
):
    settings = _load_settings()
    if address is not None:
        settings["comfy_address"] = address
    if workflow_order is not None:
        settings["workflow_order"] = [str(name) for name in workflow_order if name]
    if fab_position is not None:
        settings["fab_position"] = fab_position
    if workflow_categories is not None:
        settings["workflow_categories"] = dict(workflow_categories)
    if builtin_installed is not None:
        settings["builtin_installed"] = dict(builtin_installed)
    if builtin_migrated is not None:
        settings["builtin_migrated"] = int(builtin_migrated)
    os.makedirs(_data_dir(), exist_ok=True)
    with open(_settings_path(), "w", encoding="utf-8") as handle:
        json.dump(settings, handle, ensure_ascii=False, indent=2)
    return _load_settings()


def _set_workflow_category(name, category):
    """记住某个工作流的分类；category 为空表示忘掉它（删除 / 改名时用）"""
    categories = dict(_load_settings().get("workflow_categories") or {})
    if category:
        categories[name] = category
    else:
        categories.pop(name, None)
    _save_settings(workflow_categories=categories)
    return categories


# ---------------------------------------------------------------- 内置工作流（迁移）
# 旧版本会把内置工作流 copy 进用户 workflows 目录，用户既能改也能删，和
# 「内置不可更改」冲突。现在内置工作流直接从 _BUILTIN_DIR 只读加载（见文件开头
# 的 _builtin_* 系列），这里只负责把当年复制出去的副本收回。
_builtin_state = {"done": False}


def _ensure_builtin_workflows():
    """清理旧版本复制到用户目录的内置副本（幂等，失败下轮重试）

    只删「settings 里 builtin_installed 记过的」名字：那是插件自己装的。
    用户自己导入的同名工作流没有记录，保留不动（列表里以用户的为准）。
    """
    if _builtin_state["done"]:
        return
    manifest = _builtin_manifest()
    if not manifest:
        _builtin_state["done"] = True
        return
    try:
        version = int(manifest.get("version") or 1)
    except (TypeError, ValueError):
        version = 1
    settings = _load_settings()
    if settings.get("builtin_migrated") == version:
        _builtin_state["done"] = True
        return
    installed = dict(settings.get("builtin_installed") or {})
    builtin_names = set(_builtin_items())
    for name in builtin_names:
        if name not in installed:
            continue
        for path in (_workflow_path(name), _fields_path(name)):
            if not os.path.isfile(path):
                continue
            try:
                os.remove(path)
            except Exception as exc:  # pragma: no cover - 只可能是磁盘权限问题
                print(f"[XXXXXLCat] 清理内置工作流旧副本失败 {name}: {exc}")
    # 顺带把内置名字从排序 / 分类表里摘掉：内置工作流的顺序由清单决定
    order = [name for name in settings.get("workflow_order") or [] if name not in builtin_names]
    if order != (settings.get("workflow_order") or []):
        _save_settings(workflow_order=order)
    categories = {
        name: category
        for name, category in (settings.get("workflow_categories") or {}).items()
        if name not in builtin_names
    }
    if categories != (settings.get("workflow_categories") or {}):
        _save_settings(workflow_categories=categories)
    _save_settings(builtin_migrated=version)
    _builtin_state["done"] = True


def _builtin_readonly(name):
    """内置工作流的统一拒绝响应（写操作一律挡住）"""
    from aiohttp import web  # 模块级不依赖 aiohttp，跟 setup() 里一样按需导入

    return web.json_response(
        {"error": f"「{name}」是内置工作流，只读，不能修改或删除"}, status=403
    )


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
    """读取工作流 JSON，不存在或解析失败返回 None（用户目录优先，其次内置）"""
    if not name:
        return None
    for path in (_workflow_path(name), _builtin_path(name)):
        if not path or not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return json.load(handle)
        except Exception:
            return None
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

# ------------------------------------------------- 分辨率选择器：自动识别 / 自动填入
# 判定不看 class_type：一个节点只要同时有 aspect_ratio 与 megapixels 两个输入，
# 就按分辨率选择器处理。这样官方 ResolutionSelector、本包
# 🐈‍⬛ResolutionSelector（DynamicCombo / Custom）以及同结构的第三方节点都能覆盖。
# 自动填入只补「缺失 / 残缺」的内容，用户手填的显示名与自定义选项一律保留。
_RESOLUTION_KEYS = ("aspect_ratio", "megapixels")
_RESOLUTION_LABELS = {"aspect_ratio": "高宽比", "megapixels": "百万像素"}
_RESOLUTION_RATIOS = [
    "1:1 (Square)",
    "2:3 (Portrait Photo)",
    "3:2 (Photo)",
    "3:4 (Portrait Standard)",
    "4:3 (Standard)",
    "9:16 (Portrait Widescreen)",
    "16:9 (Widescreen)",
    "21:9 (Ultrawide)",
]
# 用户在字段弹窗里取消掉自动字段后写进 <name>.fields.json 的哨兵，
# 避免下次读取又被自动注入回来（仍然可以手动勾选）。
_NO_AUTO_KEY = "__xcat_no_auto__"


def _is_resolution_node(node):
    inputs = node.get("inputs") if isinstance(node, dict) else None
    return isinstance(inputs, dict) and all(key in inputs for key in _RESOLUTION_KEYS)


def _resolution_spec(node):
    """两条自动字段的完整定义；比例选项与数值范围取自节点自身版本。"""
    custom = "🐈‍⬛" in str((node or {}).get("class_type") or "")
    ratios = list(_RESOLUTION_RATIOS) + (["Custom"] if custom else [])
    return {
        "aspect_ratio": {
            "key": "aspect_ratio", "type": "select",
            "label": _RESOLUTION_LABELS["aspect_ratio"],
            "options": ratios, "auto": True,
        },
        "megapixels": {
            "key": "megapixels", "type": "number",
            "label": _RESOLUTION_LABELS["megapixels"],
            "min": 0.0 if custom else 0.1,
            "max": 16.0, "step": 0.01, "auto": True,
        },
    }


def _resolution_value(value):
    """DynamicCombo 的 aspect_ratio 在 API JSON 里是 dict，取其中的选中比例。"""
    if isinstance(value, dict):
        for key in ("aspect_ratio", "key", "value"):
            picked = value.get(key)
            if isinstance(picked, str):
                return picked
        return ""
    return value


def _suppressed_nodes(raw):
    return {
        str(item.get("nodeId") or "")
        for item in (raw if isinstance(raw, list) else [])
        if isinstance(item, dict) and item.get("key") == _NO_AUTO_KEY
    }


def _fields_path(name):
    return os.path.join(_workflow_dir(), f"{name}.fields.json")


def _load_fields(name):
    for path in _field_file_candidates(name):
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as handle:
                raw = json.load(handle)
        except Exception:
            return []
        fields = raw.get("fields") if isinstance(raw, dict) else None
        return [item for item in fields if isinstance(item, dict)] if isinstance(fields, list) else []
    return []


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
        if key == _NO_AUTO_KEY:
            # 用户显式关闭了自动填入；只是配置哨兵，不是画布字段
            continue
        value = (node.get("inputs") or {}).get(key)
        is_resolution = _is_resolution_node(node) and key in _RESOLUTION_KEYS
        if isinstance(value, (list, dict)):
            # 本包 🐈‍⬛ResolutionSelector 的 DynamicCombo 输入是 dict，
            # 允许暴露成下拉框；其余对象一律当作不可修改的输入跳过。
            if not (is_resolution and isinstance(value, dict) and key == "aspect_ratio"):
                continue
        marker = (node_id, key)
        if marker in seen:
            continue
        seen.add(marker)

        field_type = str(item.get("type") or "text")
        if field_type not in _FIELD_TYPES:
            field_type = "text"
        title = (node.get("_meta") or {}).get("title")
        label = item.get("label")
        if is_resolution and not label:
            label = _RESOLUTION_LABELS[key]
        entry = {
            "nodeId": node_id,
            "key": key,
            "type": field_type,
            "label": str(label or title or key)[:40],
        }
        if item.get("auto") is True:
            entry["auto"] = True
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

        if is_resolution:
            spec = _resolution_spec(node)[key]
            if key == "aspect_ratio" and field_type == "select":
                # 旧的手工配置常常只有当前值一项，补齐整套比例；
                # 用户自定义过的额外选项仍保留在末尾。
                merged = list(spec["options"])
                for option in entry["options"]:
                    if option and option not in merged:
                        merged.append(option)
                current = _resolution_value(value)
                if isinstance(current, str) and current and current not in merged:
                    merged.append(current)
                entry["options"] = merged[:60]
            if key == "megapixels" and field_type in ("number", "slider", "random"):
                for num_key in _FIELD_NUM_KEYS:
                    entry.setdefault(num_key, spec[num_key])
        cleaned.append(entry)
    return cleaned


def _public_fields(name, workflow):
    """返回字段配置，并把默认值取成工作流里的当前值。

    分辨率选择器节点如果从没配置过，自动注入「高宽比 / 百万像素」两条字段；
    已经配置过的节点只做内容补全（选项、范围、显示名），不擅自改动用户的勾选。
    """
    raw = _load_fields(name)
    fields = _clean_fields(raw, workflow)
    suppressed = _suppressed_nodes(raw)
    configured = {field["nodeId"] for field in fields}
    if isinstance(workflow, dict):
        for node_id, node in workflow.items():
            if not _is_resolution_node(node):
                continue
            if str(node_id) in suppressed or str(node_id) in configured:
                continue
            for spec in _resolution_spec(node).values():
                fields.append(dict(spec, nodeId=str(node_id)))
    result = []
    for field in fields:
        node = workflow.get(field["nodeId"]) or {}
        value = _resolution_value((node.get("inputs") or {}).get(field["key"]))
        field["default"] = value if isinstance(value, (str, int, float, bool, list)) else ""
        result.append(field)
    # 把「关闭自动填入」的记录也返回，配置页保存时会原样带回；
    # 画布节点 / 节点预览会在前端按 key 过滤掉它。
    for node_id in sorted(suppressed):
        if isinstance(workflow, dict) and node_id in workflow:
            result.append({
                "nodeId": node_id, "key": _NO_AUTO_KEY,
                "type": "text", "label": "", "default": "", "suppressed": True,
            })
    return result


def _save_fields(name, fields, suppressed=None):
    suppressed = sorted(suppressed or [])
    if not fields and not suppressed:
        path = _fields_path(name)
        if os.path.isfile(path):
            os.remove(path)
        return
    # 哨兵同时写进 fields 数组，保证下次 GET → PUT 能原样带回来，
    # 用户既不会「关不掉自动填入」，也能重新手动勾选再恢复。
    payload_fields = list(fields) + [
        {"nodeId": node_id, "key": _NO_AUTO_KEY} for node_id in suppressed
    ]
    payload = {"fields": payload_fields}
    if suppressed:
        payload["noAutoResolution"] = suppressed
    os.makedirs(_workflow_dir(), exist_ok=True)
    with open(_fields_path(name), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


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


# ---------------------------------------------------------------- 音频处理
# 画布音频节点的「截取 / 变速」：源文件一定在 input 目录里，处理结果也写回
# input 目录（新文件名，不覆盖原素材），前端拿到 filename 后用 itemsFromRefs
# 构造媒体项并生成新节点。所有时间参数由前端按真实 duration 限制，这里再做
# 一次独立校验，避免直接调用 API 时把任意数值拼进 filter_complex。
_FFMPEG_CACHE = {}
_AUDIO_PROCESS_TIMEOUT = 300  # 秒


def _ffmpeg_bin(kind="ffmpeg"):
    if kind in _FFMPEG_CACHE:
        return _FFMPEG_CACHE[kind]
    exe = shutil.which(kind)
    if not exe:
        try:
            import imageio_ffmpeg

            bundled = imageio_ffmpeg.get_ffmpeg_exe()
            # imageio 只带 ffmpeg；同目录若有 ffprobe 也可以复用
            if kind == "ffmpeg":
                exe = bundled
            else:
                candidate = os.path.join(os.path.dirname(bundled), kind + ".exe")
                exe = candidate if os.path.isfile(candidate) else None
        except Exception:
            exe = None
    _FFMPEG_CACHE[kind] = exe
    return exe


def _subprocess_flags():
    """Windows 下禁止 ffmpeg 弹控制台窗口（其它平台返回 0）"""
    if os.name != "nt":
        return {}
    return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}


async def _run_media_cmd(cmd, timeout=_AUDIO_PROCESS_TIMEOUT):
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
        raise RuntimeError("音频处理超时，请缩短片段或降低变速倍数")
    if proc.returncode != 0:
        detail = (err or b"").decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError(detail[-1] if detail else f"FFmpeg 退出码 {proc.returncode}")
    return (out or b"").decode("utf-8", "replace").strip()


async def _probe_duration(path):
    probe = _ffmpeg_bin("ffprobe")
    if not probe:
        return None
    try:
        text = await _run_media_cmd(
            [
                probe, "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", path,
            ],
            timeout=30,
        )
        value = float(text.splitlines()[0])
        return value if value > 0 else None
    except Exception:
        return None


def _resolve_media_path(filename, subfolder="", source_type="input"):
    """把画布媒体引用解析成本地文件；只允许落在对应媒体目录内。"""
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        raise ValueError("文件名非法")
    if any(ord(ch) < 32 for ch in filename):
        raise ValueError("文件名非法")
    base = os.path.realpath(_dir_for_type(source_type))
    folder = str(subfolder or "").replace("\\", "/")
    if folder.startswith("/") or ".." in folder.split("/") or any(ord(ch) < 32 for ch in folder):
        raise ValueError("子目录非法")
    path = os.path.realpath(os.path.join(base, folder, filename))
    if os.path.commonpath([base, path]) != base or not os.path.isfile(path):
        raise ValueError("音频文件不存在或路径非法")
    return path


def _audio_output_name():
    return f"infinite_canvas_{uuid.uuid4().hex}.m4a"


def _atempo_chain(speed):
    """每级限制在 0.5–2，避免 atempo 越界；链式相乘等于目标速度。"""
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


def _clip_filter(segments):
    parts = [
        "[0:a:0]atrim=start=%.6f:end=%.6f,asetpts=PTS-STARTPTS[p%d]" % (s, e, i)
        for i, (s, e) in enumerate(segments)
    ]
    parts.append(
        "%sconcat=n=%d:v=0:a=1[out]" % ("".join("[p%d]" % i for i in range(len(segments))), len(segments))
    )
    return ";".join(parts)


# ---------------------------------------------------------------- 视频处理
# 与 process_audio 共用 _ffmpeg_bin / _run_media_cmd / _resolve_media_path，
# 编码参数对齐参考项目 Toonflow 的 videoProcessing.ts：
#   m4a = aac 192k / ipod / +faststart
#   mp4 = libx264 preset fast crf 18 / pad 到偶数边 / yuv420p / aac 192k / +faststart
#   png = image2 -update 1 单帧
# 产物一律 UUID 命名落在 input 目录，绝不覆盖源文件。
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


def _video_output_name(ext):
    return f"infinite_canvas_{uuid.uuid4().hex}.{ext}"


async def _probe_video(path):
    """ffprobe 取时长 / 分辨率 / 是否有音轨；不可用或解析失败返回 None。

    与 _probe_duration 不同，这里必须知道「有没有音轨」和「有没有画面」，
    否则提取音轨会在 FFmpeg 阶段才失败，用户只看到一行英文报错。
    """
    probe = _ffmpeg_bin("ffprobe")
    if not probe:
        return None
    try:
        text = await _run_media_cmd(
            [
                probe, "-v", "error", "-show_entries",
                "format=duration:stream=index,codec_type,width,height",
                "-of", "json", path,
            ],
            timeout=30,
        )
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
            "width": (video or {}).get("width"),
            "height": (video or {}).get("height"),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams),
            "has_video": video is not None,
            "video_index": (video or {}).get("index", 0),
        }
    except Exception:
        return None


def _cleanup_outputs(made):
    for item in made:
        try:
            if os.path.isfile(item["path"]):
                os.remove(item["path"])
        except OSError:
            pass


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
            if key not in inputs:
                continue
            current = inputs[key]
            if isinstance(current, dict):
                # 本包 🐈‍⬛ResolutionSelector 的 DynamicCombo 输入形如
                # {"aspect_ratio": "1:1 (Square)", "custom_width": ...}。
                # 画布上给的是比例字符串，写回时只替换选中项、保留自定义宽高。
                if (
                    key == "aspect_ratio"
                    and _is_resolution_node(node)
                    and isinstance(value, str)
                    and "aspect_ratio" in current
                ):
                    updated = dict(current)
                    updated["aspect_ratio"] = value
                    inputs[key] = updated
                continue
            if isinstance(current, list):
                # 连线不覆盖
                continue
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


# ============================================================ 画布 LoRA 栈注入
#
# 画布上的「LoRA 栈」节点不参与工作流本身：它只有一份 {文件名, 强度} 列表，
# 运行时由这里把整条链插进工作流 —— 位置正是用户要求的「UNet 加载器之后」。
#
# 找插入点的办法不依赖 class_type 白名单：所有 "model" 输入都是连线，
# 顺着这些连线反查来源，那个「被 model 引用、自己又没有 model 输入」的节点
# 就是 MODEL 链的源头（UNETLoader / CheckpointLoaderSimple / 各种 GGUF、自定义
# 加载器都一样）。把它的全部消费方改接到链尾，链首接回它，顺序即
# 加载器 → LoRA1 → LoRA2 → … → 原来的消费方。
_LORA_CLASS = "LoraLoaderModelOnly"
_LORA_LIMIT = 100.0
_lora_names_cache = {"at": 0.0, "names": set()}


def _is_link(value):
    """API 格式里连线是 [上游节点 id, 输出槽位]"""
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and isinstance(value[0], str)
        and isinstance(value[1], int)
    )


def _normalize_lora_name(name):
    """画布与 ComfyUI 的目录分隔符可能是 / 也可能是 \\，比较时统一成 /"""
    return str(name or "").replace("\\", "/").strip()


def _lora_names():
    """LoRA 目录里的文件名集合（60 秒缓存，避免每次运行都扫目录）"""
    now = time.time()
    if now - _lora_names_cache["at"] < 60 and _lora_names_cache["names"]:
        return _lora_names_cache["names"]
    names = set()
    try:
        import folder_paths

        names = {_normalize_lora_name(n) for n in folder_paths.get_filename_list("loras")}
    except Exception as exc:  # pragma: no cover - 只可能在非 ComfyUI 环境触发
        print(f"[XXXXXLCat] 读取 LoRA 目录失败: {exc}")
    if names:
        _lora_names_cache["at"] = now
        _lora_names_cache["names"] = names
    return names


def _clean_loras(raw):
    """把前端传来的栈洗成 [(name, strength)]：丢掉空行、停用行、0 强度与不存在的文件"""
    known = _lora_names()
    items = []
    skipped = []
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        name = _normalize_lora_name(entry.get("name"))
        if not name or ".." in name or name.startswith("/"):
            continue
        if entry.get("enabled") is False:
            continue
        try:
            strength = float(entry.get("strength"))
        except (TypeError, ValueError):
            strength = 1.0
        strength = max(-_LORA_LIMIT, min(_LORA_LIMIT, strength))
        if strength == 0:
            continue
        # 目录里找不到就跳过：模型被删/改名时整条工作流不该失败
        if known and name not in known:
            skipped.append(name)
            continue
        items.append((name, strength))
    if skipped:
        print(f"[XXXXXLCat] 画布 LoRA 已跳过（目录里没有）: {', '.join(skipped[:5])}")
    return items


def _looks_like_loader(node):
    class_type = str((node or {}).get("class_type") or "").lower()
    return "loader" in class_type or "checkpoint" in class_type


def _model_root(workflow):
    """MODEL 链的源头节点 id；找不到返回 ""。"""
    sources = []
    for node in workflow.values():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(inputs, dict):
            continue
        for key, value in inputs.items():
            if key == "model" and _is_link(value) and value[0] not in sources:
                sources.append(value[0])

    roots = []
    for node_id in sources:
        node = workflow.get(node_id)
        if not isinstance(node, dict):
            continue
        inputs = node.get("inputs")
        if isinstance(inputs, dict) and _is_link(inputs.get("model")):
            continue  # 中间节点（ModelSampling 之类），继续往上找
        roots.append(node_id)

    if not roots:
        return ""
    # 多个源头时优先真加载器，否则取第一个
    for node_id in roots:
        if _looks_like_loader(workflow.get(node_id)):
            return node_id
    return roots[0]


def _next_node_id(workflow):
    """新节点的 id：现有纯数字 id 的最大值 + 1（"23:1" 这类跳过，不会撞）"""
    biggest = 0
    for node_id in workflow:
        try:
            biggest = max(biggest, int(str(node_id)))
        except (TypeError, ValueError):
            continue
    return biggest + 1


def _inject_loras(workflow, loras):
    """把 LoRA 链插到 MODEL 源头之后，返回真正插入的条数"""
    if not loras or not isinstance(workflow, dict):
        return 0
    root = _model_root(workflow)
    if not root:
        print("[XXXXXLCat] 画布 LoRA：工作流里没有 MODEL 连线，已跳过")
        return 0

    # 先记下要被改接的连线，避免插完再扫时把新链自己的 model 也改掉（会自环）
    targets = []
    for node_id, node in workflow.items():
        inputs = node.get("inputs") if isinstance(node, dict) else None
        if not isinstance(inputs, dict):
            continue
        for key, value in inputs.items():
            if key == "model" and _is_link(value) and value[0] == root:
                targets.append((node_id, key))
    if not targets:
        print("[XXXXXLCat] 画布 LoRA：MODEL 源头没有被任何节点使用，已跳过")
        return 0

    base = _next_node_id(workflow)
    previous = [root, 0]
    for index, (name, strength) in enumerate(loras):
        node_id = str(base + index)
        workflow[node_id] = {
            "class_type": _LORA_CLASS,
            "inputs": {
                "model": previous,
                "lora_name": name,
                "strength_model": strength,
            },
            "_meta": {"title": f"LoRA {index + 1}（画布）"},
        }
        previous = [node_id, 0]

    for node_id, key in targets:
        workflow[node_id]["inputs"][key] = list(previous)
    return len(loras)


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
        _ensure_builtin_workflows()
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
        # 内置工作流的位置由清单决定，不参与用户的拖拽顺序
        order = [
            str(name)
            for name in names
            if str(name) in known and not _is_builtin(str(name))
        ]
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
        # 内置工作流的名字是保留名：不允许用导入 / 保存的方式覆盖它
        if _is_builtin(name):
            return _builtin_readonly(name)
        # 导入时没指定分类就按节点猜一个，用户随后可在「工作流配置」里改
        category = _normalize_category(payload.get("category"))
        if not category:
            category = _detect_workflow_category(workflow)
        _save_workflow(name, workflow)
        _set_workflow_category(name, category)
        return web.json_response({"name": name, "category": category})

    async def set_workflow_category(request):
        """改某个工作流的分类（「工作流配置」右侧的「分类」按钮）"""
        name = _safe_name(request.match_info.get("name", ""))
        if _read_workflow(name) is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        if _is_builtin(name):
            return _builtin_readonly(name)
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        category = _normalize_category(payload.get("category"))
        if not category:
            return web.json_response(
                {"error": "分类只支持：" + "、".join(WORKFLOW_CATEGORIES)},
                status=400,
            )
        _set_workflow_category(name, category)
        return web.json_response(
            {
                "name": name,
                "category": category,
                "workflows": _list_workflows(),
            }
        )

    async def delete_workflow(request):
        name = _safe_name(request.match_info.get("name", ""))
        if _read_workflow(name) is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        if _is_builtin(name):
            return _builtin_readonly(name)
        os.remove(_workflow_path(name))
        _delete_fields(name)
        _set_workflow_category(name, "")
        return web.json_response({"ok": True})

    async def rename_workflow(request):
        """重命名工作流：json 文件、字段配置、排序列表三处一起改

        只改文件名不动内容，所以 mtime 保留、列表里的「更新时间」不变；
        排序表里若已有旧名，就地换成新名（重命名不该把它踢到末尾）。
        """
        old = _safe_name(request.match_info.get("name", ""))
        if _read_workflow(old) is None:
            return web.json_response({"error": "工作流不存在"}, status=404)
        if _is_builtin(old):
            return _builtin_readonly(old)
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)
        new = _safe_name(str(payload.get("name", "") or ""))
        if not new:
            return web.json_response({"error": "缺少新名称"}, status=400)
        if _is_builtin(new):
            return _builtin_readonly(new)
        if new != old:
            if _read_workflow(new) is not None:
                return web.json_response(
                    {"error": f"已有同名工作流「{new}」"}, status=409
                )
            os.replace(_workflow_path(old), _workflow_path(new))
            old_fields = _fields_path(old)
            if os.path.isfile(old_fields):
                os.replace(old_fields, _fields_path(new))
            order = _load_settings().get("workflow_order") or []
            if old in order:
                _save_settings(
                    workflow_order=[new if name == old else name for name in order]
                )
            categories = dict(_load_settings().get("workflow_categories") or {})
            if old in categories:
                categories[new] = categories.pop(old)
                _save_settings(workflow_categories=categories)
        return web.json_response({"name": new, "workflows": _list_workflows()})

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
        # 内置工作流暴露哪些字段是插件定好的，用户改不了
        if _is_builtin(name):
            return _builtin_readonly(name)
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        raw_fields = payload.get("fields")
        fields = _clean_fields(raw_fields, workflow)
        _save_fields(name, fields, _suppressed_nodes(raw_fields))
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

    async def process_audio(request):
        """音频截取 / 变速：FFmpeg 导出 m4a 到 input 目录，返回新文件引用。

        body: {ref: {filename, subfolder, type}, action: "clip"|"speed",
               segments?: [{start,end}], speed?: number}
        """
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        ref = payload.get("ref") or {}
        filename = str(ref.get("filename") or payload.get("filename") or "")
        try:
            src = _resolve_media_path(
                filename, ref.get("subfolder", ""), ref.get("type", "input")
            )
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
        label = ""
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
                if not (0 <= start < end) or not all(map(lambda v: v == v and abs(v) != float("inf"), (start, end))):
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

        out_name = _audio_output_name()
        out_path = os.path.join(_input_dir(), out_name)
        cmd.append(out_path)
        try:
            await _run_media_cmd(cmd)
            if not os.path.isfile(out_path) or os.path.getsize(out_path) < 1024:
                raise RuntimeError("生成的音频文件为空")
        except Exception as exc:
            try:
                if os.path.isfile(out_path):
                    os.remove(out_path)
            except OSError:
                pass
            return web.json_response({"error": f"音频处理失败: {exc}"}, status=500)

        return web.json_response({
            "filename": out_name,
            "name": f"{os.path.splitext(filename)[0]} · {label}.m4a",
            "subfolder": "",
            "type": "input",
            "duration": round(out_duration, 3) if out_duration else None,
        })

    async def process_video(request):
        """视频节点：提取音轨 / 音视分离 / 截取片段 / 截取帧。

        body: {ref: {filename, subfolder, type},
               action: "extractAudio"|"separate"|"trim"|"frame",
               start?, end?, frame?: "current"|"first"|"last", time?}
        返回 {action, files: [{filename, name, subfolder, type, role, duration}]}
        role 告诉前端该建哪种素材节点；一个 action 可能产出多个文件。
        """
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体不是合法 JSON"}, status=400)

        ref = payload.get("ref") or {}
        filename = str(ref.get("filename") or payload.get("filename") or "")
        try:
            src = _resolve_media_path(
                filename, ref.get("subfolder", ""), ref.get("type", "input")
            )
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
        out_dir = _input_dir()
        stem = os.path.splitext(filename)[0]
        made = []

        def add_out(ext, role, label, out_duration=None):
            name = _video_output_name(ext)
            item = {
                "path": os.path.join(out_dir, name),
                "name": name,
                "ext": ext,
                "role": role,
                "label": label,
                "duration": out_duration,
            }
            made.append(item)
            return item["path"]

        cmd = None
        if action in ("extractAudio", "separate"):
            if info is not None and not info["has_audio"]:
                return web.json_response({"error": "该视频没有音轨"}, status=400)
            audio_path = add_out("m4a", "asset-audio", "音轨", duration)
            cmd = base + ["-i", src] + _AUDIO_OUT_ARGS + [audio_path]
            if action == "separate":
                # 一条命令两个输出：第二个输出用 -an 去掉音轨，得到静音视频
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
            # -map 0:a:0? 的问号表示音轨可选：无音轨视频也能截取
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
                # 输入侧 -ss 会丢弃早于 t 的帧，贴着末尾取会「一帧都没有」；
                # 当前帧最多也只能贴到最后一帧之前。
                t = min(t, max(0.0, duration - 0.001))
            png_path = add_out("png", "asset-image", _FRAME_LABELS[which])
            if is_last:
                # 尾帧不能用 -ss duration-ε：最后一帧通常早于那个时间点。
                # 从末尾 1 秒开始逐帧覆盖同一文件，留下的就是真正的最后一帧。
                # 短于 1 秒的视频 -sseof 会从头开始，同样成立。
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
            await _run_media_cmd(cmd, timeout=_VIDEO_PROCESS_TIMEOUT)
            for item in made:
                if not os.path.isfile(item["path"]) or os.path.getsize(item["path"]) < 128:
                    raise RuntimeError("生成的媒体文件为空")
        except Exception as exc:
            _cleanup_outputs(made)
            return web.json_response({"error": f"视频处理失败: {exc}"}, status=500)

        return web.json_response({
            "action": action,
            "files": [
                {
                    "filename": item["name"],
                    "name": f"{stem} · {item['label']}.{item['ext']}",
                    "subfolder": "",
                    "type": "input",
                    "role": item["role"],
                    "duration": round(item["duration"], 3) if item["duration"] else None,
                }
                for item in made
            ],
        })

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
        # 画布「LoRA 栈」节点：把链插到 MODEL 源头之后（UNet / Checkpoint 加载器后面）。
        # 放在参数写入之后：字段配置只覆盖已有节点的字面量，改不到新插的节点。
        lora_count = _inject_loras(workflow, _clean_loras(payload.get("loras")))

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
        return web.json_response({"prompt_id": prompt_id, "loras": lora_count})

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
            web.post(f"{API_PREFIX}/workflows/{{name}}/rename", rename_workflow),
            web.post(f"{API_PREFIX}/workflows/{{name}}/category", set_workflow_category),
            web.get(f"{API_PREFIX}/workflows/{{name}}/fields", get_fields),
            web.put(f"{API_PREFIX}/workflows/{{name}}/fields", save_fields),
            web.post(f"{API_PREFIX}/media", upload_media),
            web.post(f"{API_PREFIX}/audio/process", process_audio),
            web.post(f"{API_PREFIX}/video/process", process_video),
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
