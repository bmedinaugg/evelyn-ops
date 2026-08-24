import Link from "next/link";
import React from "react";
import { listFeedback, feedbackAuthorSummary } from "@/lib/queries";
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

const PAGE_SIZE = 20;

// Build a /feedback URL. Changing status/author resets to page 1 (omit page);
// pass a page to move within the current filter.
function qs(status: string, author?: string, page?: number): string {
  const p = new URLSearchParams();
  p.set("status", status);
  if (author) p.set("author", author);
  if (page && page > 1) p.set("page", String(page));
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

// Save a note WITHOUT changing status — reused for two cases:
//  - OPEN items: a "working on it / progress" note.
//  - RESOLVED / DISMISSED items: record "what was done" after review, kept
//    on the same feedback item (updates the resolution note in place).
// Prefilled with the current note if any.
function NoteForm({
  id,
  note,
  placeholder = "Progress / working-on-it note…",
  label = "Save note",
}: {
  id: string;
  note?: string | null;
  placeholder?: string;
  label?: string;
}) {
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
        placeholder={placeholder}
        style={{ width: 190 }}
        maxLength={300}
      />
      <button type="submit" className="secondary">
        {label}
      </button>
    </form>
  );
}

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; author?: string; page?: string }>;
}) {
  const { status, author, page: pageParam } = await searchParams;
  // Default to "all" so resolved/dismissed items (with their "What was done"
  // note) stay visible, not just open ones.
  const active = status ?? "all";
  const effectiveStatus = active === "all" ? undefined : active;
  const page = Math.max(1, Number(pageParam) || 1);

  const [{ items, total }, authors] = await Promise.all([
    listFeedback(effectiveStatus, author, page, PAGE_SIZE),
    feedbackAuthorSummary(),
  ]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

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

      <p className="muted">
        {author ? (
          <>
            Feedback added by <strong>{author}</strong>.{" "}
          </>
        ) : (
          <>All team feedback across conversations. </>
        )}
        {total > 0 ? (
          <>
            Showing <strong>{firstRow}–{lastRow}</strong> of{" "}
            <strong>{total}</strong>.{" "}
          </>
        ) : null}
        Work items to <strong>Resolved</strong> or <strong>Dismissed</strong> as
        you action them — add a short note of what you did in the{" "}
        <strong>What was done</strong> column so it stays on the item.
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
              <th>What was done</th>
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
                    </>
                  ) : null}
                  {f.status === "open" && f.resolution_note ? (
                    <>
                      <br />
                      <span className="badge grey">📝 in progress</span>
                    </>
                  ) : null}
                </td>
                <td style={{ maxWidth: 260 }}>
                  {f.resolution_note ? (
                    <span className="muted">{f.resolution_note}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
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
                      <>
                        <NoteForm
                          id={f.id}
                          note={f.resolution_note}
                          placeholder="What was done after review…"
                          label="Save"
                        />
                        <ActionButton id={f.id} status="open" label="Reopen" secondary />
                      </>
                    )}
                  </div>
                </td>
              </tr>
              </React.Fragment>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={9} className="muted" style={{ padding: 18 }}>
                  {active === "open"
                    ? "No open feedback here. 🎉"
                    : "No feedback matches these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div
          className="controls"
          style={{ marginTop: 14, justifyContent: "space-between" }}
        >
          {page > 1 ? (
            <Link
              href={qs(active, author, page - 1)}
              className="btn secondary"
            >
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              href={qs(active, author, page + 1)}
              className="btn secondary"
            >
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </>
  );
}
