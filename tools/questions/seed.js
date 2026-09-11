// Seeds bot.question_traces from tools/questions/traces.json.
//
//   node tools/review/pull.js        # refresh the message window
//   node tools/questions/build.js    # match, mask, write traces.json
//   node tools/questions/seed.js     # replace the rows in Supabase
//
// The rows are GENERATED from real member messages, which is why they are not
// hardcoded in db/034. Editing a row by hand would be overwritten by the next
// run — change the question definition in build.js instead.
//
// Replace-all rather than upsert: a question that has been renamed or dropped
// from build.js should disappear here too, and an upsert would leave it behind.
const fs = require('fs');
const https = require('https');

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

function req(method, path, body) {
  return new Promise((res, rej) => {
    const data = body != null ? JSON.stringify(body) : null;
    const r = https.request(SUPA + path, {
      method,
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Content-Profile': 'bot', 'Accept-Profile': 'bot',
        Prefer: 'return=minimal',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (r2) => {
      let b = '';
      r2.on('data', (d) => b += d);
      r2.on('end', () => {
        if (r2.statusCode >= 400) return rej(new Error(`${r2.statusCode} ${b.slice(0, 300)}`));
        res(b);
      });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const { questions } = JSON.parse(fs.readFileSync(__dirname + '/traces.json', 'utf8'));
  if (!questions.length) throw new Error('traces.json has no questions — run build.js first');

  // The window the counts describe, taken from the message cache rather than
  // assumed, so the page can state it rather than implying "recently".
  const msgs = JSON.parse(fs.readFileSync(__dirname + '/../review/messages.json', 'utf8'));
  const dates = msgs.map((m) => m.created_at).sort();
  const from = dates[0].slice(0, 10);
  const to = dates[dates.length - 1].slice(0, 10);

  const rows = questions.map((q) => ({
    key: q.key,
    sort_order: q.sort_order,
    brand: 'trainmore',
    question: q.question,
    examples: q.examples,
    matched_messages: q.matched_messages,
    matched_sessions: q.matched_sessions,
    window_from: from,
    window_to: to,
    chain_key: q.chain_key,
    chain_label: q.chain_label,
    decides: q.decides,
    reads: q.reads,
    chain_steps: q.chain_steps,
    ends_at: q.ends_at,
    change_cost: q.change_cost,
    caveat: q.caveat || null,
    verified_at: to,
  }));

  await req('DELETE', '/rest/v1/question_traces?key=neq.__none__');
  await req('POST', '/rest/v1/question_traces', rows);
  console.log(`seeded ${rows.length} question traces, window ${from} to ${to}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
