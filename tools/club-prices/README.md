# Club prices

Exports every club price Freshdesk holds into an Excel workbook.

```bash
pip3 install openpyxl        # once
python3 tools/club-prices/export.py docs/club-prices.xlsx
```

Reads `FRESHDESK_API_KEY` from `.env.local`.

## Where prices actually live

There is no price table anywhere. Each price is typed into the **text of a
Freshdesk dropdown option** — `"1 - year €92"` — on one of three nested ticket
fields:

| Field | Brand | Form |
| --- | --- | --- |
| `cf_clubs` | TrainMore | Membership change |
| `cf_club_where_they_want_to_extend_at` | TrainMore | Extension |
| `cf_access_level_extension_request_clubsportive` | Clubsportive | Extension |

Each is a three-level tree: club → access level → duration + price.

The bot quotes this text verbatim, so its wording *is* the member-facing price.
To change a price, edit the dropdown option in Freshdesk (Admin → Ticket
Fields); `Bot - Sync Ticket Categories` picks it up at 04:00 into Supabase
`bot.ticket_taxonomy`, and `Bot - Refresh Form Options` copies it into
`bot.form_schemas` at 06:00.

This script goes straight to `/api/v2/ticket_fields`, so it does not wait for
that sync and does not depend on it.

## Sheets

- **All prices** — every priced option, one row each, with the raw option text
- **Change matrix** — the TrainMore change form as a club × access level × duration grid
- **Data quality** — options whose text does not follow the usual pattern
- **Coverage** — every club on the `cf_club` master list vs. what it has priced

Shaded rows are the flagged ones. The script exits non-zero rather than write an
empty workbook if Freshdesk returns nothing.
