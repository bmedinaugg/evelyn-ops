// Three outbound-reply guards (all fail open):
// 1) HTML sanitizer — a member screenshot (28 Jul) showed a raw "<!DOCTYPE html
//    ..." document rendered in the web chat. The bot must never emit an HTML
//    document: if the reply looks like one (upstream error page leaking through
//    a tool/HTTP error), swap in a friendly retry message.
// 2) Repeat-loop breaker — if the outgoing reply repeats one already sent in
//    this session, replace it with an honest circuit-breaker that routes the
//    member onward instead of saying the same thing again.
// 3) Internal-marker scrubber — the collection agent's escalation valve tells
//    the model to append an "ESCALATION: ..." note to the ticket DESCRIPTION,
//    and it sometimes writes it into reply_text instead. 345 messages across
//    211 sessions leaked it to members between 28 Jul and 25 Aug 2026 (~20/day
//    and rising). The prompt is now explicit about which field, but a prompt is
//    a request, not a guarantee — this strips the marker on the way out so a
//    member can never read our internal handling notes.
//
// FIX 2026-09-08: guard (2) was firing on only 19.9% of repeating sessions
// (54 of 272 since 1 Sep). Three separate causes, all fixed here:
//   a) `same >= 2` means the candidate must already match TWO earlier replies,
//      so it could only ever fire on the THIRD identical send. 203 sessions
//      repeat exactly twice and were unreachable by design — and that cohort
//      runs at 36.7% negative sentiment against an 8.8% baseline. Now fires on
//      the SECOND send for everything except ticket previews.
//   b) "Fetch Recent Bot Replies" had limit=3, so a repeat separated by any
//      other reply was invisible. Raised to 12.
//   c) The breaker's own message repeated — 20 sessions, up to 3 times. Once
//      it has fired in a session the candidate is still the same looping
//      reply, so it fired again with identical wording. It now escalates to a
//      different, terser handoff instead of saying the same thing twice.
// TICKET PREVIEWS ARE EXEMPT from (a): 12 repeated groups since 1 Sep are a
// re-shown 📋 preview, which is a legitimate flow (member sent something
// ambiguous, the draft is unchanged, so the same preview is correct). They
// keep the old third-send threshold.
// Measured dose-response, 1-8 Sep: 8.8% negative with no repeat, 36.7% at two
// identical replies, 69.6% at three or more. Replay over 3,447 real replies:
// fires on 4.4% of them, touching 82 of 681 sessions.
//
// FIX 2026-08-19: guard (2) was DEAD CODE and had never fired once in 89k
// messages. "Fetch Recent Bot Replies" is an HTTP node and n8n splits its JSON
// array response into ONE ITEM PER ROW, so $input.first().json is
// { content: '...' } — never an array — and Array.isArray(body) was always
// false, leaving `recent` permanently empty. Read $input.all() instead (still
// tolerating a wrapped-array shape in case the node config changes). The
// escalation wording is also state-aware now: telling a member in
// awaiting_email / awaiting_otp / awaiting_studio_selection* to "reply 'ticket'"
// was undeliverable — those states route to Bot — Authenticate, which cannot
// open a ticket.
const rp = $('Reply Payload').first().json;
const ctx = $('Build Context').first().json;
let recent = [];
try {
  for (const it of $input.all()) {
    const j = (it && it.json) ? it.json : {};
    const b = j.body ?? j;
    if (Array.isArray(b)) { for (const r of b) recent.push(String((r || {}).content || '')); }
    else recent.push(String(b.content || ''));
  }
} catch (e) {}
recent = recent.filter(Boolean);
const nl = (ctx.user_language || '') === 'nl';
const out = { ...rp };

const raw = String(rp.reply_text || '');
if (/<!doctype\s+html|<html[\s>]/i.test(raw)) {
  out.reply_text = nl
    ? 'Sorry — er ging zojuist iets mis aan onze kant. Kun je je vraag nog een keer sturen? Dan help ik je direct verder.'
    : 'Sorry — something went wrong on our side just now. Could you send your question once more? I’ll pick it up right away.';
  out.skip_translation = true;
  out.html_reply_sanitized = true;
  return [{ json: out, pairedItem: { item: 0 } }];
}

const normz = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const cand = normz(rp.reply_text);
const same = recent.filter((r) => { const n = normz(r); return n && cand && n === cand; }).length;

// Exact match only, deliberately. Fuzzy matching would risk suppressing a
// re-shown preview whose figures changed, and the measured opportunity is all
// in verbatim repeats anyway.
const isPreview = raw.indexOf(String.fromCodePoint(0x1F4CB)) !== -1
  || /ticket preview|ticketvoorbeeld/i.test(raw);

// Has the breaker already spoken in this session? Detected on its own opening
// words rather than a flag, because `recent` is the message log and carries no
// metadata.
const BREAKER_SIGS = [
  'i keep giving you the same answer',
  'i keep repeating myself',
  'ik blijf hetzelfde antwoord geven',
  'ik blijf mezelf herhalen',
  'i am still stuck on this',
  'ik kom hier niet verder',
];
const alreadyIntervened = recent.some((r) => {
  const n = normz(r);
  return BREAKER_SIGS.some((sig) => n.indexOf(sig) !== -1);
});

// Second identical send for ordinary replies; third for previews.
const threshold = isPreview ? 2 : 1;

if (cand.length > 60 && same >= threshold) {
  if (alreadyIntervened) {
    // Saying the same apology again is the very thing being fixed. Give the one
    // route that works from every state and stop asking them to type anything.
    out.reply_text = nl
      ? 'Ik kom hier niet verder en wil je tijd niet verder verspillen. Neem contact op via onze supportpagina — dan pakt een collega dit persoonlijk voor je op.'
      : "I am still stuck on this and I don't want to waste more of your time. Please reach us through our support page and a colleague will pick this up for you personally.";
    out.skip_translation = true;
    out.repeat_loop_intervention = true;
    out.repeat_loop_second_intervention = true;
  } else {
    const AUTH_STATES = ['awaiting_email', 'awaiting_otp', 'awaiting_studio_selection', 'awaiting_studio_selection_verified'];
    if (AUTH_STATES.includes(String(ctx.session_state || ''))) {
      // Pre-login: a ticket cannot be opened from here, so promise nothing we
      // cannot deliver and give no magic keyword — just an honest way forward.
      out.reply_text = nl
        ? 'Sorry — ik blijf hetzelfde antwoord geven en zo komen we niet verder. Even opnieuw: controleer het e-mailadres dat bij je lidmaatschap hoort (daar gaat de code naartoe, en hij belandt soms in je spam). Lukt inloggen dan nog niet, neem dan contact op via onze supportpagina — dan pakt een collega het persoonlijk voor je op.'
        : "Sorry — I keep giving you the same answer and that's getting us nowhere. Let's reset: double-check the e-mail address on your membership (that's where the code goes, and it sometimes lands in spam). If signing in still won't work, reach us through our support page and a colleague will sort it out for you personally.";
    } else {
      out.reply_text = nl
        ? "Sorry — ik blijf mezelf herhalen en dat helpt je niet. Laten we zorgen dat een echte collega je verder helpt: stuur 'ticket' en ik maak direct een supportticket aan met alles wat je al hebt verteld. Ons team reageert dan persoonlijk per e-mail."
        : "Sorry — I keep repeating myself and that's not helping you. Let's get a real colleague on this: reply 'ticket' and I'll immediately create a support ticket with everything you've told me. Our team will follow up personally by email.";
    }
    out.skip_translation = true;
    out.repeat_loop_intervention = true;
  }
}
// Guard 3: scrub internal markers. Case-SENSITIVE on purpose: the marker is
// uppercase by construction, and /i would eat ordinary prose like
// "Here's the escalation: ...". Runs last so it also covers the canned
// replies above, and before Skip Translation? so the translator never sees one.
const MARKER_RE = /(^|[\s>])(?:ESCALATION|INTERNAL NOTE|AGENT NOTE)\s*:[^\n]*/g;
const beforeScrub = String(out.reply_text || '');
const scrubbed = beforeScrub.replace(MARKER_RE, '$1').replace(/[ \t]+(\n|$)/g, '$1').trim();
if (scrubbed !== beforeScrub) {
  // If the marker was the whole reply, say the one true thing it implied.
  out.reply_text = scrubbed.length >= 20 ? scrubbed : (nl
    ? 'Dank je — ik heb dit doorgezet. Een collega neemt persoonlijk per e-mail contact met je op.'
    : "Thanks — I've passed this on. A colleague will follow up with you personally by email.");
  out.internal_marker_scrubbed = true;
}

// Guard 4: invented access levels and club labels (2026-09-08). Feedback
// 923ec980 (Nelly Palikara) and 44a2f893 (Thallia El Haddad). Session 742b7f8b
// offered "HOME (Black Label club) / REGULAR (Red Label club) / PREMIUM (Gold
// Label club)"; session 3fb2c0e8 offered "'Basic', 'Premium', or 'VIP'" and the
// invented level then reached real ticket #634927. The prompt-side rules are
// fixed too, but a prompt is a request, not a guarantee — and this vocabulary is
// a small CLOSED set, which is what makes a deterministic check possible.
// Measured before this shipped: the level/label mix-up appears in 101 assistant
// messages across 68 sessions since 15 Jul (56 of them in the week of 31 Aug
// alone); the invented "Gold Label" in 2 messages / 1 session. A bare /gold/
// regex finds 10 messages, but 8 of those are the ordinary Dutch verb "gold"
// (past tense of "gelden"), so do not measure it that way.
// WHITELIST, not a blacklist: any tier-shaped token that is not a real level is
// blocked, so a tier nobody has invented yet is still caught.
// FAILS OPEN on any error, like the three guards above.
try {
  const txt4 = String(out.reply_text || '');
  const LEVEL_CTX = /access[ -]?level|toegangsniveau|toegangs[ -]?niveau|membership level/i;
  // The closed set. Verified against bot.form_schemas (cf_clubs and
  // cf_club_where_they_want_to_extend_at) on 2026-09-08: HOME, HOME+, PREMIUM
  // plus the CITY / CITY+ variants that only Eindhoven, Rotterdam and Utrecht
  // clubs carry. Live data wins whenever an upstream node hands it over.
  let ALLOWED = ['HOME', 'HOME+', 'PREMIUM', 'CITY', 'CITY+'];
  if (Array.isArray(rp.valid_access_level_tokens) && rp.valid_access_level_tokens.length) {
    ALLOWED = rp.valid_access_level_tokens.map((x) => String(x).toUpperCase().replace(/\s+/g, ''));
  }
  // Which club labels each level's own real name legitimately mentions. Pairing
  // a level with any other label is the level/label mix-up.
  const LEVEL_LABELS = { HOME: [], 'HOME+': ['REGULAR'], PREMIUM: ['REGULAR', 'BLACK'], CITY: ['REGULAR', 'BLACK'], 'CITY+': ['REGULAR', 'BLACK'] };
  // The three real labels, plus the Dutch renderings the bot legitimately
  // produces when it translates a club name.
  const REAL_LABELS = ['BLACK', 'RED', 'REGULAR', 'ZWART', 'ZWARTE', 'ROOD', 'RODE', 'REGULIER', 'REGULIERE'];
  const norm4 = (s) => String(s || '').toUpperCase().replace(/\s+/g, '');
  const isLevel = (x) => ALLOWED.indexOf(norm4(x)) !== -1;
  let bad4 = null;
  let m4;

  // (a) Club labels are a closed set of three. "Gold Label", "Premium Label"
  //     and "Silver Label" do not exist.
  const LR4 = /\b([A-Za-z]{3,12})[ -]Labels?\b/g;
  while (bad4 === null && (m4 = LR4.exec(txt4)) !== null) {
    if (REAL_LABELS.indexOf(m4[1].toUpperCase()) === -1) bad4 = m4[1] + ' Label';
  }

  // (b) A level with a club label in brackets after it. The real level names
  //     never match this shape — their brackets always continue past
  //     "Label Clubs" — so a match is always the mix-up.
  if (bad4 === null) {
    // Anchored on the REAL level names, so naming a club with its own label
    // ("Amsterdam Oost (Black Label club)") is not mistaken for the mix-up.
    // Longest name first, and a lookahead instead of \b for the closing
    // boundary: "HOME" would otherwise win the alternation inside "HOME+" and
    // \b never matches between "+" and a space, so "HOME+ (Black Label club)"
    // slipped through until 2026-09-08.
    const PR4 = new RegExp('\\b(' + ALLOWED.slice().sort((a, b) => b.length - a.length).map((x) => x.replace('+', '\\+')).join('|')
      + ')(?=[^A-Za-z0-9+])(?:\\s+(?:[Aa]ccess[ -]?[Ll]evel|[Tt]oegangsniveau))?\\s*\\(\\s*([A-Za-z]{3,12})\\s+Labels?\\s+[Cc]lubs?\\s*\\)', 'gi');
    while (bad4 === null && (m4 = PR4.exec(txt4)) !== null) {
      const lv4 = norm4(m4[1]);
      const lb4 = m4[2].toUpperCase();
      if ((LEVEL_LABELS[lv4] || []).indexOf(lb4) === -1) bad4 = m4[1] + ' (' + m4[2] + ' Label club)';
    }
  }

  // (c) Any tier-shaped token in a reply that is about access levels.
  if (bad4 === null && LEVEL_CTX.test(txt4)) {
    // Label phrases are validated by (a); their words are labels, not tiers.
    const masked = txt4.replace(/\b[A-Za-z]{3,12}[ -]Labels?\b/g, ' ');
    // Words that are not tier names: acronyms and club words that legitimately
    // appear in caps, plus the determiners/adjectives that sit next to
    // "access level" in ordinary prose in both languages.
    const NEUTRAL = ('YES NO JA NEE OK OKE TICKET TICKETS TRAINMORE NDSM TM B2B STU EUR BTW VAT FAQ URL PDF NL EN ' +
      'AND OR THE FOR NOT ALL NEW YOU YOUR OUR MY THEIR HIS HER ITS ONE TWO WITH CLUB CLUBS GYM GYMS LABEL LABELS HOMECLUB ONLY PER ' +
      'FLEX YEAR JAAR MONTH MAAND WEEK WEKEN STUDENT CORPORATE MEMBER MEMBERS ' +
      'WHICH WHAT THIS THAT THESE THOSE ANY EACH EVERY SOME BOTH EITHER NONE ' +
      'HIGHER LOWER SAME CURRENT OTHER ANOTHER DIFFERENT AVAILABLE REQUESTED DESIRED CHOSEN SELECTED CORRECT EXACT ' +
      'SORRY PLEASE THANKS HI HELLO IF WHEN BEFORE AFTER SINCE ' +
      'WELK WELKE WAT EEN DE HET DEZE DAT DIE HUN ZIJN HAAR JE JOUW UW ONZE ELKE IEDERE ' +
      'HOGERE LAGERE HUIDIGE NIEUWE ANDERE GEWENSTE GEKOZEN JUISTE BESCHIKBARE BEDANKT HALLO ALS WANNEER VOOR NA ' +
      'AN REGARDING ABOUT GESELECTEERD GESELECTEERDE TOEGEPAST TOEGEPASTE MET ZONDER MEMBERSHIP LIDMAATSCHAP ' +
      'PROFILE PROFIEL ACCOUNT SETTINGS INSTELLINGEN APP STUDIO LOCATION LOCATIE VESTIGING CONTRACT ABONNEMENT ' +
      'ACCESSLEVEL ACCESSLEVELS TOEGANGSNIVEAU TOEGANGSNIVEAUS MEMBERSHIPLEVEL').split(' ');
    const seen4 = [];
    for (const line of masked.split('\n')) {
      if (/€|per 4 weeks|per 4 weken/.test(line)) continue;
      const lm4 = line.match(/^\s*(?:\d{1,2}\s*[).:\-]|[-*•])\s*\**\s*([A-Za-z][A-Za-z]{1,11}(?:\s[A-Z][A-Za-z]{1,10})?\+?)\**\s*(?:\(|:|—|-|$)/);
      if (!lm4) continue;
      // ALL-CAPS reads as a tier on its own; a Title-Case word only counts when
      // the line also talks about access or clubs, so a plain club shortlist
      // ("1) Oost", "2) Singel") is never mistaken for a tier list.
      if (/^[A-Z]{2,11}\+?$/.test(lm4[1]) || /access|clubs?|toegang|niveau|label/i.test(line)) seen4.push(lm4[1]);
    }
    // Quoted words only count as tiers when they come as a SERIES — "'Basic',
    // 'Premium', or 'VIP'" — which is how the model offers an invented menu. A
    // single quoted word is usually something else entirely ('ticket',
    // 'Profile', "dit") and must not trip the guard.
    const SERIES4 = /["'“‘][A-Za-z][A-Za-z]{1,11}\+?["'”’]\s*(?:,|\/|\bor\b|\bof\b|\ben\b|\band\b)[\s,]*["'“‘][A-Za-z][A-Za-z]{1,11}\+?["'”’]/;
    if (SERIES4.test(masked)) {
      const QR4 = /["'“‘]\s*([A-Za-z][A-Za-z]{1,11}\+?)\s*["'”’]/g;
      while ((m4 = QR4.exec(masked)) !== null) seen4.push(m4[1]);
    }
    const AR4 = /\b([A-Z][A-Za-z]{1,11}\+?)\s+(?:[Aa]ccess[ -]?[Ll]evel|[Tt]oegangsniveau)/g;
    while ((m4 = AR4.exec(masked)) !== null) seen4.push(m4[1]);
    // "access level: X" / "toegangsniveau = X" — value-assignment shape only,
    // so ordinary prose following the phrase cannot trigger it.
    const VR4 = /(?:[Aa]ccess[ -]?[Ll]evel|[Tt]oegangsniveau)s?\s*(?::|=)\s*["'“‘]?([A-Z][A-Za-z]{1,11}\+?)/g;
    while ((m4 = VR4.exec(masked)) !== null) seen4.push(m4[1]);
    // "your access level would become X" / "je toegangsniveau wordt X".
    const BR4 = /(?:[Aa]ccess[ -]?[Ll]evel|[Tt]oegangsniveau)s?\b[^.\n]{0,40}?\b(?:is|are|becomes?|blijft|wordt|worden)\s+["'“‘]?([A-Z][A-Za-z]{1,11}\+?)/g;
    while ((m4 = BR4.exec(masked)) !== null) seen4.push(m4[1]);
    for (const c4 of seen4) {
      if (!isLevel(c4) && NEUTRAL.indexOf(norm4(c4)) === -1) { bad4 = c4; break; }
    }
  }

  if (bad4 !== null) {
    out.reply_text = nl
      ? 'Sorry — dat ga ik even goed zeggen. Je toegangsniveau bepaalt in welke clubs je kunt sporten, niet welke faciliteiten je krijgt. HOME is alleen je eigen club, HOME+ voegt alle Regular Label clubs toe, en PREMIUM voegt de Regular en Black Label clubs toe. Niet elke club biedt elk niveau, dus laat me weten welke club je wilt — dan geef ik je precies de opties van die club.'
      : "Sorry — let me get that right. Your access level decides which clubs you can train at, not which facilities you get. HOME is your own club only, HOME+ adds all Regular Label clubs, and PREMIUM adds the Regular and Black Label clubs. Not every club offers every level, so tell me which club you'd like and I'll give you its exact options.";
    out.skip_translation = true;
    out.invented_access_level_blocked = bad4;
  }
} catch (e) {}

return [{ json: out, pairedItem: { item: 0 } }];

