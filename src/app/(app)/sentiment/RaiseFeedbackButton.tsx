"use client";

import { useActionState } from "react";
import { raiseSentimentFeedback, type RaiseState } from "./actions";

const INITIAL: RaiseState = {};

export function RaiseFeedbackButton({
  sessionId,
  sentiment,
  confidence,
  rationale,
}: {
  sessionId: string;
  sentiment: string;
  confidence: string | null;
  rationale: string | null;
}) {
  const [state, action, pending] = useActionState(
    raiseSentimentFeedback,
    INITIAL,
  );

  // Once raised, keep it raised in the UI rather than waiting for a refresh —
  // revalidatePath will agree on the next render.
  if (state.ok) return <span className="badge green">raised</span>;

  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="sentiment" value={sentiment} />
      <input type="hidden" name="confidence" value={confidence ?? ""} />
      <input type="hidden" name="rationale" value={rationale ?? ""} />
      <button type="submit" disabled={pending} className="secondary">
        {pending ? "raising…" : "raise"}
      </button>
      {state.error && (
        <div className="muted" style={{ fontSize: 11, color: "var(--red)" }}>
          {state.error}
        </div>
      )}
    </form>
  );
}
