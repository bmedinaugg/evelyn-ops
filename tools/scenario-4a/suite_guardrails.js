// The exploring bypass inside Change-Flow Guardrails, run against the node body.
//
//   node tools/scenario-4a/suite_guardrails.js
//
// nodes/Change_Flow_Guardrails.js is the deployed body plus the 4a patch. The
// suite executes it with stubbed n8n globals rather than restating its logic, so
// it cannot drift from what runs. After editing in n8n, fetch the body back,
// overwrite the file, and re-run.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Change_Flow_Guardrails.js', 'utf8');
const run = new Function('$input', '$', body);

const DAY = 86400000;
const iso = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);

function guard(opts) {
  const o = opts || {};
  const j = {
    user_message: o.msg || '',
    history_text: o.history || '',
    current_draft_json: o.draftJson || '{}',
    form_options_text: o.options || 'PRICED OPTIONS: HOME+ 1 year EUR78 per 4 weeks'
  };
  const ctx = {
    otp_pending: {
      brand: 'TrainMore',
      studioName: 'TrainMore Amsterdam Sloterdijk',
      rateName: o.rateName || 'HOME+ Sloterdijk',
      customerStatus: 'MEMBER',
      contractCancelled: o.cancelled === true,
      contractStartDate: o.start === undefined ? iso(-400) : o.start,
      contractEndDate: o.end === undefined ? iso(200) : o.end
    }
  };
  const nodes = {
    'When Called by Parent': [{ json: { draft: { description: o.draftDesc || '' } } }],
    'Fetch Session Context': [{ json: { body: [{ context: ctx }] } }]
  };
  const $ = (n) => ({ first: () => nodes[n][0], all: () => nodes[n] });
  const $input = { all: () => [{ json: j }] };
  return run($input, $)[0].json.form_options_text;
}

let fail = 0;
const REDIRECT = /SELF-SERVICE REDIRECT/;
const FOURA = /SCENARIO 4a — THE MEMBER IS EXPLORING/;
function check(name, text, wantFourA) {
  const isRedirect = REDIRECT.test(text);
  const is4a = FOURA.test(text);
  if (wantFourA && !is4a) { fail++; console.log('FAIL [' + name + '] expected the 4a block, got ' + (isRedirect ? 'the redirect' : 'neither')); }
  if (wantFourA && isRedirect) { fail++; console.log('FAIL [' + name + '] got BOTH the 4a block and the redirect'); }
  if (!wantFourA && is4a) { fail++; console.log('FAIL [' + name + '] got the 4a block, expected the redirect'); }
}

// --- exploring: the 4a conversation, not the link ---------------------------
check('what happens if I downgrade', guard({ msg: 'what happens if I downgrade my membership' }), true);
check('if I change clubs, does my price change', guard({ msg: 'If I change to another club, would my price change?' }), true);
check('Dutch hypothetical', guard({ msg: 'Wat gebeurt er als ik mijn abonnement wijzig?' }), true);
check('considering a downgrade', guard({ msg: 'I am considering a downgrade, do I lose my discount?' }), true);

// --- decided: the redirect must still fire ----------------------------------
check('I want to change my membership', guard({ msg: 'I want to change my membership' }), false);
check('Dutch polite request is DECIDED', guard({ msg: 'Ik zou het graag willen upgraden naar black label' }), false);
check('how do I change', guard({ msg: 'how do I change my membership?' }), false);
check('bare topic word', guard({ msg: 'membership change' }), false);

// --- the 4a block must carry the things Esther decided ----------------------
const t = guard({ msg: 'what happens if I downgrade my membership' });
const must = [
  ['creates no ticket', /do NOT create a ticket/i],
  ['never quotes the current price (Q7)', /NEVER state the price they pay today/i],
  ['reason is a pick-list (Q8)', /PICK-LIST/],
  ['relocation proof criteria stated up front (Q10)', /BRP uittreksel/],
  ['conversions are a new 1-year contract', /NEW 1-year contract/i],
  ['corporate code is never confirmed per club', /never confirm it works at a particular club/i],
  ['third party is a redirect to the provider', /third-party/i],
  ['the form link comes at the END, not as the answer', /When they say they want to go ahead/i]
];
for (const [name, re] of must) {
  if (!re.test(t)) { fail++; console.log('FAIL [4a block missing: ' + name + ']'); }
}

// --- contract state is decided in code, not by the model --------------------
const inContract = guard({ msg: 'what happens if I downgrade', end: iso(200) });
if (!/IN CONTRACT\./.test(inContract)) { fail++; console.log('FAIL [in-contract member not stated as IN CONTRACT]'); }

const outSoon = guard({ msg: 'what happens if I downgrade', end: iso(10) });
if (!/OUT OF CONTRACT/.test(outSoon)) { fail++; console.log('FAIL [within a month of the end date not stated as OUT]'); }

const rolling = guard({ msg: 'what happens if I downgrade', end: iso(-300) });
if (!/OUT OF CONTRACT/.test(rolling)) { fail++; console.log('FAIL [Q4: past the minimum term not stated as OUT]'); }

const cancelled = guard({ msg: 'what happens if I downgrade', cancelled: true });
if (!/OUT OF CONTRACT/.test(cancelled)) { fail++; console.log('FAIL [cancelled member not stated as OUT]'); }

const unknown = guard({ msg: 'what happens if I downgrade', end: null, start: null });
if (!/do NOT state which applies/.test(unknown)) { fail++; console.log('FAIL [unknown contract state should refuse to pick a branch]'); }

// --- precedence: the existing bypasses still outrank 4a ---------------------
const agent = guard({ msg: 'what happens if I downgrade, I want to speak to a human' });
if (FOURA.test(agent)) { fail++; console.log('FAIL [an agent request must outrank the 4a block]'); }

const corporate = guard({ msg: 'what happens if I convert to corporate with my company code?' });
if (FOURA.test(corporate)) { fail++; console.log('FAIL [a corporate conversion must outrank the 4a block]'); }

// --- the priced options survive underneath ---------------------------------
if (!/PRICED OPTIONS/.test(t)) { fail++; console.log('FAIL [the 4a block replaced the priced options instead of prefixing them]'); }

console.log(fail === 0 ? 'ALL GUARDRAIL CASES GREEN' : fail + ' failures');
process.exit(fail ? 1 : 0);
