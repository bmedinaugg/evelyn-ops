// What we actually know about the member, turned into decide4a's inputs.
//
// The bot holds exactly one bundle of member facts, stashed at login in
// session.context.otp_pending:
//     brand  customerStatus  rateName  studioId  studioName
//     contractStartDate  contractEndDate  contractCancelled
// and nothing else. Checked against 7,000 recent sessions, not assumed.
//
// NOT IN THERE, WHICH SETTLES ONE OF ESTHER'S ANSWERS
// There is no current price, no base price, no discount and no fee adjustment.
// Her Q3 suggestion — "if you have the base price and the price the member
// pays, shouldn't it be a simple math question?" — cannot be done from what the
// bot fetches today; it would need a new Magicline call in the auth workflow.
// So the fallback she agreed stands: state that an existing promotion carries
// over, never quote a number.
//
// DIRECTION COMES FROM THE FORM, NOT THE MEMBER'S ACCOUNT
// The guide: "the fee difference against the tier they're asking about — this
// is how the bot determines whether the hypothetical move is an upgrade or
// downgrade", and separately "none of these prices are ever derived from the
// individual member's account". Both hold at once only if the comparison uses
// the FORM's price for the member's current club+tier against the FORM's price
// for the destination. That is what compareOnForm does. Tier rank is only a
// fallback for when one side is missing from the form.

// Freshdesk spells it "CITY+", Magicline rate names spell it "CITY". Measured:
// 58 of 4,415 authenticated sessions (1.3%) are CITY members, and the live
// parser in Change Options Briefing returns blank for every one of them,
// because it tests PREMIUM / HOME+ / HOME only. Blank means no direction can be
// computed, so those members cannot be told whether their move is an upgrade.
// None of the 58 parse as anything else today, so adding CITY takes nothing
// away from another tier.
const TIER_RANK = { HOME: 0, 'HOME+': 1, 'CITY+': 2, PREMIUM: 3 };

function tierFromRateName(rateName) {
  const r = String(rateName || '');
  if (/\bPREMIUM\b/i.test(r)) return 'PREMIUM';
  if (/\bHOME\s*\+/i.test(r)) return 'HOME+';
  if (/\bCITY\s*\+?\b/i.test(r)) return 'CITY+';
  if (/\bHOME\b/i.test(r)) return 'HOME';
  return '';
}

const LABEL_NAME = { RL: 'Red Label', BL: 'Black Label', REG: 'Regular Label' };

function membershipTypeFromRateName(rateName) {
  const r = String(rateName || '');
  // Not \b: underscore counts as a word character, so \bBDF\b never matches
  // inside a real rate name like "CS_2018_BDF_Collectief".
  if (/(?:^|[^A-Za-z0-9])(?:workit|bedrijfsfitness|corporate.?fitness|bdf)(?:[^A-Za-z0-9]|$)/i.test(r)) return 'third_party';
  if (/\bB2B\b/i.test(r)) return 'b2b';
  if (/\b(STU|student)\b/i.test(r)) return 'student';
  // Q5: resident deals are recognised by a RES voucher code, which lives in
  // Settings > Corporate Fitness > Discount and is NOT in otp_pending. So they
  // cannot be identified here, and fall through as ordinary memberships — the
  // fallback Esther agreed for the first version.
  return 'normal';
}

// Guide: out of contract once less than one month from the end date.
// Q4 (Esther, 21 Sep): past the minimum term is ALWAYS out of contract, which
// the guide did not cover. A past end date is exactly that case.
function contractFacts(otp, now) {
  const end = String((otp || {}).contractEndDate || '').slice(0, 10);
  const start = String((otp || {}).contractStartDate || '').slice(0, 10);
  const t = now == null ? Date.now() : now;
  const out = { daysLeft: null, withinMonthOfEnd: false, pastMinimumTerm: false, currentTermYears: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    out.daysLeft = Math.floor((new Date(end + 'T00:00:00Z').getTime() - t) / 86400000);
    out.withinMonthOfEnd = out.daysLeft < 31 && out.daysLeft >= 0;
    out.pastMinimumTerm = out.daysLeft < 0;
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      const months = (new Date(end + 'T00:00:00Z') - new Date(start + 'T00:00:00Z')) / 86400000 / 30.44;
      // Terms are sold as 1, 2 or 3 years; round to the nearest and only accept
      // a close fit, so an odd span does not invent a 3-year contract and with
      // it a 3-year price the member may not be entitled to see. Tolerance is
      // two months: three let a 21-month span read as a 2-year contract.
      const years = Math.round(months / 12);
      if (years >= 1 && years <= 3 && Math.abs(months - years * 12) <= 2) out.currentTermYears = years;
    }
  }
  if (String((otp || {}).contractCancelled) === 'true') out.pastMinimumTerm = true;
  return out;
}

// price(club, tier) -> number|null, read from the change form and nowhere else.
function compareOnForm(priceOf, currentClub, currentTier, destClub, destTier) {
  const a = priceOf(currentClub, currentTier);
  const b = priceOf(destClub, destTier);
  if (a != null && b != null) {
    if (Math.abs(a - b) < 0.005) return 'same';
    return b > a ? 'upgrade' : 'downgrade';
  }
  const ra = TIER_RANK[currentTier];
  const rb = TIER_RANK[destTier];
  if (ra == null || rb == null) return null;      // unknown: ask, never guess
  if (ra === rb) return currentClub === destClub ? 'same' : null;
  return rb > ra ? 'upgrade' : 'downgrade';
}

// Everything decide4a needs, from what we have. Anything unknown stays null so
// decide4a reports it in `needs` rather than deciding on a guess.
function factsFor(otp, ask, priceOf, now) {
  const o = otp || {};
  const a = ask || {};
  const currentTier = tierFromRateName(o.rateName);
  const c = contractFacts(o, now);
  const price = priceOf || (() => null);
  return {
    authenticated: String(o.customerStatus || '') === 'MEMBER',
    currentTier,
    currentClub: o.studioName || '',
    currentLabel: LABEL_NAME[(String(o.rateName || '').match(/\b(RL|BL|REG)\b/i) || [])[1]?.toUpperCase()] || '',
    destinationClub: a.destinationClub || null,
    destinationTier: a.destinationTier || null,
    destinationHasStudentRate: a.destinationHasStudentRate,
    reason: a.reason || null,
    conversionTo: a.conversionTo,
    membershipType: membershipTypeFromRateName(o.rateName),
    currentTermYears: c.currentTermYears,
    pastMinimumTerm: c.pastMinimumTerm,
    withinMonthOfEnd: c.withinMonthOfEnd,
    direction: (currentTier && a.destinationTier)
      ? compareOnForm(price, o.studioName || '', currentTier, a.destinationClub || '', a.destinationTier)
      : null
  };
}

if (typeof module !== 'undefined') {
  module.exports = { factsFor, tierFromRateName, membershipTypeFromRateName, contractFacts, compareOnForm, TIER_RANK };
}
