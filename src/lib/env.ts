import "server-only";

// Centralised, validated server-side env. Importing "server-only" guarantees
// this module (and the keys below) can never be bundled into client code.

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

// Lazy getters: keys are validated on first *use* (request time), not at
// import. This lets `next build` compile without secrets present and surfaces
// a clear error at runtime if one is missing.
export const env = {
  get supabaseUrl() {
    return required("SUPABASE_URL");
  },
  get supabaseAnonKey() {
    return required("SUPABASE_ANON_KEY");
  },
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  get staffDomain() {
    return (process.env.STAFF_EMAIL_DOMAIN || "urbangymgroup.com").toLowerCase();
  },
  get staffAllowlist() {
    return (process.env.STAFF_ALLOWLIST || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
};

/** True if this email is allowed to use Evelyn Ops. */
export function isAllowedStaffEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  const domainOk = e.endsWith("@" + env.staffDomain);
  if (!domainOk) return false;
  if (env.staffAllowlist.length > 0) return env.staffAllowlist.includes(e);
  return true;
}
