// Adversarial probe of guard 4, extracted out of the node body that will be
// deployed so the test cannot drift from what ships.
const fs = require('fs');
const body = fs.readFileSync(__dirname + '/nodes/Break_Repeat_Loop.js', 'utf8');
const start = body.indexOf('// Guard 4: invented access levels');
const end = body.lastIndexOf('return [{ json: out, pairedItem: { item: 0 } }];');
if (start === -1 || end === -1 || end < start) throw new Error('could not extract guard 4');
const guardSrc = body.slice(start, end);

const run = new Function('out', 'rp', 'nl', guardSrc + '\nreturn out;');

const cases = [
  // --- must BLOCK -----------------------------------------------------------
  ['block', "At TrainMore Amsterdam West, the available access levels are:\n\n1. HOME (Black Label club)\n2. REGULAR (Red Label club)\n3. PREMIUM (Gold Label club)\n\nPlease let me know which access level you would like."],
  ['block', "Access level refers to the type of membership you have. For example, you might have options like 'Basic', 'Premium', or 'VIP'. Which access level would you like?"],
  ['block', "Which access level would you like? You could pick a VIP access level if you want everything."],
  ['block', "Toegangsniveau bepaalt wat je kunt gebruiken. Je kunt kiezen uit 'Basis', 'Premium' of 'VIP'. Welk toegangsniveau wil je?"],
  ['block', "Here are the access levels:\n1) Basic - access to your home club\n2) Gold - access to every club"],
  ['block', "We have a Gold Label club in Amsterdam you could switch to."],
  ['block', "📝 Kun je bevestigen welk toegangsniveau je wilt?\n\n1) HOME (Regular Label club)\n2) PREMIUM (Premium Label club)\n3) BLACK (Black Label club)"],
  ['block', "Your access level would become Platinum, which covers all clubs."],
  ['block', "access level: Standard — that covers your own club only."],
  // --- must PASS ------------------------------------------------------------
  ['pass', "📝 Which membership would you like at Amsterdam Scheldeplein?\n\n  1)  HOME (Homeclub only)  — from €54 per 4 weeks\n  2)  PREMIUM (Homeclub + Regular & Black Label Clubs)  — from €76 per 4 weeks\n\nReply with the number or the name."],
  ['pass', "Your current access level is HOME+ (Homeclub + Regular Label Clubs), so you can already train at every Regular Label club."],
  ['pass', "PREMIUM adds the Regular and Black Label clubs to your own club. HOME+ adds only the Regular Label clubs. Which access level would you like?"],
  ['pass', "📝 Welk toegangsniveau wil je bij Rotterdam Blaak?\n\n  1)  CITY+ (Homeclub + Regular Label Clubs Netherlands + Black Label Clubs Rotterdam)\n  2)  PREMIUM (Homeclub + Regular & Black Label Clubs)"],
  ['pass', "Je huidige toegangsniveau is PREMIUM, dus je kunt bij alle Regular Label en Black Label clubs terecht."],
  ['pass', "Before I can tell you the access levels, which club would you like to move to? For example: 1) Oost 2) Singel 3) IJburg 4) NDSM"],
  ['pass', "📝 PREMIUM it is — which term?\n\n  1)  1 year: €76 per 4 weeks\n  2)  Flex: €96 per 4 weeks\n\nReply with the number or the term. This is for your PREMIUM access level."],
  ['pass', "Sorry — I keep repeating myself and that's not helping you. Let's get a real colleague on this: reply 'ticket' and I'll immediately create a support ticket about your access level question."],
  ['pass', "Het verzoek gold voor je toegangsniveau HOME+ en is al doorgezet."],
  ['pass', "I've noted your request to move to Amsterdam Papaverweg with PREMIUM access level."],
];

let fail = 0;
for (const [want, text] of cases) {
  const nl = /toegangsniveau|welk|huidige|gold voor|bevestigen/i.test(text) && !/access level/i.test(text);
  const out = run({ reply_text: text }, {}, nl);
  const blocked = !!out.invented_access_level_blocked;
  const got = blocked ? 'block' : 'pass';
  if (got !== want) {
    fail++;
    console.log('FAIL want=' + want + ' got=' + got + (blocked ? (' [' + out.invented_access_level_blocked + ']') : '') + '  :: ' + text.replace(/\n/g, ' | ').slice(0, 120));
  }
}
console.log(fail === 0 ? ('ALL ' + cases.length + ' GUARD4 CASES GREEN') : (fail + ' / ' + cases.length + ' FAILED'));
