"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parse(k: string) {
  const [y, m, d] = k.split("-").map(Number);
  return { y, m: m - 1, d };
}
// Integer day number — timezone-agnostic, safe for diffing calendar days.
const ordinal = (k: string) => {
  const { y, m, d } = parse(k);
  return Date.UTC(y, m, d) / 86_400_000;
};

/**
 * Single-popover calendar range picker. Click a start day, then an end day.
 * When `maxDays` is set the window is capped: once a start is chosen, days
 * more than maxDays-1 away are disabled. Future days beyond `max` (today)
 * are always disabled. Navigates to `basePath` with from/to (+ any
 * `preserved` query params kept intact).
 */
export function DateRangePicker({
  from,
  to,
  max,
  basePath,
  preserved = {},
  maxDays,
}: {
  from: string;
  to: string;
  max: string; // today (YYYY-MM-DD) — no future selection past this
  basePath: string; // route to navigate to, e.g. "/conversations"
  preserved?: Record<string, string>;
  maxDays?: number; // optional cap; omit for no cap
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(from);
  const [end, setEnd] = useState<string | null>(to);
  const [hover, setHover] = useState<string | null>(null);
  const initial = parse(to);
  const [view, setView] = useState({ y: initial.y, m: initial.m });

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (a: string, b: string) => {
    const params = new URLSearchParams();
    params.set("from", a);
    params.set("to", b);
    for (const [k, v] of Object.entries(preserved)) if (v) params.set(k, v);
    setOpen(false);
    router.push(`${basePath}?${params.toString()}`);
  };

  const pick = (k: string) => {
    // No start yet, or a complete range exists → begin a fresh selection.
    if (!start || (start && end)) {
      setStart(k);
      setEnd(null);
      return;
    }
    let a = start;
    let b = k;
    if (ordinal(b) < ordinal(a)) [a, b] = [b, a];
    setStart(a);
    setEnd(b);
    apply(a, b);
  };

  const selecting = start !== null && end === null; // choosing the end
  const dayDisabled = (k: string) => {
    if (ordinal(k) > ordinal(max)) return true; // no future
    if (
      selecting &&
      maxDays !== undefined &&
      Math.abs(ordinal(k) - ordinal(start!)) > maxDays - 1
    )
      return true; // beyond the cap
    return false;
  };

  const inRange = (k: string) => {
    let a: string, b: string;
    if (start && end) {
      a = start;
      b = end;
    } else if (start && hover && !dayDisabled(hover)) {
      [a, b] = ordinal(hover) < ordinal(start) ? [hover, start] : [start, hover];
    } else return false;
    const o = ordinal(k);
    return o >= ordinal(a) && o <= ordinal(b);
  };

  // Build the visible month grid (Monday-first).
  const daysInMonth = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(view.y, view.m, 1)).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => toKey(view.y, view.m, i + 1)),
  ];

  const maxOrd = ordinal(max);
  const canNext = Date.UTC(view.y, view.m, 1) / 86_400_000 < maxOrd; // don't page past today's month
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(view.y, view.m + delta, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };

  const label = from === to ? from : `${from} → ${to}`;

  return (
    <div className="rangepick" ref={wrapRef}>
      <button
        type="button"
        className="secondary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        📅 {label}
      </button>

      {open && (
        <div className="cal panel" role="dialog" aria-label="Select date range">
          <div className="cal-head">
            <button
              type="button"
              className="secondary cal-nav"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="cal-title">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              className="secondary cal-nav"
              onClick={() => shiftMonth(1)}
              disabled={!canNext}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="cal-grid cal-dow">
            {WEEKDAYS.map((w) => (
              <span key={w} className="cal-dow-cell">
                {w}
              </span>
            ))}
          </div>

          <div className="cal-grid">
            {cells.map((k, i) =>
              k === null ? (
                <span key={`b${i}`} />
              ) : (
                <button
                  key={k}
                  type="button"
                  disabled={dayDisabled(k)}
                  onMouseEnter={() => setHover(k)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => pick(k)}
                  className={
                    "cal-day" +
                    (k === start || k === end ? " sel" : "") +
                    (inRange(k) ? " inrange" : "")
                  }
                >
                  {parse(k).d}
                </button>
              ),
            )}
          </div>

          <p className="cal-hint muted">
            {selecting ? "Pick the end day" : "Pick a start day"}
            {maxDays !== undefined ? ` · up to ${maxDays} days` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
