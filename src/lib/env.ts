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
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
  get freshdeskDomain() {
    return process.env.FRESHDESK_DOMAIN || "urbangymgroup.freshdesk.com";
  },
  get freshdeskApiKey() {
    return required("FRESHDESK_API_KEY");
  },
  get n8nHarnessWebhookUrl() {
    return required("N8N_HARNESS_WEBHOOK_URL");
  },
  get n8nHarnessSecret() {
    return required("N8N_HARNESS_SECRET");
  },
  get appBaseUrl() {
    return (
      process.env.APP_BASE_URL ||
      "https://evelyn-ops-g4btdwcheaftcmbj.westeurope-01.azurewebsites.net"
    );
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
  // Who can accept, reject or mark implemented a case proposal. Everyone else
  // can propose, agree, object and comment. Comma-separated; one person by
  // default because a single point of consistency is the point.
  // The bot's own hosted web-chat webhook (Bot - Main, "When chat message
  // received"). The test runner posts to it exactly as the widget does. Not a
  // secret — the widget URL is public — but overridable.
  get n8nChatWebhookUrl() {
    return (
      process.env.N8N_CHAT_WEBHOOK_URL ||
      "https://urbangymgroup-prod.app.n8n.cloud/webhook/d690408a-2200-4003-b237-efd5d4c57f67/chat"
    );
  },
  // Purge the session a test run created once it is recorded. Default on;
  // set TEST_KEEP_SESSIONS=1 to keep them for debugging.
  get testKeepSessions() {
    return process.env.TEST_KEEP_SESSIONS === "1";
  },
  get casesApprovers() {
    return (process.env.CASES_APPROVERS || "bryan.medina.per@urbangymgroup.com")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get staffExtraEmails() {
    return (process.env.STAFF_EXTRA_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
};

/** True if this email is allowed to use Evelyn Ops. */
export function isAllowedStaffEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();

  // Named individuals, granted regardless of mailbox domain. Needed because
  // brand staff (TrainMore, High Studios) sign in with a real
  // @urbangymgroup.com Entra account, but Entra's `email` claim carries their
  // *mail* attribute (e.g. @trainmore.nl) — so they can never satisfy the
  // domain check below no matter what STAFF_ALLOWLIST says.
  if (env.staffExtraEmails.includes(e)) return true;

  if (!e.endsWith("@" + env.staffDomain)) return false;
  if (env.staffAllowlist.length > 0) return env.staffAllowlist.includes(e);
  return true;
}
