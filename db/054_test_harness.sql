-- The test harness: profiles (who the runner logs in as), scenarios (what it
-- says and what must come back), runs (what happened). The runner talks to the
-- REAL bot through its web-chat entry point as a 'test-…' identity — see
-- db/053 and docs in evelyn-next/docs/spec/test-channel.md.
--
-- LEAVE NO TRACE
-- A run records its own transcript in test_runs and then PURGES the session it
-- created — messages, drafts, OTPs, sentiment, the channel user — so test
-- conversations never reach the dashboard, the digest, sentiment scoring or
-- the stale-preview auto-submitter. The only thing that can outlive a run is a
-- Freshdesk ticket, which the app tags evelyn-test and closes before purging.

create table if not exists bot.test_profiles (
  key             text primary key,
  label           text not null,
  -- The email the runner types at login. Null until Bryan fills it in.
  email           text,
  expected_status text not null,   -- what Magicline should say about this record
  -- If the bot asks which account (multi-studio), the runner replies with this.
  login_choice    text,
  notes           text,
  active          boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by      text
);

create table if not exists bot.test_scenarios (
  key         text primary key,
  title       text not null,
  -- Null = pre-login scenario; otherwise the runner logs in as this profile first.
  profile_key text references bot.test_profiles(key) on delete set null,
  -- Soft reference to bot.case_library.key, so the case page can list its scenarios.
  case_key    text,
  -- [{ say, contains: [], not_contains: [], matches: null|regex, outcome: null|'no_ticket'|'ticket_filed' }]
  turns       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_by  text,
  updated_at  timestamptz not null default now()
);

create index if not exists test_scenarios_case_idx on bot.test_scenarios (case_key);

create table if not exists bot.test_runs (
  id            uuid primary key default gen_random_uuid(),
  scenario_key  text not null,
  profile_key   text,
  external_id   text not null,
  session_id    uuid,
  status        text not null default 'running',   -- running | passed | failed | error
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  -- [{ phase: 'login'|'scenario', say, reply, ms, checks: [{kind, value, ok}] }]
  turns         jsonb not null default '[]'::jsonb,
  error         text,
  tickets_closed text[] not null default '{}',
  ran_by        text not null,
  constraint test_runs_status_ck check (status in ('running','passed','failed','error'))
);

create index if not exists test_runs_scenario_idx on bot.test_runs (scenario_key, started_at desc);

alter table bot.test_profiles enable row level security;
alter table bot.test_scenarios enable row level security;
alter table bot.test_runs enable row level security;
revoke all on bot.test_profiles, bot.test_scenarios, bot.test_runs from anon, authenticated;
grant all on bot.test_profiles, bot.test_scenarios, bot.test_runs to service_role;

-- Delete everything a test session left behind. Refuses non-test sessions.
-- Order follows the FK graph read on 30 Sep 2026 (children first).
create or replace function bot.test_session_purge(p_session_id uuid)
returns void language plpgsql security definer set search_path to 'bot' as $$
declare v_cu uuid;
begin
  if not bot.is_test_session(p_session_id) then
    raise exception 'test_session_purge: % is not a test session', p_session_id;
  end if;
  select channel_user_id into v_cu from bot.sessions where id = p_session_id;
  delete from bot.conversation_sentiment  where session_id = p_session_id;
  delete from bot.sentiment_failures      where session_id = p_session_id;
  delete from bot.review_status           where session_id = p_session_id;
  delete from bot.conversation_summaries  where session_id = p_session_id;
  delete from bot.conversation_feedback   where session_id = p_session_id;
  update bot.faq_proposals set source_session_id = null where source_session_id = p_session_id;
  delete from bot.tickets                 where session_id = p_session_id;
  delete from bot.ticket_drafts           where session_id = p_session_id;
  delete from bot.otp_codes               where session_id = p_session_id;
  delete from bot.conversation_messages   where session_id = p_session_id;
  delete from bot.sessions                where id = p_session_id;
  if v_cu is not null then
    delete from bot.channel_user_customers where channel_user_id = v_cu;
    delete from bot.auth_attempts          where channel_user_id = v_cu;
    delete from bot.channel_users          where id = v_cu and external_id like 'test-%';
  end if;
end $$;
revoke all on function bot.test_session_purge(uuid) from public, anon, authenticated;

-- The cast. Emails are filled in on the /tests page.
insert into bot.test_profiles (key, label, expected_status, notes) values
  ('member_fixed',   'Member, fixed-term, paid up',      'MEMBER',        'Active 1/2/3-year contract, zero balance, no bookings.'),
  ('member_dunning', 'Member with outstanding balance',  'MEMBER',        'Open debt so balance / dunning answers have something to say.'),
  ('member_flex',    'Member on Flex',                   'MEMBER',        'Flex contract, so notice-period answers differ from fixed-term.'),
  ('prospect',       'Prospect, no contract',            'PROSPECT',      'Signed up, never had a contract.'),
  ('former',         'Former member',                    'FORMER_MEMBER', 'Contract ended.'),
  ('multi_studio',   'Same email at two studios',        'MEMBER',        'Exercises the pick-an-account path. Set login_choice to the reply the runner should give.')
on conflict (key) do nothing;

-- Starter scenarios, one per profile plus two pre-login. Expectations are
-- deliberately loose; Member Care tightens them from real replies.
insert into bot.test_scenarios (key, title, profile_key, case_key, turns, created_by) values
  ('prelogin_day_pass_oost', 'Day pass price at Amsterdam Oost (pre-login)', null, 'pre_day_pass',
   '[{"say":"how much is a day pass at amsterdam oost?","contains":["25"],"not_contains":["30"]}]', 'seed'),
  ('prelogin_freeze_travel', 'Freeze for travel is refused (pre-login)', null, 'pre_freeze',
   '[{"say":"can I freeze my membership while I travel for 3 months?","contains":["medical"],"not_contains":[]}]', 'seed'),
  ('member_fixed_contract_end', 'Contract end date for a paid-up member', 'member_fixed', 'acct_contract',
   '[{"say":"when does my contract end?","matches":"20[0-9]{2}","not_contains":["no active membership"],"outcome":"no_ticket"}]', 'seed'),
  ('member_dunning_balance', 'Outstanding balance is stated', 'member_dunning', 'acct_balance',
   '[{"say":"do I owe anything?","contains":["€"],"not_contains":["€0.00","0,00"],"outcome":"no_ticket"}]', 'seed'),
  ('member_flex_notice', 'Flex member asks how to cancel', 'member_flex', 'ss_early_cancellation',
   '[{"say":"how do I cancel my membership?","contains":["notice"],"not_contains":[],"outcome":"no_ticket"}]', 'seed'),
  ('prospect_contract', 'Prospect asks about a contract they do not have', 'prospect', 'acct_contract',
   '[{"say":"when does my contract end?","contains":["no active"],"not_contains":[],"outcome":"no_ticket"}]', 'seed'),
  ('former_member_balance', 'Former member asks about balance', 'former', 'acct_balance',
   '[{"say":"do I owe anything?","contains":[],"not_contains":["error"],"outcome":"no_ticket"}]', 'seed'),
  ('multi_studio_balance', 'Two-studio member logs in and asks balance', 'multi_studio', 'auth_multi_account',
   '[{"say":"do I owe anything?","contains":["€"],"not_contains":[],"outcome":"no_ticket"}]', 'seed')
on conflict (key) do nothing;
