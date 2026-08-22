import Link from "next/link";
import { getDigestDetails } from "@/lib/queries";
import {
  normaliseDate,
  addDays,
  freshdeskUrl,
  OUTCOME_LABELS,
  OUTCOME_TONE,
} from "@/lib/format";
import type { Outcome, DigestSession } from "@/lib/types";
import { ConversationFilters } from "./ConversationFilters";

// A session tagged with the day it came from (for the 7-day view).
type Row = DigestSession & { _day: string };

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
    range?: string;
    outcome?: string;
    state?: string;
    member?: string;
    preview?: string;
    ticket?: string;
    noreply?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = normaliseDate(sp.date); // window END (inclusive)
  const range = sp.range === "7" ? "7" : "1";
  const days = range === "7" ? 7 : 1;
  const f = {
    outcome: sp.outcome || "",
    state: sp.state || "",
    member: sp.member || "",
    preview: sp.preview || "",
    ticket: sp.ticket || "",
    noreply: sp.noreply === "1",
  };

  // Fetch each day in the window and tag every session with its day.
  const dates = Array.from({ length: days }, (_, i) => addDays(date, -i)); // newest → oldest
  const perDay = await Promise.all(
    dates.map(async (d) => ({ d, details: await getDigestDetails(d) })),
  );
  const allSessions: Row[] = perDay.flatMap(({ d, details }) =>
    details.sessions.map((s) => ({ ...s, _day: d })),
  );
  const noReplyCount = allSessions.filter((s) => s.no_reply).length;

  // Per-outcome counts across the window (shown in the outcome dropdown).
  const counts = allSessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.outcome] = (acc[s.outcome] || 0) + 1;
    return acc;
  }, {});
  const outcomeOptions = OUTCOMES.map((o) => ({
    value: o,
    label: OUTCOME_LABELS[o],
    count: counts[o] || 0,
  }));

  const states = [
    ...new Set(allSessions.map((s) => s.state).filter(Boolean)),
  ].sort() as string[];

  const memberQ = f.member.toLowerCase();
  const previewQ = f.preview.toLowerCase();
  const rows = allSessions.filter((s) => {
    if (f.outcome && s.outcome !== f.outcome) return false;
    if (f.state && s.state !== f.state) return false;
    if (memberQ && !s.customer.toLowerCase().includes(memberQ)) return false;
    if (previewQ && !(s.user_sample || "").toLowerCase().includes(previewQ))
      return false;
    if (f.ticket === "has" && !s.ticket) return false;
    if (f.ticket === "none" && s.ticket) return false;
    if (f.ticket === "unsynced" && !(s.ticket && !s.ticket.fd_id)) return false;
    if (f.noreply && !s.no_reply) return false;
    return true;
  });

  const anyFilter = Boolean(
    f.outcome || f.state || f.member || f.preview || f.ticket || f.noreply,
  );

  const rangeSuffix = range === "7" ? "&range=7" : "";
  const clearHref = `/conversations?date=${date}${rangeSuffix}`;
  const rangeHref = (r: string) => `/conversations?date=${date}&range=${r}`;
  const windowLabel =
    days === 1 ? date : `${dates[dates.length - 1]} → ${dates[0]} (7 days)`;

  return (
    <>
      <div className="pagehead">
        <h1>Conversations</h1>
        <div className="controls">
          {[
            { value: "1", label: "1 day" },
            { value: "7", label: "7 days" },
          ].map((r) => (
            <Link
              key={r.value}
              href={rangeHref(r.value)}
              className={`btn secondary${range === r.value ? " active" : ""}`}
            >
              {r.label}
            </Link>
          ))}
          <form className="controls" method="get" style={{ margin: 0 }}>
            <label className="muted">{days === 1 ? "Day" : "Ending"}</label>
            <input type="date" name="date" defaultValue={date} />
            <input type="hidden" name="range" value={range} />
            <button type="submit" className="secondary">
              Go
            </button>
          </form>
        </div>
      </div>

      <p className="muted">
        {rows.length} of {allSessions.length} conversations{" "}
        {days === 1 ? `on ${date}` : `over ${windowLabel}`}
        {anyFilter && (
          <>
            {" · "}
            <Link href={clearHref}>clear filters</Link>
          </>
        )}
        <span style={{ marginLeft: 8 }}>· filter within the columns below</span>
      </p>

      {noReplyCount > 0 && (
        <p>
          <span className="badge red">⚠ {noReplyCount} no reply</span>{" "}
          <span className="muted">
            — the bot received the member&apos;s last message but never sent a
            reply (an “&lt;Empty Response&gt;” in chat).{" "}
          </span>
          {f.noreply ? (
            <Link href={clearHref}>show all</Link>
          ) : (
            <Link href={`${clearHref}&noreply=1`}>show only these</Link>
          )}
        </p>
      )}

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
              key={`${date}|${range}|${f.outcome}|${f.state}|${f.member}|${f.preview}|${f.ticket}`}
              date={date}
              range={range}
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
                    <Link href={`/conversations/${s.session_id}?date=${s._day}`}>
                      {days > 1 ? `${s._day} ` : ""}
                      {s.first_at}–{s.last_at}
                    </Link>
                  </td>
                  <td>{s.customer}</td>
                  <td className="num">{s.msg_count}</td>
                  <td className="muted">
                    {s.state ?? "—"}
                    {s.no_reply && (
                      <>
                        {" "}
                        <span
                          className="badge red"
                          title="The bot never replied to the member's last message"
                        >
                          ⚠ no reply
                        </span>
                      </>
                    )}
                  </td>
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
