"use server";

import { revalidatePath } from "next/cache";
import {
  createBoardItem,
  createBoardComment,
  setBoardItemStatus,
  setBoardItemPriority,
} from "@/lib/queries";
import type { BoardPriority, BoardStatus } from "@/lib/types";

const PRIORITIES: BoardPriority[] = ["low", "medium", "high", "urgent"];
const STATUSES: BoardStatus[] = ["open", "in_progress", "done", "dismissed"];

export type AddState = { error?: string; ok?: boolean };

export async function addBoardItem(
  _prev: AddState,
  formData: FormData,
): Promise<AddState> {
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const priorityRaw = String(formData.get("priority") || "medium");
  const priority = (PRIORITIES as string[]).includes(priorityRaw)
    ? (priorityRaw as BoardPriority)
    : "medium";
  const files = formData
    .getAll("images")
    .filter((x): x is File => x instanceof File && x.size > 0);

  if (!title) return { error: "A title is required." };

  try {
    await createBoardItem({ title, description, priority, files });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add item." };
  }
  revalidatePath("/board");
  return { ok: true };
}

export async function addBoardComment(
  _prev: AddState,
  formData: FormData,
): Promise<AddState> {
  const boardItemId = String(formData.get("board_item_id") || "");
  const body = String(formData.get("body") || "").trim() || null;
  const files = formData
    .getAll("images")
    .filter((x): x is File => x instanceof File && x.size > 0);

  if (!boardItemId) return { error: "Missing board item." };
  if (!body && !files.length) return { error: "Add a comment or an image." };

  try {
    await createBoardComment({ boardItemId, body, files });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to add comment." };
  }
  revalidatePath("/board");
  return { ok: true };
}

export async function moveBoardItem(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !(STATUSES as string[]).includes(status)) return;
  await setBoardItemStatus(id, status as BoardStatus);
  revalidatePath("/board");
}

export async function changeBoardPriority(formData: FormData) {
  const id = String(formData.get("id") || "");
  const priority = String(formData.get("priority") || "");
  if (!id || !(PRIORITIES as string[]).includes(priority)) return;
  await setBoardItemPriority(id, priority as BoardPriority);
  revalidatePath("/board");
}
