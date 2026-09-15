// Who asked for this, and therefore who hears back when it gets an update.
//
// Deliberately NOT the author field. The author is whoever typed it into Evelyn
// Ops — almost always the same person — while the requester is the colleague
// who raised it in Teams or over e-mail and has been waiting ever since. They
// are usually different people, which is the entire reason nobody ever gets
// told their request was dealt with.
//
// Shared by /board and /feedback rather than written twice: the two differ only
// in which server action they post to, and a second copy is a second place for
// the wording to drift.
export function RequestedBy({
  id,
  value,
  action,
  updateWord,
}: {
  id: string;
  value: string | null | undefined;
  action: (formData: FormData) => void | Promise<void>;
  // What counts as an update here — a reply on the board, a resolution note on
  // feedback. Named rather than generic so the promise on screen matches what
  // bot.requester_updates_since() actually sends.
  updateWord: string;
}) {
  const set = !!value;
  return (
    <form
      action={action}
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        flexWrap: "wrap",
        margin: "6px 0 0",
      }}
    >
      <input type="hidden" name="id" value={id} />
      <span
        className="muted"
        style={{ fontSize: 11.5, whiteSpace: "nowrap" }}
        title="They get an e-mail when you write an update. Leave empty for nobody."
      >
        Asked by
      </span>
      <input
        type="email"
        name="requested_by"
        defaultValue={value ?? ""}
        placeholder="nobody — leave empty"
        aria-label="E-mail of the person who asked for this"
        style={{ fontSize: 12, padding: "3px 7px", minWidth: 210 }}
      />
      <button type="submit" className="btn secondary" style={{ fontSize: 11.5, padding: "3px 9px" }}>
        Save
      </button>
      {set && (
        <span className="muted" style={{ fontSize: 11 }}>
          gets an e-mail when you {updateWord}
        </span>
      )}
    </form>
  );
}
