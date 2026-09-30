"use client";

import { useFormStatus } from "react-dom";
import { run } from "./actions";

function Inner({ turns, login }: { turns: number; login: boolean }) {
  const { pending } = useFormStatus();
  const est = (turns + (login ? 3 : 0)) * 12;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <button type="submit" disabled={pending}>{pending ? "Running…" : "Run"}</button>
      {pending
        ? <span className="muted" style={{ fontSize: 12 }}>Talking to the real bot — about {est} s.</span>
        : <span className="muted" style={{ fontSize: 12 }}>~{est} s</span>}
    </span>
  );
}

export function RunButton({ scenarioKey, turns, login, disabled }: { scenarioKey: string; turns: number; login: boolean; disabled?: string }) {
  if (disabled) return <span className="badge amber" style={{ fontSize: 10.5 }}>{disabled}</span>;
  return (
    <form action={run} style={{ display: "inline" }}>
      <input type="hidden" name="key" value={scenarioKey} />
      <Inner turns={turns} login={login} />
    </form>
  );
}
