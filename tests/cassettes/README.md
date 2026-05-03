# Cassettes

Anonymized prod responses replayed via msw at the fetch boundary (test seam 3 — see [[mcp-tdd-test-seams]]). Recorded against `https://api-ae.quiqup.com` (last-mile prod).

## Anonymization rules (from M3 brief)

| Field class | Replace with |
|---|---|
| Customer name (first/last/full) | `Test Customer` |
| Phone | `+971500000000` |
| Email | `test@example.com` |
| Street address | `Test Street 1, Test Area, Dubai` |
| Building/apartment/floor | `Test Building` |
| GPS lat/lng | `25.2048, 55.2708` |
| Merchant/brand name | `Test Merchant` |
| Real merchant/partner ID | `999999` (preserve numeric shape) |
| Order ID / SKU / batch ID | Keep real (opaque) |
| Internal notes / comments | `Test note` |
| Timestamps | Keep real |
| Status / state fields | Keep real |
| Parcel SKU / item name | Keep real |

If a new field class appears that isn't in the table: add a `TODO(SLAVA_REVIEW): unanonymized field <name>` and redact with placeholder. Don't invent rules.

## Files

- `get-lastmile-order.json` — `GET /orders/{id}` response (single order, top-level `order` wrapper).
- `list-lastmile-orders.json` — `GET /orders?filters[state]=...` response (paginated `results` array).
- `get-lastmile-order-label.json` — `GET /order_label/{id}` response captured as `{status, content_type, body_base64}` since it's a binary PDF; the cassette is a JSON envelope our test handler unwraps and msw replays as raw bytes.
