import { getKnowledgeSources } from "@/lib/queries";
import { Info } from "@/components/Tile";
import type { KnowledgeSourceRow, KnowledgeWiring } from "@/lib/types";

export const dynamic = "force-dynamic";

// Wiring is the axis the page is organised by, because it is the only one that
// changes what you do next: a source nothing reads cannot be fixed by editing
// it, however carefully it is written.
const WIRING: Record<
  KnowledgeWiring,
  { label: string; badge: string; what: string }
> = {
  live: {
    label: "Live",
    badge: "green",
    what: "Re-read automatically. Change the source and the bot follows, with no deploy.",
  },
  deploy: {
    label: "Deploy",
    badge: "amber",
    what: "Written into an n8n node. Changing it needs an edit and a publish.",
  },
  not_wired: {
    label: "Not wired",
    badge: "red",
    what: "Nothing reads this. Editing it changes nothing until someone copies it across by hand.",
  },
};

const ORDER: KnowledgeWiring[] = ["live", "deploy", "not_wired"];

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function KnowledgePage() {
  const rows = await getKnowledgeSources();

  const oldestVerified = rows.reduce<string | null>(
    (acc, r) => (acc === null || r.verified_at < acc ? r.verified_at : acc),
    null,
  );
  const risks = rows.filter((r) => r.risk);
  const notWired = rows.filter((r) => r.wiring === "not_wired");

  return (
    <>
      <div className="pagehead">
        <h1>Knowledge register</h1>
        <p className="muted">
          Every document and feed influencing what Evelyn knows &mdash; including
          the ones that produced no FAQ at all. TrainMore.
        </p>
      </div>

      {/* The caveat is on the page rather than in a commit message, so it ages
          with the data instead of quietly becoming false. */}
      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>
          There is no ingestion log
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
          The FAQ store is rebuilt from scratch every morning, so every row in it
          carries today&rsquo;s date and the store remembers nothing about when a
          document first arrived or last changed anything. Every date below is
          therefore <strong>reconstructed</strong>, and each row records from
          what &mdash; a file&rsquo;s own modified date, a date built into an n8n
          node name, or a commit.
        </p>
        <p
          className="muted"
          style={{ fontSize: 13, lineHeight: 1.6, maxWidth: "72ch" }}
        >
          The real fix is for the daily sync to write a row each time it imports
          something: what, from where, how many chunks, when. Then this register
          is generated rather than curated. Until that exists, this is the
          record.
        </p>
        <p className="muted mono" style={{ fontSize: 11.5, marginBottom: 0 }}>
          {rows.length} sources · {notWired.length} not wired ·{" "}
          {risks.length} carrying a warning · oldest check{" "}
          {fmtDate(oldestVerified)}
        </p>
      </div>

      {ORDER.map((w) => {
        const group = rows.filter((r) => r.wiring === w);
        if (group.length === 0) return null;
        return (
          <div className="panel" key={w}>
            <h2 style={{ marginTop: 0, fontSize: 15 }}>
              <span className={`badge ${WIRING[w].badge}`}>
                {WIRING[w].label}
              </span>{" "}
              <span className="n">{group.length}</span>{" "}
              <Info text={WIRING[w].what} />
            </h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {WIRING[w].what}
            </p>
            {group.map((r) => (
              <SourceRow key={r.key} r={r} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function SourceRow({ r }: { r: KnowledgeSourceRow }) {
  return (
    <details
      style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}
    >
      <summary style={{ cursor: "pointer" }}>
        <span style={{ fontWeight: 600 }}>{r.name}</span>{" "}
        <span className="badge grey" style={{ fontSize: 10.5 }}>
          {r.kind}
        </span>{" "}
        {r.faq_count != null && (
          <span className="muted mono" style={{ fontSize: 11.5 }}>
            {r.faq_count} FAQs ·{" "}
          </span>
        )}
        <span className="muted mono" style={{ fontSize: 11.5 }}>
          {fmtDate(r.last_used_at) ?? "continuous"}
        </span>
        {r.risk && (
          <span className="badge amber" style={{ fontSize: 10.5 }}>
            {" "}
            watch out
          </span>
        )}
      </summary>

      <div style={{ padding: "8px 0 4px 14px", fontSize: 13, lineHeight: 1.55 }}>
        <p style={{ marginTop: 0 }}>
          <strong>Last used.</strong> {r.last_used}
        </p>
        <p className="muted" style={{ margin: "6px 0" }}>
          <strong>How we know.</strong> {r.evidence}
        </p>
        <p style={{ margin: "6px 0" }}>
          <strong>What it shapes.</strong> {r.influences}
        </p>
        <p className="muted" style={{ margin: "6px 0" }}>
          <strong>Who owns it.</strong> {r.owner}
        </p>
        {r.risk && (
          <p
            style={{
              margin: "8px 0 0",
              padding: "8px 10px",
              border: "1px solid var(--line)",
              borderLeft: "3px solid var(--amber, #96570E)",
              borderRadius: 3,
            }}
          >
            <strong>Watch out.</strong> {r.risk}
          </p>
        )}
        <p className="muted mono" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
          checked {fmtDate(r.verified_at)}
          {r.url && (
            <>
              {" · "}
              <a href={r.url} target="_blank" rel="noopener noreferrer">
                open the source
              </a>
            </>
          )}
        </p>
      </div>
    </details>
  );
}
