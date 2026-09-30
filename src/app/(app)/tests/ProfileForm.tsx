"use client";

import { useActionState } from "react";
import { saveProfile, type FormState } from "./actions";
import type { TestProfileRow } from "@/lib/types";

const initial: FormState = {};

export function ProfileForm({ p }: { p: TestProfileRow }) {
  const [state, action, pending] = useActionState(saveProfile, initial);
  return (
    <form action={action} className="fb-form" style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <input type="hidden" name="key" value={p.key} />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        <strong style={{ minWidth: 240 }}>{p.label}</strong>
        <span className="badge grey" style={{ fontSize: 10.5 }}>{p.expected_status}</span>
        <span className={`badge ${p.email ? "green" : "amber"}`} style={{ fontSize: 10.5 }}>{p.email ? "ready" : "no e-mail yet"}</span>
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{p.notes}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="email" name="email" defaultValue={p.email ?? ""} placeholder="e-mail on the Magicline record" style={{ minWidth: 280 }} />
        {p.key === "multi_studio" && (
          <input type="text" name="login_choice" defaultValue={p.login_choice ?? ""} placeholder="what to reply when asked which account" style={{ minWidth: 280 }} />
        )}
        <input type="text" name="notes" defaultValue={p.notes ?? ""} placeholder="notes" style={{ minWidth: 200 }} />
        <label style={{ fontSize: 12 }}><input type="checkbox" name="active" defaultChecked={p.active} /> active</label>
        <button type="submit" className="secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && <div className="notice">Saved.</div>}
    </form>
  );
}
