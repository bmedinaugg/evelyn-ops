// Seeds bot.knowledge_items from tools/knowledge/items.json.
//
//   node tools/review/pull.js          # refresh the message window
//   node tools/knowledge/items.js      # read the stores, write items.json
//   node tools/knowledge/items-seed.js # replace the rows in Supabase
//
// Replace-all rather than upsert, for the same reason tools/questions/seed.js
// is: an article retired from Freshdesk, or a club hidden from the bot, should
// disappear from here too, and an upsert would leave it behind claiming to be
// knowledge the bot still has.
//
// This is exactly why the notes live in bot.knowledge_item_notes with a SOFT
// key. The delete below would take every note with it otherwise.
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
  const { items, window } = JSON.parse(
    fs.readFileSync(__dirname + '/items.json', 'utf8'));
  if (!items.length) throw new Error('items.json is empty — run items.js first');

  const rows = items.map((i) => ({
    key: i.key,
    sort_order: i.sort_order,
    brand: i.brand,
    source: i.source,
    source_key: i.source_key,
    wiring: i.wiring,
    title: i.title,
    body: i.body,
    url: i.url,
    topic: i.topic,
    tags: i.tags,
    caveat: i.caveat,
    chunks: i.chunks,
    duplicate_of: i.duplicate_of,
    matched_messages: i.matched_messages,
    matched_sessions: i.matched_sessions,
    demand_method: i.demand_method,
    demand_terms: i.demand_terms,
    // The matching spec, so bot.knowledge_demand() can recount for any window.
    demand_kind: i.demand_kind,
    demand_groups: i.demand_groups,
    demand_phrase: i.demand_phrase,
    window_from: i.window_from,
    window_to: i.window_to,
    examples: i.examples,
    example_sessions: i.example_sessions,
    verified_at: i.verified_at,
  }));

  await req('DELETE', '/rest/v1/knowledge_items?key=neq.__none__');
  // In batches: a few hundred rows carrying full article bodies is a large
  // enough request to be worth not sending as one.
  for (let i = 0; i < rows.length; i += 100) {
    await req('POST', '/rest/v1/knowledge_items', rows.slice(i, i + 100));
  }

  const orphans = await new Promise((res, rej) => {
    https.get(SUPA + '/rest/v1/knowledge_item_notes?select=item_key&resolved_at=is.null', {
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'bot' },
    }, (r) => {
      let b = '';
      r.on('data', (d) => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 200))); } });
    }).on('error', rej);
  });
  const keys = new Set(rows.map((r) => r.key));
  const stranded = (Array.isArray(orphans) ? orphans : [])
    .filter((o) => !keys.has(o.item_key));

  console.log(`seeded ${rows.length} knowledge items, window ${window.from} to ${window.to}`);
  // Said out loud rather than left to be discovered: a note whose article has
  // gone still exists, it just stops being displayed.
  if (stranded.length) {
    console.log(`WARNING: ${stranded.length} open note(s) now point at an item that no longer exists:`);
    for (const s of stranded) console.log('  ', s.item_key);
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
