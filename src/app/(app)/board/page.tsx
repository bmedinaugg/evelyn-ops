import Link from "next/link";
import { listBoardItems } from "@/lib/queries";
import { amsterdamDateTime, amsterdamToday, addDays, normaliseDate } from "@/lib/format";
import type { BoardItemView, BoardPriority, BoardStatus } from "@/lib/types";
import { AddBoardItemForm } from "./AddBoardItemForm";
import { CommentForm } from "./CommentForm";
import { moveBoardItem } from "./actions";
import { DateRangePicker } from "@/components/DateRangePicker";

export const dynamic = "force-dynamic";

// Default window: the last 4 weeks of board items (by created date).
const DEFAULT_WEEKS = 4;

const PRIORITY_TONE: Record<BoardPriority, string> = {
  low: "grey",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

const COLUMNS: { status: BoardStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

function MoveButton({
  id,
  status,
  label,
  secondary,
}: {
  id: string;
  status: BoardStatus;
  label: string;
  secondary?: boolean;
}) {
  return (
    <form action={moveBoardItem}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={secondary ? "secondary" : undefined}>
        {label}
      </button>
    </form>
  );
}

function Card({ item }: { item: BoardItemView }) {
  return (
    <div className="board-card">
      <div className="board-card-head">
        <span className={`badge ${PRIORITY_TONE[item.priority]}`}>
          {item.priority}
        </span>
        <span className="board-title">{item.title}</span>
      </div>
      {item.description && <div className="board-desc">{item.description}</div>}
      {item.images.length > 0 && (
        <div className="board-thumbs">
          {item.images.map((img) =>
            img.url ? (
              <a key={img.path} href={img.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="attachment" className="board-thumb" />
              </a>
            ) : null,
          )}
        </div>
      )}
      <div className="board-meta muted">
        {item.author_email} · {amsterdamDateTime(item.created_at)}
      </div>

      <div className="board-comments">
        <details className="board-replies">
          <summary className="board-replies-summary">
            {item.comments.length > 0
              ? `💬 ${item.comments.length} ${
                  item.comments.length === 1 ? "reply" : "replies"
                }`
              : "💬 Add a reply"}
          </summary>
          {item.comments.length > 0 && (
          <div className="board-comment-list">
            {item.comments.map((c) => (
              <div key={c.id} className="board-comment">
                <div className="board-comment-body">{c.body}</div>
                {c.images.length > 0 && (
                  <div className="board-thumbs">
                    {c.images.map((img) =>
                      img.url ? (
                        <a
                          key={img.path}
                          href={img.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
                            alt="attachment"
                            className="board-thumb"
                          />
                        </a>
                      ) : null,
                    )}
                  </div>
                )}
                <div className="board-comment-meta muted">
                  {c.author_email} · {amsterdamDateTime(c.created_at)}
                </div>
              </div>
            ))}
          </div>
          )}
          <CommentForm boardItemId={item.id} />
        </details>
      </div>

      <div className="board-actions faq-actions">
        {item.status !== "open" && (
          <MoveButton id={item.id} status="open" label="Reopen" secondary />
        )}
        {item.status === "open" && (
          <MoveButton id={item.id} status="in_progress" label="Start" />
        )}
        {item.status === "in_progress" && (
          <MoveButton id={item.id} status="done" label="Done" />
        )}
        {item.status === "done" && (
          <MoveButton id={item.id} status="in_progress" label="Back" secondary />
        )}
        <MoveButton id={item.id} status="dismissed" label="Dismiss" secondary />
      </div>
    </div>
  );
}

const COLUMN_PREVIEW = 8; // cards shown per column before "Show all"

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    expand?: string;
    from?: string;
    to?: string;
    all?: string;
  }>;
}) {
  const sp = await searchParams;
  const { expand } = sp;
  const allMode = sp.all === "1"; // ignore the week range, list everything

  // Week-range view: items created within [from, to]. Default = last 4 weeks.
  const today = amsterdamToday();
  let to = normaliseDate(sp.to || today);
  let from = sp.from
    ? normaliseDate(sp.from)
    : addDays(to, -(DEFAULT_WEEKS * 7 - 1));
  if (from > to) [from, to] = [to, from];

  const items = allMode
    ? await listBoardItems()
    : await listBoardItems(from, to);
  const byStatus = (s: BoardStatus) => items.filter((i) => i.status === s);

  // Preserve the active window (and expansion) across show-more / picker links.
  const win = allMode ? "all=1" : `from=${from}&to=${to}`;

  return (
    <>
      <div className="pagehead">
        <h1>Board</h1>
        <div className="controls">
          <Link href="/feedback" className="btn secondary">
            ← Conversation feedback
          </Link>
          <DateRangePicker
            from={from}
            to={to}
            max={today}
            basePath="/board"
          />
          <Link
            href="/board?all=1"
            className={`btn secondary${allMode ? " active" : ""}`}
          >
            All
          </Link>
        </div>
      </div>

      <p className="muted">
        Team board for issues and requests (not tied to a conversation).{" "}
        {allMode ? (
          <>Showing all items.</>
        ) : (
          <>
            Showing items created <strong>{from}</strong> →{" "}
            <strong>{to}</strong>.
          </>
        )}{" "}
        Add priority and image attachments.
      </p>

      <div style={{ marginBottom: 16 }}>
        <AddBoardItemForm />
      </div>

      <div className="board-columns">
        {COLUMNS.map((col) => {
          const colItems = byStatus(col.status);
          const isExpanded = expand === col.status;
          const shown =
            isExpanded ? colItems : colItems.slice(0, COLUMN_PREVIEW);
          const hidden = colItems.length - shown.length;
          return (
            <div key={col.status} className="board-col">
              <h2 className="board-col-head">
                {col.label} <span className="muted">({colItems.length})</span>
              </h2>
              {shown.map((item) => (
                <Card key={item.id} item={item} />
              ))}
              {colItems.length === 0 && (
                <div className="muted board-empty">Nothing here.</div>
              )}
              {hidden > 0 && (
                <Link
                  href={`/board?${win}&expand=${col.status}`}
                  className="btn secondary board-showmore"
                >
                  Show {hidden} more ↓
                </Link>
              )}
              {isExpanded && colItems.length > COLUMN_PREVIEW && (
                <Link href={`/board?${win}`} className="btn secondary board-showmore">
                  Show fewer ↑
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
