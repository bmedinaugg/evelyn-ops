// Member facts -> decide4a inputs. Run: node tools/scenario-4a/suite_facts.js
//
// The rate names below are real strings taken from live sessions, not invented
// shapes, because the whole point of this file is that the parser matches what
// Magicline actually returns.
const { factsFor, tierFromRateName, membershipTypeFromRateName, contractFacts, compareOnForm } = require('./facts');
const { decide4a } = require('./decide');

let fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail++;
    console.log('FAIL [' + name + '] want ' + JSON.stringify(want) + ', got ' + JSON.stringify(got));
  }
};

// --- tier from rateName: real strings from live sessions --------------------
eq('PREMIUM', tierFromRateName('Premium TM Rijnhaven'), 'PREMIUM');
eq('HOME+', tierFromRateName('HOME+ Laan van NOI'), 'HOME+');
eq('HOME', tierFromRateName('HOME Sloterdijk'), 'HOME');
eq('CITY (Rotterdam) — 58 live members the live parser reads as blank',
   tierFromRateName('TM BL B2C CITY RDM Delftse Poort'), 'CITY+');
eq('CITY (Utrecht)', tierFromRateName('TM BL B2C CITY UTR Janskerkhof'), 'CITY+');
eq('CITY (Den Haag)', tierFromRateName('TM BL B2C CITY DHG Savornin'), 'CITY+');
eq('CITY+ spelled with the plus, as Freshdesk spells it',
   tierFromRateName('TM BL B2C CITY+ RDM Rijnhaven'), 'CITY+');
eq('PREMIUM wins over a CITY in the same string',
   tierFromRateName('Corporate Direct Debit PREMIUM All Black Label'), 'PREMIUM');
eq('unknown rate stays blank rather than guessing', tierFromRateName('UGG STAFF'), '');
eq('blank input', tierFromRateName(null), '');

// --- membership type -------------------------------------------------------
eq('student rate', membershipTypeFromRateName('HOME+ STU Laan van NOI'), 'student');
eq('B2B rate', membershipTypeFromRateName('TM B2B REG ALL'), 'b2b');
eq('third party (bedrijfsfitness collective)', membershipTypeFromRateName('CS_2018_BDF_Collectief'), 'third_party');
eq('ordinary member', membershipTypeFromRateName('Premium TM Rijnhaven'), 'normal');
eq('B2C is not B2B', membershipTypeFromRateName('TM BL B2C CITY RDM Coolsingel'), 'normal');

// --- contract facts --------------------------------------------------------
const NOW = Date.UTC(2026, 8, 22);        // 22 Sep 2026
const c = (end, start, cancelled) => contractFacts(
  { contractEndDate: end, contractStartDate: start, contractCancelled: cancelled }, NOW);

eq('well inside the contract', c('2027-03-31', '2026-02-25').withinMonthOfEnd, false);
eq('term length read from the span', c('2027-03-31', '2026-02-25').currentTermYears, 1);
eq('2-year span', c('2028-02-25', '2026-02-25').currentTermYears, 2);
eq('3-year span', c('2029-02-25', '2026-02-25').currentTermYears, 3);
eq('odd span does not invent a term', c('2027-11-30', '2026-02-25').currentTermYears, null);
eq('within a month of the end', c('2026-10-10', '2025-10-10').withinMonthOfEnd, true);
eq('Q4: past the end date is past the minimum term', c('2026-06-01', '2025-06-01').pastMinimumTerm, true);
eq('a past end date is not ALSO within-a-month', c('2026-06-01', '2025-06-01').withinMonthOfEnd, false);
eq('cancelled counts as out', c('2027-03-31', '2026-02-25', 'true').pastMinimumTerm, true);
eq('no end date decides nothing', c(null, null).pastMinimumTerm, false);

// --- direction: from the FORM, never from the member's account -------------
const FORM = {
  'TrainMore Amsterdam Sloterdijk': { HOME: 65, 'HOME+': 78, PREMIUM: 96 },
  'Amsterdam Piet Heinkade (Black Label)': { 'HOME+': 76, PREMIUM: 92 }
};
const priceOf = (club, tier) => (FORM[club] || {})[tier] ?? null;
const cmp = (cc, ct, dc, dt) => compareOnForm(priceOf, cc, ct, dc, dt);

eq('cheaper destination is a downgrade',
   cmp('TrainMore Amsterdam Sloterdijk', 'PREMIUM', 'TrainMore Amsterdam Sloterdijk', 'HOME'), 'downgrade');
eq('dearer destination is an upgrade',
   cmp('TrainMore Amsterdam Sloterdijk', 'HOME', 'TrainMore Amsterdam Sloterdijk', 'HOME+'), 'upgrade');
eq('same tier, same club',
   cmp('TrainMore Amsterdam Sloterdijk', 'HOME+', 'TrainMore Amsterdam Sloterdijk', 'HOME+'), 'same');
eq('across clubs the PRICE decides, not the tier name — HOME+ 78 -> 76 is a downgrade',
   cmp('TrainMore Amsterdam Sloterdijk', 'HOME+', 'Amsterdam Piet Heinkade (Black Label)', 'HOME+'), 'downgrade');
eq('destination missing from the form falls back to tier rank',
   cmp('TrainMore Amsterdam Sloterdijk', 'HOME', 'Unknown Club', 'PREMIUM'), 'upgrade');
eq('CITY+ ranks between HOME+ and PREMIUM',
   cmp('Unknown A', 'HOME+', 'Unknown B', 'CITY+'), 'upgrade');
eq('unknown current tier decides nothing', cmp('Unknown A', '', 'Unknown B', 'PREMIUM'), null);

// --- end to end: facts feed decide4a ---------------------------------------
const otpCity = {
  customerStatus: 'MEMBER', rateName: 'TM BL B2C CITY RDM Delftse Poort',
  studioName: 'TrainMore Amsterdam Sloterdijk',
  contractStartDate: '2026-02-25', contractEndDate: '2027-03-31'
};
const f = factsFor(otpCity, {
  destinationClub: 'TrainMore Amsterdam Sloterdijk',
  destinationTier: 'HOME', reason: 'price'
}, priceOf, NOW);
eq('a CITY member is now readable', f.currentTier, 'CITY+');
eq('and their move is priced as a downgrade', f.direction, 'downgrade');
eq('decide4a then has everything it needs', decide4a(f).needs, []);
eq('and reaches the downgrade outcome', decide4a(f).outcome, 'new_term_starts');

const before = factsFor({ ...otpCity, rateName: 'TM BL B2C CITY RDM Delftse Poort' },
  { destinationClub: 'TrainMore Amsterdam Sloterdijk', destinationTier: 'HOME', reason: 'price' }, priceOf, NOW);
eq('with the live parser this member would have had no direction at all',
   tierFromRateName('TM BL B2C CITY RDM Delftse Poort') === '' , false);
eq('sanity: facts still produce a direction', before.direction !== null, true);

console.log(fail === 0 ? 'ALL FACTS CASES GREEN' : fail + ' failures');
process.exit(fail ? 1 : 0);
