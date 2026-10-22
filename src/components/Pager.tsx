import Link from "next/link";

/**
 * Page size for the conversation tables. A month is ~9,000 sessions and the
 * pages render every row server-side, so the window got wider (31 days) and
 * the table got a page. 250 keeps the HTML under a few hundred KB and still
 * shows a whole busy day at once.
 */
export const PAGE_SIZE = 250;

/** Clamp a ?page= param to a real page index (1-based). */
export function pageFrom(raw: string | undefined, total: number): number {
  const n = Number(raw);
  const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, last);
}

/**
 * Prev/next pager. `href(page)` builds the link, so each page keeps its own
 * window and filters without this component knowing about them.
 */
export function Pager({
  page,
  total,
  href,
}: {
  page: number;
  total: number;
  href: (page: number) => string;
}) {
  const last = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (last <= 1) return null;
  const first = (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="pager">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn secondary pager-btn">
          ‹ Previous
        </Link>
      ) : (
        <span className="btn secondary pager-btn disabled">‹ Previous</span>
      )}
      <span className="muted">
        {first.toLocaleString("en-GB")}–{lastRow.toLocaleString("en-GB")} of{" "}
        {total.toLocaleString("en-GB")} · page {page} of {last}
      </span>
      {page < last ? (
        <Link href={href(page + 1)} className="btn secondary pager-btn">
          Next ›
        </Link>
      ) : (
        <span className="btn secondary pager-btn disabled">Next ›</span>
      )}
    </div>
  );
}
