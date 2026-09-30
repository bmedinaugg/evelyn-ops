"use client";

import { useActionState, useEffect, useRef } from "react";
import { reply, type ProposeState } from "./actions";

const initial: ProposeState = {};

// A second opinion goes ON the open proposal. Three buttons, not one: the
// stance is what makes a disagreement visible on the list before anything is
// built, so it is a choice the reviewer makes, not a word the approver has to
// infer from the text.
export function ReplyForm({ proposalId, caseKey }: { proposalId: string; caseKey: string | null }) {
  const [state, action, pending] = useActionState(reply, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form action={action} ref={formRef} className="board-comment-form">
      <input type="hidden" name="proposal_id" value={proposalId} />
      {caseKey && <input type="hidden" name="case_key" value={caseKey} />}
      <textarea name="body" rows={2} placeholder="Your view — required if you object" style={{ width: "100%" }} />
      <div className="board-comment-controls" style={{ gap: 6 }}>
        <button type="submit" name="stance" value="agree" disabled={pending}>Agree</button>
        <button type="submit" name="stance" value="object" disabled={pending} className="secondary">Object</button>
        <button type="submit" name="stance" value="comment" disabled={pending} className="secondary">Comment</button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
