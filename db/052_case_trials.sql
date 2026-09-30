-- "Try it": run a member message through the real bot sub-workflow for a case
-- and keep the reply, so a reviewer can see what Evelyn says now — before a
-- proposal is accepted and again after it is implemented — without opening the
-- widget, and with the result attached to the proposal it was testing.
--
-- HOW IT RUNS
-- Through the existing Bot - Regression Test Harness (q9Acjf33ByOnqJTp): the
-- app posts { target_workflow_id, input_payload: { user_message, history } }
-- and names the output key it wants back (reply_text) in expected_result. The
-- harness already maps those into any target sub-workflow; no n8n change.
--
-- WHICH CASES
-- Only areas with a target listed in the app (src/app/(app)/cases/shared.ts).
-- Pre-login cases run Bot - Public FAQ (WMN8P9ZHjgFfmxDK), which reads nothing
-- about a member and writes nothing. Logged-in cases need a test member in
-- Magicline before they can be run this way; until then the page says so.
--
-- WHY A ROW PER RUN
-- Every run is a real LLM call and the point is to compare runs over time. A
-- trial is never updated; a new question is a new row.

create table if not exists bot.case_trials (
  id                 uuid primary key default gen_random_uuid(),
  -- Soft reference to bot.case_library.key, like case_proposals.
  case_key           text not null,
  -- The open proposal at the time, if any, so the proposal page can show what
  -- was tried while it was under review. Nulled, not cascaded, if the proposal
  -- goes: the run still happened.
  proposal_id        uuid references bot.case_proposals(id) on delete set null,
  target_workflow_id text not null,
  message            text not null,
  reply              text,
  error              text,
  ms                 integer,
  ran_by             text not null,
  ran_at             timestamptz not null default now()
);

create index if not exists case_trials_case_idx on bot.case_trials (case_key, ran_at desc);
create index if not exists case_trials_proposal_idx on bot.case_trials (proposal_id, ran_at desc);

alter table bot.case_trials enable row level security;
revoke all on bot.case_trials from anon, authenticated;
grant all on bot.case_trials to service_role;

comment on table bot.case_trials is
  'One run of a member message through the real sub-workflow behind a case, via the regression harness. Reply kept so before/after an implementation is visible on the case page.';
