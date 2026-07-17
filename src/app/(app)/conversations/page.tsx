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
    state?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = normaliseDate(sp.date);
  const outcomeFilter = sp.outcome || "";
  const stateFilter = sp.state || "";
  const q = (sp.q || "").trim().toLowerCase();

  const details = await getDigestDetails(date);

  // Outcome counts for the whole day (drive the chip labels).
  const counts = details.sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.outcome] = (acc[s.outcome] || 0) + 1;
    return acc;
  }, {});

  // Distinct states present that day, for the state dropdown.
  const states = [
    ...new Set(details.sessions.map((s) => s.state).filter(Boolean)),
  ].sort() as string[];

  let rows = details.sessions;
  if (outcomeFilter) rows = rows.filter((s) => s.outcome === outcomeFilter);
  if (stateFilter) rows = rows.filter((s) => s.state === stateFilter);
  if (q) {
    rows = rows.filter(
      (s) =>
        s.customer.toLowerCase().includes(q) ||
        (s.user_sample || "").toLowerCase().includes(q) ||
        (s.state || "").toLowerCase().includes(q),
    );
  }

  // Build a /conversations URL preserving the current filters, overriding some.
  const href = (over: Record<string, string | undefined>) => {
    const merged = { date, outcome: outcomeFilter, state: stateFilter, q: sp.q, ...over };
    const p = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    return `/conversations?${p.toString()}`;
  };

  return (
    <>
      <div className="pagehead">
        <h1>Conversations</h1>
        <form className="controls" method="get">
          <input type="date" name="date" defaultValue={date} />
          {/* keep the active outcome when changing date/state/search */}
          <input type="hidden" name="outcome" value={outcomeFilter} />
          <select name="state" defaultValue={stateFilter}>
            <option value="">All states</option>
            {states.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <input
            type="search"
            name="q"
            placeholder="Search name / message"
            defaultValue={sp.q || ""}
          />
          <button type="submit" className="secondary">
            Filter
          </button>
        </form>
      </div>

      {/* Outcome quick-filters — click to show only that status */}
      <div className="controls" style={{ marginBottom: 12 }}>
        <Link
          href={href({ outcome: undefined })}
          className={`btn secondary${!outcomeFilter ? " active" : ""}`}
        >
          All ({details.sessions.length})
        </Link>
        {OUTCOMES.map((o) => (
          <Link
            key={o}
            href={href({ outcome: o })}
            className={`btn secondary${outcomeFilter === o ? " active" : ""}`}
          >
            {OUTCOME_LABELS[o]} ({counts[o] || 0})
          </Link>
        ))}
      </div>

      <p className="muted">
        {rows.length} of {details.sessions.length} conversations on {date}
        {outcomeFilter ? ` · outcome: ${OUTCOME_LABELS[outcomeFilter as Outcome]}` : ""}
        {stateFilter ? ` · state: ${stateFilter}` : ""}
        {(outcomeFilter || stateFilter || q) && (
          <>
            {" · "}
            <Link href={`/conversations?date=${date}`}>clear filters</Link>
          </>
        )}
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
                    <Link href={`/conversations/${s.session_id}?date=${date}`}>
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
