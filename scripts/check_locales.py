# -*- coding: utf-8 -*-
"""Validate locales/<lang>/nodeDefs.json against the live backend schemas.

Checks:
  * every node id has an entry, and no entry is orphaned
  * every input id and output index is covered
  * display_name / description / slot name / slot tooltip are all strings

Run with the ComfyUI (portable) interpreter, from the ComfyUI root:
    ./python_embeded/python.exe <repo>/scripts/check_locales.py
"""
import asyncio
import importlib.util
import json
import os
import sys
import types

PKG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMFY_ROOT = os.environ.get("COMFY_ROOT", r"E:/ComfyUI_windows_portable_nvidia/ComfyUI_windows_portable/ComfyUI")
DEPLOYED = os.path.join(COMFY_ROOT, "custom_nodes", "ComfyUI-XXXXXLCatNodes")

sys.path.insert(0, COMFY_ROOT)

import server  # noqa: E402


class FakeRoutes:
    def get(self, p):
        return lambda f: f

    def post(self, p):
        return lambda f: f


server.PromptServer.instance = types.SimpleNamespace(routes=FakeRoutes())

spec = importlib.util.spec_from_file_location(
    "xxpkg", os.path.join(DEPLOYED, "__init__.py"), submodule_search_locations=[DEPLOYED]
)
m = importlib.util.module_from_spec(spec)
sys.modules["xxpkg"] = m
spec.loader.exec_module(m)

ext = asyncio.run(m.comfy_entrypoint())
schemas = [N.define_schema() for N in asyncio.run(ext.get_node_list())]


def collect_input_ids(schema):
    """Top-level inputs plus any DynamicCombo sub-inputs (regular Combo options
    are plain strings, so they are skipped automatically)."""
    ids = set()
    for i in schema.inputs or []:
        ids.add(i.id)
        for opt in getattr(i, "options", None) or []:
            sub_inputs = getattr(opt, "inputs", None)
            if sub_inputs:
                for sub in sub_inputs:
                    ids.add(sub.id)
    return ids


problems = []
locales_dir = os.path.join(PKG_ROOT, "locales")
langs = sorted(d for d in os.listdir(locales_dir) if os.path.isdir(os.path.join(locales_dir, d)))

for lang in langs:
    path = os.path.join(locales_dir, lang, "nodeDefs.json")
    if not os.path.exists(path):
        problems.append(f"[{lang}] nodeDefs.json 缺失")
        continue
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    have = set(data)
    want = {s.node_id for s in schemas}
    for k in sorted(want - have):
        problems.append(f"[{lang}] 缺少节点条目: {k!r}")
    for k in sorted(have - want):
        problems.append(f"[{lang}] 多余节点条目: {k!r}")

    for s in schemas:
        entry = data.get(s.node_id)
        if not entry:
            continue
        if not isinstance(entry.get("display_name"), str) or not entry["display_name"]:
            problems.append(f"[{lang}] {s.node_id}: display_name 无效")
        if not isinstance(entry.get("description"), str) or not entry["description"]:
            problems.append(f"[{lang}] {s.node_id}: description 无效")

        ins = entry.get("inputs") or {}
        input_ids = collect_input_ids(s)
        for iid in input_ids:
            slot = ins.get(iid)
            if slot is None:
                problems.append(f"[{lang}] {s.node_id}: 缺少输入 {iid!r}")
                continue
            if not isinstance(slot.get("name"), str) or not slot["name"]:
                problems.append(f"[{lang}] {s.node_id}.{iid}: name 无效")
            if not isinstance(slot.get("tooltip"), str) or not slot["tooltip"]:
                problems.append(f"[{lang}] {s.node_id}.{iid}: tooltip 无效")
        for extra in set(ins) - input_ids:
            problems.append(f"[{lang}] {s.node_id}: 多余输入 {extra!r}")

        outs = entry.get("outputs") or {}
        for idx in range(len(s.outputs or [])):
            slot = outs.get(str(idx))
            if slot is None:
                problems.append(f"[{lang}] {s.node_id}: 缺少输出 {idx}")
                continue
            if not isinstance(slot.get("name"), str) or not slot["name"]:
                problems.append(f"[{lang}] {s.node_id}.out[{idx}]: name 无效")
            if not isinstance(slot.get("tooltip"), str) or not slot["tooltip"]:
                problems.append(f"[{lang}] {s.node_id}.out[{idx}]: tooltip 无效")
        for extra in set(outs) - {str(i) for i in range(len(s.outputs or []))}:
            problems.append(f"[{lang}] {s.node_id}: 多余输出 {extra!r}")

    print(f"[{lang}] 校验完成：{len(data)} 个节点条目")

if problems:
    print(f"\n发现 {len(problems)} 个问题：")
    for p in problems:
        print("  -", p)
    sys.exit(1)

print(f"\n全部通过（{len(langs)} 种语言：{', '.join(langs)}）")
