"use client";

import { useActionState } from "react";
import { suggestFix, type SuggestState } from "./actions";

const initial: SuggestState = {};

export function SuggestFixButton({
  feedbackId,
  hasSuggestion,
}: {
  feedbackId: string;
  hasSuggestion: boolean;
}) {
  const [state, action, pending] = useActionState(suggestFix, initial);

  return (
    <form action={action} className="suggest-form">
      <input type="hidden" name="id" value={feedbackId} />
      <button type="submit" className="secondary" disabled={pending}>
        {pending
          ? "Analyzing…"
          : hasSuggestion
            ? "↻ Re-suggest"
            : "✨ Suggest fix"}
      </button>
      {pending && (
        <span className="muted suggest-note">
          Claude is reading the conversation…
        </span>
      )}
      {state.error && <span className="error">{state.error}</span>}
    </form>
  );
}
