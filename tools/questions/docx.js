// Writes docs/how-a-question-gets-answered.docx from bot.question_traces.
//
//   node tools/questions/docx.js
//
// The portable twin of /questions. Same content, no login — Esther, Nelly and
// Lowri read things in Teams and e-mail.
//
// Contains real member messages. They are masked at build time by
// tools/questions/build.js (e-mail addresses, phone numbers, IBANs and long
// digit runs), because a document gets forwarded and picking a different
// example is not a control — the next regeneration picks different ones.
const fs = require('fs');
const https = require('https');
const { createDoc, DEFAULT_STYLES } = require('../lib/ooxml');

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

function rpc(name) {
  return new Promise((res, rej) => {
    const data = JSON.stringify({});
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

const COST = {
  nodeploy: { label: 'NO DEPLOY', color: '1D6B54' },
  deploy: { label: 'NEEDS A DEPLOY', color: '96570E' },
  external: { label: 'NOT OURS', color: '566372' },
};

const fmt = (d) => d
  ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  : '';

(async () => {
  const rows = await rpc('question_traces_view');
  if (!Array.isArray(rows) || !rows.length) throw new Error('no question traces — run build.js and seed.js first');

  const d = createDoc();
  const { run, para, hyperlink } = d;
  const body = [];

  // one entry per chain, in demand order
  const chains = new Map();
  for (const r of rows) {
    const c = chains.get(r.chain_key) || { label: r.chain_label, q: 0, s: 0, cost: r.change_cost };
    c.q += 1; c.s += r.matched_sessions || 0;
    chains.set(r.chain_key, c);
  }
  const byDemand = [...chains.values()].sort((a, b) => b.s - a.s);

  body.push(para(run('How a question gets answered'), { style: 'Title' }));
  body.push(para(run(`TrainMore  ·  ${rows.length} real member questions  ·  ${fmt(rows[0].window_from)} to ${fmt(rows[0].window_to)}`,
    { sz: 11, color: '55626E' }), { after: 200 }));
  body.push(para(run('For each question a member actually asked: how Evelyn decides to answer it, what she reads, and how that source got filled — back to the person who types the words.'), { after: 160 }));

  // ---- the map -----------------------------------------------------------
  body.push(para(run(`Every answer comes from one of ${byDemand.length} places`), { style: 'Heading1' }));
  body.push(para(run(`Read this first. It is the whole map — the ${rows.length} questions after it are worked examples of these ${byDemand.length} routes.`,
    { sz: 9, color: '55626E' }), { after: 100 }));

  for (const c of byDemand) {
    body.push(para([
      run(c.label, { b: true, sz: 10 }),
      run(`   ${c.q} question${c.q === 1 ? '' : 's'}  ·  ${c.s.toLocaleString('en-GB')} conversations   `, { sz: 9, color: '7C8792' }),
      run(COST[c.cost].label, { b: true, sz: 8, color: COST[c.cost].color, caps: true }),
    ], { after: 50 }));
  }
  body.push(para(run('Conversation counts are a floor. The matcher that found these questions is ours, not the bot’s own recogniser, and is written narrow so it under-claims.',
    { sz: 8, color: '7C8792' }), { before: 80, after: 160 }));

  // ---- the questions -----------------------------------------------------
  for (const r of rows) {
    body.push(para([
      run(r.question, { b: true, sz: 13 }),
    ], { style: 'Heading2' }));
    body.push(para([
      run(r.chain_label, { sz: 9, color: '7C8792' }),
      run(r.matched_sessions != null ? `  ·  asked in at least ${r.matched_sessions.toLocaleString('en-GB')} conversations   ` : '   ', { sz: 9, color: '7C8792' }),
      run(COST[r.change_cost].label, { b: true, sz: 8, color: COST[r.change_cost].color, caps: true }),
    ], { after: 80 }));

    for (const ex of (r.examples || [])) {
      body.push(para(run('“' + ex + '”', { i: true, sz: 9, color: '55626E' }), { after: 30, indent: 220 }));
    }

    body.push(para([run('How she decides to answer it.  ', { b: true, sz: 9 }), run(r.decides, { sz: 9 })], { before: 80, after: 40 }));
    body.push(para([run('What she reads.  ', { b: true, sz: 9 }), run(r.reads, { sz: 9, font: 'Consolas' })], { after: 60 }));

    body.push(para(run('How that got populated', { b: true, sz: 8, caps: true, color: '7C8792' }), { after: 30 }));
    r.chain_steps.forEach((s, i) => {
      body.push(para([
        run(`${i + 1}.  `, { b: true, sz: 9, color: '0E5A62' }),
        run(s, { sz: 9 }),
      ], { after: 20, indent: 220 }));
    });

    body.push(para([run('Who ultimately types it.  ', { b: true, sz: 9 }), run(r.ends_at, { sz: 9 })], { before: 60, after: 40 }));

    if (r.caveat) {
      body.push(para([run('Worth knowing.  ', { b: true, sz: 9 }), run(r.caveat, { sz: 9 })],
        { after: 160, bar: 'B26A00', indent: 160 }));
    } else {
      body.push(para(run('', { sz: 6 }), { after: 120 }));
    }
  }

  body.push(para(run('About this document'), { style: 'Heading1' }));
  body.push(para(run('Generated from bot.question_traces by tools/questions/docx.js. The live version, with the same content, is Evelyn Ops → Review → How a question gets answered. Correct it by re-running the generator, not by editing this file.',
    { sz: 9, color: '55626E' }), { after: 60 }));
  body.push(para([
    run('Internal document — contains real member messages. ', { b: true, sz: 9 }),
    run('Quotes are unedited apart from trimming for length, except that e-mail addresses, phone numbers, bank details and long numbers are masked.', { sz: 9, color: '55626E' }),
  ], { after: 60 }));
  body.push(para([run('The live page: ', { sz: 9, color: '55626E' }),
    hyperlink('Evelyn Ops → How a question gets answered',
      'https://evelyn-ops-g4btdwcheaftcmbj.westeurope-01.azurewebsites.net/questions')], {}));

  const out = __dirname + '/../../docs/how-a-question-gets-answered.docx';
  const res = d.write(body, out, DEFAULT_STYLES);
  console.log(`wrote docs/how-a-question-gets-answered.docx — ${(res.bytes / 1024).toFixed(0)} KB, ${rows.length} questions, ${byDemand.length} chains, ${res.links} links`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
