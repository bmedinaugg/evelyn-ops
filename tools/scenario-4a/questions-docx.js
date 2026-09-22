// Builds docs/scenario-4a-questions-for-esther.docx — the questions that have to
// be settled before Scenario 4a ("Change membership — setting expectations") can
// be built, so they can be answered in one conversation rather than discovered
// one at a time during implementation.
//
//   node tools/scenario-4a/questions-docx.js
//
// Same OOXML-and-zip approach as tools/review/docx.js: a .docx is a zip of XML
// parts, so this adds no dependency. Content is static — it is a question list,
// not a report — but the two data claims in it (the tier table and the student
// availability) were checked against live Freshdesk and Magicline on 17 Sep 2026
// and the document says so, because a claim that contradicts the author's own
// guide needs to show where it came from.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function run(text, o) {
  o = o || {};
  const props = [];
  if (o.b) props.push('<w:b/>');
  if (o.i) props.push('<w:i/>');
  if (o.color) props.push(`<w:color w:val="${o.color}"/>`);
  if (o.sz) props.push(`<w:sz w:val="${o.sz * 2}"/><w:szCs w:val="${o.sz * 2}"/>`);
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(runs, o) {
  o = o || {};
  const props = [];
  if (o.style) props.push(`<w:pStyle w:val="${o.style}"/>`);
  const sp = [];
  if (o.before != null) sp.push(`w:before="${o.before}"`);
  if (o.after != null) sp.push(`w:after="${o.after}"`);
  if (sp.length) props.push(`<w:spacing ${sp.join(' ')}/>`);
  if (o.indent) props.push(`<w:ind w:left="${o.indent}"/>`);
  if (o.bar) props.push(`<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${o.bar}"/></w:pBdr>`);
  if (o.shade) props.push(`<w:shd w:val="clear" w:fill="${o.shade}"/>`);
  const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

// A question block: number + title, the why, and the fallback to fall back on
// if nobody knows. The fallback is the point — it lets the conversation end in a
// decision instead of an action item.
function question(n, title, body, fallback) {
  const out = [];
  out.push(para([
    run(`${n}.  `, { b: true, color: '0E5A62', sz: 12 }),
    run(title, { b: true, sz: 12 }),
  ], { before: 220, after: 60 }));
  for (const p of body) out.push(para([run(p, { sz: 10 })], { after: 60, indent: 260 }));
  if (fallback) {
    out.push(para([
      run('If there is no answer today:  ', { b: true, sz: 9, color: '0E5A62' }),
      run(fallback, { sz: 9 }),
    ], { after: 80, indent: 260, bar: 'B9C4CB' }));
  }
  out.push(para([
    run('Answer: ', { b: true, sz: 9, color: '55626E' }),
    run('.'.repeat(90), { sz: 9, color: 'C8CFD5' }),
  ], { after: 140, indent: 260, shade: 'F2F4F5' }));
  return out;
}

const body = [];

body.push(para([run('Scenario 4a — what we need to agree', {})], { style: 'Title' }));
body.push(para([
  run('Questions on ', { sz: 10, color: '55626E' }),
  run('“Change membership — setting expectations before the member commits”', { sz: 10, i: true, color: '55626E' }),
  run(' (Esther Rumora, 15 September 2026).', { sz: 10, color: '55626E' }),
], { after: 40 }));
body.push(para([run('Prepared 17 September 2026 · Bryan Medina', { sz: 9, color: '7C8792' })], { after: 200 }));

body.push(para([run('Why this exists', {})], { style: 'Heading1' }));
body.push(para([run(
  'The scenario is mostly buildable as written. Working through it against the live systems '
  + 'raised ten points where the guide is either ambiguous or does not match what the data '
  + 'actually holds. Five of them block the build outright — the bot cannot be made to do what '
  + 'the guide asks until they are settled. The rest change how it is built rather than whether.',
  { sz: 10 })], { after: 80 }));
body.push(para([run(
  'Each question has a suggested fallback. If the answer is not known today, agreeing the '
  + 'fallback is enough to start; the point is to leave with decisions rather than open items.',
  { sz: 10 })], { after: 120 }));

// ---------------------------------------------------------------- blockers
body.push(para([run('Blocking — the build cannot start without these', {})], { style: 'Heading1' }));

body.push(...question(1, 'CITY+ is missing from the tier table',
  ['The guide lists Red = PREMIUM, Black = HOME+ and PREMIUM, Regular = HOME, HOME+ and PREMIUM.',
   'The live change-membership form also offers CITY+ at both Black Label and Regular Label clubs. '
   + 'And one club — Amsterdam Kraanspoor — carries no label at all and offers only PREMIUM.',
   'Is CITY+ deliberately excluded from membership changes, or is it an omission? Coding the table '
   + 'as written would have the bot tell members a tier they can actually buy does not exist.'],
  'The bot offers whatever the change form actually contains, and the guide is corrected to match.'));

body.push(...question(2, 'B2B corporate codes — where do we check whether one applies at a club?',
  ['The guide says the bot must never confirm a corporate code is valid for a club without checking, '
   + 'because assuming it works everywhere is a hallucination risk. That is right.',
   'There is no data anywhere we can reach that maps a corporate code to the clubs it is valid at — '
   + 'not in Freshdesk, not in Magicline. Does that mapping exist, and who owns it?'],
  'The bot never confirms B2B for a specific club and always hands B2B questions to the team. '
  + 'Worth agreeing explicitly, because it makes the bot least useful to exactly the members this scenario is about.'));

body.push(...question(3, 'Promotions — can the bot see what discount a member currently has?',
  ['The worked example turns on a 30% discount carrying over to the new contract.',
   'Magicline gives us the base price and the current price, but no discount or promotion field that '
   + 'we have found. If the bot cannot read it, it can state the rule — an existing promotion carries '
   + 'over — but never the member’s actual number.',
   'Is that acceptable, or does the promotion live somewhere we have not looked?'],
  'The bot states the carry-over rule only, and never quotes a discount percentage or amount.'));

body.push(...question(4, 'Rolling contracts — is a member past their minimum term always “out of contract”?',
  ['The guide defines out of contract as less than one month from the contract end date.',
   'Members past their minimum term are on rolling contracts with no fixed end date at all, and they '
   + 'are a large group. The test as written has no answer for them.'],
  'Treat them as always out of contract, since they can leave on one month’s notice.'));

body.push(...question(5, 'What is a “resident deal”, and how would the bot recognise one?',
  ['The guide says resident-deal memberships follow the same rules as B2B.',
   'Nothing in the membership data identifies one. B2B and student rates are both visible in the rate '
   + 'name; resident deals are not.'],
  'Out of scope for the first version — the bot treats them as ordinary memberships until they can be identified.'));

// ------------------------------------------------------------ shapes build
body.push(para([run('Shapes the build — a view is enough', {})], { style: 'Heading1' }));

body.push(...question(6, 'Peak-time leniency (September–May) — what should the bot actually say?',
  ['The guide says leniencies may mean no new contract starts, so the bot should not state that one '
   + 'definitely will. That is the single question members most want answered, so the hedge matters.',
   'Is there a rule behind the leniency, or is it case by case?'],
  'The bot says this would normally start a new contract, but that during busy months the team '
  + 'sometimes waives it and will confirm.'));

body.push(...question(7, 'May the bot state the member’s current price?',
  ['The guide wants the bot to open with “you have a 1-year contract at this club, currently at [rate]”.',
   'The bot is currently instructed never to quote the member’s current contract price. Magicline does '
   + 'return it, so this is possible — but it reverses a standing rule and is worth signing off deliberately.'],
  'Yes — the bot may state the current contract price, read from Magicline, and never from anything the member says.'));

body.push(...question(8, 'Should the bot ask “why” every time?',
  ['The guide says always ask both the destination club and the reason, every time.',
   'For a plain tier upgrade at the same club that is a second question before the member gets any '
   + 'answer at all, in a conversation that is meant to be exploratory.'],
  'Ask the reason only when a club change is involved; for a same-club tier question, answer first and ask if needed.'));

body.push(...question(9, 'How should the bot recognise a third-party membership?',
  ['Workit and bedrijfsfitness are to be redirected rather than answered.',
   'Some are visible in the rate name, but not reliably all. Is there a list of third-party products, '
   + 'or a naming pattern we can depend on?'],
  'The bot redirects only the ones it can positively identify, and treats the rest as ordinary memberships.'));

body.push(...question(10, 'Relocation proof — mention it during the exploratory conversation?',
  ['The relocation exception requires documented proof.',
   'Should the bot say so while the member is only asking what would happen, or hold it until they commit?'],
  'Mention it, so the member is not surprised later.'));

// ------------------------------------------------------------------ note
body.push(para([run('One thing to flag, not a question', {})], { style: 'Heading1' }));
body.push(para([run(
  'Since 7 August the bot does not have this conversation at all. Any membership-change intent is '
  + 'intercepted and answered with the self-service form link immediately — no questions, no rates, no '
  + 'ticket — because ticket creation on change flows was unreliable.',
  { sz: 10 })], { after: 60 }));
body.push(para([run(
  'Scenario 4a needs that reopened. It is compatible with why it was closed: 4a creates no ticket '
  + 'either, so the bot would talk, quote rates, and still hand over the same form at the end. But it '
  + 'is a real change to current behaviour and worth knowing before the scenario is signed off.',
  { sz: 10 })], { after: 160 }));

// ------------------------------------------------------------- appendix
body.push(para([run('Appendix — the two claims above that contradict the guide', {})], { style: 'Heading1' }));
body.push(para([run(
  'Both were checked against live systems on 17 September 2026 rather than taken from notes.',
  { sz: 9, color: '55626E' })], { after: 100 }));

body.push(para([run('Tiers actually offered, per label', {})], { style: 'Heading3' }));
for (const [label, tiers] of [
  ['Red Label', 'PREMIUM'],
  ['Black Label', 'HOME+, PREMIUM, CITY+'],
  ['Regular Label', 'HOME, HOME+, PREMIUM, CITY+'],
  ['No label (Amsterdam Kraanspoor)', 'PREMIUM'],
]) {
  body.push(para([
    run(label.padEnd(34, ' '), { b: true, sz: 9 }),
    run(tiers, { sz: 9 }),
  ], { after: 30, indent: 260 }));
}
body.push(para([run(
  'Source: the cf_clubs field on the live change-membership form in Freshdesk — which the guide itself '
  + 'names as the source of truth for what the bot may offer.', { sz: 9, color: '55626E' })],
  { after: 120, indent: 260 }));

body.push(para([run('Student memberships are not offered at every club', {})], { style: 'Heading3' }));
body.push(para([run(
  'The guide is right that this has to be checked per club. It can be: Magicline lists a student rate '
  + 'per studio. In a sample of 14 Amsterdam clubs, 4 had one — Bos en Lommer, Holendrecht, NDSM and '
  + 'Parnassusweg — while Amstelveenseweg, IJburg, Oost and the rest did not. So the bot can answer this '
  + 'correctly rather than having to defer it.', { sz: 9 })], { after: 60, indent: 260 }));

// ---- assemble ------------------------------------------------------------
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
    <w:sz w:val="20"/><w:szCs w:val="20"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
    <w:name w:val="Normal"/><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="52"/><w:szCs w:val="52"/><w:color w:val="0E5A62"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="360" w:after="120"/>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="0E5A62"/></w:pBdr></w:pPr>
    <w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="0E5A62"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="200" w:after="40"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
</w:styles>`;

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;

const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scenario4a-docx-'));
fs.mkdirSync(path.join(tmp, '_rels'));
fs.mkdirSync(path.join(tmp, 'word'));
fs.mkdirSync(path.join(tmp, 'word', '_rels'));
fs.writeFileSync(path.join(tmp, '[Content_Types].xml'), contentTypes);
fs.writeFileSync(path.join(tmp, '_rels', '.rels'), packageRels);
fs.writeFileSync(path.join(tmp, 'word', 'document.xml'), documentXml);
fs.writeFileSync(path.join(tmp, 'word', 'styles.xml'), STYLES);
fs.writeFileSync(path.join(tmp, 'word', '_rels', 'document.xml.rels'), documentRels);

const out = path.resolve(__dirname + '/../../docs/scenario-4a-questions-for-esther.docx');
fs.rmSync(out, { force: true });
execFileSync('zip', ['-q', '-X', '-r', out, '.'], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(out);
