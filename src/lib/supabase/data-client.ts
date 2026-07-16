import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Service-role client for ALL data access against schema `bot`.
// SERVER ONLY. Bypasses RLS by design — every caller MUST have passed the
// staff auth check (see requireStaff) before using this. Never import this
// from a client component.
function makeClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    db: { schema: "bot" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

let _client: ReturnType<typeof makeClient> | null = null;

export function dataClient() {
  if (!_client) _client = makeClient();
  return _client;
}
