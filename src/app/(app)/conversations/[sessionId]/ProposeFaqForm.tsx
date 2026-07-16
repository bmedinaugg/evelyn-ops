"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { proposeFaq, type ProposeFaqState } from "./actions";

const initial: ProposeFaqState = {};

export function ProposeFaqForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(proposeFaq, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <div className="section" style={{ marginTop: 0 }}>
      <h2>Suggest an FAQ</h2>
      <div className="panel" style={{ padding: 16 }}>
        <form action={action} ref={formRef} className="fb-form">
          <input type="hidden" name="session_id" value={sessionId} />
          <input
            type="text"
            name="question"
            placeholder="The question the bot should be able to answer…"
            required
          />
          <textarea
            name="suggested_answer"
            rows={3}
            placeholder="Suggested answer (optional — the team can refine later)…"
            style={{ width: "100%" }}
          />
          {state.error && <div className="error">{state.error}</div>}
          {state.ok && (
            <div className="notice">
              Saved as a draft. Track it in{" "}
              <Link href="/faq-proposals">FAQ proposals</Link>.
            </div>
          )}
          <div>
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save FAQ proposal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
