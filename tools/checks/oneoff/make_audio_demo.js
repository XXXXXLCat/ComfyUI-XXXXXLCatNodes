const fs = require('fs');
const path = 'E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-flow.js';
const src = fs.readFileSync(path, 'utf8');

const start = src.indexOf('const CSS = `');
let i = start + 'const CSS = `'.length;
let buf = '';
while (i < src.length) {
  const c = src[i];
  if (c === '\\') { buf += src[i] + src[i + 1]; i += 2; continue; }
  if (c === '`') break;
  buf += c; i++;
}
const literal = '`' + buf + '`';

const consts = {};
const re = /const ([A-Z][A-Z0-9_]{2,}) = ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?[\d.]+);/g;
let m;
while ((m = re.exec(src))) {
  consts[m[1]] = /^["']/.test(m[2]) ? JSON.parse(m[2].replace(/^'|'$/g, '"')) : Number(m[2]);
}
// grab plotBox + KEEPOUT straight out of the module so the demo cannot drift
const boxSrc = src.match(/const BAR_ROW_KEEPOUT = (\d+);/)[0];
const proxy = new Proxy({}, { has: () => true, get: (t, k) => { if (typeof k === 'symbol') return undefined; if (k in consts) return consts[k]; throw new Error('unresolved interpolation: ' + String(k)); } });
const css = new Function('c', 'with (c) { return ' + literal + '; }')(proxy);
const barH = Number(src.match(/\.icn__bar \{[\s\S]*?height:(\d+)px/)[1]);
const keepout = Number(src.match(/const BAR_ROW_KEEPOUT = (\d+);/)[1]);

const speaker = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a4.5 4.5 0 0 0-1.5-3.35v6.7A4.5 4.5 0 0 0 15.5 12z"/></svg>';
const play = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

const demo = `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:#1d1d1d;font:13px system-ui}
#infcanvas-vueflow{position:relative;width:480px;height:270px;background:#262729;overflow:hidden;border-radius:12px}
${css}
</style>
<div id="infcanvas-vueflow">
  <div class="icn__wave-host"><canvas class="icn__wave" id="w"></canvas></div>
  <div class="icn__bar">
    <div class="icn__bar-left">
      <button class="icn__btn icn__btn--play" type="button">${play}</button>
      <span class="icn__time"><b>1:44</b>/<b>3:31</b></span>
    </div>
    <div class="icn__slider icn__seek"><span class="icn__slider-track"></span><span class="icn__slider-fill" style="width:196px"></span><span class="icn__slider-thumb" style="left:202px"></span></div>
    <span class="icn__vol-group">
      <button class="icn__btn icn__btn--vol" type="button">${speaker}</button>
      <div class="icn__slider icn__vol"><span class="icn__slider-track"></span><span class="icn__slider-fill" style="width:48px"></span><span class="icn__slider-thumb" style="left:54px"></span></div>
    </span>
  </div>
</div>
<script>
(() => {
  const BAR_ROW_KEEPOUT = ${keepout};
  const canvas = document.getElementById('w');
  const host = canvas.parentElement;
  const rect = host.getBoundingClientRect();
  const W = Math.round(rect.width), H = Math.round(rect.height);
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#232428'; ctx.fillRect(0, 0, W, H);
  const margin = H * 0.14;
  const top = Math.max(8, Math.min(margin, H - BAR_ROW_KEEPOUT - 24));
  const bottom = Math.max(margin, BAR_ROW_KEEPOUT);
  const boxH = Math.max(6, H - top - bottom);
  const middle = top + boxH / 2;
  const PAD = 14, span = W - PAD * 2, count = Math.floor(span / 5), step = span / count;
  ctx.lineCap = 'round';
  const headX = PAD + 0.31 * span;
  for (let i = 0; i < count; i += 1) {
    const x = PAD + (i + 0.5) * step;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.17) * Math.cos(i * 0.041));
    const barH = Math.max(2, env * boxH);
    ctx.strokeStyle = x <= headX ? '#4a9eff' : '#8b929e';
    ctx.lineWidth = Math.max(1.5, Math.min(3, step * 0.58));
    ctx.beginPath(); ctx.moveTo(x, middle - barH / 2); ctx.lineTo(x, middle + barH / 2); ctx.stroke();
  }
  ctx.strokeStyle = '#3d9cff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(headX + 0.5, top); ctx.lineTo(headX + 0.5, top + boxH); ctx.stroke();
  ctx.fillStyle = '#3d9cff';
  ctx.beginPath(); ctx.arc(headX, top, 5, 0, Math.PI * 2); ctx.fill();
  window.__geo = JSON.stringify({ W, H, top, bottom, boxH, middle, barH: ${barH}, keepout: BAR_ROW_KEEPOUT });
})();
</script>`;

fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/js/__audio_demo.html', demo);
console.log('written; barH', barH, 'keepout', keepout, 'expected top', 270 * 0.14, 'bottom', 68);
