-- There is no second FAQ source. It is the Freshdesk sync inserting twice.
--
-- db/039 removed the "TrainMore FAQs.xlsx" name and recorded the feed as
-- untraced. Traced it the same day, and the answer is better than expected:
-- it is not a feed at all. db/039 is left in place rather than rewritten —
-- the sequence of being wrong, then less wrong, then right is the useful part.
--
-- HOW WE KNOW, 14 Sep 2026
--   * Execution 436040 of "Clubs FAQs" (fmvDzjBJrsyU9m2z) ran 10:00:37.040 to
--     10:01:59.058. It is the ONLY trigger-mode execution in that window, and
--     every blob, freshdesk and member-care row written that morning falls
--     inside it.
--   * For article 103000357073 the blob row (10:00:51.807) and the freshdesk
--     row (10:01:04.744) are byte-identical — same content, title, category,
--     both reference_urls, brand, loc.lines, even the same blobType — and
--     differ in exactly one field: `source`.
--   * "blob" is LangChain's own default metadata for a document loaded from a
--     text blob. It is what the row carries when the workflow's configured
--     `source` value does not get applied, not a description of any origin.
--
-- So these rows are Freshdesk articles written a second time by the same run.
-- The register carried a phantom source for months because a duplicate was
-- mistaken for a feed, then named after a file whose columns happened to match
-- the generic metadata shape.
--
-- LIKELY MECHANISM, NOT YET PROVEN
-- The duplicate count moves between runs — 58 articles on 10 Sep, 62 on 14 Sep,
-- against a stable 99 originals. A varying count under a fixed input is a race,
-- and the workflow shares ONE "Default Data Loader3" and one embeddings node
-- across four concurrent vector-store branches. Giving each branch its own
-- loader is the first thing to try. Recorded as a hypothesis, not a finding.
--
-- The row is KEPT rather than deleted. It records a live defect that writes
-- ~38% of the store every night, and deleting it would erase both the defect
-- and the history of the mistake. tools/knowledge/items.js now files these
-- chunks as source='freshdesk' with duplicate_of set, so /knows no longer shows
-- a source that does not exist.

update bot.knowledge_sources set
  name = 'Duplicate Freshdesk inserts (defect, not a source)',
  kind = 'n8n nodes',
  wiring = 'deploy',
  url = 'https://urbangymgroup-prod.app.n8n.cloud/workflow/fmvDzjBJrsyU9m2z',
  last_used = 'Every morning, inside the same run as the Freshdesk import. 69 duplicate chunks across 62 articles on 14 Sep 2026.',
  evidence = 'Execution 436040 of Clubs FAQs, 10:00:37-10:01:59 UTC on 14 Sep 2026 — the only trigger in the window. For article 103000357073 the two rows are byte-identical apart from `source`, written 13 seconds apart in that run. "blob" is LangChain default metadata for a text blob, not an origin.',
  influences = 'Nothing the Freshdesk sync does not already provide. It duplicates 62 of the 99 articles, so retrieval can return the same answer twice and a duplicated article can outrank a better one by existing twice.',
  owner = 'Engineering. It is a workflow bug, and the fix is in Clubs FAQs (fmvDzjBJrsyU9m2z).',
  risk = 'Recorded until 14 Sep 2026 as a separate source called "TrainMore FAQs.xlsx" in SharePoint. No such file was ever found because none was ever involved: a duplicate insert was mistaken for a feed, then named after a file whose columns matched the generic metadata shape. The count varies between runs (58 articles on 10 Sep, 62 on 14 Sep) against a stable 99 originals, which points at the data loader shared across four concurrent branches — a hypothesis, not yet proven.',
  verified_at = '2026-09-14'
where key = 'faq_spreadsheet';
