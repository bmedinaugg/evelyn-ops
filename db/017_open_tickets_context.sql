-- 017: give the ticket-collection agent the member's RECENT tickets, so it can
-- stop filing a second one for something they already sent us.
--
-- Board item 86d6830a (Esther Rumora, 1 Sep 2026): "Can the bot check if the
-- member already has a ticket open before it submits or shows links to the
-- contact forms - UNLESS it's for a different topic" + her comment: "before
-- stating to create a ticket, the bot should check if there are previous
-- tickets and say something like 'you don't need to open another ticket, but
-- you can add an update to one of your tickets'."
--
-- Measured 20 Aug - 3 Sep 2026, counting DISTINCT external_ticket_id (never
-- bot.tickets rows, which are one per submission attempt and routinely share a
-- Freshdesk id): 1,565 tickets from 1,385 members, 149 members with 2+, and
-- 36 cross-session pairs inside 24 hours. That cross-session slice is what this
-- addresses; the two other causes of double tickets are already handled --
-- submit-on-a-non-affirmative was fixed 22 Aug in Bot - Classify Confirmation
-- (13.9% -> 0.5%), and two genuinely different topics in one chat is correct
-- behaviour that must NOT be suppressed.
--
-- WHY HERE, AND NOT bot.todays_ticket:
-- bot.todays_ticket(p_session_id) already computes almost exactly this, but it
-- is consumed only by "Build Combined Post-Auth Reply" / "Pass Through Auth
-- Welcome" in Bot - Main -- i.e. it is surfaced in the LOGIN GREETING and never
-- consulted again when a second ticket is filed. It also `limit 1`s and returns
-- one row per ticket. Widening it would change the ROW COUNT an n8n HTTP node
-- receives, and n8n splits a multi-row response into one item per row, which
-- would make the welcome reply fan out. So it is left completely alone and this
-- function returns a single jsonb value instead.
--
-- WHY INSIDE `customer`:
-- Bot - Main maps this function's output into the sub-workflow with
-- "customer": "={{ $json.customer }}" -- the whole object, unmapped field by
-- field. Adding a key inside `customer` therefore reaches the collection agent
-- with NO change to Bot - Main's node wiring and no change to the sub-workflow
-- input schema. Reads naturally too: these are the customer's own tickets.
--
-- HONESTY CONSTRAINT: bot.tickets.status is 'open' for every row (1,686/1,686)
-- because we write it at creation and never sync it back from Freshdesk. So we
-- CANNOT know whether a ticket is still open. The field is named recent_tickets,
-- not open_tickets, and the prompt block that consumes it says "you already sent
-- us" rather than "you have an open ticket".

CREATE OR REPLACE FUNCTION bot.load_ticket_collection_context(p_draft_id uuid, p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'bot', 'public'
AS $function$
DECLARE
  v_draft      JSONB;
  v_customer   JSONB;
  v_missing    JSONB;
  v_session_id UUID;
  v_recent     JSONB;
BEGIN
  SELECT jsonb_build_object(
    'id',           id,
    'subject',      subject,
    'description',  description,
    'category',     category,
    'priority',     priority,
    'extra_fields', extra_fields
  ) INTO v_draft
  FROM bot.ticket_drafts WHERE id = p_draft_id;

  SELECT session_id INTO v_session_id FROM bot.ticket_drafts WHERE id = p_draft_id;

  -- Recent tickets for this member, EXCLUDING the chat they are in right now
  -- (a second ticket inside one chat is usually a genuinely different topic,
  -- and the in-session case is already covered by Has Draft Pointer? ->
  -- Build Already Submitted Reply). DISTINCT ON external_ticket_id collapses
  -- the several bot.tickets rows that share one Freshdesk ticket.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb)
    INTO v_recent
  FROM (
    SELECT DISTINCT ON (t.external_ticket_id)
           jsonb_build_object(
             'fd_id',      t.external_ticket_id,
             'subject',    t.subject,
             'category',   t.category,
             'created_at', to_char(t.created_at, 'YYYY-MM-DD'),
             'days_ago',   GREATEST(0, (CURRENT_DATE - t.created_at::date))
           ) AS x
      FROM bot.tickets t
     WHERE t.customer_id = p_customer_id
       AND t.external_ticket_id IS NOT NULL
       AND t.created_at > now() - interval '7 days'
       AND (v_session_id IS NULL OR t.session_id IS DISTINCT FROM v_session_id)
     ORDER BY t.external_ticket_id, t.created_at DESC
     LIMIT 5
  ) s;

  SELECT jsonb_build_object(
    'id',             id,
    'email',          email,
    'display_name',   display_name,
    'recent_tickets', COALESCE(v_recent, '[]'::jsonb)
  ) INTO v_customer
  FROM bot.customers WHERE id = p_customer_id;

  SELECT COALESCE(jsonb_agg(field), '[]'::jsonb) INTO v_missing
  FROM (
    SELECT 'subject'     AS field WHERE (v_draft->>'subject')     IS NULL
    UNION ALL
    SELECT 'description'           WHERE (v_draft->>'description') IS NULL
    UNION ALL
    SELECT 'category'              WHERE (v_draft->>'category')    IS NULL
    UNION ALL
    SELECT 'priority'              WHERE (v_draft->>'priority')    IS NULL
  ) m;

  RETURN jsonb_build_object(
    'draft',          v_draft,
    'customer',       v_customer,
    'missing_fields', v_missing
  );
END;
$function$;

-- CREATE OR REPLACE keeps the existing ACL (the return type is unchanged --
-- only the contents of the jsonb differ), but re-granting is harmless and
-- guards against a future DROP+CREATE losing it, which is what migration 014
-- had to recover from.
GRANT EXECUTE ON FUNCTION bot.load_ticket_collection_context(uuid, uuid)
  TO anon, authenticated, service_role;
