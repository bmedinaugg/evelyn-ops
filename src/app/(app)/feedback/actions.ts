"use server";

import { revalidatePath } from "next/cache";
import {
  createFaqProposal,
  getConversation,
  getFeedbackById,
  saveAiSuggestion,
  setFeedbackStatus,
} from "@/lib/queries";
import { generateFixSuggestion } from "@/lib/ai";

export async function changeFeedbackStatus(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id) return;
  if (status !== "open" && status !== "resolved" && status !== "dismissed") {
    return;
  }
  await setFeedbackStatus(id, status);
  revalidatePath("/feedback");
}

export type SuggestState = { error?: string; ok?: boolean };

// Ask Claude to diagnose the flagged conversation and store the suggestion
// on the feedback row.
export async function suggestFix(
  _prev: SuggestState,
  formData: FormData,
): Promise<SuggestState> {
  const id = String(formData.get("id") || "");
  if (!id) return { error: "Missing feedback id." };

  try {
    const feedback = await getFeedbackById(id);
    if (!feedback) return { error: "Feedback item not found." };
    const conv = await getConversation(feedback.session_id);
    if (!conv.found) return { error: "Conversation not found." };

    const suggestion = await generateFixSuggestion(conv, feedback);
    await saveAiSuggestion(id, suggestion);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Failed to generate suggestion.",
    };
  }

  revalidatePath("/feedback");
  return { ok: true };
}

// One-click: turn the AI's proposed FAQ into a draft in the proposals queue.
export async function saveSuggestedFaq(formData: FormData) {
  const feedbackId = String(formData.get("feedback_id") || "");
  if (!feedbackId) return;

  const feedback = await getFeedbackById(feedbackId);
  const faq = feedback?.ai_suggestion?.proposed_faq;
  if (!feedback || !faq?.question) return;

  await createFaqProposal({
    question: faq.question,
    suggestedAnswer: faq.answer || null,
    sourceSessionId: feedback.session_id,
  });
  revalidatePath("/faq-proposals");
  revalidatePath("/feedback");
}
