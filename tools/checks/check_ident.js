const fs = require('fs');
const src = fs.readFileSync('E:/Workspace/Workspace-Infinite-Canvas/js/infcanvas-flow.js', 'utf8');

// 1) every ${IDENT} inside template literals must be a declared const/let/var/function/param somewhere
const interp = new Set();
const re = /\$\{\s*([A-Za-z_$][\w$]*)\s*[}.\[(,+\-*/?:|&<>!= \t]/g;
let m;
while ((m = re.exec(src))) interp.add(m[1]);

const declared = new Set();
const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g;
while ((m = declRe.exec(src))) declared.add(m[1]);
const fnRe = /\bfunction\s+([A-Za-z_$][\w$]*)/g;
while ((m = fnRe.exec(src))) declared.add(m[1]);
const paramRe = /(?:\(|,)\s*([A-Za-z_$][\w$]*)\s*(?=[,)=])/g;
while ((m = paramRe.exec(src))) declared.add(m[1]);
// destructured
const destrRe = /\{([^{}]*)\}\s*=/g;
while ((m = destrRe.exec(src))) m[1].split(',').forEach(p => { const k = p.split(':').pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(k)) declared.add(k); });

const missing = [...interp].filter(x => !declared.has(x));
console.log('interpolated identifiers:', interp.size);
console.log('NOT DECLARED (suspect):', missing.join(', ') || '(none)');

// 2) balance check of the big style/template strings
const bt = (src.match(/`/g) || []).length;
console.log('backticks:', bt, bt % 2 === 0 ? 'balanced' : 'UNBALANCED');
