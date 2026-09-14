// Builds the knowledge items: every individual fact Evelyn can answer from,
// read out of the live stores rather than described from memory.
//
//   node tools/review/pull.js          # refresh the member-message window
//   node tools/knowledge/items.js      # writes tools/knowledge/items.json
//   node tools/knowledge/items-seed.js # replaces the rows in Supabase
//
// FIVE STORES, ONE LIST
//   public.trainmore_faqs   the vector store, three feeds inside it
//   bot.manual_faqs         reached through that store, source='member-care'
//   bot.public_locations    one row per club the bot can actually see
//   bot.case_library        the prompt- and guardrail-embedded rules
//
// THE UNIT IS THE ARTICLE
// The store holds chunks; long articles are split across several. The chunk is
// what the bot retrieves, but the article is what a person can open and edit,
// and a note has to attach to something someone can go and fix. So chunks are
// folded back into their article by the article id in reference_url, and
// `chunks` records how many pieces it was in.
//
// THE DEMAND NUMBERS MEASURE THE SUBJECT, NOT THE ARTICLE
// Nothing logs which FAQ answered which conversation, so this is member
// messages matched against the item's own words: take the distinctive terms
// out of its title, add their Dutch equivalents, and count the messages
// carrying enough of them.
//
// Be precise about what that is. It is NOT a floor, the way
// tools/questions/build.js is. Those twenty matchers are hand-written per
// question and can only under-claim; these are derived from ~230 titles nobody
// tuned, and they run in the other direction too — an article about cancelling
// because of the price increase shares `cancel` and `membership` with every
// cancellation question there is, so it inherits that whole subject's volume.
// The number answers "how many members raised the subject this covers", which
// is the useful question anyway, and is the only one the words alone can
// answer.
//
// Three defences, all of them visible on the page rather than in this comment:
// demand_terms carries the exact words behind every number, demand_method says
// how many of them a message had to carry, and an item with fewer than two
// distinctive words gets NULL rather than a number built on one common word.
//
// SCOPE: TrainMore.
const fs = require('fs');
const https = require('https');

const ROOT = __dirname + '/../..';
const TODAY = new Date().toISOString().slice(0, 10);

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

// The FAQ store lives in `public`; everything else in `bot`.
function get(path, schema = 'bot') {
  return new Promise((res, rej) => {
    const r = https.request(SUPA + path, {
      method: 'GET',
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Accept-Profile': schema,
      },
    }, (r2) => {
      let b = '';
      r2.on('data', (d) => b += d);
      r2.on('end', () => {
        try { res(JSON.parse(b)); } catch (e) { rej(new Error(b.slice(0, 300))); }
      });
    });
    r.on('error', rej);
    r.end();
  });
}

// ---------------------------------------------------------------------------
// Masking — identical rules to tools/questions/build.js. Members paste e-mail
// addresses, phone numbers and IBANs straight into the chat and it can turn up
// in ANY quote, so this runs on every example without exception.
// ---------------------------------------------------------------------------
function redact(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?\d{4}[\s]?\d{2,10}\b/gi, '[IBAN]')
    .replace(/(?:\+31|0031|\b0)[\s-]?(?:\d[\s-]?){8,9}\d\b/g, '[phone]')
    .replace(/\b\d{7,}\b/g, '[number]');
}

// ---------------------------------------------------------------------------
// Topics — the Freshdesk category, tidied. The categories are theirs, not ours,
// which is the point: renaming a category in Freshdesk should move the article
// here too. Only the unreadable ones are rewritten.
// ---------------------------------------------------------------------------
const TOPIC = {
  'Club Facilities & services': 'Club facilities',
  'Price Indexation July 2026 (limited members only)': 'Price increase',
  'TrainMore App': 'The app',
  'Membership Management': 'Membership changes',
  'Promotion & Offers': 'Promotions',
};
const topicOf = (cat) => TOPIC[cat] || cat || 'Uncategorised';

// ---------------------------------------------------------------------------
// The matcher's vocabulary
// ---------------------------------------------------------------------------
// Roughly half of member messages are Dutch and every FAQ title is English, so
// an English-only matcher would report near-zero demand for articles members
// ask about constantly. This is the bridge. It is deliberately a translation
// list and not a synonym list: guessing that "pause" implies "cancel" is how a
// demand number starts describing something other than what it claims to.
const NL = {
  membership: ['abonnement', 'lidmaatschap'], subscription: ['abonnement'],
  member: ['lid', 'leden'], members: ['lid', 'leden'],
  cancel: ['opzeggen', 'opzegging', 'annuleren', 'opzeg', 'beeindigen', 'beëindigen'],
  cancellation: ['opzegging', 'opzegtermijn', 'annulering'],
  notice: ['opzegtermijn'],
  class: ['les', 'lessen', 'groepsles'], classes: ['les', 'lessen', 'groepsles'],
  book: ['boeken', 'reserveren'], booking: ['boeking', 'reservering'],
  payment: ['betaling', 'incasso'], payments: ['betalingen', 'incasso'],
  pay: ['betalen'], charged: ['afgeschreven', 'afgeboekt'],
  price: ['prijs', 'tarief'], prices: ['prijzen', 'tarieven'],
  cost: ['kosten', 'kost'], fee: ['kosten', 'tarief'], fees: ['kosten'],
  increase: ['verhoging', 'prijsverhoging', 'indexatie'],
  invoice: ['factuur', 'betaalbewijs'], refund: ['terugbetaling', 'terugstorten'],
  club: ['locatie', 'vestiging'], clubs: ['locaties', 'vestigingen'],
  location: ['locatie'], locations: ['locaties'],
  opening: ['openingstijden'], hours: ['openingstijden', 'tijden'],
  open: ['geopend', 'open'], closed: ['gesloten', 'dicht'],
  account: ['account'], login: ['inloggen'], password: ['wachtwoord'],
  freeze: ['bevriezen', 'bevriezing'], pause: ['pauzeren', 'stilleggen'],
  contract: ['contract'], trial: ['proefles', 'proeftraining'],
  student: ['student', 'studenten'], discount: ['korting'],
  parking: ['parkeren'], locker: ['kluisje', 'kluis'], lockers: ['kluisjes'],
  shower: ['douche'], showers: ['douches'], towel: ['handdoek'],
  sauna: ['sauna'], pool: ['zwembad'],
  trainer: ['trainer'], training: ['training'], schedule: ['rooster', 'schema'],
  change: ['wijzigen', 'veranderen', 'wijziging'], switch: ['overstappen'],
  extend: ['verlengen'], renew: ['verlengen'], extension: ['verlenging'],
  access: ['toegang'], card: ['pas', 'pasje'],
  corporate: ['bedrijfsfitness', 'zakelijk'], guest: ['gast', 'introduce'],
  child: ['kind'], age: ['leeftijd'],
  holiday: ['vakantie'], medical: ['medisch'], sick: ['ziek'],
  register: ['aanmelden', 'inschrijven'], join: ['aanmelden', 'inschrijven'],
  create: ['aanmaken'], delete: ['verwijderen'], stop: ['stoppen'],
  start: ['starten', 'beginnen'], email: ['mail'], phone: ['telefoon'],
  address: ['adres'], bank: ['bank', 'iban'],
  month: ['maand'], week: ['week'], year: ['jaar'], day: ['dag'],
};

// Words that carry no signal, in both languages. A title is mostly these.
const STOP = new Set(`a an the this that these those it its is are am be been was were
do does did doing done can could will would shall should may might must have has had
i me my we our us you your they them their he she his her there here what when where
how why which who whom whose if then than and or but not no yes for to of in on at by
with from about into over under again more most some any all each other as so such own
same too very just now still also only get got go going make made use used need want
trainmore
de het een en of ik mijn me mij wij ons onze jij je jouw jullie u uw hij zij hun hem haar
is zijn was waren ben bent wordt worden word kan kun kunt kunnen mag mogen moet moeten
wil willen heb hebt heeft hebben had hadden doe doet doen deed
wat wanneer waar hoe waarom welke wie dit dat deze die er niet geen wel ook nog maar dus
te bij met voor van op aan naar uit over om door dan als om zo al meer veel hier daar
mogelijk graag even nog eens toch wordt
because omdat want please help another new old first next last via through`
  .split(/\s+/).filter(Boolean));

// Short words worth keeping even though the length floor would drop them.
// `fee` earns its place on its own: without it "What will my new membership fee
// be?" has one usable term left and inherits the volume of every message that
// says "membership".
const KEEP_SHORT = new Set([
  'app', 'pt', 'gym', 'les', 'pas', 'btw', 'iban', 'sms', 'id',
  'fee', 'vat', 'tax', 'age', 'kid', 'bar', 'sup',
]);

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

function titleTerms(title) {
  const seen = new Set();
  const out = [];
  for (const w of norm(title).split(' ')) {
    if (!w || STOP.has(w)) continue;
    if (w.length < 4 && !KEEP_SHORT.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------
(async () => {
  // --- 1. read every store -------------------------------------------------
  const faqs = await get('/rest/v1/trainmore_faqs?select=id,content,metadata&limit=2000', 'public');
  const clubs = await get('/rest/v1/public_locations?brand=eq.TrainMore&select=*&order=club_name');
  const cases = await get('/rest/v1/case_library?source_kind=in.(prompt,guardrail)&select=*&order=sort_order');
  const allClubs = await get('/rest/v1/locations?select=club_name&brand=eq.TrainMore');
  if (!Array.isArray(faqs) || !faqs.length) throw new Error('no FAQ rows came back');

  const msgs = JSON.parse(fs.readFileSync(__dirname + '/../review/messages.json', 'utf8'));
  const dates = msgs.map((m) => m.created_at).sort();
  const WINDOW_FROM = dates[0].slice(0, 10);
  const WINDOW_TO = dates[dates.length - 1].slice(0, 10);

  // --- 2. the message index ------------------------------------------------
  // Tokenise once, invert once. Without this, ~180 items x 41,754 messages x
  // several terms each is tens of millions of scans; with it, each term is one
  // map lookup.
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

  // A term carried by more than a tenth of all member messages distinguishes
  // nothing — it would hand the same crowd to every article that happens to
  // use the word. Dropped automatically rather than blacklisted by hand, so
  // the rule keeps working as the vocabulary shifts.
  const TOO_COMMON = Math.round(texts.length * 0.10);
  const tooCommon = new Set();
  for (const [w, set] of index) if (set.size > TOO_COMMON) tooCommon.add(w);

  // How much each member said, used only to ORDER candidate quotes: a quote
  // linking to a two-message chat is real and useless to open. Never changes
  // which messages matched, so counts are unaffected.
  const sessionSize = new Map();
  for (const t of texts) sessionSize.set(t.s, (sessionSize.get(t.s) || 0) + 1);

  // Demand from a set of term groups. A group is one English term plus its
  // Dutch equivalents and counts once however many of its variants appear, so
  // a Dutch and an English message weigh the same.
  function demandFromTerms(terms) {
    const groups = [];
    const kept = [];
    for (const t of terms) {
      const variants = [t, ...(NL[t] || [])].map(norm).filter(Boolean);
      const hit = new Set();
      for (const v of variants) {
        if (tooCommon.has(v)) continue;
        const set = index.get(v);
        if (set) for (const i of set) hit.add(i);
      }
      if (!hit.size) continue;
      groups.push(hit);
      kept.push(t);
      if (kept.length >= 6) break;
    }
    // Fewer than two usable terms is not a small number, it is NO number. One
    // term would hand this item every message containing that word: "What will
    // my new membership fee be?" reduced to `membership` collects all 3,147
    // sessions that mention a membership at all, and prints them next to one
    // article as if they were about it. Null says "cannot tell", which is true;
    // zero would say "nobody asks", which is not.
    if (groups.length < 2) return { messages: null, sessions: null, terms: kept, hits: [] };

    const count = new Map();
    for (const g of groups) for (const i of g) count.set(i, (count.get(i) || 0) + 1);
    // Two terms out of a short title, three out of a long one. A long title has
    // more generic words in it, so a fixed two would let its two most common
    // terms carry the match and quietly measure the broad subject instead of
    // this article.
    const need = groups.length >= 4 ? 3 : 2;
    const hits = [];
    for (const [i, n] of count) if (n >= need) hits.push(i);
    return {
      messages: hits.length,
      sessions: new Set(hits.map((i) => texts[i].s)).size,
      terms: kept,
      need,
      hits,
    };
  }

  // Demand from a literal phrase — used for club names, where "de Pijp" is the
  // whole signal and splitting it into words would match half of Amsterdam.
  function demandFromPhrase(phrase) {
    const p = norm(phrase);
    if (!p) return { messages: null, sessions: null, terms: [], hits: [] };
    // Padded, so the match is on whole words. A bare substring search credits
    // "Coolsingel" to the Singel club and "Oosterpark" to Amsterdam Oost, and
    // both were in the first run of this.
    const needle = ' ' + p + ' ';
    const hits = [];
    normed.forEach((t, i) => { if ((' ' + t + ' ').includes(needle)) hits.push(i); });
    return {
      messages: hits.length,
      sessions: new Set(hits.map((i) => texts[i].s)).size,
      terms: [phrase],
      hits,
    };
  }

  // Three quotes, three DIFFERENT members, readable length, masked. Three
  // different sessions rather than three messages, so the examples are three
  // people rather than one person rephrasing.
  function examplesFrom(hits) {
    const ranked = hits.slice()
      .sort((a, b) => (sessionSize.get(texts[b].s) || 0) - (sessionSize.get(texts[a].s) || 0));
    const seen = new Set(), usedSessions = new Set();
    const examples = [], sessions = [];
    for (const i of ranked) {
      const t = texts[i].raw;
      if (t.length < 15 || t.length > 120) continue;
      const k = t.toLowerCase().slice(0, 28);
      if (seen.has(k) || usedSessions.has(texts[i].s)) continue;
      seen.add(k); usedSessions.add(texts[i].s);
      examples.push(redact(t));
      sessions.push(texts[i].s);
      if (examples.length >= 3) break;
    }
    return { examples, sessions };
  }

  const items = [];

  // --- 3. the FAQ store, folded from chunks back into articles -------------
  // reference_url carries the Freshdesk article id, which is what makes the
  // fold possible and what makes the duplicate detection exact rather than a
  // guess at matching titles.
  const SOURCE_OF = {
    freshdesk: { source: 'freshdesk', source_key: 'freshdesk_articles' },
    // Keyed 'unidentified', not 'spreadsheet'. It was recorded as TrainMore
    // FAQs.xlsx until 14 Sep 2026; that was an inference from column shape and
    // the file was never found. The source_key still points at the register row
    // (keys are opaque and referenced by question_traces), but the name is gone.
    blob: { source: 'unidentified', source_key: 'faq_spreadsheet' },
    'member-care': { source: 'member_care', source_key: 'member_care_answers' },
  };
  const articles = new Map();
  for (const row of faqs) {
    const m = row.metadata || {};
    const feed = m.source;
    if (!SOURCE_OF[feed]) continue;
    const artId = (String(m.reference_url || '').match(/(\d{6,})/) || [])[1]
      || 't:' + norm(m.title).replace(/ /g, '-');
    const key = `${feed}:${artId}`;
    let a = articles.get(key);
    if (!a) articles.set(key, (a = {
      key, feed, artId, title: m.title || '(untitled)',
      url: m.reference_url || null, category: m.category, parts: [],
    }));
    let line = 0;
    try { line = JSON.parse(m.loc || '{}').lines?.from || 0; } catch (e) { /* unordered */ }
    a.parts.push({ line, content: String(row.content || '').trim() });
  }

  // Which article ids the Freshdesk sync already carries. Everything the
  // second feed holds beyond this set would be knowledge only it provides —
  // and as of 13 Sep 2026 that set is empty, which is the finding.
  const freshdeskIds = new Set(
    [...articles.values()].filter((a) => a.feed === 'freshdesk').map((a) => a.artId),
  );

  let n = 0;
  for (const a of [...articles.values()].sort((x, y) => x.key.localeCompare(y.key))) {
    const body = a.parts.sort((p, q) => p.line - q.line).map((p) => p.content).join('\n\n');
    const dup = a.feed === 'blob' && freshdeskIds.has(a.artId) ? `freshdesk:${a.artId}` : null;
    const d = demandFromTerms(titleTerms(a.title));
    const ex = examplesFrom(d.hits);
    items.push({
      key: a.key,
      sort_order: ++n,
      ...SOURCE_OF[a.feed],
      wiring: 'live',
      title: a.title,
      body,
      url: a.url,
      topic: topicOf(a.category),
      chunks: a.parts.length,
      duplicate_of: dup,
      caveat: dup
        ? 'Stored twice. The same article arrives from Freshdesk on its own, so retrieval can return both copies of it. Editing the Freshdesk article does NOT change this copy, and we do not know what writes it.'
        : null,
      demand_method: d.need
        ? `${d.need} of ${d.terms.length} keywords from the title`
        : 'not measurable — fewer than two distinctive words in the title',
      matched_messages: d.messages,
      matched_sessions: d.sessions,
      demand_terms: d.terms,
      examples: ex.examples,
      example_sessions: ex.sessions,
      verified_at: TODAY,
    });
  }

  // --- 4. one item per club the bot can actually see -----------------------
  // From public_locations, not locations: that view is what the bot reads, so
  // a club hidden by bot.club_visibility is knowledge she does NOT have and
  // does not belong in a list of what she knows.
  const YES = (v) => String(v).toUpperCase() === 'YES' || v === true;
  const LABEL = {
    egym: 'eGym', pool: 'swimming pool', sauna: 'sauna', trib3: 'TRIB3',
    boxing: 'boxing', physio: 'physiotherapy', bty_clb: 'Beauty Club',
    parking: 'parking', pilat3s: 'PILAT3S', ice_bath: 'ice bath',
    spinning: 'spinning', gaia_zone: 'GAIA zone', steam_room: 'steam room',
    pt_training: 'personal training', inbody_scale: 'InBody scale',
    finnish_sauna: 'Finnish sauna', hybrid_studio: 'hybrid studio',
    recovery_zone: 'recovery zone', towel_service: 'towel service',
    infrared_sauna: 'infrared sauna', free_tea_coffee: 'free tea and coffee',
    red_light_therapy: 'red light therapy', free_protein_shakes: 'free protein shakes',
    other_group_classes: 'group classes',
  };
  const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'],
    ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

  for (const c of clubs) {
    const h = c.hours || {}, p = c.pricing || {}, f = c.facilities || {};
    // Collapse identical days: "Mon-Sun 07:00-23:00" is the true shape of most
    // clubs and seven identical lines hide it.
    const spans = [];
    for (const [k, label] of DAYS) {
      const d = h[k];
      const v = d && d.open ? `${d.open}-${d.close}` : 'closed';
      const last = spans[spans.length - 1];
      if (last && last.v === v) last.to = label;
      else spans.push({ from: label, to: label, v });
    }
    const hoursText = spans
      .map((s) => `${s.from === s.to ? s.from : s.from + '–' + s.to} ${s.v}`)
      .join(', ');

    // euro1_discount is deliberately omitted: the Public FAQ prompt forbids the
    // bot from stating any discount, and the column is dropped from the club
    // block it is given. Listing it here would claim she knows something she
    // is never allowed to say.
    const facilities = Object.keys(f)
      .filter((k) => k !== 'euro1_discount' && YES(f[k]))
      .map((k) => LABEL[k] || k.replace(/_/g, ' '))
      .sort();

    const lines = [
      `${c.club_name}${c.city ? ', ' + c.city : ''}${c.address ? ' — ' + c.address : ''}.`,
      c.club_tier_type ? `Club label: ${c.club_tier_type}.` : null,
      `Opening hours: ${hoursText}.`,
      p.day_pass_price != null ? `Day pass: ${p.currency || 'EUR'} ${p.day_pass_price}.` : null,
      p.monthly_fee ? `Membership from ${p.monthly_fee}${p.joining_fee ? `, joining fee ${p.joining_fee}` : ''}.` : null,
      facilities.length ? `Facilities: ${facilities.join(', ')}.` : 'No facilities are flagged for this club.',
    ].filter(Boolean);

    // The distinctive part of the name — the brand and the city are shared by
    // a dozen clubs and matching on them would credit every Amsterdam question
    // to every Amsterdam club.
    const distinctive = c.club_name
      .replace(new RegExp('^\\s*' + (c.brand || '') + '\\s*', 'i'), '')
      .replace(new RegExp('^\\s*' + (c.city || '') + '\\s*', 'i'), '')
      .trim() || c.city || c.club_name;

    const d = demandFromPhrase(distinctive);
    const ex = examplesFrom(d.hits);
    items.push({
      key: 'club:' + norm(c.club_name).replace(/ /g, '-'),
      sort_order: ++n,
      source: 'club_directory',
      source_key: 'club_workbook',
      wiring: 'live',
      title: c.club_name,
      body: lines.join('\n'),
      url: null,
      topic: 'Clubs',
      chunks: 1,
      duplicate_of: null,
      caveat: facilities.length === 0
        ? 'Every facility column is empty or NO for this club, so the bot will say it has none of them. That is the sheet talking, not the club.'
        : null,
      demand_method: `the club name "${distinctive}" written out in full`,
      matched_messages: d.messages,
      matched_sessions: d.sessions,
      demand_terms: d.terms,
      examples: ex.examples,
      example_sessions: ex.sessions,
      verified_at: TODAY,
    });
  }

  // --- 5. the rules typed into prompts and guardrails ----------------------
  // Taken from bot.case_library rather than re-read out of n8n: those rows
  // were written by tracing the live workflows and carry their own verified_at,
  // so copying them keeps one statement of each rule instead of two that can
  // disagree.
  for (const c of cases) {
    const body = [
      c.action_summary,
      c.trigger_detail ? `Fires on: ${c.trigger_detail}` : null,
      [c.source_detail, c.workflow ? `Workflow: ${c.workflow}.` : null]
        .filter(Boolean).join(' '),
    ].filter(Boolean).join('\n\n');
    const d = demandFromTerms(titleTerms(c.trigger_label));
    const ex = examplesFrom(d.hits);
    items.push({
      key: 'prompt:' + c.key,
      sort_order: ++n,
      source: 'prompt',
      source_key: 'prompt_knowledge',
      wiring: 'deploy',
      title: c.trigger_label,
      body,
      url: null,
      topic: c.area,
      chunks: 1,
      duplicate_of: null,
      caveat: c.known_issues,
      demand_method: d.need
        ? `${d.need} of ${d.terms.length} keywords from what sets the rule off`
        : 'not measurable — fewer than two distinctive words to match on',
      matched_messages: d.messages,
      matched_sessions: d.sessions,
      demand_terms: d.terms,
      examples: ex.examples,
      example_sessions: ex.sessions,
      // Carried through rather than stamped today: these rows were verified
      // against the workflows on their own date and copying them here does not
      // re-verify anything.
      verified_at: c.verified_at,
    });
  }

  // --- 6. tags -------------------------------------------------------------
  // Three families, because they answer three different questions: where did
  // this come from, can I get it changed, and is anything wrong with it. The
  // second is the one that decides what a note is worth.
  const SOURCE_TAG = {
    freshdesk: 'freshdesk', unidentified: 'unidentified-loader', member_care: 'member-care',
    club_directory: 'club-data', prompt: 'prompt',
  };
  const WIRING_TAG = { live: 'live', deploy: 'needs-deploy', not_wired: 'not-wired' };

  const ranked = items.slice()
    .sort((a, b) => (b.matched_sessions ?? -1) - (a.matched_sessions ?? -1));
  // The second copy of an article is not a second subject. Counting it would
  // spend a quarter of the top twenty showing the same titles twice.
  const mostAsked = new Set(
    ranked.filter((i) => !i.duplicate_of && i.matched_sessions)
      .slice(0, 20).map((i) => i.key),
  );
  const duplicatedIds = new Set(
    items.filter((i) => i.duplicate_of).map((i) => i.duplicate_of),
  );

  for (const i of items) {
    const tags = [SOURCE_TAG[i.source], WIRING_TAG[i.wiring]];
    if (i.duplicate_of || duplicatedIds.has(i.key)) tags.push('stored-twice');
    if (i.chunks > 1) tags.push('split-' + i.chunks);
    // Three different states, kept apart: nobody raised it, we cannot tell, and
    // it is one of the twenty biggest subjects. Collapsing the first two is how
    // "we have no instrument" gets read as "no one cares".
    if (i.matched_sessions === null) tags.push('cannot-tell');
    else if (i.matched_sessions === 0) tags.push('never-raised');
    if (mostAsked.has(i.key)) tags.push('most-asked');
    if (i.caveat) tags.push('watch-out');
    i.tags = tags;
    i.window_from = WINDOW_FROM;
    i.window_to = WINDOW_TO;
    i.brand = 'trainmore';
  }

  fs.writeFileSync(__dirname + '/items.json', JSON.stringify({
    window: { from: WINDOW_FROM, to: WINDOW_TO, messages: texts.length },
    items,
  }, null, 2));

  // --- 7. say what was built, including what was left out ------------------
  const by = (f) => items.reduce((a, i) => (a[f(i)] = (a[f(i)] || 0) + 1, a), {});
  console.log('items:', items.length);
  console.log('by source:', by((i) => i.source));
  console.log('by wiring:', by((i) => i.wiring));
  console.log('duplicates (second-feed copies of a Freshdesk article):',
    items.filter((i) => i.duplicate_of).length);
  const uniqueToSheet = items.filter(
    (i) => i.source === 'unidentified' && !i.duplicate_of).length;
  console.log('articles ONLY the second feed provides:', uniqueToSheet);
  console.log('never raised (0 matched sessions):',
    items.filter((i) => i.matched_sessions === 0).length);
  console.log('cannot tell (fewer than two distinctive words):',
    items.filter((i) => i.matched_sessions === null).length);
  console.log('terms dropped as too common (>10% of messages):',
    [...tooCommon].slice(0, 20).join(', ') || '(none)');
  console.log('clubs in the directory but hidden from the bot:',
    (Array.isArray(allClubs) ? allClubs.length : 0) - clubs.length);
  console.log('window:', WINDOW_FROM, '->', WINDOW_TO, `(${texts.length} messages)`);
  console.log('\ntop 15 by demand:');
  for (const i of ranked.slice(0, 15)) {
    console.log(String(i.matched_sessions).padStart(6), i.source.padEnd(15),
      i.title.slice(0, 58).padEnd(58), '[' + i.demand_terms.join(' ') + ']');
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
