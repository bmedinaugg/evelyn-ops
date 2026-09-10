# The Evelyn performance scorecard

*Built 9 Sep 2026. Replaces the "Bot helped" page. Migrations `db/028`–`db/031`,
page at `/performance`.*

## What it is

One deterministic answer to "did Evelyn do her job?", computed from the
transcript with no model in the loop.

- **Headline: clean rate** — the share of conversations with none of eight
  defects. Currently **50.9%** over the 7 days to 9 Sep (1,954 conversations).
- **Eight defect classes**, each countable, each with a fix path.
- **Answered rate** — 81.3%.

## Why deterministic, and not a model

Because the question behind all of this is *"did our fixes help?"*, and that
needs a metric that can be **recomputed over all history**. Change a definition
and every past week rebuilds with it, so the baseline never shifts underneath
you. An LLM score cannot do that — re-scoring costs money and returns different
answers each time. That is precisely why the sentiment metric could not support
a before/after claim.

## The one judgement, and how it was settled

Everything rests on *"did the bot actually answer?"* The previous version of
that predicate (`answered_count`) was wrong in both directions, proven on two
chats Nelly Palikara raised:

- it counted a **clarifying question** ("which city or club?") as an answer;
- it counted the **out-of-scope refusal** as an answer;
- it **discarded the one real answer** — a membership number — because the bot
  bundled it into "You're all set, Loulou!" and a keyword filter dropped the
  whole message.

The fix was to stop hand-writing keyword rules. **Boilerplate is whatever the
bot sends verbatim to many different members**; a genuine answer names the
member or their data and never repeats. So frequency finds the candidates and a
human labels them once, into `bot.reply_templates` (168 rows, labels are data —
correct one with an `UPDATE`, no deploy).

Crucially this keeps a **repeated FAQ reply counting as an answer**: it just gets
`class='answer'`. Frequency alone would have thrown those away, and answering
from the FAQ is the success case.

Four structural rules sit on top, each added only after measuring:
`reply_body()` strips the personalised greeting so boilerplate hiding behind a
member's name is recognisable; a self-service form URL is a handoff; ticket
previews / confirmations / file receipts are process; and `❓`/`📝` are the bot's
own "I'm asking you to choose" markers.

**Measured precision**, on hand-read random samples:

| | precision |
|---|---|
| old `answered_count` | 38% (10/26) |
| + templates, URL and lifecycle rules | 62% (15/24) |
| + `❓`/`📝` marker rule | 64% (14/22) |
| + discovery threshold lowered to 2 | **77% (17/22)** |

Dropping the threshold to 2 found 90 more templates and **not one was a real
answer** — Spanish, Ukrainian and Arabic variants of the login prompt, and a
dozen wordings of the club/term picker.

Two costs recorded rather than hidden: the `❓`/`📝` rule discards about 1 real
answer in 12 (replies that answer *and then* ask), and the residual error family
is "Do you mean X or Y?" disambiguation. The one structural rule tested for that
— "ends in a question mark" — was rejected because it would have destroyed
genuine answers like *"You can cancel your membership through the app by
navigating to Studio > Self-service"*.

## The eight classes

| class | 7 days to 9 Sep | definition |
|---|---|---|
| abandoned_mid_ticket | 436 | draft open, no ticket ever reached Freshdesk |
| asked_for_human | 241 | member asked to reach a person |
| link_only | 165 | pasted a form URL and answered nothing |
| loop | 165 | same reply sent 2+ times (previews 3+) |
| auth_deadend | 163 | ended in the login flow **and** never answered |
| no_answer | 142 | 4+ member turns, zero substantive answers |
| duplicate_ticket | 28 | two distinct Freshdesk tickets from one chat |
| wrong_language | 1 | unambiguous language mismatch |

`auth_deadend` needed the "and never answered" half. Without it, it flagged 678
conversations (35% of the week) — because **452 of 566** sessions ending in
`awaiting_email` had in fact been answered. Those are non-members who asked a
question, got a real reply and never logged in: a success, not a dead end.

`wrong_language` fires on 1 session in ~2,000. Kept as a regression tripwire.
Do not read a near-zero class as a broken one.

## The loop: feedback → fix → measurement

`bot.bot_changes` holds one row per shipped fix, naming the defect class it
targets. `bot.change_impact()` then gives before/after per fix — **always with a
control**, the movement in every *other* class over the same windows.

The control is not decoration. On the three seeded changes it immediately
disqualified two of them:

| change | target | before → after | Δ | control Δ | verdict |
|---|---|---|---|---|---|
| Repeat-breaker 2nd send (8 Sep) | loop | 11.03% → 5.52% | −5.51 | +1.23 | **improved, control steady** |
| Duplicate guard (23 Aug) | duplicate_ticket | 3.70% → 1.50% | −2.20 | −4.72 | everything moved |
| Repeat-loop fixes (19 Aug) | loop | 15.75% → 11.60% | −4.15 | −5.86 | everything moved |

Only the first has the shape that supports a causal claim. Note the 8 Sep result
rests on ~2 days of "after" data, and the 19 Aug "before" window is truncated by
the edge of the 30-day backfill.

**Declare the target before shipping.** Choosing it afterwards turns this into a
search through eight numbers for whichever one moved.

## The blind spot — validated, and on the page

Checked against Member Care's own labels, the scorecard flags **15 of 53
(28.3%)** of the conversations they rated *bad*. All 3 labelled *good* in window
scored clean.

The 38 misses are one shape: **the bot answered fluently and was wrong.**

> *"bot gives incorrect information … she talks about a Gold label, which
> doesn't even exist"*
> *"Please do not let the bot make extension requests, it makes them out of
> everything"*
> *"the bot confirmed it cancelled the ticket, but ticket 632968 stayed open"*

Each has a substantive answer and no structural defect. Nothing countable in a
transcript reveals that a confident answer is false.

**So the clean rate is a process metric, not a quality metric.** This is
published live on the page via `bot.scorecard_validation()` rather than left in
a commit message, so the caveat ages with the data instead of quietly becoming
false. Correctness remains Feedback's job, and the 7 `good` labels are far too
few to validate the clean end.

## What was retired

- **`/helped`** — deleted. Right question, wrong evidence: it keyed on whether
  the member said "thanks", produced 9 conversations a week, and Member Care
  said those were wrong too. Requiring `thanked` was discarding ~92% of genuine
  successes.
- **`bot.conversation_friction`** (`db/026`, `db/027`) — absorbed; its three
  signals are `no_answer`, `loop`, `asked_for_human`.
- **`bot.conversation_sentiment`** — *not* deleted. Demoted to a column and kept
  for the Freshdesk push, where "is this member angry?" is the right question
  for an agent opening a ticket.

## Operating it

- Refreshed every 10 minutes by `Bot - Sentiment Batch` → `Refresh Defects`
  (`bot.refresh_conversation_defects(2)`).
- Backfill wider at any time: `select bot.refresh_conversation_defects(30);` —
  8,440 sessions in one call, a few seconds. Currently backfilled to 30 days so
  `change_impact` has history either side of a fix.
- New boilerplate appears as `class='unclassified'` and counts as **not** an
  answer until labelled. Conservative on purpose, and self-announcing:
  `select * from bot.reply_templates where class='unclassified';`
