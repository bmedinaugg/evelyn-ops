"use client";

import { useActionState, useState } from "react";
import { saveScenario, type FormState } from "./actions";
import type { TestProfileRow, TestScenarioRow, TestTurnSpec } from "@/lib/types";

const initial: FormState = {};
const blank: TestTurnSpec = { say: "", contains: [], not_contains: [], matches: null, outcome: null };

// Turns are plain fields, not JSON: one line the member says, and the words
// the reply must / must not contain, separated by |. That is the whole format
// Member Care needs; regex and outcome are there for the rare case.
export function ScenarioForm({
  scenario,
  profiles,
  cases,
}: {
  scenario?: TestScenarioRow;
  profiles: TestProfileRow[];
  cases: { key: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(saveScenario, initial);
  const [turns, setTurns] = useState<TestTurnSpec[]>(scenario?.turns.length ? scenario.turns : [blank]);

  return (
    <form action={action} className="fb-form">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="text" name="key" defaultValue={scenario?.key ?? ""} placeholder="key, e.g. member_flex_notice" readOnly={!!scenario} style={{ minWidth: 220 }} required />
        <input type="text" name="title" defaultValue={scenario?.title ?? ""} placeholder="Title" style={{ flex: "1 1 300px" }} required />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select name="profile_key" defaultValue={scenario?.profile_key ?? ""}>
          <option value="">Pre-login (no profile)</option>
          {profiles.map((p) => <option key={p.key} value={p.key}>Log in as: {p.label}{p.email ? "" : " (no e-mail yet)"}</option>)}
        </select>
        <select name="case_key" defaultValue={scenario?.case_key ?? ""}>
          <option value="">No case</option>
          {cases.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <label style={{ fontSize: 12 }}><input type="checkbox" name="active" defaultChecked={scenario?.active ?? true} /> active</label>
      </div>

      {turns.map((t, i) => (
        <div key={i} style={{ borderLeft: "2px solid var(--line)", paddingLeft: 10, marginTop: 6 }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>Turn {i + 1}</div>
          <textarea name={`say_${i}`} defaultValue={t.say} rows={2} placeholder="What the member says" style={{ width: "100%" }} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="text" name={`contains_${i}`} defaultValue={(t.contains ?? []).join(" | ")} placeholder="reply must contain (a | b)" style={{ flex: "1 1 220px" }} />
            <input type="text" name={`not_contains_${i}`} defaultValue={(t.not_contains ?? []).join(" | ")} placeholder="must NOT contain (a | b)" style={{ flex: "1 1 220px" }} />
            <input type="text" name={`matches_${i}`} defaultValue={t.matches ?? ""} placeholder="regex (optional)" style={{ flex: "0 1 160px" }} />
            <select name={`outcome_${i}`} defaultValue={t.outcome ?? ""}>
              <option value="">no outcome check</option>
              <option value="no_ticket">no ticket filed</option>
              <option value="ticket_filed">a ticket is filed</option>
            </select>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="secondary" onClick={() => setTurns((x) => [...x, blank])} disabled={turns.length >= 12}>+ turn</button>
        <button type="submit" disabled={pending}>{pending ? "Saving…" : scenario ? "Save scenario" : "Create scenario"}</button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="notice">Saved.</div>}
    </form>
  );
}
