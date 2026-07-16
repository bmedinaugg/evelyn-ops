"use client";

import { useActionState, useEffect, useRef } from "react";
import { addBoardItem, type AddState } from "./actions";

const initial: AddState = {};

export function AddBoardItemForm() {
  const [state, action, pending] = useActionState(addBoardItem, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <details className="panel board-add">
      <summary>+ Add a board item</summary>
      <form action={action} ref={formRef} className="fb-form" style={{ padding: 14 }}>
        <input type="text" name="title" placeholder="Title" required />
        <textarea
          name="description"
          rows={3}
          placeholder="Describe the issue or request…"
          style={{ width: "100%" }}
        />
        <div className="fb-row">
          <span className="fb-label">Priority</span>
          <select name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="fb-row">
          <span className="fb-label">Images</span>
          <input type="file" name="images" accept="image/*" multiple />
        </div>
        {state.error && <div className="error">{state.error}</div>}
        <div>
          <button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add item"}
          </button>
        </div>
      </form>
    </details>
  );
}
