# -*- coding: utf-8 -*-
"""Generate Text 🐈‍⬛ — the official TextGenerate node, with a multi-image socket.

This is the official node, not a lookalike. Same parameters, same defaults, same
sampling sub-panel, same output, same execution chain as
``comfy_extras/nodes_textgen.py``:

    clip.tokenize(prompt, image=..., video=..., audio=..., skip_template=...)
    -> clip.generate(tokens, ...)
    -> clip.decode(ids)

The one difference: where the official node takes a single ``image``, this node
takes the same image slot repeated (``image_0``, ``image_1``, ...), because the
text encoder walks the whole batch anyway — one placeholder group per frame
(``comfy/text_encoders/gemma4.py``) — so several images are read in the *same*
generation with matching settings. Nothing else was widened: ``video`` and
``audio`` stay exactly as the official node has them, including the fact that a
connected video takes precedence over images.

Because a batch has to agree on its size before the encoder sees it, the frames
are put on one shared canvas first — scaled to fit and padded, never stretched
and never enlarged (the same core the other image nodes use). That is internal
behaviour, not a new knob: ``largest`` canvas, mid gray fill, long side capped at
1024, because the encoder shrinks every frame to its own token budget regardless
(roughly an 800x800 equivalent).
"""

import logging

from comfy_api.latest import io

from .image_batch import MAX_IMAGES, batch_slots, image_slots_input

LOG = "[Generate Text]"

# Internal batching defaults — the canvas is a means to an end here, not a knob.
CANVAS_MODE = "largest"
CANVAS_FILL = "gray"
CANVAS_MAX_SIDE = 1024


class XXXXXLCatTextGenerate(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        sampling_options = [
            io.DynamicCombo.Option(
                key="on",
                inputs=[
                    io.Float.Input("temperature", default=0.7, min=0.01, max=2.0, step=0.000001),
                    io.Int.Input("top_k", default=64, min=0, max=1000),
                    io.Float.Input("top_p", default=0.95, min=0.0, max=1.0, step=0.01),
                    io.Float.Input("min_p", default=0.05, min=0.0, max=1.0, step=0.01),
                    io.Float.Input("repetition_penalty", default=1.05, min=0.0, max=5.0, step=0.01),
                    io.Int.Input("seed", default=0, min=0, max=0xffffffffffffffff),
                    io.Float.Input("presence_penalty", optional=True, default=0.0, min=0.0, max=5.0, step=0.01),
                ],
            ),
            io.DynamicCombo.Option(key="off", inputs=[]),
        ]

        return io.Schema(
            node_id="🐈‍⬛TextGenerate",
            display_name="Generate Text 🐈‍⬛",
            category="🐈‍⬛XXXXXLCat/text",
            search_aliases=["LLM", "gemma", "text generate", "multi image", "reference images"],
            description=(
                "The official Generate Text node with a multi-image socket: the same text encoder, "
                "prompt, video, audio, max length, sampling panel and output, but the image slot "
                "accepts several images (image_0, image_1, ...) and the encoder reads all of them in "
                "one pass, since it walks the whole batch anyway. Frames are scaled to fit a shared "
                "canvas and padded, never stretched or enlarged."
            ),
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt", multiline=True, dynamic_prompts=True, default=""),
                image_slots_input(
                    tooltip=(
                        "The image input of the official node, repeatable: connect as many images as "
                        "you need and the encoder reads them in the same generation. Order follows the "
                        "socket number. A video takes precedence over images, exactly as on the "
                        "official node."
                    ),
                    item_tooltip=(
                        "One image per socket; further sockets appear as you connect them. A batch on "
                        f"one socket counts as several images too (up to {MAX_IMAGES})."
                    ),
                    optional=True,
                    min_images=0,
                ),
                io.Image.Input(
                    "video",
                    optional=True,
                    tooltip="Video frames as image batch. Assumed to be 24 FPS; subsampled to 1 FPS internally.",
                ),
                io.Audio.Input("audio", optional=True),
                io.Int.Input("max_length", default=512, min=1, max=32768),
                io.DynamicCombo.Input("sampling_mode", options=sampling_options, display_name="Sampling Mode"),
                io.Boolean.Input(
                    "thinking",
                    optional=True,
                    default=False,
                    tooltip="Operate in thinking mode if the model supports it.",
                ),
                io.Boolean.Input(
                    "use_default_template",
                    optional=True,
                    default=True,
                    tooltip="Use the built in system prompt/template if the model has one.",
                    advanced=True,
                ),
                io.Combo.Input(
                    "mtp",
                    options=["auto", "off", "2", "3", "4", "5"],
                    default="auto",
                    optional=True,
                    tooltip=(
                        "Speculative decoding with the checkpoint's multi-token-prediction head. No effect without MTP weights. auto adapts the draft depth; 2-5 pins it. Sampled output stays correctly distributed but differs from non-MTP output for the same seed."
                    ),
                ),
            ],
            outputs=[
                io.String.Output(display_name="generated_text"),
            ],
        )

    @classmethod
    def execute(
        cls,
        clip,
        prompt,
        max_length,
        sampling_mode,
        images: io.Autogrow.Type = None,
        thinking=False,
        use_default_template=True,
        video=None,
        audio=None,
        mtp="auto",
    ) -> io.NodeOutput:
        mtp = False if mtp == "off" else (True if mtp == "auto" else int(mtp))

        # Several sockets in, one batch out — the only thing that differs from the
        # official node, which receives that batch from a single socket.
        image = batch_slots(images, CANVAS_MODE, CANVAS_FILL, CANVAS_MAX_SIDE, allow_empty=True, log=LOG)
        if video is not None and image is not None:
            logging.warning(
                "%s a video is connected as well, so the encoder reads the video and ignores the "
                "images — same precedence as the official node. Disconnect one of the two.",
                LOG,
            )

        tokens = clip.tokenize(
            prompt,
            image=image,
            skip_template=not use_default_template,
            min_length=1,
            thinking=thinking,
            video=video,
            audio=audio,
        )

        do_sample = sampling_mode.get("sampling_mode") == "on"
        temperature = sampling_mode.get("temperature", 1.0)
        top_k = sampling_mode.get("top_k", 50)
        top_p = sampling_mode.get("top_p", 1.0)
        min_p = sampling_mode.get("min_p", 0.0)
        seed = sampling_mode.get("seed", None)
        repetition_penalty = sampling_mode.get("repetition_penalty", 1.0)
        presence_penalty = sampling_mode.get("presence_penalty", 0.0)

        generated_ids = clip.generate(
            tokens,
            do_sample=do_sample,
            max_length=max_length,
            temperature=temperature,
            top_k=top_k,
            top_p=top_p,
            min_p=min_p,
            repetition_penalty=repetition_penalty,
            presence_penalty=presence_penalty,
            seed=seed,
            mtp=mtp,
        )

        generated_text = clip.decode(generated_ids)

        logging.info(
            "%s %s image(s) in this generation, max_length=%d, sample=%s",
            LOG,
            "no" if image is None else int(image.shape[0]),
            max_length,
            do_sample,
        )
        return io.NodeOutput(generated_text)
