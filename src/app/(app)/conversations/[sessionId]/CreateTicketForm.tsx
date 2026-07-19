"use client";

import { useActionState } from "react";
import { createTicket, type CreateTicketState } from "./actions";

const initial: CreateTicketState = {};

export function CreateTicketForm({
  sessionId,
  memberEmail,
  transcriptText,
  hasTicket,
}: {
  sessionId: string;
  memberEmail: string | null;
  transcriptText: string;
  hasTicket: boolean;
}) {
  const [state, action, pending] = useActionState(createTicket, initial);

  if (state.fdId) {
    return (
      <div className="callout" style={{ borderLeftColor: "var(--green)" }}>
        ✅ Ticket created:{" "}
        <a
          href={`https://urbangymgroup.freshdesk.com/a/tickets/${state.fdId}`}
          target="_blank"
          rel="noreferrer"
        >
          Freshdesk #{state.fdId}
        </a>{" "}
        — it's now linked to this conversation.
      </div>
    );
  }

  return (
    <details className="panel board-add">
      <summary>
        🎫 Create a ticket from this conversation
        {hasTicket && (
          <span className="muted"> (a ticket already exists — this adds another)</span>
        )}
      </summary>
      <form action={action} className="fb-form" style={{ padding: 14 }}>
        <input type="hidden" name="session_id" value={sessionId} />

        <div className="fb-row">
          <span className="fb-label">Email</span>
          <input
            type="email"
            name="email"
            required
            defaultValue={memberEmail ?? ""}
            placeholder="member@email.com"
            style={{ minWidth: 260 }}
          />
          {!memberEmail && (
            <span className="muted">
              member wasn't authenticated — enter their email
            </span>
          )}
        </div>

        <input
          type="text"
          name="subject"
          required
          placeholder="Subject — what does the member need?"
        />

        <textarea
          name="description"
          rows={8}
          required
          defaultValue={transcriptText}
          style={{ width: "100%" }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          Prefilled with the transcript — edit it down to what the Freshdesk
          agent needs.
        </span>

        <div className="fb-row">
          <span className="fb-label">Priority</span>
          <select name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        {state.error && <div className="error">{state.error}</div>}

        <div>
          <button type="submit" disabled={pending}>
            {pending ? "Creating in Freshdesk…" : "Create ticket"}
          </button>
        </div>
      </form>
    </details>
  );
}
