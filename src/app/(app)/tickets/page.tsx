import Link from "next/link";
import { listTickets, listNonMemberTickets } from "@/lib/queries";
import { amsterdamDateTime, freshdeskUrl } from "@/lib/format";
import type { FreshdeskSearchTicket } from "@/lib/freshdesk";

export const dynamic = "force-dynamic";

const FD_STATUS: Record<number, { label: string; tone: string }> = {
  2: { label: "Open", tone: "blue" },
  3: { label: "Pending", tone: "amber" },
  4: { label: "Resolved", tone: "green" },
  5: { label: "Closed", tone: "grey" },
};
const FD_PRIORITY: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
  4: "Urgent",
};

function NonMemberTable({ tickets }: { tickets: FreshdeskSearchTicket[] }) {
  return (
    <div className="panel table-scroll">
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Subject</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Freshdesk</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const st = FD_STATUS[t.status] ?? { label: `#${t.status}`, tone: "grey" };
            return (
              <tr key={t.id}>
                <td className="mono">{amsterdamDateTime(t.created_at)}</td>
                <td style={{ maxWidth: 380 }}>{t.subject}</td>
                <td>
                  <span className={`badge ${st.tone}`}>{st.label}</span>
                </td>
                <td className="muted">{FD_PRIORITY[t.priority] ?? t.priority}</td>
                <td>
                  <a
                    href={freshdeskUrl(String(t.id)) ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    #{t.id}
                  </a>
                </td>
              </tr>
            );
          })}
          {tickets.length === 0 && (
            <tr>
              <td colSpan={5} className="muted" style={{ padding: 18 }}>
                No non-member tickets found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const unsyncedOnly = filter === "unsynced";
  const nonMember = filter === "nonmember";

  const all = await listTickets();
  const unsyncedCount = all.filter((t) => !t.external_ticket_id).length;
  const rows = unsyncedOnly ? all.filter((t) => !t.external_ticket_id) : all;

  let nonMemberTickets: FreshdeskSearchTicket[] = [];
  let nonMemberError: string | null = null;
  if (nonMember) {
    try {
      nonMemberTickets = await listNonMemberTickets();
    } catch (e) {
      nonMemberError = e instanceof Error ? e.message : "Failed to load.";
    }
  }

  return (
    <>
      <div className="pagehead">
        <h1>Tickets</h1>
        <div className="controls">
          <Link
            href="/tickets"
            className={`btn secondary${!unsyncedOnly && !nonMember ? " active" : ""}`}
          >
            All ({all.length})
          </Link>
          <Link
            href="/tickets?filter=unsynced"
            className={`btn secondary${unsyncedOnly ? " active" : ""}`}
          >
            Unsynced ({unsyncedCount})
          </Link>
          <Link
            href="/tickets?filter=nonmember"
            className={`btn secondary${nonMember ? " active" : ""}`}
          >
            Non-member
          </Link>
        </div>
      </div>

      {nonMember ? (
        <>
          <p className="muted">
            Enquiries from people who aren't members — the bot files these
            straight into Freshdesk (tagged <span className="mono">non-member</span>),
            so they're listed live from Freshdesk
            {nonMemberTickets.length > 0 && <> · {nonMemberTickets.length} found</>}.
          </p>
          {nonMemberError ? (
            <div className="callout" style={{ borderLeftColor: "var(--red)" }}>
              Couldn't load from Freshdesk: {nonMemberError}
            </div>
          ) : (
            <NonMemberTable tickets={nonMemberTickets} />
          )}
        </>
      ) : (
        <>
          {unsyncedCount > 0 && !unsyncedOnly && (
            <p>
              <span className="badge red">{unsyncedCount} unsynced</span>{" "}
              <span className="muted">
                — these never reached Freshdesk (`external_ticket_id IS NULL`).
              </span>
            </p>
          )}

          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Member</th>
                  <th>Freshdesk</th>
                  <th>Chat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const url = freshdeskUrl(t.external_ticket_id);
                  return (
                    <tr key={t.id}>
                      <td className="mono">{amsterdamDateTime(t.created_at)}</td>
                      <td style={{ maxWidth: 280 }}>{t.subject ?? "—"}</td>
                      <td className="muted">{t.category ?? "—"}</td>
                      <td className="muted">{t.priority ?? "—"}</td>
                      <td className="muted">{t.status ?? "—"}</td>
                      <td>
                        {t.customer?.display_name ?? (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            #{t.external_ticket_id}
                          </a>
                        ) : (
                          <span className="badge red">NOT synced</span>
                        )}
                      </td>
                      <td>
                        {t.session_id ? (
                          <Link href={`/conversations/${t.session_id}`}>
                            view
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted" style={{ padding: 18 }}>
                      {unsyncedOnly
                        ? "No unsynced tickets. 🎉"
                        : "No tickets found."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
