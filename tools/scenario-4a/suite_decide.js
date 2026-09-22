// Scenario 4a decision core — every rule in the guide, and every answer Esther
// gave on 21 Sep, as a case. Run:  node tools/scenario-4a/suite_decide.js
//
// Each case names the clause it comes from, so a failure says which rule broke
// rather than which line of code did.
const { decide4a, OUTCOMES } = require('./decide');

const BASE = {
  authenticated: true,
  destinationClub: 'Amsterdam Sloterdijk (Regular Label)',
  destinationTier: 'HOME+ (Homeclub + Regular Label Clubs)',
  reason: 'price',
  direction: 'upgrade',
  currentTermYears: 1,
  membershipType: 'normal',
  pastMinimumTerm: false,
  withinMonthOfEnd: false
};
const on = (over) => decide4a({ ...BASE, ...over });

let fail = 0;
function check(name, got, want) {
  const bad = Object.entries(want).filter(([k, v]) =>
    JSON.stringify(got[k]) !== JSON.stringify(v));
  if (bad.length) {
    fail++;
    console.log('FAIL [' + name + ']');
    for (const [k, v] of bad) {
      console.log('        ' + k + ': want ' + JSON.stringify(v) + ', got ' + JSON.stringify(got[k]));
    }
  }
}

// --- guide: in contract ----------------------------------------------------
check('in contract, upgrade — end date stays, promotion kept',
  on({ direction: 'upgrade' }),
  { outcome: OUTCOMES.KEEPS_END_DATE, newContractStarts: false, endDateChanges: false, promotion: 'carried' });

check('in contract, downgrade — new term, promotion carries but no new one',
  on({ direction: 'downgrade' }),
  { outcome: OUTCOMES.NEW_TERM_STARTS, newContractStarts: true, endDateChanges: true, promotion: 'carried_no_new' });

// --- guide: the relocation exception ---------------------------------------
check('downgrade + relocation — treated as an upgrade, proof required',
  on({ direction: 'downgrade', reason: 'relocation' }),
  { outcome: OUTCOMES.KEEPS_END_DATE, newContractStarts: false, endDateChanges: false,
    promotion: 'carried', proofRequired: 'relocation' });

check('relocation proof criteria are given, not just demanded (Q10)',
  { n: on({ direction: 'downgrade', reason: 'relocation' }).proofCriteria.length > 0 },
  { n: true });

check('upgrade + relocation — proof still asked, it is about the move not the direction',
  on({ direction: 'upgrade', reason: 'relocation' }),
  { outcome: OUTCOMES.KEEPS_END_DATE, proofRequired: 'relocation' });

// --- guide + Q4: out of contract -------------------------------------------
check('within a month of the end date — new contract now, both promotions',
  on({ withinMonthOfEnd: true, direction: 'downgrade' }),
  { outcome: OUTCOMES.NEW_CONTRACT_NOW, newContractStarts: true, promotion: 'eligible_for_new' });

check('Q4: past the minimum term counts as out of contract even with no end date in sight',
  on({ pastMinimumTerm: true, direction: 'upgrade' }),
  { outcome: OUTCOMES.NEW_CONTRACT_NOW, newContractStarts: true, promotion: 'eligible_for_new' });

check('out of contract outranks the upgrade/downgrade split',
  on({ pastMinimumTerm: true, direction: 'downgrade' }),
  { outcome: OUTCOMES.NEW_CONTRACT_NOW });

// --- guide: conversions ----------------------------------------------------
check('B2B conversion — new 1-year whichever direction, code proof, person confirms',
  on({ conversionTo: 'b2b', direction: 'upgrade' }),
  { outcome: OUTCOMES.NEW_1Y_CONTRACT, termsToOffer: ['1 year'],
    proofRequired: 'corporate_code', handToTeam: true });

check('B2B outranks out-of-contract',
  on({ conversionTo: 'b2b', pastMinimumTerm: true }),
  { outcome: OUTCOMES.NEW_1Y_CONTRACT, termsToOffer: ['1 year'] });

check('resident deal follows the B2B rules (guide) — recognised upstream by RES voucher (Q5)',
  on({ membershipType: 'resident' }),
  { outcome: OUTCOMES.NEW_1Y_CONTRACT, proofRequired: 'corporate_code', handToTeam: true });

check('student conversion where the club HAS a student rate',
  on({ conversionTo: 'student', destinationHasStudentRate: true }),
  { outcome: OUTCOMES.NEW_1Y_CONTRACT, proofRequired: 'student_enrolment', handToTeam: false });

check('student conversion where the club does NOT — say so, do not take the request',
  on({ conversionTo: 'student', destinationHasStudentRate: false }),
  { notAvailableHere: true });

check('student conversion where nobody checked — never confirm it',
  on({ conversionTo: 'student' }),
  { handToTeam: true });

// --- guide: third party ----------------------------------------------------
check('third party — redirect, and decide nothing else',
  on({ membershipType: 'third_party', direction: 'downgrade', pastMinimumTerm: true }),
  { outcome: OUTCOMES.REDIRECT_THIRD_PARTY, handToTeam: true,
    newContractStarts: null, endDateChanges: null, promotion: null });

check('third party needs no club or reason first — the answer is the same',
  decide4a({ membershipType: 'third_party' }),
  { outcome: OUTCOMES.REDIRECT_THIRD_PARTY, needs: [] });

// --- guide: contract length options ----------------------------------------
check('3-year offered only when authenticated AND already on a 3-year',
  on({ authenticated: true, currentTermYears: 3 }),
  { termsToOffer: ['1 year', '2 years', '3 years'] });

check('authenticated but on a 1-year — no 3-year option',
  on({ authenticated: true, currentTermYears: 1 }),
  { termsToOffer: ['1 year', '2 years'] });

check('not authenticated — no 3-year even if they claim a 3-year contract',
  decide4a({ ...BASE, authenticated: false, currentTermYears: 3, direction: null }),
  { termsToOffer: ['1 year', '2 years'] });

// --- Q7: never quote the member's current price -----------------------------
check('Q7: current price is never quoted, overriding the guide\'s opening line',
  on({}), { quoteCurrentPrice: false });

// --- what must be known before anything is decided --------------------------
check('no destination club — ask, do not guess',
  decide4a({ ...BASE, destinationClub: null }),
  { outcome: null, needs: ['destination_club'] });

check('no reason — ask, because the reason changes the outcome',
  decide4a({ ...BASE, reason: null }),
  { outcome: null, needs: ['reason'] });

check('authenticated but direction unknown — do not assume a direction',
  decide4a({ ...BASE, direction: null }),
  { outcome: null, needs: ['direction'] });

check('Q8: the reason is a pick-list, not an open question',
  { n: on({}).reasonOptions.length >= 4, first: on({}).reasonOptions[0].key },
  { n: true, first: 'relocation' });

console.log(fail === 0 ? 'ALL 24 SCENARIO-4A CASES GREEN' : fail + ' failures');
process.exit(fail ? 1 : 0);
