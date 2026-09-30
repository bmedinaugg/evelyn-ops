-- One place for Member Care to say "this case should behave differently",
-- anchored to the case it is about.
--
-- WHY A FIFTH FEEDBACK TABLE, AND WHY IT REPLACES THE OTHER FOUR
-- Corrections arrive today through bot.question_notes (a question trace),
-- bot.knowledge_item_notes (a document), bot.faq_proposals (a new FAQ),
-- bot.conversation_feedback (a conversation) and bot.board_items (anything).
-- Which one a note lands in depends on which page the author was on, so two
-- people correcting the same behaviour write to two tables and neither sees
-- the other. Implementing a note means first working out which case it is
-- about. This table makes the CASE the unit: a proposal names the case_library
-- row it changes, and there can be only one open proposal per case, so a
-- second opinion has to be written ON the first one rather than beside it.
--
-- WHY THE KEY IS SOFT
-- Same reason as bot.question_notes: case_library rows are content that gets
-- renamed and re-seeded. A proposal outlives its case and is simply shown
-- without one. No foreign key on purpose.
--
-- WHO DECIDES
-- Anyone signed in can propose, agree, object or comment. Only an approver
-- (CASES_APPROVERS in the app env) can accept, reject or mark implemented.
-- Enforced in the app, not here: the data client is service-role.

create table if not exists bot.case_proposals (
  id            uuid primary key default gen_random_uuid(),
  -- Soft reference to bot.case_library.key. Null only for kind = 'missing'.
  case_key      text,
  -- Free title, used when case_key is null (a case the library lacks).
  title         text,
  kind          text not null,
  -- What the bot should do or say instead. The part that becomes work.
  should_be     text not null,
  -- Why: what it does today, or what happened. Optional.
  rationale     text,
  -- The real conversation this was seen in, if any. Soft reference to
  -- bot.sessions.session_id so the page can link straight to the transcript.
  example_session_id text,
  status        text not null default 'open',
  proposed_by   text not null,
  created_at    timestamptz not null default now(),
  decided_by    text,
  decided_at    timestamptz,
  decision_note text,
  constraint case_proposals_kind_ck check (kind in (
    'wrong_fact',      -- the answer states something untrue
    'wrong_source',    -- the answer comes from the wrong place
    'wrong_behaviour', -- the bot does the wrong thing (should link / ticket / answer / refuse)
    'missing'          -- a case the library does not have
  )),
  constraint case_proposals_status_ck check (status in (
    'open', 'accepted', 'implemented', 'rejected', 'withdrawn'
  )),
  constraint case_proposals_anchor_ck check (
    (kind = 'missing' and title is not null) or (kind <> 'missing' and case_key is not null)
  )
);

-- The conflict guard: one open proposal per case. A second person lands on
-- the first proposal and agrees or objects there.
create unique index if not exists case_proposals_one_open_idx
  on bot.case_proposals (case_key) where status = 'open' and case_key is not null;

create index if not exists case_proposals_case_idx
  on bot.case_proposals (case_key, created_at desc);
create index if not exists case_proposals_status_idx
  on bot.case_proposals (status, created_at desc);

create table if not exists bot.case_proposal_comments (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references bot.case_proposals(id) on delete cascade,
  author_email  text not null,
  -- agree / object / comment. An objection is what makes a proposal
  -- "disputed" on the list, so a disagreement is visible before it is
  -- implemented rather than after.
  stance        text not null default 'comment',
  body          text,
  created_at    timestamptz not null default now(),
  constraint case_proposal_comments_stance_ck check (stance in ('agree', 'object', 'comment'))
);

create index if not exists case_proposal_comments_proposal_idx
  on bot.case_proposal_comments (proposal_id, created_at);

alter table bot.case_proposals enable row level security;
alter table bot.case_proposal_comments enable row level security;
revoke all on bot.case_proposals from anon, authenticated;
revoke all on bot.case_proposal_comments from anon, authenticated;
grant all on bot.case_proposals to service_role;
grant all on bot.case_proposal_comments to service_role;

comment on table bot.case_proposals is
  'A proposed change to how Evelyn handles one case (bot.case_library.key, soft reference). One open proposal per case, enforced by a partial unique index, so disagreement is written on the proposal rather than beside it. Replaces question_notes / knowledge_item_notes / faq_proposals as the place corrections go.';
comment on column bot.case_proposals.should_be is
  'What the bot should do or say instead. This is the part that becomes work.';
comment on column bot.case_proposals.example_session_id is
  'Soft reference to bot.sessions.session_id: the conversation this was seen in.';
comment on table bot.case_proposal_comments is
  'Replies on a proposal. stance = object marks the proposal disputed on the list.';

-- Proposals with their comment tallies, for the list and detail pages.
create or replace function bot.case_proposals_view()
returns table (
  id uuid, case_key text, title text, kind text, should_be text, rationale text,
  example_session_id text, status text, proposed_by text, created_at timestamptz,
  decided_by text, decided_at timestamptz, decision_note text,
  agree_n integer, object_n integer, comment_n integer
)
language sql
stable
as $$
  select p.id, p.case_key, p.title, p.kind, p.should_be, p.rationale,
         p.example_session_id, p.status, p.proposed_by, p.created_at,
         p.decided_by, p.decided_at, p.decision_note,
         count(*) filter (where c.stance = 'agree')::int,
         count(*) filter (where c.stance = 'object')::int,
         count(*) filter (where c.stance = 'comment')::int
  from bot.case_proposals p
  left join bot.case_proposal_comments c on c.proposal_id = p.id
  group by p.id
  order by p.created_at desc;
$$;

comment on function bot.case_proposals_view is
  'Every proposal with agree / object / comment counts. Newest first.';
