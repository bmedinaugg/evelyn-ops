// Labels shared by the Cases list, the case page and the propose form on a
// conversation. One copy, so the badge a reviewer learns on the list is the
// badge they see everywhere else.
import type {
  CaseAction,
  CaseSource,
  CaseProposalKind,
  CaseProposalStatus,
} from "@/lib/types";

// Areas in the order a conversation travels through them, not alphabetically.
export const AREAS = [
  "Pre-login",
  "Authentication",
  "Account questions",
  "Self-service redirect",
  "Ticketing",
  "Guardrails",
  "Dead ends",
] as const;

export const ACTION: Record<CaseAction, { label: string; badge: string; what: string }> = {
  answer:   { label: "answers",        badge: "green", what: "States a fact from a source." },
  link:     { label: "sends a link",   badge: "blue",  what: "Hands over a URL and stops. The member still does the work." },
  ticket:   { label: "files a ticket", badge: "amber", what: "Collects details and creates a Freshdesk ticket." },
  process:  { label: "runs a process", badge: "blue",  what: "Performs a real action, including the one write it can make to member data." },
  refuse:   { label: "declines",       badge: "grey",  what: "Says it cannot help with this, on purpose." },
  handoff:  { label: "hands off",      badge: "amber", what: "Routes to a human or captures a lead." },
  block:    { label: "guardrail",      badge: "red",   what: "Overrides what the model would otherwise have said." },
  dead_end: { label: "dead end",       badge: "red",   what: "The member gets nothing useful." },
};

// Where the answer comes from — and, for each, what a wrong answer means in
// practice. `fix` is the line the propose form shows, because it is the
// difference between valid feedback and feedback nobody can act on.
export const SOURCE: Record<
  CaseSource,
  { label: string; badge: string; what: string; fix: string; live: boolean }
> = {
  magicline: {
    label: "Magicline, live", badge: "green", live: true,
    what: "Read from Magicline per question. Not stored anywhere in the bot.",
    fix: "If the value is wrong, it is wrong in Magicline — fix it there. Propose a change here only if the bot is misreading or misphrasing what Magicline returns.",
  },
  club_directory: {
    label: "Club directory", badge: "blue", live: false,
    what: "bot.public_locations, fed daily from the reference workbook.",
    fix: "Fix the club workbook; the bot follows the next morning. Propose a change here if the bot should say something different with the same data.",
  },
  faq_vector: {
    label: "FAQ store", badge: "blue", live: false,
    what: "The Supabase vector store: Freshdesk articles, Member Care answers and uploaded documents, rebuilt daily.",
    fix: "If an article is wrong, fix the article on the support site. Propose a change here if the bot picks the wrong article or answers when it should not.",
  },
  prompt: {
    label: "Prompt", badge: "amber", live: false,
    what: "Typed into an n8n system prompt. Member Care cannot edit it.",
    fix: "Every change here is an engineering change and a publish. Say exactly what it should say instead.",
  },
  freshdesk_form: {
    label: "Freshdesk form", badge: "grey", live: false,
    what: "A customer-facing ticket form on the support portal.",
    fix: "If the form is wrong, fix it in Freshdesk admin. Propose a change here if the bot should send a different form, or not send one.",
  },
  freshdesk_api: {
    label: "Freshdesk API", badge: "grey", live: false,
    what: "Read or written through the Freshdesk API.",
    fix: "Propose what the ticket or the reply should contain instead.",
  },
  guardrail: {
    label: "Guardrail", badge: "red", live: false,
    what: "Code injected above the prompt because wording alone did not hold.",
    fix: "An engineering change. Say what the guardrail should allow or block instead.",
  },
  database: {
    label: "Database", badge: "grey", live: false,
    what: "A bot.* table.",
    fix: "Say what the bot should do differently; where the data lives is an engineering detail.",
  },
  none: {
    label: "No source", badge: "grey", live: false,
    what: "Boilerplate, a refusal, or a failure path.",
    fix: "Say what the bot should do or say here instead of nothing.",
  },
};

export const KIND: Record<CaseProposalKind, { label: string; what: string }> = {
  wrong_fact:      { label: "Wrong fact",      what: "The answer states something untrue." },
  wrong_source:    { label: "Wrong source",    what: "The answer comes from the wrong place — e.g. a typed price where Magicline has the real one." },
  wrong_behaviour: { label: "Wrong behaviour", what: "The bot does the wrong thing: answers when it should link, files a ticket when it should answer, refuses when it should help." },
  missing:         { label: "Missing case",    what: "Members ask this and the library has no case for it." },
};

export const STATUS: Record<CaseProposalStatus, { label: string; badge: string }> = {
  open:        { label: "open",        badge: "amber" },
  accepted:    { label: "accepted",    badge: "blue" },
  implemented: { label: "implemented", badge: "green" },
  rejected:    { label: "rejected",    badge: "grey" },
  withdrawn:   { label: "withdrawn",   badge: "grey" },
};

// Which real sub-workflow "Try it" runs for a case, by area. Only areas listed
// here can be tried; the rest need a test member in Magicline first, and the
// case page says so instead of pretending.
export const TRIAL_TARGETS: Record<string, { workflowId: string; label: string; note: string }> = {
  "Pre-login": {
    workflowId: "WMN8P9ZHjgFfmxDK",
    label: "Bot - Public FAQ",
    note: "Runs the real pre-login answerer with the live club directory. Nothing about a member is read or written.",
  },
};

export const TRIAL_NOT_YET =
  "Logged-in cases read a real member from Magicline, so trying them needs a test member account first. Until then, test in the widget with your own account.";
