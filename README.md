# ComfyUI-XXXXXLCatNodes

<p align="center"><a href="README_CN.md">🇨🇳 中文</a> ·<strong>🇺🇸 English</strong></p>

A small set of ComfyUI custom nodes, plus three interface features (menu-bar monitor, history gallery, multi-user support).

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
- **History Gallery** (sidebar tab): lists **every** file under `output/`, not just what the current session produced — earlier batches, files copied in by hand, videos written by custom nodes all show up.
  - Three view modes: list / small grid / large grid. Filter by All · Images · Videos · Audio · Other, and search by filename live.
  - Every kind renders: images fit their long edge (never cropped), video shows a real first frame, audio draws its real waveform and plays right in the tile, text prints its opening lines, 3D models fall back to a glyph. Hovering scales the thumbnail slightly.
  - Clicking opens a lightbox: zoom images, play video/audio, "open in new tab" and "download". Read-only — nothing here deletes, renames or moves.
- **Per-user asset isolation** (auto-enabled under `--multi-user`): `input/` and `output/` become `input/<user>/` and `output/<user>/`, so each user's uploads and generations are private; the pre-existing global folders stay readable as a shared pool.
- **Per-user password login** (auto-enabled under `--multi-user`): every account needs a password, stored hashed with the session kept in an HttpOnly cookie. Opening any page while signed out returns the login page, and accounts can be created there. Signing out really signs out, and ComfyUI's "pick a username to switch" route is closed — entering another account requires its password.
- **Interface language**: node names, descriptions and widget labels follow the ComfyUI interface language (Chinese / English); other Chinese variants such as `zh-TW` reuse the Chinese bundle instead of falling back to English.

## Installation

Copy the whole `ComfyUI-XXXXXLCatNodes` folder into `ComfyUI/custom_nodes/` and restart ComfyUI. The interface features need no node added to the graph.

## Requirements

- A recent ComfyUI that ships `comfy_api` (the nodes use the V3 node API).
- Zero third-party dependencies.
- System monitoring uses Windows ctypes; without an NVIDIA GPU, GPU / VRAM / temperature show `N/A`.
- Trimming the system file cache needs administrator privileges; on failure it is skipped silently and the rest of the cleanup still runs.

## Uninstall

Delete the `custom_nodes/ComfyUI-XXXXXLCatNodes/` folder and restart ComfyUI.
