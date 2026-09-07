-- Sentiment per conversation, plus a record of what we pushed to Freshdesk.
--
-- Asked for 7 Sep 2026: a sentiment metric on every conversation, and on the
-- ticket when one is created. The Freshdesk field cf_evelyn_bot_sentiment
-- (custom_dropdown, id 103001313660) already exists with exactly these five
-- choices; the CHECK below is deliberately the same list so a value that could
-- not be written to Freshdesk cannot be stored here either.
--
-- One row per session, not per ticket: 59% of conversations never produce a
-- ticket, and bot.tickets holds one row per SUBMIT ATTEMPT (several rows can
-- share one Freshdesk id), so it is the wrong grain to hang this off.

create table if not exists bot.conversation_sentiment (
  session_id            uuid primary key references bot.sessions(id) on delete cascade,

  -- The five Freshdesk choices, in order. `score` carries the same thing as a
  -- number so it can be averaged and trended; text alone cannot be.
  sentiment             text not null check (sentiment in ('Happy','Satisfied','Neutral','Frustrated','Angry')),
  score                 smallint not null check (score between 1 and 5),

  confidence            text check (confidence in ('high','medium','low')),
  -- One short sentence naming the evidence in the transcript. Kept because a
  -- score with no reason behind it cannot be audited or argued with.
  rationale             text,

  model                 text,
  scored_at             timestamptz not null default now(),
  -- How much of the conversation had happened when we scored it. A session with
  -- more messages than this has moved on and is due a re-score.
  scored_message_count  integer not null default 0,

  -- What we actually wrote to Freshdesk, so the re-score pass can tell its own
  -- value from a human's. If the live field no longer equals pushed_value, a
  -- person has edited it and we must never overwrite that.
  pushed_value          text,
  pushed_ticket_id      text,
  pushed_at             timestamptz,

  -- Set when a human's value in Freshdesk is seen to differ from ours. Kept for
  -- measuring agreement between the model and Member Care.
  human_value           text,
  human_seen_at         timestamptz
);

comment on table bot.conversation_sentiment is
  'One sentiment score per conversation. pushed_* records what was written to Freshdesk cf_evelyn_bot_sentiment so a human edit is never clobbered.';

create index if not exists conversation_sentiment_scored_idx
  on bot.conversation_sentiment (scored_at desc);
create index if not exists conversation_sentiment_sentiment_idx
  on bot.conversation_sentiment (sentiment, scored_at desc);

-- ---------------------------------------------------------------------------
-- Which sessions need scoring?
--
-- Either never scored, or scored when the conversation was shorter than it is
-- now. `p_quiet_minutes` keeps live conversations out of the batch: scoring a
-- chat that is still going produces a value that is wrong minutes later, which
-- is the same mistake the auto-submit watchdog was built to avoid.
-- ---------------------------------------------------------------------------
create or replace function bot.sentiment_backlog(
  p_limit         integer default 200,
  p_quiet_minutes integer default 10,
  p_max_age_days  integer default 30
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
  where c.last_message_at < now() - make_interval(mins => p_quiet_minutes)
    -- A single member message is a bounce, not a conversation worth scoring.
    and c.user_msgs >= 1
    and (cs.session_id is null or c.message_count > cs.scored_message_count)
  order by c.last_message_at desc
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Upsert a score. Deliberately does NOT clear pushed_* — the Freshdesk write
-- and the scoring are separate steps and the push record must survive a
-- re-score, otherwise the "did a human change it?" check loses its baseline.
-- ---------------------------------------------------------------------------
create or replace function bot.record_sentiment(
  p_session_id     uuid,
  p_sentiment      text,
  p_confidence     text,
  p_rationale      text,
  p_model          text,
  p_message_count  integer
)
returns bot.conversation_sentiment
language plpgsql
as $$
declare
  v_score smallint;
  v_row   bot.conversation_sentiment;
begin
  v_score := case p_sentiment
               when 'Happy'      then 5
               when 'Satisfied'  then 4
               when 'Neutral'    then 3
               when 'Frustrated' then 2
               when 'Angry'      then 1
             end;
  if v_score is null then
    raise exception 'record_sentiment: unknown sentiment %', p_sentiment;
  end if;

  insert into bot.conversation_sentiment as cs
    (session_id, sentiment, score, confidence, rationale, model, scored_at, scored_message_count)
  values
    (p_session_id, p_sentiment, v_score, p_confidence, p_rationale, p_model, now(), coalesce(p_message_count,0))
  on conflict (session_id) do update
    set sentiment            = excluded.sentiment,
        score                = excluded.score,
        confidence           = excluded.confidence,
        rationale            = excluded.rationale,
        model                = excluded.model,
        scored_at            = excluded.scored_at,
        scored_message_count = excluded.scored_message_count
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Record a Freshdesk write, or a human override we have observed.
-- ---------------------------------------------------------------------------
create or replace function bot.record_sentiment_push(
  p_session_id uuid,
  p_ticket_id  text,
  p_value      text
)
returns void
language sql
as $$
  update bot.conversation_sentiment
     set pushed_value = p_value,
         pushed_ticket_id = p_ticket_id,
         pushed_at = now()
   where session_id = p_session_id;
$$;

create or replace function bot.record_sentiment_human(
  p_session_id uuid,
  p_value      text
)
returns void
language sql
as $$
  update bot.conversation_sentiment
     set human_value = p_value,
         human_seen_at = now()
   where session_id = p_session_id;
$$;
