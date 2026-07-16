import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase/auth-client";
import { isAllowedStaffEmail } from "@/lib/env";

// OAuth return: exchange the code for a session, then enforce the staff
// allow-list before letting the user in.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParam = request.nextUrl.searchParams.get("next") || "/dashboard";
  const next = nextParam.startsWith("/") ? nextParam : "/dashboard";

  // Build redirects from nextUrl (resolves the public host from forwarded
  // headers). request.url would be the internal localhost:PORT behind
  // App Service, producing broken redirects.
  const to = (pathname: string, error?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    if (error) url.searchParams.set("error", error);
    return NextResponse.redirect(url);
  };

  const supabase = await createAuthClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return to("/login", "oauth");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedStaffEmail(user?.email)) {
    await supabase.auth.signOut();
    return to("/login", "not_allowed");
  }

  return to(next);
}
