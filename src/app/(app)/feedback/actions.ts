"use server";

import { revalidatePath } from "next/cache";
import {
  setFeedbackStatus,
  saveFeedbackNote,
  setRequestedBy,
} from "@/lib/queries";

export async function changeFeedbackStatus(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  const note = String(formData.get("note") || "");
  if (!id) return;
  if (status !== "open" && status !== "resolved" && status !== "dismissed") {
    return;
  }
  await setFeedbackStatus(id, status, note);
  revalidatePath("/feedback");
}

// Save a "working on it / status" note on an OPEN item without resolving it.
export async function saveFeedbackNoteAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const note = String(formData.get("note") || "");
  if (!id) return;
  await saveFeedbackNote(id, note);
  revalidatePath("/feedback");
}

// Record who raised this feedback, so they hear back when it is resolved.
export async function setFeedbackRequestedBy(formData: FormData) {
  const id = String(formData.get("id") || "");
  const email = String(formData.get("requested_by") || "");
  if (!id) return;
  await setRequestedBy("conversation_feedback", id, email);
  revalidatePath("/feedback");
}
