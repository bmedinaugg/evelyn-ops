import Link from "next/link";
import {
  getSentimentMetrics,
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

// Below this, a percentage over the range is not worth reading as anything, so
// the page says so instead of implying a trend. Learned the hard way: mid
// backfill one day briefly read "100% negative" off two conversations.
const TRUSTWORTHY_COVERAGE = 60;

// One-sentence hint next to a label.
//
// The text goes in data-tip and is drawn by CSS, NOT via the native title
// attribute — title was in the markup and still showed nothing useful on
// hover, because native tooltips wait about a second, cannot be styled, and
// never appear on touch. aria-label carries the same text for screen readers,
// since a bare "i" means nothing, and tabIndex makes it focusable so the hint
// is reachable without a mouse.
//
// `align="right"` pins the tooltip to the icon instead of centring it, for
// icons close to the right edge of a panel.
function Info({
  text,
  align,
}: {
  text: string;
  align?: "right";
}) {
  return (
    <span
      className={`info${align === "right" ? " tip-right" : ""}`}
      data-tip={text}
      aria-label={text}
      role="img"
      tabIndex={0}
    >
      i
    </span>
  );
}

function Tile({
  k,
  v,
  tone,
  sub,
  info,
}: {
  k: string;
  v: number | string;
  tone?: "alert" | "warn";
  sub?: string;
  info?: string;
}) {
  return (
    <div className={`tile${tone ? " " + tone : ""}`}>
      <div className="k">
        {k}
        {info && <Info text={info} />}
      </div>
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
  // Default: the last 7 days inclusive, same convention as /evaluation. Was 30,
  // which is the backfill window, not a useful default for reading.
  const from =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(to, -6);

  // `s` filters the conversation list: unset = negative only (triage), "all",
  // or one sentiment value. It does not affect the tiles or the per-day table,
  // which always describe the whole range.
  const rawS = String(sp.s || "").trim();
  const filter: string | null =
    rawS === "all" || (ORDER as string[]).includes(rawS) ? rawS : null;

  const [metrics, rows] = await Promise.all([
    getSentimentMetrics(from, to),
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

      <p className="muted" style={{ marginBottom: 10 }}>
        How the <strong>member</strong> came across in each conversation,{" "}
        {from} → {to}.
      </p>

      <details className="panel" style={{ marginBottom: 12 }}>
        <summary>What these values mean, and how they are decided</summary>
        <div style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.55 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Each value describes <strong>how the member felt in the chat</strong>
            . It is deliberately <em>not</em> a score for the bot, and not a
            score for how unpleasant the topic was:
          </p>
          <ul className="muted" style={{ marginTop: 0, paddingLeft: 18 }}>
            <li>
              A wrong answer the member never noticed is{" "}
              <span className="badge grey">Neutral</span> — they left content.
              Use <Link href="/feedback">Feedback</Link> to judge the bot.
            </li>
            <li>
              A billing complaint handled well can be{" "}
              <span className="badge green">Happy</span>. Cancellations and
              double charges are routine here, so the subject alone is not
              distress.
            </li>
            <li>Being told &ldquo;no&rdquo; politely, and accepting it, is Neutral.</li>
          </ul>

          <table style={{ marginTop: 4 }}>
            <tbody>
              <tr>
                <td style={{ width: 110 }}>
                  <span className="badge green">Happy</span>
                </td>
                <td>
                  Real warmth or gratitude beyond politeness —{" "}
                  &ldquo;thank you so much!&rdquo;, praise, relief. A bare
                  &ldquo;thanks&rdquo; is not enough.
                </td>
              </tr>
              <tr>
                <td>
                  <span className="badge blue">Satisfied</span>
                </td>
                <td>
                  Says something positive about the outcome or the help. A
                  polite &ldquo;no thanks&rdquo; close is <em>not</em>
                  satisfaction.
                </td>
              </tr>
              <tr>
                <td>
                  <span className="badge grey">Neutral</span>
                </td>
                <td>
                  The default, and correct for most chats — a transactional
                  exchange, or someone who simply stops replying without
                  complaint. Terse is not the same as annoyed.
                </td>
              </tr>
              <tr>
                <td>
                  <span className="badge amber">Frustrated</span>
                </td>
                <td>
                  Visible friction: repeating a question because they were not
                  answered, &ldquo;that&apos;s not what I asked&rdquo;,
                  complaining about waiting, demanding a human after being
                  blocked. Annoyed but still engaging.
                </td>
              </tr>
              <tr>
                <td>
                  <span className="badge red">Angry</span>
                </td>
                <td>
                  Hostility or giving up in anger — calling the bot useless,
                  shouting, abandoning the chat after an insult. Reserved for
                  unmistakable cases.
                </td>
              </tr>
            </tbody>
          </table>

          <p className="muted" style={{ marginBottom: 0 }}>
            <strong>How it is decided.</strong> Ten minutes after a chat goes
            quiet, a language model reads the transcript and returns one value,
            a confidence, and the one-line reason shown in the list below. It
            weighs only what the <strong>member</strong> wrote — the bot&apos;s
            replies are context for why they reacted, never evidence of their
            mood — and weights the end of the conversation slightly higher, so
            someone annoyed mid-chat who signs off warmly is Frustrated rather
            than Angry. <strong>Confidence</strong> is <em>high</em> when there
            is a quotable line, <em>medium</em> for clear tone without one, and{" "}
            <em>low</em> when there is very little to go on. Where the model
            returns nothing usable the conversation is left{" "}
            <strong>unscored</strong> rather than guessed at, which is why
            coverage matters more than the mix on a partly scored range.
          </p>
        </div>
      </details>

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

      {/* Three headline numbers only. The per-value counts used to be five more
          tiles here, but they now appear twice below — on the mix legend and on
          the filter pills — so a third copy was just taking up the screen.
          NOTE: needs "grid" as well as "tiles"; .tiles only sets
          grid-template-columns, so without it the tiles render as full-width
          stacked blocks. */}
      <div className="grid tiles compact">
        <Tile
          k="Scored"
          v={metrics.scored.toLocaleString()}
          sub={`of ${metrics.conversations.toLocaleString()} · ${coverage}%`}
          info="How many conversations in this range have a sentiment yet. Everything else is still queued, so percentages describe the scored subset — not the range."
        />
        <Tile
          k="Avg score"
          v={metrics.avg_score ?? "—"}
          sub="1 low → 5 high"
          info="Mean of the five values scored 1-5: Angry 1, Frustrated 2, Neutral 3, Satisfied 4, Happy 5. Most chats are Neutral, so expect it to sit near 3."
        />
        <Tile
          k="Negative"
          v={
            metrics.negative_pct_of_scored != null
              ? `${metrics.negative_pct_of_scored}%`
              : "—"
          }
          sub={`${metrics.negative} of ${metrics.scored}`}
          info="Share of scored conversations that came out Frustrated or Angry. Amber from 10%, red from 20%."
          tone={
            (metrics.negative_pct_of_scored ?? 0) >= 20
              ? "alert"
              : (metrics.negative_pct_of_scored ?? 0) >= 10
                ? "warn"
                : undefined
          }
        />
      </div>

      <div className="panel" style={{ padding: 14, marginTop: 12 }}>
        <div
          className="muted"
          style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.05em" }}
        >
          Mix
          <Info text="Every scored conversation in this range, worst on the left. Hover the bar for the exact counts." />
        </div>
        <MixBar counts={counts} total={metrics.scored} />
        <div
          style={{
            marginTop: 9,
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
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
              <th>
                Sentiment
                <Info text="How the member came across — not whether the bot was right. See the explainer at the top of the page." />
              </th>
              <th>
                Why
                <Info text="The one-line reason the model gave, quoting the member where it could. If you disagree with a score, this is what to argue with." />
              </th>
              <th>
                Ticket
                <Info text="The Freshdesk ticket this chat produced, if any. Most conversations never file one." />
              </th>
              <th>
                Feedback
                <Info
                  align="right"
                  text="Files this conversation on the Feedback page for the team. It does NOT rate the bot — a low sentiment score is about the member, so the reviewer still makes that call."
                />
              </th>
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
