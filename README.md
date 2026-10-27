# ComfyUI-XXXXXLCatNodes

<p align="center"><a href="README_CN.md">🇨🇳 中文</a> ·<strong>🇺🇸 English</strong></p>

Lightweight ComfyUI custom nodes for system telemetry and resource reclamation, plus MiniMax H3 image/text-to-video conditioning.

## Features

- Menu-bar live monitor with 5 metrics (CPU / RAM / GPU / VRAM / temperature), refreshing every 0.5s; one-tap **VRAM Cleanup** and **RAM Cleanup** buttons
- Two on-demand memory tools — `Sweep VRAM 🐈‍⬛` (unload models + clear CUDA cache, optional forced GC) and `Reclaim RAM 🐈‍⬛` (reclaim file cache / working sets / own DLLs, with dry-run)
- MiniMax H3 sampling helper: `H3 Image to Video 🐈‍⬛`
- `Any Switch 🐈‍⬛`: a 9-way any-type router that forwards the single populated input and errors if zero or more than one branch runs — switch branches upstream, no rewiring
- Canvas switches: `Group Control 🐈‍⬛` (open/close whole canvas groups) and `Node Control 🐈‍⬛` (open/close individual nodes) — one row and one switch each, filterable by colour and name keyword
- `Resolution Selector 🐈‍⬛`: the official resolution node with a **2-decimal megapixel step** and a **Custom aspect-ratio mode** — choose an aspect ratio and a megapixel target to get width/height, or pick `Custom` to enter explicit width/height; the target steps by 0.01 (two decimals) instead of the official node's 0.1; the megapixel input is hidden in Custom mode; same aspect ratios, live resolution preview, and nearest-multiple rounding
- Zero third-party dependencies (ctypes + `nvidia-smi` subprocess)
- Node names, descriptions and widget labels follow the ComfyUI interface language via `locales/zh` and `locales/en`; any other `zh-*` locale (e.g. `zh-TW`) reuses the `zh` bundle instead of falling back to English
- **Per-user asset isolation** (server-side, auto-enabled under `--multi-user`): `input/` and `output/` become `input/<user>` / `output/<user>` so each user's uploads and generations are private; the pre-existing global `input/` / `output/` stays readable as a shared pool
- **Per-user password login** (server-side, auto-enabled under `--multi-user`): a real password gate on top of ComfyUI's header-only multi-user mode, where each account has its own password and the session is kept in an HttpOnly cookie; a frontend login overlay is provided automatically. Combined with asset isolation, A's password cannot open B's assets
- **Output gallery** (sidebar tab): browse **every** file in `output/`, not just what this run produced — earlier batches, files copied in by hand, videos written by custom nodes. Grid of thumbnails with type filters, filename search and a click-to-preview lightbox

## Multi-user asset isolation

When ComfyUI is launched with `--multi-user`, this package automatically isolates each
user's **assets** (`input/` and `output/`) in addition to the settings and workflows that
ComfyUI already separates. No node to add — it is a server-side patch installed at startup.

- Each user's uploads and generated images land in `input/<user_id>/` and `output/<user_id>/`
  instead of the shared global folders.
- The previously global `input/` and `output/` are kept as a **shared pool**: files there are
  still readable (LoadImage falls back to them, and `/view` serves them) and still appear in
  the LoadImage picker alongside the user's own files.
- Resolution is driven by the `comfy-user` request header (multi-user) and by the prompt's
  owner during execution, so `SaveImage` and friends write to the correct user's directory
  even though execution runs in its own task.
- Entirely inert in a normal single-user launch (`install()` early-returns when `--multi-user`
  is off), so it cannot affect non-multi-user setups.

> Implementation note: it patches `folder_paths.get_input_directory` / `get_output_directory`
> (per-user subdir), `get_annotated_filepath` / `exists_annotated_filepath` (shared-pool
> fallback), `LoadImage.INPUT_TYPES` (picker union), the `/view` route (fallback), an aiohttp
> middleware (`comfy-user` → context), `PromptServer.trigger_on_prompt` (user into
> `extra_data`), and `PromptExecutor.execute_async` (restore user for execution). Every patch
> is wrapped in `try/except` and degrades to the official behaviour if a future ComfyUI version
> moves a patched symbol.
>
> Each user also gets an independent prompt cache (`CacheSet`). The stock cache is shared by
> the whole server, which leaks directories across accounts: node **instances** are kept per
> node id for the server's lifetime (`SaveImage` stores `get_output_directory()` in `__init__`),
> and node **outputs** are keyed by inputs only — so the second user running an identical
> workflow would be served the first user's cached result and write into the first user's folder.

## Multi-user password login

ComfyUI's `--multi-user` distinguishes users solely by the `comfy-user` request header, whose
value is a UUID from `users.json` — **there is no password**, so anyone who obtains an id can
impersonate that user. This feature adds a real password gate on top. No node to add — it is a
server-side patch plus a frontend login overlay (`web/multi_user_auth.js`).

- **Per-account passwords**, hashed with PBKDF2-HMAC-SHA256 and a per-user random salt, stored in
  `user/user_passwords.json` (next to the official `users.json`). Plaintext is never persisted.
- **Cookie-based sessions**: on login the server issues a signed token (`xcat_token`, HMAC-signed,
  30-day TTL by default) as an HttpOnly cookie. Because the cookie is same-origin, the browser
  automatically attaches it to every later `fetch` *and* WebSocket handshake — no API-client
  patching required.
- **Login overlay**: when the frontend loads unauthenticated, a dark neutral login box appears
  (username + password), with a "create account" mode that registers with a password. On success
  it remembers the ComfyUI user and reloads.
- **Gate scope**: everything except the login/status/logout/register endpoints, the frontend
  static assets (`/`, `/index.html`, `/extensions/`, `*.js|css|...`) and `OPTIONS` preflight
  requires a valid session — `/prompt`, `/view`, `/history`, `/ws`, `/users` reads, settings and
  workflows included. Requests without the cookie get `401`.
- **Tied to asset isolation**: the authenticated identity overrides the `comfy-user` header and
  drives `input/<user>/` / `output/<user>/`, so A's password neither logs into B nor reads B's
  assets.

### Migration path

- **New accounts** require a password at registration and on every login.
- **Legacy passwordless accounts** (created before this feature) may log in **once with an empty
  password**, then set a password via `POST /xcat/set_password`; afterwards the empty password no
  longer works. An admin can instead set passwords for all accounts via the endpoint below.
- **Admin bootstrap** (optional): put `"admin_password": "..."` in `user/auth_config.json`, then
  call `POST /xcat/admin/set_password` with `{admin_password, user_id, password}` for any account.
- Session lifetime is adjustable via `"token_ttl_seconds"` in `user/auth_config.json`.

### Endpoints (all under `/xcat/`)

| Method & path | Purpose |
| --- | --- |
| `POST /xcat/register` | Create an account with a password `{username, password}` |
| `POST /xcat/login` | Username + password; sets the session cookie |
| `GET  /xcat/auth_status` | Whether the current request is authenticated |
| `POST /xcat/set_password` | Change your own password (login required; old password if set) |
| `POST /xcat/admin/set_password` | Admin sets any account's password (needs `admin_password`) |
| `POST /xcat/logout` | Clear the cookie |

> In a single-user launch the feature is entirely off: no `/xcat/*` routes exist, and the overlay
> hides itself on a 404, so behaviour matches vanilla ComfyUI.

## Output gallery

ComfyUI's sidebar **Assets** panel only lists what it knows about: `Generated` is what this
frontend session produced (derived from the queue history, wiped on reload), `Imported` is what
was uploaded into `input/`. **Files that already sit on disk never show up** — outputs from an
earlier batch, files copied in by hand, videos written by a custom node.

This feature adds a **History Gallery** sidebar tab that enumerates the whole `output/` tree.
No node to add.

- **Grid browsing**: each card shows a thumbnail, filename, size and timestamp, newest first.
  Clicking opens a lightbox — images are shown at full size, video/audio play inline, with
  "open in new tab" and "download" actions.
- **Filter and search**: `All / Images / Videos / Audio / Other` chips plus a live filename
  search over `subfolder/filename`.
- **Cheap thumbnails**: images are downscaled to 512px WebP server-side (with an in-memory
  cache), and the grid only renders the visible batch, pulling more as you scroll.
- **Scoped under multi-user**: with `--multi-user` the gallery lists only your own
  `output/<user>/` tree (labelled *mine*) plus the legacy global pool (cards tagged **Shared**);
  other accounts' directories are neither listed nor reachable.
- **Read-only**: no route here deletes, renames or moves anything.

> Implementation: `nodes/history_gallery.py` registers two read-only routes — `GET /xcat/outputs`
> (manifest, capped at the newest 5000 entries when needed) and `GET /xcat/outputs/file`
> (file or thumbnail). Path resolution verifies the request really lands inside the matching root,
> and the shared scope additionally rejects any path inside another account's directory. The
> frontend (`web/history_gallery.js`) registers a `type: "custom"` tab through
> `app.extensionManager.registerSidebarTab`. It works in single-user and multi-user mode; under
> multi-user it sits behind the same password gate and returns `401` when signed out.

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


### Resolution Selector 🐈‍⬛
**This is the official node, with three tweaks.** Same aspect ratios, same live resolution preview, same nearest-multiple rounding, same integer width/height outputs as `comfy_extras/nodes_resolution.py`. Differences: (1) the `megapixels` target steps by **0.01** (two decimal places) instead of the official node's 0.1, so you can dial in a resolution like 1.05 MP rather than being limited to one decimal (0 is also accepted and yields a 0×0 size); (2) the aspect-ratio selector adds a **Custom** option — choosing it reveals explicit **Width** / **Height** fields (rounded to the nearest `multiple`) instead of deriving size from megapixels; (3) the `megapixels` input is **hidden while `Custom` is selected**, because it has no effect on the result in that mode.
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
    ├── locales/         # front-end strings, served through the core /i18n route
    │   ├── en/nodeDefs.json
    │   └── zh/nodeDefs.json
    ├── scripts/
    │   └── check_locales.py        # validates locales against the live node schemas
    ├── pyproject.toml   # node metadata (recognized by ComfyUI-Manager)
    └── web/
        ├── monitor.js        # menu-bar telemetry strip + cleanup buttons (auto-loaded by ComfyUI)
        ├── group_control.js  # panel for Group Control 🐈‍⬛
        ├── node_control.js   # panel for Node Control 🐈‍⬛
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
