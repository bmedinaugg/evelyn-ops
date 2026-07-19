"use server";

import { revalidatePath } from "next/cache";
import {
  createConversationFeedback,
  createFaqProposal,
  createManualTicket,
} from "@/lib/queries";

export type FeedbackState = { error?: string; ok?: boolean };

export async function submitFeedback(
  _prev: FeedbackState,
  formData: FormData,
): Promise<FeedbackState> {
  const sessionId = String(formData.get("session_id") || "");
  if (!sessionId) return { error: "Missing session id." };

  const ratingRaw = String(formData.get("rating") || "");
  const rating =
    ratingRaw === "good" || ratingRaw === "bad" ? ratingRaw : null;
  const comment = String(formData.get("comment") || "").trim() || null;
  const detail = String(formData.get("detail") || "").trim() || null;
  const tags = formData.getAll("tags").map(String);

  if (!rating && !comment && tags.length === 0) {
    return { error: "Add a rating, a tag, or a comment before saving." };
  }

  try {
    await createConversationFeedback({
      sessionId,
      rating,
      comment,
      tags,
      detail,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save." };
  }

  // Re-render the detail page so the new entry appears in the list.
  revalidatePath(`/conversations/${sessionId}`);
  return { ok: true };
}

export type ProposeFaqState = { error?: string; ok?: boolean };

export async function proposeFaq(
  _prev: ProposeFaqState,
  formData: FormData,
): Promise<ProposeFaqState> {
  const sessionId = String(formData.get("session_id") || "") || null;
  const question = String(formData.get("question") || "").trim();
  const suggestedAnswer =
    String(formData.get("suggested_answer") || "").trim() || null;

  if (!question) return { error: "A question is required." };

  try {
    await createFaqProposal({
      question,
      suggestedAnswer,
      sourceSessionId: sessionId,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save." };
  }

  if (sessionId) revalidatePath(`/conversations/${sessionId}`);
  return { ok: true };
}

export type CreateTicketState = { error?: string; fdId?: string };

export async function createTicket(
  _prev: CreateTicketState,
  formData: FormData,
): Promise<CreateTicketState> {
  const sessionId = String(formData.get("session_id") || "");
  const email = String(formData.get("email") || "").trim();
  const subject = String(formData.get("subject") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const priorityRaw = String(formData.get("priority") || "medium");
  const priority = ["low", "medium", "high", "urgent"].includes(priorityRaw)
    ? priorityRaw
    : "medium";

  if (!sessionId) return { error: "Missing session id." };
  if (!email || !email.includes("@"))
    return { error: "A valid member email is required." };
  if (!subject) return { error: "A subject is required." };
  if (!description) return { error: "A description is required." };

  try {
    const fdId = await createManualTicket({
      sessionId,
      email,
      subject,
      description,
      priority,
    });
    revalidatePath(`/conversations/${sessionId}`);
    return { fdId };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to create the ticket.",
    };
  }
}
