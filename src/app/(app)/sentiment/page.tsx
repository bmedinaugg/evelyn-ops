import Link from "next/link";
import {
  getSentimentMetrics,
  listSentimentDaily,
  listSentimentConversations,
} from "@/lib/queries";
import {
  amsterdamToday,
  addDays,
  freshdeskUrl,
  normaliseDate,
} from "@/lib/format";
import { DateRangePicker } from "@/components/DateRangePicker";
import type { SentimentValue } from "@/lib/types";
import { RaiseFeedbackButton } from "./RaiseFeedbackButton";

export const dynamic = "force-dynamic";

// Ordered worst → best so the bar reads left-to-right as "bad on the left",
// which is where the eye goes first and where the action is.
const ORDER: SentimentValue[] = [
  "Angry",
  "Frustrated",
  "Neutral",
  "Satisfied",
  "Happy",
];

const TONE: Record<SentimentValue, string> = {
  Angry: "var(--red)",
  Frustrated: "var(--amber)",
  Neutral: "var(--grey)",
  Satisfied: "var(--blue)",
  Happy: "var(--green)",
};

const BADGE: Record<SentimentValue, string> = {
  Angry: "red",
  Frustrated: "amber",
  Neutral: "grey",
  Satisfied: "blue",
  Happy: "green",
};

// Below this, a percentage over the range is not worth reading as anything.
// While the 30-day backfill runs, older days sit in single digits and one day
// briefly showed "100% negative" off two conversations.
const TRUSTWORTHY_COVERAGE = 60;

function Tile({
  k,
  v,
  tone,
  sub,
}: {
  k: string;
  v: number | string;
  tone?: "alert" | "warn";
  sub?: string;
}) {
  return (
    <div className={`tile${tone ? " " + tone : ""}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {sub && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function MixBar({
  counts,
  total,
}: {
  counts: Record<SentimentValue, number>;
  total: number;
}) {
  if (!total) return <span className="muted">—</span>;
  return (
    <div
      style={{
        display: "flex",
        height: 10,
        borderRadius: 999,
        overflow: "hidden",
        background: "var(--grey-bg)",
        minWidth: 120,
      }}
      title={ORDER.map((s) => `${s}: ${counts[s] ?? 0}`).join(" · ")}
    >
      {ORDER.map((s) => {
        const n = counts[s] ?? 0;
        if (!n) return null;
        return (
          <div
            key={s}
            style={{
              width: `${(n / total) * 100}%`,
              background: TONE[s],
              opacity: 0.85,
            }}
          />
        );
      })}
    </div>
  );
}

export default async function SentimentPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; s?: string }>;
}) {
  const sp = await searchParams;
  const to = normaliseDate(sp.to);
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -29);

  // `s` filters the conversation list: unset = negative only (triage), "all",
  // or one sentiment value. It does not affect the tiles or the per-day table,
  // which always describe the whole range.
  const rawS = String(sp.s || "").trim();
  const filter: string | null =
    rawS === "all" || (ORDER as string[]).includes(rawS) ? rawS : null;

  const [metrics, daily, rows] = await Promise.all([
    getSentimentMetrics(from, to),
    listSentimentDaily(from, to),
    listSentimentConversations(from, to, filter, 50),
  ]);

  const qs = (s: string | null) => {
    const p = new URLSearchParams({ from, to });
    if (s) p.set("s", s);
    return `/sentiment?${p.toString()}`;
  };

  const coverage = metrics.scored_pct ?? 0;
  const thin = coverage < TRUSTWORTHY_COVERAGE;
  const counts = metrics.counts ?? ({} as Record<SentimentValue, number>);

  return (
    <>
      <div className="pagehead">
        <h1>Sentiment</h1>
        <div className="controls">
          <DateRangePicker
            from={from}
            to={to}
            max={amsterdamToday()}
            basePath="/sentiment"
          />
        </div>
      </div>

      <p className="muted">
        How the <strong>member</strong> came across in each conversation,{" "}
        {from} → {to}. Scored automatically once a chat has been quiet for ten
        minutes. This measures the member&apos;s experience, not whether the bot
        was correct — a wrong answer the member never noticed is Neutral, and a
        billing complaint handled well can be Happy.
      </p>

      {thin && (
        <div className="panel" style={{ padding: 14, marginBottom: 14 }}>
          <span className="badge amber">coverage {coverage}%</span>{" "}
          <strong>Only {metrics.scored.toLocaleString()}</strong> of{" "}
          {metrics.conversations.toLocaleString()} conversations in this range
          have been scored, so the percentages below describe that subset and
          not the range. Treat them as provisional until coverage is past{" "}
          {TRUSTWORTHY_COVERAGE}%.{" "}
          {metrics.unscored > 0 && (
            <>
              {metrics.unscored.toLocaleString()} still queued — the batch works
              through roughly 600 an hour.
            </>
          )}
        </div>
      )}

      <div className="tiles">
        <Tile
          k="Scored"
          v={metrics.scored.toLocaleString()}
          sub={`of ${metrics.conversations.toLocaleString()} · ${coverage}% coverage`}
        />
        <Tile
          k="Avg score"
          v={metrics.avg_score ?? "—"}
          sub="1 Angry → 5 Happy"
        />
        <Tile
          k="Negative"
          v={
            metrics.negative_pct_of_scored != null
              ? `${metrics.negative_pct_of_scored}%`
              : "—"
          }
          sub={`${metrics.negative} Frustrated or Angry`}
          tone={
            (metrics.negative_pct_of_scored ?? 0) >= 20
              ? "alert"
              : (metrics.negative_pct_of_scored ?? 0) >= 10
                ? "warn"
                : undefined
          }
        />
        <Tile
          k="Angry"
          v={counts.Angry ?? 0}
          tone={(counts.Angry ?? 0) > 0 ? "alert" : undefined}
        />
        <Tile k="Frustrated" v={counts.Frustrated ?? 0} />
        <Tile k="Neutral" v={counts.Neutral ?? 0} />
        <Tile k="Satisfied" v={counts.Satisfied ?? 0} />
        <Tile k="Happy" v={counts.Happy ?? 0} />
      </div>

      <div className="panel" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ marginBottom: 10, fontWeight: 650 }}>
          Mix across the range
        </div>
        <MixBar counts={counts} total={metrics.scored} />
        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {ORDER.map((s) => (
            <span key={s} className={`badge ${BADGE[s]}`}>
              {s} {counts[s] ?? 0}
            </span>
          ))}
        </div>
        {metrics.low_confidence > 0 && (
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {metrics.low_confidence} scored with <strong>low</strong>{" "}
            confidence — usually very short chats with little to go on.
            {metrics.failed > 0 && (
              <>
                {" "}
                {metrics.failed} could not be scored at all after three
                attempts; those are left unscored rather than guessed.
              </>
            )}
          </div>
        )}
      </div>

      {metrics.by_outcome.length > 0 && (
        <div className="panel" style={{ padding: 16, marginTop: 14 }}>
          <div style={{ marginBottom: 4, fontWeight: 650 }}>
            Chats that filed a ticket vs chats that did not
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Whether the conversations we hand to Member Care are the unhappy
            ones.
          </p>
          <table>
            <thead>
              <tr>
                <th>Outcome</th>
                <th style={{ textAlign: "right" }}>Scored</th>
                <th style={{ textAlign: "right" }}>Avg</th>
                <th style={{ textAlign: "right" }}>Negative</th>
              </tr>
            </thead>
            <tbody>
              {metrics.by_outcome.map((o) => (
                <tr key={o.outcome}>
                  <td>{o.outcome}</td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {o.scored_conversations}
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {o.avg_score ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {o.negative_pct != null ? `${o.negative_pct}%` : "—"}{" "}
                    <span className="muted">({o.negative})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel table-scroll" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th style={{ textAlign: "right" }}>Convos</th>
              <th style={{ textAlign: "right" }}>Scored</th>
              <th style={{ minWidth: 140 }}>Mix</th>
              <th style={{ textAlign: "right" }}>Avg</th>
              <th style={{ textAlign: "right" }}>Negative</th>
            </tr>
          </thead>
          <tbody>
            {daily.map((d) => {
              const dayCounts = {
                Angry: d.angry,
                Frustrated: d.frustrated,
                Neutral: d.neutral,
                Satisfied: d.satisfied,
                Happy: d.happy,
              } as Record<SentimentValue, number>;
              const dayThin = (d.scored_pct ?? 0) < TRUSTWORTHY_COVERAGE;
              return (
                <tr key={d.day}>
                  <td className="mono">{d.day}</td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {d.conversations}
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {d.scored}{" "}
                    <span className={dayThin ? "badge amber" : "badge green"}>
                      {d.scored_pct ?? 0}%
                    </span>
                  </td>
                  <td>
                    <MixBar counts={dayCounts} total={d.scored} />
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {d.avg_score ?? "—"}
                  </td>
                  <td style={{ textAlign: "right" }} className="mono">
                    {/* Suppressed on thin days on purpose: a percentage off a
                        handful of conversations reads as a finding and is not
                        one. */}
                    {d.scored === 0 || dayThin ? (
                      <span className="muted" title="coverage too low to report">
                        —
                      </span>
                    ) : (
                      `${d.negative_pct_of_scored ?? 0}%`
                    )}
                  </td>
                </tr>
              );
            })}
            {daily.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ padding: 18 }}>
                  No conversations in this range.
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
              ? "Worth reading — most negative in this range"
              : filter === "all"
                ? "All scored conversations in this range"
                : `${filter} conversations in this range`}
          </div>
          <div className="controls" style={{ marginBottom: 4 }}>
            <Link
              href={qs(null)}
              className={`sfilter tone-red${filter === null ? " active" : ""}`}
            >
              Negative <span className="n">{metrics.negative}</span>
            </Link>
            <Link
              href={qs("all")}
              className={`sfilter tone-accent${filter === "all" ? " active" : ""}`}
            >
              All <span className="n">{metrics.scored}</span>
            </Link>
            {ORDER.map((v) => (
              <Link
                key={v}
                href={qs(v)}
                className={`sfilter tone-${BADGE[v]}${filter === v ? " active" : ""}`}
              >
                {v} <span className="n">{counts[v] ?? 0}</span>
              </Link>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Newest first, except the Negative view which is worst first.
            &ldquo;Raise&rdquo; files this conversation on the{" "}
            <Link href="/feedback">Feedback</Link> page for the team to review
            — it does <strong>not</strong> rate the bot, since a low sentiment
            score is about the member, not about whether the answer was right.
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Member</th>
              <th>Sentiment</th>
              <th>Why</th>
              <th>Ticket</th>
              <th>Feedback</th>
              <th>Chat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const url = freshdeskUrl(w.pushed_ticket_id);
              return (
                <tr key={w.session_id}>
                  <td className="mono">{w.day}</td>
                  <td>{w.member ?? <span className="muted">—</span>}</td>
                  <td>
                    <span className={`badge ${BADGE[w.sentiment]}`}>
                      {w.sentiment}
                    </span>
                    {w.confidence === "low" && (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {" "}
                        low conf
                      </span>
                    )}
                  </td>
                  <td style={{ maxWidth: 420 }}>
                    {w.rationale ?? <span className="muted">—</span>}
                  </td>
                  <td>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        #{w.pushed_ticket_id}
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {w.has_feedback ? (
                      <Link href="/feedback" className="badge green">
                        raised
                      </Link>
                    ) : (
                      <RaiseFeedbackButton
                        sessionId={w.session_id}
                        sentiment={w.sentiment}
                        confidence={w.confidence}
                        rationale={w.rationale}
                      />
                    )}
                  </td>
                  <td>
                    <Link href={`/conversations/${w.session_id}`}>open</Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 18 }}>
                  {filter === null
                    ? "Nothing scored Frustrated or Angry in this range."
                    : `No ${filter === "all" ? "scored" : filter} conversations in this range.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
