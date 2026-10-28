# ComfyUI-XXXXXLCatNodes

<p align="center"><a href="README_CN.md">🇨🇳 中文</a> ·<strong>🇺🇸 English</strong></p>

A small set of ComfyUI custom nodes, plus a menu-bar monitor interface feature.

## Nodes

| Node | What it does |
| --- | --- |
| Sweep VRAM 🐈‍⬛ | Unloads loaded models and clears the CUDA cache, with an optional **Force GC** for one extra squeeze; `report` prints how many MB were freed |
| Reclaim RAM 🐈‍⬛ | Reclaims system memory: clears the file cache, trims other processes' working sets and its own DLLs. Retry count and **Dry Run** (baseline only) available; `report` prints the freed RAM |
| H3 Image to Video 🐈‍⬛ | Builds MiniMax H3 image/text-to-video conditioning: two independent conditionings (stage 1 at target size, stage 2 at the upscaled size) plus an empty `av_latent`, so the two stages never corrupt each other |
| Any Switch 🐈‍⬛ | Nine-way single-active switch for any type. The first connection fixes the type and every other port is locked and labelled with type + index; at runtime it forwards the one populated input and errors if zero or several are populated |
| Group Control 🐈‍⬛ | Switches whole canvas **groups** on and off: one row and one switch per group, filterable by colour and group-name keyword, with free / exactly-one-open / at-most-one-open modes. Closing a group bypasses or mutes every node inside it, sub-groups included |
| Node Control 🐈‍⬛ | The same panel one level down, one row per **node**; keywords match the title or the type, and an uncoloured node inherits its group's colour |
| Resolution Selector 🐈‍⬛ | The official resolution node with two changes: a 0.01 megapixel step (official is 0.1) and a **Custom** aspect ratio that takes explicit width/height |

## Interface

- **Menu-bar monitor**: CPU / RAM / GPU utilization / VRAM / temperature, refreshed every 0.5s, with one-tap **VRAM Cleanup** and **RAM Cleanup** buttons on the left. Hovering shows used/total and the VRAM session peak.
- **History Gallery** (sidebar tab, sits above *Assets*): every file that already lives in the account's `output/` and `input/` trees — not just what this browser session produced. Split into **已生成 / 已导入** tabs, filterable by **All / Images / Videos / Audio / Other**, in **list / grid (small) / grid (large)** view. Cards, hover controls, marquee selection and the floating selection bar follow the native media-asset panel; each file offers **inspect / insert as node / download / delete**, where delete removes it from disk after a confirmation dialog. *Insert as node* stages the file where the core loaders can read it (hard-linked into `input/`, no duplicated bytes), then drops a `LoadImage` / `LoadVideo` / `LoadAudio` node at the viewport centre with the filename already filled in.

## Multi-user asset isolation

Activated automatically when ComfyUI is launched with `--multi-user` (no effect and no nodes added in single-user mode):

- `input/` and `output/` are split per user into `input/<user>/` and `output/<user>/`; each user's uploads and generated files are mutually invisible.
- Login uses ComfyUI's native "select user" flow — **no password** required.
- History (`/history`), queue (`/queue`), jobs (`/jobs`) and the prompt cache are all isolated per user, so nothing leaks between accounts.
- The legacy global `input/` and `output/` are **not visible** to any user (only internal system operations fall back to the global directories).

## Installation

Copy the whole `ComfyUI-XXXXXLCatNodes` folder into `ComfyUI/custom_nodes/` and restart ComfyUI. The interface features need no node added to the graph.

## Requirements

- A recent ComfyUI that ships `comfy_api` (the nodes use the V3 node API).
- Zero third-party dependencies.
- System monitoring uses Windows ctypes; without an NVIDIA GPU, GPU / VRAM / temperature show `N/A`.
- Trimming the system file cache needs administrator privileges; on failure it is skipped silently and the rest of the cleanup still runs.

## Uninstall

Delete the `custom_nodes/ComfyUI-XXXXXLCatNodes/` folder and restart ComfyUI.
