"use client";

// Friendly error screen for the authenticated app. The most common cause is a
// stale tab after a redeploy (server actions are bound to a build), which a
// reload fixes — so lead with that.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ maxWidth: 520, margin: "80px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 20, fontWeight: 750 }}>Something went wrong</h1>
      <p className="muted" style={{ margin: "12px 0 20px" }}>
        This usually happens when the app was updated while this page was open.
        Reloading almost always fixes it — your data is safe, though the last
        click may not have been saved, so check it after reloading.
      </p>
      <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
        <button onClick={() => window.location.reload()}>Reload page</button>
        <button className="secondary" onClick={() => reset()}>
          Try again
        </button>
      </div>
      {error?.digest && (
        <p className="muted" style={{ marginTop: 18, fontSize: 11 }}>
          Error reference: <span className="mono">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
