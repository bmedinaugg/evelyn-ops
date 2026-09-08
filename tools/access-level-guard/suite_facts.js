const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Access_Level_Facts.js', 'utf8');
const runNode = new Function('$input', '$', body);

const TREE = {
  'Amsterdam Scheldeplein (Black Label)': { 'HOME+ (Homeclub + Regular Label Clubs)': ['1 year: €60'], 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €78'] },
  'Amsterdam West Ladies (Regular Label)': { 'HOME (Homeclub only)': ['1 year: €50'], 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €76'] },
  'Amsterdam Westerpark (Red Label)': { 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €80'] },
  'Amsterdam Kraanspoor': { 'PREMIUM (Homeclub + Regular & Black Label Clubs)': ['1 year: €82'] },
  'Rotterdam Blaak (Black Label)': { 'CITY+ (Homeclub + Regular Label Clubs Netherlands + Black Label Clubs Rotterdam)': ['1 year: €70'] }
};
const FORM_ROWS = [{ form_key: 'trainmore_change_membership', field_key: 'cf_clubs', options: { choices: TREE } }];

function run(prep, opts) {
  opts = opts || {};
  const nodes = {
    'Prepare Prompt Variables': [{ json: prep }],
    'When Called by Parent': [{ json: { draft: opts.draft || {} } }],
    'Fetch Form Options': FORM_ROWS.map((r) => ({ json: r }))
  };
  const $ = (n) => ({ first: () => nodes[n][0], all: () => nodes[n] });
  const $input = { all: () => [{ json: { form_options_text: opts.text || '(prior text)', resolved_club: opts.resolvedClub || '', only_access_level: opts.onlyLevel || '' } }] };
  return runNode($input, $)[0].json;
}

let fail = 0;
const check = (name, cond) => { if (!cond) { fail++; console.log('FAIL ' + name); } };

// 1) session 742b7f8b — "amsterdam west", no club resolved, redirect had wiped
//    everything (form_options_text is only the redirect block).
const a = run({ user_message: 'what are the different access level?', history_text: 'User: Hi I want to change my horn studio to amsterdam west, because i have changed address\nAssistant: ...' },
  { text: 'SELF-SERVICE REDIRECT — HIGHEST PRIORITY ... membership change ...' });
check('742b7f8b block present', /ACCESS LEVELS AND CLUBS — GROUND TRUTH/.test(a.form_options_text));
check('742b7f8b lists real levels', /HOME \(Homeclub only\)/.test(a.form_options_text) && /PREMIUM \(Homeclub \+ Regular & Black Label Clubs\)/.test(a.form_options_text));
check('742b7f8b no club resolved warning', /NO CLUB IS RESOLVED YET/.test(a.form_options_text));
check('742b7f8b offers real Amsterdam clubs', /Amsterdam West Ladies \(Regular Label\)/.test(a.form_options_text) && /Amsterdam Westerpark \(Red Label\)/.test(a.form_options_text));
check('742b7f8b redirect text preserved below', /SELF-SERVICE REDIRECT/.test(a.form_options_text));
check('742b7f8b three labels only', /Exactly 3 club labels exist: Black Label, Red Label, Regular Label/.test(a.form_options_text));
check('742b7f8b no red-label reach line', /No access level reaches a DIFFERENT Red Label club/.test(a.form_options_text));
check('742b7f8b exports tokens', JSON.stringify(a.valid_access_level_tokens) === JSON.stringify(['CITY+', 'HOME', 'HOME+', 'PREMIUM']));

// 2) session 3fb2c0e8 — "wibeautstraat", no city, no club
const b = run({ user_message: 'What do you mean with acces level', history_text: 'User: I want to change my membership to wibeautstraat' }, { text: 'SELF-SERVICE REDIRECT — ...' });
check('3fb2c0e8 block present', /ACCESS LEVELS AND CLUBS/.test(b.form_options_text));
check('3fb2c0e8 has plain definition', /an access level decides WHICH CLUBS/.test(b.form_options_text));
check('3fb2c0e8 no club list (no city named)', !/The real clubs in/.test(b.form_options_text));
check('3fb2c0e8 club-name rule', /wibeautstraat" is not a club/.test(b.form_options_text));

// 3) club resolved -> narrows to that club's levels
const c = run({ user_message: '2', history_text: 'User: I want to change to Amsterdam Scheldeplein' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)', text: 'CHANGE FORM — STEP 1 ...' });
check('resolved narrows', /The ONLY access levels Amsterdam Scheldeplein \(Black Label\) offers are/.test(c.form_options_text));
check('resolved excludes HOME', !/- HOME \(Homeclub only\)[\s\S]*offers are/.test(c.form_options_text.split('offers are')[1] || ''));
check('resolved no club-not-resolved text', !/NO CLUB IS RESOLVED YET/.test(c.form_options_text));

// 4) single-level club
const d = run({ user_message: 'Kraanspoor', history_text: 'User: change my club to Kraanspoor' }, { resolvedClub: 'Amsterdam Kraanspoor', onlyLevel: 'PREMIUM (Homeclub + Regular & Black Label Clubs)' });
check('single level stated', /has exactly ONE access level/.test(d.form_options_text));

// 5) non-change request types are untouched
const e = run({ user_message: 'I want to cancel my membership', history_text: '' }, { text: 'ORIGINAL' });
check('cancellation untouched', e.form_options_text === 'ORIGINAL');

console.log(fail === 0 ? 'ALL FACTS CASES GREEN' : fail + ' failures');

// 6) the briefing's "ask the access level" sentence is removed from the prompt
//    when no club is resolved, and left alone when one is.
const BRIEF = 'INTERNAL — INSTRUCTIONS TO YOU, THE ASSISTANT.\n- Ask ONE short question for the single missing detail — the access level, taken from the club options below — and nothing else. If the club options below show exactly ONE access level, do not ask at all: take it as given.\n\nThe blocks below are background facts only; the rules above win.\n\nCLUB NOT CHOSEN YET. Ask the member which club...';
const f = run({ user_message: 'what are the different access level?', history_text: 'User: change my studio to amsterdam west' }, { text: BRIEF });
check('rewrite fired', f.briefing_ask_level_rewritten === true);
check('ask-level sentence gone', !/taken from the club options below/.test(f.form_options_text));
check('club-first sentence in', /WHICH CLUB they want to move to/.test(f.form_options_text));
const g = run({ user_message: '2', history_text: 'User: change to Amsterdam Scheldeplein' }, { resolvedClub: 'Amsterdam Scheldeplein (Black Label)', text: BRIEF });
check('rewrite not fired when club known', g.briefing_ask_level_rewritten === undefined);
check('ask-level sentence kept when club known', /taken from the club options below/.test(g.form_options_text));
console.log(fail === 0 ? 'ALL FACTS CASES GREEN (incl. rewrite)' : fail + ' failures');
