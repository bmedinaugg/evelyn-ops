// Decided vs exploring — the split Esther asked for on 21 Sep:
//
//   "a distinction should be made between straight to the contact form (i.e.
//    people who already made up their mind and want to change/know the
//    process), and conversations where the member is merely trying to find out
//    what their possibilities are if they were to change."
//
// Since 7 Aug 2026 every membership-change intent is intercepted by the
// SELF-SERVICE REDIRECT in Change-Flow Guardrails and answered with the form
// link immediately — no questions, no rates, no ticket. That is right for
// someone who has decided and wrong for someone still working out whether to.
// Scenario 4a is the second conversation, and it cannot happen until the
// redirect learns the difference.
//
// DEFAULT IS 'decided', DELIBERATELY
// Unless the member says something positively hypothetical, behaviour is
// exactly what it is today. This can only ever ADD conversations that would
// have been a bare link; it cannot take the link away from anyone the current
// code would have sent it to... except when it fires, which is the point.
//
// PRECISION OVER RECALL, LEARNED THE HARD WAY
// The first version let any hypothetical marker win, including Dutch "zou" and
// English "would". Run over 30 days of real messages that hit the redirect, it
// reclassified 5.8% of sessions and most were wrong: "Ik ZOU graag willen
// upgraden" is the ordinary Dutch polite request and means decided, and
// "How much WOULD that be" appears inside plainly decided messages. It also
// caught three broken-collarbone freeze requests and an email change, because
// the redirect's own trigger is looser than membership changes.
// So: only unambiguous hypotheticals count, and an explicit decided marker WINS
// over them. Ambiguity keeps today's behaviour, which is the link.
//
// Deterministic on purpose. This chooses whether a whole conversation happens,
// so it must be readable, testable, and identical every run.

// Hypothetical framing: the member is asking about a world they have not
// chosen yet. English and Dutch, because both appear in real sessions.
// Every one of these says "I have not decided yet" on its own. Deliberately
// missing: bare "would" and bare "zou", which are polite-request forms far more
// often than hypotheticals.
const EXPLORING = [
  /\bwhat (?:would|will) happen/i,
  /\bwhat happens (?:if|when)\b/i,
  /\bwhat (?:would|will) (?:my|the) [a-z ]{0,20}(?:be|look|cost|change)\b/i,
  /\bif i (?:were|was|would)?\s*(?:to\s+)?(?:change|switch|upgrade|downgrade|move)\b/i,
  /\bdo i (?:keep|lose)\b/i,
  /\bthinking (?:about|of)\b/i,
  /\bconsidering (?:a|an|changing|switching|upgrading|downgrading|moving)\b/i,
  /\bbefore i (?:decide|commit|do|make)\b/i,
  /\bjust (?:wondering|curious|checking)\b/i,
  /\bwat gebeurt er\b/i,
  /\bwat als ik\b/i,
  /\bals ik\b[^.?!]{0,40}\b(?:wijzig|verander|overstap|upgrade|downgrade)/i,
  /\b(?:behoud|verlies) ik\b/i,
  /\boverweeg\b/i,
  /\bvoor(?:dat)? ik (?:het |dit )?(?:definitief|beslis|besluit)/i,
  /\bbenieuwd wat\b/i
];

// Committed framing: they are asking to do it, or asking how. Esther puts
// "know the process" on this side of the line explicitly.
const DECIDED = [
  /\b(?:i want to|i'd like to|i would like to|id like to|i wish to)\s+(?:change|switch|upgrade|downgrade|move|convert|cancel)\b/i,
  /\b(?:can|could|will) you\s+(?:change|switch|upgrade|downgrade|move|convert)\b/i,
  /\bplease\s+(?:change|switch|upgrade|downgrade|move|convert)\b/i,
  /\bhow (?:do|can) i\s+(?:change|switch|upgrade|downgrade|move|convert)\b/i,
  /\bwhere (?:do|can) i\s+(?:change|switch|apply|request)\b/i,
  /\bi\s+(?:want|need)\s+(?:a|an|to)\b[^.?!]{0,30}\b(?:change|upgrade|downgrade|switch)\b/i,
  /\bik wil\b[^.?!]{0,30}\b(?:wijzig\w*|verander\w*|overstap\w*|upgrade\w*|omzetten)\b/i,
  /\bhoe (?:kan|doe) ik\b[^.?!]{0,30}\b(?:wijzig\w*|verander\w*|overstap\w*)\b/i,
  /\bgraag\b[^.?!]{0,20}\b(?:wijzigen|veranderen|overstappen)\b/i
];

// THE CURRENT MESSAGE ONLY, not the history.
// Reading the history made this sticky: a member who said "thinking about" once
// stayed "exploring" for the rest of the session, even after moving on to a
// different question. Stickiness is the same failure mode that made the
// self-service link re-fire 38 times in one session (Sebastiaan E., 13 Aug).
// The question "are you asking what would happen, or asking to do it" is about
// the turn in front of us, so it is answered from that turn.
function classifyChangeIntent(userMessage) {
  const text = String(userMessage || '');
  // Decided first: an explicit request outranks a hypothetical phrase inside it.
  const decided = DECIDED.find((re) => re.test(text));
  if (decided) {
    return { intent: 'decided', matched: String(decided) };
  }
  const exploring = EXPLORING.find((re) => re.test(text));
  if (exploring) {
    return { intent: 'exploring', matched: String(exploring) };
  }
  // No signal either way: leave today's behaviour alone.
  return { intent: 'decided', matched: null };
}

if (typeof module !== 'undefined') module.exports = { classifyChangeIntent, EXPLORING, DECIDED };
