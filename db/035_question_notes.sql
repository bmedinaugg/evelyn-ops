-- How a question SHOULD be answered, written by Member Care when the bot gets
-- it wrong.
--
-- WHY THIS IS NOT A COLUMN ON bot.question_traces
-- Because that table is rebuilt wholesale. tools/questions/seed.js refreshes it
-- with a delete-all followed by an insert, so that the example quotes and the
-- counts can be regenerated from a newer window of member messages. A note
-- stored on the trace row would be destroyed by the next refresh — silently,
-- and only noticed when someone went looking for a correction they had written
-- a fortnight earlier.
--
-- WHY THERE IS NO FOREIGN KEY
-- For the same reason, and it cuts both ways:
--   * ON DELETE CASCADE would delete every note the moment the traces refresh.
--   * A plain foreign key would make the refresh FAIL as soon as one note
--     existed, because the delete-all could not run.
-- So question_key is a soft reference. A note whose question has since been
-- renamed or dropped survives here and simply stops being displayed — which is
-- the right trade: losing the record of what someone raised is worse than
-- showing it without its question.
--
-- The `Done` button sets resolved_at rather than deleting. The value is the
-- record of what was raised and when, not a tidy list.

create table if not exists bot.question_notes (
  id           uuid primary key default gen_random_uuid(),
  question_key text not null,
  author_email text not null,
  should_be    text not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  text
);

create index if not exists question_notes_key_idx
  on bot.question_notes (question_key, created_at desc);

comment on table bot.question_notes is
  'How a question SHOULD be answered, written by Member Care when the bot gets it wrong. Deliberately has NO foreign key to bot.question_traces: that table is rebuilt by tools/questions/seed.js with a delete-all followed by an insert, so a cascading FK would destroy every note on the next refresh and a plain FK would make the refresh fail. The key is a soft reference on purpose.';
comment on column bot.question_notes.should_be is
  'The correction itself: what the bot should say instead. This is the part that becomes work.';
comment on column bot.question_notes.question_key is
  'Soft reference to bot.question_traces.key. A note whose question has been renamed or dropped survives here and is simply no longer shown; that is preferred to losing it.';

create or replace function bot.question_notes_open()
returns table (
  id uuid, question_key text, question text, author_email text,
  should_be text, created_at timestamptz, chain_label text, change_cost text
)
language sql
stable
as $function$
  select n.id, n.question_key, q.question, n.author_email, n.should_be,
         n.created_at, q.chain_label, q.change_cost
  from bot.question_notes n
  left join bot.question_traces q on q.key = n.question_key
  where n.resolved_at is null
  order by n.created_at desc;
$function$;

comment on function bot.question_notes_open is
  'Open corrections, newest first, with the question they belong to. Left join: a note outlives its question deliberately.';
