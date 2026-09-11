import Link from "next/link";
import { getQuestionTraces, listQuestionNotes } from "@/lib/queries";
import type {
  QuestionTraceRow,
  QuestionNoteRow,
  UltimateSource,
} from "@/lib/types";
import { addQuestionNoteAction, resolveQuestionNoteAction } from "./actions";

export const dynamic = "force-dynamic";

// Every answer Evelyn gives comes from one of seven places. Colour follows what
// changing the answer would cost, not the source itself, because that is the
// only part that changes what anyone does next.
const COST: Record<
  QuestionTraceRow["change_cost"],
  { label: string; badge: string }
> = {
  nodeploy: { label: "No deploy", badge: "green" },
  deploy: { label: "Needs a deploy", badge: "amber" },
  external: { label: "Not ours", badge: "grey" },
};

const KIND_SHORT: Record<string, string> = {
  "Excel workbook": "Excel",
  "Word document": "Word",
  "Published articles": "Freshdesk FAQs",
  "Database table": "Database",
  "n8n nodes": "n8n prompt",
  "Live API": "Live API",
};

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default async function QuestionsPage() {
  const [rows, notes] = await Promise.all([
    getQuestionTraces(),
    listQuestionNotes(),
  ]);

  // Notes are keyed softly, so group rather than join.
  const byQuestion = new Map<string, QuestionNoteRow[]>();
  for (const n of notes) {
    const list = byQuestion.get(n.question_key) ?? [];
    list.push(n);
    byQuestion.set(n.question_key, list);
  }

  // One entry per chain, in demand order — the summary before the detail.
  const chains = new Map<
    string,
    { label: string; questions: number; sessions: number; cost: QuestionTraceRow["change_cost"] }
  >();
  for (const r of rows) {
    const c = chains.get(r.chain_key) ?? {
      label: r.chain_label,
      questions: 0,
      sessions: 0,
      cost: r.change_cost,
    };
    c.questions += 1;
    c.sessions += r.matched_sessions ?? 0;
    chains.set(r.chain_key, c);
  }
  const byDemand = [...chains.entries()].sort((a, b) => b[1].sessions - a[1].sessions);
  const window = rows[0]
    ? `${fmtDate(rows[0].window_from)} – ${fmtDate(rows[0].window_to)}`
    : "";

  return (
    <>
      <div className="pagehead">
        <h1>How a question gets answered</h1>
        <p className="muted">
          Real questions members asked, traced from the words they type back to
          the person who types the answer. TrainMore, {window}.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>
          Every answer comes from one of {byDemand.length} places
        </h2>
        <p className="muted" style={{ fontSize: 13.5, maxWidth: "70ch" }}>
          Read this first. It is the whole map — the {rows.length} questions
          below are just worked examples of these {byDemand.length} routes.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Where the answer comes from</th>
                <th className="num">Questions</th>
                <th className="num">Sessions</th>
                <th>To change it</th>
              </tr>
            </thead>
            <tbody>
              {byDemand.map(([key, c]) => (
                <tr key={key}>
                  <td>{c.label}</td>
                  <td className="num mono">{c.questions}</td>
                  <td className="num mono">{c.sessions.toLocaleString("en-GB")}</td>
                  <td>
                    <span className={`badge ${COST[c.cost].badge}`}>
                      {COST[c.cost].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Session counts are a <strong>floor</strong>. The matcher that found
          these questions is ours, not the bot&rsquo;s own recogniser, and is
          written narrow so it under-claims rather than putting a number on the
          page that one counter-example could disprove.
        </p>
      </div>

      {notes.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            Corrections waiting <span className="n">{notes.length}</span>
          </h2>
          <p className="muted" style={{ fontSize: 13, maxWidth: "70ch" }}>
            What the team says the bot should be saying instead. Each one sits on
            its question below too.
          </p>
          {notes.map((n) => (
            <div
              key={n.id}
              style={{
                borderTop: "1px solid var(--line)",
                padding: "9px 0",
                fontSize: 13.5,
              }}
            >
              <strong>{n.question_key}</strong> &mdash; {n.should_be}
              <div className="muted mono" style={{ fontSize: 11.5 }}>
                {n.author_email} ·{" "}
                {new Date(n.created_at).toLocaleDateString("en-GB")}
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.map((r) => (
        <QuestionCard key={r.key} r={r} notes={byQuestion.get(r.key) ?? []} />
      ))}
    </>
  );
}

function QuestionCard({
  r,
  notes,
}: {
  r: QuestionTraceRow;
  notes: QuestionNoteRow[];
}) {
  return (
    <div className="panel">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 14,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17 }}>{r.question}</h2>
        <span className={`badge ${COST[r.change_cost].badge}`}>
          {COST[r.change_cost].label}
        </span>
      </div>
      <p className="muted mono" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
        {r.chain_label}
        {r.matched_sessions != null && (
          <> · asked in at least {r.matched_sessions.toLocaleString("en-GB")} conversations</>
        )}
      </p>

      <Sources sources={r.ultimate_sources} chain={r.chain_label} />

      {r.examples.length > 0 && (
        <div style={{ margin: "0 0 12px" }}>
          {r.examples.map((e, i) => {
            const session = r.example_sessions[i];
            return (
              <p
                key={i}
                style={{
                  margin: "0 0 4px",
                  paddingLeft: 12,
                  borderLeft: "2px solid var(--line)",
                  fontSize: 13,
                }}
                className="muted"
              >
                <span style={{ fontStyle: "italic" }}>&ldquo;{e}&rdquo;</span>{" "}
                {session && (
                  <Link
                    href={`/conversations/${session}`}
                    style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
                  >
                    read the conversation
                  </Link>
                )}
              </p>
            );
          })}
        </div>
      )}

      <p style={{ fontSize: 13.5, margin: "0 0 6px" }}>
        <strong>How she decides to answer it.</strong> {r.decides}
      </p>
      <p style={{ fontSize: 13.5, margin: "0 0 8px" }}>
        <strong>What she reads.</strong> <span className="mono">{r.reads}</span>
      </p>

      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: ".08em",
        }}
        className="muted"
      >
        How that got populated
      </div>
      <ol style={{ margin: "6px 0 8px", paddingLeft: 20, fontSize: 13.5 }}>
        {r.chain_steps.map((s, i) => (
          <li key={i} style={{ marginBottom: 3 }}>
            {s}
          </li>
        ))}
      </ol>
      <p style={{ fontSize: 13.5, margin: "0 0 6px" }}>
        <strong>Who ultimately types it.</strong> {r.ends_at}
      </p>

      {r.caveat && (
        <p
          style={{
            fontSize: 13,
            margin: "8px 0 0",
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderLeft: "3px solid #96570E",
            borderRadius: 3,
          }}
        >
          <strong>Worth knowing.</strong> {r.caveat}
        </p>
      )}

      {/* Corrections. Stored in bot.question_notes, not on the trace row: the
          traces are rebuilt wholesale by the generator and would take the
          notes with them. */}
      <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        {notes.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {notes.map((n) => (
              <div
                key={n.id}
                style={{
                  fontSize: 13,
                  padding: "7px 10px",
                  marginBottom: 6,
                  border: "1px solid var(--line)",
                  borderLeft: "3px solid #1D6B54",
                  borderRadius: 3,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <strong>Should be:</strong> {n.should_be}
                  <div className="muted mono" style={{ fontSize: 11.5 }}>
                    {n.author_email} ·{" "}
                    {new Date(n.created_at).toLocaleDateString("en-GB")}
                  </div>
                </div>
                <form action={resolveQuestionNoteAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="btn secondary">
                    Done
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        <form
          action={addQuestionNoteAction}
          style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
        >
          <input type="hidden" name="question_key" value={r.key} />
          <textarea
            name="should_be"
            rows={2}
            placeholder="If this is wrong, how should it be answered?"
            aria-label={`How should "${r.question}" be answered?`}
            style={{ flex: 1, fontSize: 13, padding: "6px 8px" }}
          />
          <button type="submit" className="btn secondary">
            Save
          </button>
        </form>
      </div>
    </div>
  );
}

// The artefact an answer ultimately rests on, highlighted rather than buried at
// the end of the chain: for most people this is the only line that matters,
// because it names the thing they would have to open and edit.
function Sources({
  sources,
  chain,
}: {
  sources: UltimateSource[];
  chain: string;
}) {
  return (
    <div
      style={{
        margin: "0 0 12px",
        padding: "9px 12px",
        border: "1px solid var(--line)",
        borderLeft: "3px solid #0E5A62",
        borderRadius: 3,
        background: "rgba(14,90,98,0.04)",
      }}
    >
      <div
        className="muted"
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: ".08em",
          marginBottom: 5,
        }}
      >
        Ultimate source
      </div>
      {sources.length === 0 ? (
        <div style={{ fontSize: 13.5 }}>
          <strong>No document.</strong>{" "}
          {chain === "Filed as a ticket"
            ? "Nothing is looked up — a Member Care agent writes the answer."
            : "Nothing is looked up — the member is handed a Freshdesk form and the form is configured in Freshdesk."}
        </div>
      ) : (
        sources.map((s) => (
          <div
            key={s.key}
            style={{
              fontSize: 13.5,
              display: "flex",
              gap: 8,
              alignItems: "baseline",
              flexWrap: "wrap",
              marginBottom: 3,
            }}
          >
            <span className="badge grey" style={{ fontSize: 10.5 }}>
              {KIND_SHORT[s.kind] ?? s.kind}
            </span>
            {s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>
            ) : (
              <strong>{s.name}</strong>
            )}
            {s.wiring === "not_wired" && (
              <span className="badge red" style={{ fontSize: 10.5 }}>
                nothing reads it
              </span>
            )}
            {s.last_used_at && (
              <span className="muted mono" style={{ fontSize: 11 }}>
                last used {fmtDate(s.last_used_at)}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
