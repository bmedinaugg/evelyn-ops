// Builds the knowledge gaps: subjects members raise that Evelyn has no solid
// answer for.
//
//   node tools/review/pull.js      # refresh the member-message window
//   node tools/gaps/build.js       # label, canonicalise, count → gaps.json
//   node tools/gaps/seed.js        # replace the rows in Supabase
//
// WHY A MODEL IS INVOLVED AT ALL
// A keyword pass over the same data was tried first and produced mush: its top
// "subjects" were `gym + like`, `dear + team` and `know + like` — grammar, not
// subjects — and single clusters mixed an invoice request, a club-closure
// complaint and an injury cancellation. Real gaps cluster by MEANING, which is
// the one thing term-matching cannot see.
//
// WHERE THE MODEL STOPS
// It labels and merges. It never counts. Every number on the page is computed
// in code from the matcher the model proposed, over the full message window,
// and the matcher is stored so the number can be argued with — the same
// discipline as tools/questions/build.js, where the matchers happen to be
// hand-written instead of drafted. A model that returns different labels on a
// re-run changes which subjects appear; it cannot change what a subject's
// count means.
//
// THE POOL IS DELIBERATELY NARROW
// Candidates come only from sessions the scorecard marks `no_answer` — the bot
// produced no substantive answer at all (514 of 9,692 sessions, 5.3%). "Became
// a ticket" was considered and rejected as a second signal: plenty of tickets
// are correct behaviour, because a cancellation or an invoice SHOULD become a
// ticket, and counting those as gaps would inflate every subject that legally
// requires a human. The cost of the narrow pool is real and stated on the
// page: a gap where the bot answered fluently and wrongly is invisible here.
//
// WHY THE MODEL CALL GOES THROUGH n8n
// There is no Anthropic key on the developer machine; n8n already holds one.
// So the two model passes are posted to a webhook — "Bot - Knowledge Gap
// Labeller" (5lcGosO0BhrB9y6Y) — which forwards them to Claude and returns the
// structured reply. The workflow is a dumb pipe on purpose: the prompts and
// the JSON schemas stay HERE, in git, because anything typed into an n8n node
// needs an edit and a publish to change, which is the exact trap the knowledge
// register exists to document. It authenticates with the header credential the
// regression harness already uses, so there is no new secret to hand out.
const fs = require('fs');
const https = require('https');

const ROOT = __dirname + '/../..';
const TODAY = new Date().toISOString().slice(0, 10);
const MODEL = 'claude-opus-5';
const BATCH = 40;

const env = {};
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (t.includes('=') && !t.startsWith('#')) {
    const i = t.indexOf('=');
    env[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, '');
  }
}
const SUPA = env.SUPABASE_URL.replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
// Same host as N8N_HARNESS_WEBHOOK_URL, different path — derived rather than
// configured, so there is no third URL for anyone to keep in sync.
const LABELLER_URL = (env.N8N_HARNESS_WEBHOOK_URL || '')
  .replace(/\/webhook(-test)?\/.*$/, '/webhook/evelyn-knowledge-gaps');
const HARNESS_SECRET = env.N8N_HARNESS_SECRET;
if (!LABELLER_URL.startsWith('http') || !HARNESS_SECRET) {
  throw new Error('N8N_HARNESS_WEBHOOK_URL and N8N_HARNESS_SECRET must be set in .env.local');
}

function get(path) {
  return new Promise((res, rej) => {
    https.get(SUPA + path, {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'bot' },
    }, (r) => {
      let b = '';
      r.on('data', (d) => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 200))); } });
    }).on('error', rej);
  });
}
// PostgREST caps an unbounded select at 1,000 rows and says nothing about it.
async function paged(path) {
  let all = [];
  for (let off = 0; ; off += 1000) {
    const rows = await get(`${path}&order=session_id.asc&offset=${off}&limit=1000`);
    if (!Array.isArray(rows) || !rows.length) break;
    all = all.concat(rows);
    if (rows.length < 1000) break;
  }
  return all;
}

// Same masking as every other generator here. Members paste e-mail addresses,
// phone numbers and IBANs straight into the chat, and this text goes to a model
// and then onto a page.
const redact = (t) => String(t)
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
  .replace(/\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?\d{4}[\s]?\d{2,10}\b/gi, '[IBAN]')
  .replace(/(?:\+31|0031|\b0)[\s-]?(?:\d[\s-]?){8,9}\d\b/g, '[phone]')
  .replace(/\b\d{7,}\b/g, '[number]');

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Schemas. Structured output rather than "return JSON" in the prompt: the
// shape is enforced at the API, so a malformed batch fails loudly here instead
// of silently producing a half-empty page.
// ---------------------------------------------------------------------------
const LABEL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The index of the question, as given.' },
          subject: { type: 'string', description: 'Short subject label, 2-5 words, in English. Describe what the member wants to know, not how they said it.' },
          kind: {
            type: 'string',
            enum: ['knowledge', 'account_action', 'complaint', 'unclear'],
            description: 'knowledge = a written answer could resolve it. account_action = it needs something done to their account or a human decision. complaint = they are reporting a problem, not asking. unclear = too vague to tell.',
          },
        },
        required: ['i', 'subject', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'The canonical subject, 2-6 words, English.' },
          question: { type: 'string', description: 'The question a member would actually ask, in one sentence.' },
          why_it_matters: { type: 'string', description: 'One sentence on what a member cannot find out today.' },
          merged_from: { type: 'array', items: { type: 'string' }, description: 'Every input label folded into this one.' },
          // TWO GROUPS, AND-ed, because one flat list of synonyms cannot be
          // narrowed. A first attempt required one matching word and credited
          // "Membership prices" with 822 sessions on the strength of `red` and
          // `label` — including a member asking to move clubs. Requiring two
          // words from the same list is no better: they are alternatives, so
          // demanding both `opzeggen` AND `cancel` matches nobody.
          concept_terms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Words naming the THING this gap is about — synonyms and Dutch/English variants of one idea. A message needs ANY ONE of these. Example for cancelling: opzeggen, opzegging, cancel, cancellation.',
          },
          qualifier_terms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Words that narrow it to THIS gap and exclude its neighbours. A message needs ANY ONE of these too, in addition to a concept word. For "early cancellation" these separate it from ordinary cancellation: eerder, vroegtijdig, early, tussentijds, verhuizing. Never repeat a concept word here, and never use a word so common it would match anything.',
          },
        },
        required: ['subject', 'question', 'why_it_matters', 'merged_from', 'concept_terms', 'qualifier_terms'],
        additionalProperties: false,
      },
    },
  },
  required: ['gaps'],
  additionalProperties: false,
};

async function ask(system, user, schema) {
  const payload = JSON.stringify({ system, user, schema, max_tokens: 16000 });
  const res = await new Promise((resolve, reject) => {
    const u = new URL(LABELLER_URL);
    const r = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Harness-Secret': HARNESS_SECRET,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 600000,
    }, (r2) => {
      let b = '';
      r2.on('data', (d) => b += d);
      r2.on('end', () => {
        if (r2.statusCode >= 400) return reject(new Error(`webhook ${r2.statusCode}: ${b.slice(0, 300)}`));
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('webhook returned non-JSON: ' + b.slice(0, 300))); }
      });
    });
    r.on('timeout', () => r.destroy(new Error('webhook timed out')));
    r.on('error', reject);
    r.write(payload);
    r.end();
  });

  // The workflow forwards Anthropic's full response, status code included, so
  // a rejected field is readable here instead of surfacing as an opaque n8n
  // node failure.
  const body = res.body || res;
  if (res.statusCode && res.statusCode >= 400) {
    throw new Error(`anthropic ${res.statusCode}: ${JSON.stringify(body).slice(0, 400)}`);
  }
  if (body.stop_reason === 'refusal') {
    throw new Error('model declined: ' + JSON.stringify(body.stop_details));
  }
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new Error('no text in reply: ' + JSON.stringify(body).slice(0, 400));
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
(async () => {
  const defects = await paged('/rest/v1/conversation_defects?select=session_id,no_answer&no_answer=is.true');
  const pool = new Set(defects.map((d) => d.session_id));
  console.log('sessions with no substantive answer:', pool.size);

  const msgs = JSON.parse(fs.readFileSync(ROOT + '/tools/review/messages.json', 'utf8'));
  const dates = msgs.map((m) => m.created_at).sort();
  const WINDOW_FROM = dates[0].slice(0, 10), WINDOW_TO = dates[dates.length - 1].slice(0, 10);

  // One ask per session: the member's longest message is the fullest statement
  // of what they came for. Short follow-ups ("ja", "ok") carry no subject.
  const bySession = new Map();
  for (const m of msgs) {
    if (!pool.has(m.session_id)) continue;
    const t = String(m.content || '').replace(/\s+/g, ' ').trim();
    if (t.length < 15 || t.length > 400) continue;
    const cur = bySession.get(m.session_id);
    if (!cur || t.length > cur.length) bySession.set(m.session_id, t);
  }
  const asks = [...bySession.entries()].map(([sid, text]) => ({ sid, text: redact(text) }));
  console.log('unanswered questions to label:', asks.length);

  // --- pass 1: label each question ----------------------------------------
  const LABEL_SYSTEM = `You are helping a gym's support team find gaps in their chatbot's knowledge.

You will be given real questions members sent to the bot in conversations where the bot gave no substantive answer at all.

For each question, give a short subject label describing what the member wanted to know, and classify it:
- knowledge: a written answer, published once, would resolve this for everyone who asks it
- account_action: it needs something done to this member's account, or a human judgement about their specific case
- complaint: they are reporting a problem or expressing frustration, not asking a question
- unclear: too vague or truncated to tell what they wanted

Use the same label wording for questions that are really the same subject. Labels must be in English even when the question is in Dutch. Do not invent a subject that is not in the text.`;

  // Cached: pass 2 gets iterated on far more than pass 1, and re-labelling 437
  // questions to change one schema is pure waste. Delete labels.json to redo it.
  const LABELS = __dirname + '/labels.json';
  let labelled = [];
  if (fs.existsSync(LABELS)) {
    labelled = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
    console.log('reusing cached labels:', labelled.length, '(delete tools/gaps/labels.json to relabel)');
  }
  const needLabels = labelled.length === 0;
  for (let i = 0; needLabels && i < asks.length; i += BATCH) {
    const chunk = asks.slice(i, i + BATCH);
    const body = chunk.map((a, n) => `${i + n}. ${a.text}`).join('\n');
    const out = await ask(LABEL_SYSTEM, `Label these ${chunk.length} questions.\n\n${body}`, LABEL_SCHEMA);
    for (const it of out.items) {
      const a = asks[it.i];
      if (a) labelled.push({ ...a, subject: it.subject, kind: it.kind });
    }
    process.stdout.write(`\rlabelled ${labelled.length}/${asks.length}`);
  }
  console.log();
  if (labelled.length) fs.writeFileSync(LABELS, JSON.stringify(labelled, null, 2));

  const knowledge = labelled.filter((l) => l.kind === 'knowledge');
  const byKind = labelled.reduce((a, l) => (a[l.kind] = (a[l.kind] || 0) + 1, a), {});
  console.log('by kind:', byKind);

  // --- pass 2: merge the labels into canonical subjects + matchers ---------
  // Two passes, not one, because a label is only useful if the same subject
  // gets the same label everywhere, and a model labelling 40 questions at a
  // time cannot know what it called something in an earlier batch.
  const counts = new Map();
  for (const l of knowledge) counts.set(l.subject, (counts.get(l.subject) || 0) + 1);
  const labelList = [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s} (${n})`).join('\n');
  console.log('distinct labels to merge:', counts.size);

  const MERGE_SYSTEM = `You are consolidating subject labels into the final list of knowledge gaps for a gym's support team.

Each label came from a real member question the chatbot failed to answer. Labels that mean the same thing must be merged into one gap. Keep gaps specific: "first payment timing" and "payment method change" are different gaps and must not be merged into "payments".

For each gap, give TWO separate groups of words. A program counts a member's message as raising this subject only when it contains at least one word from EACH group, so the groups must do different jobs:

- concept_terms: the thing the gap is about, with its synonyms and its Dutch and English forms. Any one of these is enough.
- qualifier_terms: the words that separate this gap from its nearest neighbours. Any one of these is also required.

Worked example. For "early cancellation before the contract ends", concept_terms are opzeggen, opzegging, cancel, cancellation; qualifier_terms are eerder, vroegtijdig, early, tussentijds, verhuizing. A member writing "can I cancel my class booking" matches the concept but no qualifier, so it is correctly not counted.

Rules for both groups: use the member's own wording, not your label; include Dutch as well as English, since about half of members write Dutch; never use a word so common it matches anything (membership, abonnement, gym, club, mail, label, vraag, question, help); never put the same word in both groups.

Drop any label that is not really a knowledge gap. Return at most 25 gaps, most important first.`;

  const merged = await ask(
    MERGE_SYSTEM,
    `Here are the subject labels, with how many members raised each.\n\n${labelList}`,
    MERGE_SCHEMA,
  );
  console.log('canonical gaps:', merged.gaps.length);

  // --- deterministic counts over the whole window -------------------------
  // From here on the model has no say. Every number below is computed from the
  // terms above, in code, over all 41k messages.
  const texts = msgs.map((m) => ({
    raw: String(m.content || '').replace(/\s+/g, ' ').trim(),
    s: m.session_id,
  }));
  const normed = texts.map((t) => norm(t.raw));
  const index = new Map();
  normed.forEach((t, i) => {
    for (const w of new Set(t.split(' '))) {
      if (!w) continue;
      let set = index.get(w);
      if (!set) index.set(w, (set = new Set()));
      set.add(i);
    }
  });
  const TOO_COMMON = Math.round(texts.length * 0.10);
  const sessionSize = new Map();
  for (const t of texts) sessionSize.set(t.s, (sessionSize.get(t.s) || 0) + 1);

  const noAnswerSessions = pool;
  const items = JSON.parse(fs.readFileSync(ROOT + '/tools/knowledge/items.json', 'utf8')).items;

  const out = merged.gaps.map((g, n) => {
    const clean = (arr) => [...new Set((arr || []).map(norm).filter(Boolean))]
      .filter((t) => !(index.get(t)?.size > TOO_COMMON));
    const concept = clean(g.concept_terms);
    const qualifier = clean(g.qualifier_terms);

    // A message counts only if it carries a concept word AND a qualifier word.
    // Intersection of the two unions, not the union of everything.
    const hitSet = (list) => {
      const s2 = new Set();
      for (const t of list) for (const i of (index.get(t) || [])) s2.add(i);
      return s2;
    };
    const cHits = hitSet(concept), qHits = hitSet(qualifier);
    const hits = [...cHits].filter((i) => qHits.has(i));

    const sessions = new Set(hits.map((i) => texts[i].s));
    // Of the members who raised it, how many got no answer at all. This is the
    // number that separates "we get asked this a lot" from "we get asked this
    // a lot and fail".
    const unanswered = [...sessions].filter((s) => noAnswerSessions.has(s)).length;
    const terms = [...concept, ...qualifier];

    // Does anything in the knowledge base even mention this? Deliberately a
    // LOW bar — any item carrying a concept word and a qualifier word — so
    // that "nothing covers this" is a strong claim when it is made.
    const covers = items.filter((it) => {
      const blob = new Set(norm(it.title + ' ' + it.body.slice(0, 600)).split(' '));
      return concept.some((t) => blob.has(t)) && qualifier.some((t) => blob.has(t));
    });

    const ranked = hits.slice()
      .sort((a, b) => (sessionSize.get(texts[b].s) || 0) - (sessionSize.get(texts[a].s) || 0));
    const seenq = new Set(), usedS = new Set(), examples = [], exSessions = [];
    for (const i of ranked) {
      const t = texts[i].raw;
      if (t.length < 20 || t.length > 160) continue;
      const k = t.toLowerCase().slice(0, 28);
      if (seenq.has(k) || usedS.has(texts[i].s)) continue;
      seenq.add(k); usedS.add(texts[i].s);
      examples.push(redact(t)); exSessions.push(texts[i].s);
      if (examples.length >= 3) break;
    }

    return {
      key: 'gap:' + norm(g.subject).replace(/ /g, '-').slice(0, 48),
      sort_order: (n + 1) * 10,
      brand: 'trainmore',
      subject: g.subject,
      question: g.question,
      why_it_matters: g.why_it_matters,
      merged_from: g.merged_from,
      terms,
      concept_terms: concept,
      qualifier_terms: qualifier,
      matched_messages: hits.length,
      matched_sessions: sessions.size,
      unanswered_sessions: unanswered,
      covering_item_keys: covers.map((c) => c.key),
      covering_item_titles: covers.map((c) => c.title),
      examples,
      example_sessions: exSessions,
      window_from: WINDOW_FROM,
      window_to: WINDOW_TO,
      pool_size: pool.size,
      verified_at: TODAY,
    };
  }).filter((g) => g.concept_terms.length && g.qualifier_terms.length)
    .sort((a, b) => b.unanswered_sessions - a.unanswered_sessions);

  fs.writeFileSync(__dirname + '/gaps.json', JSON.stringify({
    window: { from: WINDOW_FROM, to: WINDOW_TO },
    pool: { no_answer_sessions: pool.size, labelled: labelled.length, by_kind: byKind },
    gaps: out,
  }, null, 2));

  console.log('\nunanswered/raised  covered?  subject');
  for (const g of out) {
    console.log(
      String(g.unanswered_sessions).padStart(5) + '/' + String(g.matched_sessions).padEnd(6),
      (g.covering_item_keys.length ? `${g.covering_item_keys.length} items` : '-- NOTHING --').padEnd(14),
      g.subject,
    );
  }
  console.log('\ngaps written:', out.length);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
