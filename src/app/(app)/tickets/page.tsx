import Link from "next/link";
import { listTickets } from "@/lib/queries";
import { amsterdamDateTime, freshdeskUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const unsyncedOnly = filter === "unsynced";

  const all = await listTickets();
  const unsyncedCount = all.filter((t) => !t.external_ticket_id).length;
  const rows = unsyncedOnly
    ? all.filter((t) => !t.external_ticket_id)
    : all;

  return (
    <>
      <div className="pagehead">
        <h1>Tickets</h1>
        <div className="controls">
          <Link
            href="/tickets"
            className={`btn secondary${!unsyncedOnly ? " active" : ""}`}
          >
            All ({all.length})
          </Link>
          <Link
            href="/tickets?filter=unsynced"
            className={`btn secondary${unsyncedOnly ? " active" : ""}`}
          >
            Unsynced ({unsyncedCount})
          </Link>
        </div>
      </div>

      {unsyncedCount > 0 && (
        <p>
          <span className="badge red">{unsyncedCount} unsynced</span>{" "}
          <span className="muted">
            — these never reached Freshdesk (`external_ticket_id IS NULL`).
            Surface loudly.
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
                  <td>{t.customer?.display_name ?? <span className="muted">—</span>}</td>
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
                      <Link href={`/conversations/${t.session_id}`}>view</Link>
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
  );
}
