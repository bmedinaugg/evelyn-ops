# "I've cancelled that ticket" — three defects behind one sentence

*Written 4–5 Sep 2026 for Member Care feedback `633adda5`, `280ba79a` and
`9282cdda`. Shipped as the `Cancel Honesty 2026-09-04` node in
**Bot - Ticket Collection Agent** (`Yq2zEE9NQo6hQvnO`), live version
`071cad8a`.*

---

## The sentence

The collection prompt hardcodes one reply for a cancelled draft, at lines 163
and 241:

> No worries — I've cancelled that ticket. Anything else I can help with?

The bot said some version of this in **218 messages across 205 sessions**
between 20 Aug and 4 Sep — a steady **~13 sessions a day**, every day. Three of
Nelly's four reports in this batch are about that one sentence, and they turn
out to be three different bugs.

## What the bot can actually cancel

`transition='cancel'` calls `bot.cancel_ticket_collection(session_id, draft_id)`
and marks the **draft** abandoned. That is all. There is no code path anywhere
in the bot that modifies a ticket already in Freshdesk. So any sentence implying
a filed ticket was cancelled is false by construction.

---

## Defect A — claiming to cancel a ticket that is already with the team

**4 sessions in 16 days.** Small, and the most serious thing in the batch.

The worked example is `633adda5`, session `b861620c`, 3 Sep:

| time | who | what |
|---|---|---|
| 13:42:16 | Dina | "Hi there , could you please void my previous ticket request?" |
| 13:43:17 | Dina | enters her verification code |
| 13:43:22 | — | an **empty draft** is created (`525ae26d`, subject `NULL`) |
| 13:43:25 | bot | "You're all set, Dina! 👋 **No worries — I've cancelled that ticket.**" |

The draft it cancelled was one it had created itself three seconds earlier and
never showed her. Her actual ticket — **632968, "TrainMore, Early Cancellation
Request", filed 1 Sep** — was never touched. As of 5 Sep it is **still Open and
assigned to an agent**.

So a member asked us to stop her membership cancellation, was told we had, and
we hadn't. Nelly's ask on the ticket was exactly right: give the ticket number
and a summary, and confirm before doing anything.

**A caveat that shaped the fix.** Migration `db/017` gives the agent
`customer.recent_tickets` — the member's recent tickets — and it is live. But it
reads `bot.tickets`, which only holds tickets *this chat* raised. Dina's 632968
came from a web form, so it is **not** in that list. The rule therefore never
depends on the list being populated: it names a ticket when it can, asks which
one when it cannot, and is explicitly forbidden from telling a member no such
ticket exists.

## Defect B — "no thanks" read as "throw my request away"

**97 of the 218 claims (45%).** By far the most common cause, and only 23 (11%)
came from an actual cancel word.

The preview says *"Reply NO to cancel"*. That mapping is being applied to every
"no", regardless of what the bot last said. Both of Nelly's other reports are
this:

- `280ba79a`, session `4892768f` — Gabriel asked to speak to a human. The bot
  said *"A colleague will personally follow up with you via email. Is there
  anything else I can assist you with?"*, he replied **"No, thank you"**, and
  his `Request to speak with a human` draft was cancelled. He was answering
  "anything else?", not the ticket.
- `9282cdda`, session `4e1df4af` — Cor pasted a formal objection to a price
  increase. The bot offered the early-cancellation form link; he replied
  **"Nee dank je"** to the *link*; the bot cancelled a null-subject draft and
  told him so. Nelly: *"what does this refer to?"*

## Defect C — announcing the cancellation of a draft nobody saw

**41 of the 218 (19%)** cancelled a draft whose `subject` was `NULL`. Nothing
had been collected and no preview had been shown, so from the member's side no
ticket ever existed and the sentence refers to nothing.

---

## The fix

A new code node, `Cancel Honesty 2026-09-04`, sits between
`Change Options Briefing 2026-08-26` and `Ticket Collection LLM` — last in the
chain, so its text is prepended on top of the briefing and the guardrails. Same
precedence reasoning as `Feedback Overrides 2026-08-26`.

| rule | fires when | tells the model to |
|---|---|---|
| **A** | member points at an already-filed ticket and asks to kill it | never claim it cancelled it; name the ticket or ask which; file a normal `Withdraw ticket #N` ticket |
| **B** | bare decline and the previous turn was **not** a preview | `transition='stay'`, short warm close, announce nothing |
| **C** | an abort word and no preview has ever been shown | use "I haven't sent anything to our team" instead of "I've cancelled that ticket" |

Every rule is gated in code. On a turn where none apply the node returns its
input **byte-identical**, so the ~99% of traffic that has nothing to do with
cancelling is untouched.

## What the replay changed

The node was replayed over **11,101 real user turns** (29 Aug – 4 Sep) before
publishing. The first version was badly wrong in three ways that no unit test
would have caught:

1. **Rule C fired on 83.9% of turns.** It was gated only on "no preview yet",
   which is most of every conversation. Injecting six lines of cancel guidance
   into five out of six turns is its own regression. Now gated on an actual
   abort word → **0.03%**.
2. **Rule B hijacked the confirm gate.** *"say yes to submit, no to cancel"* is
   not the 📋 preview header but it **is** the moment "no" legitimately means
   cancel. Added to the preview pattern — including the Dutch *"zeg YES om in
   te dienen, NO om te annuleren"*, where `indienen` is split as "in te dienen"
   and a naive pattern misses it entirely.
3. **Rule A fired on members opening a cancellation.** *"I would like to Open
   the Early Cancellation Request form"* matched, because "cancellation" sits
   next to "request". Seven such hits — and every one would have told a member
   trying to cancel their **membership** that we cannot withdraw tickets, which
   is worse than the bug being fixed. Three guards now: the flow noun-phrase is
   neutralised before matching, an explicit ticket reference is required, and
   messages over 400 characters are excluded unless they carry a ticket number.

A fourth bug surfaced only in the replay: the scrub placeholder was originally
`MEMBERSHIPCANCELFLOW`, which **contains "CANCEL"** and so re-matched the
cancel-verb pattern it was meant to remove. Renamed `ZZFLOWZZ`.

Final blast radius: **1.18% of turns** get any block — Rule A 0.02%, Rule B
1.14%, Rule C 0.03%. All Rule A and Rule C hits were read individually.

## Tests

`scratchpad/cancelfix/suite.js`, **30/30**, built from the real sessions. It is
mutation-tested: removing the question guard, the `lastWasPreview` check or the
`draftIsEmpty` condition each makes it fail, so the cases have teeth.

Regression cases that must keep working, and do: "no" straight after a preview
still cancels; `"nee 5"` after a preview is still a correction, not a cancel;
bare `"cancel"` after a preview still cancels; `"I want to cancel my
membership"` never touches Rule A.

## Still open

- **Rule A cannot see form or e-mail tickets.** `recent_tickets` covers only
  chat-raised ones. Dina's 632968 is invisible to it. Widening it means reading
  Freshdesk by requester at collection time — worth doing, not done.
- **Ticket 632968 is still open** and Dina believes it was cancelled. That needs
  a human to close it and tell her.

---

# Addendum, 6 Sep — the club-before-access-level fix (Rule D)

Feedback `961b8b8b` + `625c0a71`, session `066e40d6` (Lucas, 31 Aug), plus
`c8571739` (Gregory, 2 Sep) which turned out to be already fixed.

## What I got wrong first

I diagnosed this as an origin/destination bug in the club matcher: Lucas wrote
"van bussum naar amsterdam" and I assumed the matcher had latched onto **Bussum**
— his own club — as the destination. There is even an origin-exclusion in
`Build Priced Options` that only runs when more than one club matches, which
made the theory look right.

**Replaying it disproved that.** I ran the real inputs through both the node as
it stands today and the version live on 1 Sep. Both produced the correct output:

```
CLUB PICKER — Amsterdam (30 locations). Present the block below EXACTLY as your
📝 question — verbatim, keep the numbering, ONE location per line …
  1)  Amstelveenseweg
  2)  Beethovenstraat
  …
```

So the picker was there, numbered and ready, on the day it failed. The matcher
was never the problem.

## The actual cause: prompt precedence

`Change Options Briefing 2026-08-26` is prepended **above** the club picker, and
whenever the target access level is unknown it states:

> Ask ONE short question for the single missing detail — **the access level**,
> taken from the club options below — and nothing else.

That sentence is unconditional. It never considers that the missing detail might
be the **club**. So the model did as it was told: asked for the access level,
twice, while a 30-item club list sat unread further down. The ticket was filed as
*"Bussum → Amsterdam"* with no club in it, and when Lucas later asked "so it
switches to the one on the Singel?" the bot said yes — confirming a club that
appears nowhere in the request.

## The fix

Rule D in `Cancel Honesty 2026-09-04`, live `65830d19`. It fires only when the
briefing actually emitted that sentence **and** `resolved_club` is empty, then
tells the model the missing detail is the club, to use the picker verbatim, that
a city is not a club, and never to confirm a club that is not in the description.

**Why there and not in the briefing itself.** The briefing is 25KB of
regex-dense code I did not write, and any edit means re-transmitting the whole
node. Keying off the briefing's own output instead means the two classifiers in
this workflow — documented as COUPLED, and known to have drifted — do not get a
third copy. If that sentence ever changes, Rule D goes silent rather than
contradicting something that is no longer said.

34/34 unit tests, mutation-verified; replay over 11,101 real turns unchanged at
1.18%.

## `c8571739` was already fixed — proven, not assumed

Gregory asked to move Noordermarkt → Rembrandtpark and was offered
"1. Basic 2. Premium 3. Home+". **Rembrandtpark only sells PREMIUM**, and there
is no "Basic" anywhere. Replaying his inputs:

- **1 Sep code**: renders a one-item list and *asks* which level he wants.
- **Current code**: "Amsterdam Rembrandtpark (Red Label) offers exactly ONE
  access level … do NOT ask them to pick an access level … do not offer or
  invent any alternative", then goes to the term step.

Asking a one-answer question is what gave the model room to invent. The 3 Sep
fix removed the question, so the conversation cannot recur.

---

# Addendum — the app claim, and a correction to my own fix

`625c0a71`. The Public FAQ prompt said *"members manage everything ONLY via the
app"*, and the model extended "everything" to contract changes. Six pre-login
replies between 1 Aug and 6 Sep told members a home club change is self-service
in the app (`73f6e815`, `066e40d6`, `ee153a41`, `8c9de9e9`, `7d035b80`,
`0b27e170`). The bot contradicts itself elsewhere — `f5977483`: *"Dit kan niet
direct via de app."*

**My first fix was wrong and I had to correct it.** I listed cancelling and
freezing alongside home club and access level as things the app cannot do. Our
own authoritative logged-in policy (`Format Home Club Context`) says the
opposite: members cancel in the app under *Studio > Self-service*, and request a
medical freeze under *Self-service > Idle Period*. The wrong version was live for
about three minutes. Corrected in `79cd0324`, which is now precise in both
directions — CAN: notice of cancellation, medical idle period; CANNOT: home club,
access level. Early cancellation still uses the form.

The lesson is the same one that caused the original bug: **the failure mode here
is generalising about the app.** I did exactly what the bot did.

---

# Still open

- **`f9a7cf3e`** — the dates are Magicline's, not invented. Magicline has that
  member on `contractEndDate` 2026-10-12, `contractCancelled` false, so the bot
  read her as in contract and 12 Sep is that date minus one month's notice. Same
  shape as `b0d7c046`, which Lowri retracted as *"an issue on magicline"* — both
  B2B. Waiting on confirmation of whether she is genuinely out of contract.
  Separately the bot did contradict itself ("no fixed end date" while using the
  end date) and computed a cancel-by date its own rules already forbid.
- **`21d1681e`** — the premise does not match the live prices. Coolsingel HOME+
  is €69 per 4 weeks, Delftse Poort HOME+ is €75, so the same-level move is
  dearer, not cheaper. Asked Thallia where the lower fee is coming from, and
  whether proof of relocation should be required for every home club change or
  only alongside a downgrade.
