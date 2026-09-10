-- Phase 1 of the Evelyn performance scorecard: eight deterministic defect
-- classes and a clean rate.
--
-- WHY DETERMINISTIC
-- Because the question this has to answer is "did our fixes help?", and that
-- needs a metric that can be RECOMPUTED OVER ALL HISTORY. Change the definition
-- and every past week rebuilds consistently, so the baseline never shifts under
-- you. An LLM score cannot do that: re-scoring costs money and returns
-- different answers each time, which is exactly how the sentiment metric ended
-- up unable to support a before/after claim.
--
-- Every class here is countable from the transcript. The only judgement in the
-- whole scorecard is "did the bot actually answer?", and that is settled once,
-- in bot.is_substantive_answer (db/028), against a labelled template table.
--
-- SUPERSEDES bot.conversation_friction (db/026, db/027). Its three signals are
-- classes 1-3 here. The old table is dropped in db/030 once the readers have
-- been repointed - not here, so the two migrations can be applied separately
-- without the dashboard breaking in between.
--
-- MEASURED over the 7 days to 9 Sep 2026 while building this: wrong_language
-- fires on 1 session in 1,953. It is kept anyway, as a regression tripwire -
-- the bot mirrors language well today and we want to know immediately if that
-- stops being true. Do not read a near-zero class as a broken class.

create table if not exists bot.conversation_defects (
  session_id            uuid primary key,
  day                   date not null,
  msg_count             integer not null default 0,
  user_msgs             integer not null default 0,
  answers               integer not null default 0,
  -- The eight classes. Each is a named failure with an owner and a fix path;
  -- the headline "clean rate" is simply the absence of all of them.
  no_answer             boolean not null default false,
  repeated_reply        boolean not null default false,
  asked_for_human       boolean not null default false,
  auth_deadend          boolean not null default false,
  abandoned_mid_ticket  boolean not null default false,
  duplicate_ticket      boolean not null default false,
  wrong_language        boolean not null default false,
  link_only             boolean not null default false,
  repeated_max          integer not null default 0,
  defects               text[]  not null default '{}',
  is_clean              boolean not null default true,
  computed_at           timestamptz not null default now()
);

comment on table bot.conversation_defects is
  'One row per conversation with its deterministic defect flags. Unlike bot.conversation_friction, CLEAN conversations are stored too - the clean rate is the headline, so the denominator has to be in the table. Written by bot.refresh_conversation_defects; rules live in bot.compute_conversation_defects.';

create index if not exists conversation_defects_day_idx on bot.conversation_defects (day desc);
create index if not exists conversation_defects_clean_idx on bot.conversation_defects (is_clean, day desc);

-- ---------------------------------------------------------------------------
-- The rules, in one place.
-- ---------------------------------------------------------------------------
create or replace function bot.compute_conversation_defects(
  p_from date,
  p_to   date
)
returns table (
  session_id uuid, day date, msg_count integer, user_msgs integer, answers integer,
  no_answer boolean, repeated_reply boolean, asked_for_human boolean,
  auth_deadend boolean, abandoned_mid_ticket boolean, duplicate_ticket boolean,
  wrong_language boolean, link_only boolean, repeated_max integer,
  defects text[], is_clean boolean
)
language sql
stable
as $$
  with conv as (
    select m.session_id, min(m.created_at)::date as day
    from bot.conversation_messages m
    group by m.session_id
  ),
  scoped as (select session_id, day from conv where day between p_from and p_to),
  -- MATERIALIZED: every class below needs message CONTENT, and without this the
  -- planner re-fetches the same heap pages once per class.
  msg as materialized (
    select m.session_id, m.role, btrim(m.content) as content,
           bot.is_substantive_answer(m.content) as is_answer
    from bot.conversation_messages m
    join scoped s on s.session_id = m.session_id
    where m.content is not null
  ),
  -- 2. LOOP. Exact match after whitespace/case normalisation; the 60-char floor
  -- keeps short closers out. Ticket previews keep the THIRD-send threshold,
  -- because re-showing an unchanged preview is correct behaviour.
  sig as (
    select session_id,
           md5(lower(regexp_replace(content, '\s+', ' ', 'g'))) as sig,
           (content ~ '📋' or content ~* '(yes|ja)[^.?!]{0,25}(submit|in\s*te\s*dienen|indienen)') as is_preview,
           count(*) as times
    from msg where role = 'assistant' and length(content) > 60
    group by 1, 2, 3
  ),
  rep as (
    select session_id,
           coalesce(max(times) filter (where not is_preview), 0) as max_plain,
           coalesce(max(times) filter (where is_preview), 0)     as max_preview
    from sig group by 1
  ),
  -- 3. ASKED FOR HUMAN. Matched in BOTH word orders - Dutch puts the verb last
  -- ("Ik wil een medewerker spreken") and a verb-first pattern misses most of
  -- the Dutch requests.
  human as (
    select distinct session_id from msg
    where role = 'user'
      and content ~* '(speak|talk|spreken|bellen|call|contact)[^.?!]{0,30}'
                     '(human|person|someone|somebody|agent|assistant|medewerker|medewerkster|iemand|klantenservice)'
                  '|(human|person|someone|somebody|agent|assistant|medewerker|medewerkster|iemand|klantenservice)'
                     '[^.?!]{0,30}(speak|talk|spreken|bellen|call|contact)'
                  '|live (agent|assistant|person|rep|support)|real (person|human)'
                  '|echt (persoon|mens)|met een mens|telefoonnummer|phone number|connect me'
  ),
  -- 7. WRONG LANGUAGE. Deliberately strict: the member must be UNAMBIGUOUSLY in
  -- one language (markers present, none of the other) and a substantive answer
  -- unambiguously in the other. A looser rule would flag the many chats that
  -- legitimately mix. Currently fires on ~1 session in 2,000.
  lang as (
    select session_id,
      count(*) filter (where role='user' and content ~* '\y(ik|niet|een|het|mijn|graag|wil|hoe|waar|bedankt|alsjeblieft)\y') as u_nl,
      count(*) filter (where role='user' and content ~* '\y(the|you|your|my|can|please|how|where|thanks|want)\y')            as u_en,
      count(*) filter (where role='assistant' and is_answer and content ~* '\y(je|jouw|niet|het|een|kun|kan|graag)\y')       as a_nl,
      count(*) filter (where role='assistant' and is_answer and content ~* '\y(the|your|you|can|please|and)\y')              as a_en
    from msg group by 1
  ),
  counts as (
    select session_id,
      count(*)::int                                            as msg_count,
      count(*) filter (where role='user')::int                 as user_msgs,
      count(*) filter (where is_answer)::int                   as answers,
      -- 8. LINK ONLY: handed over a self-service form and answered nothing.
      bool_or(role='assistant' and content ~* '(ticket_form=|/support/tickets/new|extend-your-membership)') as sent_link
    from msg group by 1
  ),
  tick as (
    select t.session_id,
           count(distinct t.external_ticket_id) filter (where t.external_ticket_id is not null)::int as fd_tickets
    from bot.tickets t
    join scoped s on s.session_id = t.session_id
    group by 1
  ),
  flags as (
    select s.session_id, s.day,
      coalesce(c.msg_count,0) as msg_count,
      coalesce(c.user_msgs,0) as user_msgs,
      coalesce(c.answers,0)   as answers,
      -- 1. NO ANSWER. The 4-member-turn floor separates "kept trying and got
      -- nothing" from someone who typed once and closed the tab.
      (coalesce(c.answers,0) = 0 and coalesce(c.user_msgs,0) >= 4) as no_answer,
      (coalesce(r.max_plain,0) >= 2 or coalesce(r.max_preview,0) >= 3) as repeated_reply,
      (h.session_id is not null) as asked_for_human,
      -- 4. AUTH DEAD-END: ended in the login flow AND never got an answer.
      -- The "and never got an answer" half is essential and was missing in the
      -- first version: of 566 sessions ending in awaiting_email, 452 HAD been
      -- answered substantively. Those are non-members who asked a general
      -- question, got a real reply, and simply never logged in — a success, not
      -- a dead-end. Without the second clause this class flagged 678
      -- conversations (35% of the week) and made the clean rate meaningless.
      (sess.state in ('awaiting_email','awaiting_otp','awaiting_studio_selection',
                      'awaiting_studio_selection_verified')
        and coalesce(c.answers,0) = 0) as auth_deadend,
      -- 5. ABANDONED MID-TICKET: a draft was open and no ticket ever reached
      -- Freshdesk. The member did the work of describing their problem and it
      -- went nowhere.
      (sess.current_ticket_draft_id is not null and coalesce(t.fd_tickets,0) = 0) as abandoned_mid_ticket,
      -- 6. DUPLICATE: two distinct Freshdesk tickets out of one chat. Counted on
      -- DISTINCT external id because bot.tickets holds one row per submit
      -- ATTEMPT, so several rows legitimately share an id.
      (coalesce(t.fd_tickets,0) >= 2) as duplicate_ticket,
      ((l.u_nl >= 2 and l.u_en = 0 and l.a_en >= 1 and l.a_nl = 0)
        or (l.u_en >= 2 and l.u_nl = 0 and l.a_nl >= 1 and l.a_en = 0)) as wrong_language,
      (coalesce(c.sent_link,false) and coalesce(c.answers,0) = 0) as link_only,
      case when coalesce(r.max_plain,0) >= 2 then coalesce(r.max_plain,0)
           when coalesce(r.max_preview,0) >= 3 then coalesce(r.max_preview,0)
           else 0 end as repeated_max
    from scoped s
    left join counts c    on c.session_id = s.session_id
    left join rep r       on r.session_id = s.session_id
    left join human h     on h.session_id = s.session_id
    left join lang l      on l.session_id = s.session_id
    left join tick t      on t.session_id = s.session_id
    left join bot.sessions sess on sess.id = s.session_id
  )
  select f.session_id, f.day, f.msg_count, f.user_msgs, f.answers,
         f.no_answer, f.repeated_reply, f.asked_for_human, f.auth_deadend,
         f.abandoned_mid_ticket, f.duplicate_ticket, f.wrong_language, f.link_only,
         f.repeated_max,
         array_remove(array[
           case when f.no_answer            then 'no_answer'::text            end,
           case when f.repeated_reply       then 'loop'::text                 end,
           case when f.asked_for_human      then 'asked_for_human'::text      end,
           case when f.auth_deadend         then 'auth_deadend'::text         end,
           case when f.abandoned_mid_ticket then 'abandoned_mid_ticket'::text end,
           case when f.duplicate_ticket     then 'duplicate_ticket'::text     end,
           case when f.wrong_language       then 'wrong_language'::text       end,
           case when f.link_only            then 'link_only'::text            end
         ], null),
         not (f.no_answer or f.repeated_reply or f.asked_for_human or f.auth_deadend
              or f.abandoned_mid_ticket or f.duplicate_ticket or f.wrong_language
              or f.link_only)
  from flags f;
$$;

comment on function bot.compute_conversation_defects is
  'The eight deterministic defect rules for one date range. Single source of truth: bot.refresh_conversation_defects materialises this, nothing reimplements it.';

-- ---------------------------------------------------------------------------
-- Delete-then-insert per window, NOT upsert: a conversation can stop being
-- defective (a chat caught mid-flight looked like a loop; the next turn
-- resolved it), and an upsert would leave the stale flag behind forever.
-- ---------------------------------------------------------------------------
create or replace function bot.refresh_conversation_defects(
  p_days integer default 7
)
returns table (window_days integer, sessions integer, clean integer)
language plpgsql
as $$
declare
  v_from date := (current_date - greatest(p_days, 0));
  v_to   date := current_date;
  v_n    integer;
begin
  delete from bot.conversation_defects where day between v_from and v_to;

  insert into bot.conversation_defects (
    session_id, day, msg_count, user_msgs, answers, no_answer, repeated_reply,
    asked_for_human, auth_deadend, abandoned_mid_ticket, duplicate_ticket,
    wrong_language, link_only, repeated_max, defects, is_clean, computed_at)
  select d.session_id, d.day, d.msg_count, d.user_msgs, d.answers, d.no_answer,
         d.repeated_reply, d.asked_for_human, d.auth_deadend, d.abandoned_mid_ticket,
         d.duplicate_ticket, d.wrong_language, d.link_only, d.repeated_max,
         d.defects, d.is_clean, now()
  from bot.compute_conversation_defects(v_from, v_to) d;

  get diagnostics v_n = row_count;
  return query select p_days, v_n,
    (select count(*)::int from bot.conversation_defects
     where day between v_from and v_to and is_clean);
end;
$$;

comment on function bot.refresh_conversation_defects is
  'Recompute bot.conversation_defects for the last p_days. Delete-then-insert so a conversation that stops being defective loses its flags. RETURNS TABLE, never a scalar, because PostgREST renders a scalar as a bare JSON string and n8n rejects it.';

-- ---------------------------------------------------------------------------
-- Everything the scorecard page needs, in one round trip.
-- ---------------------------------------------------------------------------
create or replace function bot.performance_metrics(
  p_from date,
  p_to   date
)
returns jsonb
language sql
stable
as $$
  with d as (
    select * from bot.conversation_defects where day between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'conversations', (select count(*) from d),
    'clean',         (select count(*) from d where is_clean),
    'clean_pct',     (select round(100.0 * count(*) filter (where is_clean)
                                   / nullif(count(*), 0), 1) from d),
    'answered',      (select count(*) from d where answers > 0),
    'answered_pct',  (select round(100.0 * count(*) filter (where answers > 0)
                                   / nullif(count(*), 0), 1) from d),
    -- Ranked worst-first: this is the work queue, so the order is the point.
    'defects', coalesce((
      select jsonb_agg(x order by x.n desc) from (
        select 'no_answer' as class, count(*) filter (where no_answer) as n from d
        union all select 'loop',                 count(*) filter (where repeated_reply) from d
        union all select 'asked_for_human',      count(*) filter (where asked_for_human) from d
        union all select 'auth_deadend',         count(*) filter (where auth_deadend) from d
        union all select 'abandoned_mid_ticket', count(*) filter (where abandoned_mid_ticket) from d
        union all select 'duplicate_ticket',     count(*) filter (where duplicate_ticket) from d
        union all select 'wrong_language',       count(*) filter (where wrong_language) from d
        union all select 'link_only',            count(*) filter (where link_only) from d
      ) x), '[]'::jsonb),
    -- Daily series, so a fix can be annotated against the class it targeted.
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object(
               'day', day, 'conversations', n, 'clean', c,
               'clean_pct', round(100.0 * c / nullif(n, 0), 1)) order by day)
      from (select day, count(*) n, count(*) filter (where is_clean) c
            from d group by day) s), '[]'::jsonb),
    'last_computed', (select max(computed_at) from d)
  );
$$;

comment on function bot.performance_metrics is
  'Clean rate, answered rate, the eight defect counts ranked worst-first, and a daily series, for one date range. Reads the precomputed bot.conversation_defects - never recomputes over transcripts on a page load.';
