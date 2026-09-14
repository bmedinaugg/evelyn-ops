import Link from "next/link";
import { getKnowledgeItems, listKnowledgeItemNotes } from "@/lib/queries";
import { KnowsBrowser } from "./KnowsBrowser";

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

export default async function KnowsPage() {
  const [items, notes] = await Promise.all([
    getKnowledgeItems(),
    listKnowledgeItemNotes(),
  ]);

  const count = (fn: (i: (typeof items)[number]) => boolean) =>
    items.filter(fn).length;

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
          <Link href="/scenarios">Scenario library</Link> is what she
          recognises. <Link href="/library">Case library</Link> is what she does
          about it. <Link href="/knowledge">Knowledge register</Link> is the
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
          The estimate is this: take the distinctive words out of the item&rsquo;s
          own title, add their Dutch equivalents, and count how many
          conversations in {window} carried enough of them. So the number says{" "}
          <strong>
            how many members raised the subject this covers
          </strong>{" "}
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
          <Link href="/questions">How a question gets answered</Link>. Where the
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
                  {n.kind} · {n.author_email} ·{" "}
                  {new Date(n.created_at).toLocaleDateString("en-GB")}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <KnowsBrowser items={items} notes={notes} />
      </div>
    </>
  );
}
