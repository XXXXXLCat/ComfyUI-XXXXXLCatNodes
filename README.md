# ComfyUI-XXXXXLCatNodes

<p align="center"><a href="README_CN.md">🇨🇳 中文</a> ·<strong>🇺🇸 English</strong></p>

ComfyUI extension providing seven custom nodes and three interface features.

- Nodes: Sweep VRAM, Reclaim RAM, H3 Image to Video, Any Switch, Group Control, Node Control, Resolution Selector, Fit Image to Size.
- Interface: menu-bar system status, history gallery sidebar tab, multi-user file isolation.

No third-party dependencies and no external service. Labels follow ComfyUI's language setting; Chinese and English are provided.

## Menu-bar system status

Once ComfyUI starts, a status area appears in the menu bar with five metrics, refreshed every 0.5 seconds.

| Metric | Cell text | Hover text | Fill height |
| --- | --- | --- | --- |
| CPU | load percentage | load percentage | utilization ratio |
| RAM | load percentage | load percentage, used / total | utilization ratio |
| GPU | load percentage | load percentage, card name | utilization ratio |
| VRAM | used VRAM (GB) | load percentage, used / total, session peak | utilization ratio |
| Temperature | current °C | current °C, card name | position within the 40–85 °C range |

The temperature fill colour transitions from green to red between 40 °C and 85 °C. Without an NVIDIA card, GPU, VRAM and temperature read `N/A`; CPU and RAM are unaffected.

Two buttons sit to the left of the status area and execute immediately, without adding a node to the graph.

| Button | Action |
| --- | --- |
| RAM Cleanup | Trims the system file cache, each process working set, and this process's loaded DLLs, three passes |
| VRAM Cleanup | Unloads loaded models and sweeps the CUDA cache |

Each button performs the same operation as the Reclaim RAM and Sweep VRAM nodes with preset parameters.

## Sweep VRAM 🐈‍⬛

Unloads loaded models and releases VRAM, returning a text report.

| Input | Default | Description |
| --- | --- | --- |
| Unload models | on | Unloads all models from VRAM before releasing |
| Sweep CUDA caches | on | Sweeps CUDA caches before releasing |
| Force GC | off | Runs one additional garbage collection plus a CUDA synchronisation |
| Pass-through | — | Optional, returned unchanged, for chaining the node into a graph |

| Output | Content |
| --- | --- |
| Pass-through | The pass-through input, returned unchanged |
| Report | Released VRAM in GB |

Steps are independent: a failing step does not interrupt the remaining ones.

## Reclaim RAM 🐈‍⬛

Reclaims system memory (not VRAM) and returns a text report.

| Input | Default | Description |
| --- | --- | --- |
| Trim system file cache | on | Trims the system file cache; requires administrator rights |
| Trim process working sets | on | Trims every process working set |
| Trim own DLLs | on | Trims memory held by this process's loaded DLLs |
| Retry count | 3 | Number of passes over the selected steps |
| Dry run | off | Reports the physical-memory baseline only, trims nothing |
| Pass-through | — | Optional, returned unchanged, for chaining the node into a graph |

| Output | Content |
| --- | --- |
| Pass-through | The pass-through input, returned unchanged |
| Report | Reclaimed memory in GB, with the change in utilization |

Windows only. Without sufficient rights the file-cache step is skipped and the remaining steps still run.

## Group Control 🐈‍⬛

Switches canvas contents by group. The panel resides inside the node body; each group occupies one row containing its name and a switch.

- Scope: every non-empty group on the canvas, including sub-groups that lie entirely inside another group. Empty groups are not listed.
- Closing a row: every node in the group is set to bypass or mute, according to *Close method*.
- The switches write the node execution mode directly, equivalent to bypassing or muting a node by hand; they do not participate in sampling.
- `signal` is an optional pass-through input, returned unchanged and not involved in switching.

## Node Control 🐈‍⬛

Uses the same panel at node granularity.

- Scope: every node on the canvas, excluding Notes, Reroutes, PrimitiveNodes and the panel node itself.
- Closing a row: the node is set to bypass or mute.
- Keywords match both the node title and its type.

## Panel settings (shared by Group Control and Node Control)

Opened from the **⚙ Settings** button at the bottom of the node.

| Item | Options | Description |
| --- | --- | --- |
| Close method | Bypass (default), Mute | Operation applied to nodes in a closed row |
| Mode | Free (default), Always one on, At most one on, At least one on | Interaction rule between switches |
| Sort | By name (default), By position, By state, By colour | Row ordering |
| Reverse | Off (default), On | Whether the ordering is reversed |
| Name keywords | empty | Several words separated by `;`; a row is listed when any one matches. With an empty value no rows are listed, only a hint |
| Colour filter | none | Multi-select; only objects of the selected colours are kept. A node without its own colour inherits its group's colour |

The panel refreshes automatically on canvas changes (nodes added or removed, renamed, recoloured). The node width is adjustable by dragging and is stored in the node properties, so it travels with the workflow.

## H3 Image to Video 🐈‍⬛

Builds the conditioning MiniMax H3 needs for image-to-video and text-to-video, providing both stages plus an empty audio-video latent in one node.

| Input | Description |
| --- | --- |
| CLIP | MiniMax H3 text and image encoder |
| VAE | Video VAE used to encode the keyframes |
| Prompt | Text prompt; reference tags follow the MiniMax H3 convention |
| Width, height | Stage-1 target size |
| Length | Frame count at 24 fps, snapped to the model's 17k+5 grid |
| Stage-2 width, height | Stage-2 target size; keyframes are re-encoded at this size |
| First frame, last frame | Optional keyframes |

| Output | Content |
| --- | --- |
| Positive | Used by the stage-1 sampler, built at *width* × *height* |
| Positive 2 | Independent conditioning object for the stage-2 sampler, built at the stage-2 size |
| Audio-video latent | Empty joint latent used by stage 1 |

*Positive 2* is a conditioning object built at the stage-2 size, not a copy of stage 1; it aligns the keyframes with the upscaled latent.

- Without first or last frame, *Positive 2* is an independent copy and the stage-2 size has no effect.
- The same output must not feed two samplers: the H3 sampler rewrites the keyframes in place, so the two stages would affect each other.
- 124 frames is about 5 seconds; the training range is 124–362 frames, and longer values are untested.

## Any Switch 🐈‍⬛

A single-active switch independent of data type, used to continue with one of several branches.

- Ports start at 2 and grow by one spare slot per connection, up to 9.
- The first connection fixes the type; all other ports are locked to it. Port labels read `Type_01` (e.g. `Latent_01`), and the output label is the type name.
- Only the input carrying data is forwarded. With no input, or with several, an error is raised rather than a silent choice.
- Switching happens upstream; the downstream side needs no rewiring.

## Resolution Selector 🐈‍⬛

Identical to the official resolution node except for two differences.

- The megapixel step is 0.01 instead of 0.1, so two decimals are usable.
- A **Custom** aspect ratio is available, taking explicit width and height. In that mode the megapixel field is hidden and does not affect the result.

All other behaviour matches the official node: same aspect ratio options, same live resolution preview, same rounding to the chosen multiple.

## Fit Image to Size 🐈‍⬛

Works out a target size from aspect ratio and megapixels, then scales the image onto it with a single uniform factor so the picture is never stretched. The size arithmetic matches Resolution Selector, so the same ratio and megapixel value give the same result on both nodes.

| Field | Default | Notes |
| --- | --- | --- |
| Aspect Ratio | Auto | Auto takes the ratio from the input image; the rest are fixed ratios |
| Megapixels | 1.0 | Target total megapixels, 0.01 step |
| Multiple | 32 | Snap the computed size to the nearest multiple; 1 disables snapping |

Aspect ratios: Auto, 1:1, 2:3, 3:2, 3:4, 4:3, 9:16, 16:9, 21:9.

Whether the target crops or pads is decided by the node, with no switch to set:

- When the target ratio already follows the image — always in Auto ratio, and for a chosen ratio within 2% — it scales to cover and centre-crops the few pixels the rounding added. No border, no change to the composition.
- Further apart it scales to fit and centres the result on a black canvas. Every pixel kept, at the cost of black borders.

Outputs are the image, the width and height actually produced, and resolution — the equivalent square edge `round(√(width×height))`, which is 1024 for a 1 MP square.

Below the inputs the node shows a target-size preview such as `1376 × 768 1.01 MP`, updated live as the aspect ratio or megapixel value changes. In Auto mode the preview uses the connected image's own width and height; with nothing connected it shows a dash.

In Auto mode the size is still snapped to the multiple, so the produced ratio differs from the image ratio by the rounding — usually under 1%. Some ratios have no exact counterpart on the grid: 1365×768 becomes 1376×768 at a multiple of 32, 0.8% wide. The crop then shaves a few pixels off the edge and leaves the composition intact. Setting the multiple to 1 gives an exact match, at the cost of a size that no longer sits on the model's grid.

Why the multiple: some diffusion models (Qwen-Image among them) re-align images to their own grid internally. When the output already sits on that grid, the model skips its own resize and the picture is not softened by a second resample.

Limits:

- Both paths scale by a single uniform factor and never stretch. The further the target ratio sits from the input ratio, the more of the picture is cropped.
- The padding colour is fixed black; it does not extend the image content.
- The decision looks at the ratio alone, not at the picture's content: to force a crop pick a ratio that already matches the picture, to force padding pick one that is far off.

## History gallery

A sidebar tab, placed above *Assets*. It lists every file that exists on disk under the account's `output/` and `input/` trees, not only the files produced in the current session.

| Area | Content |
| --- | --- |
| Tabs | Generated (output), Imported (input) |
| Type filter | All, Images, Videos, Audio, Other |
| Toolbar | Filename search, refresh, view switch (list, grid small, grid large) |
| Card information | Filename, size, modified time |

Selection:

- Click selects, Ctrl-click adds, Shift-click selects a range, dragging over empty space selects a rectangle.
- While a selection exists, a floating bar at the bottom shows the count and offers download all, delete all and deselect all.

Context menu:

| Item | Description |
| --- | --- |
| Inspect asset | Opens the preview layer; video and audio play there, text shows the beginning of the file; the original can be opened or downloaded |
| Insert as node in workflow | Places the file in the input directory, adds a loader node at the centre of the viewport and fills in the filename |
| Download | Downloads the file |
| Delete | Moves the file to the system Recycle Bin |

Double-clicking a card is equivalent to *Inspect asset*.

Limitations:

- Delete moves the file to the system Recycle Bin, where it can be restored from Explorer; on volumes without a Recycle Bin (network drives) it is a direct delete.
- When a file is locked or not removable, it stays in place and a delete-failed notice is shown.
- *Insert as node in workflow* applies to images, video and audio only; 3D models and other types are unavailable. The file is hard-linked into the input directory (copied across drives), and a `LoadImage`, `LoadVideo` or `LoadAudio` node is added.
- Dragging a card onto the canvas uses ComfyUI's native drop handling and carries the original file.

## Multi-user file isolation

Active when ComfyUI is started with `--multi-user`; a single-user launch is unaffected.

- `input/` and `output/` are split per account into `input/<user>/` and `output/<user>/`; uploads and generated files are mutually invisible.
- History, queue and job lists are isolated per account.
- Login uses ComfyUI's native user selection; no password is set.
- Files already present in the global `input/` and `output/` are not shown to any account.

## Installation

Place the `ComfyUI-XXXXXLCatNodes` folder in `ComfyUI/custom_nodes/` and restart ComfyUI.

The menu-bar status, the history gallery and multi-user isolation activate automatically; no node has to be added to a graph.

## Requirements

- Windows. System status is read through Windows APIs.
- A ComfyUI build that ships `comfy_api` (the nodes use the new node interface).
- No third-party dependencies.

## Uninstall

Delete the `custom_nodes/ComfyUI-XXXXXLCatNodes/` folder and restart ComfyUI.
