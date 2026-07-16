# Context Handoff — "Evelyn Ops" App (conversations · tickets · failures · FAQ feedback)

Paste this whole document into a new conversation to build the app. It is self-contained: everything needed (data model, real schema, goals, constraints, gotchas) is below. Nothing from the originating chat is required.

---

## 1. What I'm building and why
Evelyn is a live customer-support chatbot for **Urban Gym Group** (brand in scope at launch: **TrainMore** only). It runs on **n8n** (orchestration) + **Supabase/Postgres** (all state) + **Freshdesk** (tickets) + **Magicline** (membership system) + OpenAI + Outlook. It serves members over Telegram today, with a web channel existing but unverified.

I want a **single internal web app** ("Evelyn Ops") where the support team can, in one place:
1. **Browse all conversations** (each with full transcript, who the member was, outcome, linked ticket).
2. **See tickets created** by the bot (and which ones failed to sync to Freshdesk).
3. **See failures** (n8n workflow errors) surfaced clearly.
4. **Leave feedback** as a team on individual conversations/answers (this is a NEW capability the app must add — a feedback table doesn't exist yet).
5. **Add / propose new FAQs** — capture knowledge gaps the bot couldn't answer and turn them into FAQ entries (also a new capability; see §6 for how FAQs currently work).

Today this is only partially covered by a daily digest **email** and a one-conversation-at-a-time n8n "Conversation Viewer" form. There is **no dashboard and no place for team feedback or FAID capture** — that's the gap this app fills.

Audience: internal support / Member Care team (a handful of users). Not member-facing. Must be access-controlled (contains member PII: names, emails, message content).

---

## 2. Tech constraints / preferences
- The data lives in **Supabase project `rxnryvwpkdnwkpmhiiup`**, Postgres schema **`bot`** (NOT `public`). When querying via PostgREST/supabase-js, set the schema to `bot` (e.g. `createClient(url, key, { db: { schema: 'bot' } })`), or use RPCs.
- I'm open on frontend stack — suggest one (Next.js + supabase-js is the obvious fit; a single-page React app talking to Supabase also works). Keep it simple to host.
- **Do NOT require changes to the live n8n bot** to build the read-only parts. The app reads the same tables the bot writes. New app-only tables (feedback, proposed FAQs) should be additive and must not interfere with the bot.
- Reuse existing SQL where possible: there are already digest/reporting RPCs (see §5) that return exactly the conversation/ticket/failure shapes this app needs.

---

## 3. ⚠️ Security issue to address FIRST (do not skip)
Supabase flagged this and it directly affects the app's auth design:
- **RLS (Row Level Security) is DISABLED on `bot.form_schemas` and `bot.workflow_errors`**, and the other `bot.*` tables have RLS enabled but policies should be reviewed. With the anon key, disabled-RLS tables are fully readable/writable by anyone who has the key.
- This app exposes **member PII** (names, emails, full transcripts). It must **never** ship the Supabase anon key to a public browser without RLS + auth policies locking every `bot.*` table down to authenticated staff only.
- Recommended pattern: put the app behind real auth (Supabase Auth with an allow-listed staff domain, or an SSO proxy), and access data through a **server-side** layer (service role key on the server only) or through RLS policies that require an authenticated staff role. Do not use the anon key client-side against these tables.
- Decide RLS/policies deliberately before building — enabling RLS with no policies blocks all access; shipping without it leaks PII.

---

## 4. Real data model (Supabase schema `bot`, verified)
Row counts are as of handoff (illustrative of scale — small).

**Core conversation/session tables**
- `bot.channel_users` (530) — one row per end user per channel. `id` (uuid, PK), `channel` (e.g. 'telegram'), `external_id`, `external_chat_id`, `username`, `first_name`, `last_name`, `preferred_language`, `metadata` jsonb, `created_at`, `last_seen_at`.
- `bot.sessions` (530) — one per channel_user (`channel_user_id` unique). `id` (uuid, PK), `customer_id` (nullable → bot.customers), `state` (enum-ish text: new, awaiting_email, authenticating, authenticated_idle, ticket_collecting, ticket_confirming, awaiting_studio_selection, awaiting_otp, awaiting_studio_selection_verified), `context` jsonb (holds `otp_pending` with verified account info incl. studioName, customerNumber, contractStartDate, brand, verified_accounts[]), `current_ticket_draft_id`, `last_message_at`, `state_updated_at`, `updated_at`, `live_conversation_id`. NOTE: no `created_at` on sessions — use `last_message_at`/`state_updated_at` for timing, or the first message's `created_at`.
- `bot.conversation_messages` (5599) — the transcript. `id` (uuid, PK), `session_id`, `channel_user_id`, `role` (user|assistant|system|tool), `content` (text), `state_at_turn`, `external_message_id`, `metadata` jsonb, `created_at`. **This is the table for full transcripts.**
- `bot.conversation_summaries` (0, unused so far) — optional rolling summary per session.

**Identity / auth**
- `bot.customers` (170) — authenticated members. `id` (uuid, PK), `email` (unique), `external_customer_id`, `display_name`, `home_studio_id`, `preferred_language`, `magicline_customer_id`.
- `bot.channel_user_customers` (344) — M:N link of channel_user ↔ customer (a user can verify multiple accounts). PK (`channel_user_id`,`customer_id`), `authenticated_at`.
- `bot.auth_attempts` (0), `bot.otp_codes` (319), `bot.otp_send_log` (271) — login/OTP audit. otp_codes stores `code_hash` (sha256), `target_email`, `expires_at`, `attempts`, `consumed_at`. Useful for a "logins / OTP health" view.

**Tickets**
- `bot.ticket_drafts` (269) — in-progress ticket collection. `id`, `session_id`, `subject`, `description`, `category`, `priority`, `extra_fields` jsonb, `status` (collecting|ready_for_confirmation|submitted|abandoned), `rate_name`, timestamps. **Abandoned drafts = drop-off analysis.**
- `bot.tickets` (159) — tickets that reached submission. `id`, `external_ticket_id` (Freshdesk numeric id as text; **NULL = failed to sync to Freshdesk** — this is the "failed ticket" signal), `draft_id`, `session_id`, `channel_user_id`, `customer_id`, `subject`, `description`, `category`, `priority`, `status`, `created_at`. Freshdesk ticket URL = `https://urbangymgroup.freshdesk.com/a/tickets/{external_ticket_id}`. NOTE: ticket **tags** are NOT stored here — they're set only in the Freshdesk payload (all bot tickets carry the `evelyn-bot` tag from ~2026-07-14 onward).

**Failures / ops**
- `bot.workflow_errors` (38) — **RLS disabled (see §3)**. Written by the n8n error-handler workflow, read by the digest. `id`, `workflow_name`, `execution_id`, `node_name`, `error_message`, `created_at`. This is the "failures" feed for the app.

**Knowledge / config**
- `bot.locations` (65) — club directory (name, brand, city, tier, hours jsonb, facilities jsonb, pricing jsonb).
- `bot.ticket_taxonomy` (7) — category taxonomy per brand.
- `bot.form_schemas` (14) — **RLS disabled (see §3)**. Per-form Freshdesk field definitions (questions, types, required, options incl. prices, consent-checkbox text). Synced from Freshdesk admin. Relevant if the app ever edits consent text / form copy.

**Timezone:** all timestamps are `timestamptz` (stored UTC). Business timezone is **Europe/Amsterdam** — do day-bucketing as `created_at AT TIME ZONE 'Europe/Amsterdam'`. The reporting RPCs below already handle this.

---

## 5. Existing RPCs to reuse (don't re-derive these)
These Postgres functions already exist in the `bot` schema and return exactly what the app's dashboard needs. Call them via supabase-js `.rpc()` (schema `bot`) or `select bot.fn(...)`.
- `bot.daily_digest_stats(p_date date) → jsonb` — headline counts for one Amsterdam day: active_sessions, messages_total, messages_by_role, logins, multi_account_sessions, tickets_total/synced/by_category/list, otp_sends, otp_unique_emails.
- `bot.daily_digest_details(p_date date) → jsonb` — `{ sessions:[...], errors:[...] }`. Each session: session_id, first_at, last_at, msg_count, state, customer, user_sample, ticket{fd_id}, outcome (one of: ticket_created, ticket_not_synced, abandoned_mid_ticket, auth_dropoff, chat_only). No session cap. `errors` mirrors workflow_errors for the day.
- `bot.get_conversation(p_session_id uuid) → jsonb` — `{ found, session{customer,email,state,...}, ticket, message_count, messages[] }`. **This is the full-transcript fetch for the conversation-detail view.**

These were built for an email digest + a single-session viewer. The app can call them directly, or query the base tables in §4 for more flexibility (e.g. arbitrary date ranges, search, pagination). For a browsable list with filters, querying `bot.sessions` + a join to first/last message + `bot.tickets` is probably cleaner than the digest RPC; use the RPCs for the daily rollups.

---

## 6. How FAQs currently work (for the "add new FAQ" feature)
- The bot answers general questions through an **FAQ Search tool** inside n8n (a retrieval step over an FAQ knowledge base). The exact store (vector index / table) is configured **inside n8n**, NOT in the `bot` schema tables above — so confirm the current FAQ storage in n8n before wiring "publish FAQ" end-to-end.
- Realistic MVP for this app: capture **proposed FAQs / knowledge gaps** in a NEW app-owned table (e.g. `bot.faq_proposals`: question, suggested_answer, source_session_id, status draft|approved|published, author, timestamps). The team drafts/approves them in the app. **Publishing** into the live FAQ store is a second step that needs an n8n sync (out of scope for the read-only MVP; design the table so a later n8n workflow can pick up `status='approved'` rows).
- Good signal source for "FAQs to add": conversations with outcome `chat_only` where the member left unsatisfied, and repeated questions the bot couldn't answer. The app can surface these as "candidate FAQs."

---

## 7. New tables the app needs (additive — safe to create)
Design these as app-owned; they don't touch bot behavior. Enable RLS with staff-only policies on all of them.
- `bot.conversation_feedback` — team feedback on a conversation or a specific message. Suggested cols: `id` uuid pk, `session_id` uuid (→ bot.sessions), `message_id` uuid null (→ bot.conversation_messages, for per-answer feedback), `author` text/uuid (staff user), `rating` text or int (e.g. good/bad or 1–5), `comment` text, `tags` text[] (e.g. 'wrong-info','tone','missing-faq'), `created_at`.
- `bot.faq_proposals` — see §6.
- (optional) `bot.review_status` — mark a conversation reviewed/triaged, so the team can work through them without collisions.

Keep FKs to `bot.sessions(id)` / `bot.conversation_messages(id)`. Don't add FKs that could block the bot's writes.

---

## 8. Suggested app surface (MVP)
1. **Dashboard / day view** — pick a date (default today, Amsterdam). Funnel + counts from `daily_digest_stats`. "Needs attention" tiles: auth drop-offs, abandoned-mid-ticket, unsynced tickets (`tickets.external_ticket_id IS NULL`), unresolved chats, workflow errors.
2. **Conversations list** — filterable/searchable table (by date range, outcome, state, customer email, has-ticket, has-error). Row → detail.
3. **Conversation detail** — full transcript via `get_conversation(session_id)`, member info, linked Freshdesk ticket (deep link), plus the **feedback panel** (write to `conversation_feedback`) and a **"propose FAQ from this chat"** button (prefills `faq_proposals.source_session_id`).
4. **Tickets view** — from `bot.tickets`; highlight unsynced (NULL external id) in red; Freshdesk deep links.
5. **Failures view** — from `bot.workflow_errors`; group by workflow_name/node_name; show recent spikes.
6. **FAQ proposals view** — draft/approve queue; later feeds an n8n publish step.

---

## 9. Key gotchas (learned the hard way)
- **Schema is `bot`, not `public`.** Every query/PostgREST call must target it.
- **`external_ticket_id IS NULL` = the ticket failed to reach Freshdesk.** This is the single most important "incident" signal; surface it loudly. (Real unsynced failures have happened, caused by an "AI ticket chain — output doesn't fit required format" error in n8n.)
- **`bot.sessions` has no `created_at`.** Use `last_message_at` / `state_updated_at`, or MIN(`conversation_messages.created_at`) per session for "started at."
- **Amsterdam timezone** for all day buckets.
- **PII everywhere** in messages/customers — auth-gate the whole app; fix the RLS situation in §3 before exposing anything.
- **Don't destabilize the bot.** Read freely; only ADD new tables. Never alter/lock existing `bot.*` tables in a way that could block the running n8n workflows (e.g. don't enable RLS on a bot-written table without a policy that still lets the bot's key write).
- **FAQ publishing is a two-step**: app captures proposals (DB), n8n later syncs approved ones into the live FAQ store. Confirm the FAQ store location in n8n before promising end-to-end publish.
- The reporting RPCs cap AI summaries at ~40–150 sessions in the email context, but for the app you'll query base tables directly and paginate, so that cap doesn't apply.

---

## 10. Identifiers
- Supabase project id: `rxnryvwpkdnwkpmhiiup`; schema `bot`.
- Freshdesk ticket URL pattern: `https://urbangymgroup.freshdesk.com/a/tickets/{external_ticket_id}`.
- Bot ticket tag in Freshdesk: `evelyn-bot`.
- Existing RPCs: `bot.daily_digest_stats`, `bot.daily_digest_details`, `bot.get_conversation`.

---

### First steps for the new session
1. Confirm/settle the **RLS + auth** design (§3) — this shapes everything.
2. Create the additive tables (§7) via a migration.
3. Stand up the read-only dashboard + conversations list + detail using the existing RPCs and base tables.
4. Add the feedback panel and FAQ-proposal capture.
5. Leave FAQ *publishing* (n8n sync) as a defined follow-up, after confirming where the live FAQ store lives inside n8n.
