import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedStaffEmail } from "@/lib/env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Refreshes the auth session cookie and enforces the staff gate on every
// request. Public paths (login + auth callback + static assets) are allowed
// through; everything else requires an allow-listed staff session.
const PUBLIC_PREFIXES = ["/login", "/auth", "/_next", "/favicon"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Fail closed: any error resolving the session is treated as "not signed in".
  let email: string | undefined;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email;
  } catch {
    email = undefined;
  }

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  const allowed = isAllowedStaffEmail(email);

  // Not signed in (or not staff) and hitting a protected page -> login.
  if (!allowed && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  // Already signed in and visiting /login -> send to dashboard.
  if (allowed && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
