-- Remove the claim that the second FAQ feed is TrainMore FAQs.xlsx.
--
-- WHAT WAS WRONG
-- db/033 recorded a source called "TrainMore FAQs.xlsx", an Excel workbook in
-- SharePoint, as the origin of the 58-ish articles labelled source=blob. It was
-- honest about its own evidence — "its columns (title / description / url /
-- category) are exactly the metadata carried on the chunks labelled
-- source=blob" — which is shape-matching, not provenance. It also recorded that
-- the file could not be found in SharePoint under any search tried.
--
-- HOW WE KNOW IT SHOULD COME OUT, 14 Sep 2026
--   * public.clear_faqs() deletes every row of public.trainmore_faqs on each
--     run — checked against the function definition.
--   * The "Clubs FAQs" workflow (fmvDzjBJrsyU9m2z, all 32 nodes read) is the
--     only sync anyone had identified. It re-inserts exactly two things:
--     Freshdesk articles and bot.manual_faqs. Its Default Data Loader hardcodes
--     the source metadata to `metadata.source || 'freshdesk'`, so it CANNOT
--     emit 'blob'.
--   * Yet 69 blob-labelled chunks were written that morning between 10:00:37
--     and 10:00:54 UTC, interleaved with that workflow's own inserts
--     (10:00:39-10:01:06).
--   * No workflow in the n8n instance matches "blob", "xlsx" or "sharepoint".
--
-- So a second process writes 38% of the store on the same schedule, and we have
-- not traced it. Everything else about the feed is verified; only the NAME was
-- ever a guess.
--
-- WHY BLANK BEATS WRONG
-- An unverified owner is worse than no owner, because nobody goes looking for
-- what they think they already know. The row stays — the feed is real and runs
-- daily — but it is no longer named after a file nothing connects it to.
--
-- WHY BOTH CONSTRAINTS MOVED
-- Neither `kind` nor `source` could express "we do not know", which is part of
-- how a guess hardened into a fact: the schema demanded an answer, so one was
-- supplied. Both now have a value for the honest case.
--
-- WHY THE KEY DOES NOT CHANGE
-- `faq_spreadsheet` stays. Keys are opaque identifiers and this one is
-- referenced by bot.question_traces.ultimate_source_keys; renaming it would
-- break those joins for no gain. Names are what people read, and the name is
-- what was wrong.
--
-- Re-seed after applying:
--   node tools/knowledge/items.js && node tools/knowledge/items-seed.js
--   node tools/questions/build.js && node tools/questions/seed.js
--   node tools/knowledge/doc.js

alter table bot.knowledge_sources drop constraint if exists knowledge_sources_kind_ck;
alter table bot.knowledge_sources add constraint knowledge_sources_kind_ck check (kind in (
  'Published articles', 'Excel workbook', 'Word document',
  'Database table', 'n8n nodes', 'Live API',
  'Unknown'   -- the register must be able to say so
));

alter table bot.knowledge_items drop constraint if exists knowledge_items_source_ck;
alter table bot.knowledge_items add constraint knowledge_items_source_ck check (source in (
  'freshdesk', 'spreadsheet', 'member_care', 'club_directory', 'prompt',
  'unidentified'  -- written daily by a process we have not traced
));

update bot.knowledge_sources set
  name = 'A second FAQ feed — loader unidentified',
  kind = 'Unknown',
  url  = null,
  last_used = 'Re-imported every morning. 69 chunks written 14 Sep 2026, 10:00:37–10:00:54 UTC, interleaved with the Clubs FAQs run.',
  evidence = 'By elimination and timing, 14 Sep 2026. clear_faqs() empties the table every run; the Clubs FAQs workflow (fmvDzjBJrsyU9m2z) re-inserts only Freshdesk and bot.manual_faqs, and its data loader cannot emit source=blob. Something else writes these rows. No workflow in the instance matches blob, xlsx or sharepoint by name.',
  influences = '58 articles, every one of which also arrives from Freshdesk on its own. It supplies no answer the Freshdesk sync does not already provide.',
  owner = 'Unknown. That is the finding.',
  risk = 'Recorded until 14 Sep 2026 as "TrainMore FAQs.xlsx" in SharePoint. That was an inference from column shape, never a trace, and the file was never located. The name has been removed rather than left standing — an unverified owner is worse than a blank one, because nobody goes looking for what they think they already know. 38% of what the bot can answer from arrives this way.',
  verified_at = '2026-09-14'
where key = 'faq_spreadsheet';
