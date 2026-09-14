"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addKnowledgeItemNote,
  resolveKnowledgeItemNote,
} from "@/lib/queries";
import type { KnowledgeNoteKind } from "@/lib/types";

const KINDS: KnowledgeNoteKind[] = [
  "wrong",
  "outdated",
  "unclear",
  "missing",
  "context",
];

// Where to land after the write. Comes from a hidden field carrying the view
// the reader was in, including which row was open — the list is rendered on
// the server, so without this every save would drop them back at the top of an
// unfiltered page with the row they were working in closed.
//
// Validated, not trusted: a form field is user input, and following it
// anywhere but back into this page would be an open redirect.
function safeBack(raw: unknown): string {
  const s = String(raw || "");
  return s.startsWith("/knows") && !s.startsWith("//") ? s : "/knows";
}

// Record what an agent says about one piece of the bot's knowledge.
export async function addKnowledgeNoteAction(formData: FormData) {
  const key = String(formData.get("item_key") || "");
  const note = String(formData.get("note") || "");
  const raw = String(formData.get("kind") || "");
  const back = safeBack(formData.get("back"));
  // Fall back rather than reject: the note is the valuable part, and losing
  // someone's typing to a bad select value would be a poor trade.
  const kind = (KINDS as string[]).includes(raw)
    ? (raw as KnowledgeNoteKind)
    : "wrong";
  if (!key || !note.trim()) redirect(back);
  await addKnowledgeItemNote(key, kind, note);
  revalidatePath("/knows");
  redirect(back);
}

// Mark a note as dealt with. It stays in the table — the point is the record of
// what was raised, not a clean list.
export async function resolveKnowledgeNoteAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  const back = safeBack(formData.get("back"));
  if (id) {
    await resolveKnowledgeItemNote(id);
    revalidatePath("/knows");
  }
  redirect(back);
}
