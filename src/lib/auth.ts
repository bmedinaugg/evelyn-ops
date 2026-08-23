import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/auth-client";
import { isAllowedStaffEmail } from "@/lib/env";

export type StaffUser = { id: string; email: string };

/**
 * Returns the current staff user, or null if not signed in / not allowed.
 *
 * Wrapped in React `cache()` so the underlying `auth.getUser()` network call
 * runs at most once per server request, even though requireStaff() is called
 * by every data query (33 call sites). Previously a page that fetched N days
 * of data made N auth round-trips; now it makes one.
 */
export const getStaffUser = cache(
  async (): Promise<StaffUser | null> => {
    const supabase = await createAuthClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email || !isAllowedStaffEmail(user.email)) return null;
    return { id: user.id, email: user.email };
  },
);

/**
 * Guard for all data access and protected pages. Redirects to /login if the
 * caller is not an allow-listed staff member. Call this before touching the
 * service-role data client.
 */
export async function requireStaff(): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) redirect("/login");
  return user;
}
