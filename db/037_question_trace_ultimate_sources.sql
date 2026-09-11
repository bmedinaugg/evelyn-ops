-- Name the artefact each answer ultimately rests on: the spreadsheet, the Word
-- document, the published Freshdesk articles.
--
-- The chain already walked back to a person in prose. That reads well and
-- scans badly: "who ultimately types it" is a sentence, and what most people
-- want is the name of the thing they would have to open. So state it as data.
--
-- REFERENCED, NOT COPIED
-- bot.knowledge_sources already holds these artefacts with their kind, wiring,
-- url and last-used date. Copying the name into the traces would mean a source
-- renamed in the register silently disagreeing with the questions page, so the
-- traces hold keys and the view joins. The join is a lateral over a soft
-- reference, matching bot.question_notes: the traces table is rebuilt wholesale
-- by the generator, and a real foreign key in either direction would either
-- block that rebuild or cascade into it.
--
-- AN EMPTY LIST IS AN ANSWER
-- Two of the seven chains have no artefact at all: a ticket a person writes,
-- and a Freshdesk form the member is handed. Those get '{}' rather than a
-- placeholder row, and the page says so in words instead of showing nothing.
-- A form is not knowledge, so it does not belong in the knowledge register
-- either.
--
-- The training guide is deliberately listed against the prompt and guardrail
-- chains even though `wiring = not_wired`. It is where those answers were
-- agreed; leaving it out is exactly how it stays forgotten. The page marks it
-- "nothing reads it" rather than hiding it.

alter table bot.question_traces
  add column if not exists ultimate_source_keys text[] not null default '{}';

comment on column bot.question_traces.ultimate_source_keys is
  'Soft references into bot.knowledge_sources: the concrete artefact(s) at the END of the chain — the spreadsheet, the Word document, the Freshdesk articles. Referenced rather than copied so a source renamed in the register is renamed everywhere. Empty is meaningful: it means there is no document at all, which is true of a ticket a person answers.';

drop function if exists bot.question_traces_view();

create function bot.question_traces_view()
returns table (
  key text, sort_order integer, question text, examples text[],
  example_sessions text[],
  matched_messages integer, matched_sessions integer,
  window_from date, window_to date,
  chain_key text, chain_label text, decides text, reads text,
  chain_steps text[], ends_at text, change_cost text, caveat text,
  verified_at date, chain_question_count bigint,
  ultimate_sources jsonb
)
language sql
stable
as $function$
  select q.key, q.sort_order, q.question, q.examples, q.example_sessions,
         q.matched_messages, q.matched_sessions, q.window_from, q.window_to,
         q.chain_key, q.chain_label, q.decides, q.reads, q.chain_steps,
         q.ends_at, q.change_cost, q.caveat, q.verified_at,
         count(*) over (partition by q.chain_key),
         s.srcs
  from bot.question_traces q
  left join lateral (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'key', k.key, 'name', k.name, 'kind', k.kind,
          'wiring', k.wiring, 'url', k.url, 'last_used_at', k.last_used_at
        ) order by k.sort_order
      ), '[]'::jsonb) as srcs
    from bot.knowledge_sources k
    where k.key = any(q.ultimate_source_keys)
  ) s on true
  order by q.sort_order, q.key;
$function$;

comment on function bot.question_traces_view is
  'The traces, with a per-chain question count and the ultimate source artefacts resolved from bot.knowledge_sources. A source is joined, never copied, so renaming one in the register renames it here too.';

-- Re-seed:  node tools/questions/build.js && node tools/questions/seed.js
