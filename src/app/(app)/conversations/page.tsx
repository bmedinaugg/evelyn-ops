import Link from "next/link";
import { getDigestDetails } from "@/lib/queries";
import {
  normaliseDate,
  freshdeskUrl,
  OUTCOME_LABELS,
  OUTCOME_TONE,
} from "@/lib/format";
import type { Outcome } from "@/lib/types";
import { ConversationFilters } from "./ConversationFilters";

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
    member?: string;
    preview?: string;
    ticket?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = normaliseDate(sp.date);
  const f = {
    outcome: sp.outcome || "",
    state: sp.state || "",
    member: sp.member || "",
    preview: sp.preview || "",
    ticket: sp.ticket || "",
  };

  const details = await getDigestDetails(date);

  // Per-outcome counts for the whole day (shown in the outcome dropdown).
  const counts = details.sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.outcome] = (acc[s.outcome] || 0) + 1;
    return acc;
  }, {});
  const outcomeOptions = OUTCOMES.map((o) => ({
    value: o,
    label: OUTCOME_LABELS[o],
    count: counts[o] || 0,
  }));

  const states = [
    ...new Set(details.sessions.map((s) => s.state).filter(Boolean)),
  ].sort() as string[];

  const memberQ = f.member.toLowerCase();
  const previewQ = f.preview.toLowerCase();
  const rows = details.sessions.filter((s) => {
    if (f.outcome && s.outcome !== f.outcome) return false;
    if (f.state && s.state !== f.state) return false;
    if (memberQ && !s.customer.toLowerCase().includes(memberQ)) return false;
    if (previewQ && !(s.user_sample || "").toLowerCase().includes(previewQ))
      return false;
    if (f.ticket === "has" && !s.ticket) return false;
    if (f.ticket === "none" && s.ticket) return false;
    if (f.ticket === "unsynced" && !(s.ticket && !s.ticket.fd_id)) return false;
    return true;
  });

  const anyFilter = Boolean(
    f.outcome || f.state || f.member || f.preview || f.ticket,
  );

  return (
    <>
      <div className="pagehead">
        <h1>Conversations</h1>
        <form className="controls" method="get">
          <label className="muted">Day</label>
          <input type="date" name="date" defaultValue={date} />
          <button type="submit" className="secondary">
            Go
          </button>
        </form>
      </div>

      <p className="muted">
        {rows.length} of {details.sessions.length} conversations on {date}
        {anyFilter && (
          <>
            {" · "}
            <Link href={`/conversations?date=${date}`}>clear filters</Link>
          </>
        )}
        <span style={{ marginLeft: 8 }}>· filter within the columns below</span>
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
            <ConversationFilters
              key={`${date}|${f.outcome}|${f.state}|${f.member}|${f.preview}|${f.ticket}`}
              date={date}
              values={f}
              states={states}
              outcomeOptions={outcomeOptions}
            />
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
