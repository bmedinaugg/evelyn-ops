import type { Outcome } from "@/lib/types";

/** Today's date (YYYY-MM-DD) in the business timezone, Europe/Amsterdam. */
export function amsterdamToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Validate/normalise a ?date=YYYY-MM-DD param, falling back to today. */
export function normaliseDate(input: string | undefined): string {
  if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return amsterdamToday();
}

/** Full date-time in Europe/Amsterdam for a UTC timestamp string. */
export function amsterdamDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleString("en-GB", {
        timeZone: "Europe/Amsterdam",
        dateStyle: "short",
        timeStyle: "short",
      });
}

/** UTC instant of local midnight for `dateStr` (YYYY-MM-DD) in tz. DST-safe. */
export function zonedMidnightUtc(
  dateStr: string,
  tz = "Europe/Amsterdam",
): Date {
  const naive = Date.parse(`${dateStr}T00:00:00Z`);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = dtf.formatToParts(new Date(naive)).reduce<Record<string, string>>(
    (a, x) => {
      a[x.type] = x.value;
      return a;
    },
    {},
  );
  const asUtc = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second,
  );
  const offset = asUtc - naive; // ms the tz is ahead of UTC at that instant
  return new Date(naive - offset);
}

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive count of calendar days between two YYYY-MM-DD strings. */
export function rangeDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Longest window the date-range pages (Dashboard, Conversations, Bot helped)
 * will fetch, in days. One full calendar month — Member Care asked for
 * "the whole month of September" and a 31-day cap covers every month.
 *
 * This is the real ceiling on the per-day RPC fan-out in queries.ts, which is
 * deliberately unthrottled — see the measurements there. September costs ~3s
 * and ~4MB cold, nothing on a second look, and no single statement comes near
 * PostgREST's 8s timeout. Raising it further is a data-volume question rather
 * than a timeout one: a month is already ~8,600 sessions, which is why the
 * tables that render them page.
 */
export const MAX_RANGE_DAYS = 31;

export type DateWindow = {
  from: string;
  to: string;
  days: number;
  /** The requested window was longer than maxDays and got trimmed. */
  clamped: boolean;
  today: string;
};

/**
 * Resolve the [from, to] inclusive Amsterdam-day window a range page renders.
 *
 * Back-compat: older links carry `date` (the window end) plus `range`, which
 * used to be "1" or "7"; any positive integer is accepted now, so `range=30`
 * works for a link written by hand.
 */
export function resolveWindow(
  sp: { from?: string; to?: string; date?: string; range?: string },
  maxDays: number = MAX_RANGE_DAYS,
): DateWindow {
  let to = normaliseDate(sp.to || sp.date);
  const span = Number(sp.range);
  let from = sp.from
    ? normaliseDate(sp.from)
    : addDays(to, -((Number.isInteger(span) && span >= 1 ? span : 1) - 1));
  if (from > to) [from, to] = [to, from]; // ISO strings sort chronologically
  const clamped = rangeDays(from, to) > maxDays;
  if (clamped) from = addDays(to, -(maxDays - 1));
  return { from, to, days: rangeDays(from, to), clamped, today: amsterdamToday() };
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export type RangePreset = { label: string; from: string; to: string };

/**
 * The one-click windows offered by the date picker, built from `today`.
 *
 * The named months are the point: Member Care asks for "the whole month of
 * September" far more often than for an arbitrary span, and picking 30 days
 * one click at a time was what made the old 7-day cap intolerable. "This
 * month" ends today rather than running into the future.
 *
 * A preset longer than `maxDays` is dropped rather than quietly shortened —
 * a button labelled "Sep" that returns 7 days is worse than no button.
 */
export function rangePresets(
  today: string,
  maxDays: number = MAX_RANGE_DAYS,
): RangePreset[] {
  const [y, m] = today.split("-").map(Number);
  const key = (yy: number, mm: number, dd: number) =>
    `${yy}-${String(mm + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  // Month index is 0-based from here on; `m` arrives 1-based.
  const thisM = { y, m: m - 1 };
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const prevM = { y: prev.getUTCFullYear(), m: prev.getUTCMonth() };
  const lastDay = (p: { y: number; m: number }) =>
    new Date(Date.UTC(p.y, p.m + 1, 0)).getUTCDate();

  return [
    { label: "Today", from: today, to: today },
    { label: "7 days", from: addDays(today, -6), to: today },
    { label: "30 days", from: addDays(today, -29), to: today },
    { label: "This month", from: key(thisM.y, thisM.m, 1), to: today },
    {
      label:
        prevM.y === y ? MONTH_ABBR[prevM.m] : `${MONTH_ABBR[prevM.m]} ${prevM.y}`,
      from: key(prevM.y, prevM.m, 1),
      to: key(prevM.y, prevM.m, lastDay(prevM)),
    },
  ].filter((p) => rangeDays(p.from, p.to) <= maxDays);
}

/** [start, end) UTC ISO bounds covering the Amsterdam days from..to inclusive. */
export function amsterdamRangeIso(from: string, to: string) {
  return {
    startISO: zonedMidnightUtc(from).toISOString(),
    endISO: zonedMidnightUtc(addDays(to, 1)).toISOString(),
  };
}

/** Short "how long ago" string (e.g. "5m ago", "3h ago", "2d ago"). */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function freshdeskUrl(fdId: string | null | undefined): string | null {
  if (!fdId) return null;
  return `https://urbangymgroup.freshdesk.com/a/tickets/${fdId}`;
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  ticket_created: "Ticket created",
  ticket_not_synced: "Ticket NOT synced",
  abandoned_mid_ticket: "Abandoned mid-ticket",
  auth_dropoff: "Auth drop-off",
  chat_only: "Chat only",
};

/** CSS class suffix for outcome colouring (see globals.css). */
export const OUTCOME_TONE: Record<Outcome, "red" | "amber" | "green" | "grey"> = {
  ticket_created: "green",
  ticket_not_synced: "red",
  abandoned_mid_ticket: "amber",
  auth_dropoff: "amber",
  chat_only: "grey",
};
