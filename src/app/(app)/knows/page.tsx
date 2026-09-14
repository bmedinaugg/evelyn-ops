import Link from "next/link";
import { getKnowledgeItems, listKnowledgeItemNotes } from "@/lib/queries";
import type { KnowledgeItemRow, KnowledgeItemNoteRow } from "@/lib/types";
import { KnowsFilters, type Values } from "./KnowsFilters";
import { SOURCE, WIRING, KINDS, KIND_LABEL, PAGE, type Sort } from "./shared";
import { addKnowledgeNoteAction, resolveKnowledgeNoteAction } from "./actions";

export const dynamic = "force-dynamic";

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Rebuild the current query string, so "show more" and the redirect after
// saving a note both come back to the view the reader was actually looking at.
function qs(values: Values, extra: Record<string, string | number> = {}) {
  const p = new URLSearchParams();
  Object.entries({ ...values, ...extra }).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `/knows?${s}` : "/knows";
}

export default async function KnowsPage({
  searchParams,
}: {
  searchParams: Promise<
    Values & { n?: string; open?: string }
  >;
}) {
  const sp = await searchParams;
  const values: Values = {
    q: sp.q,
    source: sp.source,
    wiring: sp.wiring,
    topic: sp.topic,
    tag: sp.tag,
    sort: sp.sort,
    dupes: sp.dupes,
  };

  const [items, notes] = await Promise.all([
    getKnowledgeItems(),
    listKnowledgeItemNotes(),
  ]);

  // Notes are keyed softly, so group rather than join.
  const byItem = new Map<string, KnowledgeItemNoteRow[]>();
  for (const n of notes) {
    const list = byItem.get(n.item_key) ?? [];
    list.push(n);
    byItem.set(n.item_key, list);
  }

  const count = (fn: (i: KnowledgeItemRow) => boolean) => items.filter(fn).length;
  const dupes = count((i) => !!i.duplicate_of);
  const onlySheet = count((i) => i.source === "spreadsheet" && !i.duplicate_of);
  const deploy = count((i) => i.wiring === "deploy");
  const neverRaised = count((i) => i.matched_sessions === 0);
  const noMeasure = count((i) => i.matched_sessions === null);
  const clubs = count((i) => i.source === "club_directory");
  const memberCare = count((i) => i.source === "member_care");
  const window = items[0]
    ? `${fmtDate(items[0].window_from)} – ${fmtDate(items[0].window_to)}`
    : "";
  const oldest = items.reduce<string | null>(
    (a, i) => (a === null || i.verified_at < a ? i.verified_at : a),
    null,
  );

  const topics = [...new Set(items.map((i) => i.topic))].sort();
  // Ordered by how many items carry them, so the useful filters come first
  // rather than the alphabetically lucky ones.
  const tagCounts = new Map<string, number>();
  for (const i of items) {
    for (const t of i.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  // --- filter, sort, then cap what gets painted ----------------------------
  const needle = (values.q ?? "").trim().toLowerCase();
  const matching = items
    .filter((i) => {
      if (values.dupes === "hide" && i.duplicate_of) return false;
      if (values.source && i.source !== values.source) return false;
      if (values.wiring && i.wiring !== values.wiring) return false;
      if (values.topic && i.topic !== values.topic) return false;
      if (values.tag && !i.tags.includes(values.tag)) return false;
      if (!needle) return true;
      // Searches the body too: someone reporting a wrong answer is usually
      // holding the sentence, not the title it lives under.
      return (
        i.title.toLowerCase().includes(needle) ||
        i.body.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => {
      const sort = (values.sort as Sort) ?? "demand";
      const openNotes = (i: KnowledgeItemRow) => byItem.get(i.key)?.length ?? 0;
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "notes") {
        return (
          openNotes(b) - openNotes(a) ||
          (b.matched_sessions ?? -1) - (a.matched_sessions ?? -1)
        );
      }
      return (b.matched_sessions ?? -1) - (a.matched_sessions ?? -1);
    });

  const limit = Math.max(PAGE, Math.min(Number(sp.n) || PAGE, matching.length));
  const painted = matching.slice(0, limit);

  return (
    <>
      <div className="pagehead">
        <h1>What Evelyn knows</h1>
        <p className="muted">
          Every individual fact she can answer from, in her own words, with
          somewhere to say what is wrong with it. TrainMore.
        </p>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>
          These are her words, not a summary of them
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
          Four pages cover this ground at four different distances.{" "}
          <Link href="/scenarios" prefetch={false}>Scenario library</Link> is what she
          recognises. <Link href="/library" prefetch={false}>Case library</Link> is what she does
          about it. <Link href="/knowledge" prefetch={false}>Knowledge register</Link> is the
          seven documents and feeds behind that. This is what is{" "}
          <em>inside</em> those documents, one row per article &mdash; the level
          at which you can read a sentence, decide it is wrong, and say so.
        </p>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: "72ch" }}>
          The row is the <strong>article</strong>, not the chunk it is stored
          as. The store splits long articles up for retrieval; nobody can edit
          half an article, so the halves are folded back together here and the
          number of pieces is noted on each one.
        </p>
        <p className="muted mono" style={{ fontSize: 11.5, marginBottom: 0 }}>
          {items.length} facts · {clubs} clubs · {memberCare} written by Member
          Care · {deploy} need a deploy to change · oldest check{" "}
          {fmtDate(oldest)}
        </p>
      </div>

      {/* Stated as a finding rather than left as a tag to notice: it is the one
          thing on this page that is a decision waiting to be taken. */}
      {dupes > 0 && onlySheet === 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            The spreadsheet contributes nothing the Freshdesk sync does not
          </h2>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
            All <strong>{dupes}</strong> articles arriving from TrainMore
            FAQs.xlsx also arrive from Freshdesk on their own.{" "}
            <strong>{onlySheet}</strong> are unique to the sheet. So every one
            of them is stored twice, retrieval can return the same answer twice,
            and editing the Freshdesk article leaves the second copy saying the
            old thing.
          </p>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: "72ch", marginBottom: 0 }}>
            The sheet was last edited 8 April 2026 and is still imported every
            morning. Turning that feed off would remove {dupes} duplicate copies
            and lose nothing &mdash; but that is a decision for whoever owns the
            sheet, not a conclusion this page can draw on its own.
          </p>
        </div>
      )}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 16 }}>
          What the number on the left is, and what it is not
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
          <strong>Nothing logs which answer was used.</strong> There is no
          retrieval log anywhere in the database, so how often a given article
          actually answered someone cannot be measured &mdash; only estimated.
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
          The estimate is this: take the distinctive words out of the
          item&rsquo;s own title, add their Dutch equivalents, and count how many
          conversations in {window} carried enough of them. So the number says{" "}
          <strong>how many members raised the subject this covers</strong>{" "}
          &mdash; not how many read this article. An article about cancelling
          because of the price rise shares its words with every cancellation
          question there is, and inherits that whole subject&rsquo;s volume.
        </p>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: "72ch" }}>
          Every row therefore shows the exact words behind its number and how
          many of them a message had to carry, so the figure can be argued with
          rather than taken on trust. {noMeasure} item
          {noMeasure === 1 ? " has" : "s have"} fewer than two distinctive words
          and get no figure at all &mdash; that reads <em>no measure</em>, which
          is not the same as the {neverRaised} nobody raised once.
        </p>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: "72ch", marginBottom: 0 }}>
          The hand-tuned version of this instrument, for twenty questions rather
          than {items.length}, is on{" "}
          <Link href="/questions" prefetch={false}>How a question gets answered</Link>. Where the
          two disagree, trust that one.
        </p>
      </div>

      {notes.length > 0 && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 16 }}>
            Raised and still open <span className="mono">{notes.length}</span>
          </h2>
          <p className="muted" style={{ fontSize: 13, maxWidth: "70ch" }}>
            Everything the team has said about a piece of this knowledge. Each
            one also sits on its own item below, where it can be marked done.
            <strong> These are a to-do list, not a change</strong> &mdash;
            nothing here reaches the bot until someone edits the source it
            names.
          </p>
          {notes.map((n) => {
            const item = items.find((i) => i.key === n.item_key);
            return (
              <div
                key={n.id}
                style={{
                  borderTop: "1px solid var(--border)",
                  padding: "9px 0",
                  fontSize: 13.5,
                }}
              >
                <strong>{item ? item.title : n.item_key}</strong>
                {!item && (
                  <span className="badge grey" style={{ fontSize: 10.5, marginLeft: 6 }}>
                    item retired
                  </span>
                )}{" "}
                &mdash; {n.note}
                <div className="muted mono" style={{ fontSize: 11.5 }}>
                  {KIND_LABEL[n.kind] ?? n.kind} · {n.author_email} ·{" "}
                  {new Date(n.created_at).toLocaleDateString("en-GB")}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel" style={{ padding: 16, marginTop: 18 }}>
        <KnowsFilters
          values={values}
          topics={topics}
          tags={tags}
          dupeCount={dupes}
          painted={painted.length}
          matching={matching.length}
          total={items.length}
        />

        {painted.length === 0 && (
          <p className="muted" style={{ fontSize: 13 }}>
            Nothing matches. If you expected something here, that absence is
            worth a note on whatever is nearest &mdash; it is how a gap gets
            recorded.
          </p>
        )}

        {painted.map((i) => (
          <Item
            key={i.key}
            i={i}
            notes={byItem.get(i.key) ?? []}
            defaultOpen={sp.open === i.key}
            back={qs(values, { n: limit, open: i.key })}
          />
        ))}

        {/* A cap, said out loud. Silently stopping at 60 would read as "that is
            all there is", which is the one thing a page called What Evelyn
            knows must never imply. */}
        {matching.length > painted.length && (
          <p style={{ marginTop: 14, marginBottom: 0 }}>
            <Link
              href={qs(values, { n: limit + PAGE })}
              className="btn secondary"
              prefetch={false}
              scroll={false}
            >
              Show {Math.min(PAGE, matching.length - painted.length)} more
            </Link>{" "}
            <span className="muted mono" style={{ fontSize: 11.5 }}>
              {matching.length - painted.length} not shown yet
            </span>
          </p>
        )}
      </div>
    </>
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
  defaultOpen,
  back,
}: {
  i: KnowledgeItemRow;
  notes: KnowledgeItemNoteRow[];
  // Saving a note revalidates the route, which would close a plain <details>
  // and lose the reader's place. The action redirects with ?open=<key> so the
  // row they were working in comes back open.
  defaultOpen: boolean;
  back: string;
}) {
  const src = SOURCE[i.source];
  const wir = WIRING[i.wiring];
  return (
    <details
      id={`i-${i.key}`}
      open={defaultOpen}
      style={{ borderTop: "1px solid var(--border)", padding: "10px 0" }}
    >
      <summary
        style={{
          cursor: "pointer",
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          flexWrap: "wrap",
        }}
      >
        <span style={{ minWidth: 52, textAlign: "right" }}><Demand i={i} /></span>
        <span style={{ fontWeight: 600, flex: 1, minWidth: 240 }}>{i.title}</span>
        {notes.length > 0 && (
          <span className="badge red" style={{ fontSize: 10.5 }}>
            {notes.length} note{notes.length > 1 ? "s" : ""}
          </span>
        )}
        <span className={`badge ${src.badge}`} style={{ fontSize: 10.5 }}>
          {src.label}
        </span>
        {i.wiring !== "live" && (
          <span className={`badge ${wir.badge}`} style={{ fontSize: 10.5 }}>
            {wir.label}
          </span>
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
          {fmtDate(i.verified_at)}
        </p>

        {i.examples.length > 0 && (
          <div style={{ margin: "10px 0 0" }}>
            <div
              className="muted"
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: ".08em",
              }}
            >
              Members who raised it
            </div>
            {i.examples.map((e, n) => (
              <p
                key={n}
                className="muted"
                style={{
                  margin: "4px 0 0",
                  paddingLeft: 12,
                  borderLeft: "2px solid var(--border)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontStyle: "italic" }}>&ldquo;{e}&rdquo;</span>{" "}
                {i.example_sessions[n] && (
                  // prefetch={false} matters here. Sixty rows carrying three
                  // quotes each is up to 180 links to /conversations/[id],
                  // which is force-dynamic and does real work per request.
                  // Left to prefetch, opening this page fires that whole burst
                  // at the server and the page never settles.
                  <Link
                    href={`/conversations/${i.example_sessions[n]}`}
                    prefetch={false}
                    style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
                  >
                    read the conversation
                  </Link>
                )}
              </p>
            ))}
          </div>
        )}

        {/* Notes live in bot.knowledge_item_notes, not on the item row: the
            items mirror a store rebuilt every morning and are re-seeded with a
            delete-all, which would take any note held on the row with it. */}
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
                <input type="hidden" name="back" value={back} />
                <button type="submit" className="btn secondary">Done</button>
              </form>
            </div>
          ))}

          {/* Said plainly, next to the box. "What should it say?" reads like an
              edit form, and it is not one: nothing reads these notes except
              this page. Letting someone believe they had corrected the bot,
              and find out weeks later that they had not, is the worst thing
              this page could do. */}
          <p className="muted" style={{ fontSize: 12, margin: "0 0 6px", maxWidth: "72ch" }}>
            <strong>A note goes to the team, not to the bot.</strong> Nothing
            you write here changes what Evelyn says. To actually change it:{" "}
            {src.where.charAt(0).toLowerCase() + src.where.slice(1)}
          </p>
          <form
            action={addKnowledgeNoteAction}
            style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <input type="hidden" name="item_key" value={i.key} />
            <input type="hidden" name="back" value={back} />
            <select name="kind" defaultValue="wrong" aria-label="What kind of note">
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <textarea
              name="note"
              rows={2}
              placeholder="What is wrong with this, and what should it say instead?"
              aria-label="Your note"
              style={{ flex: 1, minWidth: 240, fontSize: 13, padding: "6px 8px" }}
            />
            <button type="submit" className="btn secondary">Save</button>
          </form>
        </div>
      </div>
    </details>
  );
}
