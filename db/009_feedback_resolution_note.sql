-- Evelyn Ops — close the loop on feedback.
-- When resolving a feedback item, the resolver can say WHAT was done about it
-- ("raised the guardrail threshold", "fixed the club matcher", ...). The note
-- is shown in the inbox row and in the "What we've done with your feedback"
-- section at the top of the feedback page, so contributors see their input
-- turned into action. Applied via MCP migration `feedback_resolution_note`.

alter table bot.conversation_feedback
  add column if not exists resolution_note text;
