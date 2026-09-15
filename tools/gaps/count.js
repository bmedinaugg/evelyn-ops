// Counts how often each knowledge gap is actually raised, by having a model
// read every member question instead of matching keywords against it.
//
//   node tools/gaps/build.js    # discovers the gaps (writes gaps.json)
//   node tools/gaps/count.js    # counts them (rewrites gaps.json in place)
//
// WHY NOT KEYWORDS
// Two keyword attempts failed in opposite directions and both are recorded in
// build.js. The first required one matching word and credited "Membership
// prices" with 822 sessions on the strength of `red` and `label`, including a
// member asking to move clubs. The second required a concept word AND a
// qualifier word, and was measured at 25% RECALL AGAINST ITS OWN SOURCE
// QUESTIONS — three quarters of the matchers could not find the very messages
// that produced them, so "0 sessions" meant "broken matcher", not "nobody
// asks". A keyword rule cannot reproduce a judgement made by reading.
//
// So the model reads. Every session's question is shown the canonical gap list
// once and assigned to at most one gap, or to none. Single-label on purpose:
// multi-label would let one message inflate several subjects at once.
//
// WHAT KEEPS THIS HONEST
// The same recall test that condemned the keyword matcher is run against this
// one, at the end, and printed. The 44 questions whose subject a model already
// labelled in build.js are a held-out answer key: if this pass cannot put them
// in their own gap, its numbers are worth no more than the keywords were.
//
// Haiku, no thinking. Measured on a batch of 60: 1,244 input and 548 output
// tokens, zero thinking tokens, four seconds. This is classification, not
// reasoning — Opus costs 6.5x more here and produced no thinking tokens either.
const fs = require('fs');
const https = require('https');

const ROOT = __dirname + '/../..';
const MODEL = 'claude-haiku-4-5';
const BATCH = 60;
const CONCURRENCY = 4;

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
const LABELLER_URL = (env.N8N_HARNESS_WEBHOOK_URL || '')
  .replace(/\/webhook(-test)?\/.*$/, '/webhook/evelyn-knowledge-gaps');
const HARNESS_SECRET = env.N8N_HARNESS_SECRET;

const redact = (t) => String(t)
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
  .replace(/\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?\d{4}[\s]?\d{2,10}\b/gi, '[IBAN]')
  .replace(/(?:\+31|0031|\b0)[\s-]?(?:\d[\s-]?){8,9}\d\b/g, '[phone]')
  .replace(/\b\d{7,}\b/g, '[number]');

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

const ASSIGN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The index of the message, as given.' },
          g: { type: 'integer', description: 'The number of the subject this message raises, or -1 if it raises none of them.' },
        },
        required: ['i', 'g'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

async function ask(system, user, schema, attempt = 0) {
  const payload = JSON.stringify({ model: MODEL, system, user, schema, max_tokens: 8000 });
  try {
    const res = await new Promise((resolve, reject) => {
      const u = new URL(LABELLER_URL);
      const r = https.request({
        hostname: u.hostname, path: u.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Harness-Secret': HARNESS_SECRET,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 300000,
      }, (r2) => {
        let b = '';
        r2.on('data', (d) => b += d);
        r2.on('end', () => {
          if (r2.statusCode >= 400) return reject(new Error(`webhook ${r2.statusCode}: ${b.slice(0, 200)}`));
          try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('non-JSON: ' + b.slice(0, 200))); }
        });
      });
      r.on('timeout', () => r.destroy(new Error('timeout')));
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
    const body = res.body || res;
    if (res.statusCode >= 400) throw new Error(`anthropic ${res.statusCode}: ${JSON.stringify(body).slice(0, 300)}`);
    if (body.stop_reason === 'refusal') throw new Error('declined: ' + JSON.stringify(body.stop_details));
    const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { out: JSON.parse(text), usage: body.usage || {} };
  } catch (e) {
    // One retry. A single dropped batch would silently undercount every
    // subject in it, and a silent undercount is the failure mode this whole
    // file exists to avoid.
    if (attempt < 2) return ask(system, user, schema, attempt + 1);
    throw e;
  }
}

(async () => {
  const file = JSON.parse(fs.readFileSync(__dirname + '/gaps.json', 'utf8'));
  const gaps = file.gaps;
  if (!gaps.length) throw new Error('gaps.json is empty — run build.js first');

  const defects = await paged('/rest/v1/conversation_defects?select=session_id,no_answer&no_answer=is.true');
  const noAnswer = new Set(defects.map((d) => d.session_id));

  const msgs = JSON.parse(fs.readFileSync(ROOT + '/tools/review/messages.json', 'utf8'));
  const bySession = new Map();
  for (const m of msgs) {
    const t = String(m.content || '').replace(/\s+/g, ' ').trim();
    if (t.length < 15 || t.length > 400) continue;
    const cur = bySession.get(m.session_id);
    if (!cur || t.length > cur.length) bySession.set(m.session_id, t);
  }
  const asks = [...bySession.entries()].map(([sid, text]) => ({ sid, text: redact(text) }));
  console.log('sessions with a real question:', asks.length);
  console.log('batches:', Math.ceil(asks.length / BATCH), 'of', BATCH, 'on', MODEL);

  // Frozen copy in menu order. Everything the model returns is an index into
  // THIS list, so it is the only thing allowed to resolve those indices.
  const menuOrder = gaps.slice();
  const menu = menuOrder.map((g, n) => `${n}. ${g.subject} — ${g.question}`).join('\n');
  const SYSTEM = `You are counting how often gym members raise each of a fixed list of subjects.

Here are the subjects:

${menu}

For each message you are given, decide which ONE subject it raises, and return that subject's number. Return -1 when the message raises none of them — that is the common case and you should use it freely. Judge what the member is actually asking about, not which words happen to appear: a member cancelling a CLASS BOOKING is not asking about cancelling their membership, and a member who says they do NOT want to cancel is not asking how to.

Never return a number that is not in the list above.`;

  const assignment = new Map();
  let done = 0, inTok = 0, outTok = 0;
  const batches = [];
  for (let i = 0; i < asks.length; i += BATCH) batches.push(i);

  async function worker() {
    for (;;) {
      const start = batches.shift();
      if (start === undefined) return;
      const chunk = asks.slice(start, start + BATCH);
      const body = chunk.map((a, n) => `${start + n}. ${a.text}`).join('\n');
      const { out, usage } = await ask(SYSTEM, `Messages:\n${body}`, ASSIGN_SCHEMA);
      for (const it of out.items) {
        const a = asks[it.i];
        if (a && Number.isInteger(it.g) && it.g >= 0 && it.g < menuOrder.length) {
          // Keyed, never indexed. `gaps` is sorted by count further down, and
          // an index captured against the menu order would then point at a
          // different subject — which is exactly how the first run of this
          // scored its own recall at 5%.
          assignment.set(a.sid, menuOrder[it.g].key);
        }
      }
      inTok += usage.input_tokens || 0;
      outTok += usage.output_tokens || 0;
      done++;
      process.stdout.write(`\rbatch ${done}/${done + batches.length} · assigned ${assignment.size}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log();

  // --- fold the counts back onto the gaps --------------------------------
  const sessionsFor = new Map();
  for (const [sid, key] of assignment) {
    if (!sessionsFor.has(key)) sessionsFor.set(key, []);
    sessionsFor.get(key).push(sid);
  }
  const textOf = new Map(asks.map((a) => [a.sid, a.text]));

  for (const g of gaps) {
    const sids = sessionsFor.get(g.key) || [];
    g.matched_sessions = sids.length;
    g.unanswered_sessions = sids.filter((s) => noAnswer.has(s)).length;
    g.count_method = `read by ${MODEL}, one subject per question, over ${asks.length} sessions`;
    // Examples come from the sessions this pass actually assigned, so a quote
    // can never contradict the count it sits under.
    const picked = sids
      .map((s) => ({ s, t: textOf.get(s) || '' }))
      .filter((x) => x.t.length >= 20 && x.t.length <= 160)
      .slice(0, 3);
    if (picked.length) {
      g.examples = picked.map((x) => x.t);
      g.example_sessions = picked.map((x) => x.s);
    }
    // The keyword attempt's numbers are removed rather than kept alongside:
    // two counts for one subject is an invitation to quote whichever suits.
    delete g.matched_messages;
  }
  gaps.sort((a, b) => b.matched_sessions - a.matched_sessions);

  // --- the recall test that condemned the keyword matcher ----------------
  const labels = JSON.parse(fs.readFileSync(__dirname + '/labels.json', 'utf8'));
  let hit = 0, tot = 0;
  for (const l of labels.filter((x) => x.kind === 'knowledge')) {
    const want = gaps.find((g) => g.merged_from.includes(l.subject));
    if (!want) continue;
    tot++;
    if (assignment.get(l.sid) === want.key) hit++;
  }
  const recall = tot ? Math.round((100 * hit) / tot) : 0;

  file.counting = {
    model: MODEL,
    sessions_read: asks.length,
    batches: done,
    input_tokens: inTok,
    output_tokens: outTok,
    usd: +((inTok / 1e6) * 1 + (outTok / 1e6) * 5).toFixed(2),
    recall_on_own_source_questions: `${hit}/${tot}`,
    recall_pct: recall,
  };
  fs.writeFileSync(__dirname + '/gaps.json', JSON.stringify(file, null, 2));
  // Kept so the recall test — or any later check — can be re-scored without
  // paying for the pass again.
  fs.writeFileSync(__dirname + '/assignments.json',
    JSON.stringify([...assignment].map(([sid, key]) => ({ sid, key })), null, 2));

  console.log('\nunanswered/raised  covered?  subject');
  for (const g of gaps) {
    console.log(
      String(g.unanswered_sessions).padStart(5) + '/' + String(g.matched_sessions).padEnd(6),
      (g.covering_item_keys.length ? `${g.covering_item_keys.length} items` : '-- NOTHING --').padEnd(14),
      g.subject,
    );
  }
  console.log('\ntokens:', inTok, 'in /', outTok, 'out  ≈ $' + file.counting.usd);
  console.log(`recall on its own source questions: ${hit}/${tot} = ${recall}%  (keywords managed 25%)`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
