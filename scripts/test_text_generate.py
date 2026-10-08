# -*- coding: utf-8 -*-
"""Verification for Generate Text 🐈‍⬛ — the official TextGenerate node with a
multi-image socket.

Two things are asserted here, and the first one is the point of the node:

1. **Schema parity with the official node** — every input, every default, every
   range, the whole sampling sub-panel and the output are compared field by field
   against ``comfy_extras.nodes_textgen.TextGenerate``. The only tolerated
   differences are the brand on node_id / display_name / category, the repeated
   image socket itself, and the tooltips/aliases/description. A node that grows a
   knob the official node does not have fails this test.
2. **Behaviour** — with the image sockets filled, exactly one generation happens,
   the batch carries every image, and the sampling panel / mtp handling / call
   arguments match what the official node would send.

Run with the ComfyUI (portable) interpreter, from the ComfyUI root:
    ./python_embeded/python.exe <repo>/scripts/test_text_generate.py
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


class FakeRoutes:
    def get(self, path):
        return lambda f: f

    def post(self, path):
        return lambda f: f


import server  # noqa: E402

server.PromptServer.instance = types.SimpleNamespace(routes=FakeRoutes())

spec = importlib.util.spec_from_file_location(
    "xxpkg", os.path.join(REPO, "__init__.py"), submodule_search_locations=[REPO]
)
pkg = importlib.util.module_from_spec(spec)
sys.modules["xxpkg"] = pkg
spec.loader.exec_module(pkg)

NODE = importlib.import_module("xxpkg.nodes.text_generate").XXXXXLCatTextGenerate

from comfy_extras.nodes_textgen import TextGenerate as OfficialTextGenerate  # noqa: E402

OFFICIAL = OfficialTextGenerate.define_schema()
OURS = NODE.define_schema()

# Inputs whose differences are the point of this node, not drift.
REPEATED_IMAGE = "image"
IGNORED_FIELDS = {"tooltip", "id", "display_name"}

failures = []


def check(label, ok, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


def plain(value):
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    return type(value).__name__


def params(input_obj):
    """Everything that decides how one input behaves, minus its label/identity."""
    return {k: plain(v) for k, v in vars(input_obj).items() if k not in IGNORED_FIELDS}


def sub_spec(input_obj):
    return (
        input_obj.id,
        plain(vars(input_obj).get("default")),
        plain(vars(input_obj).get("min")),
        plain(vars(input_obj).get("max")),
        plain(vars(input_obj).get("step")),
        plain(vars(input_obj).get("optional")),
    )


def sampling_panel(dyn_input):
    return [(option.key, [sub_spec(sub) for sub in option.inputs]) for option in dyn_input.options]


print("\n[1] 与官方节点 schema 对齐")
check("输入个数一致", len(OURS.inputs) == len(OFFICIAL.inputs),
      f"{len(OURS.inputs)} vs {len(OFFICIAL.inputs)}")

official_ids = [i.id for i in OFFICIAL.inputs]
our_ids = [i.id for i in OURS.inputs]
expected_ids = list(official_ids)
expected_ids[expected_ids.index(REPEATED_IMAGE)] = "images"
check("输入顺序与编号一致（仅 image -> images）", our_ids == expected_ids, str(our_ids))

diffs = []
for official, ours in zip(OFFICIAL.inputs, OURS.inputs):
    if official.id == REPEATED_IMAGE and ours.id == "images":
        continue
    if params(official) != params(ours):
        diffs.append(f"{official.id}: {params(official)} != {params(ours)}")
check("其余参数逐项相同（默认值/范围/步进/optional/advanced）", not diffs, " | ".join(diffs[:3]))

ours_by_id = {i.id: i for i in OURS.inputs}
official_by_id = {i.id: i for i in OFFICIAL.inputs}
check("采样子面板完全一致（两个 option + 7 个子参数）",
      sampling_panel(ours_by_id["sampling_mode"]) == sampling_panel(official_by_id["sampling_mode"]),
      str(sampling_panel(ours_by_id["sampling_mode"])))

check("输出一致（generated_text）",
      [(type(o).__name__, o.display_name) for o in OURS.outputs]
      == [(type(o).__name__, o.display_name) for o in OFFICIAL.outputs])

ours_images = ours_by_id["images"]
check("images 是多图输入（Autogrow + 模板）",
      type(ours_images).__name__ == "Input" and getattr(ours_images, "template", None) is not None,
      type(ours_images).__name__)
template = getattr(ours_images, "template", None)
check("模板前缀 image_ 且上限 12，最小 0（可留空做纯文本）",
      getattr(template, "prefix", None) == "image_" and getattr(template, "max", None) == 12
      and getattr(template, "min", None) == 0,
      f"prefix={getattr(template, 'prefix', None)} min={getattr(template, 'min', None)} max={getattr(template, 'max', None)}")

extra = [i.id for i in OURS.inputs if i.id not in expected_ids]
check("没有官方之外的任何输入（画布/预算之类一律不许有）", not extra, str(extra))

print("\n[2] 与官方节点执行行为一致")
BATCH = [("image_0", (32, 48, 0.3)), ("image_1", (64, 32, 0.6)), ("image_2", (32, 32, 0.9))]


class FakeClip:
    def __init__(self, text="generated text"):
        self.text = text
        self.tokenize_call = None
        self.generate_call = None
        self.decode_call = None

    def tokenize(self, prompt, **kwargs):
        self.tokenize_call = (prompt, kwargs)
        return "TOKENS"

    def generate(self, tokens, **kwargs):
        self.generate_call = (tokens, kwargs)
        return "IDS"

    def decode(self, ids, skip_special_tokens=True):
        self.decode_call = ids
        return self.text


def frame(height, width, value=1.0, batch=1):
    return torch.full((batch, height, width, 3), value, dtype=torch.float32)


def images(**extra):
    payload = {name: frame(h, w, v) for name, (h, w, v) in BATCH}
    payload.update(extra)
    return payload


def sampling(on=True, **overrides):
    """What the dynamic combo hands to execute."""
    panel = {"sampling_mode": "on" if on else "off"}
    if on:
        panel.update({"temperature": 0.7, "top_k": 64, "top_p": 0.95, "min_p": 0.05, "seed": 0,
                      "repetition_penalty": 1.05, "presence_penalty": 0.0})
    panel.update(overrides)
    return panel


def run(imgs=None, prompt="describe", max_length=512, panel=None, **kwargs):
    clip = FakeClip()
    out = NODE.execute(clip, prompt, max_length, panel if panel is not None else sampling(), images=imgs, **kwargs)
    return clip, out


clip, out = run(images())
prompt_sent, tk = clip.tokenize_call
batch = tk.get("image")
check("三张图 → 一个批次，且只做一次生成",
      batch is not None and batch.shape[0] == 3 and clip.decode_call == "IDS",
      str(None if batch is None else tuple(batch.shape)))
check("各帧统一到同一张画布（最大 高64 x 宽48）", batch is not None and tuple(batch.shape[1:3]) == (64, 48),
      str(None if batch is None else tuple(batch.shape[1:3])))
check("tokenize 参数与官方一致（image/skip_template/min_length/thinking/video/audio）",
      set(tk) == {"image", "skip_template", "min_length", "thinking", "video", "audio"}, str(sorted(tk)))
check("skip_template=False（默认用内置模板）且 min_length=1",
      tk["skip_template"] is False and tk["min_length"] == 1)
check("没有官方之外的额外参数（如 max_soft_tokens）", "max_soft_tokens" not in tk, str(sorted(tk)))
check("prompt 原样传入", prompt_sent == "describe")
check("输出就是 decode 的结果", out.args == ("generated text",), str(out.args))

gen = clip.generate_call[1]
check("generate 参数集合与官方一致",
      set(gen) == {"do_sample", "max_length", "temperature", "top_k", "top_p", "min_p",
                   "repetition_penalty", "presence_penalty", "seed", "mtp"}, str(sorted(gen)))
check("max_length 透传", gen["max_length"] == 512)
clip, _ = run(images(), panel=sampling(temperature=0.31), max_length=64, mtp="off")
gen = clip.generate_call[1]
check("采样面板数值透传", abs(gen["temperature"] - 0.31) < 1e-6 and gen["max_length"] == 64,
      str(gen["temperature"]))
check("采样开 → do_sample=True", gen["do_sample"] is True)
check("mtp=off → False", gen["mtp"] is False)
clip, _ = run(images(), panel=sampling(on=False))
check("采样关 → do_sample=False（与官方一致）", clip.generate_call[1]["do_sample"] is False)
clip, _ = run(images(), thinking=True, use_default_template=False, video="VIDEO", audio="AUDIO")
tk = clip.tokenize_call[1]
check("thinking / use_default_template / video / audio 原样透传",
      tk["thinking"] is True and tk["skip_template"] is True and tk["video"] == "VIDEO" and tk["audio"] == "AUDIO")

print("\n[3] 不接图 = 官方原本的行为")
clip, out = run(None)
check("不接图不报错，且 image 传 None", clip.tokenize_call[1]["image"] is None)
clip, _ = run({"image_0": None})
check("插槽全空同样传 None", clip.tokenize_call[1]["image"] is None)

print("\n[4] 单插槽上的批次也算多图，顺序按编号")
clip, _ = run({"image_0": frame(16, 16, 1.0, batch=2)})
check("一个插槽 batch=2 → 两张", clip.tokenize_call[1]["image"].shape[0] == 2)
clip, _ = run({"image_10": frame(16, 16, 0.2), "image_2": frame(16, 16, 0.5)})
batch = clip.tokenize_call[1]["image"]
check("image_10 排在 image_2 之后",
      abs(float(batch[0, 0, 0, 0]) - 0.5) < 1e-6 and abs(float(batch[1, 0, 0, 0]) - 0.2) < 1e-6,
      f"{round(float(batch[0, 0, 0, 0]), 2)} / {round(float(batch[1, 0, 0, 0]), 2)}")

print()
if failures:
    print(f"{len(failures)} 项未通过：")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("全部通过")
