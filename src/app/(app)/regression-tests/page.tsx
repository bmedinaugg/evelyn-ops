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
        Developer tool — replays a past bot bug against a small, isolated n8n
        test-harness workflow (pure re-implementation of the fix, no real
        Magicline/Freshdesk/OTP calls) and records pass/fail. The harness logic
        is hand-ported from the real fix, so it can drift if the real node
        changes later without updating its harness copy too — treat this as a
        developer aid, not a CI gate.
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
            return (
              <details key={f.id} className="fail-item">
                <summary>
                  <span className="fail-wf">{f.title}</span>
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
