"use server";

import { revalidatePath } from "next/cache";
import { setFeedbackStatus } from "@/lib/queries";

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
