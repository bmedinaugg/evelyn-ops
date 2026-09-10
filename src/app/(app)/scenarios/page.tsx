import Link from "next/link";
import { getScenarioLibrary } from "@/lib/queries";
import type { ScenarioEntry, ScenarioOverlap } from "@/lib/types";

export const metadata = { title: "Scenario library · Evelyn Ops" };
export const dynamic = "force-dynamic";

// Board item a0718672: "Provide examples of what the bot recognizes as a
// certain scenario".
//
// The honest framing matters here, so it is on the page rather than only in the
// commit message: Evelyn does not log "I decided this was a cancellation".
// bot.tickets.category has six coarse values, while the training guide defines
// fourteen scenarios, so there is no recorded decision to list. What DOES exist
// is the set of patterns in the live n8n nodes. So this library is produced by
// taking those patterns verbatim and replaying them over real member messages —
// every example below is something a member actually wrote, and it matched.
//
// Which is why the examples include ones that look wrong. That is the point:
// the false positives are the part Member Care cannot work out from the guide.

// Order runs roughly by how much of Member Care's queue each scenario drives,
// so the page opens on what matters rather than on alphabetical accident.
const GROUPS: { title: string; blurb: string; keys: string[] }[] = [
  {
    title: "Contract changes",
    blurb:
      "These four share ONE classifier, checked in a fixed order. If a message looks like two of them at once, the earlier check wins — see the collisions below.",
    keys: ["cancellation", "extension", "change", "freeze"],
  },
  {
    title: "Money",
    blurb: "Recognised well enough to answer or to open a payments ticket.",
    keys: ["payment_date", "owes_money", "invoice"],
  },
  {
    title: "Clubs & classes",
    blurb: "Answered from the FAQ and club data, usually without a ticket.",
    keys: ["class_booking", "attendance"],
  },
  {
    title: "Routing signals",
    blurb:
      "Not member requests — these change how the conversation is handled at all.",
    keys: ["cooling_off", "not_a_member", "wants_human"],
  },
];

function Scenario({ s }: { s: ScenarioEntry }) {
  return (
    <div className="scenario">
      <div className="scenario-head">
        <h3>{s.label}</h3>
        <span className="muted mono">{s.key}</span>
      </div>
      <p className="scenario-plain">{s.plain}</p>
      <div className="scenario-stats muted">
        <b>{s.matches.toLocaleString()}</b> messages ·{" "}
        <b>{s.sessions.toLocaleString()}</b> conversations · recognised in{" "}
        <span className="mono">{s.source}</span>
      </div>
      <ul className="examples">
        {/* The generator stores a wide pool (14) so the PDF builder can choose
            from it; six is as many as reads usefully on screen. */}
        {s.examples.slice(0, 6).map((ex, i) => (
          <li key={i}>
            <span className="quote">“{ex.text}”</span>
            <Link href={`/conversations/${ex.session_id}`} className="exlink">
              {ex.at}
            </Link>
          </li>
        ))}
      </ul>
      {s.misfires && s.misfires.length > 0 && (
        <div className="misfires">
          <div className="misfire-title">
            Also trips on{" "}
            <span className="muted">
              — {s.misfires.reduce((n, m) => n + m.messages, 0).toLocaleString()} of{" "}
              {s.matches.toLocaleString()} matches are about something else. These
              are the ones we could measure, so treat it as a floor.
            </span>
          </div>
          {s.misfires.map((m, i) => (
            <div key={i} className="misfire">
              <div className="misfire-head">
                <b>{m.label}</b>
                <span className="muted">
                  {m.messages.toLocaleString()} · {m.pct}%
                </span>
              </div>
              <div className="misfire-why muted">{m.why}</div>
              {m.examples.map((t, j) => (
                <div key={j} className="quote small">
                  “{t}”
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Collision({ o, byKey }: { o: ScenarioOverlap; byKey: Map<string, ScenarioEntry> }) {
  const la = byKey.get(o.a)?.label ?? o.a;
  const lb = byKey.get(o.b)?.label ?? o.b;
  const won = o.handled_as ? byKey.get(o.handled_as)?.label ?? o.handled_as : null;
  return (
    <div className="collision">
      <div className="collision-head">
        <span className="cpair">
          {la} <span className="muted">+</span> {lb}
        </span>
        <span className="muted">{o.messages.toLocaleString()} messages</span>
      </div>
      <div className="collision-verdict">
        {won ? (
          <>
            Handled as <b>{won}</b> — it is checked first.
          </>
        ) : (
          <span className="muted">
            Different code paths, so both can apply depending on where the
            conversation is.
          </span>
        )}
      </div>
      {o.sample && <div className="quote small">“{o.sample}”</div>}
    </div>
  );
}

export default async function ScenariosPage() {
  const lib = await getScenarioLibrary();

  if (!lib) {
    return (
      <>
        <div className="pagehead">
          <h1>Scenario library</h1>
        </div>
        <p className="muted">
          Not generated yet. Run <span className="mono">tools/scenarios/generate.js</span>.
        </p>
      </>
    );
  }

  const { scenarios, overlaps } = lib.doc;
  const byKey = new Map(scenarios.map((s) => [s.key, s]));
  const grouped = GROUPS.map((g) => ({
    ...g,
    entries: g.keys.map((k) => byKey.get(k)).filter(Boolean) as ScenarioEntry[],
  }));
  // Anything the generator produces that this page has not been told where to
  // put still gets shown, so adding a recogniser cannot make it invisible.
  const placed = new Set(GROUPS.flatMap((g) => g.keys));
  const unplaced = scenarios.filter((s) => !placed.has(s.key));

  const generated = new Date(lib.generated_at);
  const stale = lib.age_days >= 14;

  return (
    <>
      <div className="pagehead">
        <h1>Scenario library</h1>
      </div>
      <p className="muted" style={{ marginBottom: 10 }}>
        What Evelyn recognises, in the members&apos; own words. Every quote below
        is a real message that actually matched the pattern the live bot uses —
        including the ones that matched by mistake.
      </p>

      <div className="callout">
        <b>How this is built, and what it is not.</b> Evelyn does not record
        &ldquo;I decided this was a cancellation&rdquo;, so this is not a log of
        decisions. It is produced by taking each recogniser out of the live n8n
        nodes and replaying it over{" "}
        {lib.messages_scanned
          ? `${lib.messages_scanned.toLocaleString()} member messages`
          : "real member messages"}
        {lib.window_from && lib.window_to
          ? ` sent between ${lib.window_from} and ${lib.window_to}`
          : ""}
        . So it shows what the patterns <i>do</i>, not what we intended them to
        do — the difference is the useful part. Matching a pattern is also only
        the first step: the AI still reads the whole message, so a match is not a
        guarantee of how the conversation ends up being handled.
      </div>

      <div className={`freshness${stale ? " warn" : ""}`}>
        Generated {generated.toISOString().slice(0, 10)}
        {lib.age_days > 0 && ` · ${lib.age_days} day${lib.age_days === 1 ? "" : "s"} old`}
        {stale && " — a classifier may have changed since. Worth regenerating."}
      </div>

      {grouped.map((g) => (
        <section key={g.title} className="scen-group">
          <h2>{g.title}</h2>
          <p className="muted">{g.blurb}</p>
          {g.entries.map((s) => (
            <Scenario key={s.key} s={s} />
          ))}
        </section>
      ))}

      {unplaced.length > 0 && (
        <section className="scen-group">
          <h2>Other</h2>
          {unplaced.map((s) => (
            <Scenario key={s.key} s={s} />
          ))}
        </section>
      )}

      <section className="scen-group">
        <h2>When two scenarios collide</h2>
        <p className="muted">
          This is where &ldquo;the bot got it wrong&rdquo; usually comes from.
          Plenty of messages match more than one pattern, and the contract-change
          classifier stops at the first one it finds — in the order{" "}
          <b>extension → cancellation → change</b>. So a member who mentions both
          is handled as whichever comes first, even when the other one is what
          they actually wanted.
        </p>
        {overlaps
          .filter((o) => o.messages >= 30)
          .map((o, i) => (
            <Collision key={i} o={o} byKey={byKey} />
          ))}
      </section>
    </>
  );
}
