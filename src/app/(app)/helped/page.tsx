import Link from "next/link";
import { getDigestDetails, reviewedSessionIds } from "@/lib/queries";
import {
  normaliseDate,
  addDays,
  amsterdamToday,
  rangeDays,
} from "@/lib/format";
import type { DigestSession } from "@/lib/types";
import { DateRangePicker } from "@/components/DateRangePicker";
import { markHelpedAction, markNotHelpedAction } from "./actions";

export const dynamic = "force-dynamic";

const MAX_DAYS = 7;

// A session tagged with the day it came from.
type Row = DigestSession & { _day: string };

// "The bot helped" = a genuine success, on three counts:
//  1. no ticket was created — the bot handled it in chat (chat_only), it
//     actually replied (not a no-reply), and there was a real exchange,
//  2. the member thanked it afterwards (see `thanked` in daily_digest_details),
//  3. it didn't merely hand over a self-service form URL.
// The second condition separates "didn't need a ticket" from "actually helped":
// plenty of chat_only conversations simply fizzle out.
// The third comes from Nelly Palikara (26 Aug): pasting the change/extension
// form link "didn't really solve anything, nor saved the team from a ticket" —
// the member still files it themselves, so it lands on Member Care regardless.
// Her exception is honoured: if the bot answered something real in the same
// chat (answered_count >= 1), it still counts.
function helped(s: DigestSession): boolean {
  const linkOnly = !!s.self_service_link && (s.answered_count ?? 0) < 1;
  return (
    s.outcome === "chat_only" &&
    !s.no_reply &&
    s.msg_count >= 2 &&
    !!s.thanked &&
    !linkOnly
  );
}

export default async function HelpedPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    date?: string;
    range?: string;
  }>;
}) {
  const sp = await searchParams;

  // Window is [from, to] inclusive, capped at MAX_DAYS.
  // Back-compat: old links use `date` (window end) + `range` (1|7).
  let to = normaliseDate(sp.to || sp.date);
  let from = sp.from
    ? normaliseDate(sp.from)
    : addDays(to, -((sp.range === "7" ? MAX_DAYS : 1) - 1));
  if (from > to) [from, to] = [to, from];
  const clamped = rangeDays(from, to) > MAX_DAYS;
  if (clamped) from = addDays(to, -(MAX_DAYS - 1));
  const days = clamped ? MAX_DAYS : rangeDays(from, to);
  const today = amsterdamToday();

  const dates = Array.from({ length: days }, (_, i) => addDays(to, -i)); // newest → oldest
  const [perDay, reviewed] = await Promise.all([
    Promise.all(
      dates.map(async (d) => ({ d, details: await getDigestDetails(d) })),
    ),
    reviewedSessionIds(),
  ]);
  const allSessions: Row[] = perDay.flatMap(({ d, details }) =>
    details.sessions.map((s) => ({ ...s, _day: d })),
  );
  const rows = allSessions.filter(helped);

  const windowLabel =
    from === to ? from : `${from} → ${to} (${days} day${days > 1 ? "s" : ""})`;

  return (
    <>
      <div className="pagehead">
        <h1>Bot helped</h1>
        <div className="controls">
          <DateRangePicker
            from={from}
            to={to}
            max={today}
            basePath="/helped"
            maxDays={MAX_DAYS}
          />
        </div>
      </div>

      <p style={{ marginTop: -4 }}>
        <strong>{rows.length}</strong> helped{" "}
        {rows.length === 1 ? "conversation" : "conversations"}{" "}
        <span className="muted">
          {from === to ? `on ${from}` : `over ${windowLabel}`}
        </span>
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        Successful conversations only: the bot answered in chat with{" "}
        <strong>no ticket created</strong>, and the member{" "}
        <strong>thanked it</strong> afterwards. Chats that ended without a
        ticket but also without a thank-you aren&apos;t counted here — you can
        still find them under <Link href="/conversations">Conversations</Link>.
      </p>
      <p className="muted" style={{ marginTop: 0 }}>
        Reviewing? If the bot genuinely helped, mark{" "}
        <strong>👍 Helped</strong>. If it didn&apos;t, add a short explanation
        of what went wrong and it&apos;ll be sent to the{" "}
        <Link href="/feedback">Feedback inbox</Link> for the team to fix.
      </p>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Member</th>
              <th className="num">Msgs</th>
              <th>What they asked</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.session_id}>
                <td className="mono">
                  <Link href={`/conversations/${s.session_id}?date=${s._day}`}>
                    {days > 1 ? `${s._day} ` : ""}
                    {s.first_at}–{s.last_at}
                  </Link>
                </td>
                <td>{s.customer}</td>
                <td className="num">{s.msg_count}</td>
                <td className="truncate muted">{s.user_sample ?? ""}</td>
                <td>
                  {reviewed.has(s.session_id) ? (
                    <span className="muted">
                      ✓ reviewed ·{" "}
                      <Link href="/feedback">see Feedback</Link>
                    </span>
                  ) : (
                    <div
                      className="faq-actions"
                      style={{ gap: 6, alignItems: "center" }}
                    >
                      <form action={markHelpedAction}>
                        <input
                          type="hidden"
                          name="session_id"
                          value={s.session_id}
                        />
                        <button type="submit" className="secondary">
                          👍 Helped
                        </button>
                      </form>
                      <form
                        action={markNotHelpedAction}
                        style={{ display: "flex", gap: 6, alignItems: "center" }}
                      >
                        <input
                          type="hidden"
                          name="session_id"
                          value={s.session_id}
                        />
                        <input
                          type="text"
                          name="explanation"
                          placeholder="Why it didn't help…"
                          style={{ width: 180 }}
                          maxLength={300}
                          required
                        />
                        <button type="submit" className="secondary">
                          👎 Didn&apos;t help → Feedback
                        </button>
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 18 }}>
                  No conversations in this window where the bot resolved it in
                  chat and the member said thanks.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
