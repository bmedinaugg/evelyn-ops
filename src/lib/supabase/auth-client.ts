import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: CookieOptions };
import { env } from "@/lib/env";

// Auth-only Supabase client, bound to the request cookie store.
// Uses the ANON key and is used solely to manage the staff login session
// (GoTrue). It is NOT used to read bot.* data — that goes through the
// service-role data client. The anon key stays server-side; the browser only
// ever receives httpOnly session cookies.
export async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // called from a Server Component render — safe to ignore; the
          // middleware refreshes the session cookie instead.
        }
      },
    },
  });
}
