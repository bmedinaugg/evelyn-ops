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
  currentUser,
}: {
  id: string;
  value: string | null | undefined;
  action: (formData: FormData) => void | Promise<void>;
  // The signed-in user, so the one case that is deliberately silent can say so.
  currentUser?: string;
  // What counts as an update here — a reply on the board, a resolution note on
  // feedback. Named rather than generic so the promise on screen matches what
  // bot.requester_updates_since() actually sends.
  updateWord: string;
}) {
  const set = !!value;
  // Your own address used to be silently suppressed, which made the feature
  // look broken to the first person who tested it the obvious way. db/045
  // removed that: the field is an explicit instruction and now does what it
  // says. The note stays so nobody is surprised to receive their own words
  // back.
  const isSelf =
    set &&
    !!currentUser &&
    value!.trim().toLowerCase() === currentUser.trim().toLowerCase();
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
      {set && !isSelf && (
        <span className="muted" style={{ fontSize: 11 }}>
          gets an e-mail when you {updateWord}
        </span>
      )}
      {isSelf && (
        <span className="badge amber" style={{ fontSize: 10.5 }}>
          that&rsquo;s you — no e-mail is sent for your own updates
        </span>
      )}
    </form>
  );
}
