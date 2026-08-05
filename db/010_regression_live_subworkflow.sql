-- Evelyn Ops — drive a REAL bot sub-workflow from the regression harness.
--
-- Until now the harness (008) only replayed hand-ported copies of fixed bugs.
-- This turns it into a pre-prod feature gate: a fixture names a live n8n
-- sub-workflow (target_workflow_id); the harness Execute-Sub-workflow node
-- calls it with input_payload and returns its output as actual_result. A run
-- passes when actual_result matches expected_result.
--
-- First target: Bot - Classify Intent (VdXRxTK4GYFBTeQp) — pure, side-effect
-- free, temperature 0. Input: { user_message, history:[{role,content}] };
-- output: { intent }. These fixtures cover the classifier rules most likely to
-- regress when its prompt is edited, so a green suite is the approval artifact.

alter table bot.regression_fixtures
  add column if not exists target_workflow_id text;  -- null = legacy ported-logic fixture

-- Starter suite: Bot - Classify Intent -------------------------------------
insert into bot.regression_fixtures (key, title, description, target_workflow_id, input_payload, expected_result)
values
  ('intent-plain-question',
   'Plain info question → question',
   'A straightforward FAQ-style question with no escalation intent must classify as "question".',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "what are your opening hours on Sunday?", "history": []}'::jsonb,
   '{"intent": "question"}'::jsonb),

  ('intent-smalltalk',
   'Bare thanks → smalltalk',
   'Purely social message with no actionable content classifies as "smalltalk".',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "thanks, that''s all!", "history": []}'::jsonb,
   '{"intent": "smalltalk"}'::jsonb),

  ('intent-new-ticket',
   'Explicit new-ticket request → ticket_request',
   'User explicitly asks to open a new async ticket.',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "I want to open a ticket about a double charge this month", "history": []}'::jsonb,
   '{"intent": "ticket_request"}'::jsonb),

  ('intent-live-human',
   'Explicit live-agent request → human_request',
   'Real-time live-chat intent (distinct from an async ticket).',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "can I talk to a real person right now?", "history": []}'::jsonb,
   '{"intent": "human_request"}'::jsonb),

  ('intent-check-existing-tickets',
   'View existing tickets → question (NOT ticket_request)',
   'The create-vs-check rule: "see/show my tickets" is answered by an account tool, so it is a question.',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "can I see the status of my open tickets?", "history": []}'::jsonb,
   '{"intent": "question"}'::jsonb),

  ('intent-confirm-inherits-ticket',
   'Confirmation inherits a ticket offer → ticket_request',
   'Bare affirmative after the assistant offered SPECIFICALLY to open a ticket inherits ticket_request.',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "yes please", "history": [{"role": "user", "content": "my card was charged twice"}, {"role": "assistant", "content": "That sounds like a billing issue. Do you want me to open a ticket for our team to look into it?"}]}'::jsonb,
   '{"intent": "ticket_request"}'::jsonb),

  ('intent-confirm-inherits-verification',
   'Confirmation of a verification offer → question (NOT ticket_request)',
   'The subtle regression case: affirmative after an offer to send a verification code is handled by Q&A, so it is a question, never a ticket.',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "yes please", "history": [{"role": "user", "content": "can you check my other account bob@example.com"}, {"role": "assistant", "content": "I can verify that account. Shall I send a verification code to bob@example.com?"}]}'::jsonb,
   '{"intent": "question"}'::jsonb),

  ('intent-dutch-complaint',
   'Dutch new-ticket request → ticket_request',
   'Cross-language: semantic intent must be recognised, not just English keywords.',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "ik wil een klacht indienen over de sportschool", "history": []}'::jsonb,
   '{"intent": "ticket_request"}'::jsonb),

  ('intent-gibberish-unclear',
   'Gibberish with no context → unclear',
   'Random text with no semantic content and no resolving history is "unclear".',
   'VdXRxTK4GYFBTeQp',
   '{"user_message": "asdkfj", "history": []}'::jsonb,
   '{"intent": "unclear"}'::jsonb)
on conflict (key) do nothing;
