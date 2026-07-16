import Link from "next/link";
import { listFeedback, feedbackAuthorSummary } from "@/lib/queries";
import { amsterdamDateTime } from "@/lib/format";
import { feedbackTagLabel } from "@/lib/feedback-tags";
import { changeFeedbackStatus } from "./actions";

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

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; author?: string }>;
}) {
  const { status, author } = await searchParams;
  const active = status ?? "open";
  const effectiveStatus = active === "all" ? undefined : active;

  const [items, authors] = await Promise.all([
    listFeedback(effectiveStatus, author),
    feedbackAuthorSummary(),
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

      <p className="muted">
        {author ? (
          <>
            Showing feedback added by <strong>{author}</strong>.{" "}
          </>
        ) : (
          <>All team feedback across conversations. </>
        )}
        Work items to <strong>Resolved</strong> or <strong>Dismissed</strong> as
        you action them.
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
              <tr key={f.id}>
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
                <td style={{ maxWidth: 300 }}>{f.comment ?? "—"}</td>
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
                </td>
                <td>
                  <Link href={`/conversations/${f.session_id}`}>view</Link>
                </td>
                <td>
                  <div className="faq-actions">
                    {f.status === "open" ? (
                      <>
                        <ActionButton id={f.id} status="resolved" label="Resolve" />
                        <ActionButton id={f.id} status="dismissed" label="Dismiss" secondary />
                      </>
                    ) : (
                      <ActionButton id={f.id} status="open" label="Reopen" secondary />
                    )}
                  </div>
                </td>
              </tr>
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
