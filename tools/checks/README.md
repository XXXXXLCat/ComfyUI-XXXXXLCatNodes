# 画布回归检查脚本

这些脚本不是单元测试，而是**实机检查**：启动无头 Chrome → 连本机 ComfyUI（默认 `http://127.0.0.1:8188`）→ 注入真实的鼠标/键盘事件 → 读 computed style 与几何 → 截图并断言。

前置：ComfyUI 已在 8188 运行。脚本自带 `--user-data-dir`，截图与临时 profile 写到 `.workbuddy/tmp/`（已被 gitignore）。

```bash
node tools/checks/check_edges.js
```

## 当前有效（针对 Vue Flow 引擎）

| 脚本 | 验证内容 |
| --- | --- |
| `check_edges.js` | 连线中点圆点、Alt 划过切割轨迹、选中节点连线白色高亮、远缩放隐藏圆点 |
| `check_history2.js` | Ctrl+Z / Ctrl+Y 撤销重做步数、拖动节点位置回滚、合并窗口内不产生死步 |
| `check_keys.js` | 快捷键是否被 ComfyUI 残留弹窗吞掉、Enter/Esc/Delete 归属 |
| `check_mention.js` | 提示词 `@` 引用候选、chip 插入、序列化与光标位置 |
| `check_copy.js` | chip 复制为纯文本 `@图片1`、粘贴还原 chip |
| `check_select.js` | ComfyUI 下拉框皮肤的 trigger/菜单尺寸、选中态、快捷键隔离 |
| `check_audio_panel.js` | 音频生成节点：4 模式、两个输入区、工作流 payload 真实字段 |
| `check_audio_bar.js` | 音频面板底部参数条：混合类型控件、换行不错位、API 下拉不被压缩 |
| `check_tools_select.js` | 选中节点后工具行出现时机与位置 |
| `check_grid_live.js` / `check_grid_custom.js` | 画布网格 canvas 贴图与 LiteGraph 一致性 |
| `check_crop_live.js` | 裁剪框拖动与 8 手柄缩放 |
| `check_mirror_icons.js` | 镜像 5 按钮图标与点击即生成 |
| `check_ident.js` / `check_template.js` | 画布文档标识、模板读取与占位符 |

## 单次核验（已并入上方检查，保留备查）

`verify_adjust.js` 图像调整算法、`verify_clip2.js` 视频截取、`verify_mirror.js` 镜像、
`verify_num2.js` 数字输入、`verify_speed.js` 音频变速、`verify_stepper.js` 步进器、`verify_trim.js` 音频截取。

## oneoff/

一次性脚本：`shot_*` 截图、`make_*` 静态 demo 生成、`diag_*` / `cdp_*` 诊断探针。留存备查，不保证还能直接跑。

## 约定期

- 脚本里统一用绝对路径 `const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas'`，所以从任何目录执行都可以，但换机器要改这一行。
- 新增检查请沿用 `check_<功能>.js` 命名，跑通后登记到上面的表格。
