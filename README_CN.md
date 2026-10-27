# ComfyUI-XXXXXLCatNodes

<p align="center"><strong>🇨🇳 中文</strong> ·<a href="README.md">🇺🇸 English</a></p>

轻量级 ComfyUI 自定义节点，用于系统遥测与资源回收，外加 MiniMax H3 图/文生视频双阶段条件注入。

## 功能特性

- 菜单栏实时监视器，显示 5 项指标（CPU / RAM / GPU / VRAM / 温度），每 0.5s 刷新；左侧 **VRAM Cleanup** 与 **RAM Cleanup** 一键按钮
- 两个按需内存工具：`Sweep VRAM 🐈‍⬛`（卸载模型 + 清理 CUDA 缓存，可选强制 GC）与 `Reclaim RAM 🐈‍⬛`（回收文件缓存 / 工作集 / 自身 DLL，支持试运行）
- MiniMax H3 采样辅助：`H3 Image to Video 🐈‍⬛`
- `Any Switch 🐈‍⬛`：九路任意类型路由器，只转发真正携带数据的那一路，零路或多路同时有数据时报错——在上游切换分支即可，无需改线
- 画布开关：`Group Control 🐈‍⬛`（整组开/关）与 `Node Control 🐈‍⬛`（单个节点开/关）——每行一个开关，可按颜色与名称关键词筛选
- `分辨率选择器 🐈‍⬛`：官方分辨率节点的**两位小数百万像素步进**版，并新增**「自定义」宽高比**——选宽高比+目标百万像素得到宽高，或选「自定义」直接填宽高；步进 0.01（两位小数）而非官方 0.1；「自定义」模式下百万像素输入自动隐藏，而内置实时预览依然显示真实输出尺寸。宽高比选项与按最接近倍数取整均一致
- 零第三方依赖（ctypes + nvidia-smi）
- 节点名、描述与控件标签跟随 ComfyUI 界面语言自动切换（`locales/zh`、`locales/en`）
- **多用户资产隔离**（服务端功能，`--multi-user` 下自动启用）：`input/` 与 `output/` 变为 `input/<user>` / `output/<user>`，每个用户的上传与生成物相互独立；原有的全局 `input/` / `output/` 保留为可读的共享池

## 多用户资产隔离

以 `--multi-user` 启动 ComfyUI 时，本包会**额外**把每个用户的**资产**（`input/` 与 `output/`）也隔离开，而不只是 ComfyUI 原本就会分开的设置与工作流。无需添加任何节点——这是启动时自动安装的服务端补丁。

- 每个用户的上传图片与生成结果落在 `input/<user_id>/` 与 `output/<user_id>/`，而非共享的全局目录。
- 原先的全局 `input/` 与 `output/` 保留为**共享池**：其中的文件仍可被读取（LoadImage 会回退到它们，`/view` 也能显示），并且在 LoadImage 选择器里与用户自己的文件一并出现。
- 路径解析由多用户的 `comfy-user` 请求头、以及执行期的 prompt 归属共同决定，因此 `SaveImage` 等节点即便在执行线程里，也会把文件写到对应用户的目录。
- 普通单用户启动下完全无害（`install()` 在 `--multi-user` 关闭时直接返回），不会影响非多用户环境。

> 实现说明：本功能改写 `folder_paths.get_input_directory` / `get_output_directory`（返回每用户子目录）、`get_annotated_filepath` / `exists_annotated_filepath`（共享池回退）、`LoadImage.INPUT_TYPES`（选择器合并）、`/view` 路由（回退）；并加装 aiohttp 中间件（把 `comfy-user` 头写入上下文）、改写 `PromptServer.trigger_on_prompt`（把用户写入 `extra_data`）与 `PromptExecutor.execute_async`（执行期恢复用户上下文）。每个补丁都包了 `try/except`，若未来 ComfyUI 版本挪动了被改写的符号，会自动回退到官方行为。

## 节点详解

### Sweep VRAM 🐈‍⬛
**原理**：在 ComfyUI 进程内释放显存——卸载已加载模型并清空 CUDA 缓存；勾选 **强制 GC** 会额外触发一次 Python 垃圾回收 + CUDA 同步，把残留显存再榨一遍。完成后通过 `report` 输出释放了多少 MB。
**用法**：放在任意位置（它不接模型输入），勾选要执行的清理项即可；需要极限压榨显存时打开强制 GC。`report` 字符串可接下游做日志或展示。

### Reclaim RAM 🐈‍⬛
**原理**：回收系统物理内存——清理系统文件缓存、裁剪各进程工作集、裁剪本进程 DLL 占用；可设重试次数反复尝试，开 **试运行** 只报当前内存基线而不真裁剪。完成后用 `report` 输出释放的 RAM。
**用法**：先开试运行看基线，确认后再关掉正式回收；文件缓存裁剪需要管理员权限，失败会自动跳过不影响其余清理。

### H3 Image to Video 🐈‍⬛
**原理**：为 MiniMax H3 生成图/文生视频的条件。H3 采样器会就地改写关键帧，所以输出**两个独立条件对象**——`positive`（阶段一，按目标宽高烘焙）与 `positive2`（阶段二精修，按放大后宽高烘焙）——外加空的 `av_latent`，避免两个阶段共用同一对象导致串味。
**用法**：填 prompt 与可选首/末关键帧；`positive` 接阶段一采样器、`positive2` 接阶段二精修采样器、`av_latent` 接采样器。t2v（无关键帧）会忽略阶段二分辨率。

### Any Switch 🐈‍⬛
**原理**：一种适用于任意数据类型的「单路激活」切换器。最多九个任意类型输入；**首次连接决定节点类型**，前端随后把其余端口都锁定为该类型，并把每个端口（及输出）标注为「类型名_序号」（如 `LATENT_01`），让节点一眼看出自己在切换什么。端口随连接自动增长（默认两路，每接一个多出一个空槽，最多九路）。
**用法**：把多个分支输出一起接进来；只有真正跑过的分支会产出值。运行时节点转发那一路，并在零路或多路同时有数据时抛错。在上游让哪个分支跑起来就切到哪路——无需改线、无需开关。

### Group Control 🐈‍⬛
**原理**：一个前端面板，整组整组地开/关。只要组里至少有一个节点，就会成为一行，带组名和开关；列表可按组颜色与组名关键词（多个关键词逗号分隔、任一命中）收窄，并按名称或画布位置排序。模式决定开关如何联动——单独控制、始终开启一个、最多开启一个；关闭一个组即把组内（含嵌套子组）每个节点绕过或禁用。
**用法**：放在任意位置，`signal` 输入为纯透传，可串在执行链里。从 ⚙ 按钮或节点右键菜单打开设置。画布是唯一事实来源——面板只是镜像节点已有的状态，不会与之对抗。

### Node Control 🐈‍⬛
**原理**：同一套面板往下探一层，每行是一个单独的画布节点而非组。关键词同时匹配节点标题**与类型**，多个关键词取「或」；未被上色的节点沿用其所在组的颜色，所以颜色筛选仍能一把捞起某个彩色组里的所有节点。便签、Reroute、Primitive 节点以及控制节点自身不会被列入。
**用法**：用于那些始终没进组的零散节点——在设置里输入 `KSampler, 采样` 只保留这些行，再一并开/关。模式与绕过/禁用选择和 Group Control 一致；你拖出来的面板宽度会随工作流存档记住。


### 分辨率选择器 🐈‍⬛
**这就是官方那个节点，改了三处。** 宽高比选项、分辨率实时预览、按最接近倍数取整、整数宽高输出，全部与 `comfy_extras/nodes_resolution.py` 一致。三处差别：①`megapixels`（目标百万像素）的步进是 **0.01**（小数点后两位），而官方节点是 0.1——所以你能精确选到像 1.05 MP 这样的分辨率，不再被限制到一位小数（也允许填 0，结果为 0×0）；②宽高比下拉多了 **「自定义」** 选项——选中后会展开显式的 **宽度** / **高度** 输入框（按最接近 `multiple` 取整），不再从百万像素反推尺寸；③选中「自定义」时 **`megapixels` 会被隐藏**，因为该模式下它对结果没有影响。
**预览用的是官方内置预览，自定义模式下同样有效。** 内置预览只能把（宽高比、百万像素、倍数）换算成尺寸，而「自定义」并不是一个宽高比，所以单靠它那里只会显示一个短横。做法是：`web/resolution_selector.js` 维护两个隐藏的内部输入，始终填入当前模式下的等效宽高比与等效百万像素；在自定义模式下它们会变成 `宽:高` 与 `宽*高/1048576`，于是预览自身的缩放系数恰好等于 1，从而精确复现本节点按最接近倍数的取整。
**用法**：选好宽高比（或「自定义」），再设目标百万像素——或在「自定义」下直接填宽高。预览会显示按最接近 `multiple`（默认 8）取整后的宽高。需要能被更大 2 的幂整除的 latent 尺寸时，调大 `multiple` 即可。

## 安装

把整个 `ComfyUI-XXXXXLCatNodes` 文件夹复制到 `ComfyUI/custom_nodes/`，然后重启 ComfyUI。

```
ComfyUI/custom_nodes/
└── ComfyUI-XXXXXLCatNodes/
    ├── __init__.py      # 入口：横幅 + 节点映射 + 加载日志
    ├── infra.py         # 共享 AnyType 透传 + 变更计数器
    ├── sensors.py       # Windows ctypes 采样器（CPU/RAM/磁盘/GPU）
    ├── telemetry.py     # 采样线程 + 缓存 + GET /xxxxxlcat-monitor 路由
    ├── reclamation.py   # VRAM 清理 + RAM 裁剪引擎
    ├── nodes/           # 每个节点一个模块
    │   ├── vram_sweep.py
    │   ├── ram_reclaim.py
    │   ├── h3_image_to_video.py
    │   ├── any_switch.py
    │   ├── group_control.py
    │   ├── node_control.py
    │   └── resolution_selector.py  # 官方「分辨率选择器」：0.01 百万像素步进 + 自定义尺寸模式
    ├── locales/         # 前端文案，经 ComfyUI 核心 /i18n 路由下发
    │   ├── en/nodeDefs.json
    │   └── zh/nodeDefs.json
    ├── scripts/
    │   └── check_locales.py        # 校验语言包与节点 schema 是否一致
    ├── pyproject.toml   # 节点元数据（被 ComfyUI-Manager 识别）
    └── web/
        ├── monitor.js        # 菜单栏遥测条 + 清理按钮（由 ComfyUI 自动加载）
        ├── group_control.js  # 组控制 🐈‍⬛ 的面板
        ├── node_control.js   # 节点控制 🐈‍⬛ 的面板
        ├── any_switch.js     # 任意切换 🐈‍⬛ 的动态端口
        └── resolution_selector.js  # 自定义模式下隐藏百万像素，并给内置预览喂值
```

## 数据

- CPU% / RAM / GPU 利用率 / VRAM / 温度，由后台线程每 0.5s 采样并缓存
- 无 NVIDIA GPU 时 GPU / VRAM / 温度显示 `N/A`
- 悬停指标显示详情（已用/总量，VRAM 会话峰值 `Max`）

## 注意事项

- 全部九个节点均基于新 **V3 节点 API**（`comfy_api` / `io.ComfyNode`）实现，通过 `comfy_entrypoint()` 注册（与官方 MiniMax H3 节点同模式）。需要较新的、自带 `comfy_api` 的 ComfyUI——旧版没有它的构建会无法加载本包。
- 清理按钮通过 `/prompt` 在 ComfyUI 进程内运行，效果即时（非延迟标志）
- 裁剪系统文件缓存进行内存清理需要管理员权限；失败时静默跳过，不影响其余清理

## 卸载

删除 `custom_nodes/ComfyUI-XXXXXLCatNodes/` 文件夹并重启 ComfyUI。
