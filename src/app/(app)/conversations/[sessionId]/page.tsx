import Link from "next/link";
import {
  getAbandonedTicketDraft,
  getConversation,
  getFormSchemas,
  listConversationFeedback,
} from "@/lib/queries";
import { freshdeskUrl, normaliseDate } from "@/lib/format";
import { FeedbackPanel } from "./FeedbackPanel";
import { ProposeFaqForm } from "./ProposeFaqForm";
import { CreateTicketForm } from "./CreateTicketForm";
import { SubmitDraftButton } from "./SubmitDraftButton";

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

  const [conv, feedback, formSchemas, abandonedDraft] = await Promise.all([
    getConversation(sessionId),
    listConversationFeedback(sessionId),
    getFormSchemas(),
    getAbandonedTicketDraft(sessionId),
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

  // "No reply generated": the bot replies to every turn, so if the member sent
  // one or more messages after the bot's last reply (or the bot never replied
  // at all), the final turn went unanswered — an "<Empty Response>" in chat.
  const msgs = conv.messages || [];
  const lastAssistantIdx = msgs
    .map((m) => m.role)
    .lastIndexOf("assistant");
  const noReply = msgs
    .slice(lastAssistantIdx + 1)
    .some((m) => m.role === "user");

  return (
    <>
      <div className="pagehead">
        <h1>Conversation</h1>
        <Link href={backLink} className="btn secondary">
          ← Back to list
        </Link>
      </div>

      {noReply && (
        <div
          className="callout"
          style={{ borderLeftColor: "var(--red)", marginBottom: 18 }}
        >
          <strong>⚠ No reply generated.</strong> Evelyn received the member’s
          last message but never sent a reply — the member saw an “&lt;Empty
          Response&gt;” in chat. This usually means the turn errored before a
          response was produced (e.g. ticket creation). The inbound message is
          logged below; check the day’s workflow errors for the cause.
        </div>
      )}

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

      {abandonedDraft && (
        <SubmitDraftButton sessionId={sessionId} draft={abandonedDraft} />
      )}

      <div style={{ marginBottom: 18 }}>
        <CreateTicketForm
          sessionId={sessionId}
          memberEmail={s.customer_email}
          transcriptText={(conv.messages || [])
            .filter((m) => m.role === "user" || m.role === "assistant")
            .map(
              (m) =>
                `${m.role === "user" ? "Member" : "Evelyn"} [${m.at}]: ${m.content ?? ""}`,
            )
            .join("\n")}
          hasTicket={!!ticket}
          formSchemas={formSchemas}
        />
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
          {noReply && (
            <div className="msg assistant" style={{ opacity: 0.85 }}>
              <div className="meta">
                <span style={{ color: "var(--red)" }}>⚠ no reply</span>
              </div>
              <div className="content muted">
                Evelyn never replied to the message above.
              </div>
            </div>
          )}
          {msgs.length === 0 && <div className="muted">No messages.</div>}
        </div>
      </div>
    </>
  );
}
