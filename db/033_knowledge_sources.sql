-- The Evelyn knowledge register: everything that influences what the bot knows,
-- whether or not it ever produced an FAQ.
--
-- WHY THIS IS NOT THE CASE LIBRARY
-- db/032 (`bot.case_library`) answers "what does Evelyn decide, and where does
-- that answer come from" — one row per case, source named in prose. This table
-- answers the question underneath it: which documents and feeds are shaping her
-- knowledge at all, when each was last used, and whether anything actually
-- reads it. A document can influence the bot without producing a single FAQ —
-- the TrainMore NL Bot Training Guide is the worked example — and the case
-- library has nowhere to put that.
--
-- WHY IT EXISTS AT ALL: THERE IS NO INGESTION LOG
-- The FAQ vector store is rebuilt from scratch every morning, so every row in
-- it carries today's date and the store remembers nothing about when a document
-- first arrived or last changed anything. Verified 10 Sep 2026: all TrainMore
-- rows stamped between 10:00:37 and 10:02:06 UTC that day. `bot.bot_changes` is
-- a defect-fix log (3 rows), not a knowledge log.
--
-- So every date here is RECONSTRUCTED, and `evidence` records from what — a
-- file's own modified date, a date built into an n8n node name, or a commit.
-- That is why `evidence` is NOT NULL: a date without its provenance is exactly
-- the thing this table exists to stop.
--
-- The real fix is for the daily sync to write a row each time it imports
-- something (what, from where, how many chunks, when). Then this register is
-- generated rather than curated. Until that exists, this is the record.
--
-- WHY A TABLE AND NOT A DOC
-- Same reasoning as db/032: sources get added, swapped and retired constantly,
-- so a markdown file would be accurate the day it was written and wrong a
-- fortnight later with no signal that it had drifted. `verified_at` per row
-- makes staleness visible, and Member Care can correct a row without a deploy.
--
-- HONEST LIMIT: the descriptive columns are hand-written from tracing the live
-- system on 10 Sep 2026. Only the FAQ counts are computed live, by
-- bot.knowledge_sources_view().
--
-- SCOPE: TrainMore. The Clubsportive and Gymbox stores exist and have the same
-- shape; they are deliberately out of scope here rather than silently merged.

create table if not exists bot.knowledge_sources (
  key           text primary key,
  sort_order    integer not null default 100,
  brand         text not null default 'trainmore',
  name          text not null,
  kind          text not null,
  wiring        text not null,
  url           text,
  -- Prose, not a timestamp: "re-imported daily, last run X; file last edited Y"
  -- is the honest answer and a single column cannot hold it.
  last_used     text not null,
  -- The best single date we can defend, for sorting and for spotting staleness.
  last_used_at  date,
  evidence      text not null,
  influences    text not null,
  owner         text not null,
  risk          text,
  verified_at   date not null default current_date,
  constraint knowledge_sources_wiring_ck check (wiring in (
    'live',       -- re-read automatically; change it and the bot follows
    'deploy',     -- written into n8n; changing it needs a release
    'not_wired'   -- nothing reads it; editing it changes nothing
  )),
  constraint knowledge_sources_kind_ck check (kind in (
    'Published articles', 'Excel workbook', 'Word document',
    'Database table', 'n8n nodes', 'Live API'
  ))
);

comment on table bot.knowledge_sources is
  'Every document and feed influencing what Evelyn knows, including those that produced no FAQ. Dates are reconstructed because no ingestion log exists; `evidence` records from what. Complements bot.case_library, which covers decisions rather than sources.';
comment on column bot.knowledge_sources.wiring is
  'live = re-read automatically; deploy = written into n8n, needs a release; not_wired = nothing reads it, editing it changes nothing.';
comment on column bot.knowledge_sources.evidence is
  'How we know the date. Required: a date without its provenance is what this table exists to prevent.';

-- Live FAQ counts joined on, so the numbers cannot drift even though the prose
-- can. Sources that feed no FAQ (a Word document, a prompt, Magicline) get
-- null rather than a zero, because zero would read as "it stopped working".
create or replace function bot.knowledge_sources_view()
returns table (
  key text, sort_order integer, brand text, name text, kind text, wiring text,
  url text, last_used text, last_used_at date, evidence text, influences text,
  owner text, risk text, verified_at date, faq_count integer
)
language sql
stable
as $function$
  with counts as (
    select
      count(distinct metadata->>'title') filter (where metadata->>'source' = 'freshdesk')   as freshdesk_n,
      count(distinct metadata->>'title') filter (where metadata->>'source' = 'blob')        as blob_n,
      count(distinct metadata->>'title') filter (where metadata->>'source' = 'member-care') as care_n
    from public.trainmore_faqs
  )
  select k.key, k.sort_order, k.brand, k.name, k.kind, k.wiring, k.url,
         k.last_used, k.last_used_at, k.evidence, k.influences, k.owner,
         k.risk, k.verified_at,
         case k.key
           when 'freshdesk_articles'  then (select freshdesk_n from counts)::int
           when 'faq_spreadsheet'     then (select blob_n from counts)::int
           when 'member_care_answers' then (select care_n from counts)::int
           else null
         end
  from bot.knowledge_sources k
  order by k.sort_order, k.key;
$function$;

comment on function bot.knowledge_sources_view is
  'The register with live FAQ counts joined on. Null faq_count means the source feeds no FAQ at all, which is different from feeding zero.';

-- ---------------------------------------------------------------- seed ----
-- Traced from the live system on 10 Sep 2026. Correct a row with an UPDATE;
-- no deploy is needed, and bump verified_at when you check one.
-- verified_at is set explicitly rather than left to its default: the default
-- would record the day the migration happened to be applied, not the day the
-- live system was actually traced, which is the only date worth recording.
insert into bot.knowledge_sources
  (key, sort_order, name, kind, wiring, url, last_used, last_used_at, evidence, influences, owner, risk, verified_at)
values
  ('freshdesk_articles', 10,
   'Freshdesk help articles', 'Published articles', 'live',
   'https://www.support.trainmore.com/en/support/solutions',
   'Re-imported every day. Last run 10 Sep 2026, 10:00 UTC.',
   date '2026-09-10',
   'Ingestion timestamp on the 112 chunks in public.trainmore_faqs labelled source=freshdesk.',
   'Most of the FAQs Evelyn can answer from.',
   'Member Care — whatever you publish in Freshdesk is in the bot the next morning.',
   null, date '2026-09-10'),

  ('faq_spreadsheet', 20,
   'TrainMore FAQs.xlsx', 'Excel workbook', 'live',
   'https://urbangymgroup-my.sharepoint.com/personal/bryan_medina_per_urbangymgroup_com/Documents/AI%20BOT/TrainMore%20FAQs.xlsx',
   'Re-imported every day. Last run 10 Sep 2026, 10:00 UTC. The file itself was last edited 8 April 2026.',
   date '2026-04-08',
   'Its columns (title / description / url / category) are exactly the metadata carried on the chunks labelled source=blob. File modified date from SharePoint.',
   'A second copy of much of the Freshdesk content.',
   'Whoever maintains the sheet.',
   'Five months since it was last edited, but still imported daily. 69 of TrainMore''s 112 FAQ chunks are stored twice because this sheet repeats articles that already sync from Freshdesk on their own. Decide which of the two to keep.', date '2026-09-10'),

  ('member_care_answers', 30,
   'Member Care hand-written answers', 'Database table', 'live',
   null,
   'Written 26 August 2026. Re-imported daily; last run 10 Sep 2026, 10:02 UTC.',
   date '2026-08-26',
   'bot.manual_faqs, 5 rows, all active. Each row names the tickets it was written from.',
   'Answers no Freshdesk article covers at all — under-18s, employee and plus-one class booking, check-ins vs discount, PT trials, and what each membership label gives you.',
   'Member Care. Editing a row changes the bot the next morning, with no deploy.',
   null, date '2026-09-10'),

  ('training_guide', 40,
   'TrainMore NL Bot Training Guide', 'Word document', 'not_wired',
   'https://urbangymgroup-my.sharepoint.com/personal/bryan_medina_per_urbangymgroup_com/Documents/Attachments/TrainMore_NL_Bot_Training_Guide_1.docx',
   'Document last edited 18 August 2026. Its content reached the bot through prompt edits on 26 Aug, 4 Sep and 6 Sep 2026.',
   date '2026-08-18',
   'Searched the FAQ store on 10 Sep 2026: no trace of its text, and no .docx appears as a source. The 14 scenarios it defines are implemented as regexes in n8n nodes. File modified date from SharePoint; prompt dates from the node names and the git history.',
   'The 14 scenario definitions, and the 16 prompt and guardrail cases in bot.case_library.',
   'Esther Rumora wrote it. Nobody owns keeping the bot in step with it.',
   'Editing this document changes NOTHING. Someone has to re-read it and edit the prompts by hand, and nothing checks that the two still agree.', date '2026-09-10'),

  ('club_workbook', 50,
   'The club directory workbook', 'Excel workbook', 'live',
   'https://urbangymgroup-prod.app.n8n.cloud/workflow/49ZyB9tbZlqK3wW9',
   'Synced daily at 10:00, about 5 seconds. Verified in the n8n execution history for 8-9 Sep 2026.',
   date '2026-09-10',
   'n8n workflow "ugg gym data collection" (49ZyB9tbZlqK3wW9) reads UGG_Gym_Data_Collection_4.xlsx into bot.locations.',
   'Opening hours, day-pass prices and facilities for every club — and the only club data the bot has.',
   'Whoever maintains the workbook.',
   'The file could not be located. It is not in SharePoint under any search tried on 10 Sep 2026, so its location is configured inside the n8n node and recorded nowhere anyone can look up. The url here opens the workflow, not the sheet.', date '2026-09-10'),

  ('prompt_knowledge', 60,
   'Knowledge written straight into prompts', 'n8n nodes', 'deploy',
   'https://urbangymgroup-prod.app.n8n.cloud/workflow/Yq2zEE9NQo6hQvnO',
   'Change Options Briefing, Feedback Overrides and Guardrail Patches, 26 Aug 2026. Cancel Honesty, 4 Sep 2026, revised 6 Sep. Access levels and club names, 8 Sep 2026.',
   date '2026-09-08',
   'The nodes carry their date in their own name, which is the only dated record of a knowledge change that exists. Corroborated by the git history in evelyn-feedback.',
   'Freeze policy, cancellation honesty, access levels, club picking, no-show disputes and direct-debit dates.',
   'Engineering. Each change is a deploy.',
   null, date '2026-09-10'),

  ('magicline', 70,
   'Magicline', 'Live API', 'live',
   null,
   'Read per member, per question. Nothing is stored or cached.',
   null,
   'The account tools in Bot - Q&A call the Magicline API directly at question time.',
   'Contract, balance, payments, check-ins, bookings and access — 17 cases.',
   'Not ours. If the answer is wrong, the record in Magicline is wrong.',
   null, date '2026-09-10')
on conflict (key) do nothing;
