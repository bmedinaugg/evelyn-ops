import Link from "next/link";
import { amsterdamDateTime } from "@/lib/format";
import type { TestRunRow, TestRunStatus } from "@/lib/types";

export const RUN_BADGE: Record<TestRunStatus, string> = {
  running: "amber", passed: "green", failed: "red", error: "grey",
};

export function RunLine({ r }: { r: TestRunRow }) {
  const checks = r.turns.flatMap((t) => t.checks);
  const bad = checks.filter((c) => !c.ok).length;
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "7px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline", fontSize: 13 }}>
      <span className={`badge ${RUN_BADGE[r.status]}`} style={{ fontSize: 10.5 }}>{r.status}</span>
      <Link href={`/tests/runs/${r.id}`} style={{ fontWeight: 600 }}>{r.scenario_key}</Link>
      <span className="muted" style={{ fontSize: 12 }}>
        {r.ran_by.split("@")[0]} · {amsterdamDateTime(r.started_at)} · {r.turns.length} turns
        {checks.length > 0 && <> · {checks.length - bad}/{checks.length} checks</>}
        {r.tickets_closed.length > 0 && <> · closed ticket {r.tickets_closed.join(", ")}</>}
      </span>
      {r.error && <span className="error" style={{ fontSize: 12 }}>{r.error.slice(0, 120)}</span>}
    </div>
  );
}
