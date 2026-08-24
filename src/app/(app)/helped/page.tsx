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

// "The bot helped" = it handled the conversation in chat without needing a
// ticket (chat_only), it actually replied to the member (not a no-reply),
// and there was a real exchange (at least a question and an answer).
function helped(s: DigestSession): boolean {
  return s.outcome === "chat_only" && !s.no_reply && s.msg_count >= 2;
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

      <p className="muted" style={{ marginTop: -4 }}>
        Conversations the bot resolved on its own — it answered the member in
        chat, with no ticket needed. {from === to ? `On ${from}.` : `Over ${windowLabel}.`}
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
                  No self-service resolutions in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
