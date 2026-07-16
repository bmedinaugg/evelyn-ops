import Link from "next/link";
import { listFaqProposals } from "@/lib/queries";
import type { FaqProposal, FaqStatus } from "@/lib/types";
import { changeFaqStatus } from "./actions";

export const dynamic = "force-dynamic";

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
];

const STATUS_TONE: Record<FaqStatus, string> = {
  draft: "grey",
  approved: "green",
  published: "blue",
  rejected: "red",
};

function whenLocal(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", {
        timeZone: "Europe/Amsterdam",
        dateStyle: "short",
        timeStyle: "short",
      });
}

function StatusButton({
  id,
  status,
  label,
  secondary,
}: {
  id: string;
  status: string;
  label: string;
  secondary?: boolean;
}) {
  return (
    <form action={changeFaqStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button type="submit" className={secondary ? "secondary" : undefined}>
        {label}
      </button>
    </form>
  );
}

function RowActions({ p }: { p: FaqProposal }) {
  switch (p.status) {
    case "draft":
      return (
        <div className="faq-actions">
          <StatusButton id={p.id} status="approved" label="Approve" />
          <StatusButton id={p.id} status="rejected" label="Reject" secondary />
        </div>
      );
    case "approved":
      return (
        <div className="faq-actions">
          <span className="muted">awaiting n8n publish</span>
          <StatusButton id={p.id} status="draft" label="Reopen" secondary />
          <StatusButton id={p.id} status="rejected" label="Reject" secondary />
        </div>
      );
    case "rejected":
      return (
        <div className="faq-actions">
          <StatusButton id={p.id} status="draft" label="Reopen" secondary />
        </div>
      );
    case "published":
      return (
        <span className="muted">
          {p.published_at ? `published ${whenLocal(p.published_at)}` : "published"}
        </span>
      );
  }
}

export default async function FaqProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const proposals = await listFaqProposals(status);

  return (
    <>
      <div className="pagehead">
        <h1>FAQ proposals</h1>
        <div className="controls">
          {FILTERS.map((f) => {
            const active = (status || "") === f.value;
            const href = f.value
              ? `/faq-proposals?status=${f.value}`
              : "/faq-proposals";
            return (
              <Link
                key={f.value}
                href={href}
                className={`btn secondary${active ? " active" : ""}`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
      </div>

      <p className="muted">
        Captured knowledge gaps. Approved items are picked up later by an n8n
        sync to publish into the live FAQ store (out of scope here).
      </p>

      <div className="panel table-scroll">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Question</th>
              <th>Suggested answer</th>
              <th>Status</th>
              <th>Author / reviewer</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((p) => (
              <tr key={p.id}>
                <td className="mono">{whenLocal(p.created_at)}</td>
                <td style={{ maxWidth: 260 }}>{p.question}</td>
                <td className="truncate muted">{p.suggested_answer ?? "—"}</td>
                <td>
                  <span className={`badge ${STATUS_TONE[p.status]}`}>
                    {p.status}
                  </span>
                </td>
                <td className="muted">
                  {p.author_email}
                  {p.reviewer_email ? (
                    <>
                      <br />
                      <span>→ {p.reviewer_email}</span>
                    </>
                  ) : null}
                </td>
                <td>
                  {p.source_session_id ? (
                    <Link href={`/conversations/${p.source_session_id}`}>
                      conversation
                    </Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <RowActions p={p} />
                </td>
              </tr>
            ))}
            {proposals.length === 0 && (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 18 }}>
                  No FAQ proposals{status ? ` with status “${status}”` : ""}{" "}
                  yet. Create one from a conversation’s detail page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
