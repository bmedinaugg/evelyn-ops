"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitFeedback, type FeedbackState } from "./actions";
import { FEEDBACK_TAGS, feedbackTagLabel } from "@/lib/feedback-tags";
import type { ConversationFeedback } from "@/lib/types";

const initial: FeedbackState = {};

// Tags that ask for a structured detail, and the prompt shown for each.
const DETAIL_PROMPTS: Record<string, string> = {
  "missing-faq": "Title/topic of the FAQ that was missing…",
  "wrong-info": "What was wrong, and what would be correct?",
  incomplete: "What was missing from the answer?",
};

function whenLocal(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { timeZone: "Europe/Amsterdam" });
}

export function FeedbackPanel({
  sessionId,
  items,
}: {
  sessionId: string;
  items: ConversationFeedback[];
}) {
  const [state, action, pending] = useActionState(submitFeedback, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [checkedTags, setCheckedTags] = useState<string[]>([]);

  // Clear the form once a submission succeeds (the server revalidated the
  // page, so `items` already includes the new entry).
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setCheckedTags([]);
    }
  }, [state.ok]);

  const detailTag = checkedTags.find((t) => DETAIL_PROMPTS[t]);

  return (
    <div className="section" style={{ marginTop: 0 }}>
      <h2>Team feedback ({items.length})</h2>

      <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
        <form action={action} ref={formRef} className="fb-form">
          <input type="hidden" name="session_id" value={sessionId} />

          <div className="fb-row">
            <span className="fb-label">Rating</span>
            <label className="fb-radio">
              <input type="radio" name="rating" value="good" /> 👍 Good
            </label>
            <label className="fb-radio">
              <input type="radio" name="rating" value="bad" /> 👎 Bad
            </label>
          </div>

          <div className="fb-row">
            <span className="fb-label">Tags</span>
            <div className="fb-tags">
              {FEEDBACK_TAGS.map((t) => (
                <label key={t.value} className="fb-chip">
                  <input
                    type="checkbox"
                    name="tags"
                    value={t.value}
                    onChange={(e) =>
                      setCheckedTags((prev) =>
                        e.target.checked
                          ? [...prev, t.value]
                          : prev.filter((v) => v !== t.value),
                      )
                    }
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </div>

          {detailTag && (
            <input
              type="text"
              name="detail"
              placeholder={DETAIL_PROMPTS[detailTag]}
            />
          )}

          <textarea
            name="comment"
            rows={3}
            placeholder="Optional comment for the team…"
            style={{ width: "100%" }}
          />

          {state.error && <div className="error">{state.error}</div>}

          <div>
            <button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save feedback"}
            </button>
          </div>
        </form>
      </div>

      {items.length === 0 ? (
        <div className="callout">No feedback on this conversation yet.</div>
      ) : (
        <div className="fb-list">
          {items.map((f) => (
            <div key={f.id} className="fb-item">
              <div className="fb-item-head">
                {f.rating === "good" && <span className="badge green">👍 Good</span>}
                {f.rating === "bad" && <span className="badge red">👎 Bad</span>}
                {f.tags?.map((t) => (
                  <span key={t} className="badge grey">
                    {feedbackTagLabel(t)}
                  </span>
                ))}
                <span className="muted" style={{ marginLeft: "auto" }}>
                  {f.author_email} · {whenLocal(f.created_at)}
                </span>
              </div>
              {f.detail && (
                <div className="fb-comment muted">↳ {f.detail}</div>
              )}
              {f.comment && <div className="fb-comment">{f.comment}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
