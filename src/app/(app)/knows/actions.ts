"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addKnowledgeItemNote,
  resolveKnowledgeItemNote,
  setMagiclineCapabilityAllowed,
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
const BACK_ROUTES = ["/knows", "/gaps", "/magicline"];

function safeBack(raw: unknown): string {
  const s = String(raw || "");
  // Three pages share these actions since the split, so the allow-list has
  // three entries. Still an allow-list: following a form field anywhere else
  // would be an open redirect, and "starts with /" is not good enough because
  // "//evil.com" is a protocol-relative URL.
  if (s.startsWith("//")) return "/knows";
  const ok = BACK_ROUTES.some((r) => s === r || s.startsWith(r + "?"));
  return ok ? s : "/knows";
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

// Record whether Evelyn should answer one Magicline capability.
//
// This writes a PREFERENCE and nothing more. No part of the bot reads
// bot.magicline_capabilities.allowed, so unticking a row changes what Member
// Care has asked for and not what Evelyn does. The section on the page states
// that in as many words — if that ever stops being true, the wording has to
// change in the same commit as the wiring.
export async function setCapabilityAllowedAction(formData: FormData) {
  const key = String(formData.get("key") || "");
  // The checkbox posts "on" only when ticked, so absence is the unticked state.
  const allowed = formData.get("allowed") === "on";
  const back = safeBack(formData.get("back"));
  if (key) {
    await setMagiclineCapabilityAllowed(key, allowed);
    revalidatePath("/knows");
  }
  redirect(back);
}
