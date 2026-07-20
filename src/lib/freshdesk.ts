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
