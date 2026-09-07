-- 1) Bound repeated scoring failures.  2) Aggregates for the Evelyn Ops metrics
--    section.
--
-- Why a separate failures table rather than a column on conversation_sentiment:
-- when scoring fails we deliberately do NOT write a sentiment row (storing a
-- wrong Neutral is worse than storing nothing), and `sentiment` is NOT NULL.
-- So the attempt counter has nowhere to live on that table.
--
-- This exists because session 7e22916f fails the model call reproducibly — 4+
-- attempts, cause unknown: no braces, no control characters, 7.1KB, and both of
-- its HTTP calls succeed by hand. Without a bound it would be re-attempted
-- every cycle forever, roughly 96 wasted model calls a day for one session.

create table if not exists bot.sentiment_failures (
  session_id   uuid primary key references bot.sessions(id) on delete cascade,
  attempts     integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at  timestamptz not null default now(),
  last_reason  text
);

comment on table bot.sentiment_failures is
  'Scoring attempts that produced nothing usable. sentiment_backlog stops offering a session once attempts >= 3, so one pathological conversation cannot become a hot loop.';

create or replace function bot.record_sentiment_failure(
  p_session_id uuid,
  p_reason     text default null
)
returns integer
language plpgsql
as $$
declare v_attempts integer;
begin
  insert into bot.sentiment_failures as sf (session_id, attempts, last_reason)
  values (p_session_id, 1, left(coalesce(p_reason,''), 300))
  on conflict (session_id) do update
    set attempts       = sf.attempts + 1,
        last_failed_at = now(),
        last_reason    = left(coalesce(p_reason, sf.last_reason), 300)
  returning attempts into v_attempts;
  return v_attempts;
end;
$$;

-- Backlog, now excluding sessions that have failed too often. Same contract as
-- before otherwise: never scored, or scored when the conversation was shorter,
-- and never a conversation that is still live.
--
-- The old 3-arg signature MUST be dropped, not just replaced: adding a 4th
-- argument with a default creates an overload, and calling it with three
-- arguments then fails with "function is not unique" — including from
-- PostgREST, which is how the n8n batch reaches it.
drop function if exists bot.sentiment_backlog(integer, integer, integer);

create or replace function bot.sentiment_backlog(
  p_limit         integer default 200,
  p_quiet_minutes integer default 10,
  p_max_age_days  integer default 30,
  p_max_attempts  integer default 3
)
returns table (
  session_id     uuid,
  message_count  integer,
  last_message_at timestamptz,
  already_scored_at_count integer
)
language sql
stable
as $$
  with conv as (
    select m.session_id,
           count(*)::int                        as message_count,
           max(m.created_at)                    as last_message_at,
           count(*) filter (where m.role='user') as user_msgs
    from bot.conversation_messages m
    where m.created_at > now() - make_interval(days => p_max_age_days)
    group by m.session_id
  )
  select c.session_id,
         c.message_count,
         c.last_message_at,
         coalesce(cs.scored_message_count, 0)
  from conv c
  left join bot.conversation_sentiment cs on cs.session_id = c.session_id
  left join bot.sentiment_failures     sf on sf.session_id = c.session_id
  where c.last_message_at < now() - make_interval(mins => p_quiet_minutes)
    and c.user_msgs >= 1
    and (cs.session_id is null or c.message_count > cs.scored_message_count)
    and coalesce(sf.attempts, 0) < p_max_attempts
  order by c.last_message_at desc
  limit p_limit;
$$;

-- A successful score clears any failure history for that session, so a
-- transient failure never counts against it permanently.
create or replace function bot.clear_sentiment_failure(p_session_id uuid)
returns void
language sql
as $$
  delete from bot.sentiment_failures where session_id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- METRICS for the Evelyn Ops section.
--
-- Deliberately reports coverage alongside the mix: a sentiment breakdown over
-- an unknown fraction of conversations invites reading a sampling artefact as a
-- trend. `scored_pct` is what tells you whether a day's mix can be trusted.
-- ---------------------------------------------------------------------------
create or replace view bot.sentiment_daily as
with conv as (
  select m.session_id, min(m.created_at)::date as day
  from bot.conversation_messages m
  group by m.session_id
)
select c.day,
       count(*)                                                      as conversations,
       count(cs.session_id)                                          as scored,
       round(100.0 * count(cs.session_id) / nullif(count(*),0), 1)    as scored_pct,
       round(avg(cs.score), 2)                                       as avg_score,
       count(*) filter (where cs.sentiment = 'Happy')                 as happy,
       count(*) filter (where cs.sentiment = 'Satisfied')             as satisfied,
       count(*) filter (where cs.sentiment = 'Neutral')               as neutral,
       count(*) filter (where cs.sentiment = 'Frustrated')            as frustrated,
       count(*) filter (where cs.sentiment = 'Angry')                 as angry,
       count(*) filter (where cs.score <= 2)                          as negative,
       round(100.0 * count(*) filter (where cs.score <= 2)
             / nullif(count(cs.session_id),0), 1)                     as negative_pct_of_scored
from conv c
left join bot.conversation_sentiment cs on cs.session_id = c.session_id
group by c.day
order by c.day desc;

comment on view bot.sentiment_daily is
  'Daily sentiment mix with coverage. Read negative_pct_of_scored together with scored_pct: a low coverage day cannot support a trend claim.';

-- Sentiment split by whether the conversation produced a bot ticket. This is
-- the comparison worth showing: it says whether the chats we hand to Member
-- Care are the unhappy ones.
create or replace view bot.sentiment_by_outcome as
select case when t.session_id is null then 'chat only' else 'filed a ticket' end as outcome,
       count(*)                                            as scored_conversations,
       round(avg(cs.score), 2)                             as avg_score,
       count(*) filter (where cs.score <= 2)               as negative,
       round(100.0 * count(*) filter (where cs.score <= 2)
             / nullif(count(*),0), 1)                      as negative_pct
from bot.conversation_sentiment cs
left join (select distinct session_id from bot.tickets) t on t.session_id = cs.session_id
group by 1;

-- ---------------------------------------------------------------------------
-- Single write path for a scoring attempt.
--
-- Added after the n8n MCP would not attach a node to an IF node's FALSE output:
-- `sourceOutputIndex` and `outputIndex` were both silently ignored and BOTH
-- targets landed on output 0. The effect was subtle and bad — on a successful
-- score both branches ran, and on a failure neither did, so failures recorded
-- nothing at all. Deciding in SQL removes the branch, and with it that whole
-- class of mistake.
-- ---------------------------------------------------------------------------
create or replace function bot.apply_sentiment_result(
  p_session_id    uuid,
  p_parser_ok     boolean,
  p_sentiment     text,
  p_confidence    text,
  p_rationale     text,
  p_model         text,
  p_message_count integer
)
returns jsonb
language plpgsql
as $$
declare v_attempts integer;
begin
  if coalesce(p_parser_ok, false) then
    perform bot.record_sentiment(p_session_id, p_sentiment, p_confidence,
                                 p_rationale, p_model, p_message_count);
    delete from bot.sentiment_failures where session_id = p_session_id;
    return jsonb_build_object('stored', true, 'sentiment', p_sentiment);
  else
    v_attempts := bot.record_sentiment_failure(p_session_id, 'model returned nothing usable');
    return jsonb_build_object('stored', false, 'attempts', v_attempts);
  end if;
end;
$$;

comment on function bot.apply_sentiment_result is
  'Single write path for a scoring attempt: stores the sentiment and clears any failure history, or counts a failure. Never stores a guessed sentiment.';
