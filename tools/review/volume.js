// Volume per case, in three clearly-separated tiers. Nothing is blended.
//
//  A  bot's own recogniser  - patterns.js, copied verbatim out of the live n8n
//                             nodes. Matching in JS for the same reason the
//                             scenario library does it: a regex-dialect
//                             difference must not make this disagree with the bot.
//  B  recorded outcome      - counted from a bot.* table. The case_library's own
//                             `measured` column, plus the session-state funnel.
//  C  none                  - left blank. Not estimated.
const fs = require('fs');
const https = require('https');
const PATTERNS = require(__dirname + '/../scenarios/patterns.js');

const OUT = __dirname;
const cases = JSON.parse(fs.readFileSync(OUT + '/cases.json', 'utf8'));
const msgs = JSON.parse(fs.readFileSync(OUT + '/messages.json', 'utf8'));

// Only the mappings where the recogniser and the case are the same thing.
// Deliberately partial: 5 of the 12 patterns have no unambiguous case, and a
// forced mapping is worse than a blank cell.
const PATTERN_TO_CASE = {
  cancellation:  'ss_early_cancellation',
  extension:     'ss_extension',
  change:        'ss_change_membership',
  freeze:        'pre_freeze',
  cooling_off:   'pre_cooling_off',
  wants_human:   'dead_asked_for_human',
  owes_money:    'acct_balance',
};

const replay = {};
for (const p of PATTERNS) {
  const caseKey = PATTERN_TO_CASE[p.key];
  if (!caseKey) continue;
  const sessions = new Set();
  let hits = 0;
  for (const m of msgs) {
    let ok = false;
    try { ok = p.test(String(m.content || '')); } catch (e) { ok = false; }
    if (ok) { hits++; sessions.add(m.session_id); }
  }
  replay[caseKey] = { pattern: p.key, source: p.source, messages: hits, sessions: sessions.size };
}

const totalSessions = new Set(msgs.map(m => m.session_id)).size;
const out = { generated_at: new Date().toISOString(), window: { from: '2026-08-11', to: '2026-09-10' }, total_sessions: totalSessions, replay };
fs.writeFileSync(OUT + '/volume.json', JSON.stringify(out, null, 2));

console.log('window sessions:', totalSessions, 'messages:', msgs.length);
console.log('');
console.log('case'.padEnd(24), 'pattern'.padEnd(14), 'msgs'.padStart(7), 'sessions'.padStart(9), ' % of sessions');
for (const [k, v] of Object.entries(replay)) {
  console.log(k.padEnd(24), v.pattern.padEnd(14), String(v.messages).padStart(7), String(v.sessions).padStart(9),
    '   ' + (100 * v.sessions / totalSessions).toFixed(1) + '%');
}
const declared = cases.filter(c => c.measured != null).length;
console.log('');
console.log('cases with a recorded outcome (measured):', declared, '/', cases.length);
console.log('cases with a replay count:', Object.keys(replay).length);
const covered = new Set([...cases.filter(c => c.measured != null).map(c => c.key), ...Object.keys(replay)]);
console.log('cases with SOME number:', covered.size, '/', cases.length, '-> blank:', cases.length - covered.size);
