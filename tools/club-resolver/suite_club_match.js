// Club resolution in Build Priced Options, run against the LIVE cf_clubs list.
//
//   node tools/club-resolver/suite_club_match.js [form_schemas.json]
//
// nodes/Build_Priced_Options.js is a byte-for-byte copy of the deployed n8n
// node (Bot - Ticket Collection Agent, Yq2zEE9NQo6hQvnO). The suite runs that
// body rather than restating its logic, so it cannot drift from what is live.
// After editing the node, fetch the body back out of n8n, overwrite the file
// here, and re-run.
//
// form_schemas.json in this directory is the committed club list, so the suite
// is deterministic. Both fixes here depend on the ACTUAL set of club names, so
// a club renamed into collision with another would not show up until that file
// is refreshed. Re-dump it whenever clubs are added or renamed, and re-run:
//   curl "$SUPABASE_URL/rest/v1/form_schemas?form_key=in.(trainmore_general_contact,trainmore_change_membership,trainmore_membership_extension,trainmore_early_cancellation)&select=form_key,field_key,field_type,required,question,options,position&order=form_key,position" \
//     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Accept-Profile: bot" \
//     > tools/club-resolver/form_schemas.json
// The sweep that found two of the three collisions is worth repeating too: for
// every club, its own exact full name must resolve to itself. It is 52/52 now.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Build_Priced_Options.js', 'utf8');
const rows = JSON.parse(fs.readFileSync(process.argv[2] || __dirname + '/form_schemas.json', 'utf8'));

function resolve(userMessage) {
  const prep = {
    session_id: 's', channel_user_id: 'c', user_message: userMessage, draft_id: 'd',
    customer_id: 'm', customer_name: 'Test',
    current_draft_json: '{"subject":null,"description":null,"category":null,"priority":null}',
    history_text: 'User: ' + userMessage
  };
  const nodes = {
    'Prepare Prompt Variables': [{ json: prep }],
    'Fetch Session Context': [{ json: { body: [{ context: {} }] } }],
    'Fetch Form Options': rows.map((r) => ({ json: r }))
  };
  const $ = (n) => ({ first: () => nodes[n][0], all: () => nodes[n] });
  const $input = { all: () => nodes['Fetch Form Options'], first: () => nodes['Fetch Form Options'][0] };
  const out = new Function('$input', '$', body)($input, $)[0].json;
  return { club: out.resolved_club || '', text: out.form_options_text || '' };
}

const CHANGE = 'I want to change my membership to ';
const cases = [
  // --- the collision this fix exists for --------------------------------------
  ['Rotterdam Rijnhaven (Black Label)', CHANGE + 'Rotterdam Rijnhaven'],
  ['Rotterdam Rijnhaven (Black Label)', CHANGE + 'Rotterdam Rijnhaven (Black Label)'],
  ['Rotterdam Rijnhaven (Black Label)', CHANGE + 'rijnhaven'],
  ['Rotterdam Wijnhaven (Red Label)', CHANGE + 'Rotterdam Wijnhaven'],
  ['Rotterdam Wijnhaven (Red Label)', CHANGE + 'wijnhaven'],

  // --- typo tolerance must SURVIVE everywhere it was not ambiguous ------------
  ['Amsterdam Scheldeplein (Black Label)', CHANGE + 'Scheldeplien'],
  ['Amsterdam Koninginneweg (Black Label)', CHANGE + 'Koninginewg'],
  ['Groningen Munnekeholm (Regular Label)', CHANGE + 'Munnekehom'],
  ['Amsterdam Rozengracht (Black Label)', CHANGE + 'Rozengraht'],

  // --- one name contained in another: the SHORTER club must still win when
  //     the member names it, or this fix would just invert the bug -----------
  ['Amsterdam Oost (Black Label)', CHANGE + 'Amsterdam Oost'],
  ['Amsterdam Oosterdok (Black Label)', CHANGE + 'Amsterdam Oosterdok'],
  ['Amsterdam Singel (Black Label)', CHANGE + 'Amsterdam Singel'],
  ['Rotterdam Coolsingel (Black Label)', CHANGE + 'Rotterdam Coolsingel'],
  ['Bussum Landstraat (Regular Label)', CHANGE + 'Bussum Landstraat'],
  ['Rotterdam Middellandstraat (Regular Label)', CHANGE + 'Rotterdam Middellandstraat'],
  ['Amsterdam West Ladies (Regular Label)', CHANGE + 'Amsterdam West Ladies'],

  // --- ordinary exact resolution still works ---------------------------------
  ['Amsterdam Sloterdijk (Regular Label)', CHANGE + 'Amsterdam Sloterdijk'],
  ['Amsterdam Slotervaart (Regular Label)', CHANGE + 'Amsterdam Slotervaart'],
  ['Amsterdam Piet Heinkade (Black Label)', CHANGE + 'Piet Heinkade'],
  ['Den Haag Laan van NOI (Black Label)', CHANGE + 'Laan van NOI']
];

let fail = 0;
for (const [want, msg] of cases) {
  const got = resolve(msg).club;
  if (got !== want) {
    fail++;
    console.log('FAIL [' + msg + ']\n      want ' + JSON.stringify(want) + '\n      got  ' + JSON.stringify(got));
  }
}

// A twin must never resolve on a typo -- that would just move the wrong answer
// rather than remove it. "rijnhave" is one edit from both, so neither may win.
const amb = resolve(CHANGE + 'rijnhave').club;
if (amb) { fail++; console.log('FAIL [typo across a twin pair resolved to ' + JSON.stringify(amb) + '; expected no club]'); }

console.log(fail === 0 ? ('ALL ' + (cases.length + 1) + ' CLUB-MATCH CASES GREEN') : (fail + ' failures'));
process.exit(fail ? 1 : 0);
