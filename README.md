# ComfyUI-XXXXXLCatNodes

<p align="center"><a href="README_CN.md">🇨🇳 中文</a> ·<strong>🇺🇸 English</strong></p>

Lightweight ComfyUI custom nodes for system telemetry and resource reclamation, plus MiniMax H3 image/text-to-video conditioning.

## Features

- Menu-bar live monitor with 5 metrics (CPU / RAM / GPU / VRAM / temperature), refreshing every 0.5s; one-tap **Release VRAM** and **Reclaim RAM** buttons
- Two on-demand memory tools — `Purr VRAM🐈‍⬛` (unload models + clear CUDA cache, optional forced GC) and `Tidy RAM🐈‍⬛` (reclaim file cache / working sets / own DLLs, with dry-run)
- `Meow Stats🐈‍⬛` exposes live telemetry as node outputs
- MiniMax H3 sampling helper: `H3 Image to Video🐈‍⬛`
- Zero third-party dependencies (ctypes + `nvidia-smi` subprocess)

## Node reference

### Purr VRAM🐈‍⬛
**Principle:** frees VRAM inside the ComfyUI process — unloads loaded models and clears the CUDA cache; enabling **Force GC** triggers an extra Python garbage collection plus a CUDA synchronize to squeeze out lingering allocations. A `report` STRING output prints how many MB were freed.
**Usage:** drop it anywhere (it takes no model input); check the cleanups you want and flip **Force GC** for an extra squeeze. The `report` string can feed a downstream log or display.

### Tidy RAM🐈‍⬛
**Principle:** reclaims system physical memory — clears the system file cache, trims other processes' working sets, and trims the node's own DLLs; a retry count repeats the attempt, and **Dry Run** reports the current memory baseline without actually trimming. A `report` STRING prints the freed RAM.
**Usage:** turn on **Dry Run** first to see the baseline, then disable it for the real reclaim; file-cache trimming needs administrator privileges and is skipped silently on failure.

### Meow Stats🐈‍⬛
**Principle:** a background thread samples CPU / RAM / GPU / VRAM / temperature every 0.5s and exposes them through a route; this node surfaces those live values as outputs for the workflow.
**Usage:** connect it to any downstream node that needs real-time metrics (or a display component); it has no inputs — its outputs are the live telemetry.

### H3 Image to Video🐈‍⬛
**Principle:** builds MiniMax H3 image/text-to-video conditioning. Because the H3 sampler mutates keyframes in place, it emits **two independent conditioning objects** — `positive` (stage 1, baked at the target width/height) and `positive2` (stage-2 refine, baked at stage2_width/stage2_height) — plus an empty `av_latent`, so the two stages never share and corrupt each other's state.
**Usage:** fill the prompt and optional first/last keyframes; wire `positive` to the stage-1 sampler, `positive2` to the stage-2 refine sampler, and `av_latent` to the sampler. t2v (no keyframes) ignores the stage-2 resolution.

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
    │   ├── system_monitor.py
    │   └── h3_image_to_video.py
    ├── pyproject.toml   # node metadata (recognized by ComfyUI-Manager)
    └── web/
        └── monitor.js   # menu-bar injection renderer + cleanup buttons (auto-loaded by ComfyUI)
```

## Data

- CPU% / RAM / GPU utilization / VRAM / temperature, sampled by a background thread every 0.5s and cached
- GPU / VRAM / temperature show `N/A` when no NVIDIA GPU is present
- Hovering a metric reveals details (used/total, VRAM session peak `Max`)

## Notes

- All four nodes are implemented on the new **V3 node API** (`comfy_api` / `io.ComfyNode`) and registered through `comfy_entrypoint()` (the same pattern as the official MiniMax H3 nodes). A recent ComfyUI that ships `comfy_api` is required — older builds without it will fail to load the package.
- The cleanup buttons run inside the ComfyUI process via `/prompt`, so the effect is immediate (not a deferred flag)
- Trimming the system file cache for memory cleanup requires administrator privileges; on failure it is silently skipped without affecting the rest of the cleanup

## Uninstall

Delete the `custom_nodes/ComfyUI-XXXXXLCatNodes/` folder and restart ComfyUI.
