import Link from "next/link";
import { getDigestDetailsForDays } from "@/lib/queries";
import {
  addDays,
  freshdeskUrl,
  resolveWindow,
  MAX_RANGE_DAYS,
  OUTCOME_LABELS,
  OUTCOME_TONE,
} from "@/lib/format";
import type { Outcome, DigestSession } from "@/lib/types";
import { ConversationFilters } from "./ConversationFilters";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Pager, PAGE_SIZE, pageFrom } from "@/components/Pager";

// A session tagged with the day it came from (for a multi-day window).
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
    page?: string;
  }>;
}) {
  const sp = await searchParams;

  // Window is [from, to] inclusive Amsterdam days, capped at MAX_RANGE_DAYS.
  const { from, to, days, clamped, today } = resolveWindow(sp);

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
  const perDay = await getDigestDetailsForDays(dates);
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

  // A month is ~9,000 conversations; the table renders every row server-side,
  // so it pages. Filters don't carry `page`, so changing one lands on page 1.
  const page = pageFrom(sp.page, rows.length);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const windowQuery = `from=${from}&to=${to}`;
  const clearHref = `/conversations?${windowQuery}`;
  const pageHref = (n: number) => {
    const p = new URLSearchParams({ from, to });
    for (const [k, v] of Object.entries({
      outcome: f.outcome,
      state: f.state,
      member: f.member,
      preview: f.preview,
      ticket: f.ticket,
      noreply: f.noreply ? "1" : "",
    }))
      if (v) p.set(k, v);
    if (n > 1) p.set("page", String(n));
    return `/conversations?${p.toString()}`;
  };
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
            basePath="/conversations"
            maxDays={MAX_RANGE_DAYS}
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
            capped at {MAX_RANGE_DAYS} days
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
            {pageRows.map((s) => {
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

      <Pager page={page} total={rows.length} href={pageHref} />
    </>
  );
}
