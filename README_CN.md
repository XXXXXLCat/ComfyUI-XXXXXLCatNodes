# ComfyUI-XXXXXLCatNodes

<p align="center"><strong>🇨🇳 中文</strong> ·<a href="README.md">🇺🇸 English</a></p>

轻量级 ComfyUI 自定义节点，用于系统遥测与资源回收，外加 MiniMax H3 图/文生视频双阶段条件注入。

## 功能特性

- 菜单栏实时监视器，显示 5 项指标（CPU / RAM / GPU / VRAM / 温度），每 0.5s 刷新；左侧 **VRAM Cleanup** 与 **RAM Cleanup** 一键按钮
- 两个按需内存工具：`Sweep VRAM 🐈‍⬛`（卸载模型 + 清理 CUDA 缓存，可选强制 GC）与 `Reclaim RAM 🐈‍⬛`（回收文件缓存 / 工作集 / 自身 DLL，支持试运行）
- MiniMax H3 采样辅助：`H3 Image to Video 🐈‍⬛`
- 画布开关：`Group Control 🐈‍⬛`（整组开/关）与 `Node Control 🐈‍⬛`（单个节点开/关）——每行一个开关，可按颜色与名称关键词筛选
- 零第三方依赖（ctypes + nvidia-smi）
- 节点名、描述与控件标签跟随 ComfyUI 界面语言自动切换（`locales/zh`、`locales/en`）

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

### Group Control 🐈‍⬛
**原理**：一个前端面板，整组整组地开/关。只要组里至少有一个节点，就会成为一行，带组名和开关；列表可按组颜色与组名关键词（多个关键词逗号分隔、任一命中）收窄，并按名称或画布位置排序。模式决定开关如何联动——单独控制、始终开启一个、最多开启一个；关闭一个组即把组内（含嵌套子组）每个节点绕过或禁用。
**用法**：放在任意位置，`signal` 输入为纯透传，可串在执行链里。从 ⚙ 按钮或节点右键菜单打开设置。画布是唯一事实来源——面板只是镜像节点已有的状态，不会与之对抗。

### Node Control 🐈‍⬛
**原理**：同一套面板往下探一层，每行是一个单独的画布节点而非组。关键词同时匹配节点标题**与类型**，多个关键词取「或」；未被上色的节点沿用其所在组的颜色，所以颜色筛选仍能一把捞起某个彩色组里的所有节点。便签、Reroute、Primitive 节点以及控制节点自身不会被列入。
**用法**：用于那些始终没进组的零散节点——在设置里输入 `KSampler, 采样` 只保留这些行，再一并开/关。模式与绕过/禁用选择和 Group Control 一致；你拖出来的面板宽度会随工作流存档记住。

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
    │   └── group_control.py
    ├── locales/         # 前端文案，经 ComfyUI 核心 /i18n 路由下发
    │   ├── en/nodeDefs.json
    │   └── zh/nodeDefs.json
    ├── scripts/
    │   └── check_locales.py   # 校验语言包与节点 schema 是否一致
    ├── pyproject.toml   # 节点元数据（被 ComfyUI-Manager 识别）
    └── web/
        ├── monitor.js        # 菜单栏遥测条 + 清理按钮（由 ComfyUI 自动加载）
        ├── group_control.js  # 组控制 🐈‍⬛ 的面板
        ├── node_control.js   # 节点控制 🐈‍⬛ 的面板
        └── any_switch.js     # 任意切换 🐈‍⬛ 的动态端口
```

## 数据

- CPU% / RAM / GPU 利用率 / VRAM / 温度，由后台线程每 0.5s 采样并缓存
- 无 NVIDIA GPU 时 GPU / VRAM / 温度显示 `N/A`
- 悬停指标显示详情（已用/总量，VRAM 会话峰值 `Max`）

## 注意事项

- 全部六个节点均基于新 **V3 节点 API**（`comfy_api` / `io.ComfyNode`）实现，通过 `comfy_entrypoint()` 注册（与官方 MiniMax H3 节点同模式）。需要较新的、自带 `comfy_api` 的 ComfyUI——旧版没有它的构建会无法加载本包。
- 清理按钮通过 `/prompt` 在 ComfyUI 进程内运行，效果即时（非延迟标志）
- 裁剪系统文件缓存进行内存清理需要管理员权限；失败时静默跳过，不影响其余清理

## 卸载

删除 `custom_nodes/ComfyUI-XXXXXLCatNodes/` 文件夹并重启 ComfyUI。
