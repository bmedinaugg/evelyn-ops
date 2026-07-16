import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase/auth-client";
import { isAllowedStaffEmail } from "@/lib/env";

// OAuth return: exchange the code for a session, then enforce the staff
// allow-list before letting the user in.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") || "/dashboard";
  const next = nextParam.startsWith("/") ? nextParam : "/dashboard";

  const supabase = await createAuthClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=oauth", request.url));
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedStaffEmail(user?.email)) {
    // Signed in with a non-allow-listed account — reject and clear the session.
    await supabase.auth.signOut();
    return NextResponse.redirect(
      new URL("/login?error=not_allowed", request.url),
    );
  }

  return NextResponse.redirect(new URL(next, request.url));
}
