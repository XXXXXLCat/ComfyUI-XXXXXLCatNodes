const fs = require('fs');
const path = require('path');
const { compile } = require('E:/Workspace/Workspace-Infinite-Canvas/tools/vuebuild/node_modules/@vue/compiler-dom');

const file = 'E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-flow.js';
const s = fs.readFileSync(file, 'utf8');

// Extract every `template: `...`` literal. Handles escaped backtick and ${ } interpolation.
function extractTemplates(str) {
  const out = [];
  const re = /template:\s*`/g;
  let m;
  while ((m = re.exec(str))) {
    let i = m.index + m[0].length;
    let buf = '';
    let depth = 0;
    const BACKSLASH = String.fromCharCode(92);
    while (i < str.length) {
      const c = str[i];
      if (c === BACKSLASH) {
        const n = str[i + 1];
        if (n === '`') { buf += '`'; i += 2; continue; }
        buf += c + (n || '');
        i += 2;
        continue;
      }
      if (c === '$' && str[i + 1] === '{') { depth++; buf += '${'; i += 2; continue; }
      if (c === '}' && depth > 0) { depth--; buf += '}'; i++; continue; }
      if (c === '`' && depth === 0) break;
      buf += c;
      i++;
    }
    out.push(buf);
    re.lastIndex = i + 1;
  }
  return out;
}

const tpls = extractTemplates(s);
console.log('templates found:', tpls.length);
let ok = 0;
let fail = 0;
tpls.forEach((t, i) => {
  try {
    compile(t, { mode: 'module' });
    ok++;
  } catch (e) {
    fail++;
    console.log('FAIL template #' + i + ': ' + String(e.message).split('\n')[0]);
  }
});
console.log('compiled ok:', ok, 'failed:', fail);
