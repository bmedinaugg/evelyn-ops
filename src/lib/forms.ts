// Client-safe constants for the Freshdesk ticket forms (bot.form_schemas).

export const FORM_LABELS: Record<string, string> = {
  trainmore_general_contact: "General contact",
  trainmore_change_membership: "Change membership",
  trainmore_early_cancellation: "Early cancellation",
  trainmore_membership_extension: "Membership extension",
};

export function formLabel(formKey: string): string {
  return FORM_LABELS[formKey] ?? formKey;
}

/** Category value recorded on bot.tickets for a manual ticket. */
export function formCategory(formKey: string): string {
  return formKey.replace(/^trainmore_/, "");
}
