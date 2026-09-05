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
