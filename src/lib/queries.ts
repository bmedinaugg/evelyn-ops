import "server-only";
import { requireStaff } from "@/lib/auth";
import { dataClient } from "@/lib/supabase/data-client";
import { FEEDBACK_TAG_VALUES } from "@/lib/feedback-tags";
import {
  createFreshdeskTicket,
  searchNonMemberTickets,
  type FreshdeskSearchTicket,
} from "@/lib/freshdesk";
import { formCategory, formLabel } from "@/lib/forms";
import { env } from "@/lib/env";
import type {
  BoardComment,
  BoardCommentView,
  BoardItem,
  BoardItemView,
  BoardPriority,
  BoardStatus,
  Conversation,
  ConversationFeedback,
  DigestDetails,
  DigestStats,
  FaqProposal,
  FaqStatus,
  FeedbackItem,
  FormSchemaField,
  TicketDraft,
  TicketRow,
  WorkflowErrorRow,
} from "@/lib/types";

const BOARD_BUCKET = "board-attachments";

// Resolve short-lived signed URLs for a set of storage paths (board images).
async function signBoardImages(
  client: ReturnType<typeof dataClient>,
  paths: string[],
): Promise<{ path: string; url: string | null }[]> {
  if (!paths?.length) return [];
  const { data: signed } = await client.storage
    .from(BOARD_BUCKET)
    .createSignedUrls(paths, 3600);
  return (signed ?? []).map((s) => ({
    path: s.path ?? "",
    url: s.signedUrl ?? null,
  }));
}

// Validate + upload image files to the board bucket; returns stored paths.
async function uploadBoardImages(
  client: ReturnType<typeof dataClient>,
  files: File[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files) {
    if (!f || f.size === 0) continue;
    if (!f.type.startsWith("image/")) {
      throw new Error(`"${f.name}" is not an image.`);
    }
    if (f.size > 8 * 1024 * 1024) {
      throw new Error(`"${f.name}" is larger than 8MB.`);
    }
    const ext = (f.name.split(".").pop() || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const buffer = await f.arrayBuffer();
    const { error: upErr } = await client.storage
      .from(BOARD_BUCKET)
      .upload(path, buffer, { contentType: f.type, upsert: false });
    if (upErr) throw new Error(`image upload failed: ${upErr.message}`);
    paths.push(path);
  }
  return paths;
}

// Every export here calls requireStaff() first: no data leaves Supabase unless
// an allow-listed staff member is asking. The service-role client is only
// touched after that check passes.

export async function getDigestStats(date: string): Promise<DigestStats> {
  await requireStaff();
  const { data, error } = await dataClient().rpc("daily_digest_stats", {
    p_date: date,
  });
  if (error) throw new Error(`daily_digest_stats failed: ${error.message}`);
  return data as DigestStats;
}

export async function getDigestDetails(date: string): Promise<DigestDetails> {
  await requireStaff();
  const { data, error } = await dataClient().rpc("daily_digest_details", {
    p_date: date,
  });
  if (error) throw new Error(`daily_digest_details failed: ${error.message}`);
  return data as DigestDetails;
}

export async function getConversation(
  sessionId: string,
): Promise<Conversation> {
  await requireStaff();
  const { data, error } = await dataClient().rpc("get_conversation", {
    p_session_id: sessionId,
  });
  if (error) throw new Error(`get_conversation failed: ${error.message}`);
  return data as Conversation;
}

// --- Phase 2: team feedback (bot.conversation_feedback) --------------------

export async function listConversationFeedback(
  sessionId: string,
): Promise<ConversationFeedback[]> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("conversation_feedback")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list feedback failed: ${error.message}`);
  return (data ?? []) as ConversationFeedback[];
}

export async function createConversationFeedback(input: {
  sessionId: string;
  rating: "good" | "bad" | null;
  comment: string | null;
  tags: string[];
  detail: string | null;
}): Promise<void> {
  const staff = await requireStaff();
  const tags = input.tags.filter((t) =>
    (FEEDBACK_TAG_VALUES as readonly string[]).includes(t),
  );
  const { error } = await dataClient()
    .from("conversation_feedback")
    .insert({
      session_id: input.sessionId,
      author_email: staff.email,
      rating: input.rating,
      comment: input.comment,
      tags,
      detail: input.detail,
    });
  if (error) throw new Error(`create feedback failed: ${error.message}`);
}

export async function getFeedbackById(
  id: string,
): Promise<ConversationFeedback | null> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("conversation_feedback")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`get feedback failed: ${error.message}`);
  return (data ?? null) as ConversationFeedback | null;
}

export async function saveAiSuggestion(
  feedbackId: string,
  suggestion: unknown,
): Promise<void> {
  await requireStaff();
  const { error } = await dataClient()
    .from("conversation_feedback")
    .update({
      ai_suggestion: suggestion,
      ai_suggested_at: new Date().toISOString(),
    })
    .eq("id", feedbackId);
  if (error) throw new Error(`save suggestion failed: ${error.message}`);
}

// --- Team board (bot.board_items + Storage) --------------------------------

export async function listBoardItems(): Promise<BoardItemView[]> {
  await requireStaff();
  const client = dataClient();
  const { data, error } = await client
    .from("board_items")
    .select("*")
    .neq("status", "dismissed")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`list board items failed: ${error.message}`);

  const items = (data ?? []) as BoardItem[];

  // Fetch all comments for the listed items in one query (oldest-first), then
  // group them per item and resolve signed URLs for any comment images.
  const ids = items.map((i) => i.id);
  const commentsByItem = new Map<string, BoardCommentView[]>();
  if (ids.length) {
    const { data: cData, error: cErr } = await client
      .from("board_comments")
      .select("*")
      .in("board_item_id", ids)
      .order("created_at", { ascending: true });
    if (cErr) throw new Error(`list board comments failed: ${cErr.message}`);
    for (const c of (cData ?? []) as BoardComment[]) {
      const view: BoardCommentView = {
        ...c,
        images: await signBoardImages(client, c.image_paths),
      };
      const arr = commentsByItem.get(c.board_item_id) ?? [];
      arr.push(view);
      commentsByItem.set(c.board_item_id, arr);
    }
  }

  const out: BoardItemView[] = [];
  for (const it of items) {
    out.push({
      ...it,
      images: await signBoardImages(client, it.image_paths),
      comments: commentsByItem.get(it.id) ?? [],
    });
  }
  return out;
}

export async function createBoardItem(input: {
  title: string;
  description: string | null;
  priority: BoardPriority;
  files: File[];
}): Promise<void> {
  const staff = await requireStaff();
  const client = dataClient();

  const paths = await uploadBoardImages(client, input.files);

  const { error } = await client.from("board_items").insert({
    title: input.title,
    description: input.description,
    priority: input.priority,
    author_email: staff.email,
    image_paths: paths,
    status: "open",
  });
  if (error) throw new Error(`create board item failed: ${error.message}`);
}

export async function createBoardComment(input: {
  boardItemId: string;
  body: string | null;
  files: File[];
}): Promise<void> {
  const staff = await requireStaff();
  const client = dataClient();

  const paths = await uploadBoardImages(client, input.files);
  if (!input.body && !paths.length) {
    throw new Error("Add a comment or an image.");
  }

  const { error } = await client.from("board_comments").insert({
    board_item_id: input.boardItemId,
    author_email: staff.email,
    body: input.body,
    image_paths: paths,
  });
  if (error) throw new Error(`add board comment failed: ${error.message}`);
}

export async function setBoardItemStatus(
  id: string,
  status: BoardStatus,
): Promise<void> {
  await requireStaff();
  const { error } = await dataClient()
    .from("board_items")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`update board status failed: ${error.message}`);
}

export async function setBoardItemPriority(
  id: string,
  priority: BoardPriority,
): Promise<void> {
  await requireStaff();
  const { error } = await dataClient()
    .from("board_items")
    .update({ priority, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`update board priority failed: ${error.message}`);
}

// --- Consolidated feedback inbox (action items) ----------------------------

export async function listFeedback(
  status?: string,
  author?: string,
): Promise<FeedbackItem[]> {
  await requireStaff();
  let query = dataClient()
    .from("conversation_feedback")
    .select(
      "*, session:sessions(id, customer:customers(display_name))",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (status) query = query.eq("status", status);
  if (author) query = query.eq("author_email", author);
  const { data, error } = await query;
  if (error) throw new Error(`list feedback failed: ${error.message}`);
  return (data ?? []) as unknown as FeedbackItem[];
}

// Who has added feedback, with totals and how many are still open.
export async function feedbackAuthorSummary(): Promise<
  { author_email: string; total: number; open: number }[]
> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("conversation_feedback")
    .select("author_email, status")
    .limit(2000);
  if (error) throw new Error(`author summary failed: ${error.message}`);
  const map = new Map<string, { total: number; open: number }>();
  for (const r of (data ?? []) as { author_email: string; status: string }[]) {
    const e = map.get(r.author_email) ?? { total: 0, open: 0 };
    e.total += 1;
    if (r.status === "open") e.open += 1;
    map.set(r.author_email, e);
  }
  return [...map.entries()]
    .map(([author_email, v]) => ({ author_email, ...v }))
    .sort((a, b) => b.total - a.total);
}

export async function countOpenFeedback(): Promise<number> {
  await requireStaff();
  const { count, error } = await dataClient()
    .from("conversation_feedback")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw new Error(`count feedback failed: ${error.message}`);
  return count ?? 0;
}

export async function setFeedbackStatus(
  id: string,
  status: "open" | "resolved" | "dismissed",
): Promise<void> {
  const staff = await requireStaff();
  const resolving = status === "resolved" || status === "dismissed";
  const { error } = await dataClient()
    .from("conversation_feedback")
    .update({
      status,
      resolved_by: resolving ? staff.email : null,
      resolved_at: resolving ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`update feedback status failed: ${error.message}`);
}

// --- Phase 3: FAQ proposals (bot.faq_proposals) ----------------------------

// Statuses the APP may set. `published` is intentionally excluded: publishing
// into the live FAQ store is done by a later n8n sync that picks up `approved`
// rows — out of scope here.
const APP_SETTABLE_STATUS: FaqStatus[] = ["draft", "approved", "rejected"];

export async function createFaqProposal(input: {
  question: string;
  suggestedAnswer: string | null;
  sourceSessionId: string | null;
}): Promise<void> {
  const staff = await requireStaff();
  const { error } = await dataClient()
    .from("faq_proposals")
    .insert({
      question: input.question,
      suggested_answer: input.suggestedAnswer,
      source_session_id: input.sourceSessionId,
      author_email: staff.email,
      status: "draft",
    });
  if (error) throw new Error(`create faq proposal failed: ${error.message}`);
}

// --- Manual ticket creation (agent escalation from a conversation) ---------

// Field definitions for the 4 Freshdesk ticket forms (synced by the bot).
export async function getFormSchemas(): Promise<FormSchemaField[]> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("form_schemas")
    .select("form_key, field_key, question, field_type, required, position, options")
    .order("form_key")
    .order("position");
  if (error) throw new Error(`form schemas failed: ${error.message}`);
  return (data ?? []) as FormSchemaField[];
}

// Creates the ticket in Freshdesk, then records it in bot.tickets so it shows
// up in the app's Tickets/Evaluation views exactly like bot-created tickets.
// Purely additive data — the bot's own flow is untouched.
export async function createManualTicket(input: {
  sessionId: string;
  email: string;
  subject: string;
  description: string;
  priority: string;
  formKey: string;
  customFields: Record<string, string | boolean>;
  answers: { question: string; answer: string }[];
}): Promise<string> {
  const staff = await requireStaff();
  const client = dataClient();

  // Session gives us the required FK columns (channel_user_id is NOT NULL)
  // plus context for the ticket body.
  const { data: session, error: sErr } = await client
    .from("sessions")
    .select(
      "id, state, last_message_at, channel_user_id, customer_id, customer:customers(display_name, email)",
    )
    .eq("id", input.sessionId)
    .maybeSingle();
  if (sErr) throw new Error(`session lookup failed: ${sErr.message}`);
  if (!session) throw new Error("Conversation not found.");

  const s = session as unknown as {
    state: string | null;
    last_message_at: string | null;
    channel_user_id: string;
    customer_id: string | null;
    customer: { display_name: string | null; email: string | null } | null;
  };

  const { count: msgCount } = await client
    .from("conversation_messages")
    .select("*", { count: "exact", head: true })
    .eq("session_id", input.sessionId);

  const answersBlock = input.answers.length
    ? `\nForm: ${formLabel(input.formKey)}\n` +
      input.answers.map((a) => `• ${a.question}: ${a.answer}`).join("\n")
    : `\nForm: ${formLabel(input.formKey)}`;

  const contextBlock = [
    "",
    "— Conversation context (Evelyn Ops) —",
    `Member: ${s.customer?.display_name ?? "(not authenticated)"} <${input.email}>`,
    `Bot session state: ${s.state ?? "unknown"} · ${msgCount ?? "?"} messages · last message ${s.last_message_at ?? "unknown"}`,
    answersBlock,
    "",
    `Created manually by ${staff.email} via Evelyn Ops — the bot did not open this ticket.`,
    `Transcript & details: ${env.appBaseUrl}/conversations/${input.sessionId}`,
  ].join("\n");

  const description = `${input.description}\n${contextBlock}`;

  const fdId = await createFreshdeskTicket({
    email: input.email,
    name: s.customer?.display_name ?? null,
    subject: input.subject,
    description,
    priority: input.priority,
    customFields: input.customFields,
  });

  const { error } = await client.from("tickets").insert({
    external_ticket_id: fdId,
    session_id: input.sessionId,
    channel_user_id: s.channel_user_id,
    customer_id: s.customer_id,
    subject: input.subject,
    description,
    category: formCategory(input.formKey),
    priority: input.priority,
    status: "open",
  });
  if (error) {
    // Ticket exists in Freshdesk but the record failed — surface loudly.
    throw new Error(
      `Freshdesk ticket #${fdId} was created, but recording it failed: ${error.message}. Add it manually or retry later.`,
    );
  }
  return fdId;
}

// --- Abandoned ticket drafts (bot.ticket_drafts) ----------------------------
//
// The bot sometimes shows a member a complete ticket preview and the member
// never confirms it — the draft just sits on bot.sessions.current_ticket_draft_id
// forever. This does NOT call bot.submit_ticket_from_draft: that RPC only
// inserts a bot.tickets row and relies on a separate n8n step to actually
// create the Freshdesk ticket, which would never happen for a draft submitted
// out-of-band here — it would just become another permanently-unsynced ticket.
// Instead this mirrors createManualTicket's proven direct-to-Freshdesk path.

// Only surfaces a draft that's actually sitting at a shown-but-unconfirmed
// preview — never 'collecting' (incomplete) or already 'submitted'/'abandoned'.
export async function getAbandonedTicketDraft(
  sessionId: string,
): Promise<TicketDraft | null> {
  await requireStaff();
  const client = dataClient();

  const { data: session, error: sErr } = await client
    .from("sessions")
    .select("current_ticket_draft_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) throw new Error(`session lookup failed: ${sErr.message}`);
  if (!session?.current_ticket_draft_id) return null;

  const { data: draft, error: dErr } = await client
    .from("ticket_drafts")
    .select("*")
    .eq("id", session.current_ticket_draft_id)
    .maybeSingle();
  if (dErr) throw new Error(`draft lookup failed: ${dErr.message}`);
  if (!draft || (draft as TicketDraft).status !== "ready_for_confirmation") {
    return null;
  }
  return draft as TicketDraft;
}

// Submits the bot's own drafted ticket to Freshdesk exactly as shown to the
// member, then marks the draft submitted and clears the session's pointer to
// it (mirrors the non-Freshdesk side effects of bot.submit_ticket_from_draft).
export async function submitAbandonedDraftTicket(
  sessionId: string,
): Promise<string> {
  const staff = await requireStaff();
  const client = dataClient();

  const draft = await getAbandonedTicketDraft(sessionId); // re-check, avoid double-submit
  if (!draft) {
    throw new Error("No abandoned ticket draft found for this conversation.");
  }
  if (!draft.subject || !draft.description) {
    throw new Error("Draft is incomplete.");
  }

  const { data: session, error: sErr } = await client
    .from("sessions")
    .select("channel_user_id, customer_id, customer:customers(display_name, email)")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) throw new Error(`session lookup failed: ${sErr.message}`);
  if (!session) throw new Error("Conversation not found.");
  const s = session as unknown as {
    channel_user_id: string;
    customer_id: string | null;
    customer: { display_name: string | null; email: string | null } | null;
  };
  if (!s.customer?.email) throw new Error("No email on file for this member.");

  const contextBlock = [
    "",
    "— Conversation context (Evelyn Ops) —",
    "This ticket was drafted by Evelyn during the chat but never confirmed by the member.",
    `Submitted manually by ${staff.email} via Evelyn Ops.`,
    `Transcript & details: ${env.appBaseUrl}/conversations/${sessionId}`,
  ].join("\n");

  const fdId = await createFreshdeskTicket({
    email: s.customer.email,
    name: s.customer.display_name,
    subject: draft.subject,
    description: `${draft.description}\n${contextBlock}`,
    priority: draft.priority ?? "medium",
  });

  const { error: tErr } = await client.from("tickets").insert({
    external_ticket_id: fdId,
    session_id: sessionId,
    channel_user_id: s.channel_user_id,
    customer_id: s.customer_id,
    subject: draft.subject,
    description: draft.description,
    category: draft.category,
    priority: draft.priority ?? "medium",
    status: "open",
  });
  if (tErr) {
    throw new Error(
      `Freshdesk ticket #${fdId} was created, but recording it failed: ${tErr.message}. Add it manually or retry later.`,
    );
  }

  await client
    .from("ticket_drafts")
    .update({ status: "submitted", updated_at: new Date().toISOString() })
    .eq("id", draft.id);
  await client
    .from("sessions")
    .update({
      current_ticket_draft_id: null,
      state: "authenticated_idle",
      state_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  return fdId;
}

// --- Tickets & Failures (read-only base-table views) -----------------------

export async function listTickets(): Promise<TicketRow[]> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("tickets")
    .select(
      "id, external_ticket_id, session_id, customer_id, subject, category, priority, status, created_at, customer:customers(display_name, email)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`list tickets failed: ${error.message}`);
  return (data ?? []) as unknown as TicketRow[];
}

// Ticket-leading conversations in a date range (the bot-evaluation queue).
export async function listTicketConversations(
  startISO: string,
  endISO: string,
): Promise<TicketRow[]> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("tickets")
    .select(
      "id, external_ticket_id, session_id, customer_id, subject, category, priority, status, created_at, customer:customers(display_name, email)",
    )
    .gte("created_at", startISO)
    .lt("created_at", endISO)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`list ticket conversations failed: ${error.message}`);
  return (data ?? []) as unknown as TicketRow[];
}

// Session ids that already have at least one piece of team feedback.
export async function reviewedSessionIds(): Promise<Set<string>> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("conversation_feedback")
    .select("session_id");
  if (error) throw new Error(`reviewed sessions failed: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { session_id: string }).session_id));
}

// Non-member tickets live only in Freshdesk (the bot doesn't record them in
// bot.tickets) — fetched live via the search API.
export async function listNonMemberTickets(): Promise<FreshdeskSearchTicket[]> {
  await requireStaff();
  return searchNonMemberTickets();
}

export async function listWorkflowErrors(): Promise<WorkflowErrorRow[]> {
  await requireStaff();
  const { data, error } = await dataClient()
    .from("workflow_errors")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`list workflow errors failed: ${error.message}`);
  return (data ?? []) as WorkflowErrorRow[];
}

export async function listFaqProposals(
  status?: string,
): Promise<FaqProposal[]> {
  await requireStaff();
  let query = dataClient()
    .from("faq_proposals")
    .select("*")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new Error(`list faq proposals failed: ${error.message}`);
  return (data ?? []) as FaqProposal[];
}

export async function setFaqProposalStatus(
  id: string,
  status: string,
): Promise<void> {
  const staff = await requireStaff();
  if (!APP_SETTABLE_STATUS.includes(status as FaqStatus)) {
    throw new Error(
      "Invalid status change (publishing is handled by the n8n sync).",
    );
  }
  const { error } = await dataClient()
    .from("faq_proposals")
    .update({
      status,
      reviewer_email: staff.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`update faq proposal failed: ${error.message}`);
}
