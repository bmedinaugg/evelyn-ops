// Shapes returned by the existing bot.* reporting RPCs (verified against the
// function definitions in Supabase). See db/ and the handoff doc §5.

export type Outcome =
  | "ticket_created"
  | "ticket_not_synced"
  | "abandoned_mid_ticket"
  | "auth_dropoff"
  | "chat_only";

export interface DigestStats {
  date: string;
  active_sessions: number;
  messages_total: number;
  messages_by_role: Record<string, number>;
  logins: number;
  multi_account_sessions: number;
  tickets_total: number;
  tickets_synced: number;
  tickets_by_category: Record<string, number>;
  tickets_list: { fd_id: string | null; subject: string | null }[];
  otp_sends: number;
  otp_unique_emails: number;
}

export interface DigestSession {
  session_id: string;
  first_at: string; // "HH:MM" Amsterdam
  last_at: string; // "HH:MM" Amsterdam
  msg_count: number;
  state: string | null;
  customer: string;
  user_sample: string | null;
  ticket: { fd_id: string | null; subject: string | null } | null;
  outcome: Outcome;
  // True when the conversation's last message is from the member — i.e. the bot
  // never produced a reply to the final turn (an "<Empty Response>" in chat).
  no_reply?: boolean;
  // True when the member thanked the bot after it had already answered at
  // least once. Computed in daily_digest_details; deliberately narrow — a short
  // closing message, never the opening turn, and not a brush-off ("thanks
  // anyway"). See the "Bot helped" page.
  thanked?: boolean;
  // True when the bot handed over a self-service form URL (membership change,
  // extension, or early cancellation). Nelly Palikara, 26 Aug: those chats
  // "didn't really solve anything, nor saved the team from a ticket" — the
  // member still files the request themselves.
  self_service_link?: boolean;
  // Substantive assistant turns: not the form link, not auth/greeting
  // boilerplate, not a closing pleasantry. Used for Nelly's exception — a chat
  // still counts if the bot actually answered something alongside the link.
  answered_count?: number;
}

export interface DigestError {
  time: string; // "HH:MM"
  workflow: string | null;
  node: string | null;
  message: string | null;
  execution_id: string | null;
}

export interface DigestDetails {
  sessions: DigestSession[];
  errors: DigestError[];
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  state_at_turn: string | null;
  at: string; // "YYYY-MM-DD HH:MM:SS" Amsterdam
}

export type FeedbackStatus = "open" | "resolved" | "dismissed";

// Claude-generated fix suggestion stored on a feedback item.
export interface AiSuggestion {
  diagnosis: string;
  fix_type:
    | "missing_faq"
    | "faq_content_fix"
    | "bot_behavior"
    | "prompt_change"
    | "no_fix_needed"
    | "other";
  suggested_action: string;
  proposed_faq: { question: string; answer: string } | null;
}

export interface ConversationFeedback {
  id: string;
  session_id: string;
  message_id: string | null;
  author_email: string;
  rating: "good" | "bad" | null;
  comment: string | null;
  tags: string[];
  detail: string | null;
  ai_suggestion: AiSuggestion | null;
  ai_suggested_at: string | null;
  status: FeedbackStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

// Consolidated inbox row: feedback plus a little conversation context.
export interface FeedbackItem extends ConversationFeedback {
  session: { id: string; customer: { display_name: string | null } | null } | null;
}

export interface TicketRow {
  id: string;
  external_ticket_id: string | null;
  session_id: string | null;
  customer_id: string | null;
  subject: string | null;
  category: string | null;
  priority: string | null;
  status: string | null;
  created_at: string;
  customer: { display_name: string | null; email: string | null } | null;
}

export interface WorkflowErrorRow {
  id: string;
  workflow_name: string | null;
  execution_id: string | null;
  node_name: string | null;
  error_message: string | null;
  created_at: string;
}

export type BoardPriority = "low" | "medium" | "high" | "urgent";
export type BoardStatus = "open" | "in_progress" | "done" | "dismissed";

export interface BoardItem {
  id: string;
  title: string;
  description: string | null;
  priority: BoardPriority;
  status: BoardStatus;
  author_email: string;
  assignee_email: string | null;
  image_paths: string[];
  created_at: string;
  updated_at: string;
}

export interface BoardComment {
  id: string;
  board_item_id: string;
  author_email: string;
  body: string | null;
  image_paths: string[];
  created_at: string;
}

// Board comment with signed URLs resolved for its images (for rendering).
export interface BoardCommentView extends BoardComment {
  images: { path: string; url: string | null }[];
}

// Board item with signed URLs resolved for its images (for rendering),
// plus its comment thread (each comment's images signed too).
export interface BoardItemView extends BoardItem {
  images: { path: string; url: string | null }[];
  comments: BoardCommentView[];
}

// A field definition from bot.form_schemas (synced from Freshdesk admin).
export type NestedChoices = Record<string, Record<string, string[]>>;

export interface FormSchemaField {
  form_key: string;
  field_key: string;
  question: string;
  field_type:
    | "custom_dropdown"
    | "custom_text"
    | "custom_checkbox"
    | "nested_field"
    | string;
  required: boolean;
  position: number;
  options: {
    choices: string[] | NestedChoices | null;
    nested_ticket_fields:
      | { name: string; level: number; label_in_portal: string | null }[]
      | null;
  } | null;
}

export type FaqStatus = "draft" | "approved" | "published" | "rejected";

export interface FaqProposal {
  id: string;
  question: string;
  suggested_answer: string | null;
  source_session_id: string | null;
  source_message_id: string | null;
  status: FaqStatus;
  author_email: string;
  reviewer_email: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RegressionFixture {
  id: string;
  key: string;
  title: string;
  description: string;
  input_payload: Record<string, unknown>;
  expected_result: Record<string, unknown>;
  created_at: string;
}

export interface RegressionRun {
  id: string;
  fixture_key: string;
  ran_by: string;
  ran_at: string;
  passed: boolean;
  actual_result: Record<string, unknown>;
  notes: string | null;
}

// A fixture plus its most recent run, for the list view.
export interface RegressionFixtureView extends RegressionFixture {
  last_run: RegressionRun | null;
}

export type TicketDraftStatus =
  | "collecting"
  | "ready_for_confirmation"
  | "submitted"
  | "abandoned";

// A ticket the bot drafted during a chat (bot.ticket_drafts). Referenced by
// bot.sessions.current_ticket_draft_id while the draft is in progress or
// awaiting confirmation.
export interface TicketDraft {
  id: string;
  session_id: string;
  channel_user_id: string;
  customer_id: string | null;
  subject: string | null;
  description: string | null;
  category: string | null;
  priority: string | null;
  extra_fields: Record<string, unknown>;
  status: TicketDraftStatus;
  rate_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  found: boolean;
  session_id?: string;
  session?: {
    session_id: string;
    state: string | null;
    customer: string;
    customer_email: string | null;
    channel_user_id: string | null;
    last_message_at: string | null;
  };
  ticket?: {
    fd_id: string | null;
    subject: string | null;
    category: string | null;
  } | null;
  message_count?: number;
  messages?: ConversationMessage[];
}

// ---- Sentiment ------------------------------------------------------------
// Mirrors bot.sentiment_daily. `scored` / `scored_pct` are part of the row on
// purpose: a mix computed over an unknown fraction of conversations invites
// reading a sampling artefact as a trend, so coverage travels with the numbers.
export type SentimentValue =
  | "Happy"
  | "Satisfied"
  | "Neutral"
  | "Frustrated"
  | "Angry";

export interface SentimentOutcomeRow {
  outcome: string;
  scored_conversations: number;
  avg_score: number | null;
  negative: number;
  negative_pct: number | null;
}

export interface SentimentBacklogSummary {
  scored: number;
  unscored: number;
  failed: number;
}

// Conversations that went badly, measured from the transcript rather than
// judged by a model — see bot.session_friction (db/026). Counted over ALL
// conversations in the range, scored or not, because it needs no model and so
// coverage does not limit it.
export interface SentimentFriction {
  total: number;
  pct: number | null;
  loop: number;
  asked_for_human: number;
  never_answered: number;
  // Friction present, member scored Neutral or better. The case the old rubric
  // could not express: the bot failed them and they were patient about it.
  calm_but_bad: number;
}

export interface SentimentMetrics {
  from: string;
  to: string;
  conversations: number;
  scored: number;
  scored_pct: number | null;
  avg_score: number | null;
  counts: Record<SentimentValue, number>;
  negative: number;
  negative_pct_of_scored: number | null;
  // Size of the default triage list — the true union of negative sentiment and
  // friction. Not `negative + friction.calm_but_bad`, which undercounts by the
  // friction rows that have no sentiment score yet.
  triage_total: number;
  friction: SentimentFriction;
  low_confidence: number;
  unscored: number;
  failed: number;
  by_outcome: SentimentOutcomeRow[];
}

export interface SentimentConversationRow {
  session_id: string;
  day: string;
  member: string | null;
  // Null when the conversation is on the list for friction alone and the
  // scorer has not reached it yet — friction needs no model, so it can surface
  // a chat before there is any sentiment to show.
  sentiment: SentimentValue | null;
  score: number | null;
  confidence: string | null;
  rationale: string | null;
  pushed_ticket_id: string | null;
  has_feedback: boolean;
  // Any of 'loop' | 'asked_for_human' | 'never_answered'; empty when clean.
  friction: string[];
  // How many times the most-repeated bot reply was sent, 0 when not looping.
  repeated_max: number;
}

// ---- Scenario library -----------------------------------------------------

export interface ScenarioExample {
  text: string;
  session_id: string;
  at: string;
}

// A subject the recogniser catches but does not mean. `pct` is of the
// scenario's own matches, and is a floor: the probes are narrow on purpose.
export interface ScenarioMisfire {
  label: string;
  why: string;
  messages: number;
  pct: number;
  examples: string[];
}

export interface ScenarioEntry {
  key: string;
  label: string;
  // What the recogniser means in plain language, written for Member Care.
  plain: string;
  // The live n8n node the pattern was copied out of, so a reader can go and
  // check it rather than taking this page's word for it.
  source: string;
  matches: number;
  sessions: number;
  examples: ScenarioExample[];
  misfires?: ScenarioMisfire[];
}

// Two recognisers matching the same message. `handled_as` is filled in only
// where the scenarios compete inside one first-match-wins classifier; where
// they feed different code paths there is no single winner and it stays null.
export interface ScenarioOverlap {
  a: string;
  b: string;
  messages: number;
  handled_as: string | null;
  sample: string | null;
}

export interface ScenarioLibrary {
  doc: { scenarios: ScenarioEntry[]; overlaps: ScenarioOverlap[] };
  generated_at: string;
  window_from: string | null;
  window_to: string | null;
  messages_scanned: number | null;
  age_days: number;
}

// ---- Performance scorecard (db/029, db/030) -------------------------------

// The eight deterministic defect classes. Every one is countable from the
// transcript — the only judgement in the scorecard is "did the bot answer?",
// settled once in bot.is_substantive_answer against a labelled template table.
export type DefectClass =
  | "no_answer"
  | "loop"
  | "asked_for_human"
  | "auth_deadend"
  | "abandoned_mid_ticket"
  | "duplicate_ticket"
  | "wrong_language"
  | "link_only";

export interface DefectCount {
  class: DefectClass;
  n: number;
}

export interface PerformanceDay {
  day: string;
  conversations: number;
  clean: number;
  clean_pct: number | null;
}

export interface PerformanceMetrics {
  from: string;
  to: string;
  conversations: number;
  clean: number;
  clean_pct: number | null;
  answered: number;
  answered_pct: number | null;
  // Ranked worst-first in SQL: the order is the work queue.
  defects: DefectCount[];
  by_day: PerformanceDay[];
  last_computed: string | null;
}

export interface DefectConversationRow {
  session_id: string;
  day: string;
  member: string | null;
  user_msgs: number;
  answers: number;
  defects: DefectClass[];
  repeated_max: number;
  sentiment: string | null;
  has_feedback: boolean;
  first_user_message: string | null;
}

// Before/after for one shipped fix. `control_delta_pp` is the movement in every
// OTHER defect class over the same two windows, and it is the reason this table
// can be trusted: a target that falls while the control holds is the only shape
// that supports a causal claim on a live system.
export interface ChangeImpactRow {
  id: string;
  title: string;
  shipped_at: string;
  target_defect: DefectClass;
  before_conversations: number;
  after_conversations: number;
  before_rate: number | null;
  after_rate: number | null;
  delta_pp: number | null;
  control_before: number | null;
  control_after: number | null;
  control_delta_pp: number | null;
  verdict: string;
}

// Recall of the scorecard against Member Care's manual ratings. Surfaced on
// the page on purpose: the misses are wrong-but-fluent answers, which no
// structural rule can catch, so the clean rate must never be read as quality.
export interface ScorecardValidation {
  bad_labelled: number;
  bad_in_window: number;
  bad_caught: number;
  bad_recall_pct: number | null;
  good_in_window: number;
  good_scored_clean: number;
}

// ---- Case library (db/032) ------------------------------------------------

// One case Evelyn handles: what triggers it, what she does, the process, and
// the source of truth for the content. Complements the scenario library, which
// covers recognition only.
//
// The prose is hand-written from the live workflows and dated by verified_at —
// it does NOT auto-update. `measured` is recomputed on every call, and is null
// (never 0) for cases with no countable signal.
export type CaseAction =
  | "answer" | "link" | "ticket" | "process"
  | "refuse" | "handoff" | "block" | "dead_end";

export type CaseSource =
  | "club_directory" | "magicline" | "prompt" | "faq_vector"
  | "freshdesk_form" | "freshdesk_api" | "guardrail" | "database" | "none";

export interface CaseLibraryRow {
  key: string;
  sort_order: number;
  area: string;
  trigger_label: string;
  trigger_detail: string | null;
  action_type: CaseAction;
  action_summary: string;
  process_steps: string[];
  source_kind: CaseSource;
  source_detail: string | null;
  workflow: string | null;
  known_issues: string | null;
  verified_at: string;
  // How the source is kept current: what writes it, how often (verified
  // against real n8n execution history, not the schedule setting), and who can
  // change it. The owner matters most — a prompt-sourced answer cannot be
  // corrected by Member Care without a workflow edit and a publish.
  refresh_mechanism: string | null;
  refresh_cadence: string | null;
  refresh_owner: string | null;
  measured: number | null;
  measured_label: string | null;
}
