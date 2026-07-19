"use server";

import { revalidatePath } from "next/cache";
import {
  createConversationFeedback,
  createFaqProposal,
  createManualTicket,
  getFormSchemas,
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

  const formKey = String(formData.get("form_key") || "");

  if (!sessionId) return { error: "Missing session id." };
  if (!email || !email.includes("@"))
    return { error: "A valid member email is required." };
  if (!subject) return { error: "A subject is required." };
  if (!description) return { error: "A description is required." };
  if (!formKey) return { error: "Select which form should have been used." };

  try {
    // Resolve the selected form's field definitions so values are typed
    // correctly for Freshdesk (checkboxes → booleans) and we can build a
    // readable answers summary for the ticket body.
    const schema = (await getFormSchemas()).filter(
      (f) => f.form_key === formKey,
    );
    if (schema.length === 0) return { error: "Unknown form selected." };

    const customFields: Record<string, string | boolean> = {};
    const answers: { question: string; answer: string }[] = [];

    // All dynamic inputs are named cf:<freshdesk_field_name>.
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith("cf:")) continue;
      const name = key.slice(3);
      const v = String(value).trim();
      if (v) customFields[name] = v;
    }

    for (const field of schema) {
      if (field.field_type === "custom_checkbox") {
        // Unchecked boxes are absent from FormData — send explicit booleans.
        const checked = customFields[field.field_key] === "on";
        customFields[field.field_key] = checked;
        answers.push({
          question: field.question.slice(0, 80),
          answer: checked ? "Yes" : "No",
        });
      } else if (field.field_type === "nested_field") {
        const parts = [
          customFields[field.field_key],
          ...(field.options?.nested_ticket_fields ?? [])
            .sort((a, b) => a.level - b.level)
            .map((nf) => customFields[nf.name]),
        ].filter((p): p is string => typeof p === "string" && p.length > 0);
        if (parts.length)
          answers.push({ question: field.question, answer: parts.join(" → ") });
        if (field.required && !customFields[field.field_key])
          return { error: `"${field.question}" is required for this form.` };
      } else {
        const v = customFields[field.field_key];
        if (typeof v === "string" && v)
          answers.push({ question: field.question, answer: v });
        if (field.required && field.field_type !== "custom_text" && !v)
          return { error: `"${field.question}" is required for this form.` };
      }
    }

    const fdId = await createManualTicket({
      sessionId,
      email,
      subject,
      description,
      priority,
      formKey,
      customFields,
      answers,
    });
    revalidatePath(`/conversations/${sessionId}`);
    return { fdId };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to create the ticket.",
    };
  }
}
