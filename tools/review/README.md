# Decision review pack

Builds the shareable working-session page: all 55 cases from `bot.case_library`,
what Evelyn decides, and a link to every source behind the answer. Used for the
Member Care decision review on 11 Sep 2026.

`/library` and `/knowledge` are the durable record and need a login. This is the
portable version — the same split `tools/scenarios` already makes, and for the
same reason: Esther, Nelly and Lowri read things in Teams and e-mail.

## Running it

```sh
node tools/review/pull.js     # bot.case_library + 30 days of member messages
node tools/review/volume.js   # replays the live recognisers over those messages
node tools/review/app.js      # writes evelyn-review-app.html
```

Then publish `evelyn-review-app.html` as a Claude artifact declaring the `db`
and `room` capabilities, which is what makes the verdicts shared and shows who
else has the page open.

`cases.json`, `messages.json` and `volume.json` are caches and are gitignored.
Delete `messages.json` to force a fresh pull; the window is set in `pull.js`.

## The two rules that matter

**Volumes come in two kinds and are never blended.** A *recorded* number is
counted from a `bot.*` table — it happened. A *ceiling* is the bot's own
recogniser from `tools/scenarios/patterns.js` replayed over real member
messages; because it runs over every message rather than only where the live
flow calls the classifier, it is an upper bound on demand, not a count of
decisions taken. 37 of the 55 cases have no honest number at all and are left
blank rather than estimated.

**Links are derived, never guessed.** Every URL comes from something the case
library actually names — a `ticket_form=` slug, a `bot.` table, a 16-character
n8n workflow id. Where only a workflow *name* is known, the link is a search
rather than a guessed id, because a search cannot 404. Where no document exists,
the card says so instead of linking somewhere plausible.

## When it is wrong

`app.js` embeds the case data at build time, so the page is a snapshot. If
`bot.case_library` or `bot.knowledge_sources` changes, re-run all three steps and
republish. The page carries `verified 10 Sep 2026` in its header so a stale copy
is visible rather than trusted — the same guard `/scenarios` uses.
