-- Evelyn Ops — "member thanked the bot" signal for the Bot helped page.
-- Applied via MCP migration `digest_details_add_thanked`.
--
-- Why: "Bot helped" previously meant only "no ticket was created" (outcome
-- chat_only). That over-counts badly — most chat_only conversations simply
-- fizzle out, and over 19–25 Aug 2026 it listed 149 conversations when only 14
-- showed any sign the member was actually helped. We want successful cases
-- only: no ticket AND the member was thankful.
--
-- Signal: a member message expressing thanks, deliberately narrowed by three
-- conditions, each of which removed a real false positive found in the data:
--   * turn > 1        — formal letters opening "thanks in advance" are not
--                       gratitude for help; the bot had not answered yet.
--   * length <= 120   — two members re-pasted their whole opening letter later
--                       in the chat, so "not the first turn" alone missed them.
--                       Genuine closing thank-yous were all under 40 chars.
--   * not a brush-off — "thanks anyway/though/but" is a dismissal. One such
--                       conversation was simultaneously flagged as BAD in the
--                       feedback inbox while counting here as a success.
-- Note "no thanks" / "nee bedankt" answering "anything else?" DO count — that
-- is a polite successful ending, not a refusal.
--
-- Additive only — adds a `thanked` boolean to each session object returned by
-- daily_digest_details; every existing field is unchanged.

CREATE OR REPLACE FUNCTION bot.daily_digest_details(p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_start timestamptz := p_date::timestamp at time zone 'Europe/Amsterdam';
  v_end   timestamptz := (p_date + 1)::timestamp at time zone 'Europe/Amsterdam';
  v_sessions jsonb;
  v_errors jsonb;
begin
  select coalesce(jsonb_agg(row_j order by first_at), '[]'::jsonb) into v_sessions
  from (
    select
      w.session_id,
      min(m.created_at) as first_at,
      jsonb_build_object(
        'session_id', w.session_id,
        'first_at', to_char(min(m.created_at) at time zone 'Europe/Amsterdam', 'HH24:MI'),
        'last_at',  to_char(max(m.created_at) at time zone 'Europe/Amsterdam', 'HH24:MI'),
        'msg_count', count(*),
        'state', max(s.state),
        'customer', coalesce(max(c.display_name), '(not authenticated)'),
        'user_sample', (
          select string_agg(left(regexp_replace(q.content, '\s+', ' ', 'g'), 90), '  |  ' order by q.created_at)
          from (
            select m2.content, m2.created_at
            from bot.conversation_messages m2
            where m2.session_id = w.session_id
              and m2.created_at >= v_start and m2.created_at < v_end
              and m2.role = 'user'
            order by m2.created_at
            limit 6
          ) q
        ),
        'ticket', (
          select jsonb_build_object('fd_id', t.external_ticket_id, 'subject', t.subject)
          from bot.tickets t
          where t.session_id = w.session_id
            and t.created_at >= v_start and t.created_at < v_end
          order by t.created_at desc
          limit 1
        ),
        'outcome', case
          when exists (select 1 from bot.tickets t2 where t2.session_id = w.session_id and t2.created_at >= v_start and t2.created_at < v_end and t2.external_ticket_id is not null) then 'ticket_created'
          when exists (select 1 from bot.tickets t3 where t3.session_id = w.session_id and t3.created_at >= v_start and t3.created_at < v_end) then 'ticket_not_synced'
          when max(s.current_ticket_draft_id::text) is not null then 'abandoned_mid_ticket'
          when max(s.state) in ('awaiting_email','awaiting_otp','awaiting_studio_selection','awaiting_studio_selection_verified') then 'auth_dropoff'
          else 'chat_only'
        end,
        'no_reply', (
          select (last_msg.role = 'user')
          from bot.conversation_messages last_msg
          where last_msg.session_id = w.session_id
            and last_msg.created_at >= v_start and last_msg.created_at < v_end
          order by last_msg.created_at desc
          limit 1
        ),
        -- The member thanked the bot after it had answered at least once.
        -- Deliberately narrow: a short closing message (a formal letter that
        -- opens with "thanks in advance" is not gratitude for help), never the
        -- first turn, and not a brush-off like "thanks anyway/though/but".
        -- "No thanks" / "nee bedankt" answering "anything else?" DO count.
        'thanked', exists (
          select 1
          from (
            select m4.content,
                   row_number() over (order by m4.created_at) as turn
            from bot.conversation_messages m4
            where m4.session_id = w.session_id
              and m4.created_at >= v_start and m4.created_at < v_end
              and m4.role = 'user'
          ) g
          where g.turn > 1
            and length(btrim(g.content)) <= 120
            and g.content ~* '\y(thanks|thank you|thankyou|thnx|thx|bedankt|dankjewel|dankuwel|dankje|danku|dank je|dank u|merci|cheers|appreciate[ds]?)\y'
            and g.content !~* '((thanks?|thank you)[\s,!.]*(anyway|though)|toch bedankt|(thanks?|thank you)[\s,!.]*but\y|bedankt[\s,!.]*maar\y)'
        )
      ) as row_j
    from (select distinct session_id from bot.conversation_messages where created_at >= v_start and created_at < v_end) w
    join bot.conversation_messages m on m.session_id = w.session_id and m.created_at >= v_start and m.created_at < v_end
    left join bot.sessions s on s.id = w.session_id
    left join bot.customers c on c.id = s.customer_id
    group by w.session_id
  ) agg;

  select coalesce(jsonb_agg(jsonb_build_object(
           'time', to_char(created_at at time zone 'Europe/Amsterdam', 'HH24:MI'),
           'workflow', workflow_name, 'node', node_name,
           'message', left(error_message, 200), 'execution_id', execution_id
         ) order by created_at), '[]'::jsonb) into v_errors
  from bot.workflow_errors
  where created_at >= v_start and created_at < v_end;

  return jsonb_build_object('sessions', v_sessions, 'errors', v_errors);
end;
$function$;
