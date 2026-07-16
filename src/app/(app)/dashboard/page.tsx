import Link from "next/link";
import { getDigestStats, getDigestDetails } from "@/lib/queries";
import { normaliseDate, freshdeskUrl } from "@/lib/format";
import type { Outcome } from "@/lib/types";

export const dynamic = "force-dynamic";

function Tile({
  k,
  v,
  tone,
}: {
  k: string;
  v: number | string;
  tone?: "alert" | "warn";
}) {
  return (
    <div className={`tile${tone ? " " + tone : ""}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: rawDate } = await searchParams;
  const date = normaliseDate(rawDate);

  const [stats, details] = await Promise.all([
    getDigestStats(date),
    getDigestDetails(date),
  ]);

  const unsynced = stats.tickets_total - stats.tickets_synced;
  const counts = details.sessions.reduce<Record<Outcome, number>>(
    (acc, s) => {
      acc[s.outcome] = (acc[s.outcome] || 0) + 1;
      return acc;
    },
    {
      ticket_created: 0,
      ticket_not_synced: 0,
      abandoned_mid_ticket: 0,
      auth_dropoff: 0,
      chat_only: 0,
    },
  );

  const convLink = (extra: string) =>
    `/conversations?date=${date}&${extra}`;

  return (
    <>
      <div className="pagehead">
        <h1>Dashboard</h1>
        <form className="controls" method="get">
          <input type="date" name="date" defaultValue={date} />
          <button type="submit" className="secondary">
            Go
          </button>
        </form>
      </div>

      <div className="grid tiles">
        <Tile k="Active sessions" v={stats.active_sessions} />
        <Tile k="Messages" v={stats.messages_total} />
        <Tile k="Logins" v={stats.logins} />
        <Tile k="OTP sends" v={stats.otp_sends} />
        <Tile k="Tickets" v={stats.tickets_total} />
        <Tile k="Tickets synced" v={stats.tickets_synced} />
      </div>

      <div className="section">
        <h2>Needs attention</h2>
        <div className="grid tiles">
          <Tile
            k="Unsynced tickets"
            v={unsynced}
            tone={unsynced > 0 ? "alert" : undefined}
          />
          <Tile
            k="Workflow errors"
            v={details.errors.length}
            tone={details.errors.length > 0 ? "alert" : undefined}
          />
          <Tile
            k="Auth drop-offs"
            v={counts.auth_dropoff}
            tone={counts.auth_dropoff > 0 ? "warn" : undefined}
          />
          <Tile
            k="Abandoned mid-ticket"
            v={counts.abandoned_mid_ticket}
            tone={counts.abandoned_mid_ticket > 0 ? "warn" : undefined}
          />
          <Tile k="Chat only" v={counts.chat_only} />
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Jump to{" "}
          <Link href={convLink("outcome=ticket_not_synced")}>
            unsynced tickets
          </Link>
          {" · "}
          <Link href={convLink("outcome=auth_dropoff")}>auth drop-offs</Link>
          {" · "}
          <Link href={convLink("outcome=abandoned_mid_ticket")}>
            abandoned tickets
          </Link>
        </p>
      </div>

      <div className="section">
        <h2>Workflow errors ({details.errors.length})</h2>
        {details.errors.length === 0 ? (
          <div className="callout">No workflow errors on {date}. 🎉</div>
        ) : (
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Workflow</th>
                  <th>Node</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {details.errors.map((e, i) => (
                  <tr key={i}>
                    <td className="mono">{e.time}</td>
                    <td>{e.workflow ?? "—"}</td>
                    <td className="muted">{e.node ?? "—"}</td>
                    <td>{e.message ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {stats.tickets_list.length > 0 && (
        <div className="section">
          <h2>Tickets on {date}</h2>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Freshdesk</th>
                  <th>Subject</th>
                </tr>
              </thead>
              <tbody>
                {stats.tickets_list.map((t, i) => {
                  const url = freshdeskUrl(t.fd_id);
                  return (
                    <tr key={i}>
                      <td>
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            #{t.fd_id}
                          </a>
                        ) : (
                          <span className="badge red">NOT synced</span>
                        )}
                      </td>
                      <td>{t.subject ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
