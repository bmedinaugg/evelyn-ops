// Pulls the case library + a fresh member-message window for the decision->source review pack.
const fs = require('fs');
const https = require('https');

const ROOT = __dirname + '/../..';
const OUT = __dirname;

const env = {};
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (t.includes('=') && !t.startsWith('#')) { const i = t.indexOf('='); env[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, ''); }
}
const SUPA = env.SUPABASE_URL.replace(/\/$/, ''), KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function req(method, path, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request(SUPA + path, {
      method,
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Accept-Profile': 'bot', 'Content-Profile': 'bot',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (r2) => {
      let b = ''; r2.on('data', (d) => b += d);
      r2.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 300))); } });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  const cases = await req('POST', '/rest/v1/rpc/case_library_view', {});
  fs.writeFileSync(OUT + '/cases.json', JSON.stringify(cases, null, 2));
  console.log('cases:', cases.length);

  // Fresh 30-day window through today (the cached one stops 8 Sep).
  let all = [], page = 0;
  for (;;) {
    const rows = await req('GET', `/rest/v1/conversation_messages?role=eq.user&created_at=gte.2026-08-11&select=session_id,content,created_at&order=created_at.desc&limit=1000&offset=${page * 1000}`);
    if (!Array.isArray(rows) || !rows.length) break;
    all = all.concat(rows);
    page++;
    if (page > 60) break;
  }
  fs.writeFileSync(OUT + '/messages.json', JSON.stringify(all));
  const d = all.map(r => r.created_at).sort();
  console.log('messages:', all.length, 'range:', d[0], '->', d[d.length - 1]);
  console.log('sessions:', new Set(all.map(r => r.session_id)).size);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
