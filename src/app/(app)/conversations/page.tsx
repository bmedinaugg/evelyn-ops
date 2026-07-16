import Link from "next/link";
import { getDigestDetails } from "@/lib/queries";
import {
  normaliseDate,
  freshdeskUrl,
  OUTCOME_LABELS,
  OUTCOME_TONE,
} from "@/lib/format";
import type { Outcome } from "@/lib/types";

export const dynamic = "force-dynamic";

const OUTCOMES: Outcome[] = [
  "ticket_created",
  "ticket_not_synced",
  "abandoned_mid_ticket",
  "auth_dropoff",
  "chat_only",
];

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string;
    outcome?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = normaliseDate(sp.date);
  const outcomeFilter = sp.outcome || "";
  const q = (sp.q || "").trim().toLowerCase();

  const details = await getDigestDetails(date);

  let rows = details.sessions;
  if (outcomeFilter) rows = rows.filter((s) => s.outcome === outcomeFilter);
  if (q) {
    rows = rows.filter(
      (s) =>
        s.customer.toLowerCase().includes(q) ||
        (s.user_sample || "").toLowerCase().includes(q) ||
        (s.state || "").toLowerCase().includes(q),
    );
  }

  return (
    <>
      <div className="pagehead">
        <h1>Conversations</h1>
        <form className="controls" method="get">
          <input type="date" name="date" defaultValue={date} />
          <select name="outcome" defaultValue={outcomeFilter}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
          <input
            type="search"
            name="q"
            placeholder="Search name / message / state"
            defaultValue={sp.q || ""}
          />
          <button type="submit" className="secondary">
            Filter
          </button>
        </form>
      </div>

      <p className="muted">
        {rows.length} of {details.sessions.length} conversations on {date}
      </p>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Member</th>
              <th className="num">Msgs</th>
              <th>State</th>
              <th>Outcome</th>
              <th>Ticket</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const url = freshdeskUrl(s.ticket?.fd_id);
              return (
                <tr key={s.session_id}>
                  <td className="mono">
                    <Link
                      href={`/conversations/${s.session_id}?date=${date}`}
                    >
                      {s.first_at}–{s.last_at}
                    </Link>
                  </td>
                  <td>{s.customer}</td>
                  <td className="num">{s.msg_count}</td>
                  <td className="muted">{s.state ?? "—"}</td>
                  <td>
                    <span className={`badge ${OUTCOME_TONE[s.outcome]}`}>
                      {OUTCOME_LABELS[s.outcome]}
                    </span>
                  </td>
                  <td>
                    {s.ticket ? (
                      url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          #{s.ticket.fd_id}
                        </a>
                      ) : (
                        <span className="badge red">NOT synced</span>
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="truncate muted">{s.user_sample ?? ""}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 18 }}>
                  No conversations match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
