// The price gate in Validate Output, run against the real cf_clubs tree.
//
// Every "reject" case below is a reply the bot actually sent. The trees are
// copied verbatim from Freshdesk on 2026-09-21, so a case only passes if the
// guard agrees with the live form rather than with anything restated here.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Validate_Output.js', 'utf8');
const runNode = new Function('$input', '$', body);

const P = 'PREMIUM (Homeclub + Regular & Black Label Clubs)';
const HP = 'HOME+ (Homeclub + Regular Label Clubs)';
const H = 'HOME (Homeclub only)';
const TREE = {
  'Amsterdam Kraanspoor': { [P]: ['1 - year €96', '2 - years €89', '3 - years €82'] },
  'Amsterdam Noordermarkt (Red Label)': { [P]: ['1 - year €96', '2 - years €89', '3 - years €82', 'Flex - €116'] },
  'Amsterdam Piet Heinkade (Black Label)': {
    [HP]: ['1 - year €76', '2 - years €69', '3 - years €62', 'Flex - €96'],
    [P]: ['1 - year €92', '2 - years €85', '3 - years €78', 'Flex - €112'] },
  'Amsterdam Sloterdijk (Regular Label)': {
    [H]: ['1 - year €65', '2 - years €58', '3 - years €51', 'Flex - €85'],
    [HP]: ['1 - year €78', '2 - years €71', '3 - years €64', 'Flex - €100'],
    [P]: ['1 - year €96', '2 - years €89', '3 - years €82', 'Flex - €116'] },
  'Den Haag Laan van NOI (Black Label)': {
    [HP]: ['1 - year €76', '2 - years €69', '3 - years €62', 'Flex - €96'],
    [P]: ['1 - year €94', '2 - years €87', '3 - years €80', 'Flex - €114'] }
};
// Parnassusweg is the live disagreement between the two form fields: HOME
// 1-year is EUR72 on the change form and EUR64 on the extension form. It is in
// both trees below so the fallback path really does resolve to the wrong one,
// which is what makes the allowed_options cases below a regression test rather
// than a restatement.
const PARN = 'Amsterdam Parnassusweg (Regular Label)';
const H_ONLY = 'HOME (Homeclub only)';
TREE[PARN] = { [H_ONLY]: ['1 - year \u20ac72', '2 - years \u20ac67'] };
const EXT_TREE = { [PARN]: { [H_ONLY]: ['1 - year \u20ac64', '2 - years \u20ac57'] } };
const FORM_ROWS = [
  { form_key: 'trainmore_change_membership', field_key: 'cf_clubs', options: { choices: TREE } },
  { form_key: 'trainmore_membership_extension', field_key: 'cf_club_where_they_want_to_extend_at', options: { choices: EXT_TREE } }
];

function run(reply, resolvedClub, allowed) {
  const llm = { output: { reply_text: reply, transition: 'stay', field_updates: { category: 'membership', priority: 'medium' } } };
  const nodes = {
    'Prepare Prompt Variables': [{ json: { session_id: 's1', channel_user_id: 'c1', draft_id: 'd1', customer_id: 'm1' } }],
    'When Called by Parent': [{ json: { draft: { subject: 'x', description: 'y' }, missing_fields: [] } }],
    'Fetch Form Options': FORM_ROWS.map((r) => ({ json: r })),
    'Build Priced Options': [{ json: {
      resolved_club: resolvedClub || '',
      allowed_options: allowed || undefined,
      allowed_field: allowed ? 'cf_clubs' : undefined
    } }]
  };
  const $ = (name) => ({ first: () => nodes[name][0], all: () => nodes[name] });
  return runNode({ first: () => ({ json: llm }) }, $)[0].json;
}

const PH = 'Amsterdam Piet Heinkade (Black Label)';
const NOI = 'Den Haag Laan van NOI (Black Label)';
const NM = 'Amsterdam Noordermarkt (Red Label)';
const SL = 'Amsterdam Sloterdijk (Regular Label)';
const KR = 'Amsterdam Kraanspoor';

const cases = [
  // --- must be REJECTED: the four reproduced failures ------------------------
  ['reject', 'Piet Heinkade: 3-year price quoted as the 1-year',
    'For a 1-year contract the HOME+ price is €62 per 4 weeks.', PH],
  ['reject', 'Piet Heinkade: price before term',
    'That would be €62 per 4 weeks on a 1 year contract.', PH],
  ['reject', 'Noordermarkt: right price, wrong billing unit',
    'PREMIUM at Noordermarkt is €96 per month.', NM],
  ['reject', 'Noordermarkt: "a month" phrasing',
    'It comes to €96 a month for the 1 - year.', NM],
  ['reject', 'Laan van NOI: offers a tier the club does not sell',
    'Here are your options:\n1. HOME\n2. HOME+\n3. PREMIUM', NOI],
  ['reject', 'Laan van NOI: bulleted, bolded',
    'Available:\n- **HOME** - homeclub only\n- **PREMIUM**', NOI],
  ['reject', 'Kraanspoor: Flex term it does not sell',
    'You can also go Flex at €116 per 4 weeks.', KR],
  ['reject', 'price from another club entirely',
    'The 1 - year is €78 per 4 weeks.', NM],

  // --- must PASS -------------------------------------------------------------
  ['pass', 'Sloterdijk HOME+ 1 year, correct',
    'HOME+ at Sloterdijk is €78 per 4 weeks on a 1 year contract.', SL],
  ['pass', 'Piet Heinkade 3 years, correct',
    'On a 3 - years contract HOME+ is €62 per 4 weeks.', PH],
  ['pass', 'full correct option list',
    'Options at Sloterdijk:\n1. HOME - 1 year €65\n2. HOME+ - 1 year €78\n3. PREMIUM - 1 year €96\nAll prices are per 4 weeks.', SL],
  ['pass', 'Flex where the club sells Flex',
    'Flex is €116 per 4 weeks at Noordermarkt.', NM],
  ['pass', 'no price at all', 'Which club would you like to move to?', SL],
  ['pass', 'an outstanding balance is not a membership price',
    'You have an outstanding balance of €96 on your account from July.', NM],
  ['pass', 'a starter fee is not a membership price',
    'There is a one-off starter fee of €29.', SL],
  ['pass', 'a monthly figure that is not one of this club\'s prices',
    'Your direct debit of €41.50 failed this month.', SL],
  ['pass', 'no club resolved, guard has no opinion',
    'PREMIUM is €96 per month on a 1 year contract.', ''],
  ['pass', 'club not in the tree, guard has no opinion',
    'That is €55 per month for 1 year.', 'Utrecht Somewhere (Regular Label)'],
  ['pass', 'tier named in prose, not offered as an option',
    'You are currently on HOME, and at this club the options start at HOME+.', NOI],
  ['pass', 'account report: a rolling contract really is billed monthly',
    'For your account may@example.com (TrainMore Amsterdam Sloterdijk): your contract is rolling and the current price is \u20ac96 per month.', SL],
  ['pass', 'account report: a past charge that is not a form price',
    'For your account x@example.com: the charge of \u20ac65 on 25 August was for the previous period under the Flex plan.', SL],
  ['pass', 'account report in Dutch',
    'Voor je account x@example.com (TrainMore Amsterdam Noordermarkt): de prijs is \u20ac53 per maand.', NM],
  ['reject', 'an account report still may not OFFER a tier the club lacks',
    'For your account x@example.com (Laan van NOI). Your options:\n1. HOME\n2. PREMIUM', NOI],
  ['pass', 'numbered list that is not tiers',
    'Next steps:\n1. Confirm your club\n2. Pick a term\n3. I file the request', NOI]
];

// --- ONE ALLOWED SET: the gate must judge against what the member was SHOWN ---
// Before this, the gate merged both form fields and the extension price won, so
// it would have blocked the bot for quoting its own correct change-form option.
const shownOnChangeForm = { [H_ONLY]: ['1 - year \u20ac72', '2 - years \u20ac67'] };
cases.push(['pass', 'allowed_options: the price the member was actually shown is accepted',
  'HOME at Parnassusweg is \u20ac72 per 4 weeks on a 1 year contract.', PARN, shownOnChangeForm]);
cases.push(['reject', 'allowed_options: a price from the OTHER form field is still refused',
  'HOME at Parnassusweg is \u20ac64 per 4 weeks on a 1 year contract.', PARN, shownOnChangeForm]);
cases.push(['reject', 'allowed_options: a tier that was not shown is still refused',
  'Your options:\n1. HOME\n2. PREMIUM', PARN, shownOnChangeForm]);
cases.push(['pass', 'no allowed_options: falls back to the merged tree rather than failing shut',
  'Which club would you like?', PARN]);

let fail = 0;
for (const [want, name, reply, club, allowed] of cases) {
  const out = run(reply, club, allowed);
  const got = out.reply_rejected ? 'reject' : 'pass';
  if (got !== want) {
    fail++;
    console.log('FAIL [' + name + '] want=' + want + ' got=' + got + ' ' + (out.reply_rejected || ''));
  } else if (want === 'reject') {
    if (out.transition !== 'stay') { fail++; console.log('FAIL [' + name + '] rejected but transition=' + out.transition); }
    if (out.reply_text === reply) { fail++; console.log('FAIL [' + name + '] rejected but the wrong reply was still sent'); }
  } else if (out.reply_text !== reply) {
    fail++; console.log('FAIL [' + name + '] passed but the reply was altered');
  }
}
console.log(fail === 0 ? ('ALL ' + cases.length + ' PRICE CASES GREEN') : (fail + ' failures'));
process.exit(fail ? 1 : 0);
