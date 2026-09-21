# -*- coding: utf-8 -*-
"""Verification for the LoRA stack nodes (nodes/lora_rows.py + both nodes).

Proves the claims that matter:

1. "one clone + N add_patches" produces the *same* patch list as chaining the
   official node (clone + add_patches, N times) — for the model and for the CLIP.
2. Row selection skips empty / off / zero-strength rows, keeps order, and keeps
   negative strengths.
3. The loaded-file cache trims by both file count and total bytes.

Run with the ComfyUI (portable) interpreter, from the ComfyUI root:
    ./python_embeded/python.exe <repo>/scripts/test_lora_stack.py

COMFY_ROOT may be set to point at a different ComfyUI checkout.
"""
import importlib
import importlib.util
import os
import sys
import types

COMFY_ROOT = os.environ.get(
    "COMFY_ROOT", r"E:/ComfyUI_windows_portable_nvidia/ComfyUI_windows_portable/ComfyUI"
)
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, COMFY_ROOT)

import torch  # noqa: E402
import comfy.model_patcher  # noqa: E402


class FakeRoutes:
    def get(self, path):
        return lambda f: f

    def post(self, path):
        return lambda f: f


import server  # noqa: E402

server.PromptServer.instance = types.SimpleNamespace(routes=FakeRoutes())

# Import the real package (not the file) so the nodes' relative imports resolve
# exactly as they do inside ComfyUI.
spec = importlib.util.spec_from_file_location(
    "xxpkg", os.path.join(REPO, "__init__.py"), submodule_search_locations=[REPO]
)
pkg = importlib.util.module_from_spec(spec)
sys.modules["xxpkg"] = pkg
spec.loader.exec_module(pkg)

rows_mod = importlib.import_module("xxpkg.nodes.lora_rows")
stack = importlib.import_module("xxpkg.nodes.lora_stack")
clip_stack = importlib.import_module("xxpkg.nodes.lora_stack_clip")

# The row shapes each node declares (must match ROW_FIELDS in the node modules).
MODEL_FIELDS = (rows_mod.FIELD_LORA, "strength", rows_mod.FIELD_ON)
CLIP_FIELDS = (rows_mod.FIELD_LORA, "strength_model", "strength_clip", rows_mod.FIELD_ON)

failures = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{(' — ' + detail) if detail else ''}")
    if not ok:
        failures.append(name)


# ── 0. both nodes register ───────────────────────────────────────────────────
print("\n[0] 节点注册")

import asyncio  # noqa: E402

ext = asyncio.run(pkg.comfy_entrypoint())
schemas = {N.define_schema().node_id: N.define_schema() for N in asyncio.run(ext.get_node_list())}
check("两个 LoRA 堆叠节点都在注册表里",
      "🐈‍⬛StackLoras" in schemas and "🐈‍⬛StackLorasClip" in schemas,
      f"{len(schemas)} 个节点")
check("仅模型版只有 MODEL 输出",
      [o.io_type for o in schemas["🐈‍⬛StackLoras"].outputs] == ["MODEL"])
check("含 CLIP 版输出 MODEL + CLIP",
      [o.io_type for o in schemas["🐈‍⬛StackLorasClip"].outputs] == ["MODEL", "CLIP"])
check("含 CLIP 版有 clip 输入",
      [i.id for i in schemas["🐈‍⬛StackLorasClip"].inputs][:2] == ["model", "clip"])
model_row_ids = [i.id for i in schemas["🐈‍⬛StackLoras"].inputs if i.id != "model"]
clip_row_ids = [i.id for i in schemas["🐈‍⬛StackLorasClip"].inputs if i.id not in ("model", "clip")]
check("仅模型版每行 3 个控件", model_row_ids[:3] == ["lora_01", "strength_01", "on_01"], str(model_row_ids[:3]))
check("含 CLIP 版每行 4 个控件（模型强度 + CLIP 强度）",
      clip_row_ids[:4] == ["lora_01", "strength_model_01", "strength_clip_01", "on_01"], str(clip_row_ids[:4]))
check("含 CLIP 版共 12 行 × 4",
      len(clip_row_ids) == 48 and len(model_row_ids) == 36, f"{len(clip_row_ids)} / {len(model_row_ids)}")


# ── 1. row selection ─────────────────────────────────────────────────────────
print("\n[1] 行选择逻辑（共用引擎）")

values = {"lora_01": "a.safetensors", "strength_01": 0.8, "on_01": True}
values.update({"lora_02": "b.safetensors", "strength_02": 0.5, "on_02": False})
values.update({"lora_03": "c.safetensors", "strength_03": 0.0, "on_03": True})
values.update({"lora_04": "None", "strength_04": 1.0, "on_04": True})
values.update({"lora_05": "d.safetensors", "strength_05": -0.4, "on_05": True})
values.update({"lora_06": "e.safetensors", "strength_06": "oops", "on_06": True})
values.update({"lora_11": "f.safetensors", "strength_11": 1.5, "on_11": True})

rows = rows_mod.active_rows(values, "[test]", MODEL_FIELDS)
check("顺序保持且只留生效行", rows == [
    ("01", "a.safetensors", {"strength": 0.8}),
    ("05", "d.safetensors", {"strength": -0.4}),
    ("11", "f.safetensors", {"strength": 1.5}),
], repr(rows))
check("空值 / 关闭 / 0 强度 / 非数字强度被跳过", len(rows) == 3)
check("全空时无行", rows_mod.active_rows({}, "[test]", MODEL_FIELDS) == [])
check("缺 on 字段默认开启", rows_mod.active_rows(
    {"lora_01": "x.safetensors", "strength_01": 1.0}, "[test]", MODEL_FIELDS) ==
    [("01", "x.safetensors", {"strength": 1.0})])

# Two strengths: one may be 0 (that side is simply not patched), and the row is
# only dropped when *every* strength on it is 0 — same rule as the official node.
clip_values = {"lora_01": "a.safetensors", "strength_model_01": 0.8, "strength_clip_01": 0.0, "on_01": True}
clip_values.update({"lora_02": "b.safetensors", "strength_model_02": 0.0, "strength_clip_02": 0.5, "on_02": True})
clip_values.update({"lora_03": "c.safetensors", "strength_model_03": 0.0, "strength_clip_03": 0.0, "on_03": True})
clip_rows = rows_mod.active_rows(clip_values, "[test]", CLIP_FIELDS)
check("两列强度都带出来", clip_rows == [
    ("01", "a.safetensors", {"strength_model": 0.8, "strength_clip": 0.0}),
    ("02", "b.safetensors", {"strength_model": 0.0, "strength_clip": 0.5}),
], repr(clip_rows))
check("只有两侧都为 0 的行被跳过", len(clip_rows) == 2)
check("强度字段名由 fields 决定（同一份数据两套读法不串）",
      rows_mod.strength_fields(CLIP_FIELDS) == ["strength_model", "strength_clip"] and
      rows_mod.strength_fields(MODEL_FIELDS) == ["strength"])


# ── 2. patch equivalence ─────────────────────────────────────────────────────
print("\n[2] 一次克隆 + N 次补丁 == 串联克隆")


class FakeModel(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.layer = torch.nn.Parameter(torch.zeros(4))


def new_patcher():
    model = FakeModel()
    return comfy.model_patcher.ModelPatcher(
        model, load_device=torch.device("cpu"), offload_device=torch.device("cpu")
    )


def patch_for(tag):
    # add_patches only needs the key to exist in the model's state_dict; the
    # payload itself is opaque to it, so a marker tuple is enough here.
    return {"layer": (tag, torch.ones(4))}


STRENGTHS = [("A", 0.8), ("B", 0.5), ("C", -0.4)]


def depth(patcher):
    n = 0
    while getattr(patcher, "parent", None) is not None:
        n += 1
        patcher = patcher.parent
    return n


def tags_and_strengths(patcher):
    return [(x[1][0], x[0]) for x in patcher.patches["layer"]]


# chained: what N official nodes do — one clone (and one patch) per LoRA
chained_model, chained_clip = new_patcher(), new_patcher()
for tag, strength in STRENGTHS:
    chained_model = chained_model.clone()
    chained_model.add_patches(patch_for(tag), strength)
    chained_clip = chained_clip.clone()
    chained_clip.add_patches(patch_for(tag), strength)

# stacked: one clone each, then one add_patches per row on both sides
stacked_model, stacked_clip = new_patcher().clone(), new_patcher().clone()
applied_model, applied_clip = [], []
for tag, strength in STRENGTHS:
    applied_model.append(stacked_model.add_patches(patch_for(tag), strength))
    applied_clip.append(stacked_clip.add_patches(patch_for(tag), strength))

expected = [(tag, strength) for tag, strength in STRENGTHS]
check("模型侧补丁条数/顺序/强度一致",
      tags_and_strengths(chained_model) == tags_and_strengths(stacked_model) == expected,
      f"{tags_and_strengths(chained_model)} vs {tags_and_strengths(stacked_model)}")
check("CLIP 侧补丁条数/顺序/强度一致",
      tags_and_strengths(chained_clip) == tags_and_strengths(stacked_clip) == expected,
      f"{tags_and_strengths(chained_clip)} vs {tags_and_strengths(stacked_clip)}")
check("add_patches 返回命中键（用于每行诊断）",
      all(r == ["layer"] for r in applied_model + applied_clip))
check("克隆层数：串联 3 层 / 本节点 1 层（两侧一致）",
      depth(chained_model) == 3 and depth(stacked_model) == 1 and
      depth(chained_clip) == 3 and depth(stacked_clip) == 1,
      f"model {depth(chained_model)}→{depth(stacked_model)}, clip {depth(chained_clip)}→{depth(stacked_clip)}")


# ── 3. cache eviction ────────────────────────────────────────────────────────
print("\n[3] 缓存上限（两节点共用同一份缓存）")

cache = rows_mod._CACHE
cache.clear()
MB = 1024 * 1024
for i in range(5):
    cache[f"p{i}"] = ((i, i), {}, None, 100 * MB)
rows_mod._evict()
check("按文件数裁剪到上限", len(cache) == rows_mod._CACHE_MAX_FILES, f"留下 {len(cache)}")
check("保留最近使用的条目", list(cache) == ["p2", "p3", "p4"], repr(list(cache)))

cache.clear()
cache["big"] = ((1, 1), {}, None, 700 * MB)
cache["small"] = ((2, 2), {}, None, 10 * MB)
rows_mod._evict()
check("超字节上限时裁掉最旧（至少保留一个）", list(cache) == ["small"], repr(list(cache)))
cache.clear()

check("两个节点模块引用的是同一个缓存对象",
      stack.resolve_row_lora.__module__ == clip_stack.resolve_row_lora.__module__ == "xxpkg.nodes.lora_rows")


print()
if failures:
    print(f"失败 {len(failures)} 项: {failures}")
    sys.exit(1)
print("全部通过")
