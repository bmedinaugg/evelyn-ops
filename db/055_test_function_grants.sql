-- 053/054 revoked the test helpers from public — which also drops the default
-- EXECUTE that service_role relied on. The app's data client IS service_role,
-- so the first real run failed with "permission denied for function
-- test_otp_set". Grant them back explicitly. Lesson: after "revoke from
-- public" on a function, always grant to the role that calls it.
grant execute on function bot.is_test_session(uuid) to service_role;
grant execute on function bot.test_otp_set(uuid, text) to service_role;
grant execute on function bot.test_session_purge(uuid) to service_role;
