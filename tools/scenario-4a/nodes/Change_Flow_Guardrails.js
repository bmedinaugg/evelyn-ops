// Change-flow guardrails (member feedback 2026-08-03). Appends to form_options_text.
// (1) HOME-CLUB CHANGE keep-duration instruction now also fires for "home gym"
//     wording (the Clarify node's rule only matched "home club"), so a simple
//     club change no longer forces a brand-new contract-duration pick.
// (2) Member-claimed prices/deals are never quoted as real.
// (3) When a club has no official priced options, confirm + defer price to team.
// Reads MEMBER words + draft only (never bot turns).
let draftDesc = '';
try { draftDesc = ($('When Called by Parent').first().json.draft || {}).description || ''; } catch (e) {}

return $input.all().map((it) => {
  const j = { ...it.json };
  // AGENT / HUMAN REQUEST — ESCAPE HATCH (2026-08-19). Root cause of the repeat
  // loop found in the 5-19 Aug data: the SELF-SERVICE REDIRECT below matches on
  // draftDesc + current_draft_json too, so once a draft mentioned change/cancel/
  // extend EVERY later turn re-emitted the same form link verbatim — 81 sessions
  // in 14 days, worst 38x, including members typing "I WANT TO SPEAK TO AN AGENT"
  // five times in a row (session 0fa5a339, Ara S., 19 Aug). An explicit request
  // for a person now OUTRANKS the redirect: acknowledge, ask what they need help
  // with (once), answer it if we can, and file a ticket so a colleague follows up.
  // Member words only — never bot turns, so the bot cannot trigger itself.
  const AGENT_RE = /live\s*(chat|agent|support)|(speak|talk|spreken|praten)[^.?!]{0,30}(agent|human|persoon|person|someone|somebody|advisor|employee|colleague|medewerker|iemand|mens)|(agent|human|medewerker|iemand|mens|persoon)[^.?!]{0,20}(spreken|praten|speak|talk)|(need|want|get me|connect me|geef me|verbind)[^.?!]{0,25}(a |an |een )?(human|agent|real person|echt persoon|medewerker|mens)|real\s+(person|human)|echte?\s+(persoon|mens)|customer\s+(service|support)|klantenservice|(phone|telephone)\s+number|telefoonnummer|\/human|\/agent/i;
  const _agentRequest = AGENT_RE.test(String(j.user_message || ''));
  let _priorAgentAsks = 0;
  try {
    _priorAgentAsks = String(j.history_text || '').split('\n')
      .filter((l) => /^User:/i.test(l) && AGENT_RE.test(l)).length;
  } catch (e) {}
  // IN-PERSON REQUEST (2026-08-24, Amanda Beolchi on ticket 629763). Melissa asked
  // "Kunnen we ook iemand fysiek spreken" — can we speak to someone IN PERSON —
  // and the AGENT_RE hatch above fired, so she was told "een collega kan dit
  // persoonlijk oppakken via e-mail" and a ticket was filed summarised as "Lid
  // vraagt om fysiek contact met een collega" / "member requests physical contact
  // with a colleague". Amanda flagged the summary as wrong, and she is right twice
  // over: the phrasing is not what she asked, and the ANSWER is wrong — someone
  // asking to speak to a person face to face should simply be told yes, come to
  // the club. Detected separately from AGENT_RE so the reply can differ.
  const INPERSON_RE = /\bfysiek\w*|\bin person\b|\bin persoon\b|\bface[ -]to[ -]face\b|\blangskomen\b|\blangs komen\b|\blangsgaan\b|\blangs gaan\b|\b(op|naar|in) de club\b|\bat the (club|gym)\b|\bin de (club|sportschool)\b|\bbalie\b|\breceptie\b|\bter plaatse\b|\bpersoonlijk langs\b/i;
  const _inPerson = INPERSON_RE.test(String(j.user_message || ''));
  // APPEAL / RECONSIDER ESCAPE HATCH (2026-08-22). Elles van Geest, session
  // d838694d: she wrote "Ik had contact opgenomen of ik mijn abbonement 2 periodes
  // kon bevriezen tijdens mijn reis. Het antwoord via de chatbot was ja, nu krijg
  // ik per mail een nee. Zouden jullie dit nog eens willen overwegen? Indien dit
  // echt niet kan dan zeg ik graag mijn nieuw gesloten abbonement op". The word
  // "opzeg" tripped the SELF-SERVICE REDIRECT, so she got a bare early-cancellation
  // form link and her actual question — please reconsider the freeze — was never
  // answered. A member appealing a decision, questioning a previous answer, or
  // naming cancellation only as a CONDITIONAL fallback must never be handed a form.
  // Member words only, latest message only.
  const APPEAL_RE = /\b(heroverweeg\w*|heroverwegen|nog eens (willen )?(overwegen|bekijken)|opnieuw (overwegen|bekijken)|reconsider\w*|review (this|the|that) (decision|again)|bezwaar|afwijzing|geweigerd|afgewezen|declined|refused|denied)\b|\b(indien|als|mocht) (dit|het|dat)\b[^.?!]{0,30}\b(niet|geen)\b[^.?!]{0,20}\b(kan|kunnen|mogelijk|lukt)\b|\bif (that|this|it) (is |'s )?not possible\b|\b(ik had|we hadden) (al )?contact opgenomen\b|\b(de |the )?chatbot (zei|said|antwoord\w*)\b|\bkreeg (ik )?(per )?(e-?)?mail\b[^.?!]{0,20}\bnee\b|\bantwoord was ja\b/i;
  const _appeal = APPEAL_RE.test(String(j.user_message || ''));
  // CORPORATE CONVERSION (board item 7dbd28f1, Morgan Perry 20 Aug 2026, medium):
  // "If a member requests a change to corporate, the bot can ask if they have the
  // corporate code from their employer. If they do, they can submit the change
  // membership request form and add the code. If they dont have the code, we wont
  // be able to process the change." The Freshdesk change form backs this up: its
  // "Reason for change?" option is literally "Convert to corporate (company code
  // needed)" and "Enter Discount / Company Code" is a REQUIRED field — so the bare
  // SELF-SERVICE REDIRECT sends members to a form they cannot complete. Needs the
  // draft too, not just the latest message, because this is a 2-3 turn exchange
  // (ask → answer → link or explain) and the topic must survive those turns.
  const CORP_RE = /\b(corporate|bedrijfsfitness|bedrijfs.?fitness|bedrijfsabonnement|bedrijfscode|company.?code|corporate.?code|zakelijk\w*|werkgever|employer)\b/i;
  const CORP_VERB = /\b(convert\w*|chang\w*|switch\w*|upgrad\w*|omzetten|omzet\w*|wijzig\w*|verander\w*|overstap\w*|word(en)?|naar)\b/i;
  const _corpHay = String((j.user_message || '') + ' ' + (draftDesc || '') + ' ' + (j.current_draft_json || ''));
  // Brand read separately from the redirect's own copy below (left untouched so the
  // working redirect is not disturbed). The corporate form link is TrainMore-only,
  // so Gymbox/Clubsportive must NOT get this block — they still collect a ticket.
  let _brandLc = 'trainmore';
  try {
    const _br = $('Fetch Session Context').first().json;
    const _bb = _br.body ?? _br;
    const _bc = (Array.isArray(_bb) ? (_bb[0] || {}).context : (_bb.context ?? _bb)) || {};
    _brandLc = String(((_bc.otp_pending || _bc).brand) || 'trainmore').toLowerCase();
  } catch (e) {}
  const _corporate = CORP_RE.test(_corpHay) && CORP_VERB.test(_corpHay) && _brandLc.includes('trainmore');
  // NON-STICKY REDIRECT (2026-08-19): the redirect below used to re-fire on every
  // turn once the draft mentioned change/cancel/extend, so members who kept talking
  // got the same link back indefinitely (Sebastiaan E., 13 Aug: 38 identical link
  // replies in one session). Send the link at most ONCE per conversation; if the
  // member is still here afterwards the link clearly did not resolve it, so fall
  // through to normal ticket collection. Only the bot ever emits this URL, so its
  // presence in the history means we already sent it.
  let _linkAlreadySent = false;
  try {
    _linkAlreadySent = /support\.trainmore\.com\/[^\s)]*ticket_form=/i.test(String(j.history_text || ''));
  } catch (e) {}
  // SCENARIO 4a — EXPLORING, NOT YET DECIDED (2026-09-22).
  // Esther Rumora, 21 Sep: "a distinction should be made between straight to the
  // contact form (people who already made up their mind and want to change/know
  // the process), and conversations where the member is merely trying to find
  // out what their possibilities are if they were to change."
  // Since 7 Aug the redirect below answers BOTH with the same link. This bypass
  // is for the second group only.
  // Member's CURRENT message only: reading the history made an earlier "thinking
  // about" stick for the rest of the session, the same failure mode that sent one
  // member the identical link 38 times in August.
  // Only unambiguous hypotheticals count, and an explicit request wins over them.
  // Measured over 30 days of real messages that hit the redirect: 38 of 1,700
  // sessions (2.2%). An earlier, looser version flipped 99 and was mostly wrong —
  // Dutch "Ik ZOU graag willen upgraden" is a polite REQUEST, not a musing.
  const _4A_DECIDED = /\b(?:i want to|i'd like to|i would like to|id like to|i wish to)\s+(?:change|switch|upgrade|downgrade|move|convert|cancel)\b|\b(?:can|could|will) you\s+(?:change|switch|upgrade|downgrade|move|convert)\b|\bplease\s+(?:change|switch|upgrade|downgrade|move|convert)\b|\bhow (?:do|can) i\s+(?:change|switch|upgrade|downgrade|move|convert)\b|\bwhere (?:do|can) i\s+(?:change|switch|apply|request)\b|\bi\s+(?:want|need)\s+(?:a|an|to)\b[^.?!]{0,30}\b(?:change|upgrade|downgrade|switch)\b|\bik wil\b[^.?!]{0,30}\b(?:wijzig\w*|verander\w*|overstap\w*|upgrade\w*|omzetten)\b|\bhoe (?:kan|doe) ik\b[^.?!]{0,30}\b(?:wijzig\w*|verander\w*|overstap\w*)\b|\bgraag\b[^.?!]{0,20}\b(?:wijzigen|veranderen|overstappen)\b/i;
  const _4A_EXPLORING = /\bwhat (?:would|will) happen|\bwhat happens (?:if|when)\b|\bwhat (?:would|will) (?:my|the) [a-z ]{0,20}(?:be|look|cost|change)\b|\bif i (?:were|was|would)?\s*(?:to\s+)?(?:change|switch|upgrade|downgrade|move)\b|\bdo i (?:keep|lose)\b|\bthinking (?:about|of)\b|\bconsidering (?:a|an|changing|switching|upgrading|downgrading|moving)\b|\bbefore i (?:decide|commit|do|make)\b|\bjust (?:wondering|curious|checking)\b|\bwat gebeurt er\b|\bwat als ik\b|\bals ik\b[^.?!]{0,40}\b(?:wijzig|verander|overstap|upgrade|downgrade)|\b(?:behoud|verlies) ik\b|\boverweeg\b|\bvoor(?:dat)? ik (?:het |dit )?(?:definitief|beslis|besluit)|\bbenieuwd wat\b/i;
  const _msgNow = String(j.user_message || '');
  const _exploring = !_4A_DECIDED.test(_msgNow) && _4A_EXPLORING.test(_msgNow);

  if (!_agentRequest && !_appeal && !_corporate && !_linkAlreadySent && !_exploring) {
  // SELF-SERVICE REDIRECT (2026-08-07): TrainMore membership CHANGE / EXTENSION /
  // EARLY CANCELLATION are now handled on the support site, not by the bot. Detect
  // deterministically (brand=TrainMore + request type) and hand the member the matching
  // form link — no questions, no preview, no ticket. Other types/brands are unchanged.
    try {
      let _brand = 'trainmore';
      try { const _r = $('Fetch Session Context').first().json; const _b = _r.body ?? _r; const _c = (Array.isArray(_b) ? (_b[0] || {}).context : (_b.context ?? _b)) || {}; _brand = String(((_c.otp_pending || _c).brand) || 'trainmore').toLowerCase(); } catch (e) {}
      const _tt = String((draftDesc || '') + ' ' + (j.current_draft_json || '') + ' ' + (j.user_message || '')).toLowerCase();
      let _rt = '';
      if (/extension|extend|verleng/.test(_tt)) _rt = 'extension';
      else if (/cancel|opzeg/.test(_tt)) _rt = 'cancellation';
      else if (/change|switch|upgrade|convert|home ?club|access level|wijzig|verander|overstap|thuisclub/.test(_tt)) _rt = 'change';
      const LINKS = { change: 'https://www.support.trainmore.com/en/support/tickets/new?ticket_form=change_membership_request', extension: 'https://www.support.trainmore.com/en/support/tickets/new?ticket_form=membership_extension_request', cancellation: 'https://www.support.trainmore.com/en/support/tickets/new?ticket_form=early_cancellation_request' };
      if (_brand.includes('trainmore') && LINKS[_rt]) {
        const _label = _rt === 'change' ? 'membership change' : (_rt === 'extension' ? 'membership extension' : 'early cancellation');
        j.form_options_text = 'SELF-SERVICE REDIRECT — HIGHEST PRIORITY, overrides every other instruction below (step order, collecting details, previews, ticket creation). This is a TrainMore ' + _label + ' request, now handled on our support site — NOT by you. Do NOT ask any questions, do NOT collect club/access level/duration/reason, do NOT show a ticket preview, and do NOT create a ticket. Respond with transition "stay" and reply_text EXACTLY as below. Give the link as a clickable MARKDOWN link in the form [text](url) — the chat renders markdown, so this becomes a clickable link the member can tap without copy-pasting. You MAY translate the bracketed link text and the surrounding words into the member\'s language, but you MUST keep the [text](url) markdown format and keep the URL inside the parentheses byte-for-byte identical:\n\n"You can submit your ' + _label + ' request directly on our support page here:\n\n[Open the ' + _label + ' form](' + LINKS[_rt] + ')\n\nFill it in there and our team will take it from there. Is there anything else I can help you with?"';
        return { json: j, pairedItem: { item: 0 } };
      }
    } catch (e) {}
  }
  let t = String(j.form_options_text || '');
  const hayUser = (draftDesc + ' ' + (j.current_draft_json || '') + ' ' + (j.user_message || '')).toLowerCase();

  const homeClubChange = /(home ?club|homeclub|thuisclub|home ?gym|thuis ?gym)/.test(hayUser)
    && /(change|wijzig|switch|verander|move|verhuis|overstap|relocat)/.test(hayUser);
  if (homeClubChange && !/keep current contract duration/i.test(t)) {
    t += '\n\nHOME-CLUB CHANGE — DURATION IS OPTIONAL: the member only wants to change their home club/gym. Ask for the access level at the new club, but for the contract duration OFFER TO KEEP THEIR CURRENT DURATION as the default (e.g. "Do you want to keep your current contract duration, or pick a new one?"). Do NOT silently default to a 1-year option. If they keep it, record "Duration: keep current contract duration" and do NOT quote a price (the team applies their current terms).';
  }

  t += '\n\nMEMBER-CLAIMED PRICES & DEALS (always): a price, discount, or promo the MEMBER states (e.g. "the €62 deal", "the Red Label price") is NEVER authoritative. Do NOT quote it back, record it as the price, or put it in the preview as the price. Only € amounts written verbatim in the priced options above are real. If the member insists on a price/deal not in the priced options, record it as member-claimed and unverified (e.g. "Member states a €62 promo — unverified, team to confirm") and add "price to be confirmed by team". When priced options ARE available for the club, quote those instead of the member\'s number.';

  t += '\n\nNO OFFICIAL OPTIONS FOR THIS CLUB (always): if the priced options above do not include the club the member wants, do NOT invent access levels or prices and do NOT ask a vague open "which access level?" question. Instead confirm the club name back, tell them the exact access levels and price will be confirmed by our team, record "official priced options not found for <club> — access level/price to be confirmed by team", and continue. Never show a change/extension preview whose description lacks a verbatim priced option OR an explicit "to be confirmed by team" note.';

  // MEMBER'S CURRENT MEMBERSHIP (feedback 2026-08-05, David P.): the collection
  // agent was never given the member's own membership, so "what is my current
  // membership?" got deflected to "the team will check it". Surface it (already in
  // the session context from login) so the agent can answer directly.
  try {
    const resp = $('Fetch Session Context').first().json;
    const body = resp.body ?? resp;
    const ctx = (Array.isArray(body) ? (body[0] || {}).context : (body.context ?? body)) || {};
    const otp = (ctx && ctx.otp_pending) ? ctx.otp_pending : ctx;
    const L = [];
    if (otp.studioName) L.push('- Current home club: ' + otp.studioName);
    if (otp.rateName) L.push('- Current membership / access level: ' + otp.rateName);
    const cs = String(otp.contractStartDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cs)) L.push('- Contract start date: ' + cs);
    const ce = String(otp.contractEndDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ce)) L.push('- Current contract period ends: ' + ce + (otp.contractCancelled === true ? ' (already cancelled/ending)' : ''));
    if (otp.customerStatus) L.push('- Membership status: ' + otp.customerStatus);
    // in/out of contract (guide: OUT of contract = within ~1 month of the end date, or cancelled)
    let cstatus = '';
    if (otp.contractCancelled === true) cstatus = 'OUT OF CONTRACT (membership cancelled / ending)';
    else if (/^\d{4}-\d{2}-\d{2}$/.test(ce)) {
      const dleft = Math.floor((new Date(ce + 'T00:00:00Z').getTime() - Date.now()) / 86400000);
      cstatus = dleft <= 30 ? 'OUT OF CONTRACT (within ~1 month of the end date)' : 'IN CONTRACT';
    }
    if (cstatus) L.push('- Contract status: ' + cstatus);
    if (L.length) {
      t += '\n\n=== MEMBER\'S CURRENT MEMBERSHIP (authoritative — from Magicline at login; the member IS logged in) ===\n'
        + L.join('\n')
        + '\nIf the member asks about their OWN current membership (current club, current access level/label, contract start/end, or whether they are still in contract), ANSWER IT DIRECTLY from these facts — do NOT say you cannot help or that the team will check it. Only defer to the team for a detail not listed here. Never state or invent a PRICE for their existing contract (not on file) — only the label and dates above.';
    }
  } catch (e) {}

  // ATTACHMENT TRUTH (2026-08-24, Thallia el Haddad feedback 26e72423: "Bot
  // indicated that the member attached a proof of relocation but no document was
  // found attached to the ticket"). The agent was never told whether anything had
  // actually been uploaded, so it could assert a document had been received and
  // write "proof provided" into the ticket when nothing came through. Surface the
  // real staged uploads (Bot - Main persists them on the session) and forbid
  // claiming anything that is not listed.
  try {
    const _ar = $('Fetch Session Context').first().json;
    const _ab = _ar.body ?? _ar;
    const _ac = (Array.isArray(_ab) ? (_ab[0] || {}).context : (_ab.context ?? _ab)) || {};
    const _files = Array.isArray(_ac.staged_attachments) ? _ac.staged_attachments : [];
    t += '\n\n=== ATTACHMENTS ACTUALLY RECEIVED (authoritative — this is the real upload list, not what the member says) ===\n'
      + (_files.length
          ? ('The member HAS sent ' + _files.length + ' file(s): ' + _files.map((f) => (f && f.filename) || 'file').join(', ') + '. You may confirm these; they will be attached to the ticket automatically.')
          : 'NO file has been received in this conversation.')
      + '\nNEVER state or imply that a document, proof, screenshot or photo has been attached, received or provided unless it is listed above. If the member SAYS they sent something and nothing is listed, tell them plainly it did not come through and ask them to send it again here — do NOT record it as provided and do NOT write "proof provided" or similar in the ticket description.';
  } catch (e) {}

  // MEMBER CARE DOMAIN RULES (2026-08-05, from Esther's TrainMore support training
  // guide). Appended as an authoritative override block (same pattern as the
  // CONSENT UPDATE block). The final ticket form is also corrected downstream in
  // Bot - Ticket creation, so these govern the CONVERSATION wording.
  t += '\n\n=== MEMBER CARE DOMAIN RULES (from the TrainMore support training guide — these SUPERSEDE any conflicting request-type / disambiguation instruction above) ===\n'
    + '1) CHANGE vs EXTENSION (use "Contract status" in the member membership block above):\n'
    + '   - Switch to a DIFFERENT / named club while IN CONTRACT -> MEMBERSHIP CHANGE (not an extension); tell the member upfront that a new promotion will not be possible in this case.\n'
    + '   - Switch / renew at a DIFFERENT club while OUT OF CONTRACT -> genuine EXTENSION.\n'
    + '   - EXTEND / RENEW at the SAME (current) club -> do NOT create a ticket: point the member to the extension portal to lock it in themselves (https://trainmore.com/nl-NL/extend-your-membership/); only create a ticket if they say they cannot complete it there. Never quote extension prices in chat.\n'
    + '   - If contract status is unknown, treat a different-club switch as a CHANGE.\n'
    + '2) EARLY CANCELLATION: on your FIRST cancellation reply, include a neutral heads-up that cancelling early means forfeiting any active promotion on the membership (say it before the member commits, not after). NEVER accept X-rays / photos of an injury, or airplane / flight tickets, as proof — tell the member directly these are not accepted and point them to the valid documents instead.\n'
    + '3) INVOICE / VAT invoice / proof of payment: you MUST ask which PERIOD(S) it is for (e.g. which months) before showing the preview; never file an invoice / proof-of-payment request without a specific period.\n'
    + '4) FREEZE / IDLE PERIOD: granted for MEDICAL reasons ONLY (illness, injury, pregnancy) and always with documentation. TRAVEL IS NOT A VALID REASON — a holiday, a trip, working or studying abroad does NOT qualify, so never say the membership can be frozen for a trip and never imply the team will probably allow it. Sole exception: memberships started on or before 21 August 2023 may carry legacy travel rights, which you cannot verify — file the ticket instead of confirming or denying. Medical route: TrainMore app → Self-service > Idle Period, 1 to 6 months per 12, no retroactive freezes, frozen time is added to the term. (Member Care feedback on session d838694d: the bot told a prospect she could freeze for a 2-month trip, she joined on that basis and then had to be refused.)';

  if (_linkAlreadySent && !_agentRequest) {
    t = 'SELF-SERVICE LINK ALREADY SENT — DO NOT SEND IT AGAIN. HIGHEST PRIORITY. You already gave this member the self-service form link earlier in this conversation and they are still talking to you, so the link did not resolve their request. Do NOT repeat the link, do NOT paste the URL again, and do NOT tell them to go and fill in the form. Help them here instead: collect the details of their request normally and build a ticket so a colleague follows up by e-mail. If their latest message is only thanks / goodbye / an acknowledgement, simply respond warmly and do not re-open anything.\n\n' + t;
  }
  if (_exploring && !_agentRequest && !_appeal && !_corporate) {
    // Contract state in CODE, not left to the model. Guide: out of contract is
    // within a month of the end date. Q4 (Esther, 21 Sep): past the minimum term
    // is ALWAYS out of contract too, which the guide did not cover and which a
    // past end date is exactly. Fails open: unknown state lists both branches.
    let _cs = '';
    try {
      const _r = $('Fetch Session Context').first().json;
      const _b = _r.body ?? _r;
      const _c = (Array.isArray(_b) ? (_b[0] || {}).context : (_b.context ?? _b)) || {};
      const _o = (_c && _c.otp_pending) ? _c.otp_pending : _c;
      const _e = String(_o.contractEndDate || '').slice(0, 10);
      if (_o.contractCancelled === true) _cs = 'OUT';
      else if (/^\d{4}-\d{2}-\d{2}$/.test(_e)) {
        _cs = Math.floor((new Date(_e + 'T00:00:00Z').getTime() - Date.now()) / 86400000) < 31 ? 'OUT' : 'IN';
      }
    } catch (e) {}
    const _outcome = _cs === 'OUT'
      ? 'This member is OUT OF CONTRACT (within a month of the end date, past the minimum term, or already cancelled). A new contract would start immediately WHICHEVER WAY the move goes, upgrade or downgrade. Tell them they would also be eligible for either an extension promotion or the new-member promotion on the website — mention BOTH, not just the change itself.'
      : _cs === 'IN'
      ? 'This member is IN CONTRACT. If the move is an UPGRADE (the destination costs more): the contract end date stays the same, no new contract starts, and any active promotion is kept as-is. If it is a DOWNGRADE (the destination costs less): a new contract term starts so the end date moves, no new promotion is granted, but an existing one carries over. EXCEPTION — a downgrade that goes together with a relocation is treated like an upgrade: end date stays, promotion kept, and proof of the move is required.'
      : 'We do not know whether this member is in or out of contract, so do NOT state which applies. Give both: in contract an upgrade keeps the end date while a downgrade starts a new term, and out of contract a new contract starts either way.';
    t = 'SCENARIO 4a — THE MEMBER IS EXPLORING, NOT REQUESTING. HIGHEST PRIORITY for this turn.\n'
      + 'They are asking what WOULD happen if they changed, so they can decide whether to. They have not asked you to change anything.\n'
      + 'ABSOLUTE RULES:\n'
      + '- Do NOT answer with the self-service form link as though the question were a request. Do NOT create a ticket and do NOT show a ticket preview. This conversation produces no ticket.\n'
      + '- Answer in the conditional ("this is what would happen"), never as a confirmed outcome.\n'
      + '- NEVER state the price they pay today, even if you can see it. Quote only the NEW pricing for what they are asking about, taken verbatim from the priced options below. (Esther, 21 Sep: inform about the new pricing always, not the old, to avoid mistakes.)\n'
      + '- When they say they want to go ahead, THEN give them the membership change form as a clickable markdown link [Open the membership change form](https://www.support.trainmore.com/en/support/tickets/new?ticket_form=change_membership_request). Not before.\n'
      + '\nWHAT YOU STILL NEED, ASK ONLY WHAT IS MISSING:\n'
      + '- Which club they are considering, and which access level. Without both you cannot quote a rate, so ask rather than guess.\n'
      + '- Why they are considering it. Ask this as a PICK-LIST, not an open question: 1) I am moving / relocating  2) I want a different price  3) I want access to more (or fewer) clubs  4) I want a different home club  5) I am becoming a student  6) I have a corporate code  7) Something else.\n'
      + '\nWHAT WOULD HAPPEN:\n' + _outcome + '\n'
      + '\nIF THEY PICK RELOCATION: proof of the move is required, and say so NOW rather than after they commit. Accepted proof: a rental contract or deed in their name, a municipal registration (BRP uittreksel), or an employer letter showing the new work location.\n'
      + 'IF THEY ARE ASKING ABOUT A STUDENT OR CORPORATE CONVERSION: that is always a NEW 1-year contract whichever direction it goes, and proof is required (enrolment proof for student, the employer corporate code for corporate). A corporate code is not valid at every club and we cannot check which, so never confirm it works at a particular club — say a colleague will confirm.\n'
      + 'IF THEIR MEMBERSHIP IS THIRD-PARTY (Workit, bedrijfsfitness/corporate fitness): you cannot answer on our rules at all. The provider decides whether a change is even allowed, so tell them to check with the provider first.\n'
      + '\nThe blocks below are background facts and priced options; the rules above win.\n\n'
      + t;
  }
  if (_corporate && !_agentRequest && !_appeal && !_linkAlreadySent) {
    t = 'CORPORATE CONVERSION — HIGHEST PRIORITY for this request. This OVERRIDES the SELF-SERVICE REDIRECT: do NOT just hand over the form link.\n'
      + 'A corporate conversion CANNOT be processed without the company/corporate code issued by the member\'s employer. The change form proves it: the reason option is "Convert to corporate (company code needed)" and "Enter Discount / Company Code" is a required field, so sending someone there without a code sends them to a form they cannot finish.\n'
      + 'Work through these steps using the conversation above to see where you are:\n'
      + 'STEP 1 — if it is not yet clear whether they have the code, ask exactly ONE question: do they have the corporate code from their employer? Set transition "stay". Do NOT send the form link yet and do NOT create a ticket.\n'
      + 'STEP 2 — if they say they HAVE it (or paste it): give them the membership change form as a clickable markdown link [Open the membership change form](https://www.support.trainmore.com/en/support/tickets/new?ticket_form=change_membership_request), and tell them to choose "Convert to corporate (company code needed)" as the reason for change and enter their company code in the "Enter Discount / Company Code" field. Set transition "stay". Do NOT create a ticket.\n'
      + 'STEP 3 — if they say they do NOT have it: tell them plainly and kindly that we cannot process a corporate conversion without that code, and that they need to get it from their employer (usually HR or whoever manages the company fitness benefit) and come back once they have it. Do NOT send the form link — it cannot be completed without the code — and do NOT create a ticket.\n'
      + 'A company NAME is not a code: if they only name their employer, treat that as STEP 1 still unanswered and ask for the code itself. Never invent or guess a code.\n'
      + '\nThe blocks below are background facts only; the rules above win.\n\n'
      + t;
  }
  if (_appeal && !_agentRequest) {
    t = 'APPEAL / RECONSIDER — HIGH PRIORITY. This OVERRIDES the SELF-SERVICE REDIRECT. '
      + 'The member is questioning or appealing something they were already told, or has named cancellation only as a CONDITIONAL fallback ("if that really is not possible, then...").\n'
      + 'ABSOLUTE RULES:\n'
      + '- Do NOT send or link the self-service form, and do NOT treat a conditional "then I will cancel" as a cancellation request.\n'
      + '- Answer the QUESTION they actually asked first, using the MEMBER CARE DOMAIN RULES and member facts below. If the policy is a no, say so plainly and kindly rather than deflecting.\n'
      + '- Then build ONE ticket capturing the appeal: what they were told before, what they are asking to be reconsidered, and any deadline they mention. Put "APPEAL — member disputes a previous answer" at the start of the description so the team sees it immediately.\n'
      + '- If they mention a legal or cooling-off deadline, record it verbatim; do not compute or judge it yourself.\n'
      + '\nThe blocks below are background facts only; the rules above win.\n\n'
      + t;
  }
  if (_agentRequest) {
    const _known = /\S/.test(String(draftDesc || '').trim())
      || /"(subject|description)":\s*"[^"]+"/.test(String(j.current_draft_json || ''));
    const _insisting = _priorAgentAsks > 0;
    t = 'AGENT / HUMAN REQUEST — HIGHEST PRIORITY. This block OVERRIDES every other '
      + 'instruction in this prompt, including any SELF-SERVICE REDIRECT, the step order, '
      + 'and any "do not create a ticket" rule. The member has just asked to speak to a person'
      + (_insisting ? ' — and has already asked ' + _priorAgentAsks + ' time(s) earlier in this conversation, so do NOT stall again' : '')
      + '.\nABSOLUTE RULES:\n'
      + '- Do NOT send, repeat or link the self-service support form in this reply, and do NOT tell them to fill in a form.\n'
      + (_inPerson
          ? '- THEY ASKED TO SPEAK TO SOMEONE IN PERSON, NOT BY CHAT. The answer is YES: staff are at the club during opening hours and can help them face to face, so say that plainly and name their club from the member facts below. Do NOT steer them to e-mail as if in-person were unavailable. Never describe this as "physical contact" — the wording is "speak to someone in person at the club" / "iemand persoonlijk spreken in de club".\n'
            + '- Only file a ticket if they ALSO want a written follow-up, or if what they raised needs the team. If a visit to the club answers it, just confirm that and do NOT create a ticket. If you do file one, describe it as wanting to speak to someone in person at the club.\n'
          : '- Do NOT promise to connect them to a live agent right now and do NOT invent a phone number — real-time live chat and phone support do not exist here. Say instead, in one short sentence, that a colleague can pick this up personally by e-mail.\n')
      + '- If what they raised is something you can answer from the MEMBER\'S CURRENT MEMBERSHIP facts further down (their own club, access level, contract dates, contract status), ANSWER IT FIRST in the same reply — that is the "can we help them here" check.\n'
      + (_inPerson
          ? ''
          : (_known || _insisting
          ? '- You already know what this is about from the draft/conversation above, so do NOT make them repeat it. Summarise it back in one line, fill subject, description, category and priority from what they have already told you, and set transition "ready_for_confirmation" so the ticket goes to a colleague.\n'
          : '- Ask exactly ONE short question — what they would like to discuss / what they need help with — so you can pass it to a colleague, and set transition "stay". On their next message, file the ticket.\n'))
      + '\nThe blocks below are background facts only; the rules above win.\n\n'
      + t;
  }
  j.form_options_text = t;
  return { json: j, pairedItem: { item: 0 } };
});
