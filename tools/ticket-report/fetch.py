#!/usr/bin/env python3
"""Pull the tickets the classification report runs on.

    python3 tools/ticket-report/fetch.py 2026-08-17 2026-09-17 /tmp/tickets.json

Needs FRESHDESK_API_KEY in .env.local. Writes one JSON array.

PAGING, AND WHY THE WINDOW IS WIDER THAN IT LOOKS
/api/v2/tickets pages newest-first and only accepts `updated_since`, not a
created range. Every ticket created in the window has necessarily been updated
since the window opened, so fetching updated_since = (from - 7 days) and
filtering on created_at client-side is complete. The 7 days of slack is there so
the last page of the fetch sits comfortably before the window starts rather than
on its boundary — if it lands inside, the window is silently truncated.

WHICH FIELDS
Category does not live in one field (see build.py), so all of them are kept, plus
tags and status — without tags there is no way to tell an auto-submitted ticket
from one a member confirmed, and that distinction is most of the report.
"""
import base64, json, os, sys, time, urllib.error, urllib.request
from datetime import date, timedelta

FROM = sys.argv[1] if len(sys.argv) > 1 else "2026-08-17"
TO = sys.argv[2] if len(sys.argv) > 2 else str(date.today())
OUT = sys.argv[3] if len(sys.argv) > 3 else "/tmp/tickets.json"
DOMAIN = "urbangymgroup.freshdesk.com"

for line in open(".env.local"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
key = os.environ.get("FRESHDESK_API_KEY")
if not key:
    sys.exit("FRESHDESK_API_KEY not set (expected in .env.local)")
AUTH = base64.b64encode(f"{key}:X".encode()).decode()

KEEP = (
    "cf_ticket_category", "cf_ticket_subcategory",
    "cf_ticket_category_trainmore_cancellation_form",
    "cf_ticket_subcategory_trainmore_cancellation_form",
    "cf_test2", "cf_test3",
    "cf_tags_new_category", "cf_tags_new_subcategory",
    "cf_request_type", "cf_club", "cf_membership_type_trainmore",
)


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"Authorization": f"Basic {AUTH}"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:                      # documented rate limit, wait it out
                time.sleep(int(e.headers.get("Retry-After", "5")))
                continue
            raise
        except Exception:
            # Deep pages stall now and again. Undocumented, not rate limiting,
            # and it clears on a retry — so back off rather than lose the run.
            time.sleep(3 * (attempt + 1))
            continue
    return []


since = (date.fromisoformat(FROM) - timedelta(days=7)).isoformat()
rows, page = [], 1
while True:
    batch = get(f"https://{DOMAIN}/api/v2/tickets"
                f"?updated_since={since}T00:00:00Z&per_page=100&page={page}")
    if not batch:
        break
    oldest = min(t["created_at"] for t in batch)
    for t in batch:
        c = t.get("custom_fields") or {}
        rec = {
            "id": t["id"], "created_at": t["created_at"], "updated_at": t.get("updated_at"),
            "status": t.get("status"), "source": t.get("source"),
            "group_id": t.get("group_id"), "form_id": t.get("form_id"),
            "responder_id": t.get("responder_id"),
            "tags": t.get("tags") or [], "subject": t.get("subject") or "",
        }
        for k in KEEP:
            rec[k] = c.get(k)
        rows.append(rec)
    sys.stderr.write(f"\rpage {page}: {len(rows)} tickets, back to {oldest[:10]}")
    if len(batch) < 100 or oldest[:10] < since:
        break
    page += 1

json.dump(rows, open(OUT, "w"))
inwin = [r for r in rows if FROM <= r["created_at"][:10] <= TO]
bot = [r for r in inwin if "evelyn-bot" in r["tags"]]
sys.stderr.write(
    f"\n{OUT}\n{len(rows):,} fetched | {len(inwin):,} created {FROM}..{TO} | "
    f"{len(bot):,} from Evelyn\n")
