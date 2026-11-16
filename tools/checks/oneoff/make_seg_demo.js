/* Build a static page from the REAL CSS lines in infcanvas-flow.js so the
   segmented control can be screenshotted without ComfyUI running. */
const fs = require('fs');
const path = require('path');
const ROOT = 'E:/Workspace/Workspace-Infinite-Canvas';
const src = fs.readFileSync(path.join(ROOT, 'js/infcanvas-flow.js'), 'utf8');

function block(sel) {
  const start = src.indexOf(sel + ' {');
  if (start < 0) throw new Error('missing ' + sel);
  const end = src.indexOf('}', start);
  return src.slice(start, end + 1);
}
const css = [
  block('.icn__gpv-modes'),
  block('.icn__gpv-mode'),
  block('.icn__gpv-mode:hover'),
  block('.icn__gpv-mode.is-on'),
  block('.icn__gpv-mode.is-disabled'),
  block('.icn__gpv-mode.is-disabled:hover'),
  block('.icn__gp-tabs'),
  block('.icn__gp-tab'),
  block('.icn__gp-tab.is-on'),
].join('\n');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
:root { --icnw-bg:#313235; --icnw-hover:#3c3d42; --icnw-ring:#8a8a8a;
  --icnw-r:6px; --icnw-r-sm:4px; --icnw-panel:#262729;
  --ic-soft:#8a8a8a; --ic-text:#ffffff; --ic-ctrl-fs:12px; --ic-ctrl-h:30px; }
html,body { margin:0; background:#171718; font-family:Inter,system-ui,sans-serif; }
.panel { box-sizing:border-box; width:480px; padding:10px; background:#262729;
  border-radius:10px; border:1px solid #494a50; margin:16px; }
.label { color:#8a8a8a; font-size:10px; margin:14px 0 6px; }
${css}
</style></head><body>
<div class="panel">
  <div class="icn__gpv-modes">
    <button class="icn__gpv-mode is-on" type="button">文生视频</button>
    <button class="icn__gpv-mode" type="button">图生视频</button>
    <button class="icn__gpv-mode" type="button">首尾帧</button>
    <button class="icn__gpv-mode is-disabled" type="button">全能参考</button>
  </div>
  <div class="label">hover 第二项 / 选中第一项 / 禁用第四项</div>
  <div class="icn__gpv-modes" id="hover-row">
    <button class="icn__gpv-mode" type="button">文生视频</button>
    <button class="icn__gpv-mode" type="button">图生视频</button>
    <button class="icn__gpv-mode" type="button">首尾帧</button>
    <button class="icn__gpv-mode" type="button">全能参考</button>
  </div>
  <div class="label">workflow tabs</div>
  <div class="icn__gp-tabs">
    <button class="icn__gp-tab is-on" type="button">默认工作流</button>
    <button class="icn__gp-tab" type="button">高清修复</button>
    <button class="icn__gp-tab" type="button">首尾帧</button>
  </div>
</div>
</body></html>`;

fs.writeFileSync(path.join(ROOT, '__seg_demo.html'), html);
console.log('wrote __seg_demo.html', html.length);
