# Scenario library generator

Board item `a0718672` — *"Provide examples of what the bot recognizes as a
certain scenario"*. Renders at `/scenarios`.

## Why it is generated and not written

Evelyn does not log its classification decisions. `bot.tickets.category` holds
six coarse values (`membership`, `other`, `payments`, `sales`, `trainmore_app`,
`club`) while Esther's Bot Training Guide defines fourteen scenarios — so there
is no recorded "I decided this was a cancellation" to list.

What does exist is the patterns in the live n8n nodes. This generator takes them
and replays them over real member messages, so every example on the page is
something a member actually wrote which actually matched.

## The one rule that matters

**`patterns.js` is copied verbatim out of the live nodes.** Matching runs in
JavaScript, not SQL, specifically so a regex-dialect difference (Postgres `\y`
vs JS `\b`, for one) cannot make the library quietly disagree with the bot.
Each entry carries a `source` naming the node it came from.

If a classifier changes in n8n, this is wrong until it is regenerated.
`generated_at` is rendered on the page so a stale library is visible rather
than trusted. The two request-type classifiers in *Bot - Ticket Collection
Agent* are already documented as COUPLED and have drifted before; this is the
same hazard one level up.

`misfires.js` is different — those probes are **ours**, not the bot's. They are
written narrow on purpose, so the percentage each reports is a floor rather than
an estimate. Under-claiming beats putting a number on the page that a Member
Care agent can disprove with one counter-example.

## Running it

```sh
node tools/scenarios/generate.js     # writes library.json (+ caches messages.json)
```

Then upsert `library.json` into `bot.scenario_library` (single row, `id = 1`).
Delete `messages.json` to force a fresh pull; the window is set in the query
inside `generate.js`.
