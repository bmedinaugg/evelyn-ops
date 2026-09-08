// Generates the scenario library by running the LIVE recognisers over real
// member messages. Matching happens in JS with the exact regexes copied from
// the nodes — not re-expressed in SQL — so the library cannot disagree with
// the bot through a dialect difference.
const fs = require('fs');
const https = require('https');
const SCEN = require('./patterns.js');
const MISFIRES = require('./misfires.js');

const env = {};
for (const line of fs.readFileSync(__dirname + '/../../.env.local','utf8').split('\n')) {
  const t = line.trim();
  if (t.includes('=') && !t.startsWith('#')) { const i=t.indexOf('='); env[t.slice(0,i)]=t.slice(i+1).replace(/^["']|["']$/g,''); }
}
const SUPA = env.SUPABASE_URL.replace(/\/$/,''), KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function get(path) {
  return new Promise((res, rej) => {
    https.get(SUPA + path, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'bot' } }, (r) => {
      let b = ''; r.on('data', (d) => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0,200))); } });
    }).on('error', rej);
  });
}

(async () => {
  // First member message per session is the clearest statement of intent, but
  // scenarios also surface mid-chat, so take every member message.
  // Cached to disk: the pull is 39 pages and the message history for a closed
  // window does not change, so re-running the matcher should not re-download.
  // Delete messages.json to force a fresh pull.
  const CACHE = __dirname + '/messages.json';
  let all = [], page = 0;
  if (fs.existsSync(CACHE)) {
    all = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    console.log('member messages (cached):', all.length);
  } else
  for (;;) {
    const rows = await get(`/rest/v1/conversation_messages?role=eq.user&created_at=gte.2026-08-09&select=session_id,content,created_at&order=created_at.desc&limit=1000&offset=${page*1000}`);
    if (!rows.length) break;
    all = all.concat(rows);
    page++;
    if (page > 40) break;
  }
  if (!fs.existsSync(CACHE)) {
    fs.writeFileSync(CACHE, JSON.stringify(all));
    console.log('member messages pulled:', all.length);
  }

  const out = [];
  for (const s of SCEN) {
    const hits = all.filter((r) => { try { return s.test(String(r.content||'')); } catch (e) { return false; } });
    // Examples: short enough to read, deduped, spread across sessions.
    const seen = new Set();
    const examples = [];
    for (const h of hits) {
      const t = String(h.content).replace(/\s+/g,' ').trim();
      const k = t.toLowerCase().slice(0,45);
      if (t.length < 12 || t.length > 180 || seen.has(k)) continue;
      seen.add(k);
      examples.push({ text: t, session_id: h.session_id, at: h.created_at.slice(0,10) });
      if (examples.length >= 14) break;
    }
    // Known misfires, measured on this scenario's own match set so the
    // percentage is "of what it caught", not "of all messages".
    const misfires = (MISFIRES[s.key] || []).map((m) => {
      const bad = hits.filter((h) => { try { return m.test(String(h.content||'')); } catch (e) { return false; } });
      const ex = bad.map((h) => String(h.content).replace(/\s+/g,' ').trim())
                    .filter((t) => t.length > 20 && t.length < 160)
                    .slice(0, 2);
      return { label: m.label, why: m.why, messages: bad.length,
               pct: hits.length ? Math.round(1000*bad.length/hits.length)/10 : 0, examples: ex };
    }).filter((m) => m.messages > 0).sort((a,b) => b.messages - a.messages);
    out.push({ key: s.key, label: s.label, plain: s.plain, source: s.source,
               matches: hits.length, sessions: new Set(hits.map(h=>h.session_id)).size,
               examples, misfires });
    console.log(`${s.key.padEnd(14)} ${String(hits.length).padStart(5)} msgs  ${String(new Set(hits.map(h=>h.session_id)).size).padStart(4)} sessions  ${examples.length} examples`);
  }
  // ---- overlap ----------------------------------------------------------
  // The requestType classifier is FIRST-MATCH-WINS in this order, so a message
  // matching two scenarios is handled as the earlier one. Publishing the
  // collisions is the point: it is what explains a "wrong" classification.
  const PRECEDENCE = ['extension', 'cancellation', 'change'];
  const overlaps = [];
  for (let i = 0; i < SCEN.length; i++) {
    for (let j = i + 1; j < SCEN.length; j++) {
      const a = SCEN[i], b = SCEN[j];
      const both = all.filter((r) => {
        const t = String(r.content || '');
        try { return a.test(t) && b.test(t); } catch (e) { return false; }
      });
      if (both.length < 15) continue;
      const ia = PRECEDENCE.indexOf(a.key), ib = PRECEDENCE.indexOf(b.key);
      let wins = null;
      if (ia !== -1 && ib !== -1) wins = ia < ib ? a.key : b.key;
      const sample = both
        .map((r) => String(r.content).replace(/\s+/g, ' ').trim())
        .filter((t) => t.length > 15 && t.length < 150)[0] || null;
      overlaps.push({ a: a.key, b: b.key, messages: both.length, handled_as: wins, sample });
    }
  }
  overlaps.sort((x, y) => y.messages - x.messages);
  console.log('\ntop scenario collisions:');
  overlaps.slice(0, 10).forEach((o) => console.log(
    `  ${o.a} + ${o.b}`.padEnd(38) + String(o.messages).padStart(5) + ' msgs' +
    (o.handled_as ? `  -> handled as ${o.handled_as}` : '  -> different code paths')));

    // Metadata travels WITH the document. The PDF builder and bot.scenario_library
  // must not disagree about when this was generated or what window it covers —
  // a wrong date on a shared PDF is worse than no date.
  const WINDOW_FROM = '2026-08-09';
  const meta = {
    generated_at: new Date().toISOString(),
    window_from: WINDOW_FROM,
    window_to: new Date().toISOString().slice(0, 10),
    messages_scanned: all.length,
  };
  fs.writeFileSync(__dirname + '/library.json',
    JSON.stringify({ ...meta, scenarios: out, overlaps }, null, 1));
  console.log('\nwrote library.json');
})();
