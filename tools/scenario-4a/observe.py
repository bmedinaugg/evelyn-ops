#!/usr/bin/env python3
"""Did the changes shipped on 21-22 Sep actually do anything?

    python3 tools/scenario-4a/observe.py [hours]        # default 24

Everything verified before those deploys was simulation: suites against the
node bodies, and 6,000 real messages replayed offline. This reads what the bot
actually said afterwards.

WHAT IS OBSERVABLE, AND WHAT IS NOT
Since 22 Sep the verdict is REAL: Bot - Main writes metadata.guard on the
logged assistant message whenever the price gate or the recording gate fires,
so we now know which rule fired and on which turn, not just that something did.
Messages logged before that change have no guard key, so the wording-based
count is kept as a fallback and both are printed -- a gap between them on
recent traffic means the metadata write is not landing.

Still a proxy: the 4a block goes into the PROMPT, not the reply, so it cannot
be seen directly. It is inferred from "member asked a hypothetical" + "reply
was not a bare form link", and is labelled as an inference below.

BASELINE BEFORE THE DEPLOY (72h to 22 Sep 00:40, all pre-deploy traffic):
    741 sessions, 3,760 assistant replies
    164 change-flow sessions
      7 of them exploring   -> 3 answered without a form link, 4 got the link
    0 price-gate corrections
Compare a later run against this. The number to watch is "still got a form
link": pre-deploy it was 4 of 7, and 4a should drive it toward 0. Some of the 3
that already avoided the link did so because another bypass (appeal, corporate,
link-already-sent) happened to fire, not because anyone intended it.
"""
import json, os, re, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

HOURS = int(sys.argv[1]) if len(sys.argv) > 1 else 24

for line in open(".env.local"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
URL, KEY = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]


def sb(path):
    r = urllib.request.Request(f"{URL}/rest/v1/{path}",
                               headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                                        "Accept-Profile": "bot"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.load(resp)


def fetch(role, since):
    out, off = [], 0
    while True:
        q = urllib.parse.urlencode({"select": "session_id,content,created_at,metadata", "role": f"eq.{role}",
                                    "created_at": f"gte.{since}", "order": "created_at",
                                    "limit": "1000", "offset": str(off)})
        b = sb("conversation_messages?" + q)
        out += b
        if len(b) < 1000:
            return out
        off += 1000


since = (datetime.now(timezone.utc) - timedelta(hours=HOURS)).isoformat()
users = fetch("user", since)
bots = fetch("assistant", since)

# Copied from the deployed Change-Flow Guardrails so this measures the same
# thing the bot decides on. If that regex changes, change this too.
EXPLORING = re.compile(
    r"\bwhat (?:would|will) happen|\bwhat happens (?:if|when)\b|"
    r"\bwhat (?:would|will) (?:my|the) [a-z ]{0,20}(?:be|look|cost|change)\b|"
    r"\bif i (?:were|was|would)?\s*(?:to\s+)?(?:change|switch|upgrade|downgrade|move)\b|"
    r"\bdo i (?:keep|lose)\b|\bthinking (?:about|of)\b|"
    r"\bconsidering (?:a|an|changing|switching|upgrading|downgrading|moving)\b|"
    r"\bbefore i (?:decide|commit|do|make)\b|\bjust (?:wondering|curious|checking)\b|"
    r"\bwat gebeurt er\b|\bwat als ik\b|"
    r"\bals ik\b[^.?!]{0,40}\b(?:wijzig|verander|overstap|upgrade|downgrade)|"
    r"\b(?:behoud|verlies) ik\b|\boverweeg\b|"
    r"\bvoor(?:dat)? ik (?:het |dit )?(?:definitief|beslis|besluit)|\bbenieuwd wat\b", re.I)
DECIDED = re.compile(
    r"\b(?:i want to|i'd like to|i would like to|id like to|i wish to)\s+"
    r"(?:change|switch|upgrade|downgrade|move|convert|cancel)\b|"
    r"\b(?:can|could|will) you\s+(?:change|switch|upgrade|downgrade|move|convert)\b|"
    r"\bplease\s+(?:change|switch|upgrade|downgrade|move|convert)\b|"
    r"\bhow (?:do|can) i\s+(?:change|switch|upgrade|downgrade|move|convert)\b|"
    r"\bwhere (?:do|can) i\s+(?:change|switch|apply|request)\b|"
    r"\bi\s+(?:want|need)\s+(?:a|an|to)\b[^.?!]{0,30}\b(?:change|upgrade|downgrade|switch)\b|"
    r"\bik wil\b[^.?!]{0,30}\b(?:wijzig\w*|verander\w*|overstap\w*|upgrade\w*|omzetten)\b|"
    r"\bhoe (?:kan|doe) ik\b[^.?!]{0,30}\b(?:wijzig\w*|verander\w*|overstap\w*)\b|"
    r"\bgraag\b[^.?!]{0,20}\b(?:wijzigen|veranderen|overstappen)\b", re.I)
CHANGE = re.compile(r"change|switch|upgrade|convert|home ?club|access level|wijzig|verander|overstap|thuisclub", re.I)
EXT_CAN = re.compile(r"extension|extend|verleng|cancel|opzeg", re.I)

FORM_LINK = re.compile(r"ticket_form=", re.I)
CORRECTION = re.compile(r"let me correct that\. Here are this club", re.I)
OLD_CORRECTION = re.compile(r"let me correct that before we go on", re.I)
OPTIONS_BLOCK = re.compile(r"\U0001F4DD Which membership would you like at", re.I)

by_session = {}
for m in users:
    by_session.setdefault(m["session_id"], []).append(m["content"])
replies = {}
for m in bots:
    replies.setdefault(m["session_id"], []).append(m["content"])

hit_redirect, exploring_sessions, got_link, no_link = 0, 0, 0, 0
for sid, msgs in by_session.items():
    idx = next((i for i, c in enumerate(msgs) if CHANGE.search(c) and not EXT_CAN.search(c)), None)
    if idx is None:
        continue
    hit_redirect += 1
    m = msgs[idx]
    if not DECIDED.search(m) and EXPLORING.search(m):
        exploring_sessions += 1
        if any(FORM_LINK.search(r) for r in replies.get(sid, [])):
            got_link += 1
        else:
            no_link += 1

# The real verdict, when the message was logged after 22 Sep.
guarded = [m for m in bots if (m.get("metadata") or {}).get("guard")]
price_fired, record_fired, reasons = 0, 0, {}
for m in guarded:
    g = m["metadata"]["guard"]
    if g.get("reply_rejected"):
        price_fired += 1
        # collapse the amount so the shapes group
        k = re.sub(r"\u20ac[0-9.,]+", "\u20acX", g["reply_rejected"])
        reasons[k] = reasons.get(k, 0) + 1
    if g.get("recording_rejected"):
        record_fired += 1

corrections = sum(1 for m in bots if CORRECTION.search(m["content"]))
old_corr = sum(1 for m in bots if OLD_CORRECTION.search(m["content"]))
blocks = sum(1 for m in bots if OPTIONS_BLOCK.search(m["content"]))
links = sum(1 for m in bots if FORM_LINK.search(m["content"]))

print(f"last {HOURS}h: {len(by_session)} sessions, {len(bots)} assistant replies\n")
print(f"  change-flow sessions                 {hit_redirect}")
print(f"    of which EXPLORING (4a applies)    {exploring_sessions}")
print(f"      answered without a form link     {no_link}   <- 4a working")
print(f"      still got a form link            {got_link}   <- check these")
print()
print(f"  messages carrying metadata.guard     {len(guarded)}")
print(f"  price gate fired   (from metadata)   {price_fired}")
print(f"  recording gate fired (from metadata) {record_fired}")
print(f"  price gate fired (wording fallback)  {corrections}   <- should match the metadata count on recent traffic")
print(f"  price gate fired (OLD wording)       {old_corr}   <- should be 0 after 21 Sep")
if reasons:
    print("    which rule fired:")
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print(f"      {v:>3}  {k}")
print(f"  code-composed options block sent     {blocks}")
print(f"  self-service form links sent         {links}")
print()
if exploring_sessions == 0:
    print("  No exploring conversation yet. At ~1/day this is normal for a short window;")
    print("  widen it (e.g. 72) before concluding anything.")
if corrections and not price_fired:
    print("  The correction wording appeared but no metadata.guard did. Either these")
    print("  messages predate the 22 Sep change, or the metadata write is not landing.")
if got_link:
    print("  A session classified as exploring still received a form link. That is either a")
    print("  later turn after the member decided (fine) or the bypass not holding (not fine).")
