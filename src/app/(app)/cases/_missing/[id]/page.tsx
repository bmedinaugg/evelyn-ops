import Link from "next/link";
import { notFound } from "next/navigation";
import { listCaseProposals, listCaseProposalComments, isCaseApprover } from "@/lib/queries";
import { getStaffUser } from "@/lib/auth";
import { amsterdamDateTime } from "@/lib/format";
import { KIND, STATUS } from "../../shared";
import { ReplyForm } from "../../ReplyForm";
import { decide } from "../../actions";

export const dynamic = "force-dynamic";

// A proposal for a case the library does not have. Same shape as a case page's
// proposal block, minus the case — there is nothing to anchor it to yet.
export default async function MissingCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [proposals, approver, user] = await Promise.all([listCaseProposals(), isCaseApprover(), getStaffUser()]);
  const p = proposals.find((x) => x.id === id && !x.case_key) ?? null;
  if (!p) notFound();
  const comments = await listCaseProposalComments([p.id]);
  const st = STATUS[p.status];
  const isOpen = p.status === "open";
  const mine = p.proposed_by.toLowerCase() === (user?.email ?? "").toLowerCase();

  return (
    <>
      <div className="pagehead"><h1>{p.title}</h1></div>
      <p className="muted" style={{ marginTop: -6, marginBottom: 12 }}>
        <Link href="/cases">Cases</Link> · {KIND.missing.label}
      </p>
      <div className="panel" style={{ padding: 16, fontSize: 13, lineHeight: 1.55 }}>
        <div style={{ marginBottom: 6 }}>
          <span className={`badge ${st.badge}`} style={{ fontSize: 10.5 }}>{st.label}</span>
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
        <div style={{ marginTop: 12 }}>
          {comments.map((cm) => (
            <div key={cm.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
              <span className={`badge ${cm.stance === "agree" ? "green" : cm.stance === "object" ? "red" : "grey"}`} style={{ fontSize: 10.5 }}>{cm.stance}</span>{" "}
              {cm.body}
              <div className="muted" style={{ fontSize: 11 }}>{cm.author_email} · {amsterdamDateTime(cm.created_at)}</div>
            </div>
          ))}
          {isOpen && <ReplyForm proposalId={p.id} caseKey={null} />}
        </div>
        {isOpen && (approver || mine) && (
          <form action={decide} style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input type="hidden" name="proposal_id" value={p.id} />
            <input type="text" name="note" placeholder="Decision note (optional)" style={{ fontSize: 12, minWidth: 240 }} />
            {approver && <button type="submit" name="status" value="accepted">Accept</button>}
            {approver && <button type="submit" name="status" value="rejected" className="secondary">Reject</button>}
            {mine && <button type="submit" name="status" value="withdrawn" className="secondary">Withdraw</button>}
          </form>
        )}
        {p.status === "accepted" && approver && (
          <form action={decide} style={{ marginTop: 10, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="hidden" name="proposal_id" value={p.id} />
            <input type="text" name="note" placeholder="What shipped (optional)" style={{ fontSize: 12, minWidth: 240 }} />
            <button type="submit" name="status" value="implemented">Mark implemented</button>
          </form>
        )}
      </div>
    </>
  );
}
