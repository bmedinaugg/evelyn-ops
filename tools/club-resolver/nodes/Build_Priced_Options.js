// Merge prep vars + build (1) form_options_text and (2) consent_prompts_text.
// form_options_text drives the CHANGE/EXTENSION club picker: narrow by city,
// then match the club BY NAME (never by list-number), then show that club's
// priced access levels + durations. Once the pick is captured it becomes an
// explicit 'proceed to consent' instruction so the model stops re-confirming.
const prep = $('Prepare Prompt Variables').first().json;

// This node's PRIMARY INPUT is Fetch Form Options: one item per form_schemas row.
let rows = [];
try {
  rows = $input.all().map(i => i.json);
  if (rows.length === 1) {
    const body = rows[0].body ?? rows[0];
    if (Array.isArray(body)) rows = body;
  }
} catch (e) {}
rows = (rows || []).filter(r => r && r.form_key);

let studio = '';
let sessionCtx = {};
try {
  const resp = $('Fetch Session Context').first().json;
  const body = resp.body ?? resp;
  const ctx = (Array.isArray(body) ? (body[0]?.context) : (body?.context ?? body)) || {};
  sessionCtx = ctx;
  (function find(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6 || studio) return;
    for (const [k, v] of Object.entries(o)) {
      if (studio) return;
      if (typeof v === 'string' && /^studio_?name$/i.test(k) && v.trim()) { studio = v; return; }
      if (v && typeof v === 'object') find(v, depth + 1);
    }
  })(ctx, 0);
} catch (e) {}

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\btrainmore\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

let draftDesc = '';
try { draftDesc = ($('When Called by Parent').first().json.draft || {}).description || ''; } catch (e) {}
const recentText = norm((prep.user_message || '') + ' ' + draftDesc);
// User-only history: history_text lines are 'User: ...' / 'Assistant: ...'.
// Bot turns must NEVER feed keyword matching (menus/boilerplate poison it).
const userHistory = String(prep.history_text || '').split('\n').filter((l) => l.startsWith('User: ')).join(' ');
const studioN = norm(studio);

// ---- infer request type ----
// Classify from the MEMBER'S words + draft only. Assistant turns are excluded
// entirely: previews ("Reply no to cancel") and menus made every request
// classify as a cancellation after the first preview (bogus cooling-off
// notes, broken change/extension club options).
const typeText = norm((draftDesc || '') + ' ' + (prep.current_draft_json || '') + ' ' + (prep.user_message || '') + ' ' + userHistory);
let requestType = 'other';
if (/extension|extend|verleng/.test(typeText)) requestType = 'extension';
else if (/cancel|opzeg/.test(typeText)) requestType = 'cancellation';
else if (/change|switch|upgrade|convert|home club|access level|wijzig|verander|overstap|thuisclub/.test(typeText)) requestType = 'change';
// TRANSFER WIDENING (2026-09-03) — verbatim copy of the alternative that has
// been live in Change Options Briefing since 26 Aug. The header above says this
// classifier is COUPLED to that one, but only the briefing was widened, so the
// priced club picker kept missing transfer wording (ticket 628063; 127 member
// messages in 30 days used it with none of the words above). Now in step again.
else if (/transfer|overzetten|overschrijven|verplaats|downgrade|ander(e)? (club|gym|vestiging)|other (club|gym)|move my (membership|contract|subscription)|red label|black label|regular label/.test(typeText)) requestType = 'change';
// INFLECTIONS (2026-09-03) — feedback 6719c626. The tests above are plain
// substring matches, so "changing" (which does not contain "change") and
// "upgrading" (which does not contain "upgrade") both fell through to 'other'.
// Session 33646d71: "Changing the club" -> no club picker, no briefing, a
// generic ticket 9 seconds after login. 38 messages / 32 sessions in August
// said "changing" without any word the classifier knew, plus 9 for "upgrading".
// A bare widening would be WORSE than the bug: 27 August messages are about the
// CHANGING ROOM (lighting, cleanliness, staff behaviour) and would have been
// turned into membership-change requests. So the inflection must sit next to a
// membership/club object, and the changing-room sense is excluded outright.
// Also excluded by construction: "changing my password" (an app login issue).
// Two forms, because members put the object on either side: "changing studio"
// and "studio changing" are both real messages. The changing-room lookahead is
// applied to BOTH forms, and the object window is tighter on the reverse one
// (20 chars) since a trailing "changing" is weaker evidence than a leading one.
else if (/\b(changing|upgrading)\b(?! (room|rooms|area|areas|facility|facilities|locker|lockers|cubicle|kleedkamer))[a-z0-9 ]{0,30}\b(club|clubs|gym|gyms|membership|memberships|subscription|abonnement|lidmaatschap|home|label|labels|contract|location|studio|vestiging)\b/.test(typeText)
       || /\b(club|clubs|gym|gyms|membership|memberships|subscription|abonnement|lidmaatschap|home|label|labels|contract|location|studio|vestiging)\b[a-z0-9 ]{0,20}\b(changing|upgrading)\b(?! (room|rooms|area|areas|facility|facilities|locker|lockers|cubicle|kleedkamer))/.test(typeText)) requestType = 'change';

// ---- are the ticket details already captured? ----
const baseComplete = /none/i.test(String(prep.missing_fields_text || ''));
// 'keep current contract duration' counts as a completed pick (home-club change
// where the member keeps their duration — no priced option, so no € in draft).
const pickCaptured = /€|voucher\s*:|keep current contract duration|huidige contractduur behouden/i.test(draftDesc);
const reasonCaptured = /reason\s*:/i.test(draftDesc);
let detailsDone;
if (requestType === 'extension' || requestType === 'change') detailsDone = baseComplete && pickCaptured;
else if (requestType === 'cancellation') detailsDone = baseComplete && reasonCaptured;
else detailsDone = baseComplete;

// ---- city helpers ----
const CITIES = ['Amsterdam','Bilthoven','Bussum','Den Haag','Eindhoven','Groningen','Haarlem','Leiden','Leusden','Rotterdam','Utrecht'];
const CITIES_BY_LEN = CITIES.slice().sort((a,b)=>norm(b).length-norm(a).length);
function cityOf(clubKey){ const b = norm(clubKey); for (const c of CITIES_BY_LEN){ const cn = norm(c); if (b === cn || b.startsWith(cn + ' ')) return c; } return null; }

function clubBase(clubKey){ return norm(clubKey.replace(/\s*\(.*?\)\s*$/, '').replace(/\s*-\s*Opens.*$/i, '')); }
function clubShort(clubKey){ const c = cityOf(clubKey); let b = clubBase(clubKey); if (c) b = b.replace(norm(c), '').trim(); return b; }
function shortDisplay(clubKey){ let s = clubKey.replace(/\s*-\s*Opens.*$/i, ''); const c = cityOf(clubKey); if (c) s = s.replace(new RegExp('^\\s*' + c + '\\s*', 'i'), ''); return s.trim(); }
// Dutch name particles that members routinely drop ("Den Haag De Savornin" -> "savornin").
const STOP_TOKENS = new Set(['de','den','van','het','en','la','le','the']);
const recentTokenArr = recentText.split(' ').filter(Boolean);
const recentTokens = new Set(recentTokenArr);
// Small edit-distance so a one-letter typo in a distinctive club name still
// matches ("rebrandtpark" -> "rembrandtpark"). Capped early for speed.
function lev(a, b){
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({length: a.length + 1}, (_, i) => i);
  for (let j = 1; j <= b.length; j++){
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= a.length; i++){
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i-1] + 1, prev + (a[i-1] === b[j-1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[a.length];
}
// Distinctive tokens that sit within typo distance of ANOTHER club's token.
// Populated once the club list is known; see the block after clubKeys below.
let TWIN_TOKENS = new Set();
function clubMatchesIn(clubKey, hayText, hayTokens, hayTokenArr){
  const base = clubBase(clubKey); const short = clubShort(clubKey);
  if (base && hayText.includes(base)) return true;
  if (short && short.length >= 4 && hayText.includes(short)) return true;
  // Token match: any distinctive (non-particle, len>=5) word of the club's short
  // name typed as a whole word by the member counts as a match. Ambiguity between
  // multiple matching clubs is already handled by the "Several clubs match" branch.
  const distinctive = short.split(' ').filter(t => t.length >= 5 && !STOP_TOKENS.has(t));
  if (distinctive.length && distinctive.some(t => hayTokens.has(t))) return true;
  // Typo tolerance: a distinctive token (len>=6) within edit distance 1, or
  // (len>=9) within 2, of a member-typed word. This used to assume distinctive
  // club names are far enough apart to stay specific. Two are not -- see
  // TWIN_TOKENS -- and for those the tolerance is skipped so the exact word
  // match above is the only way in.
  if (distinctive.some(t => !TWIN_TOKENS.has(t) && hayTokenArr.some(w => Math.abs(w.length - t.length) <= 2 && lev(w, t) <= (t.length >= 9 ? 2 : 1) && (t.length >= 6)))) return true;
  return false;
}
// Preserved entry point: identical behaviour to the original clubMatches.
function clubMatches(clubKey){ return clubMatchesIn(clubKey, recentText, recentTokens, recentTokenArr); }
function pricedLines(clubKey, tree, label){ const lines = [label + ' — ' + clubKey + ':']; const levels = tree[clubKey] || {}; for (const [level, durations] of Object.entries(levels)) { const list = Array.isArray(durations) ? durations.join(' | ') : JSON.stringify(durations); lines.push('  - ' + level + ': ' + list); } return lines.join('\n'); }

// ---- (1) FORM OPTIONS TEXT ----
const CLUB_FIELD_BY_TYPE = { extension: 'cf_club_where_they_want_to_extend_at', change: 'cf_clubs' };
const FORM_LABEL = { extension: 'EXTENSION FORM', change: 'CHANGE FORM' };
const wantKey = CLUB_FIELD_BY_TYPE[requestType] || null;

let text;
// Set inside the club branch below; used by the ACCESS LEVEL VOCABULARY block
// and handed downstream to Change Options Briefing (every node between here
// and it spreads {...it.json}, so extra fields survive the chain).
let allLevels = [];
let onlyLevel = '';
let resolvedClub = '';
// The resolved club's own options, and which form field they came from. Empty
// until a club resolves, which is also when the gate downstream has no opinion.
let allowedOptions = {};
let allowedField = '';
// The exact words meant for the member, with no instructions wrapped around
// them. Emitting this separately is the point of task #11: the numbers are
// composed HERE, in code, so a guard downstream can send them verbatim instead
// of asking the model to reproduce them a second time.
let optionsBlock = '';
if (detailsDone) {
  text = '✅ All required ticket details are already collected' + (draftDesc ? (': ' + draftDesc) : '') + '.\nDo NOT ask for the club, access level, duration, voucher, reason, or any other detail again, and do NOT ask "is that correct?". The details step is COMPLETE — proceed directly to the CONSENT CHECKBOXES gate below (do not show the ticket preview until every required consent checkbox has been agreed).';
} else if (wantKey) {
  const row = rows.find(r => r.field_key === wantKey);
  const tree = (row && row.options && row.options.choices) || {};
  const clubKeys = Object.keys(tree);
  // TYPO-TOLERANCE TWINS (2026-09-21) -- Rotterdam Rijnhaven and Rotterdam
  // Wijnhaven differ by one letter. Each matched the other through the typo
  // rule, so BOTH always matched and NEITHER ever resolved: the member was
  // asked to confirm which club, and replying with the exact full club name
  // returned the same question. With no club resolved there is no priced
  // block, which is why the model then quoted a price belonging to neither.
  // Computed from the live club list, so a future near-collision is handled
  // without another code change.
  TWIN_TOKENS = new Set();
  {
    const distOf = (k) => clubShort(k).split(' ').filter(t => t.length >= 5 && !STOP_TOKENS.has(t));
    const all = [];
    for (const k of clubKeys) for (const t of distOf(k)) all.push([t, k]);
    for (const [a, ka] of all) {
      for (const [b, kb] of all) {
        if (ka === kb || a === b) continue;
        if (a.length >= 6 && Math.abs(a.length - b.length) <= 2 && lev(a, b) <= (a.length >= 9 ? 2 : 1)) {
          TWIN_TOKENS.add(a); TWIN_TOKENS.add(b);
        }
      }
    }
  }
  allLevels = [...new Set(Object.values(tree).flatMap((v) => Object.keys(v || {})))].sort();
  const verb = requestType === 'extension' ? 'extend at' : 'change to';

  let matched = clubKeys.filter(clubMatches);
  // MORE-SPECIFIC NAME WINS (2026-09-21) -- the twin rule above handles names a
  // typo apart; this handles one name CONTAINED IN another. "Oosterdok" also
  // matched "Oost", "Coolsingel" matched "Singel", "Middellandstraat" matched
  // "Landstraat", so each of those three clubs was permanently unresolvable in
  // exactly the same way Rijnhaven was. The longer name only matched because
  // the member typed it in full, so it is the specific one they meant.
  if (matched.length > 1) {
    const moreSpecific = matched.filter(a => !matched.some(b => {
      if (a === b) return false;
      const sa = clubShort(a), sb = clubShort(b);
      return sa && sb && sa.length < sb.length && sb.includes(sa);
    }));
    if (moreSpecific.length >= 1) matched = moreSpecific;
  }
  // CHANGE requests: drop the member's CURRENT club from matches — "from X
  // to Y" names both clubs, and quoting the origin's prices as the
  // destination's gave wrong pricing (5de71b56: Munnekeholm's 3 tiers were
  // presented as Oude Ebbinge, which is PREMIUM-only).
  if (requestType === 'change' && matched.length > 1 && studioN) {
    const withoutOwn = matched.filter(k => { const b = clubBase(k); return !(b && (b.includes(studioN) || studioN.includes(b))); });
    if (withoutOwn.length >= 1) matched = withoutOwn;
  }
  if (requestType === 'extension' && matched.length === 0 && studioN && /\b(current|same|my club|this club|huidige)\b/.test(recentText)) {
    matched = clubKeys.filter(k => { const b = clubBase(k); return b && (b.includes(studioN) || studioN.includes(b)); });
  }

  // STICKY CLUB (2026-09-02) — Member Care feedback 9b8e6dc9, session 529a96c3.
  // `recentText` is the latest message + the draft description only. Once the
  // member had named their club and the description stopped repeating the name,
  // the match went silent mid-conversation, the priced block disappeared, and
  // the model fell back to asking for the access level in free text — which is
  // how a member was asked to choose between options he had already chosen, at
  // a club that offers exactly one. Re-run the SAME matcher over the member's
  // own history (never assistant turns — menus and previews poison it).
  // RESCUE ONLY: a turn that already matched is untouched, so this can add a
  // club where there was none but can never change one that was already found.
  if (matched.length === 0 && userHistory) {
    const histHay = norm(String(prep.user_message || '') + ' ' + draftDesc + ' ' + userHistory);
    const histTokenArr = histHay.split(' ').filter(Boolean);
    const histTokens = new Set(histTokenArr);
    matched = clubKeys.filter((k) => clubMatchesIn(k, histHay, histTokens, histTokenArr));
    // Same origin-club exclusion the fresh match applies, for the same reason:
    // "from X to Y" names both clubs and the origin's prices are not the
    // destination's.
    if (requestType === 'change' && matched.length > 1 && studioN) {
      const wo = matched.filter(k => { const b = clubBase(k); return !(b && (b.includes(studioN) || studioN.includes(b))); });
      if (wo.length >= 1) matched = wo;
    }
  }

  // If the member replied with a NUMBER to a city club list shown on a previous turn,
  // map it to that club HERE (same sort as the CLUB PICKER display), so a numeric reply
  // advances to the access-level step instead of re-listing the whole city.
  let clubJustPicked = false;
  if (matched.length !== 1) {
    const _cn = String(prep.user_message || '').trim().match(/^\s*(\d{1,2})\s*[).:\-]?\s*$/);
    const _cityCtx = CITIES.find(c => recentText.includes(norm(c))) || CITIES.find(c => norm(userHistory).includes(norm(c)));
    if (_cn && _cityCtx) {
      const _inCity = clubKeys.filter(k => cityOf(k) === _cityCtx).sort((a, b) => shortDisplay(a).localeCompare(shortDisplay(b)));
      const _i = parseInt(_cn[1], 10);
      if (_i >= 1 && _i <= _inCity.length) { matched = [_inCity[_i - 1]]; clubJustPicked = true; }
    }
  }

  if (matched.length === 1) {
    const club = matched[0];
    const levelsObj = tree[club] || {};
    const levelNames = Object.keys(levelsObj);
    resolvedClub = club;
    // ONE ALLOWED SET (2026-09-22). The options this node puts in front of the
    // member are now handed downstream verbatim, so the outbound price gate can
    // check the reply against THE SAME rows rather than re-deriving its own.
    // It used to merge cf_clubs and cf_club_where_they_want_to_extend_at into a
    // single tree, later field winning, and those two fields disagree on 9 rows:
    // Parnassusweg HOME 1-year is EUR72 on the change form and EUR64 on the
    // extension form, so the gate believed EUR64 while this node showed EUR72 and
    // would have blocked the bot for quoting its own correct price. Same for Bos
    // en Lommer, Scheldeplein, Rozengracht and Muntgebouw.
    allowedOptions = levelsObj;
    allowedField = wantKey;
    if (levelNames.length === 1) onlyLevel = levelNames[0];
    const label = FORM_LABEL[requestType];
    const priceOf = (d) => { const m = String(d).match(/€\s*([0-9]+(?:[.,][0-9]+)?)/); return m ? parseFloat(m[1].replace(',', '.')) : null; };
    const minPrice = (durs) => { const ns = (Array.isArray(durs) ? durs : []).map(priceOf).filter((x) => x != null); return ns.length ? Math.min.apply(null, ns) : null; };
    // Display formatter: normalise the inconsistent Freshdesk term labels into
    // "<duration>: €<price> per 4 weeks". Uses ONLY the € amount already in the
    // field (no invented data); a term with extra text (e.g. start-up costs) is
    // shown as-is so nothing is dropped or fabricated.
    const fmtTerm = (raw) => { const t = String(raw).trim(); const m = t.match(/^(.*?)[\s:\-]*€\s*([0-9]+(?:[.,][0-9]+)?)\s*$/); if (!m) return t; const d = m[1].replace(/[-:]+/g, ' ').replace(/\s+/g, ' ').trim(); return d + ': €' + m[2] + ' per 4 weeks'; };
    // STEP-BY-STEP PICKER (2026-08-06): ask ACCESS LEVEL first, then TERM — one short
    // numbered list per turn. The numbering is a deterministic function of the club
    // tree, so a member's numeric reply ("2") is mapped back to the concrete option
    // HERE IN CODE and handed to the model as an explicit fact (no free-text guessing).
    const umsg = String(prep.user_message || '').trim();
    const nm = umsg.match(/^\s*(\d{1,2})\s*[).:\-]?\s*$/);
    const pickNum = nm ? parseInt(nm[1], 10) : null;
    const draftN = norm(draftDesc);
    let chosenLevel = levelNames.find((l) => { const nl = norm(l); return nl && (draftN.includes(nl) || recentText.includes(nl)); });
    let levelJustPicked = false;
    let levelIsOnlyOption = false;
    if (!chosenLevel && !clubJustPicked && pickNum && pickNum >= 1 && pickNum <= levelNames.length) { chosenLevel = levelNames[pickNum - 1]; levelJustPicked = true; }
    // SINGLE OPTION (2026-09-03) — feedback 5e869bb2, Lowri Botham: "This is a
    // red label club so should only have the option of Premium access. The bot
    // gave premium and basic as options." Kraanspoor has exactly ONE level in
    // cf_clubs, and asking a one-answer question is what gave the model room to
    // invent a second option and then CONFIRM it when the member challenged it
    // ("Yes, Kraanspoor offers both access levels: PREMIUM and BASIC").
    // Nothing to choose — so state it instead of asking.
    if (!chosenLevel && levelNames.length === 1) { chosenLevel = levelNames[0]; levelIsOnlyOption = true; }
    const guard = '\n\nNEVER paraphrase or rename access levels (e.g. never ask "Black Label or Regular Label?" — those are club types from the club name, not access levels). Quote ONLY the options in THIS message — never reuse tiers/prices from earlier turns; they may belong to a DIFFERENT club.';
    if (!chosenLevel) {
      const lvLines = levelNames.map((l, i) => { const mp = minPrice(levelsObj[l]); return '  ' + (i + 1) + ')  ' + l + (mp != null ? ('  — from €' + mp + ' per 4 weeks') : ''); });
      optionsBlock = '📝 Which membership would you like at ' + club + '?\n\n' + lvLines.join('\n') + '\n\nReply with the number or the name.';
      text = label + ' — STEP 1 of 2 (ACCESS LEVEL). Present the block below EXACTLY as your 📝 question — verbatim, keep the numbering — and ask ONLY which access level. Do NOT list terms/durations yet. When the member replies (a number or a name), record that access level; its terms appear in your next turn.\n\n📝 Which membership would you like at ' + club + '?\n\n' + lvLines.join('\n') + '\n\nReply with the number or the name.' + guard;
    } else {
      const durs = Array.isArray(levelsObj[chosenLevel]) ? levelsObj[chosenLevel] : [];
      let chosenTerm = null;
      if (!levelJustPicked && pickNum && pickNum >= 1 && pickNum <= durs.length) chosenTerm = durs[pickNum - 1];
      if (!chosenTerm) chosenTerm = durs.find((d) => { const nd = norm(d); return nd && draftN.includes(nd); });
      if (chosenTerm) {
        text = label + ' — SELECTION COMPLETE. The member chose access level "' + chosenLevel + '" and term "' + chosenTerm + '" at ' + club + '. RECORD this exact option VERBATIM in the description (access level "' + chosenLevel + '", term "' + chosenTerm + '") and proceed to the ticket preview. Do NOT ask about club, access level or term again.';
      } else {
        const dLines = durs.map((d, i) => '  ' + (i + 1) + ')  ' + fmtTerm(d));
        optionsBlock = '📝 ' + chosenLevel + ' it is — which term?\n\n' + dLines.join('\n') + '\n\nReply with the number or the term.';
        const lead = levelIsOnlyOption
          ? (club + ' offers exactly ONE access level, "' + chosenLevel + '", so there is nothing for the member to choose. Tell them plainly that this club has only that one level — do NOT ask them to pick an access level, do NOT present a list of one, and do NOT offer or invent any alternative. Record access level = "' + chosenLevel + '". Then ')
          : levelJustPicked ? ('The member selected access level "' + chosenLevel + '" — record access level = "' + chosenLevel + '". Then ')
          : '';
        text = label + ' — STEP 2 of 2 (TERM). ' + lead + 'present the block below EXACTLY as your 📝 question — verbatim, keep the numbering — and ask ONLY the contract term. Record the member\'s exact choice VERBATIM (the term text includes its price).\n\n📝 ' + chosenLevel + ' it is — which term?\n\n' + dLines.join('\n') + '\n\nReply with the number or the term.' + guard;
      }
    }
  } else if (matched.length > 1) {
    text = 'Several clubs match what the member said. Ask them to confirm which one by replying with the full club name:\n' + matched.map(k => '  - ' + k).join('\n');
  } else {
    const cityNamed = CITIES.find(c => recentText.includes(norm(c)));
    if (cityNamed) {
      const inCity = clubKeys.filter(k => cityOf(k) === cityNamed).sort((a, b) => shortDisplay(a).localeCompare(shortDisplay(b)));
      if (inCity.length > 0) {
        const clubDisplay = (k) => shortDisplay(k).replace(/\s*\(.*\)\s*$/, '').trim();
        const clubLines = inCity.map((k, i) => '  ' + (i + 1) + ')  ' + clubDisplay(k));
        text = 'CLUB PICKER — ' + cityNamed + ' (' + inCity.length + ' locations). Present the block below EXACTLY as your 📝 question — verbatim, keep the numbering, ONE location per line — and ask ONLY which location. Do NOT add prices or access levels yet, and NEVER ask "Black Label or Regular Label?" (those are internal club types, not choices); the access levels appear once the club is picked.\n\n📝 Which ' + cityNamed + ' location would you like to switch to? (reply with the number or the name)\n\n' + clubLines.join('\n');
      } else {
        text = 'No clubs found for that city. Ask the member for the club name directly.';
      }
    } else {
      text = 'CLUB NOT CHOSEN YET. Ask the member which club they want to ' + verb + '. Narrow by CITY first — offer these cities (they can also just type the club name directly' + (requestType === 'extension' ? ', or say "my current club"' : '') + '):\n' + CITIES.join(', ') + '\nAsk them to reply with a city or a club name. Do NOT list all 51 clubs.';
    }
  }
} else {
  text = '(no priced club options needed for this request type)';
}

// ---- ACCESS LEVEL VOCABULARY (2026-09-03) ----
// Feedback 5e869bb2 (invented "BASIC"), 63915903 (Sloterdijk's real HOME+ was
// dropped), e9c9548c (HOME+ wrongly said to include another Black Label club).
// Measured: 56 messages across 20 sessions between 5 Aug and 2 Sep presented an
// access level that does not exist, and ALL 20 went through this agent. The
// failure runs both ways — invention AND omission — so the rule is "quote the
// list complete", not merely "do not invent". Built from the live form data so
// a genuinely new tier cannot drift out of date.
if ((requestType === 'change' || requestType === 'extension') && allLevels.length) {
  text += '\n\nACCESS LEVEL VOCABULARY — ABSOLUTE, overrides anything you think you know.'
    + '\nThe ONLY access levels that exist anywhere at TrainMore are these, spelled exactly like this:\n'
    + allLevels.map((l) => '  - ' + l).join('\n')
    + '\nThere is NO "BASIC", no "Basis", no "Standard", no "Standaard", no "Plus" and no tier of any other name. If you are about to write an access level that is not on the list above, you are inventing it — stop and use the real name.'
    + '\nEach name states its own coverage, and that is the whole truth about it: "Homeclub only" means that one club, "Homeclub + Regular Label Clubs" does NOT include Black Label clubs, and only "Homeclub + Regular & Black Label Clubs" includes Black Label. Never widen a level beyond what its own name says.'
    + '\nBlack Label / Red Label / Regular Label are CLUB types taken from the club name. They are NOT access levels: never offer them as options, never use one as an access level name, and never pair one with an invented tier.'
    + '\nWhen a club\'s options are listed for you, quote them COMPLETE — every level shown, none dropped, none added, spelling unchanged. If a club shows three levels, show all three.'
    + '\nThe member\'s CURRENT access level in the facts above is context, NOT a selectable option — never present it as a menu entry.'
    + '\nIf the member asks whether a club offers a level it does not have ("does it offer both?"), say plainly which levels that club actually has. NEVER confirm a level a club does not offer.'
    + (resolvedClub && onlyLevel ? ('\n' + resolvedClub + ' has exactly ONE access level: "' + onlyLevel + '". There is no second option to offer, mention or confirm.') : '');
}

// ---- 14-day cooling-off soft eligibility check (cancellations only) ----
// Uses contractStartDate stashed in session context at login (Magicline).
// Sessions authenticated before this field existed simply get no note (old behavior).
try {
  // Match on the member's own words + draft ONLY (recentText): the bot's reason
  // menu in history lists "14-day Cooling-off Period", which matched for EVERY
  // cancellation (bogus notes on ~215 tickets since Jul 15).
  if (requestType === 'cancellation' && /cooling ?off|bedenktijd|herroeping|14 ?(day|days|dagen|daagse)/.test(recentText)) {
    const csd = String((((sessionCtx || {}).otp_pending || {}).contractStartDate) || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(csd)) {
      const days = Math.floor((Date.now() - new Date(csd + 'T00:00:00Z').getTime()) / 86400000);
      let note;
      if (days > 14) {
        note = 'COOLING-OFF ELIGIBILITY (from Magicline — authoritative — ONLY relevant if the member THEMSELVES gave cooling-off as their cancellation reason; otherwise IGNORE this note entirely and never mention cooling-off or add any note about it): this member’s contract start date is ' + csd + ' (' + days + ' days ago), so the 14-day cooling-off window appears to have PASSED. If the member gives "14-day cooling-off period" as their cancellation reason: warmly tell them our records show their contract started ' + days + ' days ago, so that reason may not qualify — but do NOT refuse; still record their reason and continue the normal flow, and append to the description: "Note: member selected cooling-off; contract start ' + csd + ' (' + days + ' days ago) per Magicline — team to verify eligibility." Never phrase cooling-off as confirmed for this member.';
      } else {
        note = 'COOLING-OFF ELIGIBILITY (from Magicline — authoritative): this member’s contract start date is ' + csd + ' (' + days + ' days ago), so they ARE within the 14-day cooling-off window. If they choose that reason, proceed normally and include the contract start date in the description.';
      }
      text += '\n\n' + note;
    }
  }
} catch (e) {}

// ---- (2) CONSENT CHECKBOXES (required custom_checkbox fields, per form, in order) ----
const CONSENT_FORM_LABEL = {
  trainmore_general_contact: 'GENERAL CONTACT (all non-specialized requests)',
  trainmore_early_cancellation: 'EARLY CANCELLATION',
  trainmore_change_membership: 'MEMBERSHIP CHANGE',
  trainmore_membership_extension: 'MEMBERSHIP EXTENSION'
};
const consentByForm = {};
for (const r of rows) {
  if (r.field_type === 'custom_checkbox' && r.required && r.question) {
    (consentByForm[r.form_key] = consentByForm[r.form_key] || []).push({ pos: (r.position == null ? 999 : r.position), q: String(r.question).trim() });
  }
}
const consentBlocks = [];
for (const [fk, label] of Object.entries(CONSENT_FORM_LABEL)) {
  const list = (consentByForm[fk] || []).sort((a, b) => a.pos - b.pos);
  if (!list.length) continue;
  const lines = [label + ' (' + list.length + ' required, ask in this order):'];
  list.forEach((c, i) => lines.push('  ' + (i + 1) + '. "' + c.q + '"'));
  consentBlocks.push(lines.join('\n'));
}
let consent_prompts_text = consentBlocks.join('\n\n');
if (!consent_prompts_text) consent_prompts_text = '(no consent checkboxes resolved — fall back to the standard general consent: "I agree to the General Terms & Conditions, Promotional Terms, Privacy Policy, Cookie Policy and Club Rules.")';

return [{ json: { ...prep, form_options_text: text, consent_prompts_text, only_access_level: onlyLevel, resolved_club: resolvedClub, allowed_options: allowedOptions, allowed_field: allowedField, options_block: optionsBlock } }];
