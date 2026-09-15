-- 044: tag a colleague in a board comment and they hear about it.
--
-- db/043 notifies the ONE person recorded as having asked for an item. This
-- covers the other half: pulling someone into a thread they are not the
-- requester of - "@esther does this match what you meant?".
--
-- MENTIONS ARE RESOLVED AND STORED, NOT RE-PARSED
-- The addresses are worked out once, when the comment is written, and saved on
-- the row. The notifier never re-reads the prose. That matters because a later
-- change to the parser would otherwise retroactively change who was notified
-- about a comment written months ago, and because "who did we actually tell"
-- should be a fact on the record rather than a function of today's code.
--
-- IT REUSES THE SAME RAIL
-- bot.requester_updates_since() already returns one row per recipient, and the
-- workflow already groups by recipient into a single mail. A mention is just
-- another recipient for a board comment, so it goes in as one more UNION branch
-- rather than a second function, a second watermark and a second workflow. A
-- colleague tagged on two items in the same hour gets one e-mail, not two.
--
-- WHO IS TAGGABLE
-- Whoever has written something in Evelyn Ops. That list maintains itself,
-- needs no admin screen, and cannot contain someone who could not read the item
-- anyway - sign-in is domain-restricted, so anyone in it has an account.
--
-- RESOLUTION IS DELIBERATELY STRICT (src/lib/queries.ts, resolveMentions)
-- "@esther", "@esther.rumora" and the full address all work. A bare word must
-- match exactly one person; two colleagues called Nick means the tag is dropped
-- rather than guessed, because mailing the wrong person is worse than mailing
-- nobody. The comment form lists the real handles so a dropped tag is rare.

ALTER TABLE bot.board_comments ADD COLUMN IF NOT EXISTS mentions text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN bot.board_comments.mentions IS
  'Lower-cased addresses tagged in this comment, resolved when it was written and never re-parsed. The record of who was actually notified, not a re-derivation from the prose.';

CREATE OR REPLACE FUNCTION bot.app_people()
 RETURNS TABLE(email text, handle text, writes bigint, last_seen timestamptz)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT lower(btrim(email)),
         split_part(lower(btrim(email)), '@', 1),
         count(*),
         max(at)
    FROM (
      SELECT author_email AS email, created_at AS at FROM bot.board_items
      UNION ALL SELECT author_email, created_at FROM bot.board_comments
      UNION ALL SELECT author_email, created_at FROM bot.conversation_feedback
      UNION ALL SELECT author_email, created_at FROM bot.knowledge_item_notes
    ) x
   WHERE email IS NOT NULL AND btrim(email) <> ''
   GROUP BY 1, 2
   ORDER BY 4 DESC;
$function$;

CREATE OR REPLACE FUNCTION bot.requester_updates_since()
 RETURNS TABLE(
   recipient_email text,
   source          text,
   item_id         uuid,
   created_at      timestamptz,
   author_email    text,
   title           text,
   body            text,
   link_path       text
 )
 LANGUAGE sql
 STABLE
AS $function$
  WITH wm AS (
    SELECT last_seen_at FROM bot.notify_watermarks WHERE key = 'requester_update_email'
  )
  SELECT lower(btrim(b.requested_by)),
         'board'::text,
         c.id,
         c.created_at,
         c.author_email,
         coalesce(nullif(btrim(b.title), ''), '(no title)'),
         coalesce(nullif(btrim(c.body), ''), ''),
         '/board'::text
    FROM bot.board_comments c
    JOIN bot.board_items b ON b.id = c.board_item_id
   CROSS JOIN wm
   WHERE c.created_at > wm.last_seen_at
     AND nullif(btrim(coalesce(b.requested_by, '')), '') IS NOT NULL
     AND lower(btrim(b.requested_by)) <> lower(btrim(coalesce(c.author_email, '')))
  UNION ALL
  -- Tagged in a comment. Excludes the author (you cannot tag yourself into an
  -- inbox) and the item's requester, who is already covered by the branch above
  -- and must not be mailed about the same comment twice.
  SELECT m.email,
         'board'::text,
         c.id,
         c.created_at,
         c.author_email,
         'you were tagged on: ' || coalesce(nullif(btrim(b.title), ''), '(no title)'),
         coalesce(nullif(btrim(c.body), ''), ''),
         '/board'::text
    FROM bot.board_comments c
    JOIN bot.board_items b ON b.id = c.board_item_id
   CROSS JOIN LATERAL unnest(c.mentions) AS m(email)
   CROSS JOIN wm
   WHERE c.created_at > wm.last_seen_at
     AND nullif(btrim(coalesce(m.email, '')), '') IS NOT NULL
     AND lower(btrim(m.email)) <> lower(btrim(coalesce(c.author_email, '')))
     AND lower(btrim(m.email)) IS DISTINCT FROM lower(btrim(coalesce(b.requested_by, '')))
  UNION ALL
  SELECT lower(btrim(f.requested_by)),
         'feedback'::text,
         f.id,
         f.resolved_at,
         coalesce(f.resolved_by, ''),
         coalesce(
           nullif(array_to_string(f.tags, ', '), ''),
           nullif(f.rating, ''),
           'feedback'
         ),
         coalesce(nullif(btrim(f.resolution_note), ''), ''),
         '/feedback'::text
    FROM bot.conversation_feedback f
   CROSS JOIN wm
   WHERE f.resolved_at IS NOT NULL
     AND f.resolved_at > wm.last_seen_at
     AND nullif(btrim(coalesce(f.resolution_note, '')), '') IS NOT NULL
     AND nullif(btrim(coalesce(f.requested_by, '')), '') IS NOT NULL
     AND lower(btrim(f.requested_by)) <> lower(btrim(coalesce(f.resolved_by, '')))
   ORDER BY 4;
$function$;

GRANT EXECUTE ON FUNCTION bot.app_people()              TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bot.requester_updates_since() TO anon, authenticated, service_role;
