import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import type { AiSuggestion, Conversation, ConversationFeedback } from "@/lib/types";
import { feedbackTagLabel } from "@/lib/feedback-tags";

// How the live bot works — grounds Claude's fix suggestions in the real
// architecture so its advice maps to changes we can actually make.
const BOT_CONTEXT = `
Evelyn is a customer-support chatbot for Urban Gym Group (brand: TrainMore),
serving gym members over Telegram. Architecture:
- Orchestration runs in n8n ("Bot - Main" plus sub-workflows for authentication,
  OTP, ticket collection, intent classification).
- State lives in Supabase (Postgres), schema "bot": sessions (state machine:
  new, awaiting_email, authenticating, authenticated_idle, ticket_collecting,
  ticket_confirming, awaiting_otp, awaiting_studio_selection), conversation
  messages, customers, tickets.
- General questions are answered via an "FAQ Search" tool inside n8n: a
  retrieval step over a pgvector knowledge base (per-brand FAQ tables with
  embedding-based match functions). If no FAQ matches, the bot says it couldn't
  find the information and offers to open a ticket.
- Tickets are created in Freshdesk. Members authenticate via email + OTP
  against the Magicline membership system.
- The support team reviews conversations and files feedback; the maintainer
  (a developer) applies fixes: adding/editing FAQs in the knowledge base,
  adjusting n8n workflow logic, or changing the bot's prompts.
`.trim();

const SUGGESTION_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  required: ["diagnosis", "fix_type", "suggested_action", "proposed_faq"],
  properties: {
    diagnosis: {
      type: "string",
      description:
        "What went wrong in this conversation, in 1-3 sentences, grounded in the transcript.",
    },
    fix_type: {
      type: "string",
      enum: [
        "missing_faq",
        "faq_content_fix",
        "bot_behavior",
        "prompt_change",
        "no_fix_needed",
        "other",
      ],
      description:
        "missing_faq: knowledge base lacks an entry. faq_content_fix: an existing FAQ is wrong/incomplete. bot_behavior: n8n workflow/state logic issue. prompt_change: the bot's tone/phrasing needs a prompt tweak. no_fix_needed: the bot behaved correctly.",
    },
    suggested_action: {
      type: "string",
      description:
        "Concrete next step for the maintainer, in 1-3 sentences (e.g. which FAQ to add, which workflow to adjust and how).",
    },
    proposed_faq: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["question", "answer"],
          properties: {
            question: {
              type: "string",
              description: "The FAQ question, phrased the way a member would ask it.",
            },
            answer: {
              type: "string",
              description:
                "A complete, member-facing answer the team can review. If a factual detail is unknown, mark it like [CONFIRM: opening hours].",
            },
          },
        },
        { type: "null" },
      ],
      description:
        "Draft FAQ entry when fix_type is missing_faq or faq_content_fix; null otherwise.",
    },
  },
};

function transcriptText(conv: Conversation): string {
  const msgs = conv.messages ?? [];
  // Cap defensively; transcripts here are typically small.
  return msgs
    .slice(0, 200)
    .map((m) => `[${m.at}] ${m.role.toUpperCase()}: ${m.content ?? ""}`)
    .join("\n");
}

/**
 * Ask Claude to diagnose the conversation + team feedback and propose a fix.
 * Called from a server action; caller must have passed requireStaff().
 */
export async function generateFixSuggestion(
  conv: Conversation,
  feedback: ConversationFeedback,
): Promise<AiSuggestion> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const feedbackDesc = [
    feedback.rating ? `Rating: ${feedback.rating}` : null,
    feedback.tags?.length
      ? `Tags: ${feedback.tags.map(feedbackTagLabel).join(", ")}`
      : null,
    feedback.detail ? `Detail from the team: ${feedback.detail}` : null,
    feedback.comment ? `Comment: ${feedback.comment}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: `You are the maintainer's assistant for the Evelyn support chatbot. Your job: given a conversation transcript and the support team's feedback on it, diagnose what went wrong and propose the most concrete, minimal fix.\n\n${BOT_CONTEXT}`,
    messages: [
      {
        role: "user",
        content: `The support team flagged this conversation.\n\n## Team feedback\n${feedbackDesc || "(no structured feedback — infer from the transcript)"}\n\n## Conversation transcript\n${transcriptText(conv)}\n\n## Member\n${conv.session?.customer ?? "unknown"} (state at end: ${conv.session?.state ?? "unknown"})\n\nDiagnose the failure and propose a fix. If the right fix is a new or corrected FAQ, draft it fully so the team only has to review it.`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: SUGGESTION_SCHEMA,
      },
    },
  });

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to analyze this conversation.");
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) throw new Error("AI returned no analysis.");
  return JSON.parse(textBlock.text) as AiSuggestion;
}
