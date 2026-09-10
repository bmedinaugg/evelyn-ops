-- Friction, precomputed.
--
-- WHY
-- db/026 computed friction live inside bot.sentiment_conversations and
-- bot.sentiment_metrics. That was fine at first (1.2s for a 7-day range) but it
-- does not hold:
--   * bot.session_friction alone costs ~2.1s for 7 days, and it scales with the
--     range, so 28 days is ~10s;
--   * bot.sentiment_metrics references the friction CTE seven times;
--   * widening the asked_for_human pattern to catch Dutch noun-then-verb word
--     order ("Ik wil een medewerker spreken") pushed the 28-day metrics call
--     past the statement timeout entirely. It was already borderline before.
-- Recomputing a whole month of transcripts on every dashboard page load was
-- never going to work. Micro-tuning the regex would only move the cliff.
--
-- WHAT
-- bot.conversation_friction holds one row per FLAGGED conversation. Clean
-- conversations are absent, so the table stays small (~1.4k rows per month
-- against ~7.5k conversations) and the reporting functions do an indexed join
-- instead of a scan over every message.
--
-- Refreshed by bot.refresh_conversation_friction(), called from the existing
-- Bot - Sentiment Batch every 10 minutes over a short trailing window. A
-- conversation's friction can only change while the member is still typing, and
-- the sentiment backlog already waits 10 quiet minutes before it will touch a
-- chat, so a 2-day window is generous. The full history is a one-off backfill.
--
-- The definition of friction itself is UNCHANGED and still lives in
-- bot.session_friction (db/026) — this migration only decides when it runs.
-- Keeping one definition matters: a copy that drifted would make the dashboard
-- and the numbers in docs/ disagree with no way to tell which was right.

create table if not exists bot.conversation_friction (
  session_id      uuid primary key,
  repeated_max    integer not null default 0,
  asked_for_human boolean not null default false,
  never_answered  boolean not null default false,
  labels          text[]  not null default '{}',
  computed_at     timestamptz not null default now()
);

comment on table bot.conversation_friction is
  'One row per conversation that measurably went badly (bot repeated itself, member asked for a person, or 4+ member turns with no answer). Written by bot.refresh_conversation_friction; the rules live in bot.session_friction. Clean conversations are absent, not stored as false.';

-- Read path: the dashboard filters by conversation day, which lives in the
-- messages, so this index is what keeps the anti-join cheap once the table
-- grows past a few months.
create index if not exists conversation_friction_computed_idx
  on bot.conversation_friction (computed_at desc);

-- ---------------------------------------------------------------------------
-- Refresh one window. Delete-then-insert rather than upsert, because a session
-- can STOP being flagged: if a chat was caught mid-flight with an apparent
-- loop and the next turn resolved it, an upsert would leave the stale flag
-- behind forever. Scoped to the window so it never touches older rows.
-- ---------------------------------------------------------------------------
create or replace function bot.refresh_conversation_friction(
  p_days integer default 2
)
returns table (window_days integer, flagged integer)
language plpgsql
as $$
declare
  v_from date := (current_date - greatest(p_days, 0));
  v_to   date := current_date;
  v_n    integer;
begin
  with scoped as (
    select m.session_id
    from bot.conversation_messages m
    group by m.session_id
    having min(m.created_at)::date between v_from and v_to
  )
  delete from bot.conversation_friction cf
  using scoped s
  where s.session_id = cf.session_id;

  insert into bot.conversation_friction
    (session_id, repeated_max, asked_for_human, never_answered, labels, computed_at)
  select f.session_id, f.repeated_max, f.asked_for_human, f.never_answered, f.labels, now()
  from bot.session_friction(v_from, v_to) f;

  get diagnostics v_n = row_count;
  return query select p_days, v_n;
end;
$$;

comment on function bot.refresh_conversation_friction is
  'Recompute bot.conversation_friction for conversations that started in the last p_days. Delete-then-insert, so a session that stops being flagged loses its row. Called every 10 minutes by Bot - Sentiment Batch; RETURNS TABLE, never a scalar, because PostgREST renders a scalar as a bare JSON string and n8n rejects it.';

-- ---------------------------------------------------------------------------
-- Point the two reporting functions at the table.
-- Signatures are unchanged, so the app needs no change beyond what db/026
-- already introduced.
-- ---------------------------------------------------------------------------
drop function if exists bot.sentiment_conversations(date, date, text, integer);

create or replace function bot.sentiment_conversations(
  p_from      date,
  p_to        date,
  p_sentiment text default null,
  p_limit     integer default 50
)
returns table (
  session_id       uuid,
  day              date,
  member           text,
  sentiment        text,
  score            smallint,
  confidence       text,
  rationale        text,
  pushed_ticket_id text,
  has_feedback     boolean,
  friction         text[],
  repeated_max     integer
)
language sql
stable
as $$
  with conv as (
    select m.session_id, min(m.created_at)::date as day
    from bot.conversation_messages m
    group by m.session_id
  )
  select c.session_id,
         c.day,
         cu.display_name,
         cs.sentiment,
         cs.score,
         cs.confidence,
         cs.rationale,
         cs.pushed_ticket_id,
         exists (select 1 from bot.conversation_feedback f
                 where f.session_id = c.session_id),
         coalesce(fr.labels, '{}'::text[]),
         coalesce(fr.repeated_max, 0)
  from conv c
  left join bot.conversation_sentiment cs on cs.session_id = c.session_id
  left join bot.conversation_friction  fr on fr.session_id = c.session_id
  left join bot.sessions  s  on s.id = c.session_id
  left join bot.customers cu on cu.id = s.customer_id
  where c.day between p_from and p_to
    and (
      (p_sentiment is null and (cs.score <= 2 or fr.session_id is not null))
      or (lower(p_sentiment) = 'all'      and cs.sentiment is not null)
      or (lower(p_sentiment) = 'friction' and fr.session_id is not null)
      or cs.sentiment = p_sentiment
    )
  order by case when p_sentiment is null then coalesce(cs.score, 3) end asc nulls last,
           c.day desc,
           cs.score asc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function bot.sentiment_conversations is
  'Triage list for the sentiment dashboard: negative sentiment OR measured friction (null), everything scored (''all''), friction only (''friction''), or one sentiment value. Ranged on the conversation date, and flags whether feedback was already raised.';

create or replace function bot.sentiment_metrics(
  p_from date,
  p_to   date
)
returns jsonb
language sql
stable
as $$
  with conv as (
    select m.session_id, min(m.created_at)::date as day
    from bot.conversation_messages m
    group by m.session_id
  ),
  win as (
    select c.session_id, c.day, cs.sentiment, cs.score, cs.confidence
    from conv c
    left join bot.conversation_sentiment cs on cs.session_id = c.session_id
    where c.day between p_from and p_to
  ),
  fr as (
    select f.*
    from bot.conversation_friction f
    join win w on w.session_id = f.session_id
  ),
  outcome as (
    select case when t.session_id is null then 'chat only' else 'filed a ticket' end as outcome,
           count(*)                                  as scored,
           round(avg(w.score), 2)                    as avg_score,
           count(*) filter (where w.score <= 2)      as negative,
           round(100.0 * count(*) filter (where w.score <= 2)
                 / nullif(count(*), 0), 1)           as negative_pct
    from win w
    left join (select distinct session_id from bot.tickets) t on t.session_id = w.session_id
    where w.sentiment is not null
    group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'conversations', (select count(*) from win),
    'scored',        (select count(*) from win where sentiment is not null),
    'scored_pct',    (select round(100.0 * count(*) filter (where sentiment is not null)
                                  / nullif(count(*), 0), 1) from win),
    'avg_score',     (select round(avg(score), 2) from win where sentiment is not null),
    'counts', jsonb_build_object(
      'Happy',      (select count(*) from win where sentiment = 'Happy'),
      'Satisfied',  (select count(*) from win where sentiment = 'Satisfied'),
      'Neutral',    (select count(*) from win where sentiment = 'Neutral'),
      'Frustrated', (select count(*) from win where sentiment = 'Frustrated'),
      'Angry',      (select count(*) from win where sentiment = 'Angry')
    ),
    'negative',      (select count(*) from win where score <= 2),
    'negative_pct_of_scored',
                     (select round(100.0 * count(*) filter (where score <= 2)
                                   / nullif(count(*) filter (where sentiment is not null), 0), 1)
                      from win),
    -- The true UNION of negative sentiment and friction, i.e. exactly what the
    -- default list returns. `negative + calm_but_bad` in the app would
    -- undercount: it misses friction rows with no sentiment score at all.
    'triage_total',  (select count(*) from win w
                      left join bot.conversation_friction f on f.session_id = w.session_id
                      where w.score <= 2 or f.session_id is not null),
    'friction', jsonb_build_object(
      'total',           (select count(*) from fr),
      'pct',             (select round(100.0 * (select count(*) from fr)
                                       / nullif((select count(*) from win), 0), 1)),
      'loop',            (select count(*) from fr where repeated_max > 0),
      'asked_for_human', (select count(*) from fr where asked_for_human),
      'never_answered',  (select count(*) from fr where never_answered),
      -- The case the old rubric could not express: it went badly and the member
      -- stayed calm about it.
      'calm_but_bad',    (select count(*) from fr
                          join win w on w.session_id = fr.session_id
                          where w.score is not null and w.score > 2)
    ),
    'low_confidence',(select count(*) from win where confidence = 'low'),
    'unscored',      (select count(*) from win where sentiment is null),
    'failed',        (select count(*) from bot.sentiment_failures sf
                      join conv c2 on c2.session_id = sf.session_id
                      where c2.day between p_from and p_to),
    'by_outcome',    coalesce((select jsonb_agg(jsonb_build_object(
                        'outcome', outcome, 'scored_conversations', scored,
                        'avg_score', avg_score, 'negative', negative,
                        'negative_pct', negative_pct) order by outcome) from outcome), '[]'::jsonb)
  );
$$;

comment on function bot.sentiment_metrics is
  'Sentiment totals, mix, coverage, friction counts and the chat-only-vs-ticket split for a date range. Coverage travels with the mix so a partially scored range cannot be read as a trend.';
