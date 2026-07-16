import Link from "next/link";
import { listBoardItems } from "@/lib/queries";
import { amsterdamDateTime } from "@/lib/format";
import type { BoardItemView, BoardPriority, BoardStatus } from "@/lib/types";
import { AddBoardItemForm } from "./AddBoardItemForm";
import { moveBoardItem } from "./actions";

export const dynamic = "force-dynamic";

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

export default async function BoardPage() {
  const items = await listBoardItems();
  const byStatus = (s: BoardStatus) => items.filter((i) => i.status === s);

  return (
    <>
      <div className="pagehead">
        <h1>Board</h1>
        <div className="controls">
          <Link href="/feedback" className="btn secondary">
            ← Conversation feedback
          </Link>
        </div>
      </div>

      <p className="muted">
        Team board for issues and requests (not tied to a conversation). Add
        priority and image attachments.
      </p>

      <div style={{ marginBottom: 16 }}>
        <AddBoardItemForm />
      </div>

      <div className="board-columns">
        {COLUMNS.map((col) => {
          const colItems = byStatus(col.status);
          return (
            <div key={col.status} className="board-col">
              <h2 className="board-col-head">
                {col.label} <span className="muted">({colItems.length})</span>
              </h2>
              {colItems.map((item) => (
                <Card key={item.id} item={item} />
              ))}
              {colItems.length === 0 && (
                <div className="muted board-empty">Nothing here.</div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
