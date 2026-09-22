#!/usr/bin/env python3
"""Ticket classification report — how tickets were categorised over a window.

    python3 tools/ticket-report/build.py tickets.json docs/ticket-classification.xlsx

Reads the raw ticket dump (see the fetch step in the module docstring below) and
writes a workbook breaking tickets down by category and subcategory, split by
whether Evelyn created them.

CATEGORY LIVES IN FIVE DIFFERENT FIELDS
There is no single category field. Freshdesk keeps a separate pair per form
family, and agents apply a second taxonomy of their own on top:

  cf_ticket_category / _subcategory                      TrainMore general contact
  cf_ticket_category_trainmore_cancellation_form / ...   TrainMore cancellation
  cf_test2 / cf_test3                                    Clubsportive
  cf_tags_new_category / cf_tags_new_subcategory         applied later by an agent
  cf_request_type                                        Gymbox freeze

Reading only the first pair reports 64% of a month as uncategorised, which is
how "most of our tickets have no category" gets said out loud. It is not true.
All five are resolved here, first match wins in the order above, and the Field
column records which one answered.

AND SOME FORMS CARRY NO CATEGORY BY DESIGN
The change-membership and extension forms have no category field at all — the
form IS the category. Those are reported as such rather than as a gap, because
calling them uncategorised would invent a problem that nobody can fix.
"""
import json, sys, collections
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/ticket-classification.xlsx"
FROM = sys.argv[3] if len(sys.argv) > 3 else "2026-08-17"
TO = sys.argv[4] if len(sys.argv) > 4 else "2026-09-17"

rows = [r for r in json.load(open(SRC)) if FROM <= r["created_at"][:10] <= TO]

# Forms whose identity is the classification: they have no category field, and
# adding one would be the fix, not filling it in.
FORM_IS_CATEGORY = {
    103000243110: "Change membership (form)",
    103000243474: "Membership extension (form)",
    103000243660: "Gymbox membership change (form)",
    103000243661: "Gymbox early cancellation (form)",
    103000243662: "Gymbox freeze (form)",
    103000243674: "Gymbox payment & billing (form)",
    103000243900: "Gymbox extension (form)",
}

ORDER = [
    ("cf_ticket_category", "cf_ticket_subcategory", "general"),
    ("cf_ticket_category_trainmore_cancellation_form",
     "cf_ticket_subcategory_trainmore_cancellation_form", "cancellation form"),
    ("cf_test2", "cf_test3", "clubsportive"),
    ("cf_tags_new_category", "cf_tags_new_subcategory", "agent tags"),
]

def classify(r):
    """-> (category, subcategory, which field answered)."""
    for cat_f, sub_f, label in ORDER:
        if r.get(cat_f):
            return r[cat_f], r.get(sub_f), label
    if r.get("cf_request_type"):
        return r["cf_request_type"], None, "gymbox request type"
    form = FORM_IS_CATEGORY.get(r.get("form_id"))
    if form:
        return form, None, "form itself"
    return None, None, None

for r in rows:
    r["_cat"], r["_sub"], r["_src"] = classify(r)

# "Created by Evelyn" is the evelyn-bot tag and nothing else — the same test the
# rest of the reporting uses, so the numbers here can be compared with it.
for r in rows:
    r["bot"] = "evelyn-bot" in (r.get("tags") or [])

total = len(rows)
bot = [r for r in rows if r["bot"]]
rest = [r for r in rows if not r["bot"]]
uncat = [r for r in rows if not r["_cat"]]

HEAD = Font(bold=True, color="FFFFFF")
HEAD_FILL = PatternFill("solid", fgColor="2F3E4E")
WARN = PatternFill("solid", fgColor="FDE9D9")
wb = Workbook()


def sheet(title, headers, data, widths, wrap=()):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for c in ws[1]:
        c.font, c.fill = HEAD, HEAD_FILL
    for r in data:
        ws.append(r)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{ws.max_row}"
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for i in wrap:
        for rr in range(2, ws.max_row + 1):
            ws.cell(rr, i).alignment = Alignment(wrap_text=True, vertical="top")
    return ws


pct = lambda n, d: round(100.0 * n / d, 1) if d else 0

# ---------------------------------------------------------------- read me
ws = wb.active
ws.title = "Read me"
ws.column_dimensions["A"].width = 26
ws.column_dimensions["B"].width = 100
for a, b in [
    ("Ticket classification", ""),
    ("", ""),
    ("Window", f"{FROM} to {TO} inclusive, by ticket creation date"),
    ("Tickets", f"{total:,} — {len(bot):,} created by Evelyn ({pct(len(bot), total)}%), "
                f"{len(rest):,} from every other route"),
    ("Source", "Freshdesk /api/v2/tickets, read live. Category comes from the ticket's own "
               "custom fields, so this is how tickets are actually filed, not how the bot "
               "intended to file them."),
    ("", ""),
    ("Five category fields", "There is no single category field: each form family has its own pair, "
                             "and agents apply a second taxonomy on top. All five are resolved, first "
                             "match wins, and the 'Field' column says which one answered. Reading only "
                             "the main pair reports 64% of the month as uncategorised, which is false."),
    ("Forms with no category", "The change and extension forms have no category field at all — the form "
                               "IS the classification, and they are reported that way rather than as a gap."),
    ("Uncategorised", f"{len(uncat):,} tickets ({pct(len(uncat), total)}%) carry no category in "
                      "either field. That is a real gap, not a reporting artefact — see the "
                      "Uncategorised sheet for where they come from."),
    ("", ""),
    ("Sheets", "By category — totals, and how the split differs between Evelyn and everyone else"),
    ("", "Category and subcategory — the full two-level breakdown"),
    ("", "Uncategorised — what is arriving with no category at all"),
    ("", "Bot status — Evelyn's tickets by status, watchdog-filed vs member-confirmed"),
    ("", "Bot time to close — how long before the last thing happened to them"),
    ("", "Bot closed within 2 min — the instant ones, named"),
    ("", "Bot by category — what Evelyn actually files"),
]:
    ws.append([a, b])
ws["A1"].font = Font(bold=True, size=15)
for r in range(3, ws.max_row + 1):
    ws.cell(r, 1).font = Font(bold=True)
    ws.cell(r, 2).alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[r].height = 30

# ----------------------------------------------------------- by category
cats = collections.Counter(r["_cat"] or "(none)" for r in rows)
cats_bot = collections.Counter(r["_cat"] or "(none)" for r in bot)
data = []
for c, n in cats.most_common():
    b = cats_bot.get(c, 0)
    data.append([c, n, pct(n, total), b, n - b, pct(b, n)])
ws = sheet("By category",
           ["Category", "Tickets", "% of all", "From Evelyn", "From elsewhere", "% from Evelyn"],
           data, [34, 10, 10, 13, 15, 14])
for i, r in enumerate(data, start=2):
    if r[0] == "(none)":
        for c in range(1, 7):
            ws.cell(i, c).fill = WARN

# ------------------------------------------------- category × subcategory
pair = collections.Counter()
field_of = {}
for r in rows:
    k = (r["_cat"] or "(none)", r["_sub"] or "(none)")
    pair[k] += 1
    field_of[k] = r["_src"] or "—"
pair_bot = collections.Counter(
    (r["_cat"] or "(none)", r["_sub"] or "(none)") for r in bot)
data = []
for (c, s), n in sorted(pair.items(), key=lambda kv: (-kv[1], kv[0])):
    data.append([c, s, field_of[(c, s)], n, pct(n, total), pair_bot.get((c, s), 0)])
ws = sheet("Category and subcategory",
           ["Category", "Subcategory", "Field", "Tickets", "% of all", "From Evelyn"],
           data, [30, 38, 17, 10, 10, 13])
for i, r in enumerate(data, start=2):
    if r[0] == "(none)" or r[1] == "(none)":
        for c in range(1, 7):
            ws.cell(i, c).fill = WARN

# -------------------------------------------------------- uncategorised
bysrc = collections.Counter()
for r in uncat:
    bysrc[("Evelyn" if r["bot"] else "other", r.get("form_id") or "(no form)")] += 1
data = [[who, str(form), n, pct(n, len(uncat))]
        for (who, form), n in bysrc.most_common()]
sheet("Uncategorised",
      ["Origin", "Freshdesk form id", "Tickets", "% of uncategorised"],
      data, [14, 22, 10, 18])

# ------------------------------------------------------------- bot tickets
# Everything below is Evelyn's own tickets only. Kept apart from the sheets
# above because the questions are different: up there it is "how is our mail
# classified", here it is "what does the bot file, and what happens to it".
ST = {2: "Open", 3: "Pending", 4: "Resolved", 5: "Closed",
      6: "Waiting on Customer", 7: "Waiting on Third Party"}
status_of = lambda r: ST.get(r.get("status"), f"status {r.get('status')}")


def age_seconds(r):
    """Creation to last update. A proxy for time-to-close, and the only one the
    list API supports — there is no resolved_at or closed_at on these rows."""
    try:
        a = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
        b = datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00"))
        return (b - a).total_seconds()
    except Exception:
        return None


BUCKETS = [(120, "under 2 min"), (3600, "2-60 min"), (86400, "1-24 hours"),
           (7 * 86400, "1-7 days"), (float("inf"), "over 7 days")]


def bucket(sec):
    if sec is None:
        return "unknown"
    for limit, label in BUCKETS:
        if sec < limit:
            return label
    return "over 7 days"


auto = [r for r in bot if "evelyn-auto-submit" in (r.get("tags") or [])]
conf = [r for r in bot if "evelyn-auto-submit" not in (r.get("tags") or [])]

# -- status, and how the watchdog's tickets differ from confirmed ones
data = []
for st in sorted({status_of(r) for r in bot}, key=lambda s: -sum(1 for r in bot if status_of(r) == s)):
    nb = sum(1 for r in bot if status_of(r) == st)
    na = sum(1 for r in auto if status_of(r) == st)
    nc = sum(1 for r in conf if status_of(r) == st)
    data.append([st, nb, pct(nb, len(bot)), na, pct(na, len(auto)), nc, pct(nc, len(conf))])
sheet("Bot status",
      ["Status", "Bot tickets", "% of bot", "Auto-submitted", "% of auto",
       "Member-confirmed", "% of confirmed"],
      data, [24, 12, 10, 15, 11, 18, 15])

# -- how long before the last thing happened to them
closed = [r for r in bot if r.get("status") == 5]
data = []
for _, label in BUCKETS:
    n = sum(1 for r in closed if bucket(age_seconds(r)) == label)
    na = sum(1 for r in auto if r.get("status") == 5 and bucket(age_seconds(r)) == label)
    nm = sum(1 for r in closed if bucket(age_seconds(r)) == label
             and "merged" in (r.get("tags") or []))
    data.append([label, n, pct(n, len(closed)), na, nm])
ws = sheet("Bot time to close",
           ["Creation to last update", "Closed tickets", "% of closed",
            "of which auto-submitted", "of which merged"],
           data, [26, 14, 12, 22, 18])
for i, r in enumerate(data, start=2):
    if r[0] == "under 2 min":
        for c in range(1, 6):
            ws.cell(i, c).fill = WARN

# -- the instant ones, named, because that is the group worth eyeballing
fast = [r for r in closed if (age_seconds(r) or 1e9) < 120]
data = [[r["id"], r["created_at"][:16].replace("T", " "),
         ", ".join(t for t in (r.get("tags") or []) if t != "evelyn-bot"),
         r.get("_cat") or "(none)", (r.get("subject") or "")[:90]]
        for r in sorted(fast, key=lambda r: r["created_at"], reverse=True)]
sheet("Bot closed within 2 min",
      ["Ticket", "Created", "Other tags", "Category", "Subject"],
      data, [10, 18, 26, 26, 64])

# -- what the bot files, by category
cb = collections.Counter(r["_cat"] or "(none)" for r in bot)
cbs = collections.Counter((r["_cat"] or "(none)", r["_sub"] or "(none)") for r in bot)
data = [[c, s, n, pct(n, len(bot))] for (c, s), n in
        sorted(cbs.items(), key=lambda kv: (-kv[1], kv[0]))]
sheet("Bot by category",
      ["Category", "Subcategory", "Tickets", "% of bot tickets"],
      data, [30, 38, 10, 16])

wb.save(OUT)
print(f"{OUT}")
print(f"bot: {len(bot):,} | auto-submitted {len(auto):,} ({pct(len(auto), len(bot))}%) | "
      f"closed {len(closed):,} ({pct(len(closed), len(bot))}%) | "
      f"closed <2min {len(fast):,}")
print(f"{total:,} tickets {FROM}..{TO} | {len(bot):,} from Evelyn | "
      f"{len(cats)} categories | {len(pair)} category+subcategory pairs | "
      f"{len(uncat):,} uncategorised")
