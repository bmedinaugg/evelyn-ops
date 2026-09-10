import Link from "next/link";
import { getCaseLibrary } from "@/lib/queries";
import { Info } from "@/components/Tile";
import type { CaseAction, CaseSource, CaseLibraryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

// Areas in the order a conversation actually travels through them, not
// alphabetically — the page reads as the member's journey.
const AREAS = [
  "Pre-login",
  "Authentication",
  "Account questions",
  "Self-service redirect",
  "Ticketing",
  "Guardrails",
  "Dead ends",
] as const;

const ACTION: Record<CaseAction, { label: string; badge: string; what: string }> = {
  answer:   { label: "answers",   badge: "green", what: "States a fact from a source." },
  link:     { label: "sends a link", badge: "blue", what: "Hands over a URL and stops. The member still does the work." },
  ticket:   { label: "files a ticket", badge: "amber", what: "Collects details and creates a Freshdesk ticket." },
  process:  { label: "runs a process", badge: "blue", what: "Performs a real action, including the one write it can make to member data." },
  refuse:   { label: "declines",  badge: "grey",  what: "Says it cannot help with this, on purpose." },
  handoff:  { label: "hands off", badge: "amber", what: "Routes to a human or captures a lead." },
  block:    { label: "guardrail", badge: "red",   what: "Overrides what the model would otherwise have said." },
  dead_end: { label: "dead end",  badge: "red",   what: "The member gets nothing useful." },
};

const SOURCE: Record<CaseSource, { label: string; what: string }> = {
  club_directory: { label: "Club directory", what: "bot.public_locations, fed daily from the reference workbook and gated by bot.club_visibility." },
  magicline:      { label: "Magicline", what: "Live account data, read per question by one of 18 tools." },
  prompt:         { label: "Prompt knowledge", what: "Written into an n8n system prompt. Changing it means editing the workflow." },
  faq_vector:     { label: "FAQ vector store", what: "Supabase vector store searched with OpenAI embeddings." },
  freshdesk_form: { label: "Freshdesk form", what: "A customer-facing form on the support portal." },
  freshdesk_api:  { label: "Freshdesk API", what: "Read or written through the Freshdesk API." },
  guardrail:      { label: "Guardrail block", what: "Code-gated text injected above the prompt." },
  database:       { label: "Database", what: "A bot.* table." },
  none:           { label: "No source", what: "Boilerplate, a refusal, or a failure path." },
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; act?: string }>;
}) {
  const sp = await searchParams;
  const src = (Object.keys(SOURCE) as string[]).includes(String(sp.src)) ? String(sp.src) : null;
  const act = (Object.keys(ACTION) as string[]).includes(String(sp.act)) ? String(sp.act) : null;

  const all = await getCaseLibrary(30);
  const rows = all.filter(
    (r) => (!src || r.source_kind === src) && (!act || r.action_type === act),
  );

  const oldest = all.reduce<string | null>(
    (o, r) => (o === null || r.verified_at < o ? r.verified_at : o),
    null,
  );
  const ageDays = oldest
    ? Math.round((Date.now() - new Date(oldest).getTime()) / 86400000)
    : 0;

  const bySource = new Map<string, number>();
  const byAction = new Map<string, number>();
  for (const r of all) {
    bySource.set(r.source_kind, (bySource.get(r.source_kind) ?? 0) + 1);
    byAction.set(r.action_type, (byAction.get(r.action_type) ?? 0) + 1);
  }

  const qs = (k: "src" | "act", v: string | null) => {
    const p = new URLSearchParams();
    if (k === "src" ? v : src) p.set("src", (k === "src" ? v : src) as string);
    if (k === "act" ? v : act) p.set("act", (k === "act" ? v : act) as string);
    const s = p.toString();
    return s ? `/library?${s}` : "/library";
  };

  return (
    <>
      <div className="pagehead">
        <h1>Case library</h1>
      </div>

      <p className="muted" style={{ marginBottom: 10 }}>
        Every case Evelyn handles: what the member asks, what she does about it,
        and <strong>where the answer comes from</strong>. {all.length} cases.
      </p>

      <details className="panel" style={{ marginBottom: 12 }}>
        <summary>How to read this, and what it is not</summary>
        <div style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.55 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            This is <em>not</em> the{" "}
            <Link href="/scenarios">scenario library</Link>. That one covers{" "}
            <strong>recognition</strong> — which words the bot matches, with
            measured misfire rates. This one covers everything after that: the
            action, the process, and the source of truth.
          </p>
          <p className="muted">
            <strong>The prose here is hand-written</strong> from reading the
            live n8n workflows, and it does not update itself. Each case carries
            the date it was last checked. The <em>numbers</em> are different —
            they are recomputed from the last 30 days every time this page
            loads, so a case cannot quietly keep claiming a volume it no longer
            has. A case with no countable signal shows no number at all rather
            than a zero, because &ldquo;0&rdquo; would read as
            &ldquo;never happens&rdquo;.
          </p>
          <p className="muted">
            <strong>Sources are the useful column</strong>, and each one says
            not just where the answer comes from but{" "}
            <strong>how that source is refilled and who can change it</strong>.
            That is the part that tells you what to do when an answer is wrong.
          </p>
          <table style={{ marginTop: 4 }}>
            <tbody>
              <tr><td style={{ width: 150 }}><strong>Club directory</strong></td>
                <td>An <strong>Excel workbook</strong> → <span className="mono">bot.locations</span>, daily 10:00. Fix the sheet, the bot follows next morning.</td></tr>
              <tr><td><strong>Magicline</strong></td>
                <td>Not stored — read live per question. A wrong answer means wrong data in Magicline.</td></tr>
              <tr><td><strong>FAQ vector store</strong></td>
                <td>Rebuilt <strong>in full</strong> daily 10:00 from Freshdesk articles, hand-written Member Care answers and uploaded documents.</td></tr>
              <tr><td><strong>Prompt knowledge</strong></td>
                <td>Typed into a workflow. <strong>Member Care cannot correct these</strong> — it needs an engineering change and a publish.</td></tr>
              <tr><td><strong>Guardrails</strong></td>
                <td>Code injected above the prompt. They exist because prompt wording alone did not hold.</td></tr>
              <tr><td><strong>Freshdesk forms</strong></td>
                <td>Freshdesk admin. The bot hardcodes the slug, so renaming a form breaks the link silently.</td></tr>
            </tbody>
          </table>
          <p className="muted" style={{ marginBottom: 0 }}>
            The nightly chain behind several of these: <strong>02:00</strong>{" "}
            ticket categories from Freshdesk → <strong>04:00</strong> form
            options → <strong>10:00</strong> club sheet and FAQ rebuild. All
            four verified against real n8n execution history, not the schedule
            setting.
          </p>
        </div>
      </details>

      {ageDays > 21 && (
        <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
          <span className="badge amber">stale</span> The oldest case here was
          last checked against the live workflows{" "}
          <strong>{ageDays} days ago</strong>. The bot has almost certainly
          changed since. Treat the descriptions as a starting point and
          re-verify before relying on one.
        </div>
      )}

      <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
        <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          What the bot does
        </div>
        <div className="controls" style={{ marginBottom: 10 }}>
          <Link href={qs("act", null)} className={`sfilter tone-accent${!act ? " active" : ""}`}>
            All <span className="n">{all.length}</span>
          </Link>
          {(Object.keys(ACTION) as CaseAction[])
            .filter((a) => byAction.get(a))
            .map((a) => (
              <Link key={a} href={qs("act", a)} className={`sfilter tone-${ACTION[a].badge}${act === a ? " active" : ""}`}>
                {ACTION[a].label} <span className="n">{byAction.get(a)}</span>
              </Link>
            ))}
        </div>
        <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Where the answer comes from
        </div>
        <div className="controls">
          <Link href={qs("src", null)} className={`sfilter tone-accent${!src ? " active" : ""}`}>
            All sources
          </Link>
          {(Object.keys(SOURCE) as CaseSource[])
            .filter((s) => bySource.get(s))
            .map((s) => (
              <Link key={s} href={qs("src", s)} className={`sfilter tone-grey${src === s ? " active" : ""}`}>
                {SOURCE[s].label} <span className="n">{bySource.get(s)}</span>
                <Info text={SOURCE[s].what} />
              </Link>
            ))}
        </div>
      </div>

      {AREAS.map((area) => {
        const inArea = rows.filter((r) => r.area === area);
        if (!inArea.length) return null;
        return (
          <div key={area} className="panel" style={{ padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 650, marginBottom: 10 }}>
              {area} <span className="muted">· {inArea.length}</span>
            </div>
            {inArea.map((r) => (
              <CaseRow key={r.key} r={r} />
            ))}
          </div>
        );
      })}

      {rows.length === 0 && (
        <div className="panel" style={{ padding: 18 }} >
          <span className="muted">No cases match that filter.</span>
        </div>
      )}
    </>
  );
}

function CaseRow({ r }: { r: CaseLibraryRow }) {
  const a = ACTION[r.action_type];
  const s = SOURCE[r.source_kind];
  return (
    <details style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <summary style={{ cursor: "pointer" }}>
        <span style={{ fontWeight: 600 }}>{r.trigger_label}</span>{" "}
        <span className={`badge ${a.badge}`} style={{ fontSize: 10.5 }}>{a.label}</span>{" "}
        <span className="badge grey" style={{ fontSize: 10.5 }}>{s.label}</span>
        {r.measured != null && (
          <span className="muted mono" style={{ fontSize: 11.5 }}>
            {" "}· {r.measured.toLocaleString()} {r.measured_label} / 30d
          </span>
        )}
        {r.known_issues && (
          <span className="badge amber" style={{ fontSize: 10.5 }}> known issue</span>
        )}
      </summary>

      <div style={{ padding: "8px 0 4px 14px", fontSize: 13, lineHeight: 1.55 }}>
        {r.trigger_detail && (
          <p className="muted" style={{ marginTop: 0 }}>
            <strong>Recognised by.</strong> {r.trigger_detail}
          </p>
        )}

        <p style={{ margin: "6px 0" }}>
          <strong>What she does.</strong> {r.action_summary}
        </p>

        {r.process_steps.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginTop: 8 }}>
              The process
            </div>
            <ol className="muted" style={{ margin: "4px 0", paddingLeft: 20 }}>
              {r.process_steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </>
        )}

        <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Source of truth</div>
          <p className="muted" style={{ margin: "3px 0" }}>
            <strong>{s.label}</strong>
            {r.source_detail ? ` — ${r.source_detail}` : ""}
          </p>

          {r.refresh_mechanism && (
            <p className="muted" style={{ margin: "6px 0 3px" }}>
              <strong>How it gets updated.</strong> {r.refresh_mechanism}
            </p>
          )}
          {r.refresh_cadence && (
            <p className="muted" style={{ margin: "3px 0" }}>
              <strong>When.</strong> {r.refresh_cadence}
            </p>
          )}
          {r.refresh_owner && (
            // The most actionable line on the page: it answers "so who do I
            // talk to when this answer is wrong?"
            <p style={{ margin: "3px 0" }}>
              <strong>Who can change it.</strong> {r.refresh_owner}
            </p>
          )}

          {r.workflow && (
            <p className="muted mono" style={{ fontSize: 11.5, margin: "6px 0 0" }}>
              {r.workflow}
            </p>
          )}
        </div>

        {r.known_issues && (
          <p style={{ margin: "8px 0 0" }}>
            <span className="badge amber">known issue</span> {r.known_issues}
          </p>
        )}

        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Checked against the live workflow on {r.verified_at}.
        </p>
      </div>
    </details>
  );
}
