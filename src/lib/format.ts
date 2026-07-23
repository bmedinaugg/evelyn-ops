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
