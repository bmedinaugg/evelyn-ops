"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAuthClient } from "@/lib/supabase/auth-client";

// Kick off Microsoft (Entra ID) SSO via Supabase Auth. Returns a provider URL
// we redirect the browser to; Microsoft sends the user back to /auth/callback.
export async function signInWithMicrosoft(formData: FormData) {
  const next = String(formData.get("next") || "/dashboard");

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const supabase = await createAuthClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      scopes: "openid email profile",
    },
  });

  if (error || !data?.url) {
    redirect(`/login?error=oauth`);
  }
  redirect(data.url);
}
