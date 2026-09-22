// Decided vs exploring. Run: node tools/scenario-4a/suite_intent.js
//
// The four "exploring" phrasings in Esther's guide are here verbatim, plus the
// decided phrasings the redirect must keep catching, plus the cases where the
// two are mixed in one sentence.
const { classifyChangeIntent } = require('./intent');

const cases = [
  // --- exploring: the guide's own trigger examples, verbatim ---------------
  ['exploring', 'what happens if I downgrade'],
  ['exploring', 'will my price change if I switch clubs'],
  ['exploring', 'do I keep my current deal if I move to a cheaper plan'],
  ['exploring', 'what would my new contract look like'],

  // --- exploring: the same question as members really phrase it ------------
  ['exploring', 'If I change to HOME+, would I get a new contract?'],
  ['exploring', 'I am thinking about moving to Sloterdijk, what would that cost me'],
  ['exploring', 'considering a downgrade, do I lose my discount?'],
  ['exploring', 'Wat gebeurt er als ik mijn abonnement wijzig?'],
  ['exploring', 'Als ik overstap naar een andere club, blijft mijn prijs dan gelijk?'],
  ['exploring', 'Behoud ik mijn korting bij een downgrade?'],
  ['exploring', 'Ik overweeg om over te stappen naar de Zeilstraat'],
  ['exploring', 'Ik wil graag weten wat het gaat kosten als ik het wijzig, voor ik het definitief maak'],

  // --- the polite conditional is a REQUEST in both languages, not a musing.
  //     Every one of these was a wrong 'exploring' in the first version.
  ['decided', 'Ik zou het graag willen upgraden naar een trainmore black abonnement'],
  ['decided', 'Ik zou graag van club veranderen van Wilhelminaplein naar Rembrandtpark'],
  ['decided', 'Zou het mogelijk zijn om van NDSM te switchen naar Kraanspoor?'],
  ['decided', 'Ik zou graag mijn abonnement willen pauzeren, ik heb mijn sleutelbeen gebroken'],
  ['decided', 'Ik heb in de app mijn email veranderd, zou je dat kunnen aanpassen?'],

  // --- decided: must still go straight to the form -------------------------
  ['decided', 'I want to change my membership'],
  ['decided', 'Can you change my home club to Amsterdam Oost'],
  ['decided', 'please upgrade me to PREMIUM'],
  ['decided', 'how do I change my membership?'],
  ['decided', 'where do I request a change'],
  ['decided', 'Ik wil mijn abonnement wijzigen'],
  ['decided', 'Hoe kan ik mijn lidmaatschap veranderen?'],
  ['decided', 'I need an upgrade to my membership'],

  // --- mixed in one sentence: an explicit request wins, ambiguity keeps the
  //     link. "I'd like to KNOW" is not a request to change, so it explores.
  ['exploring', "I'd like to know what happens if I downgrade"],
  ['decided', 'I want to change my club but first, would my end date move?'],

  // --- no signal at all: today's behaviour, untouched ----------------------
  ['decided', 'membership change'],
  ['decided', 'access level'],
  ['decided', 'hi'],

  // --- must not be fooled by the bot's own words ---------------------------
  ['decided', 'yes'],
];

let fail = 0;
for (const [want, msg] of cases) {
  const got = classifyChangeIntent(msg).intent;
  if (got !== want) {
    fail++;
    console.log('FAIL want=' + want + ' got=' + got + '  ::  ' + msg);
  }
}

// Only the current turn is read, so nothing earlier in the session — the bot's
// own hypothetical phrasing, or the member's own musing three questions ago —
// can make this turn look exploratory.
if (classifyChangeIntent('ok thanks').intent !== 'decided') {
  fail++;
  console.log('FAIL a neutral turn was not left alone');
}

console.log(fail === 0 ? ('ALL ' + (cases.length + 1) + ' INTENT CASES GREEN') : (fail + ' failures'));
process.exit(fail ? 1 : 0);
