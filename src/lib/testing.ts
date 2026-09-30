import "server-only";
import { env } from "@/lib/env";
import { requireStaff } from "@/lib/auth";
import { dataClient } from "@/lib/supabase/data-client";
import { closeFreshdeskTicketAsTest } from "@/lib/freshdesk";
import type {
  TestCheck,
  TestProfileRow,
  TestRunRow,
  TestScenarioRow,
  TestTurnResult,
  TestTurnSpec,
} from "@/lib/types";

// The runner. Plays a scenario against the REAL bot through Bot - Main's
// web-chat webhook, as a 'test-…' sessionId, and records what came back.
//
// Login is not scripted per scenario: if the scenario names a profile, the
// runner does the same three turns a member does (ask, email, code), with
// one difference — the code the bot e-mailed is replaced through
// bot.test_otp_set (test sessions only) with 000000, so no mailbox is read.
//
// LEAVE NO TRACE: when the run is recorded, any Freshdesk ticket it filed is
// tagged evelyn-test and closed, and the session is purged (db/054) unless
// TEST_KEEP_SESSIONS=1.

const TEST_CODE = "000000";

async function say(sessionId: string, text: string): Promise<{ reply: string; ms: number }> {
  const started = Date.now();
  const res = await fetch(env.n8nChatWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "sendMessage", sessionId, chatInput: text }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const ms = Date.now() - started;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`chat webhook HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => ({}))) as { output?: unknown };
  const reply = typeof data.output === "string" ? data.output : JSON.stringify(data);
  return { reply, ms };
}

async function findSession(externalId: string): Promise<string | null> {
  const db = dataClient();
  const { data: cu } = await db
    .from("channel_users").select("id").eq("channel", "web_chat").eq("external_id", externalId).maybeSingle();
  if (!cu) return null;
  const { data: s } = await db
    .from("sessions").select("id").eq("channel_user_id", (cu as { id: string }).id).maybeSingle();
  return (s as { id: string } | null)?.id ?? null;
}

function check(reply: string, t: TestTurnSpec): TestCheck[] {
  const out: TestCheck[] = [];
  const low = reply.toLowerCase();
  for (const c of t.contains ?? []) if (c.trim()) out.push({ kind: "contains", value: c, ok: low.includes(c.toLowerCase()) });
  for (const c of t.not_contains ?? []) if (c.trim()) out.push({ kind: "not_contains", value: c, ok: !low.includes(c.toLowerCase()) });
  if (t.matches) {
    let ok = false;
    try { ok = new RegExp(t.matches, "i").test(reply); } catch { ok = false; }
    out.push({ kind: "matches", value: t.matches, ok });
  }
  return out;
}

async function outcomeCheck(sessionId: string | null, want: TestTurnSpec["outcome"]): Promise<TestCheck | null> {
  if (!want || !sessionId) return null;
  const { count } = await dataClient()
    .from("tickets").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
  const filed = (count ?? 0) > 0;
  const ok = want === "ticket_filed" ? filed : !filed;
  return { kind: "outcome", value: want, ok, detail: filed ? "a ticket was filed" : "no ticket" };
}

export async function runScenario(key: string): Promise<TestRunRow> {
  const staff = await requireStaff();
  const db = dataClient();

  const { data: sc } = await db.from("test_scenarios").select("*").eq("key", key).maybeSingle();
  const scenario = sc as TestScenarioRow | null;
  if (!scenario) throw new Error(`Unknown scenario: ${key}`);
  let profile: TestProfileRow | null = null;
  if (scenario.profile_key) {
    const { data: p } = await db.from("test_profiles").select("*").eq("key", scenario.profile_key).maybeSingle();
    profile = p as TestProfileRow | null;
    if (!profile) throw new Error(`Profile ${scenario.profile_key} not found.`);
    if (!profile.email) throw new Error(`Profile "${profile.label}" has no e-mail yet — fill it in on the Test runs page.`);
  }

  const externalId = `test-${scenario.key}-${Date.now().toString(36)}`;
  const { data: created, error: insErr } = await db
    .from("test_runs")
    .insert({ scenario_key: scenario.key, profile_key: scenario.profile_key, external_id: externalId, ran_by: staff.email })
    .select("*").single();
  if (insErr) throw new Error(`start run failed: ${insErr.message}`);
  const run = created as TestRunRow;

  const turns: TestTurnResult[] = [];
  let sessionId: string | null = null;
  let error: string | null = null;
  let failed = false;

  const persist = async (status: TestRunRow["status"], extra: Partial<TestRunRow> = {}) => {
    await db.from("test_runs").update({ status, turns, session_id: sessionId, error, ...extra }).eq("id", run.id);
  };

  try {
    // --- login preamble -------------------------------------------------
    if (profile) {
      const t1 = await say(externalId, "Hi, I have a question about my membership.");
      const asksEmail = /e-?mail/i.test(t1.reply);
      turns.push({ phase: "login", say: "Hi, I have a question about my membership.", reply: t1.reply, ms: t1.ms,
        checks: [{ kind: "login", value: "asks for e-mail", ok: asksEmail }] });
      if (!asksEmail) throw new Error("The bot did not ask for an e-mail address.");

      const t2 = await say(externalId, profile.email!);
      const sentCode = /code/i.test(t2.reply) && !/don'?t see|no account|not find/i.test(t2.reply);
      turns.push({ phase: "login", say: profile.email!, reply: t2.reply, ms: t2.ms,
        checks: [{ kind: "login", value: "sends a code", ok: sentCode }] });
      if (!sentCode) throw new Error("The bot did not send a code for that e-mail (rate limit, or no account).");

      sessionId = await findSession(externalId);
      if (!sessionId) throw new Error("Session not found after login turn.");
      const { data: otp, error: otpErr } = await db.rpc("test_otp_set", { p_session_id: sessionId, p_code: TEST_CODE });
      if (otpErr || otp !== "ok") throw new Error(`test_otp_set: ${otpErr?.message ?? otp}`);

      const t3 = await say(externalId, TEST_CODE);
      const loggedIn = !/invalid|expired|try again|doesn'?t match/i.test(t3.reply);
      turns.push({ phase: "login", say: TEST_CODE, reply: t3.reply, ms: t3.ms,
        checks: [{ kind: "login", value: "code accepted", ok: loggedIn }] });
      if (!loggedIn) throw new Error("The bot rejected the test code.");

      if (profile.login_choice && /which|choose|pick|member id/i.test(t3.reply)) {
        const t4 = await say(externalId, profile.login_choice);
        turns.push({ phase: "login", say: profile.login_choice, reply: t4.reply, ms: t4.ms,
          checks: [{ kind: "login", value: "account chosen", ok: !/didn'?t|invalid|again/i.test(t4.reply) }] });
      }
      await persist("running");
    }

    // --- the scenario ---------------------------------------------------
    for (const t of scenario.turns) {
      const r = await say(externalId, t.say);
      if (!sessionId) sessionId = await findSession(externalId);
      const checks = check(r.reply, t);
      const oc = await outcomeCheck(sessionId, t.outcome ?? null);
      if (oc) checks.push(oc);
      turns.push({ phase: "scenario", say: t.say, reply: r.reply, ms: r.ms, checks });
      if (checks.some((c) => !c.ok)) failed = true;
      await persist("running");
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // --- leave no trace ---------------------------------------------------
  const closed: string[] = [];
  try {
    if (!sessionId) sessionId = await findSession(externalId);
    if (sessionId) {
      const { data: tk } = await db.from("tickets").select("external_ticket_id").eq("session_id", sessionId);
      for (const row of (tk ?? []) as { external_ticket_id: string | null }[]) {
        if (!row.external_ticket_id) continue;
        try { await closeFreshdeskTicketAsTest(row.external_ticket_id); closed.push(row.external_ticket_id); }
        catch (e) { error = (error ? error + " · " : "") + `Freshdesk close ${row.external_ticket_id}: ${e instanceof Error ? e.message : e}`; }
      }
      if (!env.testKeepSessions) {
        const { error: purgeErr } = await db.rpc("test_session_purge", { p_session_id: sessionId });
        if (purgeErr) error = (error ? error + " · " : "") + `purge: ${purgeErr.message}`;
      }
    }
  } catch (e) {
    error = (error ? error + " · " : "") + `cleanup: ${e instanceof Error ? e.message : e}`;
  }

  const status: TestRunRow["status"] = error && turns.every((t) => t.checks.every((c) => c.ok)) && !failed
    ? "error" : error ? "error" : failed ? "failed" : "passed";
  await persist(status, { finished_at: new Date().toISOString(), tickets_closed: closed });
  const { data: final } = await db.from("test_runs").select("*").eq("id", run.id).single();
  return final as TestRunRow;
}
