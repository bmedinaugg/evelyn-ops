import Link from "next/link";
import { getKnowledgeGaps, listKnowledgeItemNotes } from "@/lib/queries";
import type { KnowledgeItemNoteRow } from "@/lib/types";
import { Gaps } from "../knows/Gaps";

export const dynamic = "force-dynamic";

// The first of the three knowledge pages: what she is ASKED and cannot answer.
// It used to sit on top of /knows, which meant the one page answered three
// different questions and you had to scroll past two of them to reach the one
// you came for.
//
// The note forms here redirect back to this page rather than to /knows — see
// safeBack in ../knows/actions.ts, which allows all three routes and nothing
// else.
export default async function GapsPage() {
  const [gaps, notes] = await Promise.all([
    getKnowledgeGaps(),
    listKnowledgeItemNotes(),
  ]);

  const byItem = new Map<string, KnowledgeItemNoteRow[]>();
  for (const n of notes) {
    const list = byItem.get(n.item_key) ?? [];
    list.push(n);
    byItem.set(n.item_key, list);
  }

  return (
    <>
      <div className="pagehead">
        <h1>Gaps</h1>
        <p className="muted">
          Subjects members raise that no article covers well, or at all.
          TrainMore.
        </p>
      </div>

      <div className="panel">
        <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch", margin: 0 }}>
          This is the mirror of{" "}
          <Link href="/knows" prefetch={false}>what she knows</Link> &mdash; you
          need both to read either. An article nobody asks about is a candidate
          for retirement; a subject with demand and nothing behind it is the
          work. Account questions are a third thing again, and live on{" "}
          <Link href="/magicline" prefetch={false}>Magicline</Link>.
        </p>
      </div>

      <Gaps gaps={gaps} notesByKey={byItem} back={() => "/gaps"} />

      {gaps.length === 0 && (
        <div className="panel">
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No gaps on file. That is more likely to mean the gap analysis has
            not been rebuilt than that there is nothing members ask which we
            cannot answer.
          </p>
        </div>
      )}
    </>
  );
}
