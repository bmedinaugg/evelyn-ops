-- 045: if you are named in "Asked by", you get the mail. Even if it is you.
--
-- db/043 refused to mail someone their own update. The reasoning was that a
-- requester replying on their own item should not e-mail themselves. It is a
-- defensible default and it was the wrong call, for a reason worth writing
-- down: requested_by is an EXPLICIT instruction. Somebody typed an address into
-- a box that says "this person gets an e-mail". Silently overriding that
-- because the code thinks it knows better is precisely the behaviour that made
-- the feature look broken - three test comments, no mail, no explanation.
--
-- Predictable beats clever here. The field now does exactly what it says.
--
-- The cost is real and accepted: if the requester writes the update themselves,
-- they get a copy of their own words. That is mildly redundant, and it is
-- explicable in one sentence, which the previous silence was not.
--
-- THE MENTION GUARD STAYS
-- You still cannot tag yourself into your own inbox. That is not the same
-- thing: a mention is a message aimed at someone else by construction, so
-- @-ing yourself is a typo rather than an instruction. Unlike requested_by
-- there is no box promising it will do something.
--
-- A SECOND FAULT WAS HIDING BEHIND THIS ONE
-- The workflow's Build Emails node had been stored with real line breaks inside
-- string literals instead of \n escapes - a SyntaxError from the moment it was
-- created. It never surfaced because every run until now returned zero rows,
-- and n8n skips a node with no input, so the code was never parsed. Removing
-- the guard above is what finally produced rows and exposed it. The node has
-- been rebuilt using String.fromCharCode(10) so no newline escape crosses that
-- transport at all; the same escape had already been mangled once.
--
-- Lesson for the next notifier: a run that "succeeds" against an empty queue
-- proves nothing. Force rows through before believing it works.

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
  UNION ALL
  -- Tagged in a comment. Still excludes the author, because @-ing yourself is a
  -- typo rather than an instruction, and excludes the item's requester, who the
  -- branch above already mails about this same comment.
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
   ORDER BY 4;
$function$;

GRANT EXECUTE ON FUNCTION bot.requester_updates_since() TO anon, authenticated, service_role;
