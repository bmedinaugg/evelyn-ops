"use server";

import { revalidatePath } from "next/cache";
import { setFaqProposalStatus } from "@/lib/queries";

// Form action: change a proposal's status (draft/approved/rejected only —
// setFaqProposalStatus rejects `published`, which is the n8n sync's job).
export async function changeFaqStatus(formData: FormData) {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !status) return;
  await setFaqProposalStatus(id, status);
  revalidatePath("/faq-proposals");
}
