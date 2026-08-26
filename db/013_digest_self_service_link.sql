-- Evelyn Ops — exclude "handed over a self-service form" chats from Bot helped.
-- Applied via MCP migration `digest_self_service_link` (2026-08-26).
--
-- Feedback from Nelly Palikara, 26 Aug: "is there a way to exclude from 'bot
-- helped' the chats were Evelyn gives the change or extension contact form urls?
-- Cause practically the bot didn't really solve anything, nor saved the team
-- from a ticket. Exception would be if in the same chat the member is asking
-- more questions and Evelyn answers."
--
-- Session a3ee2d46 is the canonical shape: member asks to change gym, bot
-- authenticates, pastes the change-membership form link, member replies
-- "No. Thank you!" — chat_only, thanked, so it counted as Bot helped even though
-- the member still has to file the request themselves.
--
-- Adds two additive fields; every existing field is unchanged:
--   self_service_link — the bot handed over a change / extension / early
--                       cancellation form URL
--   answered_count    — substantive assistant turns that are NOT that link and
--                       NOT auth or greeting boilerplate (Nelly's exception)
--
-- The Bot helped page then requires: no self-service link, OR at least one real
-- answer alongside it.

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
        -- Did the bot only hand over a self-service form URL? Nelly, 26 Aug:
        -- "practically the bot didn't really solve anything, nor saved the team
        -- from a ticket". Session a3ee2d46 is the shape: auth, drop the change
        -- form link, member says "No. Thank you!", counted as bot helped.
        'self_service_link', exists (
          select 1 from bot.conversation_messages m5
          where m5.session_id = w.session_id
            and m5.created_at >= v_start and m5.created_at < v_end
            and m5.role = 'assistant'
            and m5.content ~* '(ticket_form=(change_membership|membership_extension|early_cancellation)|extend-your-membership)'
        ),
        -- Her exception: it still counts if the bot actually answered something
        -- in the same chat. Substantive = an assistant turn that is not the link
        -- itself, not auth/greeting boilerplate, and not a closing pleasantry.
        -- That last exclusion matters: in session a3ee2d46 the sign-off "No
        -- worries! If you need any assistance in the future, feel free to reach
        -- out. Have a great day!" is 94 chars and would otherwise read as an
        -- answer, keeping the very session Nelly flagged inside Bot helped.
        -- Real answers that happen to end with a similar line run well past 200
        -- characters, so the length bound keeps them.
        'answered_count', (
          select count(*)
          from bot.conversation_messages m6
          where m6.session_id = w.session_id
            and m6.created_at >= v_start and m6.created_at < v_end
            and m6.role = 'assistant'
            and length(btrim(m6.content)) > 80
            and m6.content !~* '(ticket_form=(change_membership|membership_extension|early_cancellation)|extend-your-membership)'
            and m6.content !~* '(verification code|verificatiecode|you.re all set|je bent ingelogd|share the email|e-mailadres van je account|ticket preview|ticketvoorbeeld)'
            and not (
              length(btrim(m6.content)) < 200
              and m6.content ~* '(no worries|geen probleem|have a (great|nice) day|fijne dag|feel free to reach out|reach out any ?time|take care|come back any ?time|anytime|graag gedaan|tot ziens|succes)'
            )
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
