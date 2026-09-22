// MEMBERSHIP CHANGE — tell the member what THEIR options are before any ticket.
//
// Board item bc220c64 / ticket 628063. Esther Rumora, 25 Aug 2026: "the member
// should be informed before submitting the request of what the options are for
// the specific member." Bot Training Guide, Scenario 4.
//
// Session 607d8588 is the exact shape of the failure. Pien is on
// "TM RL B2C PREMIUM AMS Papaverweg" with a contract to 2026-10-19 and asked to
// move to another RED LABEL club. That is a same-level home club change: her
// contract, end date and promotion all carry over and the answer is simply
// "yes". Instead she got a ticket preview one second after login, and when she
// asked "But I'm not sure if it's possible before my contract ends" she got the
// self-service form link — twice. Nothing was ever explained to her.
//
// Everything Scenario 4 says the bot must "check itself, rather than ask" is
// already in the session context that Bot - Authenticate stashes at login:
//   rateName          "TM RL B2C PREMIUM AMS Papaverweg"
//   contractEndDate   "2026-10-19"
//   contractCancelled false
//   studioName        "TrainMore Amsterdam Papaverweg"
// Rate names are strongly structured, so access level / label / B2B / student
// are all derivable here and now, without waiting on a mapping from Member Care:
//   TM | MIG                 brand, or a migrated contract
//   RL | BL | REG            club label   (Red / Black / Regular)
//   B2C | B2B | Student      contract type
//   PREMIUM | HOME+ | HOME   access level  <- the ranking axis
//   <CITY> <club>            home club
// Checked against all 279 distinct rate names in bot.ticket_drafts: 270 carry a
// label code and 257 an access level. The 9 without are Gymbox, Clubsportive,
// UGG staff, ambassador and plus-one rows — out of scope for this guide, and
// they fall through to UNKNOWN rather than being guessed at.
//
// Prepended LAST in the guardrail chain, so it sits above the SELF-SERVICE
// REDIRECT in the 32KB node — that redirect returns early from its own map
// callback and would otherwise swallow exactly the questions this block exists
// to answer.

// CITY+ sits between HOME+ and PREMIUM: homeclub + all Regular Label clubs
// nationally + Black Label clubs in ONE city. Confirmed on the live form —
// e.g. Laan van NOI 1-year HOME+ EUR76, CITY+ EUR86, PREMIUM EUR94.
const ACCESS_RANK = { HOME: 1, 'HOME+': 2, 'CITY+': 3, PREMIUM: 4 };
const LABEL_NAME = { RL: 'Red Label', BL: 'Black Label', REG: 'Regular Label' };

let otp = {};
try {
  const resp = $('Fetch Session Context').first().json;
  const body = resp.body ?? resp;
  const ctx = (Array.isArray(body) ? (body[0] || {}).context : (body.context ?? body)) || {};
  otp = ctx.otp_pending || {};
} catch (e) {}

let draftDesc = '';
try { draftDesc = ($('When Called by Parent').first().json.draft || {}).description || ''; } catch (e) {}

// ---- request type -----------------------------------------------------------
// COUPLED TO "Build Priced Options": the three test lines below are a verbatim
// copy of the classifier there, kept in step deliberately rather than invented
// fresh. If that classifier changes, change it here too.
// Assistant turns are excluded on purpose: ticket previews and menus made every
// request classify as a cancellation once a preview had been shown.
//
// PLUS one deliberate widening, marked below. The classifier there has no word
// for "transfer", which is how ticket 628063 was missed: Pien wrote "can I
// transfer my contract ... to a new red label gym" and it fell through to
// 'other', so she got neither club options nor any explanation. 127 member
// messages in the last 30 days use transfer wording and none of the classifier's
// change words. The picker in Build Priced Options still misses those — that is
// the same root cause and is fixed separately; this node at least makes sure the
// member is told where they stand.
const prep = $('Prepare Prompt Variables').first().json;
const norm = (s) => String(s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\btrainmore\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const userLines = String(prep.history_text || '').split('\n').filter((l) => l.startsWith('User: ')).map((l) => l.slice(6));
const userHistory = userLines.join(' ');
// Newest-first: a member's LATEST statement about their access level wins over
// an earlier one, so a correction ("actually, make it premium") is respected.
const userLinesDesc = userLines.slice().reverse();
const assistantTurns = String(prep.history_text || '').split('\n').filter((l) => l.startsWith('Assistant: ')).length;
// "I want to keep the same access level" is an ANSWER, not a non-answer. Before
// this, that sentence resolved to nothing and the bot asked the question again.
const SAME_RE = /\b(keep|keeping|behoud\w*|houd\w*|same|zelfde|hetzelfde|current|huidige)\b[^.?!]{0,40}\b(access|level|niveau|toegang|membership|abonnement|lidmaatschap)\b|\b(access level|toegangsniveau|niveau)\b[^.?!]{0,40}\b(keep|behoud\w*|same|zelfde|hetzelfde|blijft?)\b/i;
const typeText = norm((draftDesc || '') + ' ' + (prep.current_draft_json || '') + ' ' + (prep.user_message || '') + ' ' + userHistory);
let requestType = 'other';
if (/extension|extend|verleng/.test(typeText)) requestType = 'extension';
else if (/cancel|opzeg/.test(typeText)) requestType = 'cancellation';
else if (/change|switch|upgrade|convert|home club|access level|wijzig|verander|overstap|thuisclub/.test(typeText)) requestType = 'change';
// the widening: transfer / move-my-membership wording, which the copy above misses
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

// ---- read the member's current position out of the rate name ---------------
const rate = String(otp.rateName || '');
const labelCode = (rate.match(/\b(RL|BL|REG)\b/i) || [])[1];
const label = labelCode ? LABEL_NAME[labelCode.toUpperCase()] : '';

let currentAccess = '';
// Magicline rate names spell this tier CITY; Freshdesk spells it CITY+. Without
// the CITY test, 58 of 4,415 authenticated sessions (1.3%) — every CITY member —
// parsed to blank, so `direction` below stayed UNKNOWN and the bot could not
// tell them whether their own move was an upgrade. Measured 22 Sep 2026; none of
// the 58 matched any other tier, so this takes nothing away from HOME/HOME+.
// Safe here because a rate name is a system string, not member prose.
if (/\bPREMIUM\b/i.test(rate)) currentAccess = 'PREMIUM';
else if (/\bHOME\s*\+/i.test(rate)) currentAccess = 'HOME+';
else if (/\bCITY\s*\+?\b/i.test(rate)) currentAccess = 'CITY+';
else if (/\bHOME\b/i.test(rate)) currentAccess = 'HOME';

const isB2B = /\bB2B\b/i.test(rate);
const isStudent = /\b(STU|student)\b/i.test(rate);
const isThirdParty = /\b(workit|bedrijfsfitness|corporate fitness)\b/i.test(rate);

// ---- contract status --------------------------------------------------------
// Scenario 4: "out of contract once they're less than one month away from that
// end date". Anything past the end date counts too.
const endISO = String(otp.contractEndDate || '').slice(0, 10);
let contractState = 'UNKNOWN';
let daysLeft = null;
if (/^\d{4}-\d{2}-\d{2}$/.test(endISO)) {
  daysLeft = Math.floor((new Date(endISO + 'T00:00:00Z').getTime() - Date.now()) / 86400000);
  contractState = daysLeft < 31 ? 'OUT' : 'IN';
}
if (String(otp.contractCancelled) === 'true') contractState = 'OUT';

// ---- what are they asking for? ---------------------------------------------
// Strip "home club" / "home gym" / "thuisclub" first: otherwise every home-club
// change reads as a request for the HOME access level.
const rawAsk = String(draftDesc || '');
function wanted(hay) {
  const h = String(hay || '')
    .replace(/\b(home|thuis)\s*(club|gym|clubs|locatie)\b/gi, ' ')
    .toLowerCase();
  // The PLUS is required here, unlike the rate-name parser above: this reads the
  // MEMBER'S words, and a bare "city" is far more often a place than a tier —
  // "What if i move to another city?" is a real message from the logs.
  if (/\bcity\s*\+/.test(h)) return 'CITY+';
  if (/\bred label\b|\bpremium\b/.test(h)) return 'PREMIUM';
  if (/\bblack label\b|\bhome\s*\+|\bhome plus\b/.test(h)) return 'HOME+';
  if (/\bregular( label)?\b|\bhome\b/.test(h)) return 'HOME';
  return '';
}

return $input.all().map((it) => {
  const j = { ...it.json };
  let t = String(j.form_options_text || '');
  const msg = String(j.user_message || '');

  // Only membership changes. Extensions, cancellations and everything else keep
  // their existing handling untouched.
  if (requestType !== 'change') return { json: j, pairedItem: { item: 0 } };

  const agentActive = t.indexOf('AGENT / HUMAN REQUEST — HIGHEST PRIORITY') !== -1;
  // STICKY TARGET (2026-09-02) — Member Care feedback 9b8e6dc9, session
  // 529a96c3 (Eneas Serrano, 29 Aug). `wanted()` used to read ONLY the latest
  // message and the draft description, while `requestType` above already reads
  // the member's whole history. Because of that asymmetry the access level
  // resolved on the turn the member typed "Premium" and un-resolved on the very
  // next "Yes", so `direction` oscillated SAME -> UNKNOWN -> SAME and the bot
  // asked for the access level five separate times in one conversation.
  // Precedence is still "latest statement wins": current message, then the
  // draft, then the member's own history newest-first. Assistant turns are
  // never read here — menus and previews would poison the match.
  let targetAccess = wanted(msg) || wanted(rawAsk);
  if (!targetAccess) {
    for (const line of userLinesDesc) { const w = wanted(line); if (w) { targetAccess = w; break; } }
  }
  if (!targetAccess && currentAccess && SAME_RE.test(msg + ' ' + userHistory)) targetAccess = currentAccess;
  // SINGLE-OPTION CLUB (2026-09-03) — feedback 5e869bb2 / 613de9a1.
  // Build Priced Options sets only_access_level when the chosen club offers
  // exactly ONE access level. In that case the member's target is not a matter
  // of preference, it is the only thing on offer, so direction is computable
  // without asking. Deliberately LAST: anything the member actually said wins.
  if (!targetAccess) targetAccess = wanted(String(j.only_access_level || ''));

  // Direction. Only computed when BOTH sides are known — never guessed.
  let direction = 'UNKNOWN';
  if (currentAccess && targetAccess) {
    const a = ACCESS_RANK[currentAccess];
    const b = ACCESS_RANK[targetAccess];
    if (b > a) direction = 'UPGRADE';
    else if (b < a) direction = 'DOWNGRADE';
    else direction = 'SAME';
  }

  // Home club change: they named a club or city other than their own, or used
  // relocation words. Only used to pick the relocation exception, so a false
  // positive on its own changes nothing unless the direction is DOWNGRADE.
  const CLUBWORDS = /\b(club|gym|locatie|location|vestiging|filiaal|branch)\b/i;
  const MOVEWORDS = /\b(transfer|move|switch|overstap\w*|verhuiz\w*|verhuis|relocat\w*|moving|verhuisd)\b/i;
  const homeClubChange = (CLUBWORDS.test(msg) && MOVEWORDS.test(msg))
    || MOVEWORDS.test(msg)
    || /\b(home ?club|thuisclub|home gym)\b/i.test(msg + ' ' + rawAsk);

  // ---- the facts block (always shown for a change) --------------------------
  const facts = [];
  facts.push('WHAT WE ALREADY KNOW ABOUT THIS MEMBER (from Magicline — authoritative). Do NOT ask them to confirm any of it, and do NOT ask them to label their own request:');
  facts.push('- Current membership: ' + (rate || 'not recorded'));
  if (currentAccess) facts.push('- Current access level: ' + currentAccess + (label ? ' (' + label + ' club)' : ''));
  else facts.push('- Current access level: NOT DERIVABLE from this membership — do not state or guess one.');
  if (otp.studioName) facts.push('- Current home club: ' + otp.studioName);
  if (contractState === 'IN') facts.push('- Contract: IN CONTRACT until ' + endISO + ' (' + daysLeft + ' days remaining).');
  else if (contractState === 'OUT') facts.push('- Contract: OUT OF CONTRACT — ' + (endISO ? ('end date ' + endISO + (daysLeft !== null && daysLeft >= 0 ? ', ' + daysLeft + ' days away' : ', already passed')) : 'cancellation registered') + '. Less than one month remains, so out-of-contract rules apply.');
  else facts.push('- Contract status: UNKNOWN — do not state whether they are in or out of contract.');
  if (isB2B) facts.push('- Membership type: B2B / corporate (resident deals follow the same rules).');
  if (isStudent) facts.push('- Membership type: STUDENT (STU).');
  if (isThirdParty) facts.push('- Membership type: third-party (Workit / bedrijfsfitness).');
  facts.push('- They are asking to move to: ' + (targetAccess ? (targetAccess + (targetAccess === currentAccess ? ' — the SAME level they already have' : '')) : 'access level not stated yet'));
  facts.push('- Direction: ' + direction + (direction === 'UNKNOWN' ? ' — NOT YET DETERMINED. Work it out from the access levels listed in the club options below once they pick a club. Never ask the member whether it is an upgrade or a downgrade, and never mention this uncertainty to them in any form.' : ''));

  // ---- the rule that applies ------------------------------------------------
  const rules = [];
  if (isThirdParty) {
    rules.push('THIRD-PARTY MEMBERSHIP. This membership is managed by an outside party (Workit / bedrijfsfitness). We generally cannot change it from our side — the member needs to arrange it with them first, because pricing differences may mean the move is not permitted at all. Tell them this plainly and do not process it as a normal membership change.');
  } else if (isB2B) {
    rules.push('B2B / CORPORATE (this also covers resident deals). A conversion like this ALWAYS means a new 1-year contract, whichever direction it goes, and proof is required — the corporate code.');
    rules.push('Tell the member their membership is a corporate one, because most do not know. Their corporate code is NOT automatically valid at every club: it has to be checked against the club they want. You cannot check that yourself — say clearly that a colleague will verify whether their code applies at the new club, and never state or imply that it does. Record in the description that the corporate code needs verifying for the requested club.');
  } else if (isStudent) {
    rules.push('STUDENT (STU) MEMBERSHIP. A conversion like this ALWAYS means a new 1-year contract, whichever direction it goes, and proof of enrolment is required.');
    rules.push('Not every club offers a student membership. You cannot check which do — so never confirm that the club they want has one. Say a colleague will confirm it, and record in the description that the student offering needs checking for the requested club.');
  } else if (contractState === 'OUT') {
    rules.push('OUT OF CONTRACT. This rule comes FIRST and replaces the upgrade/downgrade rules: a new contract starts immediately once the change is processed, whichever direction the change goes.');
    rules.push('They are also eligible for a promotion — either the extension promotion or the website promotion for new members. Mention BOTH options rather than only the change itself; a member who is not told this loses money they were entitled to.');
  } else if (contractState === 'IN' && direction === 'UPGRADE') {
    rules.push('IN CONTRACT, UPGRADE. Their contract end date stays exactly as it is and no new contract starts. Any promotion they currently have is kept as-is and carries over. Reassure them on both points — this is usually what they are worried about.');
  } else if (contractState === 'IN' && direction === 'DOWNGRADE' && homeClubChange) {
    rules.push('IN CONTRACT, DOWNGRADE THAT COMES WITH A HOME CLUB CHANGE — the relocation exception applies. It is treated like an upgrade: the contract end date stays the same and the promotion is kept as-is. Proof of relocation is required, so tell them up front that they will need to provide it.');
  } else if (contractState === 'IN' && direction === 'DOWNGRADE') {
    rules.push('IN CONTRACT, DOWNGRADE. A new contract term starts, so a new end date will apply. No NEW promotion is granted, but any promotion they currently have carries over to the new contract. Tell them all three points before they commit.');
    rules.push('If it turns out this downgrade goes together with moving to a different home club, the relocation exception applies instead — end date unchanged, promotion kept, proof of relocation required. Check whether that is the case rather than asking them to categorise their reason.');
  } else if (contractState === 'IN' && direction === 'SAME') {
    rules.push('IN CONTRACT, SAME ACCESS LEVEL — this is a home club change, not an upgrade or a downgrade. Their contract carries over: same contract, same end date, same promotion. No new contract, no new term, no new price. Say YES to them clearly and say why; this is the reassurance they are asking for.');
  }
  // INSTRUCTIONS TO THE MODEL — NOT rules for the member (2026-09-03).
  // Feedback 613de9a1, Lowri Botham: "You're all set, Andreia! 👋 You do not yet
  // know enough to state which rule applies". The UNKNOWN case used to be
  // pushed into the member-facing rules list, rendered under "THE RULE THAT
  // APPLIES — tell the member this, in their own language" — so the model told
  // them. 146 messages since 26 Aug, and translated it became a FALSE policy
  // claim: session a697a15e said "Je kunt niet naar een andere club verhuizen
  // ... totdat we weten naar welke club je wilt overstappen" four times, after
  // the member had already named the club twice.
  // Measured: only this item leaked. The facts block and the price-guard line
  // below never did — because they read as genuine member-facing content and
  // this one was a second-person instruction sitting in the wrong array.
  const modelOnly = [];
  modelOnly.push('NEVER state the new contract end date or the new price yourself — say only which rule applies. A colleague confirms the exact figures.');
  if (!rules.length) {
    modelOnly.push('You cannot yet tell which rule applies, because the target access level is still unknown. Do NOT state or imply any rule, do NOT show a ticket preview and do NOT send a form link yet.');
    modelOnly.push('Ask ONE short question for the single missing detail — the access level, taken from the club options below — and nothing else. If the club options below show exactly ONE access level, do not ask at all: take it as given.');
    modelOnly.push('NEVER tell the member that you "do not know enough", that something "cannot be determined", or that they "cannot move clubs" or "cannot change their access level" until something is confirmed. None of that is true, and none of it is theirs to read. Just ask the one question warmly.');
  }

  // ---- assemble --------------------------------------------------------------
  let block = 'MEMBERSHIP CHANGE — EXPLAIN THE OPTIONS BEFORE ANY TICKET PREVIEW.'
    + (agentActive ? '' : ' HIGHEST PRIORITY. This OVERRIDES the SELF-SERVICE REDIRECT below, including any instruction there to reply with a form link and nothing else.')
    + '\n\n' + facts.join('\n')
    + (rules.length
        ? ('\n\nTHE RULE THAT APPLIES — tell the member this, in their own language, in plain sentences:\n- ' + rules.join('\n- '))
        : '')
    + '\n\nINTERNAL — INSTRUCTIONS TO YOU, THE ASSISTANT. This section is NOT for the member: never say it, never quote it, never translate it into a sentence you send, never paraphrase it into your reply:\n- ' + modelOnly.join('\n- ');

  // ALREADY BRIEFED (2026-09-02) — Member Care feedback 9b8e6dc9.
  // The tail below used to instruct "explain the rule FIRST, before anything
  // else" on EVERY turn with no guard. When the member's reply carried no new
  // information — "Perfect", "No", "Thanks", "Yes" — the model had nothing to
  // add and the one standing instruction was to explain the rule, so it
  // re-emitted the same paragraph. 372 verbatim repeats across 261 sessions in
  // the week after this node shipped, and 50.8% of them landed straight after a
  // member message of 25 characters or fewer. In session 5b7b04e8 it even
  // overrode a real question ("are you sending me an email with the details?").
  // This is the same shape as the sticky SELF-SERVICE REDIRECT fixed on 19 Aug:
  // an instruction that is right once and wrong on every turn after it.
  // The FACTS and the RULE stay in the block — the model still needs them to
  // stay consistent — only the "explain it now" scaffolding is withdrawn.
  const alreadyBriefed = /change type\s*:/i.test(draftDesc) || assistantTurns >= 2;

  // Description-only fencing. The old step 5 handed the model the literal
  // string "Change type: to be determined" and the model said it OUT LOUD to
  // the member ("Just to confirm, the change type is to be determined") — see
  // session 529a96c3 turns 3-6. When the direction is not yet known, no
  // Change type line is emitted at all.
  const changeTypeStr = isB2B ? 'B2B'
    : isStudent ? 'STU'
    : (direction === 'DOWNGRADE' && homeClubChange) ? 'downgrade-relocation'
    : direction === 'SAME' ? 'home club change (same access level)'
    : direction === 'UNKNOWN' ? ''
    : direction.toLowerCase();
  const contractStr = contractState === 'IN' ? 'in contract until ' + endISO
    : contractState === 'OUT' ? 'out of contract'
    : 'contract status unknown';
  const descLine = changeTypeStr
    ? ('5. FOR THE TICKET DESCRIPTION ONLY — never say this to the member and never put it in reply_text: write "Change type: ' + changeTypeStr + '" plus the contract status (' + contractStr + ').')
    : ('5. FOR THE TICKET DESCRIPTION ONLY — never say this to the member and never put it in reply_text: record the contract status (' + contractStr + '). Do NOT write a "Change type:" line yet, and NEVER write or say "to be determined" anywhere — leave it out until you actually know which it is.');

  if (!agentActive && !alreadyBriefed) {
    block += '\n\nHOW TO HANDLE THIS TURN:\n'
      + '1. Explain the rule above FIRST, in your own words, before anything else. Do not open with a ticket preview and do not open with a form link. Member Care\'s complaint about this flow is precisely that members are asked to submit a request before anyone has told them what it will do to their contract.\n'
      + '2. If the member asked whether something is possible, ANSWER THAT QUESTION. "Can I move before my contract ends?" deserves yes or no with the reason, not a form.\n'
      + '3. Only then continue collecting what is still missing, and only then show the ticket preview.\n'
      + '4. If they raise a question at any later point in this conversation, answer it — do not fall back to the form link. Repeating a link at someone who has just asked a question is the single behaviour this fix exists to remove.\n'
      + descLine;
  } else if (!agentActive) {
    block += '\n\nHOW TO HANDLE THIS TURN — YOU HAVE ALREADY EXPLAINED THIS:\n'
      + '1. You have ALREADY explained the rule above earlier in this conversation. Do NOT explain it again, do NOT restate it, and do NOT open with it. The member has read it. Restating it is exactly the behaviour Member Care reported.\n'
      + '2. Reply to what the member\'s LATEST message actually says. If they asked a question — however small, e.g. "will you email me?", "how long does it take?" — ANSWER THAT QUESTION and nothing else. If they simply acknowledged you ("ok", "yes", "perfect", "thanks", "prima", "ja"), do NOT repeat yourself: take the next concrete step instead.\n'
      + '3. NEVER ask again for anything already answered — the access level, the club, the contract, or their e-mail address. They are logged in and their e-mail is already known, so never ask for it again.\n'
      + '4. If everything needed is collected, go straight to the ticket preview rather than re-confirming details they have already given.\n'
      + descLine;
  }

  block += '\n\nThe blocks below are background facts only; the rules above win.\n\n';

  j.form_options_text = block + t;
  return { json: j, pairedItem: { item: 0 } };
});
