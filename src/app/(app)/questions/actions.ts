"use server";

import { revalidatePath } from "next/cache";
import { addQuestionNote, resolveQuestionNote } from "@/lib/queries";

// Record how a question SHOULD be answered, when the bot gets it wrong.
export async function addQuestionNoteAction(formData: FormData) {
  const key = String(formData.get("question_key") || "");
  const shouldBe = String(formData.get("should_be") || "");
  if (!key || !shouldBe.trim()) return;
  await addQuestionNote(key, shouldBe);
  revalidatePath("/questions");
}

// Mark a correction as dealt with. It stays in the table — the point is the
// record of what was raised, not a clean list.
export async function resolveQuestionNoteAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  await resolveQuestionNote(id);
  revalidatePath("/questions");
}
