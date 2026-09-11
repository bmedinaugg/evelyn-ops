// Builds the interactive working-session app: 55 cases, multiplayer verdicts
// over the `db` capability, live presence over `room`, and real source links.
const fs = require('fs');
const D = __dirname;
const cases = JSON.parse(fs.readFileSync(D + '/cases.json', 'utf8'));
const volume = JSON.parse(fs.readFileSync(D + '/volume.json', 'utf8'));

const N8N = 'https://urbangymgroup-prod.app.n8n.cloud';
const SUPA_EDITOR = 'https://supabase.com/dashboard/project/rxnryvwpkdnwkpmhiiup/editor?schema=bot';
const FRESHDESK = 'https://urbangymgroup.freshdesk.com';
const SUPPORT_FORM = 'https://www.support.trainmore.com/en/support/tickets/new?ticket_form=';

// Workflow ids observed in the repo docs. Names not listed here get a search
// link instead of a guessed id — a search link cannot 404 on the wrong id.
const WORKFLOW_IDS = {
  'Bot - Main': 'Ns0OsYgRawvQzWnw',
  'Bot - Ticket Collection Agent': 'Yq2zEE9NQo6hQvnO',
  'Bot - Classify Intent': 'VdXRxTK4GYFBTeQp',
  'Bot - Ticket creation': 'pD5SLk5i7pq08KTR',
  'Bot - Ticket post-processing': 'oGKjMkWozlsdliYl',
  'ugg gym data collection': '49ZyB9tbZlqK3wW9',
  'ML - get account balance': 'oZAotn0Km5CdW3tz',
};

// Real documents behind the answers, confirmed 10 Sep 2026:
// - the spreadsheet's columns (title / description / url / category) are exactly
//   the metadata the vector store carries on its `blob`-sourced chunks;
// - the training guide is NOT in the vector store (searched) — it shaped the
//   prompts and the 14 scenario definitions, which is a different thing and is
//   called out as such on the cases it touches.
const ONEDRIVE = 'https://urbangymgroup-my.sharepoint.com/personal/bryan_medina_per_urbangymgroup_com/Documents';
const DOCS = {
  faqSheet: {
    label: 'The FAQ spreadsheet', detail: 'TrainMore FAQs.xlsx', kind: 'xlsx',
    url: ONEDRIVE + '/AI%20BOT/TrainMore%20FAQs.xlsx',
  },
  trainingGuide: {
    label: 'The training guide', detail: 'TrainMore NL Bot Training Guide (Word)', kind: 'docx',
    url: ONEDRIVE + '/Attachments/TrainMore_NL_Bot_Training_Guide_1.docx',
  },
  freshdeskFaqs: {
    label: 'The published FAQ articles', detail: 'support.trainmore.com solutions', kind: 'faq',
    url: 'https://www.support.trainmore.com/en/support/solutions',
  },
};

// ---- the knowledge register -------------------------------------------
// Everything that influences what Evelyn knows, whether or not it produced an
// FAQ. TrainMore only. `when` is always accompanied by `how we know`, because
// the vector store is rebuilt daily and so records no history of its own.
const KNOWLEDGE = [
  {
    name: 'Freshdesk help articles',
    kind: 'Published articles', wiring: 'live',
    url: 'https://www.support.trainmore.com/en/support/solutions',
    when: 'Re-imported every day. Last run 10 Sep 2026, 10:00 UTC.',
    evidence: 'Ingestion timestamp on the 112 chunks labelled source=freshdesk.',
    influences: '99 of the 104 FAQs Evelyn can answer from.',
    owner: 'Member Care — whatever you publish in Freshdesk is in the bot the next morning.',
  },
  {
    name: 'TrainMore FAQs.xlsx',
    kind: 'Excel workbook', wiring: 'live',
    url: ONEDRIVE + '/AI%20BOT/TrainMore%20FAQs.xlsx',
    when: 'Re-imported every day. Last run 10 Sep 2026, 10:00 UTC. The file itself was last edited 8 April 2026.',
    evidence: 'Its columns (title / description / url / category) are exactly the metadata on the 69 chunks labelled source=blob.',
    influences: '62 FAQs.',
    owner: 'Whoever maintains the sheet.',
    risk: 'Five months since it was last edited, but it is still imported daily and its rows duplicate Freshdesk articles. See the duplication finding.',
  },
  {
    name: 'Member Care hand-written answers',
    kind: 'Database table', wiring: 'live',
    url: SUPA_EDITOR,
    when: 'Written 26 August 2026. Re-imported daily; last run 10 Sep 2026, 10:02 UTC.',
    evidence: 'bot.manual_faqs, 5 rows, all active. Each names the tickets it was written from.',
    influences: '5 FAQs that no Freshdesk article covers at all — under-18s, employee and plus-one class booking, check-ins vs discount, PT trials, what each membership label gives you.',
    owner: 'Member Care. Editing a row changes the bot the next morning, with no deploy.',
  },
  {
    name: 'TrainMore NL Bot Training Guide',
    kind: 'Word document', wiring: 'notwired',
    url: ONEDRIVE + '/Attachments/TrainMore_NL_Bot_Training_Guide_1.docx',
    when: 'Document last edited 18 August 2026. Its content reached the bot through prompt edits on 26 Aug, 4 Sep and 6 Sep 2026.',
    evidence: 'Searched the FAQ store on 10 Sep: no trace of its text, and no .docx appears as a source. The 14 scenarios it defines are implemented as regexes in n8n nodes.',
    influences: 'The 14 scenario definitions, and the 16 prompt and guardrail cases.',
    owner: 'Esther Rumora wrote it. Nobody owns keeping the bot in step with it.',
    risk: 'This is the big one. Editing this document changes NOTHING. Someone has to re-read it and edit the prompts by hand. There is no check that the two still agree.',
  },
  {
    name: 'The club directory workbook',
    kind: 'Excel workbook', wiring: 'live',
    url: N8N + '/workflow/49ZyB9tbZlqK3wW9',
    when: 'Synced daily at 10:00, about 5 seconds. Verified in the n8n execution history for 8-9 Sep 2026.',
    evidence: 'n8n workflow "ugg gym data collection" reads UGG_Gym_Data_Collection_4.xlsx into bot.locations.',
    influences: 'Opening hours, day-pass prices and facilities for every club — 4 cases, and the only club data the bot has.',
    owner: 'Whoever maintains the workbook.',
    risk: 'We could not find the file. It is not in SharePoint under any search, so its location is configured inside the n8n node and recorded nowhere anyone can look up. The link above opens the workflow, not the sheet.',
  },
  {
    name: 'Knowledge written straight into prompts',
    kind: 'n8n nodes', wiring: 'deploy',
    url: N8N + '/workflow/Yq2zEE9NQo6hQvnO',
    when: 'Change Options Briefing and Feedback Overrides and Guardrail Patches, 26 Aug 2026. Cancel Honesty, 4 Sep 2026, revised 6 Sep. Access levels and club names, 8 Sep 2026.',
    evidence: 'The nodes carry their date in their own name, which is the only dated record of a knowledge change that exists.',
    influences: 'Freeze policy, cancellation honesty, access levels, club picking, no-show disputes, direct-debit dates.',
    owner: 'Engineering. Each change is a deploy.',
  },
  {
    name: 'Magicline',
    kind: 'Live account data', wiring: 'live',
    url: '',
    when: 'Read per member, per question. Nothing is stored or cached.',
    evidence: 'The account tools in Bot - Q&A call the Magicline API directly.',
    influences: '17 cases — contract, balance, payments, check-ins, bookings, access.',
    owner: 'Not ours. If the answer is wrong, the record in Magicline is wrong.',
  },
];

const EXTRA_RECORDED = {
  auth_email_ask:   { n: 7306, label: 'sessions reached the e-mail step' },
  auth_otp:         { n: 5836, label: 'sessions sent a code' },
  auth_wrong_code:  { n: 372,  label: 'codes never verified' },
  tick_auto_submit: { n: 92,   label: 'drafts auto-submitted' },
};

const OWNERSHIP = {
  club_directory: 'nodeploy', faq_vector: 'nodeploy', freshdesk_form: 'nodeploy', database: 'nodeploy',
  prompt: 'deploy', guardrail: 'deploy',
  magicline: 'external', freshdesk_api: 'external',
  none: 'nosource',
};
const OWNERSHIP_LABEL = {
  nodeploy: 'Changeable without a deploy',
  deploy: 'Needs a deploy',
  external: 'External system',
  nosource: 'No source of truth',
};
const OWNERSHIP_HOW = {
  nodeploy: 'Edit the sheet, the form, the FAQ store or a table. No code, no release.',
  deploy: 'An n8n prompt or guardrail node has to be edited and published.',
  external: 'Not ours. Magicline account data or the Freshdesk API decides.',
  nosource: 'Boilerplate, a refusal, or a failure path. Nothing backs it.',
};
const SOURCE_LABEL = {
  club_directory: 'Club directory', magicline: 'Magicline', prompt: 'n8n prompt',
  faq_vector: 'FAQ store', freshdesk_form: 'Freshdesk form', freshdesk_api: 'Freshdesk API',
  guardrail: 'Guardrail', database: 'Bot database', none: 'None',
};
const ACTION_LABEL = {
  answer: 'Answers', link: 'Hands over a link', ticket: 'Files a ticket', process: 'Performs an action',
  refuse: 'Declines', handoff: 'Routes to a human', block: 'Overrides the model', dead_end: 'Member gets nothing',
};

// ---- source links -----------------------------------------------------
// Every link is derived from something the case library actually names. Where
// no real URL exists the case gets an honest `gap` note instead of a guess.
function linksFor(c) {
  const out = [];
  const blob = [c.source_detail, c.refresh_mechanism, c.process_steps.join(' ')].join(' ');

  // Member-facing Freshdesk forms — the URLs are in the data already.
  const forms = new Set();
  let m; const formRe = /ticket_form=([a-z_]+)/g;
  while ((m = formRe.exec(blob))) forms.add(m[1]);
  for (const f of forms) {
    out.push({ label: 'The form a member is sent to', detail: f, url: SUPPORT_FORM + f, kind: 'form' });
  }

  // Supabase tables.
  const tables = new Set();
  const tblRe = /\bbot\.([a-z_]+)/g;
  while ((m = tblRe.exec(blob))) tables.add(m[1]);
  if (tables.size) {
    out.push({
      label: 'Data table' + (tables.size > 1 ? 's' : ''),
      detail: [...tables].map((t) => 'bot.' + t).join(', '),
      url: SUPA_EDITOR, kind: 'db',
    });
  }

  // The n8n workflow the logic lives in.
  if (c.workflow && c.workflow !== 'n/a') {
    const first = c.workflow.split(' -> ')[0].split(' / ')[0].trim();
    const id = WORKFLOW_IDS[first];
    out.push({
      label: 'Where the logic lives',
      detail: first + (id ? '' : ' (search)'),
      url: id ? N8N + '/workflow/' + id : N8N + '/home/workflows?search=' + encodeURIComponent(first),
      kind: 'n8n',
    });
  }

  // Workflows named inside the refresh mechanism (the daily sync, etc).
  const idRe = /\(([A-Za-z0-9]{16})\)/g;
  while ((m = idRe.exec(blob))) {
    if (!out.some((l) => l.url.endsWith(m[1]))) {
      out.push({ label: 'Keeps it up to date', detail: 'n8n workflow ' + m[1], url: N8N + '/workflow/' + m[1], kind: 'n8n' });
    }
  }

  if (c.source_kind === 'freshdesk_api') {
    out.push({ label: 'Freshdesk', detail: 'all tickets', url: FRESHDESK + '/a/tickets/filters/all_tickets', kind: 'fd' });
  }

  // The documents people actually edit.
  if (c.source_kind === 'faq_vector') {
    out.push(DOCS.freshdeskFaqs, DOCS.faqSheet);
  }
  if (c.source_kind === 'prompt' || c.source_kind === 'guardrail') {
    out.push(DOCS.trainingGuide);
  }

  // Honest gaps.
  const gaps = [];
  if (/UGG_Gym_Data_Collection/.test(blob)) {
    gaps.push('The workbook itself is not linked here: its location is configured inside the n8n node, not recorded anywhere we can read. Worth pinning down in the session — it is the single source for hours, day-pass prices and facilities.');
  }
  if (c.source_kind === 'magicline') {
    gaps.push('Magicline is live account data read per member through the API. There is no document to open — if the answer is wrong, the record in Magicline is wrong.');
  }
  if (c.source_kind === 'prompt' || c.source_kind === 'guardrail') {
    gaps.push('This answer is written into an n8n node, not into a document anyone can edit. Changing it is a deploy.');
    gaps.push('The training guide is linked because it is where these rules were agreed — but nothing connects the two. It is NOT in the FAQ store (searched on 10 Sep), so editing the Word document changes nothing until someone edits the prompt to match.');
  }
  if (c.source_kind === 'faq_vector') {
    gaps.push('The store is browsable after all: every chunk carries its title, category and the URL of the published article it came from. TrainMore holds 104 FAQs, 99 of which have a live support article.');
    gaps.push('Three things feed it: Freshdesk articles (99), the FAQ spreadsheet (62), and 5 answers Member Care wrote by hand. All three are re-imported daily at 10:00. See the Knowledge tab.');
    gaps.push('69 of TrainMore’s 112 FAQ chunks are stored TWICE — once labelled freshdesk and once blob, same title and same text — because the spreadsheet repeats articles that already sync from Freshdesk. Retrieval can return the same answer twice.');
  }
  if (c.source_kind === 'none') {
    gaps.push('Nothing backs this case: it is boilerplate, a refusal, or a failure path.');
  }
  return { links: out, gaps };
}

const enriched = cases.map((c) => {
  const rep = volume.replay[c.key];
  const extra = EXTRA_RECORDED[c.key];
  const { links, gaps } = linksFor(c);
  return {
    key: c.key, area: c.area, sort: c.sort_order,
    trigger: c.trigger_label, triggerDetail: c.trigger_detail,
    action: c.action_type, actionLabel: ACTION_LABEL[c.action_type] || c.action_type,
    summary: c.action_summary, steps: c.process_steps || [],
    sourceKind: c.source_kind, sourceLabel: SOURCE_LABEL[c.source_kind] || c.source_kind,
    sourceDetail: c.source_detail, workflow: c.workflow,
    refreshMech: c.refresh_mechanism, cadence: c.refresh_cadence, owner: c.refresh_owner,
    issue: c.known_issues, verified: c.verified_at,
    own: OWNERSHIP[c.source_kind] || 'nosource',
    recorded: c.measured != null ? { n: c.measured, label: c.measured_label } : (extra || null),
    replay: rep ? { n: rep.sessions } : null,
    links, gaps,
  };
}).sort((a, b) => a.sort - b.sort);

const AREAS = ['Pre-login', 'Authentication', 'Account questions', 'Self-service redirect', 'Ticketing', 'Guardrails', 'Dead ends'];
const ownCounts = {};
for (const c of enriched) ownCounts[c.own] = (ownCounts[c.own] || 0) + 1;
const issueCount = enriched.filter((c) => c.issue).length;
const numbered = enriched.filter((c) => c.recorded || c.replay).length;

// Pure-ASCII JSON so the page never depends on a charset it does not control.
const payload = JSON.stringify({
  cases: enriched, areas: AREAS, knowledge: KNOWLEDGE,
  ownershipLabel: OWNERSHIP_LABEL, ownershipHow: OWNERSHIP_HOW, ownCounts,
  issueCount, numbered,
})
  .replace(/[^\x20-\x7E]/g, (ch) => '\\u' + ch.codePointAt(0).toString(16).padStart(4, '0'))
  .replace(/</g, '\\u003c');

const html = `<title>Evelyn review &mdash; working session</title>
<style>
:root{
  --paper:#F2F4F5; --card:#FFFFFF; --ink:#14191E; --soft:#55626E; --faint:#7C8792;
  --rule:#DDE3E7; --rule-soft:#EAEEF1; --accent:#0E5A62; --accent-soft:#E3EFF0;
  --ok:#1D6B54; --warn:#96570E; --ext:#566372; --none:#8E3B3B;
  --issue-bg:#FCF5EA; --issue-bd:#E8D3AE; --on-accent:#FFFFFF;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){:root{
  --paper:#0F1316; --card:#171C21; --ink:#E7EDF1; --soft:#9DAAB6; --faint:#7A8794;
  --rule:#252D34; --rule-soft:#1E252B; --accent:#5FB9C2; --accent-soft:#13312F;
  --ok:#4FBF97; --warn:#D79A4A; --ext:#8FA0AF; --none:#DB8585;
  --issue-bg:#211C13; --issue-bd:#4A3C22; --on-accent:#0F1316;
}}
:root[data-theme="dark"]{
  --paper:#0F1316; --card:#171C21; --ink:#E7EDF1; --soft:#9DAAB6; --faint:#7A8794;
  --rule:#252D34; --rule-soft:#1E252B; --accent:#5FB9C2; --accent-soft:#13312F;
  --ok:#4FBF97; --warn:#D79A4A; --ext:#8FA0AF; --none:#DB8585;
  --issue-bg:#211C13; --issue-bd:#4A3C22; --on-accent:#0F1316;
}
:root[data-theme="light"]{
  --paper:#F2F4F5; --card:#FFFFFF; --ink:#14191E; --soft:#55626E; --faint:#7C8792;
  --rule:#DDE3E7; --rule-soft:#EAEEF1; --accent:#0E5A62; --accent-soft:#E3EFF0;
  --ok:#1D6B54; --warn:#96570E; --ext:#566372; --none:#8E3B3B;
  --issue-bg:#FCF5EA; --issue-bd:#E8D3AE; --on-accent:#FFFFFF;
}
*{box-sizing:border-box}
/* a display rule on a class beats the UA [hidden] rule, so state it outright */
[hidden]{display:none!important}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
code{font-family:var(--mono);font-size:.88em}
h1,h2,h3{margin:0;text-wrap:balance}
button,input{font:inherit}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tnum{font-variant-numeric:tabular-nums}

/* ---- app bar ---- */
.bar{position:sticky;top:0;z-index:20;background:var(--card);border-bottom:1px solid var(--rule)}
.bar-in{max-width:1000px;margin:0 auto;padding:10px 22px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.brand{display:flex;flex-direction:column;line-height:1.25;margin-right:auto}
.brand b{font-size:15px;font-weight:650;letter-spacing:-.01em}
.brand span{font-size:11.5px;color:var(--faint)}
.tabs{display:flex;gap:2px;background:var(--rule-soft);padding:3px;border-radius:3px}
.tabs button{font-size:13.5px;padding:6px 14px;border:0;background:transparent;color:var(--soft);border-radius:2px;cursor:pointer}
.tabs button:hover{color:var(--ink)}
.tabs button[aria-selected="true"]{background:var(--card);color:var(--ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.tabs button .pill{display:inline-block;margin-left:6px;font-size:11px;padding:0 5px;border-radius:8px;background:var(--accent);color:var(--on-accent);font-variant-numeric:tabular-nums}
.tabs button .pill:empty{display:none}
.meter{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--soft);white-space:nowrap}
.meter .track{width:74px;height:5px;background:var(--rule);border-radius:3px;overflow:hidden}
.meter .fill{height:100%;background:var(--accent);width:0;transition:width .25s ease}
.who{display:flex;align-items:center;gap:6px}
.who .av{width:24px;height:24px;border-radius:50%;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:700;display:grid;place-items:center;border:1px solid var(--rule)}
.who .av.me{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.namebox{font-size:13px;padding:5px 9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);border-radius:2px;width:132px}
.mode{font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;padding:3px 7px;border-radius:2px;border:1px solid var(--rule);color:var(--faint)}
.mode.live{color:var(--ok);border-color:var(--ok)}

.wrap{max-width:1000px;margin:0 auto;padding:26px 22px 90px}
.panel{background:var(--card);border:1px solid var(--rule);border-radius:4px;padding:22px 24px;margin-bottom:20px}
.panel h2{font-size:19px;font-weight:650;letter-spacing:-.01em}
.lede{margin:7px 0 18px;color:var(--soft);max-width:68ch}
.note{margin:16px 0 0;padding-top:13px;border-top:1px solid var(--rule-soft);font-size:14.5px;color:var(--soft);max-width:72ch}
.note b{color:var(--ink)}
.muted{color:var(--soft)}
.empty{color:var(--faint);font-size:15px;padding:26px 0;text-align:center}
.kcard{border:1px solid var(--rule);border-left-width:3px;border-radius:3px;padding:16px 18px;margin-bottom:14px;display:flex;flex-direction:column;gap:9px}
.kcard.wire-live{border-left-color:var(--ok)}
.kcard.wire-deploy{border-left-color:var(--warn)}
.kcard.wire-notwired{border-left-color:var(--none)}
.khead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
.kleft{display:flex;flex-direction:column;gap:2px}
.kleft h3{font-size:16.5px;font-weight:650;letter-spacing:-.01em}
.kkind{font-size:12px;color:var(--faint)}
.wire{font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;padding:3px 9px;border-radius:2px;border:1px solid currentColor;white-space:nowrap}
.wire.wire-live{color:var(--ok)} .wire.wire-deploy{color:var(--warn)} .wire.wire-notwired{color:var(--none)}
.krow{display:grid;grid-template-columns:118px 1fr;gap:14px;align-items:start}
.krow p{margin:0;max-width:74ch}
.krisk{color:var(--none)}
.klinks{padding-top:2px}
.findings{border-left:3px solid var(--warn)}
.finding{padding:14px 0;border-top:1px solid var(--rule-soft)}
.finding h3{font-size:15.5px;font-weight:650;margin-bottom:5px}
.finding p{margin:0;color:var(--soft);max-width:76ch}
.finding p b{color:var(--ink)}

/* ---- filters ---- */
.tools{display:flex;flex-direction:column;gap:10px;padding:14px 16px;background:var(--rule-soft);border-radius:3px;margin-bottom:18px}
.frow{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.flab{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:600;min-width:58px}
.chip{font-size:13px;padding:5px 11px;border:1px solid var(--rule);background:var(--card);color:var(--soft);border-radius:2px;cursor:pointer}
.chip:hover{color:var(--ink);border-color:var(--faint)}
.chip.on{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:middle}
.dot.own-nodeploy{background:var(--ok)} .dot.own-deploy{background:var(--warn)}
.dot.own-external{background:var(--ext)} .dot.own-nosource{background:var(--none)}
.shown{margin:0;font-size:12.5px;color:var(--faint)}

/* ---- case ---- */
.areahead{font-size:12.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--accent);font-weight:700;padding:22px 0 7px;border-bottom:1px solid var(--rule);display:flex;justify-content:space-between}
.areahead span{color:var(--faint)}
.case{border-bottom:1px solid var(--rule-soft);padding:18px 0;display:flex;flex-direction:column;gap:11px}
.chead{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
.ctitle{display:flex;flex-direction:column;gap:2px}
.ctitle h3{font-size:17px;font-weight:640;letter-spacing:-.01em}
.ckey{font-family:var(--mono);font-size:11.5px;color:var(--faint)}
.ctags{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.tag{font-size:12px;padding:3px 9px;border-radius:2px;border:1px solid var(--rule);color:var(--soft);white-space:nowrap}
.tag.src::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:7px;vertical-align:middle}
.tag.src.own-nodeploy::before{background:var(--ok)} .tag.src.own-deploy::before{background:var(--warn)}
.tag.src.own-external::before{background:var(--ext)} .tag.src.own-nosource::before{background:var(--none)}
.summary{margin:0;max-width:78ch}
.figs{display:flex;gap:8px;flex-wrap:wrap}
.fig{display:flex;align-items:baseline;gap:7px;padding:5px 11px;border:1px solid var(--rule);border-radius:3px;font-size:12.5px;color:var(--soft)}
.fig b{font-size:15px;color:var(--ink);font-weight:650}
.fig i{font-style:normal;font-size:10px;letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:var(--faint)}

.srcbox{border:1px solid var(--rule);border-radius:3px;padding:12px 14px;display:flex;flex-direction:column;gap:9px;background:var(--paper)}
.srchead{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);font-weight:600}
.links{display:flex;flex-wrap:wrap;gap:7px}
.link{display:inline-flex;align-items:center;gap:7px;font-size:13px;padding:5px 10px;border:1px solid var(--rule);border-radius:2px;background:var(--card);color:var(--accent);text-decoration:none}
.link:hover{border-color:var(--accent)}
.link b{color:var(--ink);font-weight:600}
.link .k{font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint);font-weight:700}
.gap{font-size:13.5px;color:var(--soft);margin:0;max-width:76ch}
.srcdetail{font-size:13.5px;color:var(--soft);margin:0;max-width:76ch}

.issue{background:var(--issue-bg);border:1px solid var(--issue-bd);border-radius:3px;padding:10px 13px;font-size:14px}
.issue b{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);display:block;margin-bottom:3px;font-weight:600}
.more{align-self:flex-start;font-size:13px;padding:4px 10px;border:1px solid var(--rule);background:transparent;color:var(--soft);border-radius:2px;cursor:pointer}
.more:hover{color:var(--ink);border-color:var(--faint)}
.detail{display:flex;flex-direction:column;gap:9px;padding-top:2px}
.drow{display:grid;grid-template-columns:124px 1fr;gap:14px;align-items:start}
.drow p,.drow ol{margin:0}
.dlab{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);font-weight:600;padding-top:3px}
.steps{padding-left:17px;display:flex;flex-direction:column;gap:2px;font-size:14.5px;color:var(--soft)}

/* ---- verdict ---- */
.vote{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:3px}
.vbtns{display:flex;gap:5px}
.vbtns button{font-size:13px;padding:5px 12px;border:1px solid var(--rule);background:transparent;color:var(--soft);border-radius:2px;cursor:pointer}
.vbtns button:hover{color:var(--ink);border-color:var(--faint)}
.vbtns button[aria-pressed="true"][data-v="ok"]{background:var(--ok);border-color:var(--ok);color:var(--on-accent)}
.vbtns button[aria-pressed="true"][data-v="change"]{background:var(--none);border-color:var(--none);color:var(--on-accent)}
.vbtns button[aria-pressed="true"][data-v="discuss"]{background:var(--warn);border-color:var(--warn);color:var(--on-accent)}
.tally{display:flex;gap:5px;align-items:center;font-size:12.5px;color:var(--soft)}
.tal{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:2px;border:1px solid var(--rule)}
.tal.ok{color:var(--ok)} .tal.change{color:var(--none)} .tal.discuss{color:var(--warn)}
.tal b{font-variant-numeric:tabular-nums}
.split{font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:var(--warn);border:1px solid var(--warn);padding:2px 7px;border-radius:2px}
.vnote{font-size:13.5px;padding:6px 9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);border-radius:2px;flex:1;min-width:190px}
.others{font-size:13px;color:var(--soft);display:flex;flex-direction:column;gap:2px;width:100%}
.others i{font-style:normal;color:var(--faint)}

/* ---- summary tabs ---- */
.grp{margin-bottom:24px}
.grphead{display:flex;align-items:baseline;gap:10px;padding-bottom:8px;border-bottom:1px solid var(--rule);margin-bottom:4px}
.grphead h3{font-size:15px;font-weight:650}
.grphead span{font-size:12.5px;color:var(--faint)}
.arow{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--rule-soft)}
.arow .l{display:flex;flex-direction:column;gap:3px}
.arow .l b{font-weight:620}
.arow .l span{font-size:13.5px;color:var(--soft)}
.arow .l .who-said{font-size:12.5px;color:var(--faint)}
.arow .tal{white-space:nowrap;align-self:flex-start}
.srcgroup{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-bottom:1px solid var(--rule-soft)}
.srcgroup .feeds{font-size:13.5px;color:var(--soft)}

table{width:100%;border-collapse:collapse;font-size:15px}
.scroll{overflow-x:auto}
th{text-align:left;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);font-weight:600;padding:0 22px 8px 0;border-bottom:1px solid var(--rule)}
td{padding:11px 22px 11px 0;border-bottom:1px solid var(--rule-soft);vertical-align:top}
th:last-child,td:last-child{padding-right:0}
th.num,td.num{text-align:right;white-space:nowrap}

@media (max-width:760px){
  .drow{grid-template-columns:1fr;gap:4px}
  .bar-in{gap:10px}
  .brand{width:100%;margin-right:0}
  .wrap{padding:18px 16px 80px}
  .panel{padding:18px 16px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>

<div class="bar"><div class="bar-in">
  <div class="brand"><b>Evelyn &mdash; decision review</b><span>TrainMore &middot; 55 cases &middot; verified 10 Sep 2026 &middot; volumes over 30 days to 10 Sep</span></div>
  <div class="tabs" role="tablist">
    <button role="tab" data-tab="review" aria-selected="true">Review</button>
    <button role="tab" data-tab="actions" aria-selected="false">Actions<span class="pill" id="pill-actions"></span></button>
    <button role="tab" data-tab="splits" aria-selected="false">Splits<span class="pill" id="pill-splits"></span></button>
    <button role="tab" data-tab="sources" aria-selected="false">Sources</button>
    <button role="tab" data-tab="knowledge" aria-selected="false">Knowledge</button>
  </div>
  <div class="meter"><div class="track"><div class="fill" id="fill"></div></div><span id="prog" class="tnum">0 of 55</span></div>
  <div class="who" id="who"></div>
  <input class="namebox" id="name" type="text" placeholder="Your name" aria-label="Your name" autocomplete="name" />
  <span class="mode" id="mode">local</span>
</div></div>

<div class="wrap">
  <section id="tab-review">
    <div class="panel">
      <h2>What this is</h2>
      <p class="lede">Every case Evelyn handles, what she decides, and <b>where the answer comes from</b>. Rule on each one
      and the room's verdicts gather live. Open the links to go straight to the thing that would have to change.</p>
      <div class="scroll"><table>
        <thead><tr><th>If the answer is wrong</th><th class="num">Cases</th><th>What fixing it takes</th></tr></thead>
        <tbody id="owntable"></tbody>
      </table></div>
      <p class="note"><b>Two kinds of number, never blended.</b> <i style="font-style:normal;font-weight:700;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)">recorded</i>
      is counted from a database table &mdash; it happened.
      <i style="font-style:normal;font-weight:700;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)">ceiling</i>
      is the bot's own recogniser replayed over real messages, so it is an upper bound on demand, not a count of decisions.
      37 cases have no honest number and are left blank.</p>
    </div>
    <div class="panel findings">
      <h2>Two things worth raising early</h2>
      <p class="lede">Both turned up while tracing where each answer actually comes from. Neither is in the case library
      &mdash; they are facts about the sources themselves.</p>
      <div class="finding">
        <h3>Most FAQ answers are stored twice</h3>
        <p><b>69 of TrainMore's 112 FAQ chunks exist twice over</b> &mdash; once labelled <code>freshdesk</code>, once
        <code>blob</code> &mdash; with the same title and the same text. The cause is that
        <code>TrainMore FAQs.xlsx</code> repeats articles that already sync from Freshdesk on their own, and both are
        imported every morning. Retrieval can hand the model the same answer twice. Someone should decide which of the
        two is the one to keep.</p>
      </div>
      <div class="finding">
        <h3>The training guide is not wired to anything</h3>
        <p>Esther's <b>TrainMore NL Bot Training Guide</b> is where the rules were agreed, and the 14 scenarios come from
        it &mdash; but it is <b>not in the FAQ store</b>. Its content reached the bot by being written into n8n prompts by
        hand. Editing the Word document changes nothing on its own. If the room treats that guide as the source of truth,
        that assumption is worth correcting.</p>
      </div>
    </div>
    <div class="tools">
      <div class="frow"><span class="flab">Area</span><span id="f-area"></span></div>
      <div class="frow"><span class="flab">To fix it</span><span id="f-own"></span></div>
      <div class="frow"><span class="flab">Show</span><span id="f-show"></span></div>
      <p class="shown" id="shown"></p>
    </div>
    <div id="list"></div>
  </section>

  <section id="tab-actions" hidden>
    <div class="panel">
      <h2>What the room wants changed</h2>
      <p class="lede">Every case anyone marked <b>Change it</b>, grouped by what fixing it takes &mdash; the things you can
      do without a release first. This is the backlog you leave the meeting with.</p>
      <div id="actions"></div>
    </div>
  </section>

  <section id="tab-splits" hidden>
    <div class="panel">
      <h2>Where the room disagrees</h2>
      <p class="lede">Cases that got more than one answer. These are the conversations worth having &mdash; a majority
      verdict would bury them.</p>
      <div id="splits"></div>
    </div>
  </section>

  <section id="tab-knowledge" hidden>
    <div class="panel">
      <h2>What is influencing Evelyn's knowledge</h2>
      <p class="lede">Every document and feed that shapes what the bot knows &mdash; including the ones that produced no FAQ
      at all. TrainMore only.</p>
      <p class="note" style="margin-top:0;border-top:0;padding-top:0"><b>There is no ingestion log.</b> The FAQ store is
      rebuilt from scratch every morning, so every row is stamped with today's date and the store remembers nothing about
      when a document first arrived. Every date below therefore comes with how we know it &mdash; a file's own modified
      date, a dated node name, or a commit. Building a real ingestion log is the obvious fix.</p>
      <div id="knowledge"></div>
    </div>
  </section>

  <section id="tab-sources" hidden>
    <div class="panel">
      <h2>Where Evelyn's answers come from</h2>
      <p class="lede">The same 55 cases, grouped by source of truth rather than by topic, with a link to each thing that
      would have to be edited.</p>
      <div id="sources"></div>
    </div>
  </section>
</div>

<script id="payload" type="application/json">${payload}</script>
<script>
(function(){
"use strict";
var DATA = JSON.parse(document.getElementById('payload').textContent);
var CASES = DATA.cases;
var VERDICTS = ['ok','change','discuss'];
var VLABEL = {ok:'Correct', change:'Change it', discuss:'Discuss'};

// ---- identity: the "user" capability is not available here, so we use a
// locally-generated id plus a name the participant types.
var LS = 'evelyn-review-v2';
var local = {};
try { local = JSON.parse(localStorage.getItem(LS) || '{}'); } catch(e) { local = {}; }
if (!local.id) { local.id = 'p' + Math.random().toString(36).slice(2,10); }
if (!local.name) { local.name = ''; }
if (!local.votes) { local.votes = {}; }
function saveLocal(){ try { localStorage.setItem(LS, JSON.stringify(local)); } catch(e){} }
saveLocal();

// everyone's verdicts, keyed by participant id. Mine is always present.
var people = {};
people[local.id] = {name: local.name, votes: local.votes, me: true};

var db = null, roomNs = null, writeTimer = null;
var filters = {area:'', own:'', issues:false, unruled:false};
var tab = 'review';

// ---- tiny DOM helpers (textContent everywhere: shared data is untrusted) ---
function el(tag, cls, text){
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function fmt(n){ return n.toLocaleString('en-GB'); }

// ---- aggregation ----------------------------------------------------------
function tallyFor(key){
  var t = {ok:0, change:0, discuss:0, total:0, notes:[]};
  Object.keys(people).forEach(function(pid){
    var p = people[pid];
    var rec = p.votes && p.votes[key];
    if (!rec) return;
    if (rec.v && VERDICTS.indexOf(rec.v) >= 0) { t[rec.v]++; t.total++; }
    if (rec.note) t.notes.push({name: p.name || 'Someone', note: rec.note, v: rec.v});
  });
  t.distinct = VERDICTS.filter(function(v){ return t[v] > 0; }).length;
  return t;
}
function myVote(key){ return (local.votes[key] || {}); }
function ruledCount(){
  return CASES.filter(function(c){ return tallyFor(c.key).total > 0; }).length;
}

// ---- writing --------------------------------------------------------------
function pushMine(){
  people[local.id] = {name: local.name, votes: local.votes, me: true};
  saveLocal();
  if (!db) return;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(function(){
    db.doc('verdicts/' + local.id).set({
      name: local.name || '', votes: local.votes, updatedAt: Date.now()
    }).catch(function(err){
      if (err && err.code === 'quota_exceeded') setMode('full');
      else if (err && err.code === 'revoked') setMode('local');
    });
  }, 400);
}

function setMode(m){
  var n = document.getElementById('mode');
  if (m === 'live'){ n.textContent = 'live'; n.className = 'mode live';
    n.title = 'Verdicts are shared with everyone who has this page open.'; }
  else if (m === 'full'){ n.textContent = 'storage full'; n.className = 'mode';
    n.title = 'The store is full, so new verdicts are not being shared. Yours are still saved on this device.'; }
  else { n.textContent = 'this device'; n.className = 'mode';
    n.title = 'Shared verdicts are unavailable in this view. Yours are saved on this device only.'; }
}

// ---- rendering: one case --------------------------------------------------
function caseNode(c){
  var art = el('article','case');
  art.id = 'case-' + c.key;

  var head = el('div','chead');
  var t = el('div','ctitle');
  t.appendChild(el('h3', null, c.trigger));
  t.appendChild(el('span','ckey', c.key));
  head.appendChild(t);
  var tags = el('div','ctags');
  tags.appendChild(el('span','tag', c.actionLabel));
  tags.appendChild(el('span','tag src own-' + c.own, c.sourceLabel));
  head.appendChild(tags);
  art.appendChild(head);

  art.appendChild(el('p','summary', c.summary));

  if (c.recorded || c.replay){
    var figs = el('div','figs');
    if (c.recorded){
      var f1 = el('div','fig');
      f1.appendChild(el('b', null, fmt(c.recorded.n)));
      f1.appendChild(el('span', null, c.recorded.label));
      f1.appendChild(el('i', null, 'recorded'));
      figs.appendChild(f1);
    }
    if (c.replay){
      var f2 = el('div','fig');
      f2.appendChild(el('b', null, fmt(c.replay.n)));
      f2.appendChild(el('span', null, 'sessions match the recogniser'));
      f2.appendChild(el('i', null, 'ceiling'));
      figs.appendChild(f2);
    }
    art.appendChild(figs);
  }

  // sources: the part the room asked for
  var box = el('div','srcbox');
  box.appendChild(el('div','srchead','Where the answer comes from'));
  box.appendChild(el('p','srcdetail', c.sourceDetail));
  if (c.links.length){
    var ls = el('div','links');
    c.links.forEach(function(l){
      var a = document.createElement('a');
      a.className = 'link'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.appendChild(el('span','k', l.kind));
      a.appendChild(el('b', null, l.label));
      a.appendChild(el('span', null, l.detail));
      ls.appendChild(a);
    });
    box.appendChild(ls);
  }
  c.gaps.forEach(function(g){ box.appendChild(el('p','gap', g)); });
  art.appendChild(box);

  if (c.issue){
    var iss = el('div','issue');
    iss.appendChild(el('b', null, 'Known issue'));
    iss.appendChild(el('span', null, c.issue));
    art.appendChild(iss);
  }

  // collapsed depth
  var moreBtn = el('button','more','Detail');
  moreBtn.type = 'button';
  moreBtn.setAttribute('aria-expanded','false');
  var det = el('div','detail');
  det.hidden = true;
  function row(label, value){
    var r = el('div','drow');
    r.appendChild(el('span','dlab', label));
    r.appendChild(el('p', null, value));
    return r;
  }
  det.appendChild(row('Fires when', c.triggerDetail));
  if (c.steps.length){
    var r = el('div','drow');
    r.appendChild(el('span','dlab','Process'));
    var ol = el('ol','steps');
    c.steps.forEach(function(s){ ol.appendChild(el('li', null, s)); });
    r.appendChild(ol);
    det.appendChild(r);
  }
  det.appendChild(row('Kept current by', c.refreshMech));
  det.appendChild(row('Cadence', c.cadence));
  det.appendChild(row('Who owns it', c.owner));
  moreBtn.addEventListener('click', function(){
    det.hidden = !det.hidden;
    moreBtn.setAttribute('aria-expanded', String(!det.hidden));
    moreBtn.textContent = det.hidden ? 'Detail' : 'Hide detail';
  });
  art.appendChild(moreBtn);
  art.appendChild(det);

  // verdict row
  var vote = el('div','vote');
  var btns = el('div','vbtns');
  VERDICTS.forEach(function(v){
    var b = el('button', null, VLABEL[v]);
    b.type = 'button'; b.dataset.v = v;
    b.setAttribute('aria-pressed', String(myVote(c.key).v === v));
    b.addEventListener('click', function(){
      var cur = local.votes[c.key] || {};
      cur.v = (cur.v === v) ? '' : v;
      local.votes[c.key] = cur;
      pushMine();
      // Repaint this group directly: renderAll() deliberately leaves the list
      // alone (re-rendering it would blur the note field mid-typing).
      btns.querySelectorAll('button').forEach(function(o){
        o.setAttribute('aria-pressed', String(o.dataset.v === cur.v && !!cur.v));
      });
      renderAll();
    });
    btns.appendChild(b);
  });
  vote.appendChild(btns);

  var tal = el('div','tally');
  tal.id = 'tally-' + c.key;
  vote.appendChild(tal);

  var note = el('input','vnote');
  note.type = 'text';
  note.placeholder = 'Why? (optional)';
  note.setAttribute('aria-label', 'Note for ' + c.trigger);
  note.value = myVote(c.key).note || '';
  note.addEventListener('input', function(){
    var cur = local.votes[c.key] || {};
    cur.note = note.value;
    local.votes[c.key] = cur;
    pushMine();
  });
  vote.appendChild(note);

  var others = el('div','others');
  others.id = 'others-' + c.key;
  vote.appendChild(others);

  art.appendChild(vote);
  return art;
}

function paintTally(c){
  var t = tallyFor(c.key);
  var node = document.getElementById('tally-' + c.key);
  if (!node) return;
  node.textContent = '';
  if (!t.total){ node.appendChild(el('span','muted','no verdict yet')); }
  else {
    VERDICTS.forEach(function(v){
      if (!t[v]) return;
      var s = el('span','tal ' + v);
      s.appendChild(el('b', null, String(t[v])));
      s.appendChild(el('span', null, VLABEL[v]));
      node.appendChild(s);
    });
    if (t.distinct > 1) node.appendChild(el('span','split','split'));
  }
  var o = document.getElementById('others-' + c.key);
  if (!o) return;
  o.textContent = '';
  t.notes.forEach(function(n){
    var line = el('div', null);
    line.appendChild(el('i', null, n.name + (n.v ? ' (' + VLABEL[n.v] + ')' : '') + ': '));
    line.appendChild(document.createTextNode(n.note));
    o.appendChild(line);
  });
}

// ---- list + filters -------------------------------------------------------
function passes(c){
  if (filters.area && c.area !== filters.area) return false;
  if (filters.own && c.own !== filters.own) return false;
  if (filters.issues && !c.issue) return false;
  if (filters.unruled && tallyFor(c.key).total > 0) return false;
  return true;
}

function renderList(){
  var host = document.getElementById('list');
  host.textContent = '';
  var shown = 0;
  DATA.areas.forEach(function(area){
    var list = CASES.filter(function(c){ return c.area === area && passes(c); });
    if (!list.length) return;
    var h = el('div','areahead');
    h.appendChild(el('span', null, area));
    h.appendChild(el('span', null, String(list.length)));
    host.appendChild(h);
    list.forEach(function(c){ host.appendChild(caseNode(c)); shown++; });
  });
  if (!shown) host.appendChild(el('p','empty','No cases match these filters.'));
  document.getElementById('shown').textContent = shown + ' of ' + CASES.length + ' cases shown';
  CASES.forEach(function(c){ if (passes(c)) paintTally(c); });
}

function renderFilters(){
  function group(hostId, items, key){
    var host = document.getElementById(hostId);
    host.textContent = '';
    items.forEach(function(it){
      var b = el('button','chip' + (filters[key] === it.v ? ' on' : ''));
      b.type = 'button';
      if (it.dot) b.appendChild(el('span','dot own-' + it.v));
      b.appendChild(document.createTextNode(it.label));
      b.addEventListener('click', function(){ filters[key] = it.v; renderFilters(); renderList(); });
      host.appendChild(b);
    });
  }
  group('f-area', [{v:'',label:'All'}].concat(DATA.areas.map(function(a){ return {v:a,label:a}; })), 'area');
  group('f-own', [{v:'',label:'All'}].concat(Object.keys(DATA.ownershipLabel).map(function(k){
    return {v:k, label:DATA.ownershipLabel[k], dot:true};
  })), 'own');

  var show = document.getElementById('f-show');
  show.textContent = '';
  [['issues','Only known issues (' + DATA.issueCount + ')'],['unruled','Not yet ruled on']].forEach(function(pair){
    var b = el('button','chip' + (filters[pair[0]] ? ' on' : ''), pair[1]);
    b.type = 'button';
    b.addEventListener('click', function(){ filters[pair[0]] = !filters[pair[0]]; renderFilters(); renderList(); });
    show.appendChild(b);
  });
  var exp = el('button','chip','Copy for Teams');
  exp.type = 'button';
  exp.addEventListener('click', function(){ copyOut(exp); });
  show.appendChild(exp);
}

// ---- summary tabs ---------------------------------------------------------
function renderActions(){
  var host = document.getElementById('actions');
  host.textContent = '';
  var wanted = CASES.map(function(c){ return {c:c, t:tallyFor(c.key)}; })
                    .filter(function(x){ return x.t.change > 0; });
  document.getElementById('pill-actions').textContent = wanted.length ? String(wanted.length) : '';
  if (!wanted.length){
    host.appendChild(el('p','empty','Nothing marked "Change it" yet.'));
    return;
  }
  Object.keys(DATA.ownershipLabel).forEach(function(own){
    var rows = wanted.filter(function(x){ return x.c.own === own; })
                     .sort(function(a,b){ return b.t.change - a.t.change; });
    if (!rows.length) return;
    var g = el('div','grp');
    var gh = el('div','grphead');
    var h3 = el('h3', null, DATA.ownershipLabel[own]);
    gh.appendChild(h3);
    gh.appendChild(el('span', null, DATA.ownershipHow[own]));
    g.appendChild(gh);
    rows.forEach(function(x){
      var r = el('div','arow');
      var l = el('div','l');
      l.appendChild(el('b', null, x.c.trigger));
      l.appendChild(el('span', null, x.c.sourceLabel + ' \\u2014 ' + x.c.owner));
      x.t.notes.filter(function(n){ return n.v === 'change'; }).forEach(function(n){
        l.appendChild(el('span','who-said', n.name + ': ' + n.note));
      });
      r.appendChild(l);
      var tal = el('span','tal change');
      tal.appendChild(el('b', null, String(x.t.change)));
      tal.appendChild(el('span', null, 'want this changed'));
      r.appendChild(tal);
      g.appendChild(r);
    });
    host.appendChild(g);
  });
}

function renderSplits(){
  var host = document.getElementById('splits');
  host.textContent = '';
  var split = CASES.map(function(c){ return {c:c, t:tallyFor(c.key)}; })
                   .filter(function(x){ return x.t.distinct > 1; });
  document.getElementById('pill-splits').textContent = split.length ? String(split.length) : '';
  if (!split.length){
    host.appendChild(el('p','empty','No disagreements yet.'));
    return;
  }
  split.forEach(function(x){
    var r = el('div','arow');
    var l = el('div','l');
    l.appendChild(el('b', null, x.c.trigger));
    l.appendChild(el('span', null, x.c.summary));
    x.t.notes.forEach(function(n){
      l.appendChild(el('span','who-said', n.name + (n.v ? ' (' + VLABEL[n.v] + ')' : '') + ': ' + n.note));
    });
    r.appendChild(l);
    var tt = el('div','tally');
    VERDICTS.forEach(function(v){
      if (!x.t[v]) return;
      var s = el('span','tal ' + v);
      s.appendChild(el('b', null, String(x.t[v])));
      s.appendChild(el('span', null, VLABEL[v]));
      tt.appendChild(s);
    });
    r.appendChild(tt);
    host.appendChild(r);
  });
}

function renderSources(){
  var host = document.getElementById('sources');
  if (host.dataset.done) return;
  host.dataset.done = '1';
  var byKind = {};
  CASES.forEach(function(c){ (byKind[c.sourceKind] = byKind[c.sourceKind] || []).push(c); });
  Object.keys(byKind).sort(function(a,b){ return byKind[b].length - byKind[a].length; }).forEach(function(kind){
    var list = byKind[kind];
    var g = el('div','grp');
    var gh = el('div','grphead');
    gh.appendChild(el('h3', null, list[0].sourceLabel));
    gh.appendChild(el('span', null, list.length + ' cases \\u2014 ' + DATA.ownershipLabel[list[0].own]));
    g.appendChild(gh);

    var seen = {};
    var box = el('div','srcgroup');
    box.appendChild(el('div','srchead','Open the source'));
    var ls = el('div','links');
    list.forEach(function(c){
      c.links.forEach(function(l){
        if (seen[l.url]) return;
        seen[l.url] = 1;
        var a = document.createElement('a');
        a.className = 'link'; a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.appendChild(el('span','k', l.kind));
        a.appendChild(el('b', null, l.label));
        a.appendChild(el('span', null, l.detail));
        ls.appendChild(a);
      });
    });
    if (!ls.childNodes.length) ls.appendChild(el('span','gap','No document to open.'));
    box.appendChild(ls);
    var gaps = {};
    list.forEach(function(c){ c.gaps.forEach(function(gp){ gaps[gp] = 1; }); });
    Object.keys(gaps).forEach(function(gp){ box.appendChild(el('p','gap', gp)); });
    box.appendChild(el('p','feeds','Feeds: ' + list.map(function(c){ return c.trigger; }).join(' \\u00b7 ')));
    g.appendChild(box);
    host.appendChild(g);
  });
}

var WIRING = {
  live:     {label:'Live', hint:'Re-read automatically. Change it and the bot follows.'},
  deploy:   {label:'Deploy', hint:'Written into n8n. Changing it needs a release.'},
  notwired: {label:'Not wired', hint:'Nothing reads this. Editing it changes nothing.'}
};

function renderKnowledge(){
  var host = document.getElementById('knowledge');
  if (host.dataset.done) return;
  host.dataset.done = '1';
  DATA.knowledge.forEach(function(k){
    var card = el('div','kcard wire-' + k.wiring);
    var head = el('div','khead');
    var left = el('div','kleft');
    left.appendChild(el('h3', null, k.name));
    left.appendChild(el('span','kkind', k.kind));
    head.appendChild(left);
    var w = el('span','wire wire-' + k.wiring, WIRING[k.wiring].label);
    w.title = WIRING[k.wiring].hint;
    head.appendChild(w);
    card.appendChild(head);

    function row(label, value, cls){
      var r = el('div','krow');
      r.appendChild(el('span','dlab', label));
      r.appendChild(el('p', cls || null, value));
      return r;
    }
    card.appendChild(row('Last used', k.when));
    card.appendChild(row('How we know', k.evidence, 'muted'));
    card.appendChild(row('What it shapes', k.influences));
    card.appendChild(row('Who owns it', k.owner, 'muted'));
    if (k.risk) card.appendChild(row('Watch out', k.risk, 'krisk'));
    if (k.url){
      var a = document.createElement('a');
      a.className = 'link'; a.href = k.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.appendChild(el('b', null, 'Open it'));
      a.appendChild(el('span', null, k.kind));
      var wrap = el('div','klinks');
      wrap.appendChild(a);
      card.appendChild(wrap);
    }
    host.appendChild(card);
  });
}

function renderOwnTable(){
  var tb = document.getElementById('owntable');
  if (tb.dataset.done) return;
  tb.dataset.done = '1';
  Object.keys(DATA.ownershipLabel).forEach(function(k){
    var tr = document.createElement('tr');
    var td1 = document.createElement('td');
    td1.appendChild(el('span','dot own-' + k));
    td1.appendChild(document.createTextNode(DATA.ownershipLabel[k]));
    var td2 = document.createElement('td');
    td2.className = 'num tnum';
    td2.textContent = String(DATA.ownCounts[k] || 0);
    var td3 = document.createElement('td');
    td3.className = 'muted';
    td3.textContent = DATA.ownershipHow[k];
    tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
    tb.appendChild(tr);
  });
}

function renderProgress(){
  var n = ruledCount();
  document.getElementById('prog').textContent = n + ' of ' + CASES.length;
  document.getElementById('fill').style.width = (100 * n / CASES.length) + '%';
}

function renderWho(){
  var host = document.getElementById('who');
  host.textContent = '';
  var ids = Object.keys(people);
  ids.slice(0, 8).forEach(function(pid){
    var p = people[pid];
    var nm = (p.name || '?').trim();
    var initials = nm ? nm.split(/\\s+/).slice(0,2).map(function(w){ return w[0]; }).join('').toUpperCase() : '?';
    var a = el('span','av' + (p.me ? ' me' : ''), initials);
    a.title = nm || 'Unnamed participant';
    host.appendChild(a);
  });
  if (ids.length > 8) host.appendChild(el('span','av', '+' + (ids.length - 8)));
}

function renderAll(){
  renderProgress();
  renderWho();
  CASES.forEach(paintTally);
  renderActions();
  renderSplits();
}

// ---- export ---------------------------------------------------------------
function copyOut(btn){
  var lines = ['Evelyn decision review \\u2014 ' + new Date().toISOString().slice(0,10), ''];
  var n = ruledCount();
  lines.push(n + ' of ' + CASES.length + ' cases ruled on.');
  lines.push('');
  Object.keys(DATA.ownershipLabel).forEach(function(own){
    var rows = CASES.map(function(c){ return {c:c, t:tallyFor(c.key)}; })
                    .filter(function(x){ return x.c.own === own && x.t.change > 0; })
                    .sort(function(a,b){ return b.t.change - a.t.change; });
    if (!rows.length) return;
    lines.push('## CHANGE \\u2014 ' + DATA.ownershipLabel[own]);
    rows.push();
    rows.forEach(function(x){
      lines.push('- ' + x.c.trigger + ' [' + x.c.sourceLabel + '] (' + x.t.change + ' want it changed)');
      x.t.notes.filter(function(nt){ return nt.v === 'change'; }).forEach(function(nt){
        lines.push('    ' + nt.name + ': ' + nt.note);
      });
    });
    lines.push('');
  });
  var split = CASES.map(function(c){ return {c:c, t:tallyFor(c.key)}; }).filter(function(x){ return x.t.distinct > 1; });
  if (split.length){
    lines.push('## SPLIT \\u2014 needs another conversation');
    split.forEach(function(x){
      lines.push('- ' + x.c.trigger + ': ' + VERDICTS.filter(function(v){ return x.t[v]; })
        .map(function(v){ return x.t[v] + ' ' + VLABEL[v]; }).join(', '));
    });
    lines.push('');
  }
  var unruled = CASES.filter(function(c){ return tallyFor(c.key).total === 0; });
  if (unruled.length){
    lines.push('## NOT REACHED (' + unruled.length + ')');
    unruled.forEach(function(c){ lines.push('- ' + c.trigger); });
  }
  var text = lines.join('\\n');
  function done(ok){
    var o = btn.textContent;
    btn.textContent = ok ? 'Copied' : 'Press Cmd+C';
    setTimeout(function(){ btn.textContent = o; }, 1600);
  }
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ fallback(); });
  } else fallback();
  function fallback(){
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(true); } catch(e){ done(false); }
    document.body.removeChild(ta);
  }
}

// ---- tabs -----------------------------------------------------------------
document.querySelectorAll('.tabs button').forEach(function(b){
  b.addEventListener('click', function(){
    tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach(function(o){
      o.setAttribute('aria-selected', String(o === b));
    });
    ['review','actions','splits','sources','knowledge'].forEach(function(t){
      document.getElementById('tab-' + t).hidden = (t !== tab);
    });
    if (tab === 'knowledge') renderKnowledge();
    if (tab === 'sources') renderSources();
    if (tab === 'actions') renderActions();
    if (tab === 'splits') renderSplits();
    window.scrollTo(0,0);
  });
});

// ---- name -----------------------------------------------------------------
var nameInput = document.getElementById('name');
nameInput.value = local.name;
nameInput.addEventListener('input', function(){
  local.name = nameInput.value.slice(0,40);
  pushMine();
  renderWho();
  if (roomNs) roomNs.presence({name: local.name}).catch(function(){});
});

// ---- first paint (works with no capabilities at all) ----------------------
renderOwnTable();
renderFilters();
renderList();
renderAll();
setMode('local');

// ---- live: shared verdicts + presence -------------------------------------
if (window.claude && typeof window.claude.use === 'function'){
  window.claude.use('db').then(function(ns){
    if (!ns) return;
    db = ns;
    setMode('live');
    db.collection('verdicts').onSnapshot(function(snap){
      var next = {};
      snap.docs.forEach(function(d){
        var body = d.data() || {};
        next[d.id] = {name: body.name || '', votes: body.votes || {}, me: d.id === local.id};
      });
      next[local.id] = {name: local.name, votes: local.votes, me: true};
      people = next;
      renderAll();
      // Rebuilding the list on someone else's vote would blur a note field
      // mid-sentence, so only do it when a filter depends on other people's
      // verdicts, and never while this viewer is typing.
      var typing = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (filters.unruled && !typing) renderList();
    }, function(err){
      if (err && (err.code === 'revoked' || err.code === 'unavailable')) setMode('local');
    });
    if (Object.keys(local.votes).length) pushMine();
  }).catch(function(){});

  window.claude.use('room').then(function(ns){
    if (!ns) return;
    roomNs = ns;
    ns.presence({name: local.name}).catch(function(){});
    ns.onPeers(function(change){
      var here = {};
      (change.peers || []).forEach(function(p){
        if (p.kind !== 'viewer') return;
        here[p.peer] = (p.presence && p.presence.name) || '';
      });
      // presence only decorates; verdict data always comes from db.
      renderWho();
    }, function(){});
  }).catch(function(){});
}
})();
</script>`;

fs.writeFileSync(D + '/evelyn-review-app.html', html);
const nonAscii = [...html].filter((ch) => ch.codePointAt(0) > 127);
console.log('written:', (html.length / 1024).toFixed(1) + 'KB');
console.log('non-ASCII:', nonAscii.length, nonAscii.length ? JSON.stringify([...new Set(nonAscii)].join('')) : '');
console.log('cases:', enriched.length, '| with links:', enriched.filter((c) => c.links.length).length,
            '| with gaps:', enriched.filter((c) => c.gaps.length).length);
const totalLinks = enriched.reduce((a, c) => a + c.links.length, 0);
console.log('total source links:', totalLinks);
