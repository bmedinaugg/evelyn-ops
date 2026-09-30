"use client";

import { useActionState, useEffect, useRef } from "react";
import { tryIt, type TrialState } from "./actions";

const initial: TrialState = {};

// Type what a member would type; get what Evelyn actually says. Ten seconds or
// so — it is a real run, not a cached answer.
export function TryItForm({
  caseKey,
  targetWorkflowId,
  proposalId,
  placeholder,
}: {
  caseKey: string;
  targetWorkflowId: string;
  proposalId: string | null;
  placeholder: string;
}) {
  const [state, action, pending] = useActionState(tryIt, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form action={action} ref={formRef} className="fb-form">
      <input type="hidden" name="case_key" value={caseKey} />
      <input type="hidden" name="target_workflow_id" value={targetWorkflowId} />
      {proposalId && <input type="hidden" name="proposal_id" value={proposalId} />}
      <textarea
        name="message"
        rows={2}
        required
        maxLength={1000}
        placeholder={placeholder}
        style={{ width: "100%" }}
      />
      {state.error && <div className="error">{state.error}</div>}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" disabled={pending}>
          {pending ? "Asking Evelyn… (about 10 s)" : "Ask Evelyn"}
        </button>
        {pending && <span className="muted" style={{ fontSize: 12 }}>Running the real workflow.</span>}
      </div>
    </form>
  );
}
