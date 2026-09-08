// Known misfires: subjects a recogniser catches that are NOT what it means.
//
// These are NOT copied from the bot — they are our own probes, written after
// reading what each recogniser actually matched. They are deliberately narrow
// and conservative: each one only fires on a phrasing that is unambiguously
// about something else, so the percentage it reports is a FLOOR, not an
// estimate of total error. Better to under-claim than to put a number on the
// page that a Member Care agent can disprove with one counter-example.
//
// Only the broad recognisers get probed. A recogniser that keys on a specific
// phrase ("cooling off", "not a member") has nothing useful to say here.
module.exports = {
  cancellation: [
    {
      label: 'Cancelling a class or booking, not the membership',
      why: 'The recogniser fires on the word "cancel" alone, so a member cancelling a Sunday class reads the same as one leaving TrainMore.',
      test: (t) => /cancel\w*\s+(my\s+)?(a\s+)?(class|lesson|les|booking|reservation|reservering|spot|session|appointment|training|inschrijving voor)|(class|les|booking)\s+cancel/i.test(t),
    },
    {
      label: 'Cancelling a free trial or a brand-new signup',
      why: 'Not a contract to end — often someone who has not started yet.',
      test: (t) => /cancel\w*\s+(my\s+)?(free\s+)?(trial|proefles|proefabonnement|gratis)|trial\b[^.]{0,40}cancel/i.test(t),
    },
    {
      label: 'Already cancelled — talking about the past',
      why: 'The member has ALREADY left, or cancelled and now regrets it. Treating this as a fresh cancellation request answers a question nobody asked.',
      test: (t) => /(already|just|have)\s+(been\s+)?cancel\w*|heb\s+(al\s+)?(mijn\s+\w+\s+)?opgezegd|al opgezegd/i.test(t),
    },
    {
      label: 'Asking how or whether, not asking to do it',
      why: 'A policy question. The member wants to understand the rules, not trigger them.',
      test: (t) => /^(how|hoe|can i|kan ik|what|wat|is it possible|wanneer|when)\b[^?]{0,80}cancel/i.test(t),
    },
  ],
  change: [
    {
      label: 'Changing details, not the membership',
      why: 'E-mail, password, phone, bank or card. Self-service in the app, and nothing to do with the contract.',
      test: (t) => /chang\w*\s+(my\s+)?(e-?mail|email|password|login|phone|number|details|adres|gegevens|bank|iban|card|payment method|betaal|rekening)|(e-?mail|password|wachtwoord|bank|iban|betaalmethode)\s+(wil ik\s+)?chang/i.test(t),
    },
    {
      label: 'Changing a booked class time',
      why: 'A booking, not a contract.',
      test: (t) => /chang\w*\s+(my\s+)?(class|les|booking|reservering|appointment|session)|switch\s+(my\s+)?(class|les)/i.test(t),
    },
  ],
};
