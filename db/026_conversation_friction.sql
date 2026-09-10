-- Friction: the half of the triage signal that was hiding inside "Frustrated".
--
-- WHY THIS EXISTS
-- The sentiment rubric opens by saying it does not score bot performance, then
-- the Frustrated definition listed "repeating the same question because they
-- were not answered" and "demanding a human after being blocked" as evidence.
-- Both are facts about the BOT, not about the member's mood. Measured over the
-- 1,212 Frustrated rows scored 7-9 Sep 2026, 58.3% of the model's own
-- rationales cited only that behavioural evidence with no affect language at
-- all, against 9.8% citing explicit affect (caps, expletives, "annoying").
-- One rationale gave the game away: "indicating friction and an unresolved
-- problem RATHER THAN ACCEPTANCE OR THANKS" — absence of gratitude scored as
-- anger. The rubric already forbids the mirror of that ("a polite close is not
-- satisfaction"); nobody had written the other half.
--
-- The consequence was a triage list where a calm member reporting a billing
-- error sat under a Frustrated badge, on a page whose own copy promises it
-- "does NOT rate the bot".
--
-- So the two signals are separated. The rubric (docs/sentiment-rubric.txt) now
-- scores member emotion only. Friction — did this conversation go badly? — is
-- computed HERE, in SQL, deterministically, with no model in the loop. The
-- triage list is the union, badged separately, so nothing Member Care sees
-- today disappears.
--
-- A second reason to compute it rather than infer it: the repeat-breaker fix
-- shipped 8 Sep (docs/repetition-and-sentiment.md). Because Frustrated was
-- substantially DEFINED by repetition, that fix would have driven the negative
-- rate down on its own and read as members getting happier. Counting loops
-- directly de-circularises the measurement.
--
-- THRESHOLDS — measured over the 7,581 conversations in the 28 days to
-- 9 Sep 2026, chosen so the new queue is the size of the old one (1,263) and
-- not double it:
--   loop            862  (11.4%)
--   asked_for_human 555  ( 7.3%)
--   never_answered  181  ( 2.4%)
-- Naive "zero substantive answers" alone matched 1,380 sessions, but 556 of
-- those are members who typed once or twice and left — nothing to read. The
-- >= 4 member-message floor keeps only the ones who genuinely kept trying.

-- ---------------------------------------------------------------------------
-- bot.session_friction — one row per conversation in the range that has any
-- friction signal. Sessions with none are simply absent, so callers can
-- left join and treat a null as "clean".
-- ---------------------------------------------------------------------------
create or replace function bot.session_friction(
  p_from date,
  p_to   date
)
returns table (
  session_id      uuid,
  repeated_max    integer,
  asked_for_human boolean,
  never_answered  boolean,
  labels          text[]
)
language sql
stable
as $$
  with conv as (
    -- A conversation belongs to the day of its FIRST message, matching
    -- bot.sentiment_metrics and bot.sentiment_daily.
    select m.session_id, min(m.created_at)::date as day
    from bot.conversation_messages m
    group by m.session_id
  ),
  scoped as (
    select session_id from conv where day between p_from and p_to
  ),
  -- MATERIALIZED on purpose. The three signals below all need the message
  -- CONTENT, and without it the planner runs three independent index scans that
  -- each re-fetch the same heap pages.
  --
  -- Measured, 7-day range: shared buffers 60,083 -> 33,077 (-45%). Wall clock
  -- did NOT improve — it stayed at ~1.2s, because the CTE spills to temp
  -- (read 1078 / written 539) and gives back what the heap fetches saved.
  -- Kept anyway: halving shared-buffer traffic is what matters when several
  -- staff open the dashboard at once, and the row output is byte-identical
  -- (1,441 / 879 / 578 / 181 over 28 days, before and after). If this ever
  -- needs to be genuinely faster the answer is a materialised view refreshed
  -- on the sentiment batch, not more CTE tuning.
  msg as materialized (
    select m.session_id, m.role, btrim(m.content) as content
    from bot.conversation_messages m
    join scoped s on s.session_id = m.session_id
  ),
  -- Verbatim repeated bot replies. Matching is exact after whitespace and case
  -- normalisation, deliberately: docs/repetition-and-sentiment.md rejected
  -- fuzzy matching because it would suppress a re-shown ticket preview whose
  -- figures HAD changed, and all of the measured opportunity is in exact
  -- repeats anyway. The 60-character floor keeps short closers like "Anything
  -- else I can help with?" from reading as a loop.
  sig as (
    select m.session_id,
           md5(lower(regexp_replace(m.content, '\s+', ' ', 'g'))) as sig,
           -- Ticket previews keep the THIRD-send threshold. Re-showing a
           -- preview is correct behaviour when the member sent something
           -- ambiguous and the draft has not changed — the same carve-out the
           -- Break Repeat Loop guard makes.
           (m.content ~ '📋'
            or m.content ~* '(yes|ja)[^.?!]{0,25}(submit|in\s*te\s*dienen|indienen)') as is_preview,
           count(*) as times
    from msg m
    where m.role = 'assistant'
      and length(m.content) > 60
    group by 1, 2, 3
  ),
  rep as (
    select session_id,
           coalesce(max(times) filter (where not is_preview), 0) as max_plain,
           coalesce(max(times) filter (where is_preview), 0)     as max_preview
    from sig
    group by 1
  ),
  -- The member asked to reach a person. Kept narrow: the verb must sit next to
  -- the human noun, or the message must name a phone number / live agent
  -- outright. "The receptionist said..." is a member quoting staff, not asking
  -- for one, and must not match.
  --
  -- MATCHED IN BOTH ORDERS, which is not optional here. Dutch puts the verb
  -- last — "Ik wil een medewerker spreken" is noun-then-verb — so a
  -- verb-then-noun pattern silently missed most of the Dutch requests. The
  -- first version of this did exactly that and lost a member whose chat had
  -- just been correctly re-scored to Neutral, which would have dropped them off
  -- the triage list altogether. Widening it (both orders, plus "live
  -- assistant" / "real human" / "contact") took the 28-day count from 578 to
  -- 999; 22 sampled new matches were all genuine requests to reach a person.
  --
  -- Bare "customer service" was tried and REMOVED: it matched "can you make a
  -- ticket for customer service for me", which is a ticket request, not someone
  -- trying to get past the bot. "klantenservice" stays, but only next to a verb.
  human as (
    select distinct m.session_id
    from msg m
    where m.role = 'user'
      and m.content ~* '(speak|talk|spreken|bellen|call|contact)[^.?!]{0,30}'
                       '(human|person|someone|somebody|agent|assistant|medewerker|medewerkster|iemand|klantenservice)'
                    '|(human|person|someone|somebody|agent|assistant|medewerker|medewerkster|iemand|klantenservice)'
                       '[^.?!]{0,30}(speak|talk|spreken|bellen|call|contact)'
                    '|live (agent|assistant|person|rep|support)|real (person|human)'
                    '|echt (persoon|mens)|met een mens'
                    '|telefoonnummer|phone number|connect me'
  ),
  counts as (
    select m.session_id,
           count(*) filter (where m.role = 'user') as user_msgs,
           -- A "substantive answer" is the same predicate the Bot helped page
           -- uses in bot.daily_digest_details, so the two pages cannot disagree
           -- about whether the bot ever said anything of use: not a form link,
           -- not auth/greeting boilerplate.
           count(*) filter (
             where m.role = 'assistant'
               and length(m.content) > 80
               and m.content !~* '(ticket_form=|extend-your-membership)'
               and m.content !~* '(verification code|verificatiecode|you.re all set'
                                 '|je bent ingelogd|share the email'
                                 '|e-mailadres van je account)'
           ) as answers
    from msg m
    group by 1
  ),
  joined as (
    select s.session_id,
           coalesce(r.max_plain, 0) as max_plain,
           coalesce(r.max_preview, 0) as max_preview,
           (h.session_id is not null) as asked_for_human,
           -- Four member turns and not one substantive reply. The floor is what
           -- separates "kept trying and got nothing" from a member who typed
           -- once and closed the tab.
           (coalesce(c.answers, 0) = 0 and coalesce(c.user_msgs, 0) >= 4) as never_answered
    from scoped s
    left join rep    r on r.session_id = s.session_id
    left join human  h on h.session_id = s.session_id
    left join counts c on c.session_id = s.session_id
  ),
  flagged as (
    select j.session_id,
           -- Report the repeat count that actually tripped the rule, so the
           -- badge can read "loop x4" and mean it.
           case when j.max_plain >= 2 then j.max_plain
                when j.max_preview >= 3 then j.max_preview
                else 0 end as repeated_max,
           j.asked_for_human,
           j.never_answered
    from joined j
    where j.max_plain >= 2 or j.max_preview >= 3
       or j.asked_for_human or j.never_answered
  )
  select f.session_id,
         f.repeated_max,
         f.asked_for_human,
         f.never_answered,
         -- array_remove(arr, null) does strip nulls (verified on this server,
         -- PG 17) — it is not the no-op that a naive reading of "removes
         -- elements equal to the value" would suggest.
         array_remove(array[
           case when f.repeated_max > 0 then 'loop'::text            end,
           case when f.asked_for_human  then 'asked_for_human'::text end,
           case when f.never_answered   then 'never_answered'::text  end
         ], null)
  from flagged f;
$$;

comment on function bot.session_friction is
  'Conversations that went badly, computed deterministically from the transcript with no model in the loop: a verbatim bot reply repeated (2+, or 3+ for ticket previews), the member asking for a human, or 4+ member turns with no substantive answer. Deliberately separate from sentiment, which scores the member''s emotion only.';

-- ---------------------------------------------------------------------------
-- bot.sentiment_conversations — the triage list is now emotion OR friction.
--
-- p_sentiment:
--   null        -> the triage list: negative sentiment OR any friction.
--   'all'       -> every scored conversation in the range.
--   'friction'  -> friction only, whatever the member's mood was.
--   a value     -> just that sentiment value.
--
-- Friction rows are returned even when the conversation has no sentiment score
-- yet: a chat where the bot looped eight times is worth reading whether or not
-- the scorer has reached it, and roughly 1 in 6 conversations is still queued.
-- ---------------------------------------------------------------------------
-- The signature gains `friction` and `repeated_max`, so the OUT row type
-- changes and `create or replace` is refused. Dropping first is safe: the
-- function is read-only and the app calls it by name through PostgREST.
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
  ),
  fr as (
    select * from bot.session_friction(p_from, p_to)
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
  left join fr                             on fr.session_id = c.session_id
  left join bot.sessions  s  on s.id = c.session_id
  left join bot.customers cu on cu.id = s.customer_id
  where c.day between p_from and p_to
    and (
      -- Triage: upset member, or a conversation that went badly, or both.
      (p_sentiment is null and (cs.score <= 2 or fr.session_id is not null))
      or (lower(p_sentiment) = 'all'      and cs.sentiment is not null)
      or (lower(p_sentiment) = 'friction' and fr.session_id is not null)
      or cs.sentiment = p_sentiment
    )
  -- Worst-first ONLY for the default triage list. For an explicit filter the
  -- first key is constant, so it falls through to newest-first: ordering 'all'
  -- by score would show nothing but negatives until the limit ran out.
  -- Unscored friction rows sort after scored ones rather than first, since a
  -- null score is not evidence of anything.
  order by case when p_sentiment is null then coalesce(cs.score, 3) end asc nulls last,
           c.day desc,
           cs.score asc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

comment on function bot.sentiment_conversations is
  'Triage list for the sentiment dashboard: negative sentiment OR measured friction (null), everything scored (''all''), friction only (''friction''), or one sentiment value. Ranged on the conversation date, and flags whether feedback was already raised.';

-- ---------------------------------------------------------------------------
-- bot.sentiment_metrics — friction counted alongside the mix.
--
-- Reported next to sentiment rather than folded into it, because the whole
-- point of this migration is that they are different questions. A range where
-- friction is high and Frustrated is low means the bot is failing members who
-- are being patient about it — which is exactly the case the old rubric could
-- not express.
-- ---------------------------------------------------------------------------
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
    select * from bot.session_friction(p_from, p_to)
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
    -- The size of the default triage list: the true UNION of negative
    -- sentiment and friction. Computed here rather than added up in the app,
    -- where `negative + calm_but_bad` would silently undercount — it misses
    -- friction rows that have no sentiment score at all.
    'triage_total',  (select count(*) from win w
                      left join fr on fr.session_id = w.session_id
                      where w.score <= 2 or fr.session_id is not null),
    -- Friction is over ALL conversations in the range, scored or not — it needs
    -- no model, so coverage does not limit it.
    'friction', jsonb_build_object(
      'total',           (select count(*) from fr),
      'pct',             (select round(100.0 * (select count(*) from fr)
                                       / nullif((select count(*) from win), 0), 1)),
      'loop',            (select count(*) from fr where repeated_max > 0),
      'asked_for_human', (select count(*) from fr where asked_for_human),
      'never_answered',  (select count(*) from fr where never_answered),
      -- The case the old rubric could not express: it went badly and the
      -- member stayed calm about it.
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
