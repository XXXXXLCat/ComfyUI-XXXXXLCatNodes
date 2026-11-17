/* Validate the i18n EN dictionary: detect duplicate keys and placeholders. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'infcanvas-i18n.js'), 'utf8');

// Isolate the EN object literal.
const start = src.indexOf('const EN = {');
const end = src.indexOf('\n  };', start);
const body = src.slice(start, end);

const entries = [];
const re = /^\s{4}"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",?$/gm;
let m;
while ((m = re.exec(body))) entries.push({ key: m[1], val: m[2] });

const seen = new Map();
const dups = [];
for (const e of entries) {
  if (seen.has(e.key) && seen.get(e.key) !== e.val) dups.push(e.key);
  seen.set(e.key, e.val);
}
console.log('EN 词条数:', entries.length, '| 唯一:', seen.size);
console.log('重复 key 且值冲突:', JSON.stringify([...new Set(dups)]));

// Value placeholders must be a SUBSET of key placeholders. A translation may
// legitimately drop a Chinese-only token (e.g. measure word {measure}), but
// must never introduce a placeholder the caller does not pass.
const ph = (s) => new Set((s.match(/\{[a-zA-Z]+\}/g) || []));
const mism = [];
for (const e of entries) {
  const kp = ph(e.key), vp = ph(e.val);
  for (const p of vp) if (!kp.has(p)) mism.push({ key: e.key, extra: p });
}
console.log('占位符越界(value 有 key 无):', mism.length);
for (const x of mism) console.log('  ', JSON.stringify(x));

/* CAT_SHORT: every abbreviation key must be a real EN category key, and every
   abbreviated value must be a non-empty uppercase-ish token. */
const csStart = src.indexOf('const CAT_SHORT = {');
const csEnd = src.indexOf('};', csStart);
const csBody = src.slice(csStart, csEnd);
const shorts = [];
const csRe = /"([^"]+)":\s*"([^"]+)"/g;
let cm;
while ((cm = csRe.exec(csBody))) shorts.push({ key: cm[1], val: cm[2] });
const notCategory = shorts.filter((s) => !seen.has(s.key));
const badShort = shorts.filter((s) => !/^[A-Z][A-Za-z0-9& ]*$/.test(s.val));
console.log('CAT_SHORT 条数:', shorts.length, '| 非合法分类 key:', JSON.stringify(notCategory.map(s=>s.key)));
console.log('CAT_SHORT 非法缩写值:', JSON.stringify(badShort));
