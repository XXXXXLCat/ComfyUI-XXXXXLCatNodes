# ComfyUI-XXXXXLCatNodes

<p align="center"><strong>🇨🇳 中文</strong> ·<a href="README.md">🇺🇸 English</a></p>

一组 ComfyUI 自定义节点，附带菜单栏监视器界面功能。

## 节点

| 节点 | 功能 |
| --- | --- |
| 清理显存 🐈‍⬛ | 卸载已加载的模型、清空 CUDA 缓存，可选「强制 GC」再榨一遍；`report` 输出释放了多少 MB |
| 回收内存 🐈‍⬛ | 回收系统内存：清理文件缓存、裁剪各进程工作集与本进程 DLL；可设重试次数，可开「试运行」只看基线不动手；`report` 输出释放了多少 RAM |
| H3 图生视频 🐈‍⬛ | 生成 MiniMax H3 图/文生视频的条件：两路独立 conditioning（阶段一按目标尺寸、阶段二按放大后尺寸）+ 一个空 `av_latent`，两个阶段不互相污染 |
| 任意切换 🐈‍⬛ | 九路任意类型的单路切换。首次连接决定类型，其余端口自动锁定并标注类型与序号；运行时只转发真正有数据的那一路，零路或多路同时有数据则报错 |
| 组控制 🐈‍⬛ | 按**组**开关画布：每组一行一个开关，可按颜色与组名关键词筛选，支持自由 / 始终开一个 / 最多开一个三种模式，关闭时对组内节点（含子组）绕过或禁用 |
| 节点控制 🐈‍⬛ | 同上，但每行是**单个节点**；关键词同时匹配标题与类型，未上色的节点继承所在组的颜色 |
| 分辨率选择器 🐈‍⬛ | 官方分辨率节点，两处改动：百万像素步进 0.01（官方 0.1）、额外提供「自定义」宽高比直接填宽高 |

<sub>以上为中文界面下的名称；切到 English 界面依次为 Sweep VRAM / Reclaim RAM / H3 Image to Video / Any Switch / Group Control / Node Control / Resolution Selector。</sub>

## 界面

- **菜单栏监视器**：CPU / RAM / GPU 利用率 / 显存 / 温度五项，每 0.5 秒刷新；左侧两个一键按钮 **VRAM Cleanup**、**RAM Cleanup**；悬停可看已用/总量与显存会话峰值。

## 安装

把整个 `ComfyUI-XXXXXLCatNodes` 文件夹放进 `ComfyUI/custom_nodes/`，重启 ComfyUI。界面功能无需添加任何节点。

## 要求

- 需要自带 `comfy_api` 的较新 ComfyUI（节点基于 V3 节点 API）。
- 零第三方依赖。
- 系统监视走 Windows ctypes；无 NVIDIA 显卡时 GPU / 显存 / 温度显示 `N/A`。
- 裁剪系统文件缓存需要管理员权限，失败时静默跳过，不影响其余清理。

## 卸载

删除 `custom_nodes/ComfyUI-XXXXXLCatNodes/` 文件夹并重启 ComfyUI。
