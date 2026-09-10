import Link from "next/link";
import {
  getPerformanceMetrics,
  listDefectConversations,
  listChangeImpact,
  getScorecardValidation,
} from "@/lib/queries";
import { amsterdamToday, addDays, normaliseDate } from "@/lib/format";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Tile, Info } from "@/components/Tile";
import type { DefectClass } from "@/lib/types";

export const dynamic = "force-dynamic";

// What each class means, and — the part that makes this a work queue rather
// than a wall of numbers — who would fix it.
const CLASS_INFO: Record<DefectClass, { label: string; what: string }> = {
  no_answer: {
    label: "No answer attempt",
    what: "Four or more member turns and not one substantive reply. They kept trying and got nothing.",
  },
  loop: {
    label: "Repeated itself",
    what: "The bot sent the same reply twice or more (three times for a ticket preview, which can legitimately be re-shown).",
  },
  asked_for_human: {
    label: "Asked for a human",
    what: "The member asked to reach a person, by phone, e-mail or agent. Calm or not, it means the bot did not settle it.",
  },
  auth_deadend: {
    label: "Stuck at login",
    what: "The chat ended inside the e-mail/OTP flow AND never produced an answer. A non-member who asked a question and got a real reply is NOT counted here.",
  },
  abandoned_mid_ticket: {
    label: "Abandoned mid-ticket",
    what: "A draft was open and no ticket ever reached Freshdesk. The member described their problem and it went nowhere.",
  },
  duplicate_ticket: {
    label: "Duplicate tickets",
    what: "Two distinct Freshdesk tickets out of one conversation.",
  },
  wrong_language: {
    label: "Wrong language",
    what: "The member wrote unambiguously in one language and got a substantive answer in the other. Deliberately strict, so it fires rarely.",
  },
  link_only: {
    label: "Link only",
    what: "Handed over a self-service form URL and answered nothing. The member still files it themselves, so it lands on Member Care regardless.",
  },
};

const ORDER: DefectClass[] = [
  "no_answer",
  "loop",
  "asked_for_human",
  "auth_deadend",
  "abandoned_mid_ticket",
  "duplicate_ticket",
  "wrong_language",
  "link_only",
];

function pct(n: number, of: number): number {
  return of > 0 ? Math.round((1000 * n) / of) / 10 : 0;
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; c?: string }>;
}) {
  const sp = await searchParams;
  const to = normaliseDate(sp.to);
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -6);

  const rawC = String(sp.c || "").trim();
  const filter: string | null =
    rawC === "clean" || (ORDER as string[]).includes(rawC) ? rawC : null;

  const [metrics, rows, impact, validation] = await Promise.all([
    getPerformanceMetrics(from, to),
    listDefectConversations(from, to, filter, 50),
    listChangeImpact(14),
    getScorecardValidation(),
  ]);

  const qs = (c: string | null) => {
    const p = new URLSearchParams({ from, to });
    if (c) p.set("c", c);
    return `/performance?${p.toString()}`;
  };

  const total = metrics.conversations;
  const counts = new Map(metrics.defects.map((d) => [d.class, d.n]));
  const maxDefect = Math.max(1, ...metrics.defects.map((d) => d.n));
  const cleanPct = metrics.clean_pct ?? 0;

  return (
    <>
      <div className="pagehead">
        <h1>Performance</h1>
        <div className="controls">
          <DateRangePicker
            from={from}
            to={to}
            max={amsterdamToday()}
            basePath="/performance"
          />
        </div>
      </div>

      <p className="muted" style={{ marginBottom: 10 }}>
        Did Evelyn do her job, {from} → {to}. Measured from the transcript — no
        model, no judgement call.
      </p>

      <details className="panel" style={{ marginBottom: 12 }}>
        <summary>How this is measured, and what it is not</summary>
        <div style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.55 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Every number here is <strong>counted from the conversation</strong>,
            not judged by a language model. That matters for one specific
            reason: a deterministic metric can be <em>recomputed over all
            history</em>, so when a definition changes every past week rebuilds
            with it and the baseline never shifts underneath you. That is the
            only way the &ldquo;did our fix help?&rdquo; table at the bottom can
            mean anything.
          </p>
          <p className="muted">
            The one judgement in the whole scorecard is{" "}
            <strong>&ldquo;did the bot actually answer?&rdquo;</strong>, and it
            is settled once: a reply counts if it is over 80 characters, is not
            a self-service form link, not a ticket preview or confirmation, not
            a &ldquo;which one would you like?&rdquo; prompt, and is not one of
            the ~170 boilerplate templates on file. Boilerplate is found by
            frequency — the bot sends it verbatim to many members — while a real
            answer names the member or their data and so never repeats. A
            repeated <strong>FAQ</strong> reply still counts as an answer.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            <strong>Clean does not mean good.</strong> It means{" "}
            <em>no detected defect</em>. A conversation can be clean and still
            have a wrong answer in it — nothing here checks whether what the bot
            said was true. For that, use{" "}
            <Link href="/feedback">Feedback</Link>.
          </p>
        </div>
      </details>

      <div className="grid tiles compact">
        <Tile
          k="Clean"
          v={`${cleanPct}%`}
          sub={`${metrics.clean.toLocaleString()} of ${total.toLocaleString()}`}
          info="Conversations with none of the eight defects. Not a quality score — it means nothing went visibly wrong, not that the answer was right."
          tone={cleanPct < 40 ? "alert" : cleanPct < 60 ? "warn" : undefined}
        />
        <Tile
          k="Answered"
          v={metrics.answered_pct != null ? `${metrics.answered_pct}%` : "—"}
          sub={`${metrics.answered.toLocaleString()} got a real reply`}
          info="Conversations where the bot produced at least one substantive answer — excluding form links, auth boilerplate, ticket previews and 'which one?' prompts."
        />
        <Tile
          k="Conversations"
          v={total.toLocaleString()}
          sub={`${from} → ${to}`}
          info="Every conversation that started in this range. A conversation belongs to the day of its first message."
        />
        <Tile
          k="Last computed"
          v={
            metrics.last_computed
              ? new Date(metrics.last_computed).toLocaleTimeString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"
          }
          sub="refreshed every 10 min"
          info="The scorecard is precomputed by the batch, not calculated when you open this page."
        />
      </div>

      {/* The blind spot goes directly under the headline, not in a footnote.
          Measured against Member Care's own labels: the scorecard catches a
          minority of what they call bad, and the misses are all the same
          shape — a fluent answer that happens to be false. Anyone reading
          "clean" as "good" is being misled, so the page says so where the
          number is, not three scrolls down. */}
      <div className="panel" style={{ padding: 14, marginTop: 12 }}>
        <span className="badge amber">blind spot</span>{" "}
        <strong>Clean means &ldquo;nothing visibly broke&rdquo;, not
        &ldquo;the answer was right&rdquo;.</strong>{" "}
        Checked against Member Care&apos;s own ratings, this scorecard flags{" "}
        <strong>
          {validation.bad_caught} of {validation.bad_in_window}
          {validation.bad_recall_pct != null && ` (${validation.bad_recall_pct}%)`}
        </strong>{" "}
        of the conversations they marked <em>bad</em>. The ones it misses look
        like <em>&ldquo;she talks about a Gold label, which doesn&apos;t
        exist&rdquo;</em> and <em>&ldquo;it makes extension requests out of
        everything&rdquo;</em> — the bot answered fluently and was simply wrong.
        Nothing countable in a transcript reveals that, so a confidently false
        answer scores clean here. Judging correctness is still{" "}
        <Link href="/feedback">Feedback</Link>&apos;s job.
      </div>

      <div className="panel" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ fontWeight: 650, marginBottom: 4 }}>
          What went wrong
          <Info text="Ranked biggest first — this is the work queue. A conversation can carry more than one defect, so these do not sum to the total." />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Click a class to read the conversations behind it.
        </p>
        <table>
          <tbody>
            {ORDER.map((c) => counts.get(c) ?? 0)
              .map((n, i) => ({ c: ORDER[i], n }))
              .sort((a, b) => b.n - a.n)
              .map(({ c, n }) => (
                <tr key={c}>
                  <td style={{ width: 200 }}>
                    <Link href={qs(c)} className={filter === c ? "active" : ""}>
                      {CLASS_INFO[c].label}
                    </Link>
                    <Info text={CLASS_INFO[c].what} />
                  </td>
                  <td className="mono" style={{ width: 70, textAlign: "right" }}>
                    {n.toLocaleString()}
                  </td>
                  <td className="mono muted" style={{ width: 60, textAlign: "right" }}>
                    {pct(n, total)}%
                  </td>
                  <td>
                    <div
                      style={{
                        height: 9,
                        borderRadius: 5,
                        background: n > 0 ? "var(--amber)" : "transparent",
                        width: `${Math.max(n > 0 ? 2 : 0, (100 * n) / maxDefect)}%`,
                      }}
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {metrics.by_day.length > 1 && (
        <div className="panel" style={{ padding: 16, marginTop: 14 }}>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>
            Clean rate by day
            <Info text="One point per day. Short ranges bounce around — read the direction, not a single day." />
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 90 }}>
            {metrics.by_day.map((d) => (
              <div key={d.day} style={{ flex: 1, textAlign: "center" }}>
                <div
                  title={`${d.day} — ${d.clean_pct ?? 0}% of ${d.conversations}`}
                  style={{
                    height: `${d.clean_pct ?? 0}%`,
                    minHeight: 2,
                    background: "var(--green)",
                    borderRadius: "3px 3px 0 0",
                  }}
                />
                <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                  {d.day.slice(5)}
                </div>
                <div className="mono" style={{ fontSize: 10 }}>
                  {d.clean_pct ?? 0}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ fontWeight: 650, marginBottom: 4 }}>
          Did our fixes help?
          <Info text="Each shipped fix declared the defect class it targeted BEFORE it went out. The control column is the movement in every OTHER class over the same two windows." />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          A before/after on a live system is <strong>not proof</strong> — traffic
          changes, and several fixes land in the same week. So the movement in
          every <em>other</em> defect class travels with each result. A target
          that fell while the control held still is the only shape that supports
          a claim; if both moved, it was probably the traffic.
        </p>
        <table>
          <thead>
            <tr>
              <th>Change</th>
              <th>Shipped</th>
              <th>Target</th>
              <th style={{ textAlign: "right" }}>Before</th>
              <th style={{ textAlign: "right" }}>After</th>
              <th style={{ textAlign: "right" }}>Δ</th>
              <th style={{ textAlign: "right" }}>Control Δ</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {impact.map((r) => (
              <tr key={r.id}>
                <td style={{ maxWidth: 260 }}>{r.title}</td>
                <td className="mono">{r.shipped_at.slice(0, 10)}</td>
                <td>
                  <span className="badge amber">
                    {CLASS_INFO[r.target_defect]?.label ?? r.target_defect}
                  </span>
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {r.before_rate != null ? `${r.before_rate}%` : "—"}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {r.after_rate != null ? `${r.after_rate}%` : "—"}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>
                  {r.delta_pp != null ? `${r.delta_pp > 0 ? "+" : ""}${r.delta_pp}` : "—"}
                </td>
                <td className="mono muted" style={{ textAlign: "right" }}>
                  {r.control_delta_pp != null
                    ? `${r.control_delta_pp > 0 ? "+" : ""}${r.control_delta_pp}`
                    : "—"}
                </td>
                <td>
                  <span
                    className={`badge ${
                      r.verdict.startsWith("improved, control")
                        ? "green"
                        : r.verdict.startsWith("improved")
                          ? "grey"
                          : r.verdict === "got worse"
                            ? "red"
                            : "grey"
                    }`}
                  >
                    {r.verdict}
                  </span>
                </td>
              </tr>
            ))}
            {impact.length === 0 && (
              <tr>
                <td colSpan={8} className="muted" style={{ padding: 16 }}>
                  No changes recorded yet. Add one to{" "}
                  <span className="mono">bot.bot_changes</span> naming the defect
                  class it targets, and its before/after appears here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel table-scroll" style={{ marginTop: 14 }}>
        <div style={{ padding: "14px 16px 0" }}>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>
            {filter === null
              ? "Conversations with a defect"
              : filter === "clean"
                ? "Clean conversations"
                : CLASS_INFO[filter as DefectClass].label}
          </div>
          <div className="controls" style={{ marginBottom: 4 }}>
            <Link
              href={qs(null)}
              className={`sfilter tone-red${filter === null ? " active" : ""}`}
            >
              Any defect <span className="n">{total - metrics.clean}</span>
            </Link>
            <Link
              href={qs("clean")}
              className={`sfilter tone-green${filter === "clean" ? " active" : ""}`}
            >
              Clean <span className="n">{metrics.clean}</span>
            </Link>
            {ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((c) => (
              <Link
                key={c}
                href={qs(c)}
                className={`sfilter tone-amber${filter === c ? " active" : ""}`}
              >
                {CLASS_INFO[c].label} <span className="n">{counts.get(c)}</span>
              </Link>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Most-broken first — conversations carrying several defects at once
            are the ones worth reading.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Member</th>
              <th>What they asked</th>
              <th>Defects</th>
              <th style={{ textAlign: "right" }}>Turns</th>
              <th style={{ textAlign: "right" }}>Answers</th>
              <th>Chat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.session_id}>
                <td className="mono">{r.day}</td>
                <td>{r.member ?? <span className="muted">—</span>}</td>
                <td style={{ maxWidth: 320 }}>
                  {r.first_user_message ?? <span className="muted">—</span>}
                </td>
                <td>
                  {r.defects.length === 0 ? (
                    <span className="badge green">clean</span>
                  ) : (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.defects.map((d) => (
                        <span key={d} className="badge amber" style={{ fontSize: 10.5 }}>
                          {d === "loop" && r.repeated_max > 0
                            ? `loop ×${r.repeated_max}`
                            : CLASS_INFO[d]?.label ?? d}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="mono" style={{ textAlign: "right" }}>{r.user_msgs}</td>
                <td className="mono" style={{ textAlign: "right" }}>{r.answers}</td>
                <td>
                  <Link href={`/conversations/${r.session_id}`}>open</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 18 }}>
                  Nothing in this range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
