import Link from "next/link";
import {
  getDigestDetails,
  reviewedSessionIds,
  defectsBySession,
} from "@/lib/queries";
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
//  2. it gave a SUBSTANTIVE answer, not just an exchange that fizzled out,
//  3. it didn't merely hand over a self-service form URL.
//
// WHY THIS IS NOT THE VERSION THAT WAS RETIRED
// Condition 2 used to be "the member thanked it afterwards". That is the test
// this page was retired for on 9 Sep 2026: it requires the member to be polite,
// most are not, and it found ~9 conversations a week that Member Care disputed
// anyway. The question was right and the evidence was wrong.
//
// It now comes from the scorecard instead — bot.conversation_defects.answers,
// settled once in bot.is_substantive_answer (db/028) against 168 labelled
// templates, which is the definition that took the answer predicate from 38%
// to 77% precision. Boilerplate the bot sends verbatim to many members is not
// an answer; something naming the member or their data is.
//
// Condition 3 is `is_clean` — none of the scorecard's eight defect classes
// fired — rather than this page keeping its own opinion about link-only chats.
// link_only is one of those eight, so Nelly Palikara's point from 26 Aug is
// still honoured (pasting the change/extension form link "didn't really solve
// anything, nor saved the team from a ticket") and seven other ways to fail
// come along with it.
//
// WHY is_clean AND NOT JUST "IT ANSWERED"
// Measured over 5-11 Sep 2026: "answered and not link-only" finds 128 of the
// 135 candidate chats, and 19 of those had a defect anyway — 11 where the
// member ASKED FOR A HUMAN and 11 that LOOPED. Calling a conversation where
// the member gave up and asked for a person "Bot helped" is the same mistake
// that retired this page, pointed the other way. is_clean finds 109: the bot
// answered, no ticket, and nothing visibly broke.
//
// Note what clean does NOT mean, per docs/performance-scorecard.md: "nothing
// visibly broke", not "the answer was right". The bot can be fluent and wrong
// — that is the scorecard's known blind spot, it catches 28% of what Member
// Care calls bad. Which is exactly why the review buttons below still matter.
//
// A session with no scorecard row is NOT counted. The scorecard is computed per
// day and can lag; silently treating a missing row as a success would inflate
// this page exactly where it is least able to notice.
type Verdict = { answers: number; link_only: boolean; is_clean: boolean };

function helped(s: DigestSession, v: Verdict | undefined): boolean {
  if (!v) return false;
  return (
    s.outcome === "chat_only" &&
    !s.no_reply &&
    s.msg_count >= 2 &&
    v.answers >= 1 &&
    v.is_clean
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
  const [perDay, reviewed, verdicts] = await Promise.all([
    Promise.all(
      dates.map(async (d) => ({ d, details: await getDigestDetails(d) })),
    ),
    reviewedSessionIds(),
    defectsBySession(from, to),
  ]);
  const allSessions: Row[] = perDay.flatMap(({ d, details }) =>
    details.sessions.map((s) => ({ ...s, _day: d })),
  );
  const rows = allSessions.filter((s) => helped(s, verdicts.get(s.session_id)));
  // Said out loud: a day the scorecard has not reached yet cannot contribute,
  // and a quietly short list is indistinguishable from a quiet week.
  const unscored = allSessions.filter((s) => !verdicts.has(s.session_id)).length;

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
      <p className="muted" style={{ marginTop: 0, maxWidth: "76ch" }}>
        Successful conversations only: <strong>no ticket created</strong>, the
        bot replied, there was a real exchange, it gave a{" "}
        <strong>substantive answer</strong>, and{" "}
        <strong>none of the eight defect classes fired</strong>. Both of those
        last two are the <Link href="/performance">scorecard&apos;s</Link>{" "}
        definitions rather than a second opinion held here, so this page and
        Performance cannot disagree about what counts.
      </p>
      <p className="muted" style={{ marginTop: 0, maxWidth: "76ch" }}>
        <strong>Clean means nothing visibly broke, not that the answer was
        right.</strong> What the scorecard can see is loops, dead ends and
        unanswered questions; a fluent wrong answer looks clean to it, and it
        catches about 28% of what Member Care rates bad. That is what the
        review buttons are for.
      </p>
      <p className="muted" style={{ marginTop: 0, maxWidth: "76ch" }}>
        This page used to require the member to <strong>say thanks</strong>.
        That test was retired on 9 September because most members never do: over
        5&ndash;11 September it found 11 conversations where this definition
        finds 109, and it missed none that this one does not also find. Chats
        that ended without a ticket and without a clean answer are under{" "}
        <Link href="/conversations">Conversations</Link>.
        {unscored > 0 && (
          <>
            {" "}
            <strong>
              {unscored} conversation{unscored === 1 ? "" : "s"} in this window
              {unscored === 1 ? " has" : " have"} no scorecard row yet
            </strong>{" "}
            and cannot be counted either way until it is computed.
          </>
        )}
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
                  No conversations in this window where the bot answered and
                  resolved it in chat without a ticket.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
