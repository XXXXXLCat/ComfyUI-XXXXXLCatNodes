const fs = require('fs');
const path = 'E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-flow.js';
const src = fs.readFileSync(path, 'utf8');

// 1) pull out the `const CSS = \`...\`;` literal verbatim
const start = src.indexOf('const CSS = `');
if (start < 0) throw new Error('CSS literal not found');
let i = start + 'const CSS = `'.length;
let buf = '';
while (i < src.length) {
  const c = src[i];
  if (c === '\\') { buf += src[i] + src[i + 1]; i += 2; continue; }
  if (c === '`') break;
  buf += c; i++;
}
const literal = '`' + buf + '`';

// 2) collect every top-level `const NAME = <literal>;` so interpolations resolve
const consts = {};
const re = /const ([A-Z][A-Z0-9_]{2,}) = ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?[\d.]+);/g;
let m;
while ((m = re.exec(src))) {
  consts[m[1]] = /^["']/.test(m[2]) ? JSON.parse(m[2].replace(/^'|'$/g, '"')) : Number(m[2]);
}
// aliases: const PAD_R = PAD_L;
const aliasRe = /const ([A-Z][A-Z0-9_]{2,}) = ([A-Z][A-Z0-9_]{2,});/g;
while ((m = aliasRe.exec(src))) {
  if (m[2] in consts) consts[m[1]] = consts[m[2]];
}
const proxy = new Proxy({}, {
  has: () => true,
  get: (t, k) => {
    if (typeof k === 'symbol') return undefined;
    if (k in consts) return consts[k];
    throw new Error('unresolved interpolation: ' + String(k));
  },
});
const css = new Function('c', 'with (c) { return ' + literal + '; }')(proxy);

const speaker = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a4.5 4.5 0 0 0-1.5-3.35v6.7A4.5 4.5 0 0 0 15.5 12z"/></svg>';
const play = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

const demo = `<!doctype html>
<meta charset="utf-8">
<style>html,body{margin:0;background:#262729;font:13px system-ui}
#infcanvas-vueflow{position:relative;width:480px;height:270px;background:#6a6a6a;overflow:hidden}
${css}
#infcanvas-vueflow{background:#6a6a6a}
</style>
<div id="infcanvas-vueflow">
  <div class="icn__bar">
    <div class="icn__bar-left">
      <button class="icn__btn icn__btn--play" type="button">${play}</button>
      <span class="icn__time"><b>0:12</b><i>/</i><b>1:00</b></span>
    </div>
    <div class="icn__slider icn__seek"><span class="icn__slider-track"></span><span class="icn__slider-fill" style="width:78px"></span><span class="icn__slider-thumb" style="left:84px"></span></div>
    <span class="icn__vol-group">
      <button class="icn__btn icn__btn--vol" type="button">${speaker}</button>
      <div class="icn__slider icn__vol"><span class="icn__slider-track"></span><span class="icn__slider-fill" style="width:48px"></span><span class="icn__slider-thumb" style="left:54px"></span></div>
    </span>
  </div>
</div>`;

fs.writeFileSync('E:/Workspace/Workspace-Infinite-Canvas/js/__bar_demo.html', demo);
console.log('demo written, css bytes:', css.length);
console.log('vol rules present:', /\.icn__vol-group:hover/.test(css), /border-radius:999px/.test(css));
