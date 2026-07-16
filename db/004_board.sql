-- Evelyn Ops — team board (standalone items with priority + image attachments).
-- Additive, app-owned. Applied via MCP migration `board_items_and_bucket`.

create table if not exists bot.board_items (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  priority       text not null default 'medium'
                   check (priority in ('low', 'medium', 'high', 'urgent')),
  status         text not null default 'open'
                   check (status in ('open', 'in_progress', 'done', 'dismissed')),
  author_email   text not null,
  assignee_email text,
  image_paths    text[] not null default '{}',   -- paths in the board-attachments bucket
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists board_items_status_idx   on bot.board_items (status);
create index if not exists board_items_priority_idx on bot.board_items (priority);
create index if not exists board_items_created_idx  on bot.board_items (created_at desc);

alter table bot.board_items enable row level security;
revoke all on bot.board_items from anon, authenticated;
grant all on bot.board_items to service_role;

-- Private bucket for board image attachments. Accessed only server-side via
-- the service_role key; images are served through short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('board-attachments', 'board-attachments', false)
on conflict (id) do nothing;
