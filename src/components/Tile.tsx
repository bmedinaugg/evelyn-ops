// Shared stat tile and hint icon.
//
// Both used to live inside the Sentiment page. Extracted when the Performance
// scorecard needed the same two, rather than copying them — a second copy is
// how two pages start rendering the same number in two different styles.

// One-sentence hint next to a label.
//
// The text goes in data-tip and is drawn by CSS, NOT via the native title
// attribute — title was in the markup and still showed nothing useful on
// hover, because native tooltips wait about a second, cannot be styled, and
// never appear on touch. aria-label carries the same text for screen readers,
// since a bare "i" means nothing, and tabIndex makes it focusable so the hint
// is reachable without a mouse.
//
// `align="right"` pins the tooltip to the icon instead of centring it, for
// icons close to the right edge of a panel.
export function Info({ text, align }: { text: string; align?: "right" }) {
  return (
    <span
      className={`info${align === "right" ? " tip-right" : ""}`}
      data-tip={text}
      aria-label={text}
      role="img"
      tabIndex={0}
    >
      i
    </span>
  );
}

export function Tile({
  k,
  v,
  tone,
  sub,
  info,
}: {
  k: string;
  v: number | string;
  tone?: "alert" | "warn";
  sub?: string;
  info?: string;
}) {
  return (
    <div className={`tile${tone ? " " + tone : ""}`}>
      <div className="k">
        {k}
        {info && <Info text={info} />}
      </div>
      <div className="v">{v}</div>
      {sub && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
