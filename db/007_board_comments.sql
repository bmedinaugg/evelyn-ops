-- Evelyn Ops — comments on board items (text + optional image attachments).
-- Applied via MCP migration `board_comments`.
--
-- Lets the team reply/annotate a board item as they work it ("answer" a
-- ticket on the board). Each comment is internal (staff-only), may carry
-- images, and reuses the existing private `board-attachments` bucket.
-- Additive, app-owned; nothing existing is altered.

create table if not exists bot.board_comments (
  id             uuid primary key default gen_random_uuid(),
  board_item_id  uuid not null references bot.board_items(id) on delete cascade,
  author_email   text not null,
  body           text,
  image_paths    text[] not null default '{}',   -- paths in the board-attachments bucket
  created_at     timestamptz not null default now()
);

create index if not exists board_comments_item_idx
  on bot.board_comments (board_item_id, created_at);

alter table bot.board_comments enable row level security;
revoke all on bot.board_comments from anon, authenticated;
grant all on bot.board_comments to service_role;
