-- Evelyn Ops — Phase 0 migration: additive app-owned tables
-- Project: rxnryvwpkdnwkpmhiiup   Schema: bot
--
-- SAFETY NOTES
--  * Purely ADDITIVE. Creates 3 new tables only. Does NOT alter, lock, or
--    change RLS/grants on any existing bot.* table or function.
--  * FKs point FROM these new tables TO bot.sessions / bot.conversation_messages.
--    A child-side FK never blocks INSERT/UPDATE on the parent, so it cannot
--    block the bot's writes. ON DELETE CASCADE / SET NULL ensures the FK also
--    cannot block a parent DELETE if the bot ever removes a session/message.
--  * RLS is ENABLED with no permissive policy = default-deny for anon /
--    authenticated. The Evelyn Ops server uses the service_role key, which
--    bypasses RLS, so the app still reads/writes these fully. The browser
--    never touches these tables directly.
--  * Idempotent: safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. conversation_feedback — team feedback on a conversation or a message
-- ---------------------------------------------------------------------------
create table if not exists bot.conversation_feedback (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null
                 references bot.sessions(id) on delete cascade,
  message_id   uuid
                 references bot.conversation_messages(id) on delete set null,
  author_email text not null,            -- staff member (from app auth session)
  rating       text check (rating in ('good','bad')),
  comment      text,
  tags         text[] not null default '{}',   -- e.g. wrong-info, tone, missing-faq
  created_at   timestamptz not null default now()
);

create index if not exists conversation_feedback_session_idx
  on bot.conversation_feedback (session_id);
create index if not exists conversation_feedback_created_idx
  on bot.conversation_feedback (created_at desc);

-- ---------------------------------------------------------------------------
-- 2. faq_proposals — captured knowledge gaps / proposed FAQ entries
--    Designed so a LATER n8n workflow can pick up status = 'approved' rows.
--    Publishing into the live FAQ store is OUT OF SCOPE here.
-- ---------------------------------------------------------------------------
create table if not exists bot.faq_proposals (
  id                uuid primary key default gen_random_uuid(),
  question          text not null,
  suggested_answer  text,
  source_session_id uuid references bot.sessions(id) on delete set null,
  source_message_id uuid references bot.conversation_messages(id) on delete set null,
  status            text not null default 'draft'
                      check (status in ('draft','approved','published','rejected')),
  author_email      text not null,       -- who drafted it
  reviewer_email    text,                -- who approved/rejected
  published_at      timestamptz,         -- set by the future n8n sync, not the app
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists faq_proposals_status_idx
  on bot.faq_proposals (status);
create index if not exists faq_proposals_source_session_idx
  on bot.faq_proposals (source_session_id);

-- ---------------------------------------------------------------------------
-- 3. review_status — one triage row per conversation (avoid team collisions)
-- ---------------------------------------------------------------------------
create table if not exists bot.review_status (
  session_id     uuid primary key
                   references bot.sessions(id) on delete cascade,
  status         text not null default 'unreviewed'
                   check (status in ('unreviewed','in_review','reviewed','flagged')),
  reviewer_email text,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Lock down: RLS on + revoke anon/authenticated. service_role bypasses RLS.
-- ---------------------------------------------------------------------------
alter table bot.conversation_feedback enable row level security;
alter table bot.faq_proposals         enable row level security;
alter table bot.review_status         enable row level security;

revoke all on bot.conversation_feedback from anon, authenticated;
revoke all on bot.faq_proposals         from anon, authenticated;
revoke all on bot.review_status         from anon, authenticated;

grant all on bot.conversation_feedback to service_role;
grant all on bot.faq_proposals         to service_role;
grant all on bot.review_status         to service_role;

commit;
