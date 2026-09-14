// Shared between the server-rendered list and the client-rendered filters, so
// the two cannot drift on what a source is called or what a wiring badge means.

// Source answers "where did this come from"; wiring answers "can I get it
// changed". Separate axes on purpose — a Freshdesk article and a Member Care
// answer are both live but edited in completely different places.
export const SOURCE: Record<
  string,
  { label: string; badge: string; where: string }
> = {
  freshdesk: {
    label: "Freshdesk",
    badge: "blue",
    where: "Edit the help article. It is in the bot the next morning.",
  },
  // Recorded as "TrainMore FAQs.xlsx" until 14 Sep 2026. That identification
  // was an inference from column shape, never traced, and the file was never
  // found — so it is named for what we actually know about it.
  unidentified: {
    label: "Second feed",
    badge: "red",
    where:
      "Nobody knows. Something writes this into the store every morning and we have not traced what — so there is no way to correct it at source yet.",
  },
  member_care: {
    label: "Member Care",
    badge: "green",
    where: "Edit the row in bot.manual_faqs. It is in the bot the next morning.",
  },
  club_directory: {
    label: "Club sheet",
    badge: "blue",
    where: "Edit the club workbook. It syncs at 10:00 every day.",
  },
  prompt: {
    label: "Prompt",
    badge: "amber",
    where: "Typed into an n8n node. Changing it needs an edit and a publish.",
  },
};

export const WIRING: Record<string, { label: string; badge: string }> = {
  live: { label: "Live", badge: "green" },
  deploy: { label: "Needs a deploy", badge: "amber" },
  not_wired: { label: "Nothing reads it", badge: "red" },
};

// "This is wrong" and "this is right but nobody finds it" are different work
// and go to different people, so the note carries which one it is.
export const KINDS: { value: string; label: string }[] = [
  { value: "wrong", label: "This is wrong" },
  { value: "outdated", label: "Out of date" },
  { value: "unclear", label: "Right, but unclear" },
  { value: "missing", label: "Something is missing" },
  { value: "context", label: "Context, not work" },
];

export const KIND_LABEL: Record<string, string> = Object.fromEntries(
  KINDS.map((k) => [k.value, k.label]),
);

export type Sort = "demand" | "title" | "notes";

// How many rows to put in the DOM at once. Everything is loaded and searched
// on the server — this caps only what is painted, so arriving at the page
// costs one screenful rather than 229 of them.
export const PAGE = 60;
