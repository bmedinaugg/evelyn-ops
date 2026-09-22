// Scenario 4a decision core — "what would happen if I changed?"
//
// Esther Rumora's guide of 15 Sep 2026, plus her answers of 21 Sep to the ten
// questions in docs/scenario-4a-questions-for-esther.docx. Pure function: no
// n8n globals, no I/O, no model. Everything it needs is in the input, and the
// same body is meant to be pasted into a Code node later so the tests cannot
// drift from what runs.
//
// WHAT THIS DOES NOT DO
// It does not price anything. Prices come from the change form (cf_clubs) and
// nowhere else — the guide is explicit that no price is ever derived from the
// member's own account. This decides what HAPPENS to the contract; the caller
// renders the numbers.
//
// WHERE ESTHER'S ANSWERS OVERRODE THE GUIDE
//   Q4  Past the minimum term counts as OUT OF CONTRACT, always. The guide only
//       defined "within one month of the end date", which left rolling members
//       — a large group — with no answer at all.
//   Q7  The guide opens with the member's CURRENT rate ("you have a 1-year
//       contract at this club, currently at [rate]"). Esther: quote the NEW
//       pricing always, not the old, "to avoid mistakes or hallucination". So
//       quoteCurrentPrice is false and there is no input for the current price.
//   Q1  Tier availability is NOT the guide's per-label table. CITY+ is real and
//       Kraanspoor is a Red Label, so availability comes from the form's club
//       tree, passed in as availableTiers. The table is not reproduced here.
//   Q8  The reason is asked as a pick-list, not an open question.
//   Q10 Relocation always requires proof, and the criteria are stated with the
//       ask rather than sprung later.

const OUTCOMES = {
  REDIRECT_THIRD_PARTY: 'redirect_third_party',
  NEW_CONTRACT_NOW: 'new_contract_now',
  NEW_1Y_CONTRACT: 'new_1y_contract',
  KEEPS_END_DATE: 'keeps_end_date',
  NEW_TERM_STARTS: 'new_term_starts'
};

// Reason pick-list (Q8). Order is the order the member sees.
const REASONS = [
  { key: 'relocation', label: 'I am moving / relocating' },
  { key: 'price', label: 'I want a different price' },
  { key: 'access', label: 'I want access to more (or fewer) clubs' },
  { key: 'club', label: 'I want a different home club' },
  { key: 'student', label: 'I am becoming a student' },
  { key: 'corporate', label: 'I have a corporate code' },
  { key: 'other', label: 'Something else' }
];

// Stated with the ask, not after the member commits (Q10).
const RELOCATION_PROOF = [
  'a rental contract or deed in your name',
  'a municipal registration (BRP uittreksel)',
  'an employer letter showing the new work location'
];

function decide4a(input) {
  const i = input || {};
  const notes = [];
  const needs = [];

  // ---- what we must be told before any of this means anything -------------
  // Returned rather than thrown: the caller asks for the missing piece, and a
  // half-known answer is never rendered as a confident one.
  if (!i.destinationClub) needs.push('destination_club');
  if (!i.reason) needs.push('reason');
  if (i.membershipType !== 'third_party') {
    if (!i.destinationTier) needs.push('destination_tier');
    if (i.authenticated && i.direction == null) needs.push('direction');
  }

  const out = {
    outcome: null,
    newContractStarts: null,
    endDateChanges: null,
    promotion: null,           // 'carried' | 'carried_no_new' | 'eligible_for_new' | null
    proofRequired: null,       // 'relocation' | 'corporate_code' | 'student_enrolment'
    proofCriteria: null,
    termsToOffer: [],
    quoteCurrentPrice: false,  // Q7 — never, by decision
    handToTeam: false,
    reasonOptions: REASONS,
    needs,
    notes
  };

  // ---- 1. third party outranks everything ---------------------------------
  // Workit / bedrijfsfitness: the answer is not ours to give, so nothing below
  // is computed. Deciding anything here would be answering on rules that do
  // not govern this member.
  if (i.membershipType === 'third_party') {
    out.outcome = OUTCOMES.REDIRECT_THIRD_PARTY;
    out.handToTeam = true;
    out.needs = [];
    notes.push('Third-party membership: the provider decides whether a change is even allowed, ' +
               'so this is a redirect rather than something to answer on TrainMore rules.');
    return out;
  }

  if (needs.length) return out;   // nothing decided until the gaps are closed

  // ---- 2. terms the member may be shown (guide: contract length options) ---
  // 3 years needs BOTH authentication and an existing 3-year contract. Anything
  // less and it is never shown or priced.
  out.termsToOffer = (i.authenticated && i.currentTermYears === 3)
    ? ['1 year', '2 years', '3 years']
    : ['1 year', '2 years'];
  if (!i.authenticated) {
    notes.push('Not signed in: no 3-year option, and nothing about this member\'s own contract.');
  }

  // ---- 3. conversions: always a new 1-year contract, proof required --------
  // Direction is irrelevant here, which is why this sits above the
  // upgrade/downgrade split.
  if (i.conversionTo === 'b2b' || i.membershipType === 'resident') {
    out.outcome = OUTCOMES.NEW_1Y_CONTRACT;
    out.newContractStarts = true;
    out.endDateChanges = true;
    out.termsToOffer = ['1 year'];
    out.proofRequired = 'corporate_code';
    // Q2 unresolved: no code -> club mapping exists anywhere we can read, so
    // the bot must not confirm a code works at a club. It says what happens and
    // lets a person confirm applicability.
    out.handToTeam = true;
    notes.push('Corporate/resident rate: always a new 1-year contract, whichever direction the ' +
               'move is. A corporate code is not valid at every club and we cannot check which, ' +
               'so a colleague confirms before anything is promised.');
    return out;
  }
  if (i.conversionTo === 'student') {
    out.outcome = OUTCOMES.NEW_1Y_CONTRACT;
    out.newContractStarts = true;
    out.endDateChanges = true;
    out.termsToOffer = ['1 year'];
    out.proofRequired = 'student_enrolment';
    if (i.destinationHasStudentRate === false) {
      out.handToTeam = false;
      notes.push('This club does not offer a student membership, so the conversion is not ' +
                 'possible there. Say so plainly rather than taking the request.');
      out.outcome = OUTCOMES.NEW_1Y_CONTRACT;
      out.notAvailableHere = true;
    } else if (i.destinationHasStudentRate == null) {
      out.handToTeam = true;
      notes.push('Whether this club has a student rate has not been checked — do not confirm it.');
    }
    return out;
  }

  // ---- 4. out of contract beats the upgrade/downgrade split ---------------
  // Q4: past the minimum term counts, not only "within a month of the end
  // date". Rolling members have no end date at all and are a large group.
  const outOfContract = i.pastMinimumTerm === true || i.withinMonthOfEnd === true;
  if (outOfContract) {
    out.outcome = OUTCOMES.NEW_CONTRACT_NOW;
    out.newContractStarts = true;
    out.endDateChanges = true;
    out.promotion = 'eligible_for_new';
    notes.push('Out of contract, so a new contract would start now whichever way the move goes. ' +
               'Mention BOTH an extension promotion and the new-member promotion on the website — ' +
               'not just the change itself.');
    if (i.pastMinimumTerm === true && i.withinMonthOfEnd !== true) {
      notes.push('Past the minimum term on a rolling contract: out of contract, by Esther\'s ' +
                 'answer of 21 Sep, even though there is no end date approaching.');
    }
    return out;
  }

  // ---- 5. in contract ------------------------------------------------------
  const relocating = i.reason === 'relocation';
  const isDowngrade = i.direction === 'downgrade';

  if (isDowngrade && relocating) {
    // The relocation exception: a downgrade is treated as an upgrade.
    out.outcome = OUTCOMES.KEEPS_END_DATE;
    out.newContractStarts = false;
    out.endDateChanges = false;
    out.promotion = 'carried';
    out.proofRequired = 'relocation';
    out.proofCriteria = RELOCATION_PROOF;
    notes.push('Downgrade alongside a move: treated as an upgrade, so the end date stays and any ' +
               'promotion is kept. Proof of the move is required — ask for it now, with the ' +
               'criteria, rather than after they commit.');
    return out;
  }

  if (isDowngrade) {
    out.outcome = OUTCOMES.NEW_TERM_STARTS;
    out.newContractStarts = true;
    out.endDateChanges = true;
    out.promotion = 'carried_no_new';
    notes.push('Downgrade while in contract: a new term starts, so the end date moves. No new ' +
               'promotion is granted, but an existing one carries over.');
    return out;
  }

  out.outcome = OUTCOMES.KEEPS_END_DATE;
  out.newContractStarts = false;
  out.endDateChanges = false;
  out.promotion = 'carried';
  notes.push('Upgrade while in contract: the end date stays, no new contract starts, and any ' +
             'active promotion is kept as-is.');
  // Relocation proof is about the MOVE, not the direction, so it is still asked
  // for when an upgrade coincides with one (Q10).
  if (relocating) {
    out.proofRequired = 'relocation';
    out.proofCriteria = RELOCATION_PROOF;
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { decide4a, OUTCOMES, REASONS, RELOCATION_PROOF };
