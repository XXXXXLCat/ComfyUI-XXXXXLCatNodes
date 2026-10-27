# ComfyUI-XXXXXLCatNodes

<p align="center"><a href="README_CN.md">🇨🇳 中文</a> ·<strong>🇺🇸 English</strong></p>

Lightweight ComfyUI custom nodes for system telemetry and resource reclamation, plus MiniMax H3 image/text-to-video conditioning and multi-LoRA stacking in one node.

## Features

- Menu-bar live monitor with 5 metrics (CPU / RAM / GPU / VRAM / temperature), refreshing every 0.5s; one-tap **VRAM Cleanup** and **RAM Cleanup** buttons
- Two on-demand memory tools — `Sweep VRAM 🐈‍⬛` (unload models + clear CUDA cache, optional forced GC) and `Reclaim RAM 🐈‍⬛` (reclaim file cache / working sets / own DLLs, with dry-run)
- MiniMax H3 sampling helper: `H3 Image to Video 🐈‍⬛`
- `Any Switch 🐈‍⬛`: a 9-way any-type router that forwards the single populated input and errors if zero or more than one branch runs — switch branches upstream, no rewiring
- Canvas switches: `Group Control 🐈‍⬛` (open/close whole canvas groups) and `Node Control 🐈‍⬛` (open/close individual nodes) — one row and one switch each, filterable by colour and name keyword
- `Load LoRA Stack 🐈‍⬛`: stack several LoRAs on one model in a single node — one row per LoRA with its own strength and on/off switch, applied top to bottom; one model clone instead of N, off or empty rows are never read, and every row reports how many of its keys matched the model
- `Load LoRA Stack (Model and CLIP) 🐈‍⬛`: the same stack, but each row also patches the CLIP — style LoRAs need the text encoder to see them too; each row carries its own model strength and CLIP strength, a side at 0 is not patched at all, and again one clone each
- `Resolution Selector 🐈‍⬛`: the official resolution node with a **2-decimal megapixel step** and a **Custom aspect-ratio mode** — choose an aspect ratio and a megapixel target to get width/height, or pick `Custom` to enter explicit width/height; the target steps by 0.01 (two decimals) instead of the official node's 0.1; the megapixel input is hidden in Custom mode; same aspect ratios, live resolution preview, and nearest-multiple rounding
- Zero third-party dependencies (ctypes + `nvidia-smi` subprocess)
- Node names, descriptions and widget labels follow the ComfyUI interface language via `locales/zh` and `locales/en`

## Node reference

### Sweep VRAM 🐈‍⬛
**Principle:** frees VRAM inside the ComfyUI process — unloads loaded models and clears the CUDA cache; enabling **Force GC** triggers an extra Python garbage collection plus a CUDA synchronize to squeeze out lingering allocations. A `report` STRING output prints how many MB were freed.
**Usage:** drop it anywhere (it takes no model input); check the cleanups you want and flip **Force GC** for an extra squeeze. The `report` string can feed a downstream log or display.

### Reclaim RAM 🐈‍⬛
**Principle:** reclaims system physical memory — clears the system file cache, trims other processes' working sets, and trims the node's own DLLs; a retry count repeats the attempt, and **Dry Run** reports the current memory baseline without actually trimming. A `report` STRING prints the freed RAM.
**Usage:** turn on **Dry Run** first to see the baseline, then disable it for the real reclaim; file-cache trimming needs administrator privileges and is skipped silently on failure.

### H3 Image to Video 🐈‍⬛
**Principle:** builds MiniMax H3 image/text-to-video conditioning. Because the H3 sampler mutates keyframes in place, it emits **two independent conditioning objects** — `positive` (stage 1, baked at the target width/height) and `positive2` (stage-2 refine, baked at stage2_width/stage2_height) — plus an empty `av_latent`, so the two stages never share and corrupt each other's state.
**Usage:** fill the prompt and optional first/last keyframes; wire `positive` to the stage-1 sampler, `positive2` to the stage-2 refine sampler, and `av_latent` to the sampler. t2v (no keyframes) ignores the stage-2 resolution.

### Any Switch 🐈‍⬛
**Principle:** a generic single-active-input switch for any data type. It exposes up to nine any-type inputs; the **first connection decides the node's type**, and the front end then locks every other port to that same type and labels each port (and the output) with the type name and slot index (e.g. `LATENT_01`), so the node visibly shows what it switches. Ports grow automatically as you connect (two by default, one extra empty slot each time, up to nine).
**Usage:** wire several branch outputs in at once; only the branch that actually ran produces a value. At runtime the node forwards that one input and raises an error if zero or more than one input is populated. Pick the active branch by running it upstream — no rewiring, no toggle.

### Group Control 🐈‍⬛
**Principle:** a front-end panel that flips whole canvas groups. Every group that owns at least one node becomes a row with its name and one switch; the list can be narrowed by group colour and by name keyword (several keywords, comma separated, any one of them matches) and ordered by name or canvas position. A mode decides how the switches interact — free control, always exactly one open, or at most one open — and closing a group either bypasses or mutes every node inside it, sub-groups included.
**Usage:** drop it anywhere; the `signal` input is a pure pass-through so it can sit inside an execution chain. Open the settings from the ⚙ button or the node's right-click menu. The canvas is the single source of truth — the panel mirrors whatever the nodes are already doing instead of fighting it.

### Node Control 🐈‍⬛
**Principle:** the same panel pointed one level down, so each row is a single canvas node rather than a group. Keywords match the node title **or its type**, multiple keywords are OR'ed, and a node that was never coloured inherits its group's colour, so a colour filter still gathers everything inside a coloured group. Notes, reroutes, primitives and the control node itself are never listed.
**Usage:** use it for the handful of nodes that never made it into a group — type `KSampler, 采样` in the settings to keep only those rows, then flip them as one. Same three modes and the same bypass/mute choice as Group Control; the panel width you drag out is remembered in the workflow.

### Load LoRA Stack 🐈‍⬛
**Principle:** folds a chain of `Lora Loader (Model Only)` nodes into one node — one row per LoRA with its own strength and switch, applied top to bottom. The result is identical to chaining the official node (patches land in the same per-layer key list, in the same order), but the model is cloned **once** instead of once per LoRA; a row that is off, empty or at strength 0 is neither read from disk nor patched; loaded files are cached by path + mtime so a re-run does not re-read them; and every row reports how many of its keys matched the model, so a LoRA that does nothing on this checkpoint becomes visible instead of silent.
**Usage:** `model` in, `model` out — model only, no CLIP. Four rows are shown by default; **Add LoRA** appends an empty row, and **Remove empty rows** clears every row that holds no LoRA at once — the kept rows close up in the same order, each bringing its own strength and switch along; with nothing selected at all a single row is left. Up to twelve rows. Unused high rows are hidden, but a row that already holds a LoRA is never hidden, so a LoRA you cannot see is never applied. To park a row, just switch it off.

### Load LoRA Stack (Model and CLIP) 🐈‍⬛

### Resolution Selector 🐈‍⬛
**This is the official node, with three tweaks.** Same aspect ratios, same live resolution preview, same nearest-multiple rounding, same integer width/height outputs as `comfy_extras/nodes_resolution.py`. Differences: (1) the `megapixels` target steps by **0.01** (two decimal places) instead of the official node's 0.1, so you can dial in a resolution like 1.05 MP rather than being limited to one decimal; (2) the aspect-ratio selector adds a **Custom** option — choosing it reveals explicit **Width** / **Height** fields (rounded to the nearest `multiple`) instead of deriving size from megapixels; (3) the `megapixels` input is **hidden while `Custom` is selected**, because it has no effect on the result in that mode.
**The preview is the official one, and it works in Custom mode too.** The built-in preview can only turn (ratio, megapixels, multiple) into a size, and "Custom" is not a ratio, so on its own it would show a dash there. `web/resolution_selector.js` keeps two hidden internal inputs filled with the effective ratio and megapixel target of whatever the node is doing; in Custom mode those become `width:height` and `width*height/1048576`, which makes the preview's own scale factor exactly 1 so it reproduces the node's rounding to the nearest multiple.
**Usage:** pick an aspect ratio (or `Custom`), then set the target megapixels — or, for `Custom`, the explicit width/height. The preview shows the resulting width/height rounded to the nearest `multiple` (default 8). Raise `multiple` for latent sizes that must be divisible by larger powers of two.

## Installation

Copy the entire `ComfyUI-XXXXXLCatNodes` folder into `ComfyUI/custom_nodes/`, then restart ComfyUI.

```
ComfyUI/custom_nodes/
└── ComfyUI-XXXXXLCatNodes/
    ├── __init__.py      # entry point: banner + node mappings + load log
    ├── infra.py         # shared AnyType passthrough + change ticker
    ├── sensors.py       # Windows ctypes samplers (CPU/RAM/disk/GPU)
    ├── telemetry.py     # sampling thread + cache + GET /xxxxxlcat-monitor route
    ├── reclamation.py   # VRAM sweep + RAM trimming engine
    ├── nodes/           # one module per node
    │   ├── vram_sweep.py
    │   ├── ram_reclaim.py
    │   ├── h3_image_to_video.py
    │   ├── any_switch.py
    │   ├── group_control.py
    │   ├── node_control.py
    │   └── resolution_selector.py  # official Resolution Selector: 0.01 MP step + Custom size mode
    │   ├── lora_rows.py       # row engine shared by both LoRA stacks (schema / rows / file cache)
    │   ├── lora_stack.py      # model only
    │   └── lora_stack_clip.py  # model + CLIP
    ├── locales/         # front-end strings, served through the core /i18n route
    │   ├── en/nodeDefs.json
    │   └── zh/nodeDefs.json
    ├── scripts/
    │   ├── check_locales.py        # validates locales against the live node schemas
    │   ├── test_lora_stack.py      # both stacks, backend: equivalence (both sides) + rows + cache
    │   ├── test_lora_stack_ui.mjs  # both stacks, front end: add / collapse / hide / height
    ├── pyproject.toml   # node metadata (recognized by ComfyUI-Manager)
    └── web/
        ├── monitor.js        # menu-bar telemetry strip + cleanup buttons (auto-loaded by ComfyUI)
        ├── group_control.js  # panel for Group Control 🐈‍⬛
        ├── node_control.js   # panel for Node Control 🐈‍⬛
        ├── lora_rows.js      # row engine shared by both LoRA stacks
        ├── lora_stack.js     # model-only stack: registers with the shared engine
        ├── lora_stack_clip.js# model + CLIP stack: registers with the shared engine
        ├── any_switch.js     # dynamic ports for Any Switch 🐈‍⬛
        └── resolution_selector.js  # hides megapixels in Custom mode, feeds the built-in preview
```

## Data

- CPU% / RAM / GPU utilization / VRAM / temperature, sampled by a background thread every 0.5s and cached
- GPU / VRAM / temperature show `N/A` when no NVIDIA GPU is present
- Hovering a metric reveals details (used/total, VRAM session peak `Max`)

## Notes

- All nine nodes are implemented on the new **V3 node API** (`comfy_api` / `io.ComfyNode`) and registered through `comfy_entrypoint()` (the same pattern as the official MiniMax H3 nodes). A recent ComfyUI that ships `comfy_api` is required — older builds without it will fail to load the package.
- The cleanup buttons run inside the ComfyUI process via `/prompt`, so the effect is immediate (not a deferred flag)
- Trimming the system file cache for memory cleanup requires administrator privileges; on failure it is silently skipped without affecting the rest of the cleanup

## Uninstall

Delete the `custom_nodes/ComfyUI-XXXXXLCatNodes/` folder and restart ComfyUI.
