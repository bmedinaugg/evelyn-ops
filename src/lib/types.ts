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

// Board item with signed URLs resolved for its images (for rendering).
export interface BoardItemView extends BoardItem {
  images: { path: string; url: string | null }[];
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
