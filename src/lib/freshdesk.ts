import "server-only";
import { env } from "@/lib/env";

// Minimal Freshdesk client for manually creating tickets from a conversation.
// Talks straight to the Freshdesk REST API — completely independent of the
// n8n bot's ticket flow.

const PRIORITY_MAP: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

// Freshdesk email config the ticket sends/replies from. Member-facing mail
// must come from "Member Care" <membercare@trainmore.com> — NOT the default
// "Customer Care" config. Override with FRESHDESK_EMAIL_CONFIG_ID if it ever
// changes.
const MEMBER_CARE_EMAIL_CONFIG_ID = Number(
  process.env.FRESHDESK_EMAIL_CONFIG_ID || 103000139454,
);

export interface FreshdeskSearchTicket {
  id: number;
  subject: string;
  created_at: string;
  status: number; // 2 open, 3 pending, 4 resolved, 5 closed
  priority: number; // 1..4
  tags: string[];
}

// Non-member enquiries are created by the bot directly in Freshdesk (tagged
// 'non-member') and never recorded in bot.tickets — so we list them live from
// the Freshdesk search API. Search returns 30/page, max 10 pages.
export async function searchNonMemberTickets(): Promise<FreshdeskSearchTicket[]> {
  const auth = Buffer.from(`${env.freshdeskApiKey}:X`).toString("base64");
  const out: FreshdeskSearchTicket[] = [];
  for (let page = 1; page <= 10; page++) {
    const url = `https://${env.freshdeskDomain}/api/v2/search/tickets?query=${encodeURIComponent(`"tag:'non-member'"`)}&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Freshdesk search failed (HTTP ${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as {
      total: number;
      results: FreshdeskSearchTicket[];
    };
    out.push(...data.results);
    if (out.length >= data.total || data.results.length === 0) break;
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createFreshdeskTicket(input: {
  email: string;
  name: string | null;
  subject: string;
  description: string; // plain text; converted to HTML here
  priority: string; // low | medium | high | urgent
  customFields?: Record<string, string | boolean>;
}): Promise<string> {
  const auth = Buffer.from(`${env.freshdeskApiKey}:X`).toString("base64");

  const html = input.description
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const res = await fetch(`https://${env.freshdeskDomain}/api/v2/tickets`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      ...(input.name ? { name: input.name } : {}),
      subject: input.subject,
      description: html,
      status: 2, // open
      priority: PRIORITY_MAP[input.priority] ?? 2,
      email_config_id: MEMBER_CARE_EMAIL_CONFIG_ID,
      // evelyn-bot = came from the Evelyn flow; evelyn-ops-manual = created
      // afterwards by an agent (the bot failed to open it).
      tags: ["evelyn-bot", "evelyn-ops-manual"],
      ...(input.customFields && Object.keys(input.customFields).length > 0
        ? { custom_fields: input.customFields }
        : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Freshdesk rejected the ticket (HTTP ${res.status}): ${body.slice(0, 300)}`,
    );
  }

  const data = (await res.json()) as { id: number };
  return String(data.id);
}
