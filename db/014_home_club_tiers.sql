-- 014: expose club label (tier) data to the Q&A agent.
--
-- Member Care feedback, three separate items, one missing fact:
--   * Thallia (session ec0fe9c4, 21 Aug): "Koningenweg and Koningin
--     Wilhelminaplein are both Black Labels, so the bot could already tell the
--     member that a PREMIUM access level is needed to access both."
--   * Nick (session 27f3a180, 2 Aug): "you can not train at this gym with the
--     current membership" — the bot didn't know that.
--   * Amanda (session 09565309, 15 Jul): the bot blamed a failing QR code on a
--     device/technical fault at the other club. It wasn't: a HOME+ membership
--     does not include a second Black Label club, so the QR failing is the
--     expected access rule working correctly.
--
-- bot.locations.club_tier_type already carries the label (Black / Red /
-- Regular, populated for all 51 active TrainMore clubs) — it was simply never
-- surfaced to the bot. get_customer_home_club returned the home club without
-- its tier, and nothing gave the agent the tier of any OTHER club, which is
-- what all three questions are actually about.
--
-- Additive change: two new columns at the END of the result. The n8n caller
-- (Bot - Q&A / Intent Router -> "Fetch Home Club" -> "Format Home Club
-- Context") reads fields by name off rows[0], so existing reads are unaffected.
-- Built live from bot.locations rather than hardcoded in the prompt, so newly
-- provisioned clubs can't silently drift out of date the way the Zeilstraat
-- club did.

-- Postgres won't let CREATE OR REPLACE change a function's OUT parameters, so
-- this is a DROP + CREATE. It runs in one transaction, and the grants below
-- restore the ACL the dropped function carried
-- (PUBLIC/anon/authenticated/service_role EXECUTE) — without them PostgREST
-- would 404 the RPC and the bot would lose home-club context entirely.
DROP FUNCTION IF EXISTS bot.get_customer_home_club(uuid);

CREATE FUNCTION bot.get_customer_home_club(p_customer_id uuid)
 RETURNS TABLE(
   customer_id uuid,
   home_studio_id text,
   club_name text,
   brand text,
   city text,
   address text,
   postcode text,
   hours jsonb,
   facilities jsonb,
   pricing jsonb,
   club_tier_type text,
   club_tiers jsonb
 )
 LANGUAGE sql
 STABLE
AS $function$
  SELECT c.id, c.home_studio_id, l.club_name, l.brand, l.city,
         l.address, l.postcode, l.hours, l.facilities, l.pricing,
         l.club_tier_type,
         -- Every active club that HAS a label, as { "club name": "Black" }.
         -- Brands without labels (Gymbox, Clubsportive) are excluded rather
         -- than sent as nulls: the access rules below are TrainMore-only, and
         -- listing a club with a null tier would invite the agent to guess.
         (
           SELECT jsonb_object_agg(t.club_name, t.club_tier_type)
             FROM bot.locations t
            WHERE t.is_active = true
              AND t.club_tier_type IS NOT NULL
         ) AS club_tiers
    FROM bot.customers c
    LEFT JOIN bot.locations l
      ON l.magicline_id = c.home_studio_id AND l.is_active = true
   WHERE c.id = p_customer_id;
$function$;

GRANT EXECUTE ON FUNCTION bot.get_customer_home_club(uuid)
  TO anon, authenticated, service_role;
