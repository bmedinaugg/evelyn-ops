// Builds a shareable PDF of the scenario library from library.json.
//
//   node tools/scenarios/generate.js      # first, to refresh library.json
//   node tools/scenarios/pdf.js           # writes docs/evelyn-scenario-library.*
//
// Why a separate artefact at all: /scenarios needs a login, and Esther, Nelly
// and Lowri read things in Teams and e-mail. Same document, portable.
//
// The PDF is NOT just a print of the page. A PDF gets forwarded, so example
// selection is stricter here — see PERSONAL below.
const fs = require('fs');
const path = require('path');

const lib = JSON.parse(fs.readFileSync(path.join(__dirname, 'library.json'), 'utf8'));

// Quotes that disclose something personal beyond the request itself. Member
// Care reads these transcripts as their job, but a shareable PDF is a different
// exposure: it gets forwarded, saved and re-shared with no context.
//
// This filter is a PREFERENCE, not a redaction — the quote is skipped in favour
// of another real one, and there are 14 candidates per scenario. Nothing gets
// paraphrased or invented, and if a scenario has nothing else the honest quote
// still runs. Skipping a health disclosure costs nothing: the scenario is just
// as well illustrated by the member who wrote "I want to cancel my membership".
const PERSONAL = /\b(depress|anxiet|anxious|mental|therapy|therapist|burn-?out|surger|surgery|operation|cancer|chemo|pregnan|zwanger|miscarr|injur|injury|blessure|ziek|illness|ill\b|sick|hospital|ziekenhuis|diagnos|medicat|overleden|passed away|death|died|funeral|divorce|scheiding|depressie|psycholog)/i;

// Financial hardship is the same judgement: relevant to the ticket, not
// something to reproduce in a slide deck.
const HARDSHIP = /\b(cannot afford|can'?t afford|no money|geen geld|broke\b|unemploy|werkloos|lost my job|schulden|debt|bijstand|uitkering)/i;

// The misfire probes, reused as an exclusion. Without this the SAME quote
// appears twice on one page — once as a representative example and again under
// "Also trips on" — which reads as sloppiness and, worse, muddles the
// distinction the document exists to draw. The top list is what the scenario
// legitimately catches; the misfire block is what it catches wrongly.
const MISFIRES = require('./misfires.js');

function pickExamples(entry, n) {
  const probes = MISFIRES[entry.key] || [];
  const isMisfire = (t) => probes.some((m) => { try { return m.test(t); } catch (e) { return false; } });

  const clean = [];
  const held = [];
  const misfiring = [];
  for (const ex of entry.examples || []) {
    const t = String(ex.text || '').trim();
    if (t.length < 15) continue;
    if (isMisfire(t)) { misfiring.push({ ...ex, text: t }); continue; }
    (PERSONAL.test(t) || HARDSHIP.test(t) ? held : clean).push({ ...ex, text: t });
  }
  // Prefer quotes that stand on their own. Fragments like "2 jaar, met 35%
  // korting en check in korting" are real matches but illustrate nothing to a
  // reader with no transcript in front of them, whereas "check-in did not
  // register" does. This only REORDERS honest candidates — nothing is edited,
  // and a fragment still runs if that is all a scenario has.
  const selfContained = (t) => t.split(/\s+/).length >= 6;
  clean.sort((a, b) => Number(selfContained(b.text)) - Number(selfContained(a.text)));

  // Prefer clean quotes, then personal ones, and only fall back to a known
  // misfire if a scenario would otherwise be bare — never silently empty.
  const out = clean.slice(0, n);
  if (out.length < 2) out.push(...held.slice(0, n - out.length));
  if (out.length < 2) out.push(...misfiring.slice(0, n - out.length));
  return out;
}

// Direct identifiers, masked rather than avoided. Members paste their e-mail
// address, phone number or IBAN straight into the chat, and it can turn up in
// ANY quote — two e-mail addresses reached the first draft of this PDF. Picking
// a different example is not a control, because the next regeneration picks
// different examples. So mask, always, and let the shape of the message survive.
//
// Runs before HTML escaping so the patterns see the raw text.
function redact(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?\d{4}[\s]?\d{2,10}\b/gi, '[IBAN]')
    // Dutch mobile/landline in the shapes members actually type. Deliberately
    // after IBAN so it cannot eat part of an account number.
    // Accept any digit grouping after the prefix — members type +31 6 1234 5678,
    // 06-12345678 and 0612345678 interchangeably, and a fixed 3+3 shape missed
    // the 4+4 grouping entirely.
    .replace(/(?:\+31|0031|\b0)[\s-]?(?:\d[\s-]?){8,9}\d\b/g, '[phone]')
    // Membership / contract numbers: a bare run of 7+ digits. Shorter runs are
    // left alone because they are usually prices, times, dates or club numbers.
    .replace(/\b\d{7,}\b/g, '[number]');
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Trim to a readable length without cutting a word in half. Long messages are
// common and a 400-character quote reads as noise on paper.
function clip(raw, max) {
  const t = redact(raw);
  if (t.length <= max) return esc(t);
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return esc((at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()) + '…';
}

const GROUPS = [
  {
    title: 'Contract changes',
    blurb:
      'These four share one classifier, checked in a fixed order. If a message looks like two of them at once, the earlier check wins — see “When two scenarios collide”.',
    keys: ['cancellation', 'extension', 'change', 'freeze'],
  },
  {
    title: 'Money',
    blurb: 'Recognised well enough to answer, or to open a payments ticket.',
    keys: ['payment_date', 'owes_money', 'invoice'],
  },
  {
    title: 'Clubs & classes',
    blurb: 'Answered from the FAQ and club data, usually without a ticket.',
    keys: ['class_booking', 'attendance'],
  },
  {
    title: 'Routing signals',
    blurb:
      'Not member requests — these change how the conversation is handled at all.',
    keys: ['cooling_off', 'not_a_member', 'wants_human'],
  },
];

const byKey = new Map(lib.scenarios.map((s) => [s.key, s]));
const label = (k) => byKey.get(k)?.label ?? k;

function scenarioHtml(s) {
  const ex = pickExamples(s, 5);
  const misfireTotal = (s.misfires || []).reduce((n, m) => n + m.messages, 0);
  return `
  <div class="scen">
    <div class="scen-head">
      <h3>${esc(s.label)}</h3>
      <span class="key">${esc(s.key)}</span>
    </div>
    <p class="plain">${esc(s.plain)}</p>
    <div class="counts">
      <b>${s.matches.toLocaleString('en-GB')}</b> messages ·
      <b>${s.sessions.toLocaleString('en-GB')}</b> conversations ·
      recognised in <span class="mono">${esc(s.source)}</span>
    </div>
    <div class="quotes">
      ${ex
        .map(
          (e) => `<div class="q"><span class="qt">${clip(e.text, 190)}</span><span class="qd">${esc(e.at)}</span></div>`,
        )
        .join('')}
    </div>
    ${
      misfireTotal
        ? `<div class="mis">
      <div class="mis-h">Also trips on <span class="mis-sub">— ${misfireTotal.toLocaleString('en-GB')} of ${s.matches.toLocaleString('en-GB')} matches are about something else. These are the ones we could measure, so treat it as a floor.</span></div>
      ${(s.misfires || [])
        .map(
          (m) => `<div class="mis-row">
          <div class="mis-top"><b>${esc(m.label)}</b><span class="mis-n">${m.messages.toLocaleString('en-GB')} · ${m.pct < 0.1 ? '&lt;0.1' : m.pct}%</span></div>
          <div class="mis-why">${esc(m.why)}</div>
          ${m.examples.slice(0, 1).map((t) => `<div class="q slim"><span class="qt">${clip(t, 170)}</span></div>`).join('')}
        </div>`,
        )
        .join('')}
    </div>`
        : ''
    }
  </div>`;
}

const collisions = (lib.overlaps || []).filter((o) => o.messages >= 30);

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8" />
<title>Evelyn scenario library</title>
</head>
<body>
<div class="wrap">

  <header>
    <div class="eyebrow">TrainMore · Member Care · internal</div>
    <h1>What Evelyn recognises</h1>
    <p class="standfirst">
      Every quote in this document is a real member message that actually matched
      the pattern the live bot uses — including the ones that matched by mistake.
    </p>
    <div class="meta">
      Generated ${esc(String(lib.generated_at).slice(0, 10))} from
      ${lib.messages_scanned ? lib.messages_scanned.toLocaleString('en-GB') : 'real'} member messages${
        lib.window_from && lib.window_to
          ? ` sent between ${esc(lib.window_from)} and ${esc(lib.window_to)}`
          : ''
      }.
    </div>
  </header>

  <div class="note">
    <b>How to read this, and what it is not.</b>
    Evelyn does not record “I decided this was a cancellation”, so this is not a
    log of decisions. Each pattern was taken out of the live automation and
    replayed over real messages, so what follows is what the patterns
    <i>do</i> — not what we intended them to do. The difference is the useful
    part. Matching a pattern is also only the first step: the AI still reads the
    whole message, so a match does not guarantee how the conversation ends up
    being handled.
  </div>

  ${GROUPS.map(
    (g) => `
  <section>
    <div class="sec-head">
      <h2>${esc(g.title)}</h2>
      <p class="sec-blurb">${esc(g.blurb)}</p>
    </div>
    ${g.keys.map((k) => byKey.get(k)).filter(Boolean).map(scenarioHtml).join('')}
  </section>`,
  ).join('')}

  <section>
    <div class="sec-head">
      <h2>When two scenarios collide</h2>
      <p class="sec-blurb">
        This is where “the bot got it wrong” usually comes from. Plenty of
        messages match more than one pattern, and the contract-change classifier
        stops at the first one it finds — in the order
        <b>extension → cancellation → change</b>. So a member who mentions both
        is handled as whichever comes first, even when the other one is what they
        actually wanted. Where a pair is <i>not</i> marked with a winner below,
        the two live in different parts of the automation and both can apply,
        depending on where the conversation has got to.
      </p>
    </div>
    ${collisions
      .map(
        (o) => `
    <div class="col">
      <div class="col-top">
        <span class="cpair">${esc(label(o.a))} <span class="plus">+</span> ${esc(label(o.b))}</span>
        <span class="col-n">${o.messages.toLocaleString('en-GB')} messages</span>
      </div>
      ${o.handled_as ? `<div class="col-verdict">Handled as <b>${esc(label(o.handled_as))}</b> — it is checked first.</div>` : ''}
      ${o.sample ? `<div class="q slim"><span class="qt">${clip(o.sample, 175)}</span></div>` : ''}
    </div>`,
      )
      .join('')}
  </section>

  <footer>
    <b>Internal document — contains real member messages.</b>
    Quotes are unedited apart from trimming for length, except that e-mail
    addresses, phone numbers, bank details and membership numbers are masked,
    and examples were chosen to illustrate each scenario without reproducing
    personal health or financial disclosures. Live version, with links through to each conversation:
    <span class="mono">Evelyn Ops → Review → Scenario library</span>.
    <div class="foot-warn">
      This is generated from the automation as it was on
      ${esc(String(lib.generated_at).slice(0, 10))}. If a pattern has been
      changed since, this document is out of date — regenerate it rather than
      correcting it by hand.
    </div>
  </footer>

</div>

<style>
  :root {
    --ground:    #F6F7F9;
    --surface:   #FFFFFF;
    --ink:       #12171E;
    --ink-2:     #38414E;
    --muted:     #667385;
    --line:      #DBE1E8;
    --line-soft: #E8ECF1;
    --accent:    #2E7F98;
    --accent-wash: rgba(46,127,152,.10);
    --warn:      #A8700F;
    --warn-wash: rgba(168,112,15,.11);
    --shadow:    0 1px 2px rgba(18,23,30,.05), 0 8px 24px -16px rgba(18,23,30,.25);
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, "Helvetica Neue", Arial, sans-serif;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font-family: var(--sans); }
  .wrap { max-width: 860px; margin: 0 auto; padding: 40px 28px 60px; display: flex; flex-direction: column; gap: 26px; }

  header { border-bottom: 2px solid var(--ink); padding-bottom: 16px; }
  .eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
  h1 { font-family: var(--serif); font-size: 36px; line-height: 1.1; margin: 8px 0 10px; letter-spacing: -.02em; }
  .standfirst { font-family: var(--serif); font-size: 16px; line-height: 1.55; color: var(--ink-2); margin: 0 0 12px; max-width: 62ch; }
  .meta { font-size: 11.5px; color: var(--muted); }

  .note {
    background: var(--accent-wash); border-left: 3px solid var(--accent);
    padding: 13px 16px; border-radius: 3px; font-size: 12.5px; line-height: 1.6;
    color: var(--ink-2); max-width: 74ch;
  }

  section { display: flex; flex-direction: column; gap: 10px; }
  .sec-head { border-bottom: 1px solid var(--line); padding-bottom: 7px; }
  h2 { font-size: 17px; margin: 0; letter-spacing: -.01em; }
  .sec-blurb { font-size: 12px; line-height: 1.55; color: var(--muted); margin: 4px 0 0; max-width: 76ch; }

  .scen { background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 14px 16px; box-shadow: var(--shadow); }
  .scen-head { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
  h3 { font-size: 14px; margin: 0; }
  .key { font-family: var(--mono); font-size: 10.5px; color: var(--muted); }
  .plain { font-size: 12.5px; line-height: 1.55; margin: 5px 0 6px; color: var(--ink-2); max-width: 76ch; }
  .counts { font-size: 11px; color: var(--muted); line-height: 1.5; }
  .counts b { color: var(--ink); }
  .counts .mono { font-family: var(--mono); font-size: 10px; }

  .quotes { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
  .q { display: flex; justify-content: space-between; align-items: baseline; gap: 14px; border-left: 2px solid var(--line); padding: 3px 0 3px 10px; }
  .q.slim { margin-top: 5px; border-left-color: var(--line-soft); }
  .qt { font-family: var(--serif); font-size: 12.5px; line-height: 1.5; font-style: italic; }
  .qt::before { content: '“'; } .qt::after { content: '”'; }
  .qd { font-size: 10px; color: var(--muted); white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }

  .mis { margin-top: 12px; border-top: 1px dashed var(--line); padding-top: 10px; }
  .mis-h { font-size: 11.5px; font-weight: 700; line-height: 1.5; }
  .mis-sub { font-weight: 400; color: var(--muted); }
  .mis-row { margin-top: 8px; padding-left: 10px; border-left: 2px solid var(--warn); }
  .mis-top { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
  .mis-n { font-size: 10.5px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mis-why { font-size: 11.5px; line-height: 1.5; color: var(--muted); margin-top: 1px; max-width: 74ch; }

  .col { background: var(--surface); border: 1px solid var(--line); border-left: 3px solid var(--warn); border-radius: 5px; padding: 11px 14px; }
  .col-top { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .cpair { font-size: 12.5px; font-weight: 650; }
  .plus { color: var(--muted); font-weight: 400; }
  .col-n { font-size: 10.5px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .col-verdict { font-size: 12px; line-height: 1.5; margin-top: 3px; }
  .soft { color: var(--muted); }

  footer { border-top: 1px solid var(--line); padding-top: 13px; font-size: 11px; line-height: 1.6; color: var(--muted); }
  footer .mono { font-family: var(--mono); font-size: 10.5px; color: var(--ink-2); }
  .foot-warn { margin-top: 7px; color: var(--warn); }

  @page { size: A4; margin: 15mm 13mm 16mm; }

  @media print {
    /* paper is already white — don't lay a grey field over every page */
    html, body { background: #FFFFFF; }
    body { font-size: 10.4pt; }
    .wrap { max-width: none; padding: 0; gap: 22px; }
    .scen, .col, .note { background: #FFFFFF; box-shadow: none; }

    /* Do NOT put break-inside: avoid on .scen. The cancellation card (five
       quotes plus four misfire rows) is taller than an A4 page, so an
       unbreakable rule made it un-placeable and Chrome pushed the whole group
       to the next sheet, leaving page 1 three-quarters empty. Let a big card
       split, and protect only the parts that must not straddle a break. */
    .col, .note, .mis-row, footer { break-inside: avoid; }
    .q, .sec-head { break-inside: avoid; }
    .scen-head, .counts { break-inside: avoid; }
    h1, h2, h3, .sec-head { break-after: avoid; }
    /* keep a heading with the card it introduces, and a card's title with its
       first quote, without making either unbreakable */
    .scen-head, .mis-h { break-after: avoid; }

    h1 { font-size: 27pt; }
    h2 { font-size: 14pt; }
    h3 { font-size: 11pt; }
    .standfirst { font-size: 11.5pt; }
    .qt { font-size: 9.8pt; }
    .plain { font-size: 9.8pt; }
    .counts, .qd, .key { font-size: 8.2pt; }
    .mis-why, .mis-h { font-size: 8.8pt; }
    footer { font-size: 8.4pt; }
  }
</style>
</body>
</html>
`;

const outDir = path.join(__dirname, '../../docs');
const base = path.join(outDir, 'evelyn-scenario-library');
fs.writeFileSync(base + '.print.html', html);

const shown = lib.scenarios.reduce((n, s) => n + pickExamples(s, 5).length, 0);
const held = lib.scenarios.reduce(
  (n, s) =>
    n +
    (s.examples || []).filter((e) => PERSONAL.test(e.text) || HARDSHIP.test(e.text)).length,
  0,
);
console.log(`wrote ${base}.print.html`);
console.log(`  ${lib.scenarios.length} scenarios, ${shown} quotes shown, ${collisions.length} collisions`);
console.log(`  ${held} candidate quotes held back as personal (health / hardship)`);
console.log(`\nnow: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\\n  --headless --disable-gpu --no-pdf-header-footer \\\n  --print-to-pdf="${base}.pdf" "file://${base}.print.html"`);
