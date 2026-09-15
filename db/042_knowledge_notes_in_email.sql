-- 042: include notes written on /knows in the hourly new-item email.
--
-- Same move as db/016 made for board replies: one more UNION ALL branch on
-- bot.board_feedback_since(), signature untouched, so the watermark, the muting
-- and the mark-seen call all keep working exactly as they are.
--
-- ONE FUNCTION, NOT A SECOND NOTIFIER
-- A separate workflow for knowledge notes would need its own watermark, its own
-- mute list and its own failure mode, and would send a second email an hour.
-- Everything worth telling Bryan about arrives on one rail.
--
-- WHY author_email IS THE NOTE'S AUTHOR
-- Load-bearing, for the same reason it is on board comments: the workflow mutes
-- rows written by the recipient. So his own notes are silent, and a note
-- written by anyone else reaches him -- which is the entire request.
--
-- THE LINK IS DEEP
-- /knows?open=<key> rather than /knows. The page reads `open` and expands that
-- exact row, so a mail about one note lands on that note rather than at the top
-- of a page holding 229 items and 20 gaps. Both item keys ("freshdesk:1030...")
-- and gap keys ("gap:how-and-where-to-cancel") are safe unencoded in a query
-- value; the colon is legal there.
--
-- WHY THE TITLE JOINS BOTH TABLES
-- One notes table serves knowledge items and gaps, keyed softly, so the subject
-- line has to resolve against whichever it is. A note whose row has since been
-- retired by a regenerate still mails, falling back to the raw key rather than
-- going out blank -- losing the note is worse than an ugly subject line.
--
-- THE CALLER NEEDED CHANGING TOO, WHICH db/016 DID NOT
-- "Board & Feedback - New Item Email" grouped rows by an explicit list of
-- source names in its Build Email node. A source missing from that list still
-- counted toward the watermark and then vanished from the body -- an email that
-- looks empty and a row that never arrives again. That node now drives its
-- sections from one table and mails anything unrecognised under OTHER, so the
-- next source added here cannot disappear silently.

CREATE OR REPLACE FUNCTION bot.board_feedback_since()
 RETURNS TABLE(source text, item_id uuid, created_at timestamp with time zone, author_email text, title text, body text, link_path text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH wm AS (
    SELECT last_seen_at FROM bot.notify_watermarks WHERE key = 'board_feedback_email'
  )
  SELECT 'board'::text,
         b.id,
         b.created_at,
         b.author_email,
         coalesce(nullif(btrim(b.title), ''), '(no title)'),
         coalesce(nullif(btrim(b.description), ''), ''),
         '/board'::text
    FROM bot.board_items b, wm
   WHERE b.created_at > wm.last_seen_at
  UNION ALL
  SELECT 'comment'::text,
         c.id,
         c.created_at,
         c.author_email,
         'reply on ' || split_part(coalesce(b.author_email, 'someone@'), '@', 1)
                     || '''s item: ' || coalesce(nullif(btrim(b.title), ''), '(no title)'),
         coalesce(nullif(btrim(c.body), ''), ''),
         '/board'::text
    FROM bot.board_comments c
    JOIN bot.board_items b ON b.id = c.board_item_id
   CROSS JOIN wm
   WHERE c.created_at > wm.last_seen_at
  UNION ALL
  SELECT 'feedback'::text,
         f.id,
         f.created_at,
         f.author_email,
         coalesce(
           nullif(array_to_string(f.tags, ', '), ''),
           nullif(f.rating, ''),
           'feedback'
         ),
         coalesce(nullif(btrim(f.detail), ''), nullif(btrim(f.comment), ''), ''),
         '/feedback'::text
    FROM bot.conversation_feedback f, wm
   WHERE f.created_at > wm.last_seen_at
  UNION ALL
  SELECT 'knowledge'::text,
         k.id,
         k.created_at,
         k.author_email,
         coalesce(g.subject, i.title, k.item_key) || ' (' || k.kind || ')',
         coalesce(nullif(btrim(k.note), ''), ''),
         '/knows?open=' || k.item_key
    FROM bot.knowledge_item_notes k
    LEFT JOIN bot.knowledge_items i ON i.key = k.item_key
    LEFT JOIN bot.knowledge_gaps  g ON g.key = k.item_key
   CROSS JOIN wm
   WHERE k.created_at > wm.last_seen_at
   ORDER BY 3;
$function$;

GRANT EXECUTE ON FUNCTION bot.board_feedback_since() TO anon, authenticated, service_role;
