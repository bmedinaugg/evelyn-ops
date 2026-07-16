import Link from "next/link";
import { getConversation, listConversationFeedback } from "@/lib/queries";
import { freshdeskUrl, normaliseDate } from "@/lib/format";
import { FeedbackPanel } from "./FeedbackPanel";
import { ProposeFaqForm } from "./ProposeFaqForm";

export const dynamic = "force-dynamic";

function MemberField({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="k">{k}</div>
      <div className="v">{v ?? "—"}</div>
    </div>
  );
}

export default async function ConversationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { sessionId } = await params;
  const { date: rawDate } = await searchParams;
  const date = normaliseDate(rawDate);

  const [conv, feedback] = await Promise.all([
    getConversation(sessionId),
    listConversationFeedback(sessionId),
  ]);

  const backLink = `/conversations?date=${date}`;

  if (!conv.found || !conv.session) {
    return (
      <>
        <div className="pagehead">
          <h1>Conversation</h1>
          <Link href={backLink} className="btn secondary">
            ← Back
          </Link>
        </div>
        <div className="callout">
          No conversation found for session{" "}
          <span className="mono">{sessionId}</span>.
        </div>
      </>
    );
  }

  const s = conv.session;
  const ticket = conv.ticket;
  const ticketUrl = freshdeskUrl(ticket?.fd_id);

  return (
    <>
      <div className="pagehead">
        <h1>Conversation</h1>
        <Link href={backLink} className="btn secondary">
          ← Back to list
        </Link>
      </div>

      <div className="panel" style={{ padding: 16, marginBottom: 18 }}>
        <div className="member-box">
          <MemberField k="Member" v={s.customer} />
          <MemberField k="Email" v={s.customer_email} />
          <MemberField k="State" v={s.state} />
          <MemberField k="Messages" v={conv.message_count} />
          <MemberField
            k="Last message"
            v={
              s.last_message_at
                ? new Date(s.last_message_at).toLocaleString("en-GB", {
                    timeZone: "Europe/Amsterdam",
                  })
                : "—"
            }
          />
          <MemberField
            k="Session"
            v={<span className="mono">{s.session_id}</span>}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          {ticket ? (
            ticketUrl ? (
              <span>
                Linked ticket:{" "}
                <a href={ticketUrl} target="_blank" rel="noreferrer">
                  #{ticket.fd_id}
                </a>{" "}
                {ticket.subject ? `— ${ticket.subject}` : ""}{" "}
                {ticket.category ? (
                  <span className="muted">({ticket.category})</span>
                ) : null}
              </span>
            ) : (
              <span>
                <span className="badge red">TICKET NOT SYNCED</span>{" "}
                {ticket.subject ? `— ${ticket.subject}` : ""} — never reached
                Freshdesk.
              </span>
            )
          ) : (
            <span className="muted">No ticket for this conversation.</span>
          )}
        </div>
      </div>

      <FeedbackPanel sessionId={sessionId} items={feedback} />

      <div style={{ height: 18 }} />
      <ProposeFaqForm sessionId={sessionId} />

      <div className="section" style={{ marginTop: 26 }}>
        <h2>Transcript</h2>
        <div className="transcript">
          {(conv.messages || []).map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              <div className="meta">
                <span>{m.role}</span>
                <span>{m.at}</span>
                {m.state_at_turn && (
                  <span className="muted">· {m.state_at_turn}</span>
                )}
              </div>
              <div className="content">{m.content}</div>
            </div>
          ))}
          {(conv.messages || []).length === 0 && (
            <div className="muted">No messages.</div>
          )}
        </div>
      </div>
    </>
  );
}
