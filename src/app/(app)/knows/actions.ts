"use server";

import { revalidatePath } from "next/cache";
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

// Record what an agent says about one piece of the bot's knowledge.
export async function addKnowledgeNoteAction(formData: FormData) {
  const key = String(formData.get("item_key") || "");
  const note = String(formData.get("note") || "");
  const raw = String(formData.get("kind") || "");
  // Fall back rather than reject: the note is the valuable part, and losing
  // someone's typing to a bad select value would be a poor trade.
  const kind = (KINDS as string[]).includes(raw)
    ? (raw as KnowledgeNoteKind)
    : "wrong";
  if (!key || !note.trim()) return;
  await addKnowledgeItemNote(key, kind, note);
  revalidatePath("/knows");
}

// Mark a note as dealt with. It stays in the table — the point is the record of
// what was raised, not a clean list.
export async function resolveKnowledgeNoteAction(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;
  await resolveKnowledgeItemNote(id);
  revalidatePath("/knows");
}
