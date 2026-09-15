"use client";

import { useRouter } from "next/navigation";
import { SOURCE, WIRING, type Sort } from "./shared";

// Just the controls. The list itself is rendered on the server, which is the
// whole point: shipping 229 article bodies and 229 note forms to the browser
// is what made the first version of this page never finish painting. Filters
// travel in the URL, the same way /conversations does, so a view is also a
// link someone can paste to a colleague.
export type Values = {
  q?: string;
  source?: string;
  wiring?: string;
  topic?: string;
  tag?: string;
  sort?: string;
  dupes?: string;
  from?: string;
  to?: string;
};

// Presets, because "last 7 days" is the question people actually arrive with
// and typing two dates to ask it is a tax.
function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = () => new Date().toISOString().slice(0, 10);

export function KnowsFilters({
  values,
  topics,
  tags,
  dupeCount,
  painted,
  matching,
  total,
  builtFrom,
  builtTo,
  windowMessages,
  custom,
}: {
  values: Values;
  topics: string[];
  tags: [string, number][];
  dupeCount: number;
  painted: number;
  matching: number;
  total: number;
  builtFrom: string | null;
  builtTo: string | null;
  windowMessages: number | null;
  custom: boolean;
}) {
  const router = useRouter();

  const apply = (patch: Values) => {
    const merged: Record<string, string | undefined> = { ...values, ...patch };
    const p = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    // `n` (how many rows are painted) is deliberately dropped: narrowing the
    // list and still being on page three of the old one is disorienting.
    const qs = p.toString();
    router.push(qs ? `/knows?${qs}` : "/knows");
  };

  const filtered = matching !== total;

  const preset = (days: number) => apply({ from: daysAgo(days), to: TODAY() });

  return (
    <>
      {/* The window every number on this page is counted over. It is a control
          rather than a caption because the counts used to be frozen at whatever
          the offline builder last saw, and there was no way to tell from the
          page that they had gone stale. */}
      <div
        className="controls"
        style={{ marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}
      >
        <span className="muted" style={{ fontSize: 12.5 }}>
          Counted over
        </span>
        <input
          type="date"
          value={values.from ?? builtFrom ?? ""}
          max={values.to ?? TODAY()}
          onChange={(e) =>
            apply({ from: e.target.value, to: values.to ?? builtTo ?? TODAY() })
          }
          aria-label="Count conversations from"
          style={{ fontSize: 12.5 }}
        />
        <span className="muted" style={{ fontSize: 12.5 }}>
          to
        </span>
        <input
          type="date"
          value={values.to ?? builtTo ?? ""}
          min={values.from ?? builtFrom ?? undefined}
          max={TODAY()}
          onChange={(e) =>
            apply({ from: values.from ?? builtFrom ?? undefined, to: e.target.value })
          }
          aria-label="Count conversations to"
          style={{ fontSize: 12.5 }}
        />
        <button type="button" className="btn secondary" style={{ fontSize: 11.5 }}
          onClick={() => preset(7)}>
          last 7 days
        </button>
        <button type="button" className="btn secondary" style={{ fontSize: 11.5 }}
          onClick={() => preset(30)}>
          last 30 days
        </button>
        {custom && (
          <button type="button" className="btn secondary" style={{ fontSize: 11.5 }}
            onClick={() => apply({ from: "", to: "" })}>
            back to the built window
          </button>
        )}
        {windowMessages !== null && (
          <span className="muted mono" style={{ fontSize: 11.5 }}>
            {windowMessages.toLocaleString("en-GB")} member messages
          </span>
        )}
      </div>

      <div className="controls" style={{ marginBottom: 10 }}>
        <input
          type="search"
          name="q"
          defaultValue={values.q ?? ""}
          placeholder="search the words themselves…"
          aria-label="Search titles and answers"
          style={{ minWidth: 260, flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply({ q: e.currentTarget.value });
          }}
          onBlur={(e) => {
            if ((e.currentTarget.value || "") !== (values.q ?? "")) {
              apply({ q: e.currentTarget.value });
            }
          }}
        />
        <select
          value={values.source ?? ""}
          onChange={(e) => apply({ source: e.target.value })}
          aria-label="Source"
        >
          <option value="">Any source</option>
          {Object.entries(SOURCE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={values.wiring ?? ""}
          onChange={(e) => apply({ wiring: e.target.value })}
          aria-label="Wiring"
        >
          <option value="">Live or deploy</option>
          {Object.entries(WIRING).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select
          value={values.topic ?? ""}
          onChange={(e) => apply({ topic: e.target.value })}
          aria-label="Topic"
        >
          <option value="">Any topic</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={(values.sort as Sort) ?? "demand"}
          onChange={(e) => apply({ sort: e.target.value })}
          aria-label="Sort"
        >
          <option value="demand">Most raised first</option>
          <option value="notes">Most notes first</option>
          <option value="title">A to Z</option>
        </select>
        <label
          className="muted"
          style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}
        >
          <input
            type="checkbox"
            checked={values.dupes === "hide"}
            onChange={(e) => apply({ dupes: e.target.checked ? "hide" : "" })}
          />
          hide the {dupeCount} duplicate copies
        </label>
      </div>

      {/* Tags, with their counts. The same filtering as the selects above; they
          are here because a tag is how most of these get described out loud. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {tags.map(([t, n]) => (
          <button
            key={t}
            type="button"
            className={`btn secondary${values.tag === t ? " active" : ""}`}
            onClick={() => apply({ tag: values.tag === t ? "" : t })}
            style={{ fontSize: 11.5, padding: "3px 9px" }}
          >
            #{t} <span className="muted">{n}</span>
          </button>
        ))}
      </div>

      <p className="muted mono" style={{ fontSize: 11.5, margin: "0 0 10px" }}>
        {painted} shown · {matching} match · {total} in total
        {filtered && (
          <>
            {" · "}
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: 11, padding: "1px 8px" }}
              onClick={() => router.push("/knows")}
            >
              clear
            </button>
          </>
        )}
      </p>
    </>
  );
}
