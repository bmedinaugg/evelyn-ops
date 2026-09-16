"use client";

// Just the checkbox. Ticking it submits the form it sits in, so the row saves
// on click rather than making someone find a save button per row. Everything
// else about the section is server-rendered; this is the only part that needs
// to be a client component, and it is kept this small on purpose.
//
// Without JavaScript the checkbox still posts — the <noscript> submit button in
// the row is the fallback.
export function CapabilityToggle({
  defaultChecked,
  label,
}: {
  defaultChecked: boolean;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      name="allowed"
      defaultChecked={defaultChecked}
      aria-label={label}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      style={{ marginTop: 3 }}
    />
  );
}
