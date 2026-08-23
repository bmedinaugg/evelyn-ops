// Shown instantly on navigation between app pages (Suspense fallback) while
// the server component fetches live data — so clicks feel responsive instead
// of frozen. Generic enough for every page (header + tiles + a table).
export default function Loading() {
  return (
    <>
      <div className="pagehead">
        <div className="skeleton" style={{ height: 28, width: 200 }} />
        <div className="skeleton" style={{ height: 34, width: 200 }} />
      </div>

      <div className="grid tiles" style={{ marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 78 }} />
        ))}
      </div>

      <div className="panel" style={{ padding: "4px 16px" }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="sk-row">
            <div className="skeleton sk-line" style={{ flex: 2 }} />
            <div className="skeleton sk-line" style={{ flex: 3 }} />
            <div className="skeleton sk-line" style={{ flex: 1 }} />
            <div className="skeleton sk-line" style={{ flex: 2 }} />
          </div>
        ))}
      </div>
    </>
  );
}
