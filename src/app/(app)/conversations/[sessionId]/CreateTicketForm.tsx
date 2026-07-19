"use client";

import { useActionState, useState } from "react";
import { createTicket, type CreateTicketState } from "./actions";
import { FORM_LABELS } from "@/lib/forms";
import type { FormSchemaField, NestedChoices } from "@/lib/types";

const initial: CreateTicketState = {};

// Cascading selects for a Freshdesk nested field (level 1 → 2 → 3).
function NestedField({ field }: { field: FormSchemaField }) {
  const choices = (field.options?.choices ?? {}) as NestedChoices;
  const nested = (field.options?.nested_ticket_fields ?? [])
    .slice()
    .sort((a, b) => a.level - b.level);
  const level2 = nested.find((n) => n.level === 2);
  const level3 = nested.find((n) => n.level === 3);

  const [l1, setL1] = useState("");
  const [l2, setL2] = useState("");

  const l2Options = l1 ? Object.keys(choices[l1] ?? {}) : [];
  const l3Options = l1 && l2 ? (choices[l1]?.[l2] ?? []) : [];

  return (
    <div className="fb-form" style={{ gap: 8 }}>
      <label className="field-label">
        {field.question}
        {field.required && <span className="error"> *</span>}
      </label>
      <select
        name={`cf:${field.field_key}`}
        required={field.required}
        value={l1}
        onChange={(e) => {
          setL1(e.target.value);
          setL2("");
        }}
      >
        <option value="">— select —</option>
        {Object.keys(choices).map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {level2 && l1 && l2Options.length > 0 && (
        <>
          <label className="field-label muted">
            {level2.label_in_portal ?? level2.name}
          </label>
          <select
            name={`cf:${level2.name}`}
            required={field.required}
            value={l2}
            onChange={(e) => setL2(e.target.value)}
          >
            <option value="">— select —</option>
            {l2Options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </>
      )}

      {level3 && l2 && l3Options.length > 0 && (
        <>
          <label className="field-label muted">
            {level3.label_in_portal ?? level3.name}
          </label>
          <select name={`cf:${level3.name}`} required={field.required} defaultValue="">
            <option value="">— select —</option>
            {l3Options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function DynamicField({ field }: { field: FormSchemaField }) {
  switch (field.field_type) {
    case "custom_dropdown": {
      const choices = (field.options?.choices ?? []) as string[];
      return (
        <div className="fb-form" style={{ gap: 8 }}>
          <label className="field-label">
            {field.question}
            {field.required && <span className="error"> *</span>}
          </label>
          <select name={`cf:${field.field_key}`} required={field.required} defaultValue="">
            <option value="">— select —</option>
            {choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "custom_text":
      return (
        <div className="fb-form" style={{ gap: 8 }}>
          <label className="field-label">{field.question}</label>
          <input type="text" name={`cf:${field.field_key}`} />
        </div>
      );
    case "custom_checkbox":
      return (
        <label className="consent-row">
          <input
            type="checkbox"
            name={`cf:${field.field_key}`}
            defaultChecked
          />
          <span className="muted">{field.question}</span>
        </label>
      );
    case "nested_field":
      return <NestedField field={field} />;
    default:
      return null;
  }
}

export function CreateTicketForm({
  sessionId,
  memberEmail,
  transcriptText,
  hasTicket,
  formSchemas,
}: {
  sessionId: string;
  memberEmail: string | null;
  transcriptText: string;
  hasTicket: boolean;
  formSchemas: FormSchemaField[];
}) {
  const [state, action, pending] = useActionState(createTicket, initial);
  const formKeys = [...new Set(formSchemas.map((f) => f.form_key))];
  const [formKey, setFormKey] = useState(
    formKeys.includes("trainmore_general_contact")
      ? "trainmore_general_contact"
      : (formKeys[0] ?? ""),
  );
  const fields = formSchemas
    .filter((f) => f.form_key === formKey)
    .sort((a, b) => a.position - b.position);

  if (state.fdId) {
    return (
      <div className="callout" style={{ borderLeftColor: "var(--green)" }}>
        ✅ Ticket created:{" "}
        <a
          href={`https://urbangymgroup.freshdesk.com/a/tickets/${state.fdId}`}
          target="_blank"
          rel="noreferrer"
        >
          Freshdesk #{state.fdId}
        </a>{" "}
        — it's now linked to this conversation.
      </div>
    );
  }

  return (
    <details className="panel board-add">
      <summary>
        🎫 Create a ticket from this conversation
        {hasTicket && (
          <span className="muted"> (a ticket already exists — this adds another)</span>
        )}
      </summary>
      <form action={action} className="fb-form" style={{ padding: 14 }}>
        <input type="hidden" name="session_id" value={sessionId} />

        <div className="fb-row">
          <span className="fb-label">Form</span>
          <select
            name="form_key"
            value={formKey}
            onChange={(e) => setFormKey(e.target.value)}
          >
            {formKeys.map((k) => (
              <option key={k} value={k}>
                {FORM_LABELS[k] ?? k}
              </option>
            ))}
          </select>
          <span className="muted">which form should the bot have used?</span>
        </div>

        <div className="fb-row">
          <span className="fb-label">Email</span>
          <input
            type="email"
            name="email"
            required
            defaultValue={memberEmail ?? ""}
            placeholder="member@email.com"
            style={{ minWidth: 260 }}
          />
          {!memberEmail && (
            <span className="muted">
              member wasn't authenticated — enter their email
            </span>
          )}
        </div>

        <input
          type="text"
          name="subject"
          required
          placeholder="Subject — what does the member need?"
        />

        {/* Form-specific Freshdesk fields; remount when the form changes */}
        {fields.length > 0 && (
          <div className="ticket-fields" key={formKey}>
            {fields.map((f) => (
              <DynamicField key={f.field_key} field={f} />
            ))}
          </div>
        )}

        <textarea
          name="description"
          rows={8}
          required
          defaultValue={transcriptText}
          style={{ width: "100%" }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          Prefilled with the transcript — edit it down to what the Freshdesk
          agent needs. Member info, form answers and a link back to this
          conversation are appended automatically.
        </span>

        <div className="fb-row">
          <span className="fb-label">Priority</span>
          <select name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        {state.error && <div className="error">{state.error}</div>}

        <div>
          <button type="submit" disabled={pending}>
            {pending ? "Creating in Freshdesk…" : "Create ticket"}
          </button>
        </div>
      </form>
    </details>
  );
}
