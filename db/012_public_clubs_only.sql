-- Evelyn — only talk about clubs that are publicly launched.
-- Applied via MCP migrations `search_locations_public_clubs_only`,
-- `club_visibility_flag`, `public_locations_honour_sheet_status` (all 2026-08-26).
--
-- Why: Member Care reported the bot naming clubs that are not live to the public
-- ("London locations are not live yet"), listing all 10 Gymbox clubs and the 3
-- TrainMore London clubs by name in a public chat.
--
-- WHERE THIS DATA ACTUALLY COMES FROM (I got this wrong at first — it is NOT a
-- Magicline API sync): the n8n workflow "ugg gym data collection"
-- (49ZyB9tbZlqK3wW9) downloads the SharePoint workbook
-- UGG_Gym_Data_Collection_4.xlsx via Microsoft Graph every day at 12:00, parses
-- it, upserts into bot.locations, and PATCHes is_active = false on any row that
-- has disappeared from the sheet. `magicline_id` is merely a COLUMN in that
-- workbook, which is what made it look like a Magicline sync. The workbook is
-- the business-owned reference for club hours, facilities, tier and pricing.
--
-- The trap: EVERY row arrives status = 'Active' AND is_active = true, including
-- the 13 GB clubs. `is_active` only means "still present in the sheet", so it is
-- not the publication flag it looks like — filtering on it does nothing.
--
-- The first fix hardcoded country = 'NL'. That was wrong in the other direction:
-- TrainMore UK launches the week of 2026-08-31, so a hardcoded country would
-- have silently blocked it. Visibility is therefore one row per country that
-- someone can flip, with a single view both read paths share.
--
-- TO LAUNCH (no deploy, no prompt edit, takes effect immediately):
--   update bot.club_visibility set is_public = true
--    where country = 'GB' and brand = 'TrainMore';
--
-- Rehearsed on 2026-08-26: flipping GB on took the directory from 52 to 65 clubs,
-- the bot answered "yes, I can help with our UK clubs", gave Gymbox Holborn's
-- real hours, and correctly REFUSED to quote a day pass price for London
-- (the day pass figures in the prompt are Dutch euros only). Flipped back off.
--
-- UK PRICING is already handled: the workbook carries day_pass_price + currency
-- per club, including GBP figures for 10 of the 13 GB clubs, so the FAQ now reads
-- day pass prices from the directory instead of the hardcoded label rule it used
-- to have. That rule was wrong anyway — it claimed Amsterdam Oost was €30 when
-- the sheet says €25 (only Singel is €30). Membership prices are still never
-- quoted (the sheet's own price_notes says the starting fee can drop to 0
-- depending on promotion) — those still point at the join-now page.
--
-- BLOCKER FOR THE UK LAUNCH (found by rehearsing it on 2026-08-26): the three
-- TrainMore London rows in the workbook are EMPTY apart from name, country and
-- currency — no address, no opening hours, no day pass price, no facilities, no
-- tier. Flipping the switch would have the bot confirm the clubs exist and then
-- fail to answer anything about them. The 10 Gymbox rows are fully populated
-- (hours, GBP day pass, 7-13 facilities, addresses), so the gap is specific to
-- TrainMore London. Fill those rows in the workbook before launch day.
-- Also still needed: a UK join-now URL (the en-NL / nl-NL links are Dutch).

-- Keyed on (country, brand), not country alone: Gymbox London is an established
-- operating chain while TrainMore UK is the brand launching, so they need
-- independent switches. Default is CLOSED, so a new brand or country appearing
-- in the workbook is invisible until someone says otherwise.
CREATE TABLE IF NOT EXISTS bot.club_visibility (
  country    text    NOT NULL,
  brand      text    NOT NULL,
  is_public  boolean NOT NULL DEFAULT false,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (country, brand)
);

INSERT INTO bot.club_visibility (country, brand, is_public, note)
SELECT DISTINCT l.country, l.brand,
       (l.country = 'NL'),
       CASE WHEN l.country = 'NL' THEN 'Live.'
            ELSE 'Not public yet. Flip to true on launch day.' END
  FROM bot.locations l
 WHERE l.country IS NOT NULL AND l.brand IS NOT NULL
ON CONFLICT (country, brand) DO NOTHING;

-- Single definition of "a club the bot may talk about". Both the pre-login FAQ
-- directory (Bot - Public FAQ → Fetch Club Facts, which GETs
-- /rest/v1/public_locations) and the post-login Search Locations tool read
-- through this, so the rule cannot drift between them.
--
-- TWO independent controls, both fail closed:
--   country level : bot.club_visibility.is_public  (set here, in SQL)
--   club level    : the Status column in the WORKBOOK — set it to anything that
--                   reads as pre-launch and that club drops out after the next
--                   12:00 sync. No SQL, no deploy, owned by whoever maintains
--                   the sheet. Verified 2026-08-26 by marking Rotterdam Blaak
--                   'Pre-launch' (view 52 → 51, search_locations('Blaak') → 0)
--                   and restoring it.
CREATE OR REPLACE VIEW bot.public_locations AS
  SELECT l.*
    FROM bot.locations l
    JOIN bot.club_visibility v
      ON v.country = l.country AND v.brand = l.brand
   WHERE l.is_active = true
     AND v.is_public = true
     AND coalesce(l.status, '') !~* '(pre-?launch|coming[ _-]?soon|opening[ _-]?soon|not[ _-]?live|unpublished|hidden|draft|closed|inactive|on[ _-]?hold)';

GRANT SELECT ON bot.public_locations TO anon, authenticated, service_role;
GRANT SELECT ON bot.club_visibility  TO anon, authenticated, service_role;

-- Backs the "Search Locations" tool on the post-login Q&A agent, whose
-- description previously invited "Gymbox Bank" / "Gymbox Victoria" lookups.
CREATE OR REPLACE FUNCTION bot.search_locations(p_query text)
 RETURNS TABLE(club_name text, brand text, city text, address text, postcode text, hours jsonb, facilities jsonb, pricing jsonb, similarity real)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT l.club_name, l.brand, l.city, l.address, l.postcode,
         l.hours, l.facilities, l.pricing,
         similarity(l.club_name, p_query) AS similarity
    FROM bot.public_locations l
   WHERE l.club_name ILIKE '%' || p_query || '%'
      OR similarity(l.club_name, p_query) > 0.2
   ORDER BY similarity DESC
   LIMIT 3;
$function$;
