"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { propose, type ProposeState } from "./actions";
import type { CaseSource, CaseProposalKind } from "@/lib/types";
import { KIND, SOURCE } from "./shared";

const initial: ProposeState = {};

type CaseOption = { key: string; label: string; area: string; source: CaseSource };

// One form, two homes. On a case page the case is fixed and the form knows the
// source, so it can say what a wrong answer means before the reviewer types.
// On a conversation page the reviewer picks the case, and the session id rides
// along as the example.
export function ProposeForm({
  fixedCase,
  cases,
  sessionId,
}: {
  fixedCase?: CaseOption;
  cases?: CaseOption[];
  sessionId?: string;
}) {
  const [state, action, pending] = useActionState(propose, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<CaseProposalKind>("wrong_behaviour");
  const [picked, setPicked] = useState<string>(fixedCase?.key ?? "");

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  const current = fixedCase ?? cases?.find((c) => c.key === picked);
  const src = current ? SOURCE[current.source] : null;

  return (
    <form action={action} ref={formRef} className="fb-form">
      {sessionId && <input type="hidden" name="session_id" value={sessionId} />}
      {fixedCase && <input type="hidden" name="case_key" value={fixedCase.key} />}

      <div className="fb-row">
        <span className="fb-label">This is</span>
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as CaseProposalKind)}>
          {(Object.keys(KIND) as CaseProposalKind[])
            .filter((k) => fixedCase ? k !== "missing" : true)
            .map((k) => (
              <option key={k} value={k}>{KIND[k].label} — {KIND[k].what}</option>
            ))}
        </select>
      </div>

      {!fixedCase && kind !== "missing" && cases && (
        <div className="fb-row">
          <span className="fb-label">Case</span>
          <select name="case_key" value={picked} onChange={(e) => setPicked(e.target.value)} required>
            <option value="">Pick the case this is about…</option>
            {cases.map((c) => (
              <option key={c.key} value={c.key}>{c.area} · {c.label}</option>
            ))}
          </select>
        </div>
      )}

      {kind === "missing" && (
        <input type="text" name="title" placeholder="Short title for the case the library lacks" required />
      )}

      {/* The line that turns a complaint into something implementable: what
          the source is, and therefore where the fix actually lives. */}
      {src && kind !== "missing" && (
        <div className={`callout`} style={{ fontSize: 12.5 }}>
          <span className={`badge ${src.badge}`} style={{ fontSize: 10.5 }}>{src.label}</span>{" "}
          {src.fix}
          {src.live && kind === "wrong_fact" && (
            <> <strong>A wrong number here is a Magicline correction, not a bot change.</strong></>
          )}
        </div>
      )}

      <textarea
        name="should_be"
        rows={3}
        required
        placeholder={
          kind === "missing"
            ? "What should the bot do when a member asks this?"
            : "What should the bot do or say instead? Be exact — this is what gets built."
        }
        style={{ width: "100%" }}
      />
      <textarea
        name="rationale"
        rows={2}
        placeholder="Why — what it does today, or what happened (optional)"
        style={{ width: "100%" }}
      />
      {state.error && <div className="error">{state.error}</div>}
      {state.ok && (
        <div className="notice">
          Saved.{" "}
          {state.id && current && (
            <Link href={`/cases/${current.key}`}>Open the case</Link>
          )}
          {state.id && !current && <Link href="/cases">See it on Cases</Link>}
        </div>
      )}
      <div>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Propose"}
        </button>
      </div>
    </form>
  );
}
