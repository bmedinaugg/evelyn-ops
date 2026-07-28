import "server-only";
import { env } from "@/lib/env";

// Minimal client for the "Bot - Regression Test Harness" n8n workflow — a
// small, isolated workflow (webhook -> Code node -> respond) that re-runs a
// hand-ported copy of a fixed bug's logic against fixture data and reports
// pass/fail. Shares no nodes/credentials with the live bot workflows.

export interface HarnessResult {
  passed: boolean;
  actual_result: Record<string, unknown>;
  notes?: string;
}

export async function runHarnessFixture(input: {
  fixture_key: string;
  input_payload: Record<string, unknown>;
  expected_result: Record<string, unknown>;
}): Promise<HarnessResult> {
  const res = await fetch(env.n8nHarnessWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Harness-Secret": env.n8nHarnessSecret,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `harness webhook failed (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }

  return (await res.json()) as HarnessResult;
}
