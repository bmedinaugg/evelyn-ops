# Evelyn Ops

Internal support console for the Evelyn bot (Urban Gym Group / TrainMore).
Read-only Phase 1: **Dashboard**, **Conversations list**, **Conversation detail**.

## Architecture (security-first)

- **Server-only data access.** The browser never holds a Supabase key. A
  Next.js server layer holds the **service_role** key and calls the existing
  `bot.*` RPCs; the staff auth check runs on every request before any data is
  read (`src/lib/auth.ts` → `requireStaff`).
- **Staff auth** via Supabase Auth **Microsoft (Entra ID) SSO**, restricted to
  `@urbangymgroup.com` (see `STAFF_EMAIL_DOMAIN` / `STAFF_ALLOWLIST`, enforced
  in `/auth/callback`). The anon key is used **only** for the login/session
  flow and stays server-side; the browser only receives httpOnly session
  cookies.
- **Schema `bot`** (not `public`) — the data client sets `db.schema = 'bot'`.
- Purely additive: reads existing RPCs (`daily_digest_stats`,
  `daily_digest_details`, `get_conversation`); the write features come in later
  phases against the new tables in `db/001_app_tables.sql` (already applied).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the two keys
npm run dev                  # http://localhost:3000
```

Fill `.env.local` from **Supabase dashboard → Project Settings → API**:

| Var | Value |
| --- | --- |
| `SUPABASE_URL` | `https://rxnryvwpkdnwkpmhiiup.supabase.co` |
| `SUPABASE_ANON_KEY` | the `anon` / `public` key (auth only) |
| `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` secret (server-only) |
| `STAFF_EMAIL_DOMAIN` | `urbangymgroup.com` |
| `STAFF_ALLOWLIST` | optional CSV to restrict to specific emails |

### Microsoft SSO setup (one-time)

Login uses **Microsoft (Entra ID) SSO** through Supabase. Three places to
configure — note the **two different callback URLs**:

**1. Azure Portal → Microsoft Entra ID → App registrations → New registration**
- Name: `Evelyn Ops`; supported accounts: single tenant (this org).
- Redirect URI → type **Web** →
  `https://rxnryvwpkdnwkpmhiiup.supabase.co/auth/v1/callback`
  *(this is the Supabase↔Azure callback, not the app's).*
- After creating, copy the **Application (client) ID** and **Directory
  (tenant) ID**.
- **Certificates & secrets → New client secret** → copy the secret **Value**.

**2. Supabase → Authentication → Providers → Azure** → enable and fill:
- Application (client) ID, Secret Value (from step 1).
- Azure Tenant URL: `https://login.microsoftonline.com/<TENANT_ID>`.

**3. Supabase → Authentication → URL Configuration**
- Site URL: `http://localhost:3000` (swap for the prod URL later).
- Redirect URLs: add `http://localhost:3000/auth/callback`
  *(this is the app's callback)* — and the prod equivalent when you deploy.

Domain restriction to `@urbangymgroup.com` is enforced in the app
(`/auth/callback`); tighten further with `STAFF_ALLOWLIST` if you want a fixed
list of emails.

## Layout

```
db/                         SQL migrations (001 applied; 002 hardening = review)
src/lib/env.ts              validated server env + staff allow-list check
src/lib/supabase/           auth-client (anon, cookies) · data-client (service_role, bot)
src/lib/auth.ts             getStaffUser / requireStaff guard
src/lib/queries.ts          the 3 RPC calls, each guarded by requireStaff
src/app/(app)/              authenticated pages: dashboard, conversations
src/app/login/              server-driven OTP login
middleware.ts               session refresh + route gate
```

## Deployment (Azure)

This is a **server-rendered** app holding the `service_role` secret, so it needs
a Node server — **not** Azure Static Web Apps (static/edge only).

**Option A — App Service (Linux, Node 20).** Simplest.
- `npm run build`, then run `npm run start` (App Service startup command).
- Put `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `STAFF_EMAIL_DOMAIN`, `STAFF_ALLOWLIST` in **Configuration → Application
  settings** (ideally as **Key Vault references** for the two keys).
- Restrict access at the platform edge too (App Service Authentication / Entra
  ID, or IP allow-list) for defence-in-depth on top of the app's own gate.

**Option B — Container Apps.** Containerise (`next start` on port 3000),
secrets as Container App secrets / Key Vault. Better if you want scale-to-zero
or already run containers.

Either way: keys live only in server-side settings; nothing is `NEXT_PUBLIC_*`.

## Notes / known limitations

- **Feedback is session-level.** `get_conversation` doesn't return per-message
  ids, so the feedback panel writes `message_id = null`. Per-answer feedback is
  a later enhancement (needs the RPC to expose message ids, or a base-table
  read).

## Roadmap

- ✅ **Phase 1** — read-only core (dashboard, conversations list + detail).
- ✅ **Phase 2** — team feedback panel → `bot.conversation_feedback`.
- ✅ **Phase 3** — FAQ-proposal capture → `bot.faq_proposals` (draft/approve
  queue; the app never sets `published` — that's the n8n sync's job).
- ✅ **Tickets view** (`bot.tickets`, unsynced flagged, Freshdesk deep links)
  and **Failures view** (`bot.workflow_errors`, summarised by workflow).
- **Later** — per-message feedback; FAQ *publishing* via n8n (out of scope — a
  later workflow picks up `status = 'approved'`); Azure deploy.
- **Hardening** — `db/002_hardening_REVIEW_ONLY.sql` closes the pre-existing
  anon-key exposure; run when ready (verified safe against the live bot).
