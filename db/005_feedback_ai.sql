-- Evelyn Ops — feedback detail + AI fix suggestions.
-- Additive to our app-owned table. Applied via MCP migration `feedback_detail_ai`.
--   detail          : structured note tied to the tag (e.g. title of the missing FAQ)
--   ai_suggestion   : Claude-generated fix suggestion (diagnosis, fix type, proposed FAQ)
--   ai_suggested_at : when the suggestion was generated

alter table bot.conversation_feedback
  add column if not exists detail          text,
  add column if not exists ai_suggestion   jsonb,
  add column if not exists ai_suggested_at timestamptz;
