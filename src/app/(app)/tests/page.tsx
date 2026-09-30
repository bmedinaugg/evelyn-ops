import Link from "next/link";
import { listTestProfiles, listTestScenarios, listTestRuns, getCaseLibrary } from "@/lib/queries";
import { ProfileForm } from "./ProfileForm";
import { ScenarioForm } from "./ScenarioForm";
import { RunButton } from "./RunButton";
import { RunLine } from "./shared";

export const dynamic = "force-dynamic";

export default async function TestsPage() {
  const [profiles, scenarios, runs, cases] = await Promise.all([
    listTestProfiles(), listTestScenarios(), listTestRuns(25), getCaseLibrary(30),
  ]);
  const byKey = new Map(profiles.map((p) => [p.key, p]));
  const last = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!last.has(r.scenario_key)) last.set(r.scenario_key, r);
  const caseOpts = cases.map((c) => ({ key: c.key, label: `${c.area} · ${c.trigger_label}` }));

  return (
    <>
      <div className="pagehead"><h1>Test runs</h1></div>
      <p className="muted" style={{ marginBottom: 10 }}>
        Scenarios played against the <strong>real bot</strong>, through its own chat entry point, as a test
        identity. Logged-in scenarios use the test profiles below; the code the bot e-mails is replaced with a
        known one for test sessions only. When a run is recorded its session is purged and any ticket it filed
        is tagged <span className="mono">evelyn-test</span> and closed.
      </p>

      <div className="section">
        <h2>Test profiles</h2>
        <div className="panel" style={{ padding: 16 }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
            Each is a real customer record in Magicline. Enter the e-mail on that record; the bot finds it the same
            way it finds a member. OTP throttle: 5 codes per hour per e-mail, 2 minutes apart.
          </p>
          {profiles.map((p) => <ProfileForm key={p.key} p={p} />)}
        </div>
      </div>

      <div className="section" style={{ marginTop: 22 }}>
        <h2>Scenarios</h2>
        <div className="panel" style={{ padding: 16 }}>
          {scenarios.map((s) => {
            const p = s.profile_key ? byKey.get(s.profile_key) : null;
            const blocked = s.profile_key && !p?.email ? `needs e-mail for ${p?.label ?? s.profile_key}` : undefined;
            const lr = last.get(s.key);
            return (
              <div key={s.key} style={{ borderTop: "1px solid var(--line)", padding: "9px 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <Link href={`/tests/${s.key}`} style={{ fontWeight: 600, flex: "1 1 260px" }}>{s.title}</Link>
                <span className="badge grey" style={{ fontSize: 10.5 }}>{p ? p.label : "pre-login"}</span>
                {lr && <span className={`badge ${lr.status === "passed" ? "green" : lr.status === "failed" ? "red" : "grey"}`} style={{ fontSize: 10.5 }}>last: {lr.status}</span>}
                <RunButton scenarioKey={s.key} turns={s.turns.length} login={!!s.profile_key} disabled={blocked} />
              </div>
            );
          })}
        </div>
      </div>

      <div className="section" style={{ marginTop: 22 }}>
        <h2>New scenario</h2>
        <div className="panel" style={{ padding: 16 }}>
          <ScenarioForm profiles={profiles} cases={caseOpts} />
        </div>
      </div>

      <div className="section" style={{ marginTop: 22 }}>
        <h2>Recent runs</h2>
        <div className="panel" style={{ padding: 16 }}>
          {runs.length === 0 && <span className="muted">No runs yet.</span>}
          {runs.map((r) => <RunLine key={r.id} r={r} />)}
        </div>
      </div>
    </>
  );
}
