/* Static mock of the other tool dialogs (变速 / 宫格 / 调整 / 视频截取 / 抽帧菜单)
   so the Nodes 2.0 skin can be screenshotted without the canvas. */
const fs = require('fs');
const src = fs.readFileSync('E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-tools.js', 'utf8');
const start = src.indexOf('const CSS = `') + 'const CSS = `'.length;
const end = src.indexOf('\n`;', start);
const css = src.slice(start, end);

const panel = (title, sub, body, foot) => `
<div class="ict-mask"><div class="ict-panel" style="width:760px">
  <div class="ict-head"><h3>${title}</h3><span class="ict-sub">${sub}</span>
    <button class="ict-x" type="button" title="关闭">&times;</button></div>
  <div class="ict-body">${body}</div>
  <div class="ict-foot"><span class="ict-status"></span>
    <div class="ict-actions">
      <button class="ict-btn" type="button">取消</button>
      ${foot}
    </div>
  </div>
</div></div>`;

const slider = (min, max, value) => `style="--ict-p:${(((value - min) / (max - min)) * 100).toFixed(1)}%"`;

const speed = panel('音频变速', '0.1× – 4× · FFmpeg atempo 保持音调', `
  <div class="ict-hint ict-speedinfo" style="margin-top:0">原时长 0:12.48  →  预计 0:08.32</div>
  <div class="ict-field" style="margin-top:12px">
    <input class="ict-slider-range" type="range" min="0.1" max="4" step="0.1" value="1.5" ${slider(0.1, 4, 1.5)} />
    <input class="ict-input ict-speed-number" type="number" value="1.50" />
  </div>
  <div class="ict-chips ict-presets" style="margin-top:12px">
    <button class="ict-chip" type="button">0.5×</button>
    <button class="ict-chip" type="button">0.75×</button>
    <button class="ict-chip" type="button">1×</button>
    <button class="ict-chip is-active" type="button">1.5×</button>
    <button class="ict-chip" type="button">2×</button>
    <button class="ict-chip" type="button">3×</button>
  </div>
  <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
    <button class="ict-btn ict-audition" type="button">&#9654; 试听</button>
    <span class="ict-hint" style="margin:0">按当前倍速实时播放试听（浏览器原生变速，音调会随速度变化）</span>
  </div>
  <p class="ict-hint">变速使用 FFmpeg atempo 链式处理，保持音调不变；结果会在右侧生成新的素材音频节点，原音频保留。</p>`,
  '<button class="ict-btn ict-btn--primary" type="button">生成变速音频</button>');

const grid = panel('宫格', '保留原图 · 最多 10 × 10', `
  <div class="ict-split">
    <div class="ict-preview"><div class="ict-crop-stage" style="width:300px;height:300px;background:#000">
      <div class="ict-grid-overlay"></div></div></div>
    <aside class="ict-side">
      <div><p class="ict-label">预设</p><div class="ict-grid-presets">
        ${[2, 3, 4, 5].map((n) => `<button class="ict-grid-preset${n === 3 ? ' is-active' : ''}" type="button">
          <i style="grid-template-columns:repeat(${n},1fr)">${'<b></b>'.repeat(n * n)}</i>
          <span>${n * n} 宫格</span></button>`).join('')}
      </div></div>
      <button class="ict-grid-custom-btn is-active" type="button">自定义</button>
      <div class="ict-grid-custom">
        <label class="ict-grid-slider-row"><span>行数</span>
          <input type="range" min="1" max="10" step="1" value="3" ${slider(1, 10, 3)} /><output>3</output></label>
        <label class="ict-grid-slider-row"><span>列数</span>
          <input type="range" min="1" max="10" step="1" value="5" ${slider(1, 10, 5)} /><output>5</output></label>
      </div>
      <p class="ict-summary" style="font-size:12px;color:#8a8a8a;margin:0">3 行 × 5 列 · 每格约 512 × 307</p>
      <p class="ict-hint">按相邻整数边界切分，不能整除的尺寸也不会丢失或重复边缘像素。原图保留。</p>
    </aside>
  </div>`,
  '<button class="ict-btn ict-btn--primary" type="button">切分为图片节点</button>');

const adjust = panel('调整', '参数 + 自定义 LUT 滤镜 · 生成新节点、原图保留', `
  <div class="ict-adjust">
    <div class="ict-preview" style="aspect-ratio:1"></div>
    <aside class="ict-side">
      <div class="ict-sliders">
        ${[['亮度', 40], ['对比度', 0], ['饱和度', -20]].map(([label, v]) => `
        <div class="ict-slider"><span>${label}</span>
          <input type="range" min="-100" max="100" step="1" value="${v}" ${slider(-100, 100, v)} />
          <output>${v}</output></div>`).join('')}
      </div>
      <div class="ict-lut-block">
        <p class="ict-label">滤镜 LUT</p>
        <div class="ict-lut-file">
          <button type="button" class="ict-btn ict-lut-pick">加载 LUT 文件</button>
          <button type="button" class="ict-btn ict-lut-remove">移除滤镜</button>
        </div>
        <p class="ict-lut-name">kodak_2383.cube</p>
        <div class="ict-lut-detail">
          <label class="ict-lut-strength"><span>强度</span>
            <input type="range" min="0" max="100" step="1" value="80" ${slider(0, 100, 80)} />
            <output>80%</output></label>
        </div>
      </div>
      <p class="ict-hint">11 项参数在线性光空间计算，LUT 滤镜按强度叠加；预览为 512px 下采样，导出使用原图全分辨率。</p>
    </aside>
  </div>`,
  '<button class="ict-btn ict-btn--primary" type="button">应用</button>');

const trim = panel('截取', '正在读取视频…', `
  <div class="ict-video-preview" style="min-height:120px"></div>
  <div class="ict-tl">
    <div class="ict-tl-head"><span>拖动左右边界，选择保留的片段</span><span>原视频 00:12.48</span></div>
    <div class="ict-track" style="height:34px"></div>
    <div class="ict-tl-ruler"><span>00:00.00</span><span>00:06.24</span><span>00:12.48</span></div>
  </div>
  <div class="ict-times">
    <label>开始时间 <input class="ict-input ict-start" type="number" value="0.00" /><span>秒</span></label>
    <label>结束时间 <input class="ict-input ict-end" type="number" value="12.48" /><span>秒</span></label>
    <span class="ict-length" style="margin-left:auto">时长 12.48 秒</span>
  </div>
  <p class="ict-hint">点击时间轴可预览对应画面；播放只播放选中的片段。截取后生成新视频节点，原视频会保留。</p>`,
  '<button class="ict-btn ict-btn--primary" type="button">截取</button>');

const menu = `<div class="ict-menu" style="position:static;display:inline-block">
  <button type="button">抽取当前帧 <span>00:03.21</span></button>
  <button type="button">抽取首帧</button>
  <button type="button">抽取尾帧</button>
</div>`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;background:#111;font-family:Inter,system-ui,"Segoe UI",sans-serif;}
.ict-mask{position:static!important;display:block!important;background:transparent!important;padding:14px!important;}
.ict-panel{margin:0 auto;}
.ict-body{max-height:none!important;}
</style><style>${css}</style></head>
<body>${speed}${grid}${adjust}${trim}<div class="ict-mask">${menu}</div></body></html>`;

fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/__dlg2_demo.html', html);
console.log('written', html.length);
