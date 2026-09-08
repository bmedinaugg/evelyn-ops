"use server";

import { revalidatePath } from "next/cache";
import { createConversationFeedback } from "@/lib/queries";

export type RaiseState = { error?: string; ok?: boolean };

// Raise a scored conversation onto the Feedback page so the team can work it.
//
// Deliberately files with rating = null. The sentiment score says how the
// MEMBER came across; `rating` on a feedback item is Member Care's verdict on
// whether the BOT did well. Those are different judgements — three of the
// conversations used to validate the scorer were rated "bad" by Member Care
// while the member stayed perfectly polite. Pre-filling "bad" here would put
// words in the reviewer's mouth and quietly corrupt the one signal we have for
// bot quality.
//
// No tag either, for the same reason: "wrong-info" / "tone" are conclusions,
// and nobody has looked at the transcript yet.
export async function raiseSentimentFeedback(
  _prev: RaiseState,
  formData: FormData,
): Promise<RaiseState> {
  const sessionId = String(formData.get("session_id") || "");
  if (!sessionId) return { error: "Missing session id." };

  const sentiment = String(formData.get("sentiment") || "").trim();
  const confidence = String(formData.get("confidence") || "").trim();
  const rationale = String(formData.get("rationale") || "").trim();

  const comment =
    `Flagged from the Sentiment dashboard — scored ${sentiment || "unknown"}` +
    (confidence ? ` (${confidence} confidence)` : "") +
    ". Please review the transcript and rate the bot.";

  try {
    await createConversationFeedback({
      sessionId,
      rating: null,
      comment,
      tags: [],
      detail: rationale || null,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to raise." };
  }

  // Both pages change: the row here gains a "raised" badge, and the item
  // appears in the Feedback inbox.
  revalidatePath("/sentiment");
  revalidatePath("/feedback");
  return { ok: true };
}
