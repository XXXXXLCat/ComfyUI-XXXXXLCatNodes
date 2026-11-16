/* Builds a static mock of the audio "截取与拼接" dialog so the Nodes 2.0
   button/text skin can be screenshotted without opening the canvas. */
const fs = require('fs');
const src = fs.readFileSync('E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-tools.js', 'utf8');
const start = src.indexOf('const CSS = `') + 'const CSS = `'.length;
const end = src.indexOf('\n`;', start);
const css = src.slice(start, end);

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;font-family:Inter,system-ui,"Segoe UI",sans-serif;}
.ict-mask{position:static!important;display:block!important;background:transparent!important;padding:16px!important;}
.ict-panel{margin:0 auto;}
</style><style>${css}</style></head>
<body><div class="ict-mask"><div class="ict-panel" style="width:760px">
  <div class="ict-head"><h3>截取与拼接</h3><span class="ict-sub">正在读取音频…</span>
    <button class="ict-x" type="button" title="关闭">&times;</button></div>
  <div class="ict-body">
    <div class="ict-clip-tl">
      <div class="ict-clip-stage">
        <canvas class="ict-clip-wave" width="728" height="120"></canvas>
        <div class="ict-clip-track">
          <button class="ict-clip-seg" style="left:0%;width:18%">片段 1 · 3.42s</button>
          <button class="ict-clip-seg is-selected" style="left:18%;width:26%">片段 2 · 4.91s</button>
          <button class="ict-clip-seg" style="left:44%;width:31%">片段 3 · 5.87s</button>
          <button class="ict-clip-seg" style="left:75%;width:25%">片段 4 · 4.72s</button>
        </div>
        <span class="ict-clip-head" style="left:31%"></span>
      </div>
      <div class="ict-clip-ruler">${[0, 1, 2, 3, 4, 5].map((i) => `<span style="left:${i * 20}%">${i}:0${i}.00</span>`).join('')}</div>
    </div>
    <div class="ict-toolrow">
      <button class="ict-btn" type="button" data-act="undo">撤销</button>
      <button class="ict-btn" type="button" data-act="redo">重做</button>
      <span class="ict-sep"></span>
      <button class="ict-btn" type="button" data-act="split">分割</button>
      <button class="ict-btn" type="button" data-act="merge">粘合</button>
      <button class="ict-btn" type="button" data-act="remove">删除片段</button>
      <span class="ict-hint">Ctrl+Z 撤销 · Ctrl+Y 重做 · ←/→ 微调 0.1 秒</span>
    </div>
    <div class="ict-player">
      <button class="ict-btn ict-play" type="button" title="播放 / 暂停试听">&#9654;</button>
      <time><b class="ict-cur">0:08.42</b> / <span class="ict-total">0:19.02</span></time>
      <span class="ict-hint">点击片段或时间刻度定位播放头，分割后删除不需要的段落，导出时按保留顺序拼接。</span>
    </div>
  </div>
  <div class="ict-foot"><span class="ict-status">片段 2 / 4</span>
    <div class="ict-actions">
      <button class="ict-btn" type="button">取消</button>
      <button class="ict-btn ict-btn--primary" type="button">导出音频</button>
    </div>
  </div>
</div></div>
<script>
(() => {
  const c = document.querySelector('.ict-clip-wave');
  const ctx = c.getContext('2d');
  const n = 160, w = c.width / n;
  ctx.fillStyle = '#232428'; ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < n; i += 1) {
    const a = 0.25 + Math.abs(Math.sin(i * 0.31)) * 0.7;
    const h = a * c.height * 0.8;
    ctx.fillStyle = i < 50 ? '#4a9eff' : '#8b929e';
    ctx.fillRect(i * w + 1, (c.height - h) / 2, Math.max(1, w - 2), h);
  }
})();
</script>
</body></html>`;

fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/__dlg_demo.html', html);
console.log('written', html.length, 'css', css.length);
