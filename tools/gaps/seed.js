// Seeds bot.knowledge_gaps from tools/gaps/gaps.json.
//
//   node tools/gaps/build.js   # discover the subjects
//   node tools/gaps/count.js   # count them by reading every question
//   node tools/gaps/seed.js    # replace the rows in Supabase
//
// Replace-all, like every other generated table here: a subject that stops
// being a gap — because someone wrote the article — should disappear rather
// than linger with a stale count.
//
// Refuses to seed uncounted rows. gaps.json straight out of build.js has no
// counts on it, and seeding that would put twenty subjects on the page all
// reading zero, which looks like "nobody asks" rather than "not measured yet".
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
        if (r2.statusCode >= 400) return rej(new Error(`${r2.statusCode} ${b.slice(0, 400)}`));
        res(b);
      });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const file = JSON.parse(fs.readFileSync(__dirname + '/gaps.json', 'utf8'));
  const { gaps, counting, window, pool } = file;
  if (!gaps || !gaps.length) throw new Error('gaps.json has no gaps — run build.js first');
  if (!counting) {
    throw new Error('gaps.json has no counting block — run tools/gaps/count.js before seeding');
  }
  if (!counting.recall_pct || counting.recall_pct < 60) {
    // The counting pass validates itself against its own source questions. If
    // that check is weak, the numbers are not worth publishing — this is the
    // guard the keyword attempts never had.
    throw new Error(`counting recall is ${counting.recall_pct}% — too low to publish; investigate before seeding`);
  }

  const rows = gaps.map((g, n) => ({
    key: g.key,
    sort_order: (n + 1) * 10,
    brand: g.brand || 'trainmore',
    subject: g.subject,
    question: g.question,
    why_it_matters: g.why_it_matters,
    merged_from: g.merged_from || [],
    matched_sessions: g.matched_sessions || 0,
    unanswered_sessions: g.unanswered_sessions || 0,
    count_method: g.count_method,
    count_model: counting.model,
    count_recall_pct: counting.recall_pct,
    sessions_read: counting.sessions_read,
    covering_item_keys: g.covering_item_keys || [],
    covering_item_titles: g.covering_item_titles || [],
    examples: g.examples || [],
    example_sessions: g.example_sessions || [],
    window_from: g.window_from || window.from,
    window_to: g.window_to || window.to,
    pool_size: g.pool_size || (pool && pool.no_answer_sessions) || null,
    verified_at: g.verified_at,
  }));

  await req('DELETE', '/rest/v1/knowledge_gaps?key=neq.__none__');
  await req('POST', '/rest/v1/knowledge_gaps', rows);

  const uncovered = rows.filter((r) => !r.covering_item_keys.length).length;
  console.log(`seeded ${rows.length} knowledge gaps, window ${rows[0].window_from} to ${rows[0].window_to}`);
  console.log(`${uncovered} of them have no knowledge item behind them at all`);
  console.log(`counted by ${counting.model} reading ${counting.sessions_read} questions · recall ${counting.recall_on_own_source_questions} (${counting.recall_pct}%)`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
