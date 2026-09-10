-- The Evelyn case library: every case the bot handles, what it does about it,
-- and where the answer comes from.
--
-- WHY THIS IS NOT THE SCENARIO LIBRARY
-- /scenarios (db/024) covers RECOGNITION: which regex matches which member
-- message, with real examples and measured misfire rates. Its `source` field
-- means "which n8n node holds the recogniser".
--
-- This table covers everything after that: what the bot DOES, the process
-- behind it, and the SOURCE OF TRUTH for the content — which is a different
-- and mostly undocumented thing. The two are complementary and deliberately
-- kept apart; merging them would put a regex and a Magicline endpoint in the
-- same column.
--
-- WHY A TABLE AND NOT A DOC
-- Because the rows are content that Member Care must be able to correct
-- without a deploy, exactly like bot.reply_templates. A markdown file would be
-- accurate on the day it was written and wrong a fortnight later, with no
-- signal that it had drifted.
--
-- HONEST LIMIT: the descriptive columns are HAND-WRITTEN from reading the live
-- workflows on 10 Sep 2026. They do not auto-update. `verified_at` records when
-- each row was last checked against the workflow, and the page surfaces the
-- oldest one, so staleness is visible rather than silent. Counts, by contrast,
-- are computed live.

create table if not exists bot.case_library (
  key           text primary key,
  sort_order    integer not null default 100,
  area          text not null,
  trigger_label text not null,
  trigger_detail text,
  action_type   text not null,
  action_summary text not null,
  process_steps text[] not null default '{}',
  source_kind   text not null,
  source_detail text,
  workflow      text,
  known_issues  text,
  verified_at   date not null default current_date,
  constraint case_library_area_ck check (area in (
    'Pre-login', 'Authentication', 'Account questions', 'Self-service redirect',
    'Ticketing', 'Guardrails', 'Dead ends'
  )),
  constraint case_library_action_ck check (action_type in (
    'answer',    -- states a fact from a source
    'link',      -- hands over a URL and stops
    'ticket',    -- collects details and files a Freshdesk ticket
    'process',   -- performs a real action (a write) or runs a multi-step flow
    'refuse',    -- declines, in scope terms
    'handoff',   -- routes to a human / captures a lead
    'block',     -- a guardrail overriding what the model would otherwise say
    'dead_end'   -- the member gets nothing useful
  )),
  constraint case_library_source_ck check (source_kind in (
    'club_directory',  -- bot.public_locations <- bot.locations <- the reference sheet
    'magicline',       -- live account data via the Magicline API
    'prompt',          -- knowledge hardcoded in an n8n system prompt
    'faq_vector',      -- the Supabase vector store searched by the Q&A agent
    'freshdesk_form',  -- a customer-facing Freshdesk ticket form
    'freshdesk_api',   -- read or written through the Freshdesk API
    'guardrail',       -- a code-gated block injected into the prompt
    'database',        -- a bot.* table
    'none'             -- no source: boilerplate, a refusal, or a failure path
  ))
);

comment on table bot.case_library is
  'Every case Evelyn handles: trigger -> what she does -> the process -> the source of truth. Complements /scenarios, which covers recognition only. Descriptive columns are hand-written from the live workflows and carry verified_at; counts are computed live by bot.case_library_view.';

create index if not exists case_library_area_idx on bot.case_library (area, sort_order);

-- ---------------------------------------------------------------------------
-- WHERE THE ROWS LIVE
--
-- The 55 seeded cases are NOT in this file. They were inserted directly and
-- live only in the database, deliberately: they are editable CONTENT, the same
-- call as bot.reply_templates. Member Care correcting a description with an
-- UPDATE is the main way this library becomes accurate, and a copy in version
-- control would diverge from the edited rows within days while looking
-- authoritative.
--
-- The cost of that choice, stated plainly: a fresh environment gets an empty
-- table, and the content is only as safe as the database backups. If the
-- library ever needs to be reproducible from the repo, dump it with:
--   select * from bot.case_library order by sort_order;
-- ---------------------------------------------------------------------------

-- Serves the library with LIVE counts attached where a case is countable.
-- Prose is hand-written and dated by verified_at; the numbers are recomputed
-- on every call. Cases with no countable signal return null, never 0 —
-- reporting "0" for something we cannot measure reads as "this never happens",
-- which is the more damaging error.
create or replace function bot.case_library_view(p_days integer default 30)
returns table (
  key text, sort_order integer, area text,
  trigger_label text, trigger_detail text,
  action_type text, action_summary text, process_steps text[],
  source_kind text, source_detail text, workflow text,
  known_issues text, verified_at date,
  refresh_mechanism text, refresh_cadence text, refresh_owner text,
  measured integer, measured_label text
)
language sql
stable
as $$
  with link_sends as (
    select
      count(*) filter (where content ~ 'ticket_form=change_membership_request')  as change_n,
      count(*) filter (where content ~ 'ticket_form=early_cancellation_request') as cancel_n,
      count(*) filter (where content ~ 'ticket_form=membership_extension_request') as ext_n
    from bot.conversation_messages
    where role = 'assistant' and created_at > now() - make_interval(days => p_days)
  ),
  tickets as (
    select count(*)::int as n from bot.tickets
    where created_at > now() - make_interval(days => p_days) and external_ticket_id is not null
  ),
  defects as (
    select
      count(*) filter (where no_answer)::int            as no_answer_n,
      count(*) filter (where auth_deadend)::int         as auth_n,
      count(*) filter (where abandoned_mid_ticket)::int as abandoned_n,
      count(*) filter (where asked_for_human)::int      as human_n,
      count(*) filter (where repeated_reply)::int       as loop_n,
      count(*) filter (where link_only)::int            as link_only_n,
      count(*) filter (where wrong_language)::int       as lang_n,
      count(*) filter (where duplicate_ticket)::int     as dupe_n
    from bot.conversation_defects
    where day > current_date - p_days
  )
  select c.key, c.sort_order, c.area, c.trigger_label, c.trigger_detail,
         c.action_type, c.action_summary, c.process_steps,
         c.source_kind, c.source_detail, c.workflow, c.known_issues, c.verified_at,
         m.n, m.lbl
  from bot.case_library c
  left join lateral (
    select * from (values
      ('ss_change_membership',   (select change_n from link_sends)::int, 'form links sent'),
      ('ss_early_cancellation',  (select cancel_n from link_sends)::int, 'form links sent'),
      ('ss_extension',           (select ext_n    from link_sends)::int, 'form links sent'),
      ('tick_collect',           (select n from tickets),                'tickets filed'),
      ('dead_no_answer',         (select no_answer_n from defects),      'conversations'),
      ('dead_auth_stuck',        (select auth_n from defects),           'conversations'),
      ('dead_abandoned_draft',   (select abandoned_n from defects),      'conversations'),
      ('dead_asked_for_human',   (select human_n from defects),          'conversations'),
      ('guard_repeat_breaker',   (select loop_n from defects),           'conversations still looping'),
      ('dead_wrong_language',    (select lang_n from defects),           'conversations'),
      ('tick_duplicate_guard',   (select dupe_n from defects),           'conversations with 2 tickets')
    ) as v(k, n, lbl)
    where v.k = c.key
  ) m on true
  order by c.sort_order, c.key;
$$;

comment on function bot.case_library_view is
  'The case library with live volumes joined on. Prose is hand-written and dated by verified_at; counts are recomputed per call. Cases with no countable signal return null, never 0.';
