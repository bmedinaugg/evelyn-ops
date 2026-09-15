"use client";

import { useActionState, useEffect, useRef } from "react";
import { addBoardComment, type AddState } from "./actions";
import type { AppPerson } from "@/lib/queries";

const initial: AddState = {};

export function CommentForm({
  boardItemId,
  people,
}: {
  boardItemId: string;
  people: AppPerson[];
}) {
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
        placeholder="Add a comment…  tag someone with @esther"
        style={{ width: "100%" }}
      />
      {/* The taggable names, listed rather than left to be guessed. A tag that
          matches nobody is dropped silently at write time, so seeing the real
          handles is the difference between tagging Esther and tagging nobody. */}
      {people.length > 0 && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          Tag with @ to e-mail them:{" "}
          {people.slice(0, 8).map((p, i) => (
            <span key={p.email}>
              {i > 0 && ", "}
              <span className="mono">@{p.handle.split(".")[0]}</span>
            </span>
          ))}
          {people.length > 8 && <> and {people.length - 8} more</>}
        </div>
      )}
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
