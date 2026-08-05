import { listRegressionFixtures } from "@/lib/queries";
import { amsterdamDateTime } from "@/lib/format";
import { runFixture } from "./actions";

export const dynamic = "force-dynamic";

export default async function RegressionTestsPage() {
  const fixtures = await listRegressionFixtures();

  return (
    <>
      <div className="pagehead">
        <h1>Regression tests</h1>
        <span className="muted">{fixtures.length} known-bug fixtures</span>
      </div>

      <div className="callout" style={{ marginBottom: 16 }}>
        Developer tool. <strong>Live</strong> fixtures drive the real n8n
        sub-workflow through the harness (a genuine pre-prod gate — a green suite
        is the approval artifact for editing that node). <strong>Ported</strong>{" "}
        fixtures replay a hand-ported copy of a past fix against an isolated
        harness workflow (no real Magicline/Freshdesk/OTP calls); those can drift
        if the real node changes without updating the copy, so treat them as a
        developer aid.
      </div>

      {fixtures.length === 0 ? (
        <div className="callout">No fixtures seeded yet.</div>
      ) : (
        <div className="fail-list">
          {fixtures.map((f) => {
            const run = f.last_run;
            const badge = !run ? (
              <span className="badge grey">never run</span>
            ) : run.passed ? (
              <span className="badge green">pass</span>
            ) : (
              <span className="badge red">fail</span>
            );
            const kindBadge = f.target_workflow_id ? (
              <span className="badge blue">live</span>
            ) : (
              <span className="badge grey">ported</span>
            );
            return (
              <details key={f.id} className="fail-item">
                <summary>
                  <span className="fail-wf">{f.title}</span>
                  {kindBadge}
                  {badge}
                  {run && (
                    <span className="muted">
                      · {amsterdamDateTime(run.ran_at)} by {run.ran_by}
                    </span>
                  )}
                </summary>
                <div className="fail-body">
                  <div className="fail-msg" style={{ color: "var(--text)" }}>
                    {f.description}
                  </div>

                  <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    Input
                  </div>
                  <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>
                    {JSON.stringify(f.input_payload, null, 2)}
                  </pre>

                  <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                    Expected result
                  </div>
                  <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>
                    {JSON.stringify(f.expected_result, null, 2)}
                  </pre>

                  {run && (
                    <>
                      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                        Last actual result
                      </div>
                      <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>
                        {JSON.stringify(run.actual_result, null, 2)}
                      </pre>
                      {run.notes && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {run.notes}
                        </div>
                      )}
                    </>
                  )}

                  <form action={runFixture} style={{ marginTop: 12 }}>
                    <input type="hidden" name="fixture_key" value={f.key} />
                    <button type="submit" className="btn">
                      {run ? "Run again" : "Run"}
                    </button>
                  </form>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}
