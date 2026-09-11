-- Let each example quote link through to the whole conversation.
--
-- The traces already carried three real member messages per question. A quote
-- on its own shows the wording but not what happened next, and quoting more of
-- the chat is the wrong fix: the rest of a conversation is not masked, and the
-- app already has a page that renders a full transcript properly
-- (/conversations/<id>). So store the session id beside each quote and link.
--
-- examples[] and example_sessions[] are positional: same order, same length.
-- Two arrays rather than a jsonb array of objects because every consumer wants
-- the quotes as a list and the ids only to build a href, and jsonb would make
-- the common case the awkward one.
--
-- tools/questions/build.js also now picks each example from a DIFFERENT session
-- and prefers longer conversations, so three quotes are three different members
-- and the link is worth following. That ordering never changes which messages
-- matched, so the counts are unaffected.

alter table bot.question_traces
  add column if not exists example_sessions text[] not null default '{}';

comment on column bot.question_traces.example_sessions is
  'Session ids for the quotes in examples[], same order and same length. Lets a page link each quote through to the whole conversation in /conversations/<id> rather than quoting more of it. Chosen from distinct sessions so three quotes are three different members.';

-- Adding a column to the return type means a drop and recreate; both run in
-- this one migration so the function is never missing for a live request.
drop function if exists bot.question_traces_view();

create function bot.question_traces_view()
returns table (
  key text, sort_order integer, question text, examples text[],
  example_sessions text[],
  matched_messages integer, matched_sessions integer,
  window_from date, window_to date,
  chain_key text, chain_label text, decides text, reads text,
  chain_steps text[], ends_at text, change_cost text, caveat text,
  verified_at date, chain_question_count bigint
)
language sql
stable
as $function$
  select q.key, q.sort_order, q.question, q.examples, q.example_sessions,
         q.matched_messages, q.matched_sessions, q.window_from, q.window_to,
         q.chain_key, q.chain_label, q.decides, q.reads, q.chain_steps,
         q.ends_at, q.change_cost, q.caveat, q.verified_at,
         count(*) over (partition by q.chain_key)
  from bot.question_traces q
  order by q.sort_order, q.key;
$function$;

comment on function bot.question_traces_view is
  'The traces with a per-chain question count joined on, so a page can show how much of the demand each of the seven sources carries.';

-- Re-seed:  node tools/questions/build.js && node tools/questions/seed.js
