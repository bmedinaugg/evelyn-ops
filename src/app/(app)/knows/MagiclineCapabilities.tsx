import type { MagiclineCapabilityRow } from "@/lib/types";
import { setCapabilityAllowedAction } from "./actions";
import { CapabilityToggle } from "./CapabilityToggle";

// What the Magicline API can answer — the half of Evelyn's knowledge that is
// not a document. Everything else on /knows comes from something someone wrote
// (a Freshdesk article, the club sheet, a rule typed into a prompt). These
// answers are read live, per member, per question, and are never stored.
//
// Two columns that look alike and are not:
//   wired   — can the bot reach it today. A fact.
//   allowed — does Member Care want it answered. A preference, and nothing
//             reads it yet. The panel says so; do not soften that wording
//             without wiring it first.

const AREA = {
  account: {
    title: "About a member",
    blurb:
      "Read from the member's own record after they log in. Nothing here is stored — it is fetched at the moment the question is asked, so it is as right or as wrong as Magicline is.",
  },
  clubs: {
    title: "About a club or a product",
    blurb:
      "Needs no login at all. Almost none of it is wired: the bot answers these from hand-maintained copies instead, which is why prices and opening hours drift.",
  },
} as const;

function Row({
  cap,
  back,
}: {
  cap: MagiclineCapabilityRow;
  back: string;
}) {
  return (
    <li
      style={{
        padding: "7px 0",
        borderTop: "1px solid var(--border, #e6e6e6)",
      }}
    >
      <form
        action={setCapabilityAllowedAction}
        style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
      >
        <input type="hidden" name="key" value={cap.key} />
        <input type="hidden" name="back" value={back} />
        <CapabilityToggle
          defaultChecked={cap.allowed}
          label={`Evelyn may answer: ${cap.question}`}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
            {cap.question}
            {!cap.wired && (
              <span
                className="muted"
                style={{ fontSize: 11, marginLeft: 8, whiteSpace: "nowrap" }}
              >
                · not wired
              </span>
            )}
          </div>
          <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
            {cap.backed_by}
          </div>
          {cap.note && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              {cap.note}
            </div>
          )}
          {cap.updated_by && (
            <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
              {cap.allowed ? "Allowed" : "Not wanted"} · set by {cap.updated_by}
            </div>
          )}
        </div>
        <noscript>
          <button type="submit" className="btn secondary" style={{ fontSize: 11 }}>
            save
          </button>
        </noscript>
      </form>
    </li>
  );
}

export function MagiclineCapabilities({
  caps,
  back,
}: {
  caps: MagiclineCapabilityRow[];
  back: string;
}) {
  if (!caps.length) return null;
  const notWanted = caps.filter((c) => !c.allowed).length;
  const notWired = caps.filter((c) => !c.wired).length;

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0, fontSize: 16 }}>
        What the Magicline API can answer
      </h2>
      <p style={{ fontSize: 13.5, lineHeight: 1.6, maxWidth: "72ch" }}>
        Everything else on this page is a document someone wrote. This is not:
        these answers are read out of Magicline live, per member, per question,
        and none of it is stored anywhere. It is the other half of what Evelyn
        knows, and it has never been listed.
      </p>
      <p
        style={{
          fontSize: 13,
          lineHeight: 1.6,
          maxWidth: "72ch",
          padding: "8px 11px",
          borderRadius: 6,
          background: "var(--warnbg, #fdf3e3)",
        }}
      >
        <strong>The tick box records what you want, it does not do it yet.</strong>{" "}
        Unticking a row writes down that Member Care does not want Evelyn
        answering it, with your name against it. Nothing in the bot reads that
        setting, so Evelyn goes on answering exactly as before. Making it take
        effect is a separate change to the Q&amp;A workflow &mdash; worth doing
        once this list has been argued over, and worth being honest about until
        then.
      </p>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: "72ch" }}>
        <strong>&ldquo;Not wired&rdquo; is a different thing from unticked.</strong>{" "}
        {notWired} of these {caps.length} are answers Magicline holds that the
        bot cannot currently reach at all &mdash; it uses a hand-maintained copy
        instead, which is why club prices and opening hours drift. That is a
        gap in what was built, not a decision anyone made.
        {notWanted > 0 && (
          <>
            {" "}
            {notWanted} {notWanted === 1 ? "row is" : "rows are"} currently
            marked as not wanted.
          </>
        )}
      </p>

      {(["account", "clubs"] as const).map((area) => {
        const rows = caps.filter((c) => c.area === area);
        if (!rows.length) return null;
        return (
          <div key={area} style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13.5, margin: "0 0 2px" }}>
              {AREA[area].title}
              <span className="muted" style={{ fontWeight: 400 }}>
                {" "}
                · {rows.length}
              </span>
            </h3>
            <p className="muted" style={{ fontSize: 12, margin: "0 0 4px", maxWidth: "72ch" }}>
              {AREA[area].blurb}
            </p>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {rows.map((c) => (
                <Row key={c.key} cap={c} back={back} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
