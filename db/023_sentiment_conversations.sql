-- Filterable conversation list for the sentiment dashboard.
--
-- Supersedes bot.sentiment_worst, which hardcoded score <= 2. Same ranging
-- rule: on the CONVERSATION's date (its first message), never on scored_at —
-- filtering by when we happened to score something surfaces month-old chats in
-- a "last 7 days" view, which is what the first version of this did.
--
-- p_sentiment:
--   null        -> negative only (score <= 2). The default "worth reading" list.
--   'all'       -> every scored conversation in the range.
--   a value     -> just that value.
--
-- Also returns whether the conversation already has a feedback entry, so the
-- dashboard can show "raised" instead of offering to raise it twice. Computed
-- here rather than by pulling every feedback session_id into the app, which is
-- what the evaluation page does and does not scale.
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
  has_feedback     boolean
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
         cs.pushed_ticket_id,
         exists (select 1 from bot.conversation_feedback f
                 where f.session_id = cs.session_id)
  from bot.conversation_sentiment cs
  join conv c on c.session_id = cs.session_id
  left join bot.sessions  s  on s.id = cs.session_id
  left join bot.customers cu on cu.id = s.customer_id
  where c.day between p_from and p_to
    and (
      p_sentiment is null       and cs.score <= 2
      or lower(p_sentiment) = 'all'
      or cs.sentiment = p_sentiment
    )
  -- Worst-first ONLY for the default negative list, where the point is triage.
  -- For an explicit filter the first key is constant so it falls through to
  -- newest-first: ordering 'all' by score would show nothing but negatives
  -- until the limit ran out.
  order by case when p_sentiment is null then cs.score end asc nulls last,
           c.day desc,
           cs.score asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function bot.sentiment_conversations is
  'Scored conversations in a date range, optionally filtered to one sentiment (null = negative only, ''all'' = everything). Ranged on the conversation date, and flags whether feedback was already raised.';
