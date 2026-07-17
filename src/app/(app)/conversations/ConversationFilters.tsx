"use client";

import { useRouter } from "next/navigation";

type Values = {
  member?: string;
  state?: string;
  outcome?: string;
  ticket?: string;
  preview?: string;
};

export function ConversationFilters({
  date,
  values,
  states,
  outcomeOptions,
}: {
  date: string;
  values: Values;
  states: string[];
  outcomeOptions: { value: string; label: string; count: number }[];
}) {
  const router = useRouter();

  const apply = (patch: Values) => {
    const merged: Record<string, string | undefined> = {
      date,
      ...values,
      ...patch,
    };
    const p = new URLSearchParams();
    Object.entries(merged).forEach(([k, v]) => {
      if (v) p.set(k, v);
    });
    router.push(`/conversations?${p.toString()}`);
  };

  const onText =
    (key: keyof Values) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") apply({ [key]: e.currentTarget.value });
    };

  return (
    <tr className="filter-row">
      {/* Time */}
      <th />
      {/* Member */}
      <th>
        <input
          type="search"
          placeholder="name…"
          defaultValue={values.member}
          onKeyDown={onText("member")}
          onBlur={(e) => apply({ member: e.currentTarget.value })}
        />
      </th>
      {/* Msgs */}
      <th />
      {/* State */}
      <th>
        <select
          defaultValue={values.state ?? ""}
          onChange={(e) => apply({ state: e.target.value })}
        >
          <option value="">All</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </th>
      {/* Outcome */}
      <th>
        <select
          defaultValue={values.outcome ?? ""}
          onChange={(e) => apply({ outcome: e.target.value })}
        >
          <option value="">All</option>
          {outcomeOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
      </th>
      {/* Ticket */}
      <th>
        <select
          defaultValue={values.ticket ?? ""}
          onChange={(e) => apply({ ticket: e.target.value })}
        >
          <option value="">All</option>
          <option value="has">Has ticket</option>
          <option value="unsynced">Unsynced</option>
          <option value="none">No ticket</option>
        </select>
      </th>
      {/* Preview */}
      <th>
        <input
          type="search"
          placeholder="message…"
          defaultValue={values.preview}
          onKeyDown={onText("preview")}
          onBlur={(e) => apply({ preview: e.currentTarget.value })}
        />
      </th>
    </tr>
  );
}
