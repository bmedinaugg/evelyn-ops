"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { KnowledgeItemRow, KnowledgeItemNoteRow } from "@/lib/types";
import { addKnowledgeNoteAction, resolveKnowledgeNoteAction } from "./actions";

// Source answers "where did this come from"; wiring answers "can I get it
// changed". They are separate axes on purpose — a Freshdesk article and a
// Member Care answer are both live but edited in completely different places.
const SOURCE: Record<string, { label: string; badge: string; where: string }> = {
  freshdesk: {
    label: "Freshdesk",
    badge: "blue",
    where: "Edit the help article. It is in the bot the next morning.",
  },
  spreadsheet: {
    label: "Spreadsheet",
    badge: "grey",
    where: "Edit TrainMore FAQs.xlsx. It is in the bot the next morning.",
  },
  member_care: {
    label: "Member Care",
    badge: "green",
    where: "Edit the row in bot.manual_faqs. It is in the bot the next morning.",
  },
  club_directory: {
    label: "Club sheet",
    badge: "blue",
    where: "Edit the club workbook. It syncs at 10:00 every day.",
  },
  prompt: {
    label: "Prompt",
    badge: "amber",
    where: "Typed into an n8n node. Changing it needs an edit and a publish.",
  },
};

const WIRING: Record<string, { label: string; badge: string }> = {
  live: { label: "Live", badge: "green" },
  deploy: { label: "Needs a deploy", badge: "amber" },
  not_wired: { label: "Nothing reads it", badge: "red" },
};

const KINDS: { value: string; label: string }[] = [
  { value: "wrong", label: "This is wrong" },
  { value: "outdated", label: "Out of date" },
  { value: "unclear", label: "Right, but unclear" },
  { value: "missing", label: "Something is missing" },
  { value: "context", label: "Context, not work" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label]));

type Sort = "demand" | "title" | "notes";

export function KnowsBrowser({
  items,
  notes,
}: {
  items: KnowledgeItemRow[];
  notes: KnowledgeItemNoteRow[];
}) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [wiring, setWiring] = useState("");
  const [topic, setTopic] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<Sort>("demand");
  const [hideDupes, setHideDupes] = useState(false);
  // Which rows are open, held here rather than left to the <details> element.
  // Saving a note is a server action and revalidates the route; an uncontrolled
  // <details> would snap shut and lose the reader's place at exactly the moment
  // they were working. This state survives the re-render.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string, isOpen: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });

  // Notes are keyed softly, so group rather than join.
  const byItem = useMemo(() => {
    const m = new Map<string, KnowledgeItemNoteRow[]>();
    for (const n of notes) {
      const list = m.get(n.item_key) ?? [];
      list.push(n);
      m.set(n.item_key, list);
    }
    return m;
  }, [notes]);

  const topics = useMemo(
    () => [...new Set(items.map((i) => i.topic))].sort(),
    [items],
  );
  // Ordered by how many items carry them, so the useful filters come first
  // rather than the alphabetically lucky ones.
  const tags = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of items) for (const t of i.tags) c.set(t, (c.get(t) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = items.filter((i) => {
      if (hideDupes && i.duplicate_of) return false;
      if (source && i.source !== source) return false;
      if (wiring && i.wiring !== wiring) return false;
      if (topic && i.topic !== topic) return false;
      if (tag && !i.tags.includes(tag)) return false;
      if (!needle) return true;
      // Searches the body too: an agent looking for a wrong sentence is
      // usually holding the sentence, not the title it lives under.
      return (
        i.title.toLowerCase().includes(needle) ||
        i.body.toLowerCase().includes(needle)
      );
    });
    const openNotes = (i: KnowledgeItemRow) => byItem.get(i.key)?.length ?? 0;
    return out.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "notes") return openNotes(b) - openNotes(a) ||
        (b.matched_sessions ?? -1) - (a.matched_sessions ?? -1);
      return (b.matched_sessions ?? -1) - (a.matched_sessions ?? -1);
    });
  }, [items, byItem, q, source, wiring, topic, tag, sort, hideDupes]);

  const dupes = items.filter((i) => i.duplicate_of).length;
  const filtered = shown.length !== items.length;

  return (
    <div className="panel" style={{ padding: 16 }}>
      <div className="controls" style={{ marginBottom: 10 }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search the words themselves…"
          aria-label="Search titles and answers"
          style={{ minWidth: 260, flex: 1 }}
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="">Any source</option>
          {Object.entries(SOURCE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select value={wiring} onChange={(e) => setWiring(e.target.value)} aria-label="Wiring">
          <option value="">Live or deploy</option>
          {Object.entries(WIRING).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
          <option value="">Any topic</option>
          {topics.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="demand">Most raised first</option>
          <option value="notes">Most notes first</option>
          <option value="title">A to Z</option>
        </select>
        <label className="muted" style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={hideDupes}
            onChange={(e) => setHideDupes(e.target.checked)}
          />
          hide the {dupes} spreadsheet copies
        </label>
      </div>

      {/* Tags, with their counts. Clicking one is the same as the selects
          above; they are here because a tag is how most of these are actually
          described out loud. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {tags.map(([t, n]) => (
          <button
            key={t}
            type="button"
            className={`btn secondary${tag === t ? " active" : ""}`}
            onClick={() => setTag(tag === t ? "" : t)}
            style={{ fontSize: 11.5, padding: "3px 9px" }}
          >
            #{t} <span className="muted">{n}</span>
          </button>
        ))}
      </div>

      <p className="muted mono" style={{ fontSize: 11.5, margin: "0 0 10px" }}>
        {shown.length} of {items.length} shown
        {filtered && (
          <>
            {" · "}
            <button
              type="button"
              className="btn secondary"
              style={{ fontSize: 11, padding: "1px 8px" }}
              onClick={() => {
                setQ(""); setSource(""); setWiring(""); setTopic("");
                setTag(""); setHideDupes(false);
              }}
            >
              clear
            </button>
          </>
        )}
      </p>

      {shown.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Nothing matches. If you expected something here, that absence is worth
          a note on whatever is nearest &mdash; it is how a gap gets recorded.
        </p>
      )}

      {shown.map((i) => (
        <Item
          key={i.key}
          i={i}
          notes={byItem.get(i.key) ?? []}
          open={open.has(i.key)}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

function Demand({ i }: { i: KnowledgeItemRow }) {
  // Three states, kept apart: a number, nobody raised it, and no instrument.
  // Collapsing the last two turns "we cannot tell" into "no one cares".
  if (i.matched_sessions === null) {
    return <span className="muted mono" style={{ fontSize: 11.5 }}>no measure</span>;
  }
  if (i.matched_sessions === 0) {
    return <span className="muted mono" style={{ fontSize: 11.5 }}>0</span>;
  }
  return (
    <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>
      {i.matched_sessions.toLocaleString("en-GB")}
    </span>
  );
}

function Item({
  i,
  notes,
  open,
  onToggle,
}: {
  i: KnowledgeItemRow;
  notes: KnowledgeItemNoteRow[];
  open: boolean;
  onToggle: (key: string, isOpen: boolean) => void;
}) {
  const src = SOURCE[i.source];
  const wir = WIRING[i.wiring];
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(i.key, e.currentTarget.open)}
      style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}
    >
      <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ minWidth: 52, textAlign: "right" }}><Demand i={i} /></span>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 240 }}>{i.title}</span>
        {notes.length > 0 && (
          <span className="badge red" style={{ fontSize: 10.5 }}>
            {notes.length} note{notes.length > 1 ? "s" : ""}
          </span>
        )}
        <span className={`badge ${src.badge}`} style={{ fontSize: 10.5 }}>{src.label}</span>
        {i.wiring !== "live" && (
          <span className={`badge ${wir.badge}`} style={{ fontSize: 10.5 }}>{wir.label}</span>
        )}
        {i.duplicate_of && (
          <span className="badge grey" style={{ fontSize: 10.5 }}>copy</span>
        )}
        <span className="muted mono" style={{ fontSize: 11 }}>{i.topic}</span>
      </summary>

      <div style={{ padding: "8px 0 4px 14px" }}>
        {/* The words themselves, verbatim. Everything else on this row is
            about them; this is them. */}
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            padding: "10px 12px",
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--blue)",
            borderRadius: 3,
            background: "rgba(106,166,255,0.04)",
          }}
        >
          {i.body}
        </div>

        {i.caveat && (
          <p
            style={{
              fontSize: 13,
              margin: "10px 0 0",
              padding: "8px 10px",
              border: "1px solid var(--border)",
              borderLeft: "3px solid var(--amber)",
              borderRadius: 3,
            }}
          >
            <strong>Watch out.</strong> {i.caveat}
          </p>
        )}

        <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>
          <strong>To change it.</strong> {src.where}
          {i.source_name && (
            <>
              {" "}
              {i.source_url ? (
                <a href={i.source_url} target="_blank" rel="noopener noreferrer">
                  {i.source_name}
                </a>
              ) : (
                i.source_name
              )}
            </>
          )}
          {i.url && (
            <>
              {" · "}
              <a href={i.url} target="_blank" rel="noopener noreferrer">
                open this article
              </a>
            </>
          )}
        </p>

        {/* How the number was arrived at, next to the number. A demand figure
            whose matcher is hidden cannot be argued with. */}
        <p className="muted mono" style={{ fontSize: 11, margin: "6px 0 0" }}>
          {i.matched_sessions === null ? (
            <>No demand figure &mdash; {i.demand_method}.</>
          ) : (
            <>
              {i.matched_sessions.toLocaleString("en-GB")} conversations
              {i.matched_messages != null && (
                <> ({i.matched_messages.toLocaleString("en-GB")} messages)</>
              )}
              {" matched on "}
              {i.demand_method}
              {i.demand_terms.length > 0 && <> &mdash; {i.demand_terms.join(", ")}</>}
            </>
          )}
          {i.chunks > 1 && <> · stored as {i.chunks} pieces</>}
          {" · checked "}
          {new Date(i.verified_at + "T00:00:00Z").toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
          })}
        </p>

        {i.examples.length > 0 && (
          <div style={{ margin: "10px 0 0" }}>
            <div
              className="muted"
              style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em" }}
            >
              Members who raised it
            </div>
            {i.examples.map((e, n) => (
              <p
                key={n}
                className="muted"
                style={{ margin: "4px 0 0", paddingLeft: 12, borderLeft: "2px solid var(--border)", fontSize: 13 }}
              >
                <span style={{ fontStyle: "italic" }}>&ldquo;{e}&rdquo;</span>{" "}
                {i.example_sessions[n] && (
                  <Link
                    href={`/conversations/${i.example_sessions[n]}`}
                    style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
                  >
                    read the conversation
                  </Link>
                )}
              </p>
            ))}
          </div>
        )}

        <Notes itemKey={i.key} notes={notes} />
      </div>
    </details>
  );
}

// Notes live in bot.knowledge_item_notes, not on the item row: the items are a
// mirror of a store rebuilt every morning, and a note held on the row would be
// destroyed by the next refresh.
function Notes({
  itemKey,
  notes,
}: {
  itemKey: string;
  notes: KnowledgeItemNoteRow[];
}) {
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      {notes.map((n) => (
        <div
          key={n.id}
          style={{
            fontSize: 13,
            padding: "7px 10px",
            marginBottom: 6,
            border: "1px solid var(--border)",
            borderLeft: "3px solid var(--green)",
            borderRadius: 3,
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <div>
            <strong>{KIND_LABEL[n.kind] ?? n.kind}:</strong> {n.note}
            <div className="muted mono" style={{ fontSize: 11.5 }}>
              {n.author_email} ·{" "}
              {new Date(n.created_at).toLocaleDateString("en-GB")}
            </div>
          </div>
          <form action={resolveKnowledgeNoteAction}>
            <input type="hidden" name="id" value={n.id} />
            <button type="submit" className="btn secondary">Done</button>
          </form>
        </div>
      ))}

      <form
        action={addKnowledgeNoteAction}
        style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
      >
        <input type="hidden" name="item_key" value={itemKey} />
        <select name="kind" defaultValue="wrong" aria-label="What kind of note">
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
        <textarea
          name="note"
          rows={2}
          placeholder="What is wrong with this, or what should it say?"
          aria-label="Your note"
          style={{ flex: 1, minWidth: 240, fontSize: 13, padding: "6px 8px" }}
        />
        <button type="submit" className="btn secondary">Save</button>
      </form>
    </div>
  );
}
