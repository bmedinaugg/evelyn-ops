-- Evelyn Ops — Security hardening for the EXISTING bot exposure
--
-- STATUS: Steps A & B APPLIED 2026-07-15 via Supabase migrations
--   `harden_enable_rls_exposed_tables` and
--   `harden_revoke_definer_execute_from_public`.
-- Verified after apply: rls_disabled advisors = 0; anon/authenticated can
-- execute 0 of the 19 SECURITY DEFINER functions; service_role can execute all
-- 19; service_role has rolbypassrls; no new permission errors in
-- bot.workflow_errors. Step C (below) is still OUTSTANDING (low priority).
-- The A/B SQL is kept commented below as the historical record + rollback.
--
-- WHAT I FOUND (verified in Supabase + n8n):
--   A) RLS DISABLED on bot.form_schemas and bot.workflow_errors — anyone with
--      the anon key can read/write every row.
--   B) 19 SECURITY DEFINER functions in schema `bot` (the bot's state-machine
--      mutators: authenticate_user, otp_generate, otp_verify,
--      submit_ticket_from_draft, claim_inbound_message, get_recent_history,
--      add_verified_account, set_session_otp_pending, ...) are executable by
--      anon/authenticated via the implicit PUBLIC grant and BYPASS RLS. With
--      the anon key a stranger could read transcript history
--      (get_recent_history) or forge bot state (OTPs, auth, ticket submission).
--
-- HOW THE BOT CONNECTS (verified — this is why the below is safe):
--   Every DB call in "Bot - Main", "Bot - Error Logger", etc. is an HTTP
--   PostgREST request using n8n credential type `supabaseApi` with header
--   Content-Profile: bot. The supabaseApi credential holds the SERVICE_ROLE
--   key -> Postgres role `service_role`, which has BYPASSRLS. There is NO
--   anon-key or direct-Postgres path in the bot workflows.
--   => Enabling RLS does not affect the bot (service_role bypasses it).
--   => Revoking EXECUTE from PUBLIC is fine PROVIDED we re-grant to
--      service_role (done below), because the bot calls these as service_role.
--
-- ONE THING TO DOUBLE-CHECK before Step B: confirm no OTHER client (e.g. the
--   "existing but unverified" web channel, or any browser app) calls these
--   RPCs with the anon/authenticated key. All confirmed callers use
--   service_role, so risk is low — but if such a client exists, Step B blocks
--   it. Step A does not affect any service_role caller.
-- ===========================================================================

-- --- Step A. Enable RLS on the two exposed tables (safe: service_role bypasses)
--   Run these two, confirm the bot still logs errors / reads form schemas.
--   RLS with no policy = locked to service_role only, which is what we want.

-- alter table bot.form_schemas    enable row level security;
-- alter table bot.workflow_errors enable row level security;

--   Rollback if needed:
--   alter table bot.form_schemas    disable row level security;
--   alter table bot.workflow_errors disable row level security;


-- --- Step B. Remove anon/authenticated access to the DEFINER mutators --------
--   Revoke the PUBLIC grant (this is what actually blocks anon/authenticated),
--   then immediately re-grant to service_role so the bot is unaffected.
--   Wrapped in a transaction so it's all-or-nothing.

-- do $$
-- declare fn record;
-- begin
--   for fn in
--     select p.oid::regprocedure as sig
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'bot' and p.prosecdef
--   loop
--     execute format('revoke execute on function %s from public, anon, authenticated;', fn.sig);
--     execute format('grant  execute on function %s to service_role;', fn.sig);
--   end loop;
-- end $$;

--   Verify afterward (anon should be false, service_role true):
--   select p.proname,
--          has_function_privilege('anon',         p.oid, 'EXECUTE') as anon_exec,
--          has_function_privilege('service_role',  p.oid, 'EXECUTE') as svc_exec
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='bot' and p.prosecdef order by p.proname;

--   Rollback if needed (restores the original PUBLIC grant):
--   -- re-run the loop above but with:
--   --   grant execute on function %s to public;


-- --- Step C. Lower-priority hardening (from advisors) ------------------------
--   * function_search_path_mutable (16 fns): pin search_path per function, e.g.
--       alter function bot.otp_verify(uuid, text, text) set search_path = bot, public;
--   * extension_in_public (2): move extensions out of public. Low risk; do last.
