// False-positive audit: run guard 4 over every real assistant reply from the
// last 21 days that could possibly reach it.
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const body = fs.readFileSync(__dirname + '/nodes/Break_Repeat_Loop.js', 'utf8');
const start = body.indexOf('// Guard 4: invented access levels');
const end = body.lastIndexOf('return [{ json: out, pairedItem: { item: 0 } }];');
const run = new Function('out', 'rp', 'nl', body.slice(start, end) + '\nreturn out;');

const hits = [];
for (const r of rows) {
  const out = run({ reply_text: r.c }, {}, false);
  if (out.invented_access_level_blocked) hits.push({ s: r.s, tok: out.invented_access_level_blocked, c: r.c });
}
console.log('scanned', rows.length, 'would-block', hits.length, 'sessions', new Set(hits.map(h => h.s)).size);
const byTok = {};
for (const h of hits) byTok[h.tok] = (byTok[h.tok] || 0) + 1;
console.log(JSON.stringify(byTok, null, 0));
fs.writeFileSync(__dirname + '/fp_hits.json', JSON.stringify(hits, null, 1));
for (const h of hits.slice(0, 12)) console.log('---', h.tok, '::', h.c.replace(/\n/g, ' | ').slice(0, 200));
