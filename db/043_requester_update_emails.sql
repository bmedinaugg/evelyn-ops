-- 043: tell the person who asked for something when it gets an update.
--
-- WHY author_email COULD NOT BE USED
-- Board items and feedback both already record an author, but that is whoever
-- typed it into Evelyn Ops - almost always Bryan, relaying something Esther or
-- Nelly raised in Teams, in an e-mail, or in a corridor. The person who
-- actually asked is not in the database at all, which is why they never hear
-- back. requested_by is that person, and it is separate from author_email
-- precisely because they are usually different people.
--
-- HOW THIS DIFFERS FROM db/015
-- That notifier mails ONE fixed address about everything new. This one mails a
-- DIFFERENT person per row, and only the one who asked. Same watermark
-- discipline, but its own key: sharing a watermark would mean a failure in
-- either mail silently suppressing the other.
--
-- WHAT COUNTS AS AN UPDATE
-- A comment on a board item, or a resolution note on feedback. Both are
-- explicit acts of writing something for someone to read. Status changes are
-- deliberately NOT included in this version: "done" is one click, and a click
-- that mails a colleague is a click nobody can take back.
--
-- TWO GUARDS, BOTH IN SQL RATHER THAN IN THE WORKFLOW
--   * no requested_by, no mail - silence is correct when nobody is waiting
--   * never mail someone their own update, which would otherwise happen the
--     moment a requester replies on their own item
-- They live here so a second caller cannot forget them.
--
-- A THIRD GUARD LIVES IN THE APP
-- setRequestedBy() in src/lib/queries.ts refuses any address outside
-- STAFF_EMAIL_DOMAIN. This field auto-sends the moment an update is written, so
-- a mistyped domain would deliver an internal work note to a stranger with no
-- way to recall it. Sign-in is restricted to the same domain anyway, so a
-- requester outside it could not read the item being discussed.
--
-- The watermark is seeded to now(), so switching this on mails nobody about
-- anything that already happened.

ALTER TABLE bot.board_items          ADD COLUMN IF NOT EXISTS requested_by text;
ALTER TABLE bot.conversation_feedback ADD COLUMN IF NOT EXISTS requested_by text;

COMMENT ON COLUMN bot.board_items.requested_by IS
  'E-mail of the person who actually asked for this, when that is not the author. author_email is whoever typed it into Evelyn Ops; this is who is waiting to hear back. Null means nobody is notified.';
COMMENT ON COLUMN bot.conversation_feedback.requested_by IS
  'E-mail of the person who raised this feedback, when that is not the author. Null means nobody is notified.';

INSERT INTO bot.notify_watermarks (key, last_seen_at)
VALUES ('requester_update_email', now())
ON CONFLICT (key) DO NOTHING;

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
  -- Feedback has no comment table; the resolution note IS the update, so the
  -- row's own resolved_at is when it was written.
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

-- RETURNS TABLE, not a scalar: PostgREST renders a scalar-returning function as
-- a bare JSON string and n8n rejects it as invalid JSON. Same trap as db/015.
CREATE OR REPLACE FUNCTION bot.requester_updates_mark_seen(p_seen_at timestamptz)
 RETURNS TABLE(last_seen_at timestamptz)
 LANGUAGE sql
 VOLATILE
AS $function$
  UPDATE bot.notify_watermarks
     SET last_seen_at = GREATEST(bot.notify_watermarks.last_seen_at, p_seen_at),
         updated_at   = now()
   WHERE key = 'requester_update_email'
  RETURNING bot.notify_watermarks.last_seen_at;
$function$;

GRANT EXECUTE ON FUNCTION bot.requester_updates_since()                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION bot.requester_updates_mark_seen(timestamptz) TO anon, authenticated, service_role;
