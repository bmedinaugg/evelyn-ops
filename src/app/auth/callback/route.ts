import { NextResponse, type NextRequest } from "next/server";
import { createAuthClient } from "@/lib/supabase/auth-client";
import { isAllowedStaffEmail } from "@/lib/env";

// Resolve the public origin from forwarded headers. Behind App Service the
// request host is the internal localhost:PORT, so route-handler request.url /
// nextUrl are wrong for redirects — the real host is in x-forwarded-host
// (or App Service's Disguised-Host).
function publicOrigin(request: NextRequest): string {
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("disguised-host") ??
    request.headers.get("host") ??
    request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// OAuth return: exchange the code for a session, then enforce the staff
// allow-list before letting the user in.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextParam = request.nextUrl.searchParams.get("next") || "/dashboard";
  const next = nextParam.startsWith("/") ? nextParam : "/dashboard";

  const base = publicOrigin(request);
  const to = (pathname: string, error?: string) => {
    const url = new URL(pathname, base);
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
