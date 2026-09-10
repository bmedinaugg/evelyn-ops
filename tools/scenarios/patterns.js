// Scenario recognisers, copied VERBATIM from the live n8n nodes.
// `source` names the node so a reader can verify, and so regeneration can be
// diffed against the workflow after any change.
module.exports = [
  {
    key: 'cancellation',
    label: 'Early cancellation / wants to leave',
    plain: 'Member wants to end their membership. The word "cancel" is enough on its own.',
    source: 'Build Priced Options + Change Options Briefing — shared requestType classifier',
    test: (m) => /cancel|opzeg/i.test(m),
  },
  {
    key: 'extension',
    label: 'Extension / renewal',
    plain: 'Member wants to extend or renew, before the classifier considers anything else.',
    source: 'Build Priced Options + Change Options Briefing — checked FIRST, so it wins over "change"',
    test: (m) => /extension|extend|verleng/i.test(m),
  },
  {
    key: 'change',
    label: 'Membership change (club or access level)',
    plain: 'Switching club, moving home club, or changing access level.',
    source: 'Build Priced Options + Change Options Briefing',
    test: (m) => /change|switch|upgrade|convert|home club|access level|wijzig|verander|overstap|thuisclub/i.test(m)
      || /transfer|overzetten|overschrijven|verplaats|downgrade|ander(e)? (club|gym|vestiging)|other (club|gym)|move my (membership|contract|subscription)|red label|black label|regular label/i.test(m)
      || /\b(changing|upgrading)\b(?! (room|rooms|area|areas|facility|facilities|locker|lockers|cubicle|kleedkamer))[a-z0-9 ]{0,30}\b(club|clubs|gym|gyms|membership|memberships|subscription|abonnement|lidmaatschap|home|label|labels|contract|location|studio|vestiging)\b/i.test(m)
      || /\b(club|clubs|gym|gyms|membership|memberships|subscription|abonnement|lidmaatschap|home|label|labels|contract|location|studio|vestiging)\b[a-z0-9 ]{0,20}\b(changing|upgrading)\b(?! (room|rooms|area|areas|facility|facilities|locker|lockers|cubicle|kleedkamer))/i.test(m),
  },
  {
    key: 'freeze',
    label: 'Freeze / put on hold (idle period)',
    plain: 'Pausing the membership. Medical only — travel does not qualify.',
    source: 'Feedback Overrides 2026-08-26 — FREEZE_RE',
    test: (m) => /\b(bevriez\w*|bevries\w*|bevroren|pauzer\w*|pauze\w*|paus\w*|stilzet\w*|stopzett\w*|freez\w*|frozen|idle period|slaapstand)\b|\b(on|op) hold\b|\b(hold|halt|suspend|stilleggen)\b[^.?!]{0,25}\b(membership|subscription|contract|abonnement|lidmaatschap)\b|\b(membership|subscription|abonnement|lidmaatschap)\b[^.?!]{0,25}\b(on hold|in de wacht)\b/i.test(m),
  },
  {
    key: 'cooling_off',
    label: '14-day cooling-off',
    plain: 'Just signed up and changed their mind. Charge depends on visits.',
    source: 'Build Priced Options — cancellation sub-check',
    test: (m) => /cooling ?off|bedenktijd|herroeping|14 ?(day|days|dagen|daagse)/i.test(m),
  },
  {
    key: 'not_a_member',
    label: 'Not a member / no account',
    plain: 'Says they have no membership. Should be answered, never sent to the login gate.',
    source: 'Bot - Authenticate — Answer Before Ticket? (notMember)',
    test: (m) => /(nog\s+geen\s+lid|ik\s+ben\s+geen\s+lid|geen\s+lid\b|geen\s+account|zonder\s+account|geen\s+lidmaatschap|niet\s+ingeschreven|not\s+a\s+member|no\s+account|don'?t\s+have\s+(an?\s+)?acc(ount)?|dont\s+have\s+(an?\s+)?acc(ount)?|haven'?t\s+got\s+(an?\s+)?account|don'?t\s+have\s+a\s+membership|dont\s+have\s+a\s+membership|no\s+(membership|subscription))/i.test(m),
  },
  {
    key: 'wants_human',
    label: 'Wants to speak to a person',
    plain: 'Asks for a human, a colleague or a phone call.',
    source: 'Bot - Authenticate — Answer Before Ticket? early-return list',
    test: (m) => /(bel\s+me\b|bel\s+mij|neem\s+contact|contact\s+me|call\s+me|phone\s+me|mail\s+me|e-?mail\s+me|iemand\s+spreken|spreek\s+iemand|speak\s+to\s+(someone|a\s+human|an\s+agent|sales)|talk\s+to\s+(someone|a\s+human|sales)|medewerker)/i.test(m),
  },
  {
    key: 'class_booking',
    label: 'Class or appointment (not the membership)',
    plain: 'A class, booking or appointment. Must NOT be read as a membership cancellation.',
    source: 'Guardrail Patches 2026-08-26 — Patch G (CLASS_OBJ_RE)',
    test: (m) => /\b(class|classes|lesson|lessons|appointment|booking|reservation|session|timeslot|time slot|les|lessen|boeking|reservering|afspraak)\b/i.test(m),
  },
  {
    key: 'attendance',
    label: 'No-show / attendance dispute',
    plain: 'Disputes a missed class or a no-show warning.',
    source: 'Feedback Overrides 2026-08-26 — ATTEND_RE',
    test: (m) => /\b(aanwezigheid|aanwezig|afwezig|no.?show|niet gemist|les gemist|gemiste les|check.?in)\b/i.test(m),
  },
  {
    key: 'payment_date',
    label: 'Direct-debit date change',
    plain: 'Wants the collection date moved. It cannot be changed — 13 periods of 4 weeks.',
    source: 'Feedback Overrides 2026-08-26 — PAYDATE_RE',
    test: (m) => /\b(incasso ?datum|betaal ?datum|afschrijf ?datum|payment date|direct debit date|collection date)\b/i.test(m),
  },
  {
    key: 'owes_money',
    label: 'Outstanding payment / debt',
    plain: 'An unpaid amount, arrears or a collection agency.',
    source: 'Feedback Overrides 2026-08-26 — OWES_RE',
    test: (m) => /\b(open (invoice|amount|bill|balance)|outstanding|openstaand\w*|achterstand|onbetaald|unpaid|incasso|deurwaarder|aanmaning|dunning)\b/i.test(m),
  },
  {
    key: 'invoice',
    label: 'Invoice request',
    plain: 'Wants an invoice. Needs a period, or the request cannot be actioned.',
    source: 'Bot - Ticket creation — Refine Group Routing',
    test: (m) => /\b(invoice|factuur|facturen|betaalbewijs|receipt)\b/i.test(m),
  },
];
