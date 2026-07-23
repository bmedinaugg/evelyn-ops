"use client";

import { useActionState } from "react";
import { submitAbandonedDraft, type SubmitDraftState } from "./actions";
import { freshdeskUrl } from "@/lib/format";
import type { TicketDraft } from "@/lib/types";

const initial: SubmitDraftState = {};

export function SubmitDraftButton({
  sessionId,
  draft,
}: {
  sessionId: string;
  draft: TicketDraft;
}) {
  const [state, action, pending] = useActionState(submitAbandonedDraft, initial);

  if (state.fdId) {
    const url = freshdeskUrl(state.fdId);
    return (
      <div className="callout" style={{ borderLeftColor: "var(--green)" }}>
        ✅ Ticket created:{" "}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            Freshdesk #{state.fdId}
          </a>
        ) : (
          <>#{state.fdId}</>
        )}{" "}
        — it's now linked to this conversation.
      </div>
    );
  }

  return (
    <div className="callout" style={{ borderLeftColor: "var(--amber)", marginBottom: 18 }}>
      <strong>⚠ Ticket preview shown but never confirmed.</strong> Evelyn
      drafted this ticket during the chat, but the member never gave a clear
      yes/no. You can submit it to Freshdesk exactly as drafted.

      <div className="panel" style={{ padding: 12, margin: "10px 0" }}>
        <div className="k">Subject</div>
        <div className="v" style={{ fontSize: 14 }}>{draft.subject}</div>
        <div className="k" style={{ marginTop: 8 }}>Issue</div>
        <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{draft.description}</div>
      </div>

      <form
        action={action}
        onSubmit={(e) => {
          if (!confirm("Submit this ticket to Freshdesk as drafted by the bot?")) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="session_id" value={sessionId} />
        {state.error && <div className="error">{state.error}</div>}
        <button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "📤 Submit this ticket"}
        </button>
      </form>
    </div>
  );
}
