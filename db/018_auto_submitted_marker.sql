-- 018: mark a draft that was submitted by the preview-timeout watchdog, so the
-- ticket post-processing step can send a different member e-mail for it.
--
-- Board item 83108c2a (Esther Rumora, 1 Sep 2026): "Evelyn auto-submit: let's
-- automatically close them and have them only reopened by member if they reply",
-- with her wording: "You were about to submit a ticket to us, but the chat
-- expired ... reply to this e-mail with Yes."
--
-- WHY A DB MARKER AND NOT A FLAG PASSED THROUGH THE WORKFLOWS:
-- The "Your ticket has been created successfully ... within 2 business days"
-- e-mail is not a Freshdesk rule at all -- it is our own n8n node,
-- `Send Reply Email` in `Bot - Ticket post-processing` (oGKjMkWozlsdliYl).
-- To send a different e-mail we only have to branch there. But that workflow
-- cannot be told the ticket was auto-submitted:
--   * `Bot - Auto-submit stale ticket previews` -> `Dispatch to Ticket Creation`
--     is passthrough, so a flag DOES reach `Bot - Ticket creation`; but
--   * `Bot - Ticket creation`'s `Normalize Input` is a whitelist Set node
--     (15 named fields, includeOtherFields off) and its
--     `Dispatch Post-Processing` node forwards only 4 of them, so any extra
--     field is dropped before post-processing sees it.
-- Editing `Bot - Ticket creation` to widen that whitelist is possible but it
-- currently carries an UNPUBLISHED draft (the `Check Open Tickets` wiring), and
-- publishing our change would publish that too. So the watchdog records the
-- fact here instead, and post-processing reads it back by session id.
--
-- Not reusing ticket_drafts.extra_fields: PostgREST PATCH replaces a jsonb
-- column wholesale, so writing the marker there would silently drop anything
-- else a draft happens to carry.
--
-- Nullable with no default, so every existing row and every normal
-- member-confirmed submission stays NULL and behaves exactly as before.

ALTER TABLE bot.ticket_drafts
  ADD COLUMN IF NOT EXISTS auto_submitted_at timestamptz;

COMMENT ON COLUMN bot.ticket_drafts.auto_submitted_at IS
  'Set by Bot - Auto-submit stale ticket previews immediately before it dispatches '
  'to ticket creation. NULL means the member confirmed the preview themselves. '
  'Read back by Bot - Ticket post-processing to decide which member e-mail to send; '
  'that lookup requires the timestamp to be recent, so an older auto-submitted '
  'draft in the same session cannot mislabel a later manual one.';

-- The lookup is: drafts for this session, auto_submitted_at within the last few
-- minutes, newest first. Session id + a partial index on the marker keeps it
-- cheap without adding an index that only matters for a small subset of rows.
CREATE INDEX IF NOT EXISTS ticket_drafts_auto_submitted_idx
  ON bot.ticket_drafts (session_id, auto_submitted_at DESC)
  WHERE auto_submitted_at IS NOT NULL;
