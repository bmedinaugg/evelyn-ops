import Link from "next/link";
import { notFound } from "next/navigation";
import { getTestRun } from "@/lib/queries";
import { amsterdamDateTime } from "@/lib/format";
import { RUN_BADGE } from "../../shared";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getTestRun(id);
  if (!r) notFound();
  const checks = r.turns.flatMap((t) => t.checks);
  const bad = checks.filter((c) => !c.ok).length;
  const loginTurns = r.turns.filter((x) => x.phase === "login").length;

  return (
    <>
      <div className="pagehead">
        <h1>
          <span className={`badge ${RUN_BADGE[r.status]}`} style={{ verticalAlign: "middle" }}>{r.status}</span>{" "}
          <Link href={`/tests/${r.scenario_key}`}>{r.scenario_key}</Link>
        </h1>
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        <Link href="/tests">Test runs</Link> · {r.ran_by} · {amsterdamDateTime(r.started_at)}
        {r.finished_at && <> · {Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)} s</>}
        {checks.length > 0 && <> · {checks.length - bad}/{checks.length} checks passed</>}
        {r.profile_key && <> · as <span className="mono">{r.profile_key}</span></>}
        {r.tickets_closed.length > 0 && <> · Freshdesk ticket {r.tickets_closed.join(", ")} closed as test</>}
      </p>
      {r.error && <div className="panel" style={{ padding: 14, marginBottom: 12 }}><span className="badge grey">error</span> {r.error}</div>}

      <div className="panel" style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}>
        {r.turns.map((t, i) => (
          <div key={i} style={{ borderTop: i ? "1px solid var(--line)" : undefined, padding: "10px 0" }}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t.phase === "login" ? "login" : `turn ${i + 1 - loginTurns}`} · {(t.ms / 1000).toFixed(1)} s
            </div>
            <div><span className="muted">Member:</span> {t.phase === "login" && /^\d{6}$/.test(t.say) ? "(test code)" : t.say}</div>
            <div style={{ marginTop: 4, paddingLeft: 10, borderLeft: "2px solid var(--line)", whiteSpace: "pre-wrap" }}>
              <span className="muted">Evelyn:</span> {t.reply}
            </div>
            {t.checks.length > 0 && (
              <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {t.checks.map((c, j) => (
                  <span key={j} className={`badge ${c.ok ? "green" : "red"}`} style={{ fontSize: 10.5 }} title={c.detail ?? ""}>
                    {c.kind.replace("_", " ")}: {c.value}{c.detail ? ` (${c.detail})` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {r.turns.length === 0 && <span className="muted">No turns recorded.</span>}
      </div>
    </>
  );
}
