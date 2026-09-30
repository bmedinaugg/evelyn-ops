import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCaseLibrary,
  listCaseProposals,
  listCaseProposalComments,
  listCaseTrials,
  isCaseApprover,
} from "@/lib/queries";
import { getStaffUser } from "@/lib/auth";
import { amsterdamDateTime } from "@/lib/format";
import type { CaseLibraryRow, CaseProposalRow, CaseProposalCommentRow, CaseTrialRow } from "@/lib/types";
import { ACTION, SOURCE, KIND, STATUS, TRIAL_TARGETS, TRIAL_NOT_YET } from "../shared";
import { ProposeForm } from "../ProposeForm";
import { ReplyForm } from "../ReplyForm";
import { TryItForm } from "../TryItForm";
import { decide } from "../actions";

export const dynamic = "force-dynamic";

export default async function CasePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const [cases, proposals, approver, user, trials] = await Promise.all([
    getCaseLibrary(30),
    listCaseProposals(),
    isCaseApprover(),
    getStaffUser(),
    listCaseTrials(key),
  ]);
  const c = cases.find((r) => r.key === key) ?? null;
  if (!c) notFound();

  const mine = proposals.filter((p) => p.case_key === key);
  const open = mine.find((p) => p.status === "open") ?? null;
  const history = mine.filter((p) => p.status !== "open");
  const comments = await listCaseProposalComments(mine.map((p) => p.id));
  const byProposal = new Map<string, CaseProposalCommentRow[]>();
  for (const cm of comments) {
    byProposal.set(cm.proposal_id, [...(byProposal.get(cm.proposal_id) ?? []), cm]);
  }

  const a = ACTION[c.action_type];
  const src = SOURCE[c.source_kind];
  const target = TRIAL_TARGETS[c.area] ?? null;

  return (
    <>
      <div className="pagehead">
        <h1>{c.trigger_label}</h1>
      </div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        <Link href="/cases">Cases</Link> · {c.area}
      </p>

      {/* What she does, and where it comes from. The source block is the
          load-bearing part: it is what makes a proposal implementable. */}
      <div className="panel" style={{ padding: 16, marginBottom: 14, fontSize: 13, lineHeight: 1.55 }}>
        <div style={{ marginBottom: 8 }}>
          <span className={`badge ${a.badge}`}>{a.label}</span>{" "}
          <span className={`badge ${src.badge}`}>{src.label}</span>
          {c.known_issues && <> <span className="badge amber">known issue</span></>}
        </div>
        {c.trigger_detail && (
          <p className="muted" style={{ marginTop: 0 }}><strong>Recognised by.</strong> {c.trigger_detail}</p>
        )}
        <p style={{ margin: "6px 0" }}><strong>What she does.</strong> {c.action_summary}</p>
        {c.process_steps.length > 0 && (
          <ol className="muted" style={{ margin: "4px 0 8px", paddingLeft: 20 }}>
            {c.process_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        )}
        <div style={{ marginTop: 10, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>Where the answer comes from</div>
          <p className="muted" style={{ margin: "3px 0" }}>
            <strong>{src.label}</strong>{c.source_detail ? ` — ${c.source_detail}` : ""}
          </p>
          <p style={{ margin: "6px 0 3px" }}><strong>When it is wrong.</strong> {src.fix}</p>
          {c.refresh_mechanism && <p className="muted" style={{ margin: "3px 0" }}><strong>How it updates.</strong> {c.refresh_mechanism}{c.refresh_cadence ? ` — ${c.refresh_cadence}` : ""}</p>}
          {c.refresh_owner && <p style={{ margin: "3px 0" }}><strong>Who can change it.</strong> {c.refresh_owner}</p>}
          {c.workflow && <p className="muted mono" style={{ fontSize: 11.5, margin: "6px 0 0" }}>{c.workflow}</p>}
        </div>
        {c.known_issues && (
          <p style={{ margin: "8px 0 0" }}><span className="badge amber">known issue</span> {c.known_issues}</p>
        )}
        <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
          Checked against the live workflow on {c.verified_at}.
          {c.measured != null && <> · {c.measured.toLocaleString()} {c.measured_label} in the last 30 days.</>}
        </p>
      </div>

      {/* Try it: the real sub-workflow, the real reply, kept. If a proposal is
          open the run is attached to it, so "what she said before" is on the
          record when the change lands. */}
      <div className="section" style={{ marginTop: 0 }}>
        <h2>Try it</h2>
        <div className="panel" style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}>
          {target ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Type what a member would type. This runs <span className="mono">{target.label}</span> —{" "}
                {target.note}
                {open && <> The run is attached to the open proposal.</>}
              </p>
              <TryItForm
                caseKey={c.key}
                targetWorkflowId={target.workflowId}
                proposalId={open?.id ?? null}
                placeholder={`e.g. a member asking: ${c.trigger_label.toLowerCase()}`}
              />
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{TRIAL_NOT_YET}</p>
          )}
          {trials.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
                Recent runs
              </div>
              {trials.map((t) => <Trial key={t.id} t={t} open={open} />)}
            </div>
          )}
        </div>
      </div>

      {open ? (
        <Proposal p={open} comments={byProposal.get(open.id) ?? []} approver={approver} me={user?.email ?? ""} c={c} />
      ) : (
        <div className="section" style={{ marginTop: 0 }}>
          <h2>Propose a change</h2>
          <div className="panel" style={{ padding: 16 }}>
            <ProposeForm fixedCase={{ key: c.key, label: c.trigger_label, area: c.area, source: c.source_kind }} />
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="section" style={{ marginTop: 22 }}>
          <h2>Earlier proposals</h2>
          {history.map((p) => (
            <Proposal key={p.id} p={p} comments={byProposal.get(p.id) ?? []} approver={approver} me={user?.email ?? ""} c={c} compact />
          ))}
        </div>
      )}
    </>
  );
}

function Proposal({
  p, comments, approver, me, c, compact,
}: {
  p: CaseProposalRow;
  comments: CaseProposalCommentRow[];
  approver: boolean;
  me: string;
  c: CaseLibraryRow;
  compact?: boolean;
}) {
  const st = STATUS[p.status];
  const isOpen = p.status === "open";
  const mine = p.proposed_by.toLowerCase() === me.toLowerCase();
  return (
    <div className="section" style={{ marginTop: compact ? 10 : 0 }}>
      {!compact && <h2>Open proposal {p.object_n > 0 && <span className="badge red" style={{ fontSize: 10.5, verticalAlign: "middle" }}>disputed</span>}</h2>}
      <div className="panel" style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}>
        <div style={{ marginBottom: 6 }}>
          <span className={`badge ${st.badge}`} style={{ fontSize: 10.5 }}>{st.label}</span>{" "}
          <strong>{KIND[p.kind].label}</strong>
          <span className="muted"> · {p.proposed_by} · {amsterdamDateTime(p.created_at)}</span>
        </div>
        <p style={{ margin: "4px 0" }}><strong>Should be.</strong> {p.should_be}</p>
        {p.rationale && <p className="muted" style={{ margin: "4px 0" }}><strong>Why.</strong> {p.rationale}</p>}
        {p.example_session_id && (
          <p style={{ margin: "4px 0", fontSize: 12 }}>
            Seen in <Link href={`/conversations/${p.example_session_id}`} className="mono">{p.example_session_id.slice(0, 8)}…</Link>
          </p>
        )}
        {p.decided_by && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            {st.label} by {p.decided_by} on {amsterdamDateTime(p.decided_at!)}{p.decision_note ? ` — ${p.decision_note}` : ""}
          </p>
        )}

        {(comments.length > 0 || isOpen) && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {p.agree_n} agree · {p.object_n} object · {p.comment_n} comment{p.comment_n === 1 ? "" : "s"}
            </div>
            {comments.map((cm) => (
              <div key={cm.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
                <span className={`badge ${cm.stance === "agree" ? "green" : cm.stance === "object" ? "red" : "grey"}`} style={{ fontSize: 10.5 }}>{cm.stance}</span>{" "}
                {cm.body}
                <div className="muted" style={{ fontSize: 11 }}>{cm.author_email} · {amsterdamDateTime(cm.created_at)}</div>
              </div>
            ))}
            {isOpen && <ReplyForm proposalId={p.id} caseKey={c.key} />}
          </div>
        )}

        {isOpen && (approver || mine) && (
          <form action={decide} style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input type="hidden" name="proposal_id" value={p.id} />
            <input type="hidden" name="case_key" value={c.key} />
            <input type="text" name="note" placeholder="Decision note (optional)" style={{ fontSize: 12, minWidth: 240 }} />
            {approver && <button type="submit" name="status" value="accepted">Accept</button>}
            {approver && <button type="submit" name="status" value="rejected" className="secondary">Reject</button>}
            {mine && <button type="submit" name="status" value="withdrawn" className="secondary">Withdraw</button>}
          </form>
        )}
        {p.status === "accepted" && approver && (
          <form action={decide} style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="hidden" name="proposal_id" value={p.id} />
            <input type="hidden" name="case_key" value={c.key} />
            <input type="text" name="note" placeholder="What shipped (optional)" style={{ fontSize: 12, minWidth: 240 }} />
            <button type="submit" name="status" value="implemented">Mark implemented</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Trial({ t, open }: { t: CaseTrialRow; open: CaseProposalRow | null }) {
  const onOpen = open && t.proposal_id === open.id;
  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
      <div><span className="muted">Member:</span> {t.message}</div>
      {t.reply ? (
        <div style={{ marginTop: 3, paddingLeft: 10, borderLeft: "2px solid var(--line)" }}>
          <span className="muted">Evelyn:</span> {t.reply}
        </div>
      ) : (
        <div className="error" style={{ marginTop: 3 }}>No reply — {t.error}</div>
      )}
      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
        {t.ran_by.split("@")[0]} · {amsterdamDateTime(t.ran_at)}
        {t.ms != null && <> · {(t.ms / 1000).toFixed(1)} s</>}
        {onOpen && <> · <span className="badge amber" style={{ fontSize: 10 }}>on the open proposal</span></>}
      </div>
    </div>
  );
}
