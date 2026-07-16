import Link from "next/link";
import { listTicketConversations, reviewedSessionIds } from "@/lib/queries";
import {
  amsterdamToday,
  addDays,
  amsterdamRangeIso,
  amsterdamDateTime,
  freshdeskUrl,
  normaliseDate,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const to = normaliseDate(sp.to); // defaults to today
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from)
    ? sp.from
    : addDays(to, -6); // default: last 7 days

  const { startISO, endISO } = amsterdamRangeIso(from, to);

  const [tickets, reviewed] = await Promise.all([
    listTicketConversations(startISO, endISO),
    reviewedSessionIds(),
  ]);

  const needsReview = tickets.filter(
    (t) => !t.session_id || !reviewed.has(t.session_id),
  ).length;

  return (
    <>
      <div className="pagehead">
        <h1>Bot evaluation</h1>
        <form className="controls" method="get">
          <label className="muted">From</label>
          <input type="date" name="from" defaultValue={from} max={amsterdamToday()} />
          <label className="muted">To</label>
          <input type="date" name="to" defaultValue={to} max={amsterdamToday()} />
          <button type="submit" className="secondary">
            Go
          </button>
        </form>
      </div>

      <p className="muted">
        Conversations that led to a ticket, {from} → {to}. Open each to read the
        transcript and leave feedback / suggest an FAQ.{" "}
        <strong>{tickets.length}</strong> total ·{" "}
        <span className={needsReview > 0 ? "badge amber" : "badge green"}>
          {needsReview} need review
        </span>
      </p>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Member</th>
              <th>Subject</th>
              <th>Ticket</th>
              <th>Review</th>
              <th>Chat</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const url = freshdeskUrl(t.external_ticket_id);
              const isReviewed = !!t.session_id && reviewed.has(t.session_id);
              return (
                <tr key={t.id}>
                  <td className="mono">{amsterdamDateTime(t.created_at)}</td>
                  <td>{t.customer?.display_name ?? <span className="muted">—</span>}</td>
                  <td style={{ maxWidth: 300 }}>{t.subject ?? "—"}</td>
                  <td>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        #{t.external_ticket_id}
                      </a>
                    ) : (
                      <span className="badge red">NOT synced</span>
                    )}
                  </td>
                  <td>
                    {isReviewed ? (
                      <span className="badge green">reviewed</span>
                    ) : (
                      <span className="badge grey">needs review</span>
                    )}
                  </td>
                  <td>
                    {t.session_id ? (
                      <Link href={`/conversations/${t.session_id}`}>open</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 18 }}>
                  No ticket-leading conversations in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
