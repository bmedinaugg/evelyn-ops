import { listWorkflowErrors } from "@/lib/queries";
import { amsterdamDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FailuresPage() {
  const errors = await listWorkflowErrors();

  // Summary by workflow: count + most-recent occurrence.
  const byWorkflow = new Map<string, { count: number; last: string }>();
  for (const e of errors) {
    const key = e.workflow_name ?? "(unknown)";
    const prev = byWorkflow.get(key);
    if (!prev) byWorkflow.set(key, { count: 1, last: e.created_at });
    else {
      prev.count += 1;
      if (e.created_at > prev.last) prev.last = e.created_at;
    }
  }
  const summary = [...byWorkflow.entries()].sort((a, b) => b[1].count - a[1].count);

  return (
    <>
      <div className="pagehead">
        <h1>Dev fails</h1>
        <span className="muted">{errors.length} recent workflow errors</span>
      </div>

      <div className="callout" style={{ marginBottom: 16 }}>
        Developer / maintainer view — raw n8n workflow errors. Not needed for
        bot evaluation.
      </div>

      {errors.length === 0 ? (
        <div className="callout">No workflow errors recorded. 🎉</div>
      ) : (
        <>
          <div className="section" style={{ marginTop: 0 }}>
            <h2>By workflow</h2>
            <div className="grid tiles">
              {summary.map(([name, s]) => (
                <div key={name} className={`tile${s.count >= 5 ? " warn" : ""}`}>
                  <div className="k">{name}</div>
                  <div className="v">{s.count}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    last {amsterdamDateTime(s.last)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <h2>Recent errors</h2>
            <p className="muted">Click an error to see details and its execution id.</p>
            <div className="fail-list">
              {errors.map((e) => (
                <details key={e.id} className="fail-item">
                  <summary>
                    <span className="mono">{amsterdamDateTime(e.created_at)}</span>
                    <span className="fail-wf">{e.workflow_name ?? "(unknown)"}</span>
                    {e.node_name && (
                      <span className="muted">· {e.node_name}</span>
                    )}
                  </summary>
                  <div className="fail-body">
                    <div className="fail-msg">{e.error_message ?? "(no message)"}</div>
                    <div className="fail-exec">
                      Execution ID:{" "}
                      <span className="mono">{e.execution_id ?? "—"}</span>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
