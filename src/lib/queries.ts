import "server-only";
import { requireStaff } from "@/lib/auth";
import { dataClient } from "@/lib/supabase/data-client";
import { FEEDBACK_TAG_VALUES } from "@/lib/feedback-tags";
import type {
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
  TicketRow,
  WorkflowErrorRow,
} from "@/lib/types";

const BOARD_BUCKET = "board-attachments";

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
  const out: BoardItemView[] = [];
  for (const it of items) {
    let images: { path: string; url: string | null }[] = [];
    if (it.image_paths?.length) {
      const { data: signed } = await client.storage
        .from(BOARD_BUCKET)
        .createSignedUrls(it.image_paths, 3600);
      images = (signed ?? []).map((s) => ({
        path: s.path ?? "",
        url: s.signedUrl ?? null,
      }));
    }
    out.push({ ...it, images });
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

  const paths: string[] = [];
  for (const f of input.files) {
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
