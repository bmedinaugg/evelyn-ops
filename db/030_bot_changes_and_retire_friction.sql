-- Phase 3 (the feedback -> fix -> measurement loop) and Phase 4 (retire the
-- metrics this supersedes).
--
-- PHASE 3 — WHY
-- Today nothing connects a shipped fix to a number. Feedback arrives, something
-- gets changed, a resolution note is written, and no one can say whether it
-- worked. bot.bot_changes closes that: one row per fix, naming the defect class
-- it targets, so each class becomes a time series with fixes annotated on it.
--
-- THE HONEST CAVEAT, BUILT IN
-- A before/after on a live system is NOT proof. Traffic mix shifts, several
-- fixes land in the same week, seasonality exists. bot.change_impact therefore
-- returns a CONTROL delta alongside the target delta: the movement in every
-- OTHER defect class over the same two windows. If the target fell and the
-- control did not, that is evidence. If both fell, it is probably the traffic.
-- Without that column this becomes a self-congratulation machine, so it is not
-- optional and not hidden behind a flag.
--
-- PHASE 4 — WHAT IS RETIRED
--   bot.conversation_friction / session_friction / refresh_conversation_friction
--     -> absorbed: its three signals are classes 2, 3 and 1 of the scorecard.
--   The /helped page and its helped() heuristic
--     -> retired in the app. It asked the right question ("did the bot help?")
--        and answered it with the wrong evidence (did the member say thanks),
--        which produced 9 conversations a week, and Member Care said those were
--        wrong too.
--   bot.conversation_sentiment
--     -> NOT deleted. Demoted to a column on the scorecard and kept for the
--        Freshdesk push, where "is this member angry?" is the right question for
--        an agent opening a ticket. It is a different metric with a different
--        home, not a failed one.

create table if not exists bot.bot_changes (
  id                  uuid primary key default gen_random_uuid(),
  shipped_at          timestamptz not null,
  title               text not null,
  detail              text,
  -- One of the eight class names, or null for a change that targets none of
  -- them. Declaring the target BEFORE shipping is what stops this becoming a
  -- hunt through eight numbers for one that happened to move.
  target_defect       text,
  source_feedback_ids uuid[],
  source_board_ids    uuid[],
  workflow_id         text,
  workflow_version    text,
  created_by          text,
  created_at          timestamptz not null default now(),
  constraint bot_changes_target_ck check (target_defect is null or target_defect in (
    'no_answer','loop','asked_for_human','auth_deadend',
    'abandoned_mid_ticket','duplicate_ticket','wrong_language','link_only'
  ))
);

comment on table bot.bot_changes is
  'One row per shipped bot fix, naming the defect class it targets and the feedback it came from. Drives bot.change_impact. Declare the target BEFORE shipping - picking it afterwards turns the measurement into a search for whichever number moved.';

create index if not exists bot_changes_shipped_idx on bot.bot_changes (shipped_at desc);

-- ---------------------------------------------------------------------------
-- Before/after per change, with a control.
--
-- Returns null rates rather than zeros when a window has no data: the scorecard
-- only holds the days it has been computed for, and reporting "0%" for a window
-- that simply was not measured would be a lie in the most damaging direction.
-- ---------------------------------------------------------------------------
create or replace function bot.change_impact(p_window_days integer default 14)
returns table (
  id                uuid,
  title             text,
  shipped_at        timestamptz,
  target_defect     text,
  before_conversations integer,
  after_conversations  integer,
  before_rate       numeric,
  after_rate        numeric,
  delta_pp          numeric,
  control_before    numeric,
  control_after     numeric,
  control_delta_pp  numeric,
  verdict           text
)
language sql
stable
as $$
  with c as (
    select * from bot.bot_changes where target_defect is not null
  ),
  w as (
    select c.id, c.title, c.shipped_at, c.target_defect,
           (c.shipped_at::date - p_window_days) as b_from,
           (c.shipped_at::date - 1)             as b_to,
           (c.shipped_at::date)                 as a_from,
           (c.shipped_at::date + p_window_days) as a_to
    from c
  ),
  agg as (
    select w.id, w.title, w.shipped_at, w.target_defect,
      count(*) filter (where d.day between w.b_from and w.b_to)::int as b_n,
      count(*) filter (where d.day between w.a_from and w.a_to)::int as a_n,
      -- Target class rate, before and after.
      round(100.0 * count(*) filter (where d.day between w.b_from and w.b_to
              and w.target_defect = any(d.defects))
            / nullif(count(*) filter (where d.day between w.b_from and w.b_to), 0), 2) as b_rate,
      round(100.0 * count(*) filter (where d.day between w.a_from and w.a_to
              and w.target_defect = any(d.defects))
            / nullif(count(*) filter (where d.day between w.a_from and w.a_to), 0), 2) as a_rate,
      -- CONTROL: any defect that is NOT the target. If this moves in step with
      -- the target, the change is not what moved it.
      round(100.0 * count(*) filter (where d.day between w.b_from and w.b_to
              and exists (select 1 from unnest(d.defects) x where x <> w.target_defect))
            / nullif(count(*) filter (where d.day between w.b_from and w.b_to), 0), 2) as cb,
      round(100.0 * count(*) filter (where d.day between w.a_from and w.a_to
              and exists (select 1 from unnest(d.defects) x where x <> w.target_defect))
            / nullif(count(*) filter (where d.day between w.a_from and w.a_to), 0), 2) as ca
    from w
    left join bot.conversation_defects d
      on d.day between w.b_from and w.a_to
    group by w.id, w.title, w.shipped_at, w.target_defect
  )
  select a.id, a.title, a.shipped_at, a.target_defect,
         a.b_n, a.a_n, a.b_rate, a.a_rate,
         round(a.a_rate - a.b_rate, 2),
         a.cb, a.ca, round(a.ca - a.cb, 2),
         case
           when a.b_n = 0 or a.a_n = 0 then 'no data — widen the scorecard backfill'
           when a.b_n < 100 or a.a_n < 100 then 'too few conversations to read'
           when a.a_rate is null or a.b_rate is null then 'no data'
           when (a.a_rate - a.b_rate) < -0.5 and abs(coalesce(a.ca,0) - coalesce(a.cb,0)) < abs(a.a_rate - a.b_rate) / 2
             then 'improved, control steady'
           when (a.a_rate - a.b_rate) < -0.5 then 'improved, but everything moved — check the traffic'
           when (a.a_rate - a.b_rate) > 0.5 then 'got worse'
           else 'no measurable change'
         end
  from agg a
  order by a.shipped_at desc;
$$;

comment on function bot.change_impact is
  'Before/after rate of each change''s TARGET defect class, plus a control (all other classes) over the same windows. The control is the whole point: a live system moves for many reasons, and a target that falls while the control holds is the only shape that supports a causal claim.';

-- ---------------------------------------------------------------------------
-- Phase 4: repoint the sentiment dashboard at the scorecard, then drop the
-- friction objects it used to read.
--
-- bot.conversation_defects is a strict superset: friction's three signals are
-- classes no_answer / loop / asked_for_human. The sentiment page keeps working
-- and simply shows more.
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
  select c.session_id, c.day, cu.display_name,
         cs.sentiment, cs.score, cs.confidence, cs.rationale, cs.pushed_ticket_id,
         exists (select 1 from bot.conversation_feedback f where f.session_id = c.session_id),
         coalesce(fr.defects, '{}'::text[]),
         coalesce(fr.repeated_max, 0)
  from conv c
  left join bot.conversation_sentiment cs on cs.session_id = c.session_id
  left join bot.conversation_defects   fr on fr.session_id = c.session_id
  left join bot.sessions  s  on s.id = c.session_id
  left join bot.customers cu on cu.id = s.customer_id
  where c.day between p_from and p_to
    and (
      (p_sentiment is null and (cs.score <= 2 or coalesce(array_length(fr.defects,1),0) > 0))
      or (lower(p_sentiment) = 'all'      and cs.sentiment is not null)
      or (lower(p_sentiment) = 'friction' and coalesce(array_length(fr.defects,1),0) > 0)
      or cs.sentiment = p_sentiment
    )
  order by case when p_sentiment is null then coalesce(cs.score, 3) end asc nulls last,
           c.day desc, cs.score asc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function bot.sentiment_conversations is
  'Triage list for the sentiment dashboard: negative sentiment OR any measured defect (null), everything scored (''all''), defects only (''friction''), or one sentiment value. Reads bot.conversation_defects.';

create or replace function bot.sentiment_metrics(p_from date, p_to date)
returns jsonb
language sql
stable
as $$
  with conv as (
    select m.session_id, min(m.created_at)::date as day
    from bot.conversation_messages m group by m.session_id
  ),
  win as (
    select c.session_id, c.day, cs.sentiment, cs.score, cs.confidence
    from conv c
    left join bot.conversation_sentiment cs on cs.session_id = c.session_id
    where c.day between p_from and p_to
  ),
  fr as (
    select d.* from bot.conversation_defects d
    join win w on w.session_id = d.session_id
    where coalesce(array_length(d.defects,1),0) > 0
  ),
  outcome as (
    select case when t.session_id is null then 'chat only' else 'filed a ticket' end as outcome,
           count(*) as scored, round(avg(w.score), 2) as avg_score,
           count(*) filter (where w.score <= 2) as negative,
           round(100.0 * count(*) filter (where w.score <= 2) / nullif(count(*), 0), 1) as negative_pct
    from win w
    left join (select distinct session_id from bot.tickets) t on t.session_id = w.session_id
    where w.sentiment is not null group by 1
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'conversations', (select count(*) from win),
    'scored',        (select count(*) from win where sentiment is not null),
    'scored_pct',    (select round(100.0 * count(*) filter (where sentiment is not null) / nullif(count(*), 0), 1) from win),
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
                                   / nullif(count(*) filter (where sentiment is not null), 0), 1) from win),
    'triage_total',  (select count(*) from win w
                      left join bot.conversation_defects f on f.session_id = w.session_id
                      where w.score <= 2 or coalesce(array_length(f.defects,1),0) > 0),
    'friction', jsonb_build_object(
      'total',           (select count(*) from fr),
      'pct',             (select round(100.0 * (select count(*) from fr) / nullif((select count(*) from win), 0), 1)),
      'loop',            (select count(*) from fr where repeated_reply),
      'asked_for_human', (select count(*) from fr where asked_for_human),
      'never_answered',  (select count(*) from fr where no_answer),
      'calm_but_bad',    (select count(*) from fr join win w on w.session_id = fr.session_id
                          where w.score is not null and w.score > 2)
    ),
    'low_confidence',(select count(*) from win where confidence = 'low'),
    'unscored',      (select count(*) from win where sentiment is null),
    'failed',        (select count(*) from bot.sentiment_failures sf
                      join conv c2 on c2.session_id = sf.session_id
                      where c2.day between p_from and p_to),
    'by_outcome',    coalesce((select jsonb_agg(jsonb_build_object(
                        'outcome', outcome, 'scored_conversations', scored, 'avg_score', avg_score,
                        'negative', negative, 'negative_pct', negative_pct) order by outcome) from outcome), '[]'::jsonb)
  );
$$;

comment on function bot.sentiment_metrics is
  'Sentiment totals, mix, coverage, defect counts and the chat-only-vs-ticket split for a date range. Reads bot.conversation_defects for the defect half.';

-- Friction is fully absorbed. Dropped last, after the readers above have been
-- replaced in the same transaction, so there is no window where the dashboard
-- points at a table that no longer exists.
drop function if exists bot.refresh_conversation_friction(integer);
drop function if exists bot.session_friction(date, date);
drop table if exists bot.conversation_friction;
