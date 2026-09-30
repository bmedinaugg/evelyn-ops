import Link from "next/link";
import { getCaseLibrary, listCaseProposals } from "@/lib/queries";
import type { CaseLibraryRow, CaseProposalRow } from "@/lib/types";
import { AREAS, ACTION, SOURCE, STATUS, KIND } from "./shared";

export const dynamic = "force-dynamic";

// What the list says about each case, derived from its proposals. One word,
// one colour, so the page can be scanned for "where is there disagreement".
type CaseState =
  | { kind: "disputed"; p: CaseProposalRow }
  | { kind: "open"; p: CaseProposalRow }
  | { kind: "accepted"; p: CaseProposalRow }
  | { kind: "settled" };

function stateOf(key: string, proposals: CaseProposalRow[]): CaseState {
  const mine = proposals.filter((p) => p.case_key === key);
  const open = mine.find((p) => p.status === "open");
  if (open && open.object_n > 0) return { kind: "disputed", p: open };
  if (open) return { kind: "open", p: open };
  const accepted = mine.find((p) => p.status === "accepted");
  if (accepted) return { kind: "accepted", p: accepted };
  return { kind: "settled" };
}

const STATE_BADGE: Record<CaseState["kind"], { label: string; badge: string }> = {
  disputed: { label: "disputed",       badge: "red" },
  open:     { label: "proposal open",  badge: "amber" },
  accepted: { label: "to implement",   badge: "blue" },
  settled:  { label: "no proposals",   badge: "grey" },
};

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>;
}) {
  const sp = await searchParams;
  const only = ["disputed", "open", "accepted"].includes(String(sp.only)) ? String(sp.only) : null;

  const [cases, proposals] = await Promise.all([getCaseLibrary(30), listCaseProposals()]);
  const missing = proposals.filter((p) => !p.case_key && (p.status === "open" || p.status === "accepted"));

  const states = new Map<string, CaseState>();
  for (const c of cases) states.set(c.key, stateOf(c.key, proposals));
  const tally = { disputed: 0, open: 0, accepted: 0, settled: 0 };
  for (const s of states.values()) tally[s.kind]++;

  const oldest = cases.reduce<string | null>((o, r) => (o === null || r.verified_at < o ? r.verified_at : o), null);
  const ageDays = oldest ? Math.round((Date.now() - new Date(oldest).getTime()) / 86400000) : 0;

  return (
    <>
      <div className="pagehead">
        <h1>Cases</h1>
      </div>
      <p className="muted" style={{ marginBottom: 10 }}>
        Every case Evelyn handles — what the member asks, what she does,{" "}
        <strong>where the answer comes from</strong> — and the one place to say
        it should be different. {cases.length} cases.
      </p>

      <details className="panel" style={{ marginBottom: 12 }}>
        <summary>How feedback works here</summary>
        <div style={{ padding: "0 16px 14px", fontSize: 13, lineHeight: 1.55 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Open a case. It shows the current behaviour and its{" "}
            <strong>source</strong> — and the source tells you where a fix
            lives. A price read live from Magicline is corrected in Magicline;
            a sentence typed into a prompt is corrected by proposing the new
            sentence here.
          </p>
          <p className="muted">
            <strong>One open proposal per case.</strong> If someone already
            proposed a change, you agree, object or comment on theirs rather
            than opening a second. An objection marks the case{" "}
            <span className="badge red" style={{ fontSize: 10.5 }}>disputed</span>{" "}
            so a disagreement is settled before anything is built, not after.
          </p>
          <p className="muted" style={{ marginBottom: 0 }}>
            Bryan accepts or rejects; an accepted proposal is work; once shipped
            it is marked implemented on the case, so you can see your change
            landed.
          </p>
        </div>
      </details>

      {ageDays > 21 && (
        <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
          <span className="badge amber">stale</span> The oldest case description
          was checked against the live bot <strong>{ageDays} days ago</strong>.
          Treat descriptions as a starting point; the proposals are current.
        </div>
      )}

      <div className="panel" style={{ padding: 14, marginBottom: 12 }}>
        <div className="controls">
          <Link href="/cases" className={`sfilter tone-accent${!only ? " active" : ""}`}>
            All <span className="n">{cases.length}</span>
          </Link>
          {(["disputed", "open", "accepted"] as const).map((k) => (
            <Link key={k} href={`/cases?only=${k}`} className={`sfilter tone-${STATE_BADGE[k].badge}${only === k ? " active" : ""}`}>
              {STATE_BADGE[k].label} <span className="n">{tally[k]}</span>
            </Link>
          ))}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="panel" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ fontWeight: 650, marginBottom: 8 }}>
            Cases the library does not have yet <span className="muted">· {missing.length}</span>
          </div>
          {missing.map((p) => (
            <div key={p.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", fontSize: 13 }}>
              <span className={`badge ${STATUS[p.status].badge}`} style={{ fontSize: 10.5 }}>{STATUS[p.status].label}</span>{" "}
              <strong>{p.title}</strong>
              <span className="muted"> — {p.proposed_by}</span>
              <div className="muted" style={{ marginTop: 3 }}>{p.should_be}</div>
              <div style={{ marginTop: 4 }}>
                <Link href={`/cases/_missing/${p.id}`} style={{ fontSize: 12 }}>Open</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {AREAS.map((area) => {
        const inArea = cases.filter((c) => c.area === area && (!only || states.get(c.key)?.kind === only));
        if (!inArea.length) return null;
        return (
          <div key={area} className="panel" style={{ padding: 16, marginTop: 14 }}>
            <div style={{ fontWeight: 650, marginBottom: 10 }}>
              {area} <span className="muted">· {inArea.length}</span>
            </div>
            {inArea.map((c) => (
              <Row key={c.key} c={c} s={states.get(c.key)!} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function Row({ c, s }: { c: CaseLibraryRow; s: CaseState }) {
  const a = ACTION[c.action_type];
  const src = SOURCE[c.source_kind];
  const st = STATE_BADGE[s.kind];
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "9px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
      <Link href={`/cases/${c.key}`} style={{ fontWeight: 600, minWidth: 260, flex: "1 1 260px" }}>
        {c.trigger_label}
      </Link>
      <span className={`badge ${a.badge}`} style={{ fontSize: 10.5 }}>{a.label}</span>
      <span className={`badge ${src.badge}`} style={{ fontSize: 10.5 }}>{src.label}</span>
      <span className={`badge ${st.badge}`} style={{ fontSize: 10.5 }}>{st.label}</span>
      {"p" in s && (
        <span className="muted" style={{ fontSize: 11.5 }}>
          {KIND[s.p.kind].label.toLowerCase()} · {s.p.proposed_by.split("@")[0]}
          {s.p.object_n > 0 && <> · {s.p.object_n} objection{s.p.object_n === 1 ? "" : "s"}</>}
        </span>
      )}
      {c.measured != null && (
        <span className="muted mono" style={{ fontSize: 11 }}>{c.measured.toLocaleString()} {c.measured_label} / 30d</span>
      )}
    </div>
  );
}
