-- 048: what the Magicline API can answer, and what Member Care wants it to.
--
-- /knows covers what Evelyn knows from DOCUMENTS — FAQ articles, the club sheet,
-- rules typed into prompts. None of that is where account answers come from:
-- contract dates, balances, check-ins and bookings are read live from Magicline
-- per question, and nothing on the page listed them. This is that list.
--
-- THE `allowed` COLUMN IS A RECORD, NOT A SWITCH.
-- Deliberate, and agreed before building: nothing reads it yet. Unticking a row
-- states that Member Care does not want Evelyn answering that, and the page says
-- so in those words. Wiring it means Bot - Q&A reading this table on each turn
-- and refusing the unticked capabilities — a separate change, an n8n publish,
-- and worth doing only once the list itself has been argued over.
--
-- Naming it `allowed` rather than `wanted` is a small bet that it WILL be wired.
-- If that bet is lost, rename it; do not quietly repurpose it for something else.
--
-- `wired` is the other axis and is a fact, not a preference: whether the bot can
-- reach it at all today. Most of the club/product side is false — those answers
-- exist in Magicline and the bot reads hand-maintained copies instead. Keeping
-- the two columns apart stops "we do not allow it" and "we never built it" from
-- being read as the same thing, which is exactly the confusion this page exists
-- to prevent elsewhere.

CREATE TABLE IF NOT EXISTS bot.magicline_capabilities (
  key         text PRIMARY KEY,
  sort_order  integer NOT NULL,
  area        text NOT NULL CHECK (area IN ('account', 'clubs')),
  question    text NOT NULL,
  source_api  text NOT NULL CHECK (source_api IN ('open_api', 'connect_api')),
  backed_by   text NOT NULL,
  wired       boolean NOT NULL DEFAULT false,
  allowed     boolean NOT NULL DEFAULT true,
  note        text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bot.magicline_capabilities IS
  'One row per thing the Magicline API can answer. Rendered on /knows.';
COMMENT ON COLUMN bot.magicline_capabilities.allowed IS
  'What Member Care wants. NOTHING READS THIS YET - it is a recorded intent, not a control. See db/048.';
COMMENT ON COLUMN bot.magicline_capabilities.wired IS
  'Whether the bot can reach it today. A fact about the build, not a preference.';
COMMENT ON COLUMN bot.magicline_capabilities.backed_by IS
  'The n8n tool or the API endpoint behind it, so a row can be traced to something real.';

INSERT INTO bot.magicline_capabilities
  (key, sort_order, area, question, source_api, backed_by, wired, note)
VALUES
  -- Account answers: Open API, only after the member has logged in.
  ('contract_end', 10, 'account', 'When does my contract end? Am I still in my minimum term?',
   'open_api', 'ML - get contract info', true,
   'endDate is the end of the CURRENT period, not the membership. term can arrive in DAYs.'),
  ('contract_price', 20, 'account', 'What am I paying right now?',
   'open_api', 'ML - get contract info (price, priceDetails)', true,
   'Returned by the API, but the collection agent is currently instructed never to quote it.'),
  ('cancel_by', 30, 'account', 'What is the last date I can cancel by?',
   'open_api', 'ML - get contract info (lastPossibleCancellationDate)', true,
   'An exact field. No arithmetic needed.'),
  ('contract_extras', 40, 'account', 'What extras are included in my membership?',
   'open_api', 'ML - get contract info (moduleContracts)', true, NULL),
  ('signed_contract', 50, 'account', 'Can I see my signed contract?',
   'open_api', 'ML - get contract info (signedDocumentUrl)', true,
   'A signed, expiring link to the PDF.'),
  ('next_charge', 60, 'account', 'When is my next payment and how much?',
   'open_api', 'ML - get upcoming payments', true, NULL),
  ('balance', 70, 'account', 'Do I owe anything?',
   'open_api', 'ML - get account balance', true, NULL),
  ('past_payments', 80, 'account', 'What was I charged, and when?',
   'open_api', 'ML - get past transactions', true, NULL),
  ('access_block', 90, 'account', 'Why can''t I get into the club?',
   'open_api', 'ML - get access status', true,
   'Gives the reason, e.g. an access refusal from an unpaid invoice.'),
  ('freeze_status', 100, 'account', 'Am I frozen right now, and until when?',
   'open_api', 'ML - get access status (idlePeriods)', true,
   'idlePeriods was not present in the sampled payload - verify against a frozen member.'),
  ('profile', 110, 'account', 'What is my membership number / what is on file for me?',
   'open_api', 'ML - get access status (profile)', true, NULL),
  ('last_visit', 120, 'account', 'When was I last at the gym? How often do I come?',
   'open_api', 'ML - get check-in history', true, NULL),
  ('other_clubs', 130, 'account', 'Which other clubs have I trained at?',
   'open_api', 'ML - get cross-studio check-ins', true, NULL),
  ('my_bookings', 140, 'account', 'What classes am I booked into?',
   'open_api', 'ML - get my class bookings', true, NULL),
  ('cancel_booking', 150, 'account', 'Cancel a class booking for me',
   'open_api', 'ML - cancel class booking', true,
   'The only capability here that WRITES. Everything else is read-only.'),
  ('class_slots', 160, 'account', 'What classes are on today?',
   'open_api', 'ML - get class slots / class slot detail', true, NULL),
  ('appointments', 170, 'account', 'What PT or appointments do I have?',
   'open_api', 'ML - get my appointments / appointment offerings', true, NULL),
  ('purchased', 180, 'account', 'What have I bought - PT packs, day passes?',
   'open_api', 'ML - get purchased offers', true, NULL),
  ('busyness', 190, 'account', 'How busy is my gym right now?',
   'open_api', 'ML - get studio utilization', true,
   'Wired but unconfirmed: the public Connect equivalent is disabled on all 22 studios tested, and this tool''s formatter guesses at three possible response shapes.'),
  -- Club and product answers: Connect API, no login needed. Almost none wired.
  ('club_price', 200, 'clubs', 'What does a membership cost at a given club?',
   'connect_api', 'GET /connect/v1/rate-bundle', false,
   'The bot quotes hand-typed Freshdesk dropdown labels instead. Magicline has the authoritative number.'),
  ('club_levels', 210, 'clubs', 'Which access levels does a club sell?',
   'connect_api', 'GET /connect/v1/rate-bundle', false, NULL),
  ('club_hours', 220, 'clubs', 'What are the opening hours at a club?',
   'connect_api', 'GET /connect/v2/studio (openingHours)', false,
   'The bot reads these from an Excel workbook nobody has been able to locate.'),
  ('club_where', 230, 'clubs', 'Where is a club, and what is its phone number?',
   'connect_api', 'GET /connect/v2/studio (address, studioPhone)', false, NULL),
  ('trial_slots', 240, 'clubs', 'Can I book a trial, and when is there a slot?',
   'connect_api', 'GET /connect/v1/trialsession', false,
   'Free trials are a recurring ticket theme and the bot cannot see a single slot.'),
  ('cancel_online', 250, 'clubs', 'Can I cancel online at this club?',
   'connect_api', 'GET /connect/v2/studio (enabledForOnlineCancelation)', false, NULL),
  ('cancel_reasons', 260, 'clubs', 'What reasons can I give for cancelling?',
   'connect_api', 'GET /connect/v1/contracts/studios/{id}/cancellation-reasons', false, NULL),
  ('legal_links', 270, 'clubs', 'Where are the terms and the privacy policy?',
   'connect_api', 'GET /connect/v2/studio/{id}/legalinfo', false, NULL),
  ('voucher_check', 280, 'clubs', 'Is this voucher code real, and what does it give me?',
   'connect_api', 'GET /connect/v1/contractvoucher/{code}/validate', false,
   'Lookup by code only. No endpoint in either API lists the codes that exist.')
ON CONFLICT (key) DO NOTHING;

-- Read by the page; written only through the server action.
CREATE OR REPLACE FUNCTION bot.magicline_capabilities_view()
RETURNS SETOF bot.magicline_capabilities
LANGUAGE sql STABLE
AS $$
  SELECT * FROM bot.magicline_capabilities ORDER BY sort_order;
$$;

GRANT EXECUTE ON FUNCTION bot.magicline_capabilities_view() TO authenticated, service_role;
