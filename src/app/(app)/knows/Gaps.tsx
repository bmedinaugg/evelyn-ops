import Link from "next/link";
import type { KnowledgeGapRow } from "@/lib/types";
import { KINDS } from "./shared";
import { addKnowledgeNoteAction, resolveKnowledgeNoteAction } from "./actions";
import type { KnowledgeItemNoteRow } from "@/lib/types";

// What she is ASKED and cannot answer — the mirror of the list below it. Both
// are needed to read either: an article nobody asks about is a candidate for
// retirement, and a subject with demand and no article is the work.
export function Gaps({
  gaps,
  notesByKey,
  back,
}: {
  gaps: KnowledgeGapRow[];
  notesByKey: Map<string, KnowledgeItemNoteRow[]>;
  back: (key: string) => string;
}) {
  if (!gaps.length) return null;
  const g0 = gaps[0];
  const uncovered = gaps.filter((g) => !g.covering_item_keys.length);
  const totalRaised = gaps.reduce((a, g) => a + g.matched_sessions, 0);

  return (
    <>
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>
          Asked often, answered by nothing
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
          {gaps.length} subjects members raise that no article covers well, or
          at all. <strong>{uncovered.length}</strong> of them have nothing in
          the {`knowledge base`} behind them whatsoever. Together they were
          raised in <strong>{totalRaised.toLocaleString("en-GB")}</strong>{" "}
          conversations in {g0.window_from} – {g0.window_to}.
        </p>

        {/* Stated before the list, because a reader who takes these 20 rows as
            "why the bot fails" has the proportions badly wrong. */}
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
          <strong>These are the smaller half of the problem.</strong> They were
          found by reading every conversation where the bot gave no substantive
          answer at all &mdash; {g0.pool_size} of them. Only 44 of those were
          missing knowledge. <strong>297, roughly 68%,</strong> were members
          asking for something to be <em>done</em> rather than explained: cancel
          this, move my club, fix my payment. No article would have helped any
          of them, and nothing below addresses that.
        </p>

        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: "72ch", marginBottom: 0 }}>
          <strong>How the numbers were made.</strong> Not by keyword. Two
          keyword attempts were tried and both were wrong &mdash; one credited
          &ldquo;membership prices&rdquo; with 822 conversations on the strength
          of the words <em>red</em> and <em>label</em>, and the other found only
          25% of the very questions it was built from. So{" "}
          {g0.count_model ?? "a model"} read all{" "}
          {g0.sessions_read?.toLocaleString("en-GB")} member questions in the
          window and assigned each to at most one subject. Put through the same
          test, it scored <strong>{g0.count_recall_pct}%</strong>. Where that
          check is weak the counts are not published at all.
        </p>
      </div>

      <div className="panel" style={{ padding: 16 }}>
        <p className="muted mono" style={{ fontSize: 11.5, margin: "0 0 10px" }}>
          most unanswered first · {gaps.length} subjects
        </p>
        {gaps.map((g) => (
          <Gap
            key={g.key}
            g={g}
            notes={notesByKey.get(g.key) ?? []}
            back={back(g.key)}
          />
        ))}
      </div>
    </>
  );
}

function Gap({
  g,
  notes,
  back,
}: {
  g: KnowledgeGapRow;
  notes: KnowledgeItemNoteRow[];
  back: string;
}) {
  const covered = g.covering_item_keys.length > 0;
  const failRate = g.matched_sessions
    ? Math.round((100 * g.unanswered_sessions) / g.matched_sessions)
    : 0;

  return (
    <details
      id={`i-${g.key}`}
      style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}
    >
      <summary
        style={{
          cursor: "pointer",
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <span className="mono" style={{ minWidth: 52, textAlign: "right", fontSize: 13, fontWeight: 700 }}>
          {g.matched_sessions.toLocaleString("en-GB")}
        </span>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 240 }}>{g.subject}</span>
        {notes.length > 0 && (
          <span className="badge red" style={{ fontSize: 10.5 }}>
            {notes.length} note{notes.length > 1 ? "s" : ""}
          </span>
        )}
        {!covered ? (
          <span className="badge red" style={{ fontSize: 10.5 }}>nothing covers it</span>
        ) : (
          <span className="badge grey" style={{ fontSize: 10.5 }}>
            {g.covering_item_keys.length} item
            {g.covering_item_keys.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="muted mono" style={{ fontSize: 11 }}>
          {g.unanswered_sessions} got no answer
        </span>
      </summary>

      <div style={{ padding: "8px 0 4px 14px" }}>
        <p style={{ fontSize: 13.5, margin: "0 0 6px" }}>
          <strong>What they ask.</strong> {g.question}
        </p>
        <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
          <strong>Why it matters.</strong> {g.why_it_matters}
        </p>

        <div
          style={{
            fontSize: 13,
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderLeft: `3px solid ${covered ? "var(--amber)" : "var(--red)"}`,
            borderRadius: 3,
          }}
        >
          {covered ? (
            <>
              <strong>Partly covered.</strong> {g.covering_item_titles.join(" · ")}
              {" — "}
              yet {g.unanswered_sessions} of {g.matched_sessions.toLocaleString("en-GB")}{" "}
              conversations ({failRate}%) still got no answer, so what exists is
              not reaching the people asking.
            </>
          ) : (
            <>
              <strong>Nothing covers this.</strong> No article, no Member Care
              answer, no prompt rule mentions it. Writing one is the whole fix
              &mdash; and for a Freshdesk article that reaches the bot the next
              morning.
            </>
          )}
        </div>

        {g.examples.length > 0 && (
          <div style={{ margin: "10px 0 0" }}>
            <div
              className="muted"
              style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em" }}
            >
              Members who asked
            </div>
            {g.examples.map((e, n) => (
              <p
                key={n}
                className="muted"
                style={{
                  margin: "4px 0 0",
                  paddingLeft: 12,
                  borderLeft: "2px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontStyle: "italic" }}>&ldquo;{e}&rdquo;</span>{" "}
                {g.example_sessions[n] && (
                  <Link
                    href={`/conversations/${g.example_sessions[n]}`}
                    prefetch={false}
                    style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
                  >
                    read the conversation
                  </Link>
                )}
              </p>
            ))}
          </div>
        )}

        <p className="muted mono" style={{ fontSize: 11, margin: "8px 0 0" }}>
          {g.count_method}
          {g.merged_from.length > 1 && <> · merged from: {g.merged_from.join(", ")}</>}
        </p>

        {/* Same notes table as the knowledge items, same soft key. A gap that
            stops being a gap keeps the record of what was raised about it. */}
        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                fontSize: 13,
                padding: "7px 10px",
                marginBottom: 6,
                border: "1px solid var(--border)",
                borderLeft: "3px solid var(--green)",
                borderRadius: 3,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <div>
                {n.note}
                <div className="muted mono" style={{ fontSize: 11.5 }}>
                  {n.author_email} ·{" "}
                  {new Date(n.created_at).toLocaleDateString("en-GB")}
                </div>
              </div>
              <form action={resolveKnowledgeNoteAction}>
                <input type="hidden" name="id" value={n.id} />
                <input type="hidden" name="back" value={back} />
                <button type="submit" className="btn secondary">Done</button>
              </form>
            </div>
          ))}

          <p className="muted" style={{ fontSize: 12, margin: "0 0 6px", maxWidth: "72ch" }}>
            <strong>A note goes to the team, not to the bot.</strong> To close
            this gap, publish a Freshdesk article or add a row to
            bot.manual_faqs — either is in the bot the next morning.
          </p>
          <form
            action={addKnowledgeNoteAction}
            style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <input type="hidden" name="item_key" value={g.key} />
            <input type="hidden" name="back" value={back} />
            <select name="kind" defaultValue="missing" aria-label="What kind of note">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <textarea
              name="note"
              rows={2}
              placeholder="What should the answer be, or who owns writing it?"
              aria-label="Your note"
              style={{ flex: 1, minWidth: 240, fontSize: 13, padding: "6px 8px" }}
            />
            <button type="submit" className="btn secondary">Save</button>
          </form>
        </div>
      </div>
    </details>
  );
}
