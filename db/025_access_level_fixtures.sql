-- 025: regression fixtures for the 2026-09-08 access-level work.
--
-- Feedback 923ec980 (Nelly Palikara) and 44a2f893 (Thallia El Haddad): the bot
-- answered "what are the access levels?" with invented tiers ("REGULAR",
-- "Gold Label", "Basic", "VIP") whenever no club had resolved, and in session
-- 3fb2c0e8 the invented level reached real ticket #634927.
--
-- Two deterministic guards now stand behind the prompt rules, and these
-- fixtures pin both of them:
--   outbound-access-level-guard/*  -> guard 4 in "Break Repeat Loop"
--                                     (Bot - Main, Ns0OsYgRawvQzWnw)
--   draft-recording-gate/*         -> the RECORDING GATE in "Validate Output"
--                                     (Bot - Ticket Collection Agent,
--                                      Yq2zEE9NQo6hQvnO)
--
-- These run through the PORTED path of Bot - Regression Test Harness
-- (q9Acjf33ByOnqJTp), so target_workflow_id stays NULL: the collection agent
-- cannot be driven from the harness (it needs session + draft context, and the
-- harness only maps user_message/history). The anti-drift check that DOES read
-- the deployed node bodies is tools/access-level-guard/ in this repo.
--
-- bot.regression_fixtures.key is UNIQUE, so every case gets its own key and the
-- harness dispatches on the longest registered key PREFIX.

insert into bot.regression_fixtures (key, title, description, input_payload, expected_result)
values
  ('outbound-access-level-guard/gold-label-742b7f8b',
   'Outbound guard: invented "Gold Label" is blocked',
   'Verbatim reply from session 742b7f8b (4 Sep 2026), the one Nelly reported: three access levels, each paired with a club label, one of which does not exist.',
   '{"reply_text":"At TrainMore Amsterdam West, the available access levels are:\n\n1. HOME (Black Label club)\n2. REGULAR (Red Label club)\n3. PREMIUM (Gold Label club)\n\nPlease let me know which access level you would like to change to!"}'::jsonb,
   '{"blocked":true,"token":"Gold Label"}'::jsonb),

  ('outbound-access-level-guard/vip-series-3fb2c0e8',
   'Outbound guard: invented "Basic/Premium/VIP" menu is blocked',
   'Verbatim reply from session 3fb2c0e8 (4 Sep 2026). A quoted SERIES of tier names is how the model offers an invented menu; a single quoted word must not trip the guard.',
   '{"reply_text":"Access level refers to the type of membership you have, which determines the services and facilities you can access at the club. For example, you might have options like ''Basic'', ''Premium'', or ''VIP''. Could you please let me know which access level you would like to have at Wibeautstraat?"}'::jsonb,
   '{"blocked":true,"token":"Basic"}'::jsonb),

  ('outbound-access-level-guard/premium-label-dutch',
   'Outbound guard: invented "Premium Label" in a Dutch reply is blocked',
   'The label/level mix-up in Dutch. 101 assistant messages across 68 sessions carried this shape between 15 Jul and 8 Sep 2026.',
   '{"reply_text":"Ik kan je daarbij helpen! Bij TrainMore Amsterdam zijn de beschikbare toegangsniveaus:\n\n1. HOME (Regular Label club)\n2. HOME+ (Black Label club)\n3. PREMIUM (Premium Label club)\n\nLaat me weten welk toegangsniveau je wilt kiezen!"}'::jsonb,
   '{"blocked":true,"token":"Premium Label"}'::jsonb),

  ('outbound-access-level-guard/home-plus-black-label',
   'Outbound guard: a real level paired with a label its own name does not mention',
   'HOME+ covers "Homeclub + Regular Label Clubs", so pairing it with Black Label is false. Naming a CLUB with its own label ("Amsterdam Oost (Black Label club)") must still pass, which is why the check is anchored on the real level names.',
   '{"reply_text":"Which access level would you like? 1) HOME+ (Black Label club) and 2) PREMIUM (Red Label club)."}'::jsonb,
   '{"blocked":true,"token":"HOME+ (Black Label club)"}'::jsonb),

  ('outbound-access-level-guard/vip-prose',
   'Outbound guard: "a VIP access level" in prose is blocked',
   'No list, no quotes — the tier sits directly in front of the phrase "access level". This is the shape that reached ticket #634927.',
   '{"reply_text":"Which access level would you like? You could pick a VIP access level if you want everything."}'::jsonb,
   '{"blocked":true,"token":"VIP"}'::jsonb),

  ('outbound-access-level-guard/ok-real-picker',
   'Outbound guard: FALSE-POSITIVE CONTROL — a correct priced picker passes untouched',
   'The real STEP 1 block from Build Priced Options. A guard that silently rewrote correct answers would be worse than the bug, so this case must never be blocked.',
   '{"reply_text":"📝 Which membership would you like at Amsterdam Scheldeplein?\n\n  1)  HOME (Homeclub only)  — from €54 per 4 weeks\n  2)  HOME+ (Homeclub + Regular Label Clubs)  — from €72 per 4 weeks\n  3)  PREMIUM (Homeclub + Regular & Black Label Clubs)  — from €79 per 4 weeks\n\nReply with the number or the name."}'::jsonb,
   '{"blocked":false,"token":null}'::jsonb),

  ('outbound-access-level-guard/ok-city-plus',
   'Outbound guard: FALSE-POSITIVE CONTROL — the CITY+ levels pass',
   'CITY and CITY+ exist in the live form data for Eindhoven, Rotterdam and Utrecht clubs only. A guard built from a HOME/HOME+/PREMIUM-only list would wrongly block these.',
   '{"reply_text":"📝 Welk toegangsniveau wil je bij Rotterdam Blaak?\n\n  1)  CITY+ (Homeclub + Regular Label Clubs Netherlands + Black Label Clubs Rotterdam)\n  2)  PREMIUM (Homeclub + Regular & Black Label Clubs)"}'::jsonb,
   '{"blocked":false,"token":null}'::jsonb),

  ('outbound-access-level-guard/ok-dutch-gold-verb',
   'Outbound guard: FALSE-POSITIVE CONTROL — the Dutch verb "gold" is not a tier',
   '"gold" is the past tense of "gelden" (applied / was valid). A naive /gold/ regex finds 10 assistant messages, 8 of them this verb; only 2 messages in 1 session ever said "Gold Label". Do not measure it with a bare word match.',
   '{"reply_text":"Het verzoek gold voor je toegangsniveau HOME+ en is al doorgezet naar een collega."}'::jsonb,
   '{"blocked":false,"token":null}'::jsonb),

  ('draft-recording-gate/vip-ticket-634927',
   'Recording gate: the ticket #634927 draft is rejected',
   'Verbatim subject and description of the real ticket filed on 4 Sep 2026 from session 3fb2c0e8. The access level must be one the live form data offers; VIP is not, so the field update is rejected and nothing invented is persisted for the stale-preview watchdog to submit.',
   '{"subject":"Change membership to Wibeautstraat","description":"User wants to change their membership to Wibeautstraat with VIP access level.","resolved_club":"","levels":["HOME (Homeclub only)","HOME+ (Homeclub + Regular Label Clubs)","PREMIUM (Homeclub + Regular & Black Label Clubs)"],"club_keys":["Amsterdam Scheldeplein (Black Label)","Amsterdam West Ladies (Regular Label)","Amsterdam Westerpark (Red Label)","Amsterdam van Woustraat (Regular Label)"]}'::jsonb,
   '{"rejected":"invented access level: VIP"}'::jsonb),

  ('draft-recording-gate/unresolved-club',
   'Recording gate: a club name that does not exist is rejected',
   'No access level claimed, but the destination club is a name the member typed and no live club key matches it. Only checked when Build Priced Options resolved no club, to keep the blast radius narrow.',
   '{"subject":"Club change","description":"User wants to move to Wibeautstraat.","resolved_club":"","levels":["HOME (Homeclub only)","PREMIUM (Homeclub + Regular & Black Label Clubs)"],"club_keys":["Amsterdam Scheldeplein (Black Label)","Amsterdam West Ladies (Regular Label)","Amsterdam Westerpark (Red Label)","Amsterdam van Woustraat (Regular Label)"]}'::jsonb,
   '{"rejected":"unverified club name: Wibeautstraat"}'::jsonb),

  ('draft-recording-gate/ok-real-club-and-level',
   'Recording gate: FALSE-POSITIVE CONTROL — a correct draft is recorded',
   'A real club, a real access level quoted in full, and a priced term. This must pass or every legitimate membership change would stall.',
   '{"subject":"Membership change request","description":"Member wants PREMIUM (Homeclub + Regular & Black Label Clubs) access level at Amsterdam Scheldeplein, term 1 year: €93.","resolved_club":"Amsterdam Scheldeplein (Black Label)","levels":["HOME+ (Homeclub + Regular Label Clubs)","PREMIUM (Homeclub + Regular & Black Label Clubs)"],"club_keys":["Amsterdam Scheldeplein (Black Label)","Amsterdam West Ladies (Regular Label)"]}'::jsonb,
   '{"rejected":null}'::jsonb)
on conflict (key) do update
  set title = excluded.title,
      description = excluded.description,
      input_payload = excluded.input_payload,
      expected_result = excluded.expected_result;
