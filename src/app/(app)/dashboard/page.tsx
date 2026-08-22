import Link from "next/link";
import { getDigestStats, getDigestDetails } from "@/lib/queries";
import { normaliseDate, addDays, freshdeskUrl } from "@/lib/format";
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

const RANGES = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
];

const ZERO_OUTCOMES: Record<Outcome, number> = {
  ticket_created: 0,
  ticket_not_synced: 0,
  abandoned_mid_ticket: 0,
  auth_dropoff: 0,
  chat_only: 0,
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; range?: string }>;
}) {
  const { date: rawDate, range: rawRange } = await searchParams;
  const date = normaliseDate(rawDate); // window END (inclusive)
  const range = rawRange === "7" ? "7" : "1";
  const days = range === "7" ? 7 : 1;

  // Dates in the window, oldest → newest (endDate is `date`).
  const dates = Array.from({ length: days }, (_, i) => addDays(date, -(days - 1 - i)));

  const perDay = await Promise.all(
    dates.map(async (d) => {
      const [stats, details] = await Promise.all([
        getDigestStats(d),
        getDigestDetails(d),
      ]);
      return { d, stats, details };
    }),
  );

  // Aggregate headline stats across the window.
  const agg = perDay.reduce(
    (a, { stats }) => {
      a.active_sessions += stats.active_sessions;
      a.messages_total += stats.messages_total;
      a.logins += stats.logins;
      a.otp_sends += stats.otp_sends;
      a.tickets_total += stats.tickets_total;
      a.tickets_synced += stats.tickets_synced;
      return a;
    },
    {
      active_sessions: 0,
      messages_total: 0,
      logins: 0,
      otp_sends: 0,
      tickets_total: 0,
      tickets_synced: 0,
    },
  );

  const counts = perDay.reduce<Record<Outcome, number>>((acc, { details }) => {
    for (const s of details.sessions) acc[s.outcome] = (acc[s.outcome] || 0) + 1;
    return acc;
  }, { ...ZERO_OUTCOMES });

  const errorsAll = perDay.flatMap(({ d, details }) =>
    details.errors.map((e) => ({ ...e, day: d })),
  );
  const unsynced = agg.tickets_total - agg.tickets_synced;

  const single = perDay[perDay.length - 1]; // the end date
  const windowLabel =
    days === 1 ? date : `${dates[0]} → ${dates[dates.length - 1]} (7 days)`;
  const rangeHref = (r: string) => `/dashboard?date=${date}&range=${r}`;
  const convLink = (extra: string) => `/conversations?date=${date}&${extra}`;

  return (
    <>
      <div className="pagehead">
        <h1>Dashboard</h1>
        <div className="controls">
          {RANGES.map((r) => (
            <Link
              key={r.value}
              href={rangeHref(r.value)}
              className={`btn secondary${range === r.value ? " active" : ""}`}
            >
              {r.label}
            </Link>
          ))}
          <form className="controls" method="get" style={{ margin: 0 }}>
            <input type="date" name="date" defaultValue={date} />
            <input type="hidden" name="range" value={range} />
            <button type="submit" className="secondary">
              Go
            </button>
          </form>
        </div>
      </div>

      <p className="muted" style={{ marginTop: -4 }}>
        {days === 1 ? (
          <>Showing {date}.</>
        ) : (
          <>Totals across {windowLabel}, ending {date}.</>
        )}
      </p>

      <div className="grid tiles">
        <Tile k="Active sessions" v={agg.active_sessions} />
        <Tile k="Messages" v={agg.messages_total} />
        <Tile k="Logins" v={agg.logins} />
        <Tile k="OTP sends" v={agg.otp_sends} />
        <Tile k="Tickets" v={agg.tickets_total} />
        <Tile k="Tickets synced" v={agg.tickets_synced} />
      </div>

      <div className="section">
        <h2>Needs attention{days > 1 ? " (7-day total)" : ""}</h2>
        <div className="grid tiles">
          <Tile
            k="Unsynced tickets"
            v={unsynced}
            tone={unsynced > 0 ? "alert" : undefined}
          />
          <Tile
            k="Workflow errors"
            v={errorsAll.length}
            tone={errorsAll.length > 0 ? "alert" : undefined}
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
        {days === 1 && (
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
        )}
      </div>

      {days > 1 && (
        <div className="section">
          <h2>Per-day breakdown</h2>
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sessions</th>
                  <th>Messages</th>
                  <th>Tickets</th>
                  <th>Synced</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {perDay.map(({ d, stats, details }) => {
                  const uns = stats.tickets_total - stats.tickets_synced;
                  return (
                    <tr key={d}>
                      <td className="mono">
                        <Link href={`/dashboard?date=${d}&range=1`}>{d}</Link>
                      </td>
                      <td>{stats.active_sessions}</td>
                      <td>{stats.messages_total}</td>
                      <td>{stats.tickets_total}</td>
                      <td>
                        {uns > 0 ? (
                          <span className="badge red">{stats.tickets_synced}</span>
                        ) : (
                          stats.tickets_synced
                        )}
                      </td>
                      <td>
                        {details.errors.length > 0 ? (
                          <span className="badge red">{details.errors.length}</span>
                        ) : (
                          details.errors.length
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="section">
        <h2>Workflow errors ({errorsAll.length})</h2>
        {errorsAll.length === 0 ? (
          <div className="callout">
            No workflow errors {days === 1 ? `on ${date}` : `over ${windowLabel}`}. 🎉
          </div>
        ) : (
          <div className="panel table-scroll">
            <table>
              <thead>
                <tr>
                  {days > 1 && <th>Date</th>}
                  <th>Time</th>
                  <th>Workflow</th>
                  <th>Node</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {errorsAll.map((e, i) => (
                  <tr key={i}>
                    {days > 1 && <td className="mono">{e.day}</td>}
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

      {days === 1 && single.stats.tickets_list.length > 0 && (
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
                {single.stats.tickets_list.map((t, i) => {
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
