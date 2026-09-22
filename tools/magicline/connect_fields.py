#!/usr/bin/env python3
"""Walk the Magicline Connect API and record every field it actually returns.

The Connect API needs no key, so this consumes it for real: each endpoint is
called, the response is walked, and every field path is recorded with its type
and a genuine example value taken from the response.

    python3 tools/magicline/connect_fields.py [out.json]

Read-only. Only GET endpoints are called; nothing on the write surface
(contracts, lead, voucher redeem) is touched.
"""
import json, sys, time, urllib.error, urllib.request
from datetime import date, timedelta

BASE = "https://ugg.api.magicline.com/connect"
OUT = sys.argv[1] if len(sys.argv) > 1 else "docs/magicline-connect-fields.json"

# A Dutch TrainMore club with a full product range, used as the sample studio.
STUDIO = 1224511810
STUDIO_NAME = "TrainMore Amsterdam Amstelveenseweg"
FROM = (date.today() + timedelta(days=1)).isoformat()
TO = (date.today() + timedelta(days=3)).isoformat()

# (label, path, what a person could ask that this answers)
ENDPOINTS = [
    ("Tenant", "/v1/tenant",
     "Which Magicline tenant and environment we are talking to"),
    ("Studio list", "/v2/studio",
     "Every club: name, address, opening hours, currency, open/close dates"),
    ("Studio", f"/v2/studio/{STUDIO}",
     "One club in the same shape as the list"),
    ("Studio details", f"/v2/studio/details/{STUDIO}",
     "Club plus trial-session bookability and trial hours"),
    ("Studio legal info", f"/v2/studio/{STUDIO}/legalinfo",
     "T&Cs, privacy policy and imprint links, per language"),
    ("Studio communication features", f"/v2/studio/{STUDIO}/communicationFeatures",
     "Which channels this club can contact members through"),
    ("Studio communication settings", f"/v1/studio/{STUDIO}/communication-settings",
     "Opt-in/consent configuration for the club"),
    ("Rate bundles", f"/v1/rate-bundle?studioId={STUDIO}",
     "Every membership sold at a club: price, term, payment frequency, fees, modules"),
    ("Trial sessions", f"/v1/trialsession?studioId={STUDIO}&startDate={FROM}&endDate={TO}",
     "Bookable trial slots and what the trial is called"),
    ("Trial session config", f"/v1/trialsession/config/validation?studioId={STUDIO}",
     "Which fields a trial booking requires"),
    ("Cancellation reasons", f"/v1/contracts/studios/{STUDIO}/cancellation-reasons",
     "The reasons a member can pick when cancelling"),
    ("Contract studios", "/v2/contracts/studios",
     "Which clubs accept online cancellation / withdrawal"),
    ("Campaigns", f"/v1/campaign?studioId={STUDIO}",
     "Lead-source campaigns (not discounts)"),
    ("Referrals", f"/v1/referral?studioId={STUDIO}",
     "Referral programmes configured at a club"),
    ("Countries", "/v1/i18n/countries?locale=en",
     "Country list and codes used by the forms"),
    ("Online pages studios", "/v1/onlinepages/studio",
     "Clubs as the public join-now pages see them"),
    ("Online pages states", "/v1/onlinepages/states?countryCode=NL",
     "Regions/states offered in the sign-up forms"),
    ("Active features", f"/v1/featurecheck/activefeatures?organizationUnitId={STUDIO}",
     "Which Magicline features are switched on for this club"),
    ("SEPA agreement", f"/v1/studio/{STUDIO}/sepa/agreement",
     "The direct-debit mandate text shown at sign-up"),
]


def get(path):
    req = urllib.request.Request(BASE + path, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
    try:
        return json.loads(raw)
    except ValueError:
        return {"_raw_text": raw[:400].decode("utf-8", "replace")}


def kind(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "string"
    if isinstance(v, list):
        return "array"
    return "object"


def walk(node, fields, prefix="", depth=0):
    """Record every leaf path once, keeping the first non-null example seen."""
    if depth > 6:
        return
    if isinstance(node, dict):
        for k, v in node.items():
            walk(v, fields, f"{prefix}.{k}" if prefix else k, depth + 1)
    elif isinstance(node, list):
        for item in node[:8]:                      # a few items is enough to see the shape
            walk(item, fields, prefix + "[]", depth + 1)
        if not node:
            fields.setdefault(prefix + "[]", {"type": "array (empty)", "example": None})
    else:
        slot = fields.setdefault(prefix, {"type": kind(node), "example": None, "nulls": 0})
        if node is None:
            slot["nulls"] = slot.get("nulls", 0) + 1
            if slot["type"] == "null":
                slot["type"] = "null"
        else:
            if slot["example"] is None:
                slot["example"] = node
            if slot["type"] in ("null", None):
                slot["type"] = kind(node)


def main():
    out = []
    for label, path, answers in ENDPOINTS:
        entry = {"endpoint": label, "path": path, "answers": answers}
        try:
            data = get(path)
            fields = {}
            walk(data, fields)
            entry["status"] = "ok"
            entry["top_level"] = "array" if isinstance(data, list) else "object"
            entry["count"] = len(data) if isinstance(data, list) else None
            entry["fields"] = [
                {"field": k, "type": v["type"],
                 "example": v["example"],
                 "always_null": v["example"] is None}
                for k, v in sorted(fields.items())
            ]
        except urllib.error.HTTPError as e:
            body = e.read()[:200].decode("utf-8", "replace")
            entry["status"] = f"HTTP {e.code}"
            entry["error"] = body
            entry["fields"] = []
        except Exception as e:                      # noqa: BLE001 - report, do not crash the sweep
            entry["status"] = "error"
            entry["error"] = str(e)[:200]
            entry["fields"] = []
        out.append(entry)
        n = len(entry["fields"])
        print(f"{entry['status']:<10} {label:<32} {n:>4} fields")
        time.sleep(0.3)

    doc = {"base": BASE, "sample_studio": {"id": STUDIO, "name": STUDIO_NAME},
           "endpoints": out}
    json.dump(doc, open(OUT, "w"), ensure_ascii=False, indent=1)
    ok = sum(1 for e in out if e["status"] == "ok")
    tot = sum(len(e["fields"]) for e in out)
    print(f"\n{OUT}\n{ok}/{len(out)} endpoints readable | {tot} field paths")


if __name__ == "__main__":
    main()
