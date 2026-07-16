// Shared, framework-neutral constants (safe to import from client or server).
// The tag values are what get stored in bot.conversation_feedback.tags[].

export const FEEDBACK_TAGS = [
  { value: "wrong-info", label: "Wrong info" },
  { value: "incomplete", label: "Incomplete" },
  { value: "tone", label: "Tone" },
  { value: "missing-faq", label: "Missing FAQ" },
  { value: "escalation", label: "Needed escalation" },
  { value: "great-answer", label: "Great answer" },
] as const;

export const FEEDBACK_TAG_VALUES = FEEDBACK_TAGS.map((t) => t.value);

export function feedbackTagLabel(value: string): string {
  return FEEDBACK_TAGS.find((t) => t.value === value)?.label ?? value;
}
