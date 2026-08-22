import Link from "next/link";
import { getDigestDetails } from "@/lib/queries";
import {
  normaliseDate,
  addDays,
  amsterdamToday,
  freshdeskUrl,
  OUTCOME_LABELS,
  OUTCOME_TONE,
} from "@/lib/format";
import type { Outcome, DigestSession } from "@/lib/types";
import { ConversationFilters } from "./ConversationFilters";
import { DateRangePicker } from "./DateRangePicker";

// A session tagged with the day it came from (for a multi-day window).
type Row = DigestSession & { _day: string };

export const dynamic = "force-dynamic";

const MAX_DAYS = 7;

// Whole days between two YYYY-MM-DD strings (inclusive of both ends).
function spanDays(from: string, to: string): number {
  const ms =
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

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
    from?: string;
    to?: string;
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

  // Window is [from, to] inclusive Amsterdam days, capped at MAX_DAYS.
  // Back-compat: old links use `date` (window end) + `range` (1|7).
  let to = normaliseDate(sp.to || sp.date);
  let from = sp.from
    ? normaliseDate(sp.from)
    : addDays(to, -((sp.range === "7" ? MAX_DAYS : 1) - 1));
  if (from > to) [from, to] = [to, from]; // ISO strings sort chronologically
  const clamped = spanDays(from, to) > MAX_DAYS;
  if (clamped) from = addDays(to, -(MAX_DAYS - 1));
  const days = clamped ? MAX_DAYS : spanDays(from, to);
  const today = amsterdamToday();

  const f = {
    outcome: sp.outcome || "",
    state: sp.state || "",
    member: sp.member || "",
    preview: sp.preview || "",
    ticket: sp.ticket || "",
    noreply: sp.noreply === "1",
  };

  // Fetch each day in the window and tag every session with its day.
  const dates = Array.from({ length: days }, (_, i) => addDays(to, -i)); // newest → oldest
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

  const windowQuery = `from=${from}&to=${to}`;
  const clearHref = `/conversations?${windowQuery}`;
  const windowLabel =
    from === to
      ? from
      : `${from} → ${to} (${days} day${days > 1 ? "s" : ""})`;

  return (
    <>
      <div className="pagehead">
        <h1>Conversations</h1>
        <div className="controls">
          <DateRangePicker
            from={from}
            to={to}
            max={today}
            preserved={{
              outcome: f.outcome,
              state: f.state,
              member: f.member,
              preview: f.preview,
              ticket: f.ticket,
              noreply: f.noreply ? "1" : "",
            }}
          />
        </div>
      </div>

      <p className="muted">
        {rows.length} of {allSessions.length} conversations{" "}
        {from === to ? `on ${from}` : `over ${windowLabel}`}
        {clamped && (
          <span className="badge amber" style={{ marginLeft: 6 }}>
            capped at {MAX_DAYS} days
          </span>
        )}
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
              key={`${from}|${to}|${f.outcome}|${f.state}|${f.member}|${f.preview}|${f.ticket}`}
              from={from}
              to={to}
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
