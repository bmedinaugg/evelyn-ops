-- Test sessions: the test runner talks to the real bot through its web-chat
-- entry point as sessionId 'test-…'. Bot - Main copies that verbatim into
-- channel_users.external_id, so a test session is recognisable without any
-- n8n change. Two helpers, both refuse non-test sessions.

create or replace function bot.is_test_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path to 'bot' as $$
  select coalesce((select cu.external_id like 'test-%'
                     from bot.sessions s join bot.channel_users cu on cu.id = s.channel_user_id
                    where s.id = p_session_id), false);
$$;

-- otp_codes stores only sha256(code), so the runner cannot READ the code the
-- bot emailed. It can SET it: overwrite the latest unconsumed row's hash with
-- the hash of a known code, then type that code. Login proceeds exactly as
-- for a member; no mailbox involved.
create or replace function bot.test_otp_set(p_session_id uuid, p_code text)
returns text language plpgsql security definer set search_path to 'bot','public','extensions' as $$
declare v_id uuid;
begin
  if not bot.is_test_session(p_session_id) then
    raise exception 'test_otp_set: % is not a test session', p_session_id;
  end if;
  select id into v_id from bot.otp_codes
   where session_id = p_session_id and consumed_at is null
   order by created_at desc limit 1;
  if v_id is null then return 'no_code'; end if;
  update bot.otp_codes
     set code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex'),
         attempts = 0,
         expires_at = greatest(expires_at, now() + interval '10 minutes')
   where id = v_id;
  return 'ok';
end $$;

revoke all on function bot.is_test_session(uuid) from public, anon, authenticated;
revoke all on function bot.test_otp_set(uuid, text) from public, anon, authenticated;
comment on function bot.test_otp_set is 'Test runner only: overwrite the pending OTP hash for a test session (channel_users.external_id like test-%) with a known code.';
