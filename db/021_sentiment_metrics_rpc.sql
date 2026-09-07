-- Everything the Evelyn Ops sentiment dashboard needs for a date range, in one
-- round trip. The date filtering lives here rather than in the app so the
-- "which day does a conversation belong to?" rule is defined once: a
-- conversation belongs to the day of its FIRST message, matching
-- bot.sentiment_daily.
--
-- Coverage is returned alongside the mix deliberately. While the 30-day
-- backfill runs, older days sit at single-digit coverage and their percentages
-- are meaningless — one day briefly read "100% negative" off two conversations.
-- The dashboard needs coverage in the same payload so it can refuse to imply a
-- trend it cannot support.
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
    -- Low confidence is worth surfacing: a mix built mostly from 'low' rows is
    -- a weaker claim than the same mix built from 'high' ones.
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
  'Sentiment totals, mix, coverage and chat-only-vs-ticket split for a date range. Coverage travels with the mix so a partially scored range cannot be read as a trend.';

-- The worst conversations in a range, for the "worth reading" list.
--
-- Ranged on the CONVERSATION's date, not on scored_at. Filtering by scored_at
-- looked fine while backfilling (everything was scored today) but is wrong:
-- picking "last 7 days" would surface month-old conversations that merely
-- happened to be scored this week.
create or replace function bot.sentiment_worst(
  p_from  date,
  p_to    date,
  p_limit integer default 25
)
returns table (
  session_id       uuid,
  day              date,
  member           text,
  sentiment        text,
  score            smallint,
  confidence       text,
  rationale        text,
  pushed_ticket_id text
)
language sql
stable
as $$
  with conv as (
    select m.session_id, min(m.created_at)::date as day
    from bot.conversation_messages m
    group by m.session_id
  )
  select cs.session_id,
         c.day,
         cu.display_name,
         cs.sentiment,
         cs.score,
         cs.confidence,
         cs.rationale,
         cs.pushed_ticket_id
  from bot.conversation_sentiment cs
  join conv c on c.session_id = cs.session_id
  left join bot.sessions s  on s.id = cs.session_id
  left join bot.customers cu on cu.id = s.customer_id
  where c.day between p_from and p_to
    and cs.score <= 2
  order by cs.score asc, c.day desc
  limit p_limit;
$$;

comment on function bot.sentiment_worst is
  'Frustrated/Angry conversations in a date range, ranged on the conversation date rather than when it was scored.';
