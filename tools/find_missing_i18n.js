/* Find t()/tr()/$t() keys used in JS that are missing from the EN dictionary. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const i18nSrc = fs.readFileSync(path.join(ROOT, 'js', 'infcanvas-i18n.js'), 'utf8');
const start = i18nSrc.indexOf('const EN = {');
const end = i18nSrc.indexOf('\n  };', start);
const dictBody = i18nSrc.slice(start, end);
const dictKeys = new Set([...dictBody.matchAll(/^\s{4}"((?:[^"\\]|\\.)*)":/gm)].map(m => m[1].replace(/\\"/g, '"')));

const files = fs.readdirSync(path.join(ROOT, 'js')).filter(f => /^infcanvas.*\.js$/.test(f) && f !== 'infcanvas-i18n.js');
const used = new Map(); // key -> files
for (const f of files) {
  const s = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  // match t("..."), tr("..."), $t("...") / $t('...')
  const re = /(?:\btr|\bt|\$t)\(\s*(["'])((?:\\.|(?!\1)[^\\])*?)\1/g;
  let m;
  while ((m = re.exec(s))) {
    const key = m[2].replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(f);
  }
}
const missing = [...used.keys()].filter(k => !dictKeys.has(k) && /[\u4e00-\u9fff]/.test(k));
console.log('使用的中文 key:', [...used.keys()].filter(k => /[\u4e00-\u9fff]/.test(k)).length);
console.log('字典缺失 (%d):', missing.length);
for (const k of missing.sort()) console.log('  ' + JSON.stringify(k) + '  <- ' + [...used.get(k)].join(','));
