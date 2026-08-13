import Link from "next/link";
import React from "react";
import {
  listFeedback,
  feedbackAuthorSummary,
  listRecentlyWorkedOn,
} from "@/lib/queries";
import { amsterdamDateTime } from "@/lib/format";
import { feedbackTagLabel } from "@/lib/feedback-tags";
import { changeFeedbackStatus, saveFeedbackNoteAction } from "./actions";

export const dynamic = "force-dynamic";

const FILTERS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "all", label: "All" },
];

function qs(status: string, author?: string): string {
  const p = new URLSearchParams();
  p.set("status", status);
  if (author) p.set("author", author);
  return `/feedback?${p.toString()}`;
}

function ActionButton({
  id,
  status,
  label,
  secondary,
}: {
  id: string;
  status: string;
  label: string;
  secondary?: boolean;
}) {
  return (
    <form action={changeFeedbackStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={secondary ? "secondary" : undefined}>
        {label}
      </button>
    </form>
  );
}

// Resolve with an optional "what we did" note — the note feeds the
// "What we've done with your feedback" section so contributors see
// their input turned into action.
function ResolveForm({ id, note }: { id: string; note?: string | null }) {
  return (
    <form
      action={changeFeedbackStatus}
      style={{ display: "flex", gap: 6, alignItems: "center" }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="resolved" />
      <input
        type="text"
        name="note"
        defaultValue={note ?? ""}
        placeholder="What did we do about it?"
        style={{ width: 190 }}
        maxLength={300}
      />
      <button type="submit">Resolve</button>
    </form>
  );
}

// Save a "working on it / status" note WITHOUT resolving — so open items can
// carry a visible progress note. Prefilled with the current note if any.
function NoteForm({ id, note }: { id: string; note?: string | null }) {
  return (
    <form
      action={saveFeedbackNoteAction}
      style={{ display: "flex", gap: 6, alignItems: "center" }}
    >
      <input type="hidden" name="id" value={id} />
      <input
        type="text"
        name="note"
        defaultValue={note ?? ""}
        placeholder="Progress / working-on-it note…"
        style={{ width: 190 }}
        maxLength={300}
      />
      <button type="submit" className="secondary">
        Save note
      </button>
    </form>
  );
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; author?: string }>;
}) {
  const { status, author } = await searchParams;
  const active = status ?? "open";
  const effectiveStatus = active === "all" ? undefined : active;

  const [items, authors, workedOn] = await Promise.all([
    listFeedback(effectiveStatus, author),
    feedbackAuthorSummary(),
    listRecentlyWorkedOn(),
  ]);

  return (
    <>
      <div className="pagehead">
        <h1>Feedback inbox</h1>
        <div className="controls">
          <Link href="/board" className="btn secondary">
            Board →
          </Link>
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={qs(f.value, author)}
              className={`btn secondary${active === f.value ? " active" : ""}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Who's contributing — click a name to filter to just their feedback */}
      <div className="controls" style={{ marginBottom: 12 }}>
        <span className="muted">Contributors:</span>
        <Link
          href={qs(active)}
          className={`btn secondary${!author ? " active" : ""}`}
        >
          Everyone
        </Link>
        {authors.map((a) => (
          <Link
            key={a.author_email}
            href={qs(active, a.author_email)}
            className={`btn secondary${author === a.author_email ? " active" : ""}`}
            title={`${a.total} total · ${a.open} open`}
          >
            {a.author_email} ({a.total})
          </Link>
        ))}
      </div>

      {workedOn.length > 0 && (
        <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>✅ What we&apos;ve done with your feedback</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Recently actioned items — thanks for flagging these.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {workedOn.map((f) => (
              <div
                key={f.id}
                style={{
                  borderLeft: "3px solid var(--green, #2e7d32)",
                  paddingLeft: 12,
                }}
              >
                <div>
                  <strong>{f.resolution_note}</strong>
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {f.comment ? <>“{f.comment}” — </> : null}
                  flagged by {f.author_email}
                  {f.resolved_by ? <> · worked on by {f.resolved_by}</> : null}
                  {f.resolved_at ? <> · {amsterdamDateTime(f.resolved_at)}</> : null}
                  {" · "}
                  <Link href={`/conversations/${f.session_id}`}>chat</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="muted">
        {author ? (
          <>
            Showing feedback added by <strong>{author}</strong>.{" "}
          </>
        ) : (
          <>All team feedback across conversations. </>
        )}
        Work items to <strong>Resolved</strong> or <strong>Dismissed</strong> as
        you action them — add a short note of what you did so it shows up in the
        section above.
      </p>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Rating</th>
              <th>Tags</th>
              <th>Comment</th>
              <th>Member</th>
              <th>Added by</th>
              <th>Chat</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <React.Fragment key={f.id}>
              <tr>
                <td className="mono">{amsterdamDateTime(f.created_at)}</td>
                <td>
                  {f.rating === "good" && (
                    <span className="badge green">👍</span>
                  )}
                  {f.rating === "bad" && <span className="badge red">👎</span>}
                  {!f.rating && <span className="muted">—</span>}
                </td>
                <td>
                  <div className="faq-actions">
                    {f.tags?.map((t) => (
                      <span key={t} className="badge grey">
                        {feedbackTagLabel(t)}
                      </span>
                    ))}
                  </div>
                </td>
                <td style={{ maxWidth: 300 }}>
                  {f.detail && <div className="muted">↳ {f.detail}</div>}
                  {f.comment ?? (f.detail ? null : "—")}
                </td>
                <td>{f.session?.customer?.display_name ?? <span className="muted">—</span>}</td>
                <td className="mono">
                  {f.author_email}
                  {f.status !== "open" && f.resolved_by ? (
                    <>
                      <br />
                      <span className={`badge ${f.status === "resolved" ? "green" : "grey"}`}>
                        {f.status} · {f.resolved_by}
                      </span>
                      {f.resolution_note ? (
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                          ↳ {f.resolution_note}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {f.status === "open" && f.resolution_note ? (
                    <>
                      <br />
                      <span className="badge grey">📝 in progress</span>
                      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                        ↳ {f.resolution_note}
                      </div>
                    </>
                  ) : null}
                </td>
                <td>
                  <Link href={`/conversations/${f.session_id}`}>view</Link>
                </td>
                <td>
                  <div className="faq-actions">
                    {f.status === "open" ? (
                      <>
                        <ResolveForm id={f.id} note={f.resolution_note} />
                        <NoteForm id={f.id} note={f.resolution_note} />
                        <ActionButton id={f.id} status="dismissed" label="Dismiss" secondary />
                      </>
                    ) : (
                      <ActionButton id={f.id} status="open" label="Reopen" secondary />
                    )}
                  </div>
                </td>
              </tr>
              </React.Fragment>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 18 }}>
                  {active === "open"
                    ? "No open feedback here. 🎉"
                    : "No feedback matches these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
