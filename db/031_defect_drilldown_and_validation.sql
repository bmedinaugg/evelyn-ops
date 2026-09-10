-- Phase 2 drill-down and Phase 5 validation for the performance scorecard.

-- ---------------------------------------------------------------------------
-- The conversations behind one defect class.
--
-- p_class null    -> every defective conversation
-- p_class 'clean' -> the clean ones, deliberately reachable: a reviewer needs
--                    to be able to check what we are calling a SUCCESS, not
--                    only ever be shown failures.
-- ---------------------------------------------------------------------------
create or replace function bot.defect_conversations(
  p_from  date,
  p_to    date,
  p_class text default null,
  p_limit integer default 50
)
returns table (
  session_id   uuid,
  day          date,
  member       text,
  user_msgs    integer,
  answers      integer,
  defects      text[],
  repeated_max integer,
  sentiment    text,
  has_feedback boolean,
  first_user_message text
)
language sql
stable
as $$
  select d.session_id, d.day, cu.display_name, d.user_msgs, d.answers,
         d.defects, d.repeated_max, cs.sentiment,
         exists (select 1 from bot.conversation_feedback f where f.session_id = d.session_id),
         (select left(regexp_replace(btrim(m.content), '\s+', ' ', 'g'), 140)
          from bot.conversation_messages m
          where m.session_id = d.session_id and m.role = 'user' and m.content is not null
          order by m.created_at limit 1)
  from bot.conversation_defects d
  left join bot.sessions  s  on s.id = d.session_id
  left join bot.customers cu on cu.id = s.customer_id
  left join bot.conversation_sentiment cs on cs.session_id = d.session_id
  where d.day between p_from and p_to
    and (
      (p_class is null      and not d.is_clean)
      or (p_class = 'clean' and d.is_clean)
      or (p_class = any(d.defects))
    )
  -- Most-broken first: a conversation carrying several defects at once is the
  -- one worth a human's time.
  order by array_length(d.defects, 1) desc nulls last, d.day desc, d.user_msgs desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function bot.defect_conversations is
  'Conversations behind one defect class (null = all defective, ''clean'' = the clean ones). Worst-first by number of defects.';

-- ---------------------------------------------------------------------------
-- Phase 5: validate the scorecard against Member Care's own labels, and keep
-- the answer LIVE on the page rather than as a claim in a commit message.
--
-- THE FINDING THIS EXISTS TO PUBLISH: the scorecard catches ~28% of the
-- conversations Member Care rated 'bad'. The other ~72% are chats where the
-- bot answered fluently and was simply WRONG — "she talks about a Gold label,
-- which doesn't exist", "it makes extension requests out of everything", "the
-- bot confirmed it cancelled the ticket but it stayed open". Every one of those
-- has a substantive answer and no structural defect, because nothing countable
-- in a transcript reveals that a confident answer is false.
--
-- So the clean rate is a PROCESS metric, not a quality metric, and this
-- function makes that impossible to forget: the recall number renders next to
-- the headline. Reading "51% clean" as "the bot is 51% good" would be wrong in
-- the most flattering direction — exactly the error a dashboard should prevent.
--
-- Note the asymmetry: only 7 conversations are labelled 'good', far too few to
-- validate the clean end. Treat 'clean' as "no detected defect", not "good".
-- ---------------------------------------------------------------------------
create or replace function bot.scorecard_validation()
returns jsonb
language sql
stable
as $$
  with j as (
    select f.rating, d.is_clean, d.session_id as matched
    from bot.conversation_feedback f
    left join bot.conversation_defects d on d.session_id = f.session_id
    where f.rating is not null
  )
  select jsonb_build_object(
    'bad_labelled',      (select count(*) from j where rating = 'bad'),
    'bad_in_window',     (select count(*) from j where rating = 'bad' and matched is not null),
    'bad_caught',        (select count(*) from j where rating = 'bad' and is_clean = false),
    'bad_recall_pct',    (select round(100.0 * count(*) filter (where is_clean = false)
                                       / nullif(count(*) filter (where matched is not null), 0), 1)
                          from j where rating = 'bad'),
    'good_in_window',    (select count(*) from j where rating = 'good' and matched is not null),
    'good_scored_clean', (select count(*) from j where rating = 'good' and is_clean = true)
  );
$$;

comment on function bot.scorecard_validation is
  'Recall of the defect scorecard against Member Care''s manual good/bad ratings. Deliberately surfaced on the page: the misses are wrong-but-fluent answers, which no structural rule can detect, so the clean rate must never be read as a quality score.';
