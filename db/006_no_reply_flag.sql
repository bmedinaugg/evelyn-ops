-- Evelyn Ops — "no reply generated" safety flag.
-- Applied via MCP migration `no_reply_flag`.
--
-- Why: when a turn errors before the bot produces a reply (e.g. the ticket-
-- creation JSON-parse drop we fixed on 2026-07-21), the member sees an
-- "<Empty Response>" in chat. The inbound message IS already durably logged
-- (bot.claim_inbound_message writes role='user' before any LLM/ticket work),
-- but nothing marked the turn as unanswered — so in Ops it looked like a
-- conversation that just trailed off. This adds an explicit, countable signal.
--
-- Signal: the bot replies to every turn, so a conversation whose LAST message
-- (within the day window) is role='user' means the bot never answered that
-- final turn. Additive only — adds a `no_reply` boolean to each session object
-- returned by daily_digest_details; every existing field is unchanged.

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
