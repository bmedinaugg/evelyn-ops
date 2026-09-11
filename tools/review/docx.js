// Builds docs/evelyn-decision-review.docx — the working-session pack as a Word
// document: the two findings, the knowledge register, and all 55 cases with a
// verdict line to mark up.
//
//   node tools/review/docx.js
//
// Written straight to OOXML and zipped with the system `zip`, so it adds no
// dependency to the app. A .docx is a zip of XML parts; the four that matter
// are the content-type map, the package relationships, the document body, and
// the relationships that make hyperlinks real links rather than blue text.
//
// Generated from bot.case_library_view() and bot.knowledge_sources_view(), so
// correcting a row and re-running is the whole update path.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const env = {};
for (const line of fs.readFileSync(__dirname + '/../../.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (t.includes('=') && !t.startsWith('#')) {
    const i = t.indexOf('=');
    env[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, '');
  }
}
const SUPA = env.SUPABASE_URL.replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function rpc(name, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body || {});
    const r = https.request(SUPA + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Content-Profile': 'bot', 'Accept-Profile': 'bot',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
      },
    }, (r2) => {
      let b = '';
      r2.on('data', (d) => b += d);
      r2.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 300))); } });
    });
    r.on('error', rej);
    r.write(data);
    r.end();
  });
}

// ---- OOXML helpers -------------------------------------------------------
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // Word rejects control characters outright.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

const rels = [];           // hyperlink relationships, collected as we go
function linkRel(url) {
  const id = 'rIdL' + (rels.length + 1);
  rels.push({ id, url });
  return id;
}

// A run of text. `o` picks bold / italic / colour / size / mono.
function run(text, o) {
  o = o || {};
  const props = [];
  if (o.font) props.push(`<w:rFonts w:ascii="${o.font}" w:hAnsi="${o.font}"/>`);
  if (o.b) props.push('<w:b/>');
  if (o.i) props.push('<w:i/>');
  if (o.caps) props.push('<w:smallCaps/>');
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
  if (o.bar) {
    props.push(`<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${o.bar}"/></w:pBdr>`);
  }
  if (o.shade) props.push(`<w:shd w:val="clear" w:fill="${o.shade}"/>`);
  const pPr = props.length ? `<w:pPr>${props.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}${Array.isArray(runs) ? runs.join('') : runs}</w:p>`;
}

function hyperlink(label, url) {
  const id = linkRel(url);
  return `<w:hyperlink r:id="${id}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(label)}</w:t></w:r></w:hyperlink>`;
}

// A labelled line: bold label, then body text.
function field(label, value, o) {
  o = o || {};
  return para([run(label + '  ', { b: true, sz: 9 }), run(value, { sz: 9, color: o.color })],
    { after: 40, indent: o.indent || 0 });
}

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
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="200" w:after="40"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0E5A62"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;

const AREAS = ['Pre-login', 'Authentication', 'Account questions',
  'Self-service redirect', 'Ticketing', 'Guardrails', 'Dead ends'];

const SOURCE_LABEL = {
  club_directory: 'Club directory', magicline: 'Magicline', prompt: 'n8n prompt',
  faq_vector: 'FAQ store', freshdesk_form: 'Freshdesk form', freshdesk_api: 'Freshdesk API',
  guardrail: 'Guardrail', database: 'Bot database', none: 'No source',
};
const ACTION_LABEL = {
  answer: 'Answers', link: 'Hands over a link', ticket: 'Files a ticket',
  process: 'Performs an action', refuse: 'Declines', handoff: 'Routes to a human',
  block: 'Overrides the model', dead_end: 'Member gets nothing',
};
const OWNERSHIP = {
  club_directory: 'nodeploy', faq_vector: 'nodeploy', freshdesk_form: 'nodeploy',
  database: 'nodeploy', prompt: 'deploy', guardrail: 'deploy',
  magicline: 'external', freshdesk_api: 'external', none: 'nosource',
};
const OWN_LABEL = {
  nodeploy: 'Changeable without a deploy', deploy: 'Needs a deploy',
  external: 'External system', nosource: 'No source of truth',
};
const WIRING_LABEL = { live: 'LIVE', deploy: 'NEEDS A DEPLOY', not_wired: 'NOT WIRED' };

const N8N = 'https://urbangymgroup-prod.app.n8n.cloud';
const SUPA_EDITOR = 'https://supabase.com/dashboard/project/rxnryvwpkdnwkpmhiiup/editor?schema=bot';
const SUPPORT_FORM = 'https://www.support.trainmore.com/en/support/tickets/new?ticket_form=';
const WORKFLOW_IDS = {
  'Bot - Main': 'Ns0OsYgRawvQzWnw',
  'Bot - Ticket Collection Agent': 'Yq2zEE9NQo6hQvnO',
  'Bot - Classify Intent': 'VdXRxTK4GYFBTeQp',
  'Bot - Ticket creation': 'pD5SLk5i7pq08KTR',
  'Bot - Ticket post-processing': 'oGKjMkWozlsdliYl',
  'ugg gym data collection': '49ZyB9tbZlqK3wW9',
  'ML - get account balance': 'oZAotn0Km5CdW3tz',
};

// Same derivation rule as the web pack: links come from what the row names, and
// a workflow with no known id gets a search link rather than a guessed one.
function linksFor(c) {
  const out = [];
  const blob = [c.source_detail, c.refresh_mechanism, (c.process_steps || []).join(' ')].join(' ');
  let m;
  const forms = new Set();
  const formRe = /ticket_form=([a-z_]+)/g;
  while ((m = formRe.exec(blob))) forms.add(m[1]);
  for (const f of forms) out.push({ label: 'the member-facing form', url: SUPPORT_FORM + f });

  if (/\bbot\.[a-z_]+/.test(blob)) out.push({ label: 'the data tables', url: SUPA_EDITOR });

  if (c.workflow && c.workflow !== 'n/a') {
    const first = c.workflow.split(' -> ')[0].split(' / ')[0].trim();
    const id = WORKFLOW_IDS[first];
    out.push({
      label: id ? first : first + ' (search)',
      url: id ? N8N + '/workflow/' + id : N8N + '/home/workflows?search=' + encodeURIComponent(first),
    });
  }
  const idRe = /\(([A-Za-z0-9]{16})\)/g;
  while ((m = idRe.exec(blob))) {
    if (!out.some((l) => l.url.endsWith(m[1]))) {
      out.push({ label: 'the daily sync', url: N8N + '/workflow/' + m[1] });
    }
  }
  return out;
}

(async () => {
  const cases = await rpc('case_library_view', {});
  const sources = await rpc('knowledge_sources_view', {});
  if (!Array.isArray(cases) || !Array.isArray(sources)) {
    throw new Error('unexpected response from Supabase');
  }

  const body = [];
  const issueCount = cases.filter((c) => c.known_issues).length;

  // ---- cover -------------------------------------------------------------
  body.push(para(run('Evelyn: every decision, and where the answer comes from'), { style: 'Title' }));
  body.push(para(run('TrainMore  ·  Member Care decision review  ·  11 September 2026', { sz: 11, color: '55626E' }), { after: 200 }));
  body.push(para([
    run(`All ${cases.length} cases the bot handles — what triggers each one, what it does, and which source of truth the answer is read from. `),
    run(`${issueCount} carry a known issue. Verified against the live workflows on 10 September 2026.`),
  ], { after: 160 }));

  body.push(para(run('How to use this', { b: true, sz: 11 }), { after: 60 }));
  body.push(para(run('Each case ends with a verdict line. Ring one, and write why in the space next to it — the "why" is the part that turns into work afterwards.', { sz: 9, color: '55626E' }), { after: 40 }));
  body.push(para(run('Correct — the decision and the source behind it are both right.', { sz: 9 }), { indent: 300, after: 20 }));
  body.push(para(run('Change it — something must change. Say what.', { sz: 9 }), { indent: 300, after: 20 }));
  body.push(para(run('Discuss — cannot be settled today.', { sz: 9 }), { indent: 300, after: 160 }));

  // ---- the two findings --------------------------------------------------
  body.push(para(run('Two things worth raising early'), { style: 'Heading1' }));
  body.push(para(run('Most FAQ answers are stored twice', { b: true }), { after: 40 }));
  body.push(para(run('69 of TrainMore’s 112 FAQ chunks exist twice over — once labelled freshdesk, once blob — with the same title and the same text. TrainMore FAQs.xlsx repeats articles that already sync from Freshdesk on their own, and both are imported every morning. Retrieval can hand the model the same answer twice. Decide which of the two to keep.',
    { sz: 9 }), { after: 120, bar: 'B26A00', indent: 160 }));

  body.push(para(run('The training guide is not wired to anything', { b: true }), { after: 40 }));
  body.push(para(run('The TrainMore NL Bot Training Guide is where the rules were agreed, and the 14 scenarios come from it — but it is not in the FAQ store. Its content reached the bot by being written into n8n prompts by hand. Editing the document changes nothing on its own, and nothing checks that the two still agree.',
    { sz: 9 }), { after: 160, bar: 'B26A00', indent: 160 }));

  // ---- knowledge register ------------------------------------------------
  body.push(para(run('What is influencing Evelyn’s knowledge'), { style: 'Heading1' }));
  body.push(para(run('Every document and feed that shapes what the bot knows, including the ones that produced no FAQ at all.', { sz: 9, color: '55626E' }), { after: 40 }));
  body.push(para(run('There is no ingestion log: the FAQ store is rebuilt every morning, so it remembers nothing about when a document arrived. Every date below is reconstructed, and each entry says from what.', { sz: 9, color: '55626E' }), { after: 140 }));

  for (const s of sources) {
    const colour = s.wiring === 'not_wired' ? '8E3B3B' : (s.wiring === 'deploy' ? '96570E' : '1D6B54');
    body.push(para([
      run(s.name + '  ', { b: true, sz: 11 }),
      run(WIRING_LABEL[s.wiring], { b: true, sz: 8, color: colour, caps: true }),
    ], { style: 'Heading3' }));
    body.push(para(run(s.kind + (s.faq_count != null ? `  ·  ${s.faq_count} FAQs` : ''), { sz: 8, color: '7C8792' }), { after: 40 }));
    body.push(field('Last used.', s.last_used));
    body.push(field('How we know.', s.evidence, { color: '55626E' }));
    body.push(field('What it shapes.', s.influences));
    body.push(field('Who owns it.', s.owner, { color: '55626E' }));
    if (s.risk) body.push(field('Watch out.', s.risk, { color: '8E3B3B' }));
    if (s.url) body.push(para([run('Open it.  ', { b: true, sz: 9 }), hyperlink(s.url, s.url)], { after: 120 }));
    else body.push(para(run('', { sz: 9 }), { after: 60 }));
  }

  // ---- the cases ---------------------------------------------------------
  body.push(para(run(`The ${cases.length} cases`), { style: 'Heading1' }));

  for (const area of AREAS) {
    const list = cases.filter((c) => c.area === area).sort((a, b) => a.sort_order - b.sort_order);
    if (!list.length) continue;
    body.push(para([
      run(area, { b: true, sz: 12 }),
      run(`   ${list.length} cases`, { sz: 9, color: '7C8792' }),
    ], { style: 'Heading2' }));

    for (const c of list) {
      const own = OWNERSHIP[c.source_kind] || 'nosource';
      body.push(para(run(c.trigger_label), { style: 'Heading3' }));
      body.push(para(run(
        `${ACTION_LABEL[c.action_type] || c.action_type}  ·  ${SOURCE_LABEL[c.source_kind] || c.source_kind}  ·  ${OWN_LABEL[own]}` +
        (c.measured != null ? `  ·  ${c.measured.toLocaleString('en-GB')} ${c.measured_label} / 30d` : ''),
        { sz: 8, color: '7C8792' }), { after: 60 }));

      body.push(field('What she does.', c.action_summary));
      body.push(field('Source of truth.', c.source_detail || '—', { color: '55626E' }));

      const links = linksFor(c);
      if (links.length) {
        const runs = [run('Open.  ', { b: true, sz: 9 })];
        links.forEach((l, i) => {
          if (i) runs.push(run('   ·   ', { sz: 9, color: '7C8792' }));
          runs.push(hyperlink(l.label, l.url));
        });
        body.push(para(runs, { after: 40 }));
      }
      if (c.known_issues) body.push(field('Known issue.', c.known_issues, { color: '96570E' }));

      body.push(para([
        run('Verdict:     Correct          Change it          Discuss          Why: ', { sz: 9, color: '55626E' }),
        run('.'.repeat(60), { sz: 9, color: 'C8CFD5' }),
      ], { after: 160, shade: 'F2F4F5' }));
    }
  }

  // ---- assemble the package ---------------------------------------------
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

  const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(r.url)}" TargetMode="External"/>`).join('\n')}
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

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evelyn-docx-'));
  fs.mkdirSync(path.join(tmp, '_rels'));
  fs.mkdirSync(path.join(tmp, 'word'));
  fs.mkdirSync(path.join(tmp, 'word', '_rels'));
  fs.writeFileSync(path.join(tmp, '[Content_Types].xml'), contentTypes);
  fs.writeFileSync(path.join(tmp, '_rels', '.rels'), packageRels);
  fs.writeFileSync(path.join(tmp, 'word', 'document.xml'), documentXml);
  fs.writeFileSync(path.join(tmp, 'word', 'styles.xml'), STYLES);
  fs.writeFileSync(path.join(tmp, 'word', '_rels', 'document.xml.rels'), documentRels);

  const out = path.resolve(__dirname, '../../docs/evelyn-decision-review.docx');
  if (fs.existsSync(out)) fs.unlinkSync(out);
  // -X drops resource forks; the mimetype-first trick is an ODF thing and is
  // not needed here, so a plain recursive add is correct.
  execFileSync('zip', ['-q', '-X', '-r', out, '.'], { cwd: tmp });
  fs.rmSync(tmp, { recursive: true, force: true });

  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`wrote docs/evelyn-decision-review.docx — ${kb} KB, ${cases.length} cases, ${sources.length} sources, ${rels.length} live links`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
