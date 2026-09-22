// The CITY tier fix inside Change Options Briefing, run against the node body.
//   node tools/scenario-4a/suite_briefing.js
// The node returns early unless requestType === 'change' (line ~167), so every
// case carries a draft description that classifies as one. Without it the node
// emits nothing and every assertion fails for the wrong reason.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Change_Options_Briefing.js', 'utf8');
const run = new Function('$input', '$', body);
const iso = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

function brief(o) {
  const j = { user_message: o.msg || '', history_text: '', current_draft_json: '{}',
              form_options_text: 'PRICED OPTIONS', only_access_level: '' };
  const ctx = { otp_pending: { brand: 'TrainMore', studioName: 'TrainMore Rotterdam Delftse Poort',
    rateName: o.rateName, customerStatus: 'MEMBER', contractCancelled: false,
    contractStartDate: iso(-400), contractEndDate: iso(200) } };
  const nodes = { 'When Called by Parent': [{ json: { draft: { description: o.draftDesc || 'membership change request' } } }],
                  'Prepare Prompt Variables': [{ json: { user_message: o.msg || '', history_text: '' } }],
                  'Fetch Session Context': [{ json: { body: [{ context: ctx }] } }] };
  const $ = (n) => ({ first: () => nodes[n][0], all: () => nodes[n] });
  return run({ all: () => [{ json: j }] }, $)[0].json.form_options_text;
}

let fail = 0;
const has = (name, text, re, want) => {
  if (re.test(text) !== want) { fail++; console.log('FAIL [' + name + ']'); }
};

// A real CITY rate name from a live session. Before the fix this member had no
// current access level at all, so no direction could be computed.
const city = brief({ rateName: 'TM BL B2C CITY RDM Delftse Poort', msg: 'I want PREMIUM instead' });
has('a CITY member now has a current access level', city, /Current access level: CITY\+/, true);
has('and the move to PREMIUM reads as an upgrade', city, /UPGRADE/, true);

const down = brief({ rateName: 'TM BL B2C CITY RDM Delftse Poort', msg: 'I want to go to HOME only' });
has('CITY+ down to HOME is a downgrade', down, /DOWNGRADE/, true);

// The tiers that already worked must be unchanged.
has('PREMIUM still parses', brief({ rateName: 'Premium TM Rijnhaven', msg: 'x' }), /Current access level: PREMIUM/, true);
has('HOME+ still parses', brief({ rateName: 'HOME+ Laan van NOI', msg: 'x' }), /Current access level: HOME\+/, true);
has('HOME still parses', brief({ rateName: 'HOME Sloterdijk', msg: 'x' }), /Current access level: HOME\b/, true);
has('PREMIUM still wins over a CITY in the same string',
    brief({ rateName: 'Corporate Direct Debit PREMIUM All Black Label', msg: 'x' }),
    /Current access level: PREMIUM/, true);

// Member prose: a bare "city" is a place, not a tier. This is a real message.
const place = brief({ rateName: 'HOME Sloterdijk', msg: 'What if i move to another city? Can I change to another black label?' });
has('"move to another city" is NOT read as the CITY+ tier', place, /moving to: CITY\+/, false);
const tier = brief({ rateName: 'HOME Sloterdijk', msg: 'I would like the city+ membership' });
has('"city+" with the plus IS the tier', tier, /CITY\+/, true);

console.log(fail === 0 ? 'ALL BRIEFING CASES GREEN' : fail + ' failures');
process.exit(fail ? 1 : 0);
