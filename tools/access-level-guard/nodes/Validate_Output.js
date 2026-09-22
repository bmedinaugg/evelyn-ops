// === Ticket Collection: Validate LLM Output ===
// Guard against bad LLM responses. On failure, fall back to a safe
// 'ask the user to try again' reply rather than crashing.

const VALID_TRANSITIONS = ['stay', 'ready_for_confirmation', 'cancel'];
const VALID_CATEGORIES  = ['club', 'membership', 'payments', 'trainmore_app', 'other'];
const VALID_PRIORITIES  = ['low', 'medium', 'high'];
const REQUIRED_FIELDS   = ['subject', 'description', 'category', 'priority'];

// --- Pull in data from earlier nodes ---
const llmRaw        = $input.first().json;
const prep          = $('Prepare Prompt Variables').first().json;
const trigger       = $('When Called by Parent').first().json;
const originalDraft = trigger.draft || {};

// --- Extract parsed object from the LLM Chain output ---
// The structured output parser may nest under .output, or return directly
let parsed = null;
if (llmRaw && typeof llmRaw === 'object') {
  if (llmRaw.output && typeof llmRaw.output === 'object') {
    parsed = llmRaw.output;
  } else if (typeof llmRaw.text === 'string') {
    try { parsed = JSON.parse(llmRaw.text); } catch (e) { parsed = null; }
  } else if (llmRaw.reply_text !== undefined) {
    parsed = llmRaw;
  }
}

// --- Helpers ---
function pick(newVal, oldVal) {
  if (newVal === null || newVal === undefined || newVal === '') return oldVal;
  return newVal;
}

function fallback(error, replyOverride) {
  return [{ json: {
    validation_passed: false,
    validation_error:  error,
    session_id:        prep.session_id,
    telegram_user_id:  prep.telegram_user_id,
    draft_id:          prep.draft_id,
    customer_id:       prep.customer_id,
    reply_text:        replyOverride || "Sorry, I had trouble processing that. Could you tell me again about the issue you'd like to report?",
    transition:        'stay',
    updated_draft:     originalDraft,
    missing_fields:    trigger.missing_fields || REQUIRED_FIELDS,
    raw_llm_output:    JSON.stringify(llmRaw).slice(0, 1000)
  } }];
}

// --- Structural validation ---
if (!parsed || typeof parsed !== 'object') {
  return fallback('LLM output is missing or not an object');
}
if (typeof parsed.reply_text !== 'string' || parsed.reply_text.length === 0) {
  return fallback('reply_text missing or empty');
}
if (!VALID_TRANSITIONS.includes(parsed.transition)) {
  return fallback('Invalid transition: ' + parsed.transition);
}
if (!parsed.field_updates || typeof parsed.field_updates !== 'object') {
  return fallback('field_updates missing or not an object');
}

// --- Enum validation (null is allowed; it means 'not collected yet') ---
const fu = parsed.field_updates;
if (fu.category != null && !VALID_CATEGORIES.includes(fu.category)) {
  return fallback('Invalid category: ' + fu.category);
}
if (fu.priority != null && !VALID_PRIORITIES.includes(fu.priority)) {
  return fallback('Invalid priority: ' + fu.priority);
}

// === RECORDING GATE (2026-09-08) ==========================================
// Feedback 44a2f893 (Thallia El Haddad), session 3fb2c0e8: the bot invented the
// access level "VIP" for a club the member spelled "wibeautstraat" (no such
// club), wrote both into the draft, the member accepted the preview and REAL
// ticket #634927 was filed reading "User wants to change their membership to
// Wibeautstraat with VIP access level." A prompt guard cannot be relied on for
// this -- and the stale-preview watchdog (egZI00OnrkqcBglq) can submit a draft
// the member never confirmed -- so the value is checked here, in code, before it
// is ever persisted. On a hit the field update is REJECTED (the previous draft
// text is kept, so nothing invented can be auto-submitted later) and the turn
// re-asks instead.
// Both vocabularies come from the live form data, so they cannot drift.
// FAILS OPEN: any error, or empty live data, leaves the old behaviour untouched.
let VALID_LEVEL_TOKENS = [];
let VALID_LEVEL_NAMES = [];
let CLUB_WORDS = new Set();
try {
  let fo = $('Fetch Form Options').all().map((i) => i.json);
  if (fo.length === 1) { const b = fo[0].body ?? fo[0]; if (Array.isArray(b)) fo = b; }
  fo = (fo || []).filter((r) => r && r.form_key);
  for (const fk of ['cf_clubs', 'cf_club_where_they_want_to_extend_at']) {
    const r = fo.find((x) => x.field_key === fk);
    const tree = (r && r.options && r.options.choices) || {};
    for (const k of Object.keys(tree)) {
      for (const w of String(k).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')) {
        if (w.length >= 3) CLUB_WORDS.add(w);
      }
      for (const lv of Object.keys(tree[k] || {})) {
        VALID_LEVEL_NAMES.push(String(lv));
        VALID_LEVEL_TOKENS.push(String(lv).split('(')[0].trim().replace(/\s+/g, '').toUpperCase());
      }
    }
  }
} catch (e) {}
VALID_LEVEL_TOKENS = [...new Set(VALID_LEVEL_TOKENS)];
VALID_LEVEL_NAMES = [...new Set(VALID_LEVEL_NAMES)];
const VALID_LABELS = ['black', 'red', 'regular'];
// Words that legitimately sit in front of "access level" in ordinary prose, in
// both languages. A candidate must be capitalised AND not one of these before it
// counts as a claimed tier name.
const LEVEL_FILLER = new Set(('a an the your my our their his her its this that these those which what any no one none new same current existing higher lower highest lowest ' +
  'different another other requested desired chosen selected preferred correct right wrong available appropriate suitable exact specific updated final following above below own only best full better ' +
  'and or of for to with at in on by per about regarding is are was were be been has have had want wants wanted need needs needed change changes changing choose chose select know tell ask offer offers ' +
  'provide means determines refers depends include includes member members user users customer trainmore club clubs gym gyms level levels ' +
  'een de het uw je jouw jullie mijn ons onze hun zijn haar dit dat deze welke welk geen nieuw nieuwe huidig huidige hoger hogere hoogste laag lager lagere ander andere gewenst gewenste gekozen juiste ' +
  'beschikbare specifieke definitieve eigen en van voor naar met op bij over per lid leden klant toegangs niveau niveaus').split(' '));
// Words that are not clubs but do follow "to/naar" in a legitimate change
// request, so the club check must not fire on them.
const NOT_A_CLUB = new Set(('student students corporate company b2b flex premium home city basic basis standard standaard vip gold goud silver zilver bronze brons platinum elite deluxe pro unlimited onbeperkt ' +
  'january february march april may june july august september october november december januari februari maart mei juni juli augustus oktober ' +
  'monday tuesday wednesday thursday friday saturday sunday maandag dinsdag woensdag donderdag vrijdag zaterdag zondag ' +
  'terms privacy promotion trainmore member reply yes no ok').split(' '));
const normw = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+]+/g, '');
function badLevelIn(text) {
  if (!VALID_LEVEL_TOKENS.length) return null;
  const txt = String(text || '');
  const isValid = (tok) => VALID_LEVEL_TOKENS.indexOf(String(tok).toUpperCase().replace(/\s+/g, '')) !== -1;
  const candidates = [];
  const take = (tok) => {
    const c = String(tok || '').trim();
    if (!/^[A-Z][A-Za-z]{1,11}\+?$/.test(c)) return;
    if (LEVEL_FILLER.has(normw(c))) return;
    if (isValid(c)) return;
    candidates.push(c);
  };
  let m;
  // "<TIER> access level" -- the exact shape that reached ticket #634927.
  const R1 = /\b([A-Za-z][A-Za-z]{1,11}\+?)\s+(?:[Aa]ccess[ -]?[Ll]evel|[Tt]oegangsniveau)/g;
  while ((m = R1.exec(txt)) !== null) take(m[1]);
  // "access level: <TIER>" / "toegangsniveau is <TIER>" -- value-assignment only,
  // so ordinary prose after the phrase cannot trigger it.
  const R2 = /(?:[Aa]ccess[ -]?[Ll]evel|[Tt]oegangsniveau)s?\s*(?::|=|\bis\b|\bwordt\b|\bnaar\b)\s*["'“‘]?([A-Za-z][A-Za-z]{1,11}\+?)/g;
  while ((m = R2.exec(txt)) !== null) take(m[1]);
  if (candidates.length) return candidates[0];
  // A level paired with a club label in brackets. The real level names never
  // match this shape (their brackets always continue past "Label Clubs"), so a
  // match is always the label/level mix-up: "HOME (Black Label club)".
  const R3 = /\b([A-Za-z][A-Za-z]{1,11}\+?)\s*\(\s*([A-Za-z]{3,12})\s+Label\s+[Cc]lubs?\s*\)/g;
  while ((m = R3.exec(txt)) !== null) {
    const lvl = m[1];
    const lab = m[2];
    if (VALID_LABELS.indexOf(lab.toLowerCase()) === -1) return lvl + ' (' + lab + ' Label)';
    const own = VALID_LEVEL_NAMES.find((n) => normw(n.split('(')[0]) === normw(lvl));
    if (!own || own.toLowerCase().indexOf(lab.toLowerCase() + ' label') === -1) return lvl + ' (' + lab + ' Label)';
  }
  return null;
}
function unknownClubIn(text) {
  if (!CLUB_WORDS.size) return null;
  const R = /\b(?:to|naar|at|bij|op)\s+(?:the |de |het )?(?:club |gym |locatie |vestiging |studio )?(?:TrainMore |Trainmore )?([A-Z][A-Za-zÀ-ſ'’-]{4,22})/g;
  let m;
  while ((m = R.exec(String(text || ''))) !== null) {
    const w = normw(m[1]);
    if (!w || w.length < 5) continue;
    if (NOT_A_CLUB.has(w)) continue;
    if (VALID_LEVEL_TOKENS.indexOf(w.toUpperCase()) !== -1) continue;
    if (CLUB_WORDS.has(w)) continue;
    return m[1];
  }
  return null;
}
// === PRICE GATE (2026-09-22) ==============================================
// The access-level gate above reads field_updates only, so it catches a tier
// the model tried to RECORD and misses one it merely SAID. Three reproduced
// failures were all of the second kind:
//   Piet Heinkade  quoted HOME+ at EUR62 when the member asked for 1 year.
//                  EUR62 is real there -- it is the 3-year price. Right club,
//                  right tier, wrong row.
//   Laan van NOI   offered HOME, which that club does not sell. HOME is a real
//                  tier elsewhere, so the global level check passes it.
//   Noordermarkt   "EUR96 per month". The value is right; the unit is not.
// So this gate reads reply_text, and it checks against the tree for the
// RESOLVED CLUB rather than against all clubs at once.
//
// Deliberately narrow, because a reply legitimately carries prices that are not
// membership options -- an outstanding balance, a starter fee, a past charge.
// A price only counts if a contract term sits within 40 characters of it, and a
// tier only counts if it is presented as a numbered or bulleted option.
// FAILS OPEN: no resolved club, or no tree for it, means no opinion.
const PRICE_TREE = {};
const normClub = (s) => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/\((red|black|regular) label\)/g, '')
  .replace(/[-–]\s*opens.*$/, '')
  .replace(/\btrainmore\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const termOf = (s) => {
  if (/flex/i.test(s)) return 'flex';
  const m = /(\d+)\s*[-–—]?\s*(?:year|years|jaar)/i.exec(s);
  return m ? m[1] + 'y' : null;
};
const priceOf = (s) => {
  const m = /€\s*([0-9]+(?:[.,][0-9]{1,2})?)/.exec(s);
  return m ? Number(m[1].replace(',', '.')) : null;
};
try {
  let fo = $('Fetch Form Options').all().map((i) => i.json);
  if (fo.length === 1) { const b = fo[0].body ?? fo[0]; if (Array.isArray(b)) fo = b; }
  fo = (fo || []).filter((r) => r && r.form_key);
  for (const fk of ['cf_clubs', 'cf_club_where_they_want_to_extend_at']) {
    const r = fo.find((x) => x.field_key === fk);
    const tree = (r && r.options && r.options.choices) || {};
    for (const club of Object.keys(tree)) {
      const ck = normClub(club);
      for (const lv of Object.keys(tree[club] || {})) {
        const tier = String(lv).split('(')[0].trim().replace(/\s+/g, '').toUpperCase();
        for (const opt of tree[club][lv] || []) {
          const t = termOf(opt), p = priceOf(opt);
          if (!t || p == null) continue;
          PRICE_TREE[ck] = PRICE_TREE[ck] || {};
          PRICE_TREE[ck][tier] = PRICE_TREE[ck][tier] || {};
          PRICE_TREE[ck][tier][t] = p;
        }
      }
    }
  }
} catch (e) {}

function priceProblemIn(text, club) {
  const tree = PRICE_TREE[normClub(club)];
  if (!tree) return null;
  const all = new Set();
  for (const tier of Object.keys(tree)) {
    for (const t of Object.keys(tree[tier])) all.add(tree[tier][t]);
  }
  const R = /(?:(\d)\s*[-–—]?\s*(?:years?|jaar)|\b(flex)\b)[^€\n]{0,40}€\s*([0-9]+(?:[.,][0-9]{1,2})?)|€\s*([0-9]+(?:[.,][0-9]{1,2})?)[^€\n]{0,40}(?:(\d)\s*[-–—]?\s*(?:years?|jaar)|\b(flex)\b)/gi;
  let m;
  while ((m = R.exec(String(text || ''))) !== null) {
    const n = m[1] || m[5];
    const isFlex = m[2] || m[6];
    const price = Number(String(m[3] || m[4]).replace(',', '.'));
    const term = isFlex ? 'flex' : (n + 'y');
    const expected = [];
    let ok = false;
    for (const tier of Object.keys(tree)) {
      const p = tree[tier][term];
      if (p == null) continue;
      expected.push(p);
      if (Math.abs(p - price) < 0.005) ok = true;
    }
    if (!expected.length) {
      // The club sells no contract of that length. Offering one anyway is the
      // same failure as inventing a price, so it is treated the same way.
      return 'no ' + term + ' contract is sold at this club';
    }
    if (!ok) {
      return all.has(price)
        ? 'price €' + price + ' is not the ' + term + ' price at this club'
        : 'price €' + price + ' is not offered at this club';
    }
  }
  return null;
}

function wrongFrequencyIn(text, club) {
  const tree = PRICE_TREE[normClub(club)];
  if (!tree) return null;
  const all = new Set();
  for (const tier of Object.keys(tree)) {
    for (const t of Object.keys(tree[tier])) all.add(tree[tier][t]);
  }
  // Every consumer rate in Magicline bills every 4 weeks -- 148 of 148 checked,
  // all four contract lengths (tools/club-prices/reconcile.py). The form labels
  // do not say so, which is why the model keeps reaching for "per month".
  const R = /€\s*([0-9]+(?:[.,][0-9]{1,2})?)[^€\n]{0,24}\b(?:per|a|each|elke|per\s+kalender)?\s*(month|maand|maandelijks|monthly)\b/gi;
  let m;
  while ((m = R.exec(String(text || ''))) !== null) {
    const price = Number(m[1].replace(',', '.'));
    if (all.has(price)) return '€' + price + ' billed "' + m[2] + '" (every rate is per 4 weeks)';
  }
  return null;
}

function tierNotAtClub(text, club) {
  const tree = PRICE_TREE[normClub(club)];
  if (!tree) return null;
  const offered = new Set(Object.keys(tree));
  // No trailing \b: there is no word boundary between "+" and a space, so \b
  // made the engine backtrack and read "HOME+" as "HOME". A negative lookahead
  // keeps the plus attached instead.
  const R = /(?:^|\n)\s*(?:\d+[).]|[-*•])\s*\**\s*([A-Za-z][A-Za-z]{1,11}\+?)(?![A-Za-z])/g;
  let m;
  while ((m = R.exec(String(text || ''))) !== null) {
    const tok = m[1].toUpperCase();
    if (VALID_LEVEL_TOKENS.indexOf(tok) === -1) continue;
    if (!offered.has(tok)) return m[1];
  }
  return null;
}

let replyRejected = null;
try {
  let rc = '';
  try { rc = String($('Build Priced Options').first().json.resolved_club || '').trim(); } catch (e) {}
  if (rc && typeof parsed.reply_text === 'string' && parsed.reply_text) {
    // When the bot reports the member's OWN account, the figures come from
    // Magicline -- a legacy rate, a promo, a rolling contract that really does
    // bill monthly, a EUR1-per-workout discount. The form tree has no authority
    // over those, so only the tier check (what we OFFER) applies. Measured on 21
    // days of real replies: this exemption is the difference between 7 false
    // positives and none, and it costs no true positives.
    const accountReport = /\bfor your account\b|\bvoor je account\b/i.test(parsed.reply_text);
    if (!accountReport) {
      replyRejected = priceProblemIn(parsed.reply_text, rc);
      if (!replyRejected) replyRejected = wrongFrequencyIn(parsed.reply_text, rc);
    }
    if (!replyRejected) {
      const bt = tierNotAtClub(parsed.reply_text, rc);
      if (bt) replyRejected = 'tier not offered at this club: ' + bt;
    }
  }
} catch (e) { replyRejected = null; }

let recordingRejected = null;
try {
  const claim = String(fu.subject || '') + '\n' + String(fu.description || '');
  if (claim.trim()) {
    const badLevel = badLevelIn(claim);
    if (badLevel) recordingRejected = 'invented access level: ' + badLevel;
    if (!recordingRejected) {
      let resolvedClub = '';
      try { resolvedClub = String($('Build Priced Options').first().json.resolved_club || '').trim(); } catch (e) {}
      if (!resolvedClub) {
        const badClub = unknownClubIn(claim);
        if (badClub) recordingRejected = 'unverified club name: ' + badClub;
      }
    }
  }
} catch (e) { recordingRejected = null; }
if (recordingRejected) {
  fu.subject = null;
  fu.description = null;
}

// --- Merge updates into draft, preserving existing values ---
const merged = {
  ...originalDraft,
  subject:     pick(fu.subject,     originalDraft.subject),
  description: pick(fu.description, originalDraft.description),
  category:    pick(fu.category,    originalDraft.category),
  priority:    pick(fu.priority,    originalDraft.priority)
};

// --- Recompute missing fields from the merged draft (source of truth) ---
const newMissing = REQUIRED_FIELDS.filter(f => {
  const v = merged[f];
  return v === null || v === undefined || v === '';
});

// --- Cross-check: did the LLM claim completion while fields remain null? ---
let finalTransition = parsed.transition;
let finalReply      = parsed.reply_text;

if (finalTransition === 'ready_for_confirmation' && newMissing.length > 0) {
  // LLM hallucinated. Override and re-ask for the first missing field.
  finalTransition = 'stay';
  finalReply = 'Almost there — I still need a bit more info. Could you tell me the ' + newMissing[0] + '?';
}

if (replyRejected && !recordingRejected) {
  // The recorded draft may be fine; it is what the member was TOLD that is
  // wrong. Do not advance, and re-offer from the verified list rather than
  // letting the model restate it a second time.
  finalTransition = 'stay';
  finalReply = 'Sorry — let me correct that before we go on. Here are the real options and prices for this club, so you get the right figure for the term you want.';
}

if (recordingRejected) {
  // Do not advance and do not persist the rejected value. Ask for the one thing
  // we could not verify, in plain language, instead of guessing again.
  finalTransition = 'stay';
  finalReply = /club/.test(recordingRejected)
    ? 'Sorry — I want to get the club right before I note anything down. Which club would you like to move to? Tell me the city or the exact club name and I will give you its options.'
    : 'Sorry — let me correct myself before I note that down. Which club would you like? Once I know the club I can give you the exact access levels it offers, and those are the only ones I can put on your request.';
}

// --- Success ---
return [{ json: {
  validation_passed: true,
  validation_error:  null,
  session_id:        prep.session_id,
  channel_user_id:   prep.channel_user_id,
  draft_id:          prep.draft_id,
  customer_id:       prep.customer_id,
  reply_text:        finalReply,
  transition:        finalTransition,
  updated_draft:     merged,
  missing_fields:    newMissing,
  raw_llm_output:    null,
  recording_rejected: recordingRejected,
  reply_rejected:     replyRejected
} }];
