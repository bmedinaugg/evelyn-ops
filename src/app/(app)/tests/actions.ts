"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveTestProfile, saveTestScenario } from "@/lib/queries";
import { runScenario } from "@/lib/testing";
import type { TestTurnSpec } from "@/lib/types";

export type FormState = { error?: string; ok?: boolean };

export async function saveProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    await saveTestProfile({
      key: String(formData.get("key") || ""),
      email: String(formData.get("email") || "") || null,
      loginChoice: String(formData.get("login_choice") || "") || null,
      notes: String(formData.get("notes") || "") || null,
      active: formData.get("active") === "on",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save." };
  }
  revalidatePath("/tests");
  return { ok: true };
}

const split = (s: string) => s.split("|").map((x) => x.trim()).filter(Boolean);

export async function saveScenario(_prev: FormState, formData: FormData): Promise<FormState> {
  const turns: TestTurnSpec[] = [];
  for (let i = 0; i < 12; i++) {
    const say = String(formData.get(`say_${i}`) || "").trim();
    if (!say) continue;
    const outcomeRaw = String(formData.get(`outcome_${i}`) || "");
    turns.push({
      say,
      contains: split(String(formData.get(`contains_${i}`) || "")),
      not_contains: split(String(formData.get(`not_contains_${i}`) || "")),
      matches: String(formData.get(`matches_${i}`) || "").trim() || null,
      outcome: outcomeRaw === "no_ticket" || outcomeRaw === "ticket_filed" ? outcomeRaw : null,
    });
  }
  const key = String(formData.get("key") || "");
  try {
    await saveTestScenario({
      key,
      title: String(formData.get("title") || ""),
      profileKey: String(formData.get("profile_key") || "") || null,
      caseKey: String(formData.get("case_key") || "") || null,
      turns,
      active: formData.get("active") === "on",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save." };
  }
  revalidatePath("/tests");
  revalidatePath(`/tests/${key}`);
  return { ok: true };
}

// Runs the whole scenario synchronously — a minute or two — then lands on the
// run page. The run row is written turn by turn, so a refresh of /tests shows
// progress if this request is slow.
export async function run(formData: FormData) {
  const key = String(formData.get("key") || "");
  if (!key) return;
  const r = await runScenario(key);
  revalidatePath("/tests");
  revalidatePath(`/tests/${key}`);
  redirect(`/tests/runs/${r.id}`);
}
