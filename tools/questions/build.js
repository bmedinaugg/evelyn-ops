// Builds the question traces: a real member question, how Evelyn decides to
// answer it, what she reads, and how THAT got populated — back to a person.
//
//   node tools/review/pull.js        # refreshes tools/review/messages.json
//   node tools/questions/build.js    # writes tools/questions/traces.json
//
// The matchers here are OURS, not the bot's. Unlike tools/scenarios, these
// patterns were not copied out of a live node — they exist only to find real
// examples of each question and to say roughly how often it comes up. They are
// written narrow on purpose, so every count is a FLOOR rather than an estimate.
// Under-claiming beats a number a Member Care agent can disprove with one
// counter-example.
const fs = require('fs');

const MESSAGES = __dirname + '/../review/messages.json';

// ---- the seven chains ----------------------------------------------------
// Every answer the bot gives comes from one of these. The chain is ordered from
// what the bot touches first back to the person who ultimately types the words.
const CHAINS = {
  club_directory: {
    label: 'The club workbook',
    change_cost: 'nodeploy',
    reads: 'bot.public_locations',
    steps: [
      'The bot reads bot.public_locations — hours, prices and facilities per club.',
      'That is a view over bot.locations, filtered by bot.club_visibility so only clubs meant to be public are visible.',
      'bot.locations is overwritten every day at 10:00 by the n8n workflow "ugg gym data collection" (49ZyB9tbZlqK3wW9), which takes about 5 seconds.',
      'That workflow reads one spreadsheet: UGG_Gym_Data_Collection_4.xlsx.',
    ],
    ends_at: 'A person edits that workbook by hand. It is the only way to change club data — the bot has no other source.',
    caveat: 'We could not find the workbook. It is not in SharePoint under any search tried on 10 Sep 2026, so its location is configured inside the n8n node and written down nowhere. Worth pinning down.',
  },
  faq_store: {
    label: 'The FAQ store',
    change_cost: 'nodeploy',
    reads: 'public.trainmore_faqs (vector search)',
    steps: [
      'The Q&A agent searches a vector store of FAQ answers using OpenAI embeddings, and answers from what comes back.',
      'That store is rebuilt from scratch every morning at 10:00, from three feeds.',
      'Feed 1 — Freshdesk help articles published at support.trainmore.com (99 FAQs). Whatever Member Care publishes is in the bot the next morning.',
      'Feed 2 — the spreadsheet TrainMore FAQs.xlsx in OneDrive (56 FAQs). Last edited 8 April 2026.',
      'Feed 3 — bot.manual_faqs (5 FAQs), written by Member Care on 26 Aug 2026 from real tickets, for things no article covered.',
    ],
    ends_at: 'Member Care. Publishing a Freshdesk article, editing the spreadsheet, or adding a row to bot.manual_faqs all reach the bot the next morning, with no deploy.',
    caveat: 'The spreadsheet repeats articles that already sync from Freshdesk, so most answers are stored twice and retrieval can return the same one twice.',
  },
  magicline: {
    label: 'Magicline, live',
    change_cost: 'external',
    reads: 'the Magicline API, per member',
    steps: [
      'An account tool calls the Magicline API at the moment the question is asked, for that one member.',
      'Nothing is stored and nothing is cached — the answer is whatever Magicline returns at that second.',
    ],
    ends_at: 'Not ours. The answer is the record in Magicline, so if it is wrong, the membership record is wrong.',
    caveat: null,
  },
  prompt: {
    label: 'Written into a prompt',
    change_cost: 'deploy',
    reads: 'the system prompt of an n8n node',
    steps: [
      'There is no lookup. The answer is typed into the system prompt of an n8n node and the model repeats it.',
      'A developer put it there; the n8n nodes carry their date in their own name, which is the only dated record of such a change.',
    ],
    ends_at: 'Engineering. Changing this answer means editing the node and publishing the workflow.',
    caveat: 'Esther’s TrainMore NL Bot Training Guide is where these rules were agreed, but it is not connected to anything. Editing that document changes nothing until someone edits the prompt to match.',
  },
  guardrail: {
    label: 'A guardrail overrides the model',
    change_cost: 'deploy',
    reads: 'a code node that injects an instruction',
    steps: [
      'Before the model replies, a code node checks the turn and, when it matches, injects an instruction telling the model what it may and may not say.',
      'These are dated in their node names — Cancel Honesty 2026-09-04, Feedback Overrides 2026-08-26, Guardrail Patches 2026-08-26.',
      'They are deliberately narrow: the cancel guardrail fires on about 1.2% of turns, and returns its input untouched on the rest.',
    ],
    ends_at: 'Engineering. Each guardrail is code, and changing one is a deploy.',
    caveat: null,
  },
  freshdesk_form: {
    label: 'Handed to a Freshdesk form',
    change_cost: 'nodeploy',
    reads: 'a support.trainmore.com form URL',
    steps: [
      'The bot does not answer. It sends a link to a customer-facing Freshdesk form and stops.',
      'The form itself — its fields, its routing, its confirmation e-mail — is configured in Freshdesk.',
    ],
    ends_at: 'Member Care and the Freshdesk admins own the form.',
    caveat: 'The bot hardcodes the form slug in the URL, so renaming a form in Freshdesk breaks the link silently.',
  },
  ticket: {
    label: 'Filed as a ticket',
    change_cost: 'nodeploy',
    reads: 'nothing — it collects and hands over',
    steps: [
      'The bot has no answer, so it collects the details, shows a preview, and files a ticket through the Freshdesk API.',
      'Refine Group Routing in Bot - Ticket creation picks which team it lands in, first match wins.',
    ],
    ends_at: 'A Member Care agent answers it. The bot’s only decision was which queue it lands in.',
    caveat: null,
  },
};

// ---- the questions -------------------------------------------------------
// `match` finds real examples and gives a floor on how often it is asked.
// Written narrow: a miss is better than a false positive in a quote.
const QUESTIONS = [
  {
    key: 'speak_to_human', chain: 'ticket',
    question: 'Can someone from the club call me / I want to speak to a person',
    match: /\b(speak|talk|spreken|bellen|call me|contact)\b[^?]{0,40}\b(human|person|someone|somebody|iemand|medewerker|colleague|collega|agent)\b|\b(iemand|someone)\b[^?]{0,30}\b(bellen|call|contact)\b/i,
    decides: 'The collection agent has an escape hatch (AGENT_RE) that recognises a request for a person. The bot deliberately separates "can I speak to someone at the club" — answered with club opening hours — from "I want a human", which becomes a ticket.',
    caveat: 'There is no routing rule for this yet; it lands in whatever group the category implies, usually CC L1 - General.',
  },
  {
    key: 'change_membership', chain: 'freshdesk_form',
    question: 'Can I switch club, or change my membership level?',
    match: /\b(change|switch|wijzig|overstap|upgrade|downgrade|veranderen)\b[^?]{0,40}\b(membership|abonnement|club|gym|level|label|locatie|location)\b/i,
    decides: 'A request-type classifier in Bot - Ticket Collection Agent recognises a change request, then a briefing node asks for the missing detail — club first, then access level, then term — before sending the form link.',
    caveat: 'The bot recognises far more change requests than it sends form links for, so a lot of these conversations end without the member reaching the form.',
  },
  {
    key: 'cancel_membership', chain: 'freshdesk_form',
    question: 'How do I cancel my membership?',
    match: /\b(cancel|opzegg|annuleer|beeindig|beëindig|stop)\w*\b[^?]{0,30}\b(membership|abonnement|lidmaatschap|contract|subscription)\b/i,
    decides: 'Recognised narrowly: it must name a membership object, and payment, class-booking, freeze and upgrade wording are excluded so they do not read as cancellations. In-contract members are sent the early-cancellation form.',
    caveat: 'The app can take a normal notice of cancellation under Studio > Self-service; only early cancellation needs the form.',
  },
  {
    key: 'opening_hours', chain: 'club_directory',
    question: 'What are the opening hours of a club?',
    match: /\b(opening|open)\w*\s*(hours|times|tijden)\b|\bopeningstijden\b|\bhoe laat\b[^?]{0,25}\b(open|dicht|sluit)\b|\bwhat time\b[^?]{0,20}\b(open|close)\b/i,
    decides: 'Answered before login. A gate in Bot - Main reads it as a public-info question — 11+ characters, a topic keyword, and no account word like "my" or an e-mail address — so no login is asked for.',
    caveat: 'When hours are missing the bot must say it cannot look them up, never that the club is closed. Collapsing those two is the failure mode the prompt explicitly guards against.',
  },
  {
    key: 'contract_end', chain: 'magicline',
    question: 'When does my membership end, and what is my notice period?',
    match: /\b(when|wanneer|what)\b[^?]{0,30}\b(contract|membership|abonnement)\b[^?]{0,25}\b(end|expire|afloop|eindig|opzegtermijn)\b|\b(notice period|opzegtermijn|einddatum|end date)\b/i,
    decides: 'Only after the member has logged in with an e-mail code. The account tool returns the contract end date and cancellation terms for that specific membership.',
    caveat: 'The bot computes a cancel-by date from Magicline’s contractEndDate. If Magicline has the member on the wrong contract, the date the bot quotes is confidently wrong.',
  },
  {
    key: 'book_class', chain: 'faq_store',
    question: 'How do I book or cancel a class?',
    match: /\b(book|boek|reserveer|cancel|annuleer)\w*\b[^?]{0,25}\b(class|les|lesson|training|session|workout)\b/i,
    decides: 'The how-to is answered from the FAQ store, which holds published articles for booking, cancelling, the waiting list, how far ahead you can book and the no-show policy. The member’s own bookings are a separate Magicline lookup after login. A guardrail (Patch G) stops a class cancellation being read as a membership cancellation.',
    caveat: 'This is the clearest case of the duplicate-storage problem: the booking articles exist twice in the store, once from the Freshdesk sync and once from the spreadsheet.',
  },
  {
    key: 'student_discount', chain: 'prompt',
    question: 'Do you have a student rate or a discount?',
    match: /\b(student|studenten)\b[^?]{0,25}\b(discount|korting|rate|tarief|membership|abonnement|price|prijs)\b|\b(discount|korting)\b[^?]{0,20}\b(code|student|available)\b/i,
    decides: 'The pre-login prompt answers this directly and is explicitly forbidden from inventing or quoting discounts it cannot verify, so it declines rather than guesses.',
    caveat: 'The club directory holds a euro1_discount column that is deliberately withheld from the bot, because the prompt forbids stating discounts.',
  },
  {
    key: 'membership_price', chain: 'club_directory',
    question: 'How much does a membership cost at a particular club?',
    match: /\b(how much|hoeveel)\b[^?]{0,25}\b(cost|kost|is|price|prijs)\b|\b(price|prijs|tarief)\b[^?]{0,25}\b(membership|abonnement|month|maand|premium|basic)\b/i,
    decides: 'Prices are per club and per access level, read from the directory. If the club is unknown the bot asks which one rather than quoting a range.',
    caveat: 'A hardcoded price rule used to be wrong here — it claimed Amsterdam Oost was EUR 30 when the sheet said 25. It is now read per club from the directory.',
  },
  {
    key: 'day_pass', chain: 'club_directory',
    question: 'Can I buy a day pass, or try the gym first?',
    match: /\b(day ?pass|dagpas|weekpas|week ?pass|proefles|proeftraining|trial)\b/i,
    decides: 'Answered before login, per club, with the right currency. Day passes are bought at the club with a debit card and never online.',
    caveat: 'Free-trial tickets are the one thing the bot routes to a club’s own Freshdesk group rather than a central team — requested by Member Care on 20 Aug 2026.',
  },
  {
    key: 'why_charged', chain: 'magicline',
    question: 'Why was I charged, and when is my next payment?',
    match: /\b(why|waarom|what)\b[^?]{0,30}\b(charged|afgeschreven|incasso|debited|payment|betaling)\b|\b(next|volgende)\b[^?]{0,20}\b(payment|betaling|incasso)\b/i,
    decides: 'After login, the balance and transaction tools read the member’s real payment history and upcoming collection from Magicline.',
    caveat: 'The collection date cannot be changed — billing runs in 13 periods of 4 weeks — and a guardrail makes the bot say so rather than promise a change.',
  },
  {
    key: 'invoice', chain: 'ticket',
    question: 'Can I get an invoice or a payment receipt?',
    match: /\b(invoice|factuur|betaalbewijs|receipt|vat|btw)\b/i,
    decides: 'The bot cannot produce invoices. It collects the period and files a ticket, and the routing rule sends anything naming an invoice period to CC L2 - Invoices.',
    caveat: 'Without a period the request cannot be actioned, so the bot asks for one before filing.',
  },
  {
    key: 'freeze', chain: 'guardrail',
    question: 'Can I freeze or pause my membership?',
    match: /\b(freeze|bevries|pauze|pause|on hold|stilleggen|idle)\b[^?]{0,25}\b(membership|abonnement|lidmaatschap|account)\b|\b(freeze|bevriezen|pauzeren)\b/i,
    decides: 'A guardrail overrides whatever the model would otherwise say: freezing is medical only, requested through the app under Self-service > Idle Period. Travel does not qualify.',
    caveat: 'This is the rule most likely to be softened by the model if the guardrail ever stops firing, because members ask for travel freezes constantly.',
  },
  {
    key: 'facilities', chain: 'club_directory',
    question: 'Does a club have a sauna, parking, lockers or showers?',
    match: /\b(sauna|parking|parkeren|locker|kluisje|shower|douche|pilat3s|zwembad|pool)\b/i,
    decides: 'Answered before login from 25 facility columns in the club directory, per club.',
    caveat: null,
  },
  {
    key: 'membership_number', chain: 'magicline',
    question: 'What is my membership number?',
    match: /\b(membership|lidmaatschap|member|klant)\w*\s*(number|nummer|id)\b|\bmy member number\b/i,
    decides: 'Returned from Magicline after login, for the account the verified e-mail belongs to.',
    caveat: 'A member with two memberships on one e-mail has to be asked which one, which is a separate flow.',
  },
  {
    key: 'which_clubs_access', chain: 'club_directory',
    question: 'Which clubs can I get into with my membership?',
    match: /\b(which|welke|what)\b[^?]{0,25}\b(clubs?|gyms?|locaties|locations)\b[^?]{0,25}\b(access|toegang|use|gebruiken|go to|in)\b|\b(access|toegang)\b[^?]{0,25}\b(other|andere|all|alle)\b[^?]{0,15}\b(clubs?|gyms?)\b/i,
    decides: 'The club’s label (Red, Black or regular) comes from the directory; the member’s own access level comes from Magicline after login. A guardrail added on 8 Sep 2026 stops the model naming an access level or a club that is not in the data.',
    caveat: 'Before that guardrail the bot invented both — it offered a member "Basic, Premium, Home+" at a club that only sells Premium, and once confirmed a club that appeared nowhere in the request. Asking a one-answer question is what gave the model room to invent.',
  },
  {
    key: 'join', chain: 'ticket',
    question: 'I want to become a member',
    match: /\b(want to|wil|would like to)\b[^?]{0,20}\b(join|become a member|lid worden|sign up|aanmelden|inschrijven)\b|\bword lid\b/i,
    decides: 'Treated as a sales lead rather than a support question: the details are collected and the ticket is routed to Outbound.',
    caveat: null,
  },
  {
    key: 'owe_money', chain: 'magicline',
    question: 'Do I owe anything?',
    match: /\b(owe|outstanding|achterstand|openstaand|schuld|aanmaning|incassobureau|deurwaarder|debt)\b/i,
    decides: 'The balance tool reads the real outstanding amount, dunning level and debt-collection status from Magicline after login.',
    caveat: 'Wording about dunning or debt collection routes the ticket to CC L1 - Billing, but the bot does not yet route on Magicline’s own dunningLevel field.',
  },
  {
    key: 'no_show', chain: 'guardrail',
    question: 'I got a no-show warning but I was there',
    match: /\b(no.?show|niet.?komen.?opdagen)\b|\b(missed|gemist)\b[^?]{0,25}\b(class|les)\b[^?]{0,25}\b(fee|boete|charge|kosten|warning|bericht)\b/i,
    decides: 'A guardrail (ATTEND_RE) recognises an attendance dispute and stops it being handled as a booking or a payment question. The ticket is routed to CC L1 - General.',
    caveat: 'The bot cannot check whether the member actually attended — that is a Magicline record an agent has to look at — so it collects the dispute rather than resolving it.',
  },
  {
    key: 'extend', chain: 'freshdesk_form',
    question: 'I want to extend or renew my membership',
    match: /\b(extend|verleng|renew|vernieuw)\w*\b[^?]{0,25}\b(membership|abonnement|contract|subscription)\b/i,
    decides: 'Checked before "change" in the classifier, so an extension never reads as a switch. The member is sent the extension form.',
    caveat: 'Member Care has flagged the bot for raising extension requests too readily.',
  },
  {
    key: 'app_selfservice', chain: 'prompt',
    question: 'What can I do myself in the app?',
    match: /\b(in the app|in de app|via de app|via the app)\b|\b(app)\b[^?]{0,20}\b(self.?service|zelf|myself)\b/i,
    decides: 'Answered from the prompt, and deliberately precise in both directions: the app CAN take a notice of cancellation and a medical idle period; it CANNOT change home club or access level.',
    caveat: 'The failure mode here is generalising. Six pre-login replies wrongly told members a home-club change was self-service in the app before this was corrected on 6 Sep 2026.',
  },
];

// Same masking as the scenario PDF: members paste e-mail addresses, phone
// numbers and IBANs straight into the chat and it can turn up in ANY quote.
function redact(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[e-mail]')
    .replace(/\b[A-Z]{2}\d{2}[\s]?[A-Z0-9]{4}[\s]?\d{4}[\s]?\d{2,10}\b/gi, '[IBAN]')
    .replace(/(?:\+31|0031|\b0)[\s-]?(?:\d[\s-]?){8,9}\d\b/g, '[phone]')
    .replace(/\b\d{7,}\b/g, '[number]');
}

const msgs = JSON.parse(fs.readFileSync(MESSAGES, 'utf8'));
const texts = msgs.map((r) => ({
  t: String(r.content || '').replace(/\s+/g, ' ').trim(),
  s: r.session_id,
}));

// How much the member said in each session, as a stand-in for how much of a
// conversation there is to read. Used only to ORDER the candidate examples:
// a quote linking to a two-message chat is technically real and useless to
// open, so richer conversations are offered first. It never changes which
// messages matched, so the counts are unaffected.
const sessionSize = new Map();
for (const r of texts) sessionSize.set(r.s, (sessionSize.get(r.s) || 0) + 1);

const out = QUESTIONS.map((q, i) => {
  const hits = texts.filter((r) => {
    try { return q.match.test(r.t); } catch (e) { return false; }
  });
  const sessions = new Set(hits.map((r) => r.s)).size;

  // Examples: readable length, deduped, masked — and from THREE DIFFERENT
  // sessions, so the quotes are three different members rather than one member
  // rephrasing. The session id travels with each quote so a reader can open the
  // whole conversation instead of being given more of it out of context.
  const seen = new Set();
  const usedSessions = new Set();
  const examples = [];
  const exampleSessions = [];
  const ranked = hits
    .slice()
    .sort((a, b) => (sessionSize.get(b.s) || 0) - (sessionSize.get(a.s) || 0));
  for (const h of ranked) {
    const t = h.t;
    if (t.length < 15 || t.length > 120) continue;
    const k = t.toLowerCase().slice(0, 28);
    if (seen.has(k) || usedSessions.has(h.s)) continue;
    seen.add(k);
    usedSessions.add(h.s);
    examples.push(redact(t));
    exampleSessions.push(h.s);
    if (examples.length >= 3) break;
  }

  const chain = CHAINS[q.chain];
  return {
    key: q.key,
    sort_order: (i + 1) * 10,
    question: q.question,
    examples,
    example_sessions: exampleSessions,
    matched_messages: hits.length,
    matched_sessions: sessions,
    chain_key: q.chain,
    chain_label: chain.label,
    decides: q.decides,
    reads: chain.reads,
    chain_steps: chain.steps,
    ends_at: chain.ends_at,
    change_cost: chain.change_cost,
    caveat: [q.caveat, chain.caveat].filter(Boolean).join(' '),
  };
});

fs.writeFileSync(__dirname + '/traces.json', JSON.stringify({ chains: CHAINS, questions: out }, null, 2));

console.log('question'.padEnd(22), 'chain'.padEnd(16), 'msgs'.padStart(6), 'sessions'.padStart(9), ' examples');
for (const q of out) {
  console.log(q.key.padEnd(22), q.chain_key.padEnd(16),
    String(q.matched_messages).padStart(6), String(q.matched_sessions).padStart(9),
    '  ' + q.examples.length + (q.examples.length < 2 ? '  <-- THIN' : ''));
}
console.log('\nquestions:', out.length, '| chains:', Object.keys(CHAINS).length);
