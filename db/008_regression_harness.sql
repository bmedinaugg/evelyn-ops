-- Evelyn Ops — regression-replay harness (Developer tool).
-- Applied via MCP migration `regression_harness`.
--
-- Lets a developer re-run known n8n bot bugs as fixtures against a small,
-- isolated n8n test-harness workflow (pure JS re-implementation of the fixed
-- logic, no external credentials) and see pass/fail history without touching
-- the live bot. Additive, app-owned; nothing existing is altered.

create table if not exists bot.regression_fixtures (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,   -- e.g. 'dup-prospect-same-studio'
  title           text not null,
  description     text not null,         -- what bug this reproduces, plain English
  input_payload   jsonb not null,        -- fed to the harness webhook as-is
  expected_result jsonb not null,        -- what a PASSING run's actual_result should equal
  created_at      timestamptz not null default now()
);

create table if not exists bot.regression_runs (
  id            uuid primary key default gen_random_uuid(),
  fixture_key   text not null references bot.regression_fixtures(key) on delete cascade,
  ran_by        text not null,
  ran_at        timestamptz not null default now(),
  passed        boolean not null,
  actual_result jsonb not null,
  notes         text
);

create index if not exists regression_runs_fixture_idx
  on bot.regression_runs (fixture_key, ran_at desc);

alter table bot.regression_fixtures enable row level security;
revoke all on bot.regression_fixtures from anon, authenticated;
grant all on bot.regression_fixtures to service_role;

alter table bot.regression_runs enable row level security;
revoke all on bot.regression_runs from anon, authenticated;
grant all on bot.regression_runs to service_role;

-- Seed fixture: the 2026-07-22 duplicate-PROSPECT crash (see memory
-- evelyn-no-reply-auth-bugs.md, entry #5). Two duplicate Magicline PROSPECT
-- signups under one email used to fan out as 2 items, causing a double
-- OTP-generate call and a top-level Postgres uuid crash in Bot - Main. Fixed
-- by the "Dedupe Prospect Matches" node in Bot - Get customer information
-- (Auth) (8wK1AfdqWssKIVUy) — keeps only the most recently created record.
insert into bot.regression_fixtures (key, title, description, input_payload, expected_result)
values (
  'dup-prospect-same-studio',
  'Duplicate PROSPECT records at the same studio',
  'Two duplicate Magicline PROSPECT signups under one email used to fan out as 2 items, causing a double OTP-generate call and a top-level Postgres uuid crash. Fixed by "Dedupe Prospect Matches" in Bot - Get customer information (Auth).',
  '{
    "records": [
      {"customerId": 9000001, "customerNumber": "TEST-0001", "status": "PROSPECT", "studioId": 1224538480, "customerCreatedDateTime": "2025-11-27T18:27:06.249331+01:00"},
      {"customerId": 9000002, "customerNumber": "TEST-0002", "status": "PROSPECT", "studioId": 1224538480, "customerCreatedDateTime": "2025-11-28T20:41:45.339460+01:00"}
    ]
  }'::jsonb,
  '{"item_count": 1, "kept_customer_number": "TEST-0002"}'::jsonb
)
on conflict (key) do nothing;
