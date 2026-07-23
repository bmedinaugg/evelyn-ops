// Turns a raw n8n error_message (often "HTTP CODE - <json-ish body>") into a
// plain-language headline + a cleaned-up detail string, for the Dev fails
// page. Best-effort only: falls back to showing the raw message untouched
// whenever a pattern doesn't match or parsing fails.

export type ErrorTone = "red" | "amber" | "grey" | "blue";

export interface FriendlyError {
  tone: ErrorTone;
  category: string;
  headline: string;
  detail: string; // cleaned-up message to show in place of the raw blob
}

// Best-effort extraction of a human message from n8n's "CODE - body" shape,
// where body is sometimes a JSON string, sometimes a double-JSON-encoded
// string (a JSON string containing another JSON string), and sometimes not
// JSON at all.
function extractDetail(raw: string): string {
  const m = raw.match(/^\s*\d{3}\s*-\s*(.+)$/s);
  let body = m ? m[1].trim() : raw;

  for (let i = 0; i < 2; i++) {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed === "string") {
        body = parsed;
        continue;
      }
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.message === "string") return obj.message;
        return JSON.stringify(parsed);
      }
    } catch {
      break;
    }
  }
  return body;
}

const PATTERNS: { test: RegExp; tone: ErrorTone; category: string; headline: string }[] = [
  {
    test: /invalid input syntax for type uuid/i,
    tone: "amber",
    category: "Bad data",
    headline: "Bad data reached the database (an ID field was empty or malformed).",
  },
  {
    test: /invalid json in model output|doesn't fit required format|model output/i,
    tone: "amber",
    category: "AI output",
    headline: "The AI model returned output that didn't parse as expected.",
  },
  {
    test: /rate.?limit/i,
    tone: "amber",
    category: "Rate limited",
    headline: "Hit a rate limit calling an external service.",
  },
  {
    test: /ETIMEDOUT|ESOCKETTIMEDOUT|timed? ?out/i,
    tone: "red",
    category: "Timeout",
    headline: "Timed out waiting for an external service.",
  },
  {
    test: /ECONNREFUSED|ENOTFOUND|ECONNRESET/i,
    tone: "red",
    category: "Connection error",
    headline: "Could not reach an external service.",
  },
  {
    test: /^\s*401\b|unauthoriz|invalid.*(api key|credential|token)/i,
    tone: "red",
    category: "Auth error",
    headline: "An external service rejected our credentials.",
  },
  {
    test: /^\s*4\d\d\b|bad request/i,
    tone: "red",
    category: "Rejected request",
    headline: "An external service rejected the request.",
  },
  {
    test: /^\s*5\d\d\b/,
    tone: "red",
    category: "Service error",
    headline: "An external service returned a server error.",
  },
];

export function summarizeWorkflowError(raw: string | null): FriendlyError {
  if (!raw) {
    return { tone: "grey", category: "Unknown", headline: "No error message recorded.", detail: "" };
  }
  const detail = extractDetail(raw);
  const match = PATTERNS.find((p) => p.test.test(raw));
  if (match) {
    return { tone: match.tone, category: match.category, headline: match.headline, detail };
  }
  return {
    tone: "grey",
    category: "Other",
    headline: detail.length > 140 ? detail.slice(0, 140) + "…" : detail,
    detail,
  };
}
