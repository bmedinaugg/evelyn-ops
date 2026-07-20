"use client";

// Last-resort error boundary (covers errors outside the app layout).
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0e1116",
          color: "#e9ecf1",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 480, padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#98a2b0", margin: "12px 0 20px" }}>
            The app was likely updated while this page was open. Reloading
            fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#ff3b47",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload page
          </button>
          {error?.digest && (
            <p style={{ color: "#98a2b0", marginTop: 18, fontSize: 11 }}>
              Error reference: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
