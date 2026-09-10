// End-to-end test of the patched Validate Output node with stubbed n8n globals.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Validate_Output.js', 'utf8');
const runNode = new Function('$input', '$', body);

const TREE = {
  'Amsterdam Scheldeplein (Black Label)': { 'HOME+ (Homeclub + Regular Label Clubs)': ['1 year: €60'], 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €78'] },
  'Amsterdam West Ladies (Regular Label)': { 'HOME (Homeclub only)': ['1 year: €50'], 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €76'] },
  'Amsterdam Westerpark (Red Label)': { 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €80'] },
  'Amsterdam van Woustraat (Regular Label)': { 'HOME (Homeclub only)': ['1 year: €48'] },
  'Rotterdam Blaak (Black Label)': { 'CITY+ (Homeclub + Regular Label Clubs Netherlands + Black Label Clubs Rotterdam)': ['1 year: €70'] }
};
const FORM_ROWS = [{ form_key: 'trainmore_change_membership', field_key: 'cf_clubs', options: { choices: TREE } }];

function run(fu, opts) {
  opts = opts || {};
  const llm = { output: { reply_text: opts.reply || 'ok', transition: opts.transition || 'stay', field_updates: fu } };
  const $input = { first: () => ({ json: llm }) };
  const nodes = {
    'Prepare Prompt Variables': [{ json: { session_id: 's1', channel_user_id: 'c1', draft_id: 'd1', customer_id: 'm1' } }],
    'When Called by Parent': [{ json: { draft: opts.draft || {}, missing_fields: [] } }],
    'Fetch Form Options': FORM_ROWS.map((r) => ({ json: r })),
    'Build Priced Options': [{ json: { resolved_club: opts.resolvedClub || '' } }]
  };
  const $ = (name) => ({ first: () => nodes[name][0], all: () => nodes[name] });
  return runNode($input, $)[0].json;
}

const base = { category: 'membership', priority: 'medium' };
const cases = [
  // --- must be REJECTED ------------------------------------------------------
  ['reject', 'ticket #634927 verbatim', { ...base, subject: 'Change membership to Wibeautstraat', description: 'User wants to change their membership to Wibeautstraat with VIP access level.' }, {}],
  ['reject', 'invented Basic level, real club', { ...base, subject: 'Membership change', description: 'Member wants Basic access level at Amsterdam Scheldeplein.' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)' }],
  ['reject', 'level/label mix-up in description', { ...base, subject: 'Change', description: 'Member picked HOME (Black Label club) at Amsterdam Scheldeplein.' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)' }],
  ['reject', 'access level: Standard', { ...base, subject: 'Change', description: 'Access level: Standard. Term 1 year.' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)' }],
  ['reject', 'invented club, no level', { ...base, subject: 'Club change', description: 'Member wants to move to Wibeautstraat.' }, {}],
  // --- must PASS -------------------------------------------------------------
  ['pass', 'real level + real club', { ...base, subject: 'Membership change request', description: 'Member wants PREMIUM (Homeclub + Regular & Black Label Clubs) access level at Amsterdam Scheldeplein, term 1 year: €78.' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)' }],
  ['pass', 'HOME+ prose', { ...base, subject: 'Upgrade', description: 'Member is on HOME and wants the HOME+ access level. Change type: upgrade.' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)' }],
  ['pass', 'CITY+ Rotterdam', { ...base, subject: 'Change', description: 'Member selected CITY+ access level at Rotterdam Blaak, 1 year.' }, { resolvedClub: 'Rotterdam Blaak (Black Label)' }],
  ['pass', 'real club named, no level yet', { ...base, subject: 'Club change', description: 'Member wants to move to Amsterdam Westerpark because they relocated.' }, {}],
  ['pass', 'no club claim at all', { ...base, subject: 'Payment question', description: 'Member asks about a €96 charge in July.' }, {}],
  ['pass', 'prose around access level', { ...base, subject: 'Change', description: 'Member asked which access level they need and whether the current access level carries over.' }, {}],
  ['pass', 'student conversion, no club', { ...base, subject: 'Student rate', description: 'Member wants to change to Student membership and will send proof.' }, {}],
  ['pass', 'club with label suffix in text', { ...base, subject: 'Change', description: 'Member wants to move to Amsterdam West Ladies (Regular Label).' }, {}],
  ['pass', 'empty updates', { ...base, subject: null, description: null }, { draft: { subject: 'x', description: 'y' } }],
];

let fail = 0;
for (const [want, name, fu, opts] of cases) {
  const out = run(JSON.parse(JSON.stringify(fu)), opts);
  const rejected = !!out.recording_rejected;
  const got = rejected ? 'reject' : 'pass';
  if (got !== want) {
    fail++;
    console.log('FAIL [' + name + '] want=' + want + ' got=' + got + ' ' + (out.recording_rejected || ''));
  } else if (rejected) {
    // the poisoned value must not be persisted
    const d = out.updated_draft || {};
    if ((d.description || '') === (fu.description || '')) { fail++; console.log('FAIL [' + name + '] rejected but description was still persisted'); }
    if (out.transition !== 'stay') { fail++; console.log('FAIL [' + name + '] rejected but transition=' + out.transition); }
  }
}
console.log(fail === 0 ? ('ALL ' + cases.length + ' VALIDATE CASES GREEN') : (fail + ' failures'));
