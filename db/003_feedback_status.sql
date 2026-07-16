-- Evelyn Ops — make conversation_feedback an actionable inbox.
-- Additive to our own app-owned table. Adds a workflow status so the
-- maintainer can triage feedback as action items (open → resolved/dismissed).
-- Applied via MCP migration `feedback_status`.

alter table bot.conversation_feedback
  add column if not exists status      text not null default 'open',
  add column if not exists resolved_by text,
  add column if not exists resolved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'conversation_feedback_status_chk'
  ) then
    alter table bot.conversation_feedback
      add constraint conversation_feedback_status_chk
      check (status in ('open', 'resolved', 'dismissed'));
  end if;
end $$;

create index if not exists conversation_feedback_status_idx
  on bot.conversation_feedback (status);
