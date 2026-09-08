-- Scenario library — board item a0718672 (Bryan, 3 Sep 2026, high):
-- "Provide examples of what the bot recognizes as a certain scenario".
--
-- Stored as ONE generated document rather than hand-maintained rows, because
-- the thing being described is live code. The generator
-- (tools/scenarios/generate.js) copies each recogniser VERBATIM out of the
-- n8n node it lives in, runs it over real member messages in JavaScript — not
-- re-expressed in SQL, so a regex-dialect difference cannot make the library
-- disagree with the bot — and writes the result here.
--
-- Regenerate rather than edit. If a classifier changes in n8n and the library
-- is not regenerated, it is wrong, and `generated_at` is how you notice. The
-- two request-type classifiers in Bot - Ticket Collection Agent are documented
-- as COUPLED and have drifted before; this is the same hazard one level up.
create table if not exists bot.scenario_library (
  id            integer primary key default 1,
  doc           jsonb   not null,
  generated_at  timestamptz not null default now(),
  window_from   date,
  window_to     date,
  messages_scanned integer,
  constraint scenario_library_single_row check (id = 1)
);

comment on table bot.scenario_library is
  'Generated reference: which member messages each bot scenario recogniser matches, with real examples, known misfires and the collisions between scenarios. Regenerate with tools/scenarios/generate.js; never hand-edit.';

-- Reader for the app. Returns the document plus its freshness, so the page can
-- say how old the library is instead of implying it is live.
create or replace function bot.get_scenario_library()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'doc', doc,
    'generated_at', generated_at,
    'window_from', window_from,
    'window_to', window_to,
    'messages_scanned', messages_scanned,
    'age_days', floor(extract(epoch from (now() - generated_at)) / 86400)
  )
  from bot.scenario_library where id = 1;
$$;
