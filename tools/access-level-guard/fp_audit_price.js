// False-positive audit for the price gate: run it over every real assistant
// reply from the last 21 days that mentions a price.
//
//   node tools/access-level-guard/fp_audit_price.js <corpus.json> <form_rows.json>
//
// The corpus is not committed (real member conversations). Produce it with the
// query in run.js, and the form rows with a live read of Freshdesk ticket_fields.
//
// RESOLVING THE CLUB
// The guard only has an opinion once a club has resolved, and the corpus does
// not carry Build Priced Options' output. So the club is approximated: the most
// recent club name mentioned anywhere earlier in the same session. That is the
// same signal the resolver uses, and it errs toward MORE replies being checked
// than production would check -- which is the safe direction for an audit.
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const FORM_ROWS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const body = fs.readFileSync(__dirname + '/nodes/Validate_Output.js', 'utf8');
const runNode = new Function('$input', '$', body);

const CLUBS = [];
for (const r of FORM_ROWS) {
  for (const c of Object.keys((r.options && r.options.choices) || {})) CLUBS.push(c);
}
// Longest first, so "Amsterdam West Ladies" wins over "Amsterdam West".
const NEEDLES = [...new Set(CLUBS)]
  .map((c) => ({ full: c, bare: c.replace(/\((Red|Black|Regular) Label\)/i, '').replace(/[-–]\s*opens.*$/i, '').trim() }))
  .sort((a, b) => b.bare.length - a.bare.length);

// Only replies naming exactly ONE club are audited. The earlier version took
// the most recent club mentioned anywhere in the session, which repeatedly
// picked the member's CURRENT club while the bot was quoting the DESTINATION
// -- so it measured the approximation, not the guard.
function soleClubIn(text) {
  const t = String(text || '').toLowerCase();
  const found = new Set();
  for (const n of NEEDLES) {
    if (n.bare.length > 6 && t.includes(n.bare.toLowerCase())) found.add(n.bare.toLowerCase());
  }
  // Drop names contained in a longer match ("Amsterdam West" inside "West Ladies").
  const kept = [...found].filter((a) => ![...found].some((b) => b !== a && b.includes(a)));
  return kept.length === 1 ? NEEDLES.find((n) => n.bare.toLowerCase() === kept[0]).full : null;
}

function run(reply, resolvedClub) {
  const llm = { output: { reply_text: reply, transition: 'stay', field_updates: { category: 'membership', priority: 'medium' } } };
  const nodes = {
    'Prepare Prompt Variables': [{ json: { session_id: 's', channel_user_id: 'c', draft_id: 'd', customer_id: 'm' } }],
    'When Called by Parent': [{ json: { draft: { subject: 'x', description: 'y' }, missing_fields: [] } }],
    'Fetch Form Options': FORM_ROWS.map((r) => ({ json: r })),
    'Build Priced Options': [{ json: { resolved_club: resolvedClub || '' } }]
  };
  const $ = (name) => ({ first: () => nodes[name][0], all: () => nodes[name] });
  return runNode({ first: () => ({ json: llm }) }, $)[0].json;
}

const lastClub = {};
const hits = [];
let checked = 0;
for (const r of rows) {
  const club = soleClubIn(r.content);
  if (!club) continue;
  checked++;
  const out = run(r.content, club);
  if (out.reply_rejected) hits.push({ s: r.session_id, club, why: out.reply_rejected, c: r.content });
}

console.log('scanned', rows.length, '| club resolved for', checked, '| would-block', hits.length,
            'across', new Set(hits.map((h) => h.s)).size, 'sessions');
const byKind = {};
for (const h of hits) {
  const k = h.why.replace(/€[0-9.,]+/g, '€X').replace(/: .*/, '');
  byKind[k] = (byKind[k] || 0) + 1;
}
console.log(JSON.stringify(byKind, null, 1));
fs.writeFileSync(__dirname + '/fp_price_hits.json', JSON.stringify(hits, null, 1));
for (const h of hits.slice(0, 8)) {
  console.log('\n=== ' + h.club + ' :: ' + h.why + '\n' + h.c.slice(0, 700));
}
