"use server";

import { revalidatePath } from "next/cache";
import { runRegressionFixture } from "@/lib/queries";

export async function runFixture(formData: FormData) {
  const fixtureKey = String(formData.get("fixture_key") || "");
  if (!fixtureKey) return;
  await runRegressionFixture(fixtureKey);
  revalidatePath("/regression-tests");
}
