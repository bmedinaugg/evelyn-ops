import "server-only";
import { env } from "@/lib/env";

// Minimal client for the "Bot - Regression Test Harness" n8n workflow — a
// small, isolated workflow (webhook -> router -> respond) that reports
// pass/fail for a fixture.
//
// Two fixture modes, selected by target_workflow_id:
//   - null: the harness re-runs a hand-ported copy of a fixed bug's logic
//     (legacy path; shares no nodes/credentials with the live bot).
//   - set : the harness routes to an Execute Sub-workflow node that calls the
//     named live n8n sub-workflow with input_payload and returns its output as
//     actual_result — a genuine pre-prod gate against the real node.

export interface HarnessResult {
  passed: boolean;
  actual_result: Record<string, unknown>;
  notes?: string;
}

export async function runHarnessFixture(input: {
  fixture_key: string;
  target_workflow_id: string | null;
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
