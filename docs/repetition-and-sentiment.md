# Verbatim repetition is the main driver of negative sentiment

*Written 8 Sep 2026, once the sentiment metric had scored enough conversations
to ask "what actually makes members unhappy?". Fix live in `Bot - Main`
version `60542f71`.*

## The finding

Clustering the sentiment model's one-line rationales over 622 negative
conversations put **57.1%** into a single theme: the bot repeated itself or
never answered. Nothing else came close — "wanted a person" 10.5%, money 5.0%,
cancellation 4.0%.

Testing that directly against message history gave a dose-response curve, not
a correlation:

| bot sends the same reply | sessions | negative sentiment |
|---|---|---|
| 3+ times | 92 | **69.6%** |
| exactly twice | 180 | **36.7%** |
| never | 1,759 | **8.8%** |

**8.8% → 36.7% → 69.6%.** If repeating sessions behaved like non-repeating
ones, roughly **37% of all negative conversations would not exist.**

Reading the rationales, the shape is consistent: the member says something
clearly, the bot answers something else or re-asks, and they repeat themselves
— *"Dat heb ik je net verteld"*, *"I already submitted this 4-5 months ago!"*,
*"repeatedly wrote 'hallo?'"*. It very often ends in a demand for a human,
which means the "wanted a person" theme is largely the same story. **The human
request is a symptom, not a category.**

## Which replies repeat

| repeated reply | sessions | worst in one chat |
|---|---|---|
| "To look up your account I'll need the email…" (EN + NL) | **103** | **15×** |
| "Just to make sure — say yes to submit, no to cancel…" (EN + NL) | **58** | 6× |
| the repeat-breaker itself | 20 | 3× |
| "That code doesn't match…" (EN + NL) | 15 | **7×** |

## Why the existing guard caught only 20%

`Break Repeat Loop` in `Bot - Main` fired on 54 of 272 repeating sessions.
Three independent causes:

1. **`same >= 2` means the third send.** The condition required the outgoing
   reply to already match *two* earlier ones. The 203 sessions that repeat
   exactly twice — the 36.7% cohort — were unreachable **by design**.
2. **`limit=3` on the reply fetch.** A repeat separated by any other reply was
   invisible.
3. **The breaker repeated itself.** After it fires, the candidate reply is
   still the same looping text, so it fired again with identical wording.

All three are fixed. It now fires on the second identical send, sees the last
12 replies, and escalates to different, terser wording if it has already
spoken once.

## The carve-out that mattered

**Ticket previews are exempt** and keep the third-send threshold. 12 repeated
groups since 1 Sep are a re-shown 📋 preview, which is correct behaviour when
the member sent something ambiguous and the draft has not changed. Without the
exemption, moving to second-send would have broken a legitimate flow.

Matching stays **exact** after whitespace and case normalisation. Fuzzy
matching was considered and rejected: it risks suppressing a re-shown preview
whose figures *had* changed, and every bit of the measured opportunity is in
verbatim repeats anyway. The >60 character floor is kept so short closers like
"Anything else I can help with?" are not mistaken for loops.

## Verification

10/10 unit cases built from the real repeating replies, including the
preview exemption, the short-closer floor, and an assertion that the **old**
guard does *not* fire on the four second-send cases. Guards 1 (HTML sanitiser)
and 3 (internal-marker scrubber) re-tested intact.

Replayed over **3,447 real replies**: fires on 4.4%, touching 82 of 681
sessions, against 47 firings at the old threshold.

## How to tell whether it worked

The measurement is the same one that found the problem — negative rate by
repeat count. If the fix works, the "exactly twice" and "3+" buckets should
shrink toward nothing, because a second identical send now becomes a
circuit-breaker message instead of a repeat.

```sql
with a as (
  select session_id, md5(lower(regexp_replace(content,'\s+',' ','g'))) sig, count(*) times
  from bot.conversation_messages
  where role='assistant' and created_at >= '<after the fix>'
  group by session_id, sig
), rep as (select session_id, max(times) mx from a group by session_id)
select case when mx>=3 then '3+' when mx=2 then '2' else 'none' end bucket,
       count(*) sessions,
       round(100.0*count(*) filter (where cs.score<=2)/nullif(count(cs.session_id),0),1) negative_pct
from rep join bot.conversation_sentiment cs on cs.session_id=rep.session_id
group by 1;
```

## Still open

**The confirm prompt swallows the member's turn.** De-duplication silences the
repetition but does not answer the question. A member asking what a membership
change would cost got the confirm prompt six times (session `7e22916f`) and
his question never reached anything that could answer it. That is a separate
fix in the collection agent, and it is the reason the "money" theme exists at
all.
