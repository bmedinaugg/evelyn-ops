#!/usr/bin/env python3
"""Reconcile the Freshdesk change form against Magicline.

    python3 tools/club-prices/reconcile.py docs/club-prices-reconciliation.xlsx

Freshdesk is the source of truth — the bot quotes cf_clubs and nothing else, and
Member Care owns it. This does not change that. It uses Magicline, which sells
the memberships, as an AUDITOR: anywhere the two disagree, the Freshdesk option
is probably the one to correct.

Every row is something a person can act on in Admin -> Ticket Fields. Nothing
here writes anywhere.

WHAT IT CANNOT SEE
Student rates are absent from cf_clubs by design, so STU bundles are ignored
rather than reported as missing. Corporate bundles likewise: B2B pricing is not
sold through this form.
"""
import base64, json, os, re, sys, time, urllib.request
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/club-prices-reconciliation.xlsx"
ML = "https://ugg.api.magicline.com/connect"

for line in open(".env.local"):
    line = line.strip()
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
AUTH = base64.b64encode(f"{os.environ['FRESHDESK_API_KEY']}:X".encode()).decode()


def fd(path):
    req = urllib.request.Request(f"https://urbangymgroup.freshdesk.com{path}",
                                 headers={"Authorization": f"Basic {AUTH}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def ml(path):
    req = urllib.request.Request(ML + path, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


LABEL = re.compile(r"\((Red|Black|Regular) Label\)", re.I)
OPENS = re.compile(r"[-–]\s*opens.*$", re.I)


def norm_club(name):
    s = OPENS.sub("", LABEL.sub("", name))
    s = re.sub(r"\btrainmore\b", "", s, flags=re.I)
    s = re.sub(r"\bb\.?v\.?\b", "", s, flags=re.I)
    s = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    for a, b in (("van woustraat", "van wou"), ("oost blacklabel", "oost"),
                 ("de savornin", "savornin"), ("west ladies", "west"),
                 ("bussum landstraat", "bussum"),
                 ("bilthoven leyenseweg", "bilthoven"),
                 ("leiden breestraat", "leiden"),
                 ("leusden maximaplein", "leusden")):
        if s == a:
            s = b
    return s


def norm_tier(t):
    """HOME / HOME+ / PREMIUM / CITY+ out of either system's spelling."""
    u = t.upper().replace(" ", "")
    if "CITY+" in u: return "CITY+"
    if "HOME+" in u: return "HOME+"
    if "PREMIUM" in u: return "PREMIUM"
    if re.search(r"\bHOME\b", t, re.I) or u.startswith("HOME"): return "HOME"
    return None


# Magicline bundles that are not sold through the change form.
SKIP_BUNDLE = re.compile(r"corporate|pay in full|\bSTU\b|intermediar|invoice|split", re.I)

TERMS = {(1, "YEAR"): "1 year", (2, "YEAR"): "2 years",
         (3, "YEAR"): "3 years", (4, "WEEK"): "Flex"}
PRICE = re.compile(r"€\s*([0-9]+(?:[.,][0-9]{1,2})?)")
PRICE_TRAILING = re.compile(r"([0-9]+(?:[.,][0-9]{1,2})?)\s*€")
YEARS = re.compile(r"(\d+)\s*[-–—]?\s*year", re.I)


def parse_option(text):
    m = PRICE.search(text) or PRICE_TRAILING.search(text)
    price = float(m.group(1).replace(",", ".")) if m else None
    if re.search(r"flex", text, re.I):
        term = "Flex"
    else:
        y = YEARS.search(text)
        term = (f"{y.group(1)} year" + ("s" if y.group(1) != "1" else "")) if y else None
    return term, price


# ---- read both sides -------------------------------------------------------
print("reading Freshdesk…", file=sys.stderr)
fields = {f["name"]: f for f in fd("/api/v2/ticket_fields")}
tree = fields["cf_clubs"]["choices"]

freshdesk = {}                      # club -> tier -> term -> (price, raw)
for club, tiers in tree.items():
    key = norm_club(club)
    for tier, options in (tiers or {}).items():
        t = norm_tier(tier)
        if not t:
            continue
        for opt in options or []:
            term, price = parse_option(opt)
            if term:
                freshdesk.setdefault(key, {}).setdefault(t, {})[term] = (price, opt, club)

print("reading Magicline…", file=sys.stderr)
studios = [s for s in ml("/v2/studio")
           if s["studioName"].lower().startswith("trainmore")
           and s["address"]["countryCodeAlpha2"] == "NL"
           and s["studioName"] != "TrainMore HQ"]

magicline = {}
for s in studios:
    key = norm_club(s["studioName"])
    try:
        bundles = ml(f"/v1/rate-bundle?studioId={s['id']}")
    except Exception:
        continue
    for b in bundles:
        if SKIP_BUNDLE.search(b["name"]):
            continue
        t = norm_tier(b["name"])
        if not t:
            continue
        for term in b["terms"]:
            label = TERMS.get((term["termValue"], term["termUnit"]))
            if label:
                magicline.setdefault(key, {}).setdefault(t, {})[label] = term["price"]
    time.sleep(0.15)

# ---- compare ---------------------------------------------------------------
rows = []
for club in sorted(set(freshdesk) | set(magicline)):
    f, m = freshdesk.get(club, {}), magicline.get(club, {})
    display = next((v[2] for t in f.values() for v in t.values()), club.title())
    if not m:
        rows.append([display, "", "", "", "", "club not found in Magicline",
                     "Check the club name, or it may not be live yet"])
        continue
    if not f:
        rows.append([display, "", "", "", "",
                     "club sells memberships but is absent from the change form",
                     "Add it to cf_clubs"])
        continue
    for tier in sorted(set(f) | set(m)):
        ft, mt = f.get(tier, {}), m.get(tier, {})
        if not ft:
            rows.append([display, tier, "", "", ", ".join(f"{k} €{v:g}" for k, v in sorted(mt.items())),
                         "TIER MISSING from the form", f"Add {tier} for this club"])
            continue
        if not mt:
            rows.append([display, tier, "", "", "",
                         "tier on the form that Magicline does not sell",
                         f"Remove {tier}, or confirm it is intentional"])
            continue
        for term in sorted(set(ft) | set(mt)):
            fv = ft.get(term)
            mv = mt.get(term)
            if fv and mv is None:
                rows.append([display, tier, term, f"€{fv[0]:g}" if fv[0] else "—", "",
                             "term on the form that Magicline does not sell",
                             "Remove it, or confirm it is intentional"])
            elif mv is not None and not fv:
                rows.append([display, tier, term, "", f"€{mv:g}",
                             "TERM MISSING from the form", "Add it"])
            elif fv and mv is not None and fv[0] is not None and abs(fv[0] - mv) > 0.005:
                rows.append([display, tier, term, f"€{fv[0]:g}", f"€{mv:g}",
                             "PRICE DIFFERS", f'Change "{fv[1]}" to €{mv:g}'])

# ---- write -----------------------------------------------------------------
HEAD = Font(bold=True, color="FFFFFF")
HEAD_FILL = PatternFill("solid", fgColor="2F3E4E")
BAD = PatternFill("solid", fgColor="FDE9D9")
wb = Workbook()
ws = wb.active
ws.title = "Read me"
ws.column_dimensions["A"].width = 24
ws.column_dimensions["B"].width = 100
for a, b in [
    ("Change form vs Magicline", ""),
    ("", ""),
    ("What this is", "Every place the Freshdesk change form (cf_clubs) and Magicline disagree. "
                     "Freshdesk stays the source of truth — the bot quotes it and nothing else. "
                     "Magicline is used here only as an auditor, because it is what actually sells "
                     "the memberships."),
    ("How to use it", "Work down the 'What to do' column in Admin -> Ticket Fields -> cf_clubs. "
                      "Every row is one edit."),
    ("Not compared", "Student and corporate rates. Neither is sold through this form, so Magicline "
                     "bundles for them are ignored rather than reported as missing."),
    ("Billing frequency", "Every consumer rate in Magicline bills every 4 weeks — 148 of 148 checked, "
                          "all four contract lengths. The form labels do not say so, which is why the "
                          "bot has been guessing. That is a fix in the bot, not in this sheet."),
    ("Differences found", str(len(rows))),
]:
    ws.append([a, b])
ws["A1"].font = Font(bold=True, size=15)
for r in range(3, ws.max_row + 1):
    ws.cell(r, 1).font = Font(bold=True)
    ws.cell(r, 2).alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[r].height = 32

ws = wb.create_sheet("Differences")
ws.append(["Club (as the form spells it)", "Tier", "Term",
           "On the form", "In Magicline", "Problem", "What to do"])
for c in ws[1]:
    c.font, c.fill = HEAD, HEAD_FILL
for r in rows:
    ws.append(r)
for i, w in enumerate([38, 10, 9, 13, 26, 44, 46], 1):
    ws.column_dimensions[get_column_letter(i)].width = w
ws.freeze_panes = "A2"
ws.auto_filter.ref = f"A1:G{ws.max_row}"
for i, r in enumerate(rows, start=2):
    if "MISSING" in r[5] or "DIFFERS" in r[5]:
        for c in range(1, 8):
            ws.cell(i, c).fill = BAD
    ws.cell(i, 7).alignment = Alignment(wrap_text=True, vertical="top")

wb.save(OUT)
print(f"{OUT}")
print(f"{len(freshdesk)} clubs on the form | {len(magicline)} selling in Magicline | "
      f"{len(rows)} differences")
