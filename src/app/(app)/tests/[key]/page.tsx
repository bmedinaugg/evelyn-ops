import Link from "next/link";
import { notFound } from "next/navigation";
import { getTestScenario, listTestProfiles, listTestRuns, getCaseLibrary } from "@/lib/queries";
import { ScenarioForm } from "../ScenarioForm";
import { RunButton } from "../RunButton";
import { RunLine } from "../shared";

export const dynamic = "force-dynamic";

export default async function ScenarioPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [s, profiles, runs, cases] = await Promise.all([
    getTestScenario(key), listTestProfiles(), listTestRuns(20, key), getCaseLibrary(30),
  ]);
  if (!s) notFound();
  const p = s.profile_key ? profiles.find((x) => x.key === s.profile_key) : null;
  const blocked = s.profile_key && !p?.email ? `needs e-mail for ${p?.label ?? s.profile_key}` : undefined;

  return (
    <>
      <div className="pagehead"><h1>{s.title}</h1></div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        <Link href="/tests">Test runs</Link> · {p ? `logs in as ${p.label}` : "pre-login"}
        {s.case_key && <> · <Link href={`/cases/${s.case_key}`}>case</Link></>}
        {" · "}<RunButton scenarioKey={s.key} turns={s.turns.length} login={!!s.profile_key} disabled={blocked} />
      </p>
      <div className="panel" style={{ padding: 16 }}>
        <ScenarioForm scenario={s} profiles={profiles} cases={cases.map((c) => ({ key: c.key, label: `${c.area} · ${c.trigger_label}` }))} />
      </div>
      <div className="section" style={{ marginTop: 22 }}>
        <h2>Runs</h2>
        <div className="panel" style={{ padding: 16 }}>
          {runs.length === 0 && <span className="muted">Not run yet.</span>}
          {runs.map((r) => <RunLine key={r.id} r={r} />)}
        </div>
      </div>
    </>
  );
}
