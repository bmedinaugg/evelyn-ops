"use client";

import { useActionState, useEffect, useRef } from "react";
import { addBoardComment, type AddState } from "./actions";

const initial: AddState = {};

export function CommentForm({ boardItemId }: { boardItemId: string }) {
  const [state, action, pending] = useActionState(addBoardComment, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form action={action} ref={formRef} className="board-comment-form">
      <input type="hidden" name="board_item_id" value={boardItemId} />
      <textarea
        name="body"
        rows={2}
        placeholder="Add a comment…"
        style={{ width: "100%" }}
      />
      <div className="board-comment-controls">
        <input type="file" name="images" accept="image/*" multiple />
        <button type="submit" disabled={pending}>
          {pending ? "Posting…" : "Comment"}
        </button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
    </form>
  );
}
