"use server";

import { revalidatePath } from "next/cache";
import { reviewHelpedSession } from "@/lib/queries";

// Reviewer confirms the bot genuinely helped — recorded, but kept out of the
// open feedback workload.
export async function markHelpedAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") || "");
  if (!sessionId) return;
  await reviewHelpedSession({ sessionId, helped: true, explanation: null });
  revalidatePath("/helped");
  revalidatePath("/feedback");
}

// Reviewer says it did NOT help — needs an explanation, and it's filed into the
// Feedback inbox (as an open `bad` item) for the team to fix.
export async function markNotHelpedAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") || "");
  const explanation = String(formData.get("explanation") || "").trim();
  if (!sessionId || !explanation) return; // explanation is required
  await reviewHelpedSession({ sessionId, helped: false, explanation });
  revalidatePath("/helped");
  revalidatePath("/feedback");
}
