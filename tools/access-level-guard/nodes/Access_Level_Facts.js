// ACCESS LEVELS AND CLUBS — ground truth, prepended for every change/extension
// turn (2026-09-08). Feedback 923ec980 (Nelly Palikara) and 44a2f893 (Thallia
// El Haddad).
//
// Build Priced Options already appends an ACCESS LEVEL VOCABULARY block, added
// 3 Sep. It is real, but it never reached the model in either bad session, for
// two reasons that both live downstream of it:
//   1. SELF-SERVICE REDIRECT in Change-Flow Guardrails 2026-08-03 REPLACES
//      form_options_text outright and returns early from its own map callback,
//      so the club picker, the priced level list AND the vocabulary block are
//      all discarded. It fires on the draft description too, so once a change
//      draft exists it fires on essentially every later turn.
//   2. Change Options Briefing is prepended LAST, so it outranks the redirect
//      and still instructs "ask the access level, taken from the club options
//      below" — pointing at a list that no longer exists.
// Session 742b7f8b: "1. HOME (Black Label club) 2. REGULAR (Red Label club)
// 3. PREMIUM (Gold Label club)" at "TrainMore Amsterdam West". Session
// 3fb2c0e8: "'Basic', 'Premium', or 'VIP'" for "wibeautstraat", and real ticket
// #634927 was filed with "VIP access level".
//
// This node runs LAST in the guardrail chain, after the redirect, so nothing
// downstream can throw the block away. It is deliberately facts-only: it never
// tells the model to ask anything, so it cannot fight the redirect's
// "reply with the link and nothing else" or the briefing's flow instructions.
// Everything is derived from the live form data (bot.form_schemas via Fetch
// Form Options) so it cannot drift when a club or a tier changes.

// Rows: one item per form_schemas row. Tolerates the wrapped-array shape too —
// PostgREST array responses get split one item per row by n8n.
let rows = [];
try {
  rows = $('Fetch Form Options').all().map((i) => i.json);
  if (rows.length === 1) {
    const body = rows[0].body ?? rows[0];
    if (Array.isArray(body)) rows = body;
  }
} catch (e) {}
rows = (rows || []).filter((r) => r && r.form_key);

const prep = $('Prepare Prompt Variables').first().json;
let draftDesc = '';
try { draftDesc = ($('When Called by Parent').first().json.draft || {}).description || ''; } catch (e) {}

const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\btrainmore\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const userHistory = String(prep.history_text || '').split('\n').filter((l) => l.startsWith('User: ')).join(' ');

// ---- request type ----
// COUPLED TO "Build Priced Options" and "Change Options Briefing": a verbatim
// copy of the same classifier, kept in step deliberately. If one changes,
// change all three (suite3.js extracts this block out of each deployed body and
// asserts they agree).
const typeText = norm((draftDesc || '') + ' ' + (prep.current_draft_json || '') + ' ' + (prep.user_message || '') + ' ' + userHistory);
let requestType = 'other';
if (/extension|extend|verleng/.test(typeText)) requestType = 'extension';
else if (/cancel|opzeg/.test(typeText)) requestType = 'cancellation';
else if (/change|switch|upgrade|convert|home club|access level|wijzig|verander|overstap|thuisclub/.test(typeText)) requestType = 'change';
else if (/transfer|overzetten|overschrijven|verplaats|downgrade|ander(e)? (club|gym|vestiging)|other (club|gym)|move my (membership|contract|subscription)|red label|black label|regular label/.test(typeText)) requestType = 'change';
else if (/\b(changing|upgrading)\b(?! (room|rooms|area|areas|facility|facilities|locker|lockers|cubicle|kleedkamer))[a-z0-9 ]{0,30}\b(club|clubs|gym|gyms|membership|memberships|subscription|abonnement|lidmaatschap|home|label|labels|contract|location|studio|vestiging)\b/.test(typeText)
     || /\b(club|clubs|gym|gyms|membership|memberships|subscription|abonnement|lidmaatschap|home|label|labels|contract|location|studio|vestiging)\b[a-z0-9 ]{0,20}\b(changing|upgrading)\b(?! (room|rooms|area|areas|facility|facilities|locker|lockers|cubicle|kleedkamer))/.test(typeText)) requestType = 'change';

const CLUB_FIELD_BY_TYPE = { extension: 'cf_club_where_they_want_to_extend_at', change: 'cf_clubs' };
const wantKey = CLUB_FIELD_BY_TYPE[requestType] || null;

const row = wantKey ? rows.find((r) => r.field_key === wantKey) : null;
const tree = (row && row.options && row.options.choices) || {};
const clubKeys = Object.keys(tree);
const allLevels = [...new Set(Object.values(tree).flatMap((v) => Object.keys(v || {})))].sort();
// Leading token of each level name ("HOME+ (Homeclub + ...)" -> "HOME+"), which
// is what the model and the outbound guard actually compare against.
const levelTokens = [...new Set(allLevels.map((l) => String(l).split('(')[0].trim().replace(/\s+/g, '')).filter(Boolean))].sort();
const labels = [...new Set(clubKeys.map((k) => (String(k).match(/\(([^)]*Label)\)\s*$/) || [])[1]).filter(Boolean))].sort();

const CITIES = ['Amsterdam','Bilthoven','Bussum','Den Haag','Eindhoven','Groningen','Haarlem','Leiden','Leusden','Rotterdam','Utrecht'];
const CITIES_BY_LEN = CITIES.slice().sort((a, b) => norm(b).length - norm(a).length);
function cityOf(clubKey) { const b = norm(clubKey); for (const c of CITIES_BY_LEN) { const cn = norm(c); if (b === cn || b.startsWith(cn + ' ')) return c; } return null; }

return $input.all().map((it) => {
  const j = { ...it.json };
  j.valid_access_levels = allLevels;
  j.valid_access_level_tokens = levelTokens;
  j.valid_club_labels = labels;
  if (!wantKey || !allLevels.length) return { json: j, pairedItem: { item: 0 } };

  let t = String(j.form_options_text || '');
  const resolvedClub = String(j.resolved_club || '').trim();
  const onlyLevel = String(j.only_access_level || '').trim();
  const noRedLabelLevel = !allLevels.some((l) => /red\s*label/i.test(l));

  const parts = [];
  parts.push('ACCESS LEVELS AND CLUBS — GROUND TRUTH, ABSOLUTE. Generated from the live club data, so it is never out of date. Where anything below this block disagrees with it, this block wins. These are facts, not an instruction about what to ask — follow the flow instructions elsewhere in this prompt.');

  parts.push('WHAT AN ACCESS LEVEL IS — use this if the member asks, and they often do: an access level decides WHICH CLUBS their membership lets them train at. It has nothing to do with equipment, classes, facilities, opening hours, service or any kind of "VIP" treatment — every TrainMore club offers the same facilities. NEVER explain an access level in terms of services, amenities or perks, and never illustrate it with example tier names of your own.');

  parts.push('THE ONLY ACCESS LEVELS THAT EXIST ANYWHERE AT TRAINMORE, spelled exactly like this:\n'
    + allLevels.map((l) => '  - ' + l).join('\n')
    + '\nThe text in brackets after a name IS that level\'s coverage, complete. Never widen it, never narrow it, never restate it as something else, and never invent coverage of your own.'
    + '\nAnything not on that list is NOT an access level. There is no BASIC, Basis, Standard, Standaard, Plus, VIP, Gold, Goud, Golden, Silver, Zilver, Bronze, Brons, Platinum, Elite, Deluxe, Pro or Unlimited level, and "REGULAR", "BLACK" and "RED" are not access levels either. If you are about to write an access level that is not on the list above, you are inventing it — stop and use a real name.'
    + (noRedLabelLevel ? '\nNo access level reaches a DIFFERENT Red Label club: not one of the names above mentions Red Label.' : ''));

  parts.push('CLUB LABELS ARE NOT ACCESS LEVELS. Exactly ' + labels.length + ' club labels exist: ' + labels.join(', ') + '. A label is a property of the BUILDING and it comes from the club\'s own name. There is no Gold Label, no Silver Label and no Premium Label — those do not exist anywhere.'
    + '\nNever write an access level with a club label after it in brackets. "HOME (Black Label club)", "REGULAR (Red Label club)" and "PREMIUM (Gold Label club)" are all wrong and have all been sent to real members. A level\'s only description is the bracketed text in its own real name above.');

  parts.push('CLUB NAMES. Use club names ONLY as they appear in a list given to you in this prompt. Never assemble a club name out of the member\'s words — a member typing "amsterdam west" does not create a club called "TrainMore Amsterdam West", and "wibeautstraat" is not a club. If what they typed matches more than one real club, or none, ask which one they mean and offer the real names. Never put an invented club name in the reply, the subject or the description.');

  if (resolvedClub) {
    const lv = Object.keys(tree[resolvedClub] || {});
    parts.push('THIS MEMBER\'S CLUB IS RESOLVED: ' + resolvedClub + '. The ONLY access levels ' + resolvedClub + ' offers are:\n'
      + lv.map((l) => '  - ' + l).join('\n')
      + '\nOffer exactly these, all of them, spelled exactly like that, and nothing else. NEVER confirm a level this club does not have, even if the member names it themselves.'
      + (onlyLevel ? ('\n' + resolvedClub + ' has exactly ONE access level: "' + onlyLevel + '". There is nothing for the member to choose — state it, do not ask, and do not offer an alternative.') : ''));
  } else {
    // REMOVE THE OPPORTUNITY, not just guard it. Change Options Briefing —
    // prepended immediately before this node, and therefore the highest-priority
    // block in the prompt — tells the model to "ask ... the access level, taken
    // from the club options below" whenever it cannot yet determine which rule
    // applies. That branch has no check that a club actually resolved, so when
    // none has it points the model at a list that does not exist: the CLUB
    // PICKER / "CLUB NOT CHOSEN YET" text carries no access levels at all. Both
    // bad sessions asked for the access level before the club was pinned down
    // and then invented the answer. The sentence is deleted from the prompt here
    // and replaced with the club-first instruction, so the model is never asked
    // to answer a question we have no data for.
    // Done here rather than by re-sending that node's 25KB body: this project's
    // process rule is not to hand-transcribe a load-bearing node. Coupled to its
    // exact wording — if the rewrite stops matching, briefing_ask_level_rewritten
    // goes false while a club is unresolved, which is the drift alarm. Even then
    // the block below still carries the correct instruction and outranks it.
    const ASK_LEVEL = 'Ask ONE short question for the single missing detail — the access level, taken from the club options below — and nothing else. If the club options below show exactly ONE access level, do not ask at all: take it as given.';
    const CLUB_FIRST = 'Ask ONE short question — WHICH CLUB they want to move to — in the form the club block further down gives you (a city list, a shortlist of matching clubs, or the club name), and nothing else. Do NOT ask which access level they want, and do NOT name, list, offer or illustrate any access level: no club is resolved, so no access levels are available to you.';
    j.briefing_ask_level_rewritten = t.indexOf(ASK_LEVEL) !== -1;
    if (j.briefing_ask_level_rewritten) t = t.split(ASK_LEVEL).join(CLUB_FIRST);
    const cityNamed = CITIES.find((c) => norm(String(prep.user_message || '') + ' ' + draftDesc + ' ' + userHistory).includes(norm(c)));
    const inCity = cityNamed ? clubKeys.filter((k) => cityOf(k) === cityNamed).sort() : [];
    parts.push('NO CLUB IS RESOLVED YET, so you do NOT know which access levels apply and you must not pretend to. Do not ask which access level they want, do not list or name levels, and do not write a level into the subject or the description. Ask which club first.'
      + '\nIf the member asks what the access levels are or what one means, give the general explanation above, say plainly that which levels exist depends on the club, and ask which club they want — do not answer with a list of levels.'
      + (inCity.length ? ('\nThe real clubs in ' + cityNamed + ' are, verbatim:\n' + inCity.map((k) => '  - ' + k).join('\n')) : ''));
  }

  j.form_options_text = parts.join('\n\n') + '\n\n' + t;
  j.access_level_facts_applied = true;
  return { json: j, pairedItem: { item: 0 } };
});

