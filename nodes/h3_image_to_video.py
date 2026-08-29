# -*- coding: utf-8 -*-
"""H3 Image to Video🐈‍⬛ — image/text-to-video conditioning with dual-stage outputs.

Built on the official ``MiniMaxH3ImageToVideo`` conditioning node. Mirrors its
keyframe handling exactly (first/last frame resized + VAE-encoded into
``minimax_keyframes``), but exposes **two independent conditioning outputs** so a
single node drives MiniMax H3's two-stage i2v / refined t2v pipeline:

* ``positive``  — conditioning for the Stage-1 sampler, baked at the Stage-1
  resolution (``width`` / ``height``).
* ``positive2`` — a *separate* conditioning object for the Stage-2 (refine)
  sampler, baked at the Stage-2 resolution (``stage2_width`` / ``stage2_height``).
* ``av_latent`` — the empty joint video+audio latent for Stage-1.

Why two outputs instead of fanning one ``positive`` to two samplers?
The official H3 sampler consumes / mutates the ``minimax_keyframes`` payload
in-place during Stage-1. Feeding the *same* conditioning object to Stage-2
therefore yields a corrupt (keyframe-stripped) condition and the run fails.
i2v additionally needs the Stage-2 keyframes re-encoded at the *upscaled*
resolution so they line up with the latent the Stage-2 sampler actually
denoises. Two independent objects — each freshly built from the same prompt /
first/last frames but at its own resolution — solves both problems with one
node, matching the official "two instance" topology without the extra node.

For text-to-video (no first/last frame) the conditioning carries no resolution
state, so ``positive2`` is a private ``deepcopy`` of ``positive`` and the
``stage2_*`` resolution is irrelevant.

The latent-geometry helpers below mirror the math in ComfyUI's
``comfy_extras/nodes_minimax_h3.py`` so the node stays self-contained and does
not depend on that module's private API.
"""

import copy

import torch

from comfy_api.latest import io

import comfy.model_management
import comfy.nested_tensor
import comfy.utils
import node_helpers


MAX_RESOLUTION = 16384
CANVAS_MULTIPLE = 32
BASE_SHORT_EDGE = 768
MAX_PIXELS = 768 * 1344
FPS = 24
AUDIO_LATENT_FPS = 40


# ─────────────────────────────────────────────────────────────────────────────
# Latent-geometry helpers (self-contained port of H3's frame/latent math)
# ─────────────────────────────────────────────────────────────────────────────

def align_frame_count(n):
    """Snap a frame count up to the model's 17k+5 grid."""
    while n % 17 != 5:
        n += 1
    return n


def av_latent_t(frame_count):
    """Map a frame count to the AV latent's T dimension."""
    return 2 if frame_count <= 5 else ((frame_count - 5) // 17) * 5 + 2


def temporal_shape(length):
    frame_count = align_frame_count(max(5, length))
    duration = frame_count / FPS
    return frame_count, av_latent_t(frame_count), round(duration * AUDIO_LATENT_FPS)


def _resize(image, width, height, crop):
    """Upscale a [B,H,W,C] image to (height,width) with lanczos; returns [B,height,width,3]."""
    samples = image[..., :3].movedim(-1, 1)
    samples = comfy.utils.common_upscale(samples, width, height, "lanczos", crop)
    return samples.movedim(1, -1)


def _empty_av_latent(width, height, length, batch_size=1):
    """Build a fresh zero-filled video+audio latent for Stage-1."""
    frame_count, latent_t, audio_t = temporal_shape(length)
    video = torch.zeros([batch_size, 24, latent_t, height // 16, width // 16],
                        device=comfy.model_management.intermediate_device())
    audio = torch.zeros([batch_size, 32, 2, audio_t],
                        device=comfy.model_management.intermediate_device())
    return {"samples": comfy.nested_tensor.NestedTensor((video, audio))}, frame_count


# ─────────────────────────────────────────────────────────────────────────────
# Node
# ─────────────────────────────────────────────────────────────────────────────

class XXXXXLCatH3ImageToVideo(io.ComfyNode):
    """Image-/text-to-Video conditioning for MiniMax H3 with dual-stage outputs.

    Stage-1 sampler receives ``positive`` + ``av_latent`` (built at
    ``width`` / ``height``). Stage-2 (refine) sampler receives ``positive2``, a
    freshly-built conditioning object baked at ``stage2_width`` / ``stage2_height``
    so its keyframes align with the upscaled latent. Each output is an
    independent object — never share one conditioning across two samplers.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="🐈‍⬛H3ImageToVideo",
            display_name="H3 Image to Video🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/Sampling",
            description=(
                "Image-/text-to-Video conditioning for MiniMax H3 with dual-stage "
                "outputs. Stage-1 uses 'positive' + 'av_latent' built at width/height; "
                "Stage-2 (refine) uses 'positive2', a separate conditioning object "
                "baked at stage2_width/stage2_height so its keyframes line up with the "
                "upscaled latent. For t2v (no keyframes) positive2 is an independent "
                "copy and the stage2 resolution is unused. Do NOT fan a single output "
                "to two samplers — the H3 sampler mutates keyframes in place."
            ),
            inputs=[
                io.Clip.Input("clip", tooltip="MiniMax H3 CLIP (Qwen3-VL text + image encoder)."),
                io.Vae.Input("vae", tooltip="Video VAE used to encode keyframe images."),
                io.String.Input(
                    "prompt",
                    multiline=True,
                    dynamic_prompts=True,
                    tooltip="Text prompt. Reference tags follow the MiniMax H3 convention.",
                ),
                io.Int.Input(
                    "width",
                    default=1344,
                    min=32,
                    max=MAX_RESOLUTION,
                    step=32,
                    tooltip="Stage-1 (sampling) target width.",
                ),
                io.Int.Input(
                    "height",
                    default=768,
                    min=32,
                    max=MAX_RESOLUTION,
                    step=32,
                    tooltip="Stage-1 (sampling) target height.",
                ),
                io.Int.Input(
                    "length",
                    default=124,
                    min=5,
                    max=3600,
                    step=17,
                    tooltip="Frame count at 24 fps, snapped to the model's 17k+5 grid (124 ≈ 5s; trained range ≈ 124-362, longer is untested).",
                ),
                io.Int.Input(
                    "stage2_width",
                    default=1344,
                    min=32,
                    max=MAX_RESOLUTION,
                    step=32,
                    tooltip="Stage-2 (refine) target width. The keyframe condition is re-encoded at this size to match the upscaled latent.",
                ),
                io.Int.Input(
                    "stage2_height",
                    default=768,
                    min=32,
                    max=MAX_RESOLUTION,
                    step=32,
                    tooltip="Stage-2 (refine) target height. Ignored for t2v (no keyframes).",
                ),
                io.Image.Input("first_frame", optional=True, tooltip="Optional start keyframe."),
                io.Image.Input("last_frame", optional=True, tooltip="Optional end keyframe."),
            ],
            outputs=[
                io.Conditioning.Output(display_name="positive"),
                io.Conditioning.Output(display_name="positive2"),
                io.Latent.Output(display_name="av_latent"),
            ],
        )

    @classmethod
    def execute(cls, clip, vae, prompt, width, height, length, stage2_width, stage2_height,
                first_frame=None, last_frame=None):
        # Frame count is resolution-independent (T is preserved through upscale),
        # so both stages share it — derived once from length.
        frame_count, _, _ = temporal_shape(length)

        # Collect keyframe specs once; images are re-resized per stage below.
        keyframes = []
        if first_frame is not None:
            keyframes.append((0, first_frame[:1]))
        if last_frame is not None:
            keyframes.append((frame_count - 1, last_frame[:1]))

        # Stage-1 conditioning + empty latent.
        latent, _ = _empty_av_latent(width, height, length)
        cond1 = cls._build_cond(clip, vae, prompt, keyframes, width, height)

        # Stage-2 conditioning: a separate object.
        #  - i2v: re-encode keyframes at the Stage-2 resolution so they align
        #    with the upscaled latent the Stage-2 sampler denoises.
        #  - t2v: conditioning carries no resolution state, so a private copy
        #    of cond1 is sufficient and stage2_* is unused.
        if keyframes:
            cond2 = cls._build_cond(clip, vae, prompt, keyframes, stage2_width, stage2_height)
        else:
            cond2 = copy.deepcopy(cond1)

        return io.NodeOutput(cond1, cond2, latent)

    @classmethod
    def _build_cond(cls, clip, vae, prompt, keyframes, width, height):
        """Encode prompt (+ keyframe images) into a conditioning object.

        Mirrors the official node: the first frame is plain-stretched
        ("disabled"), later frames are aspect-preserving cover-cropped
        ("center"). Called once per stage with that stage's resolution.
        """
        images = []
        kf_payload = []
        for idx, img in keyframes:
            # official crop rule: first keyframe -> "disabled", others -> "center"
            crop = "disabled" if idx == 0 else "center"
            resized = _resize(img, width, height, crop)
            images.append(resized)
            kf_payload.append({"resolved_frame_index": idx, "image": resized})

        tokens = clip.tokenize(prompt, images=images)
        cond = clip.encode_from_tokens_scheduled(tokens)

        if kf_payload:
            for kf in kf_payload:
                kf["latent"] = vae.encode(kf.pop("image"))
            cond = node_helpers.conditioning_set_values(cond, {"minimax_keyframes": kf_payload})
        return cond
