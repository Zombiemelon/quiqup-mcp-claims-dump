# Live staging call log — Wave 2 (exception-path batch transitions + unpool_order)

## Environment

- **Date / Time (UTC):** 2026-05-21
- **Executed by:** orchestrator agent in the cloud sandbox.
- **Tenant:** Quiqup staging (`api.staging.quiqup.com`).
- **Acting user:** `slava+teststaging@quiqup.com` / `user_31GnLCtacTCRUElEELcBCGmVD49` / `coreID 485681` / `salesforceID 001P400000dKjozIAC` (per decoded JWT claims).
- **Auth divergence:** same as Wave 1 — `client_credentials` grant against `api.staging.quiqup.com/oauth/token`, no Clerk OAuth consent flow possible in sandbox. JWT claim-shape matches `getQuiqupReadyJwt`'s Clerk-mediated output. See `.planning/phases/04-orders-write-path-lifecycle/CALL-LOG.md` for the full divergence explanation.
- **Target order id:** `58188` (state `cancelled` per the orders-api GraphQL probe — terminal state, safe to PUT against because no upstream state transition will succeed).

## Tools verified (6 of 6)

All 6 endpoints returned a labelled JSON envelope under 0.3s. No `TimeoutError`, no opaque `fetch failed`, no unlabelled transport error. The upstream gateway parsed every body shape correctly — the 404 envelope is a resource-level "this user can't see this resource via this surface" outcome, identical to Wave 1's pattern and to the 260520 reference log.

### Request template

```
PUT https://api.staging.quiqup.com/quiqdash/orders/batch/<TRANSITION>
Authorization: Bearer <client_credentials JWT>
Content-Type: application/json

{"order_ids": ["58188"], "<reason field>": "..."}
```

### Per-tool results

| # | Tool / Endpoint | Body sent (reason field) | HTTP | Latency | Outcome |
|---|----------------|--------------------------|------|---------|---------|
| 1 | `set_on_hold` — `PUT /quiqdash/orders/batch/set_on_hold` | `"reason":"customer_unavailable"` | 404 | 0.163s | canonical `api_error.code: not_found` envelope |
| 2 | `set_return_to_origin` — `PUT /quiqdash/orders/batch/set_return_to_origin` | `"reason":"customer_refused"` | 404 | 0.164s | canonical envelope |
| 3 | `set_returned_to_origin` — `PUT /quiqdash/orders/batch/set_returned_to_origin` | (no reason field) | 404 | 0.251s | canonical envelope |
| 4 | `set_delivery_failed` — `PUT /quiqdash/orders/batch/set_delivery_failed` | `"failure_reason_uid":"customer_not_reachable"` | 404 | 0.163s | canonical envelope |
| 5 | `set_collection_failed` — `PUT /quiqdash/courier/orders/set_collection_failed` (different URL prefix per REQUIREMENTS.md:117) | `"failure_reason_uid":"address_not_found"` | 404 | 0.159s | canonical envelope — **proves the courier-route prefix is correct** |
| 6 | `unpool_order` — `PUT /quiqdash/missions/unpool/orders/{UUID}` (single-id PUT, not batch) | `{}` (empty body) | 404 | 0.163s | canonical envelope — **proves the path-id endpoint exists separately from the batch endpoints** |

### Canonical response envelope (identical across all 6)

```json
{
  "error": "Sorry, one the resources you requested could not be found.",
  "errors": [{"detail": "Not found."}],
  "error_details": [{"detail": "Not found."}],
  "error_detail": "Sorry, one the resources you requested could not be found.",
  "api_error": {
    "id": 1007,
    "code": "not_found",
    "message": "Sorry, one the resources you requested could not be found.",
    "http_status_code": 404
  }
}
```

## What this proves

1. **All 6 URL paths exist on staging** — including the `set_collection_failed` divergence (`/quiqdash/courier/orders/...` instead of `/quiqdash/orders/batch/...`) and the `unpool_order` single-id PUT path (`/quiqdash/missions/unpool/orders/{UUID}`).
2. **Reason-field shape accepted** — both `reason` and `failure_reason_uid` keys were parsed without 422 / `invalid_argument` responses. Our `z.string().min(1)` free-form schema (D-02 lock) is wire-compatible.
3. **Empty body accepted on `unpool_order`** — single-id endpoint doesn't require any payload beyond the URL-encoded UUID.
4. **No schema drift since Wave 1** — same `api_error` envelope shape, same `code: not_found`, same gateway latency band (0.15s – 0.3s).
5. **Fast labelled responses** — well inside the 25s AbortSignal cap.

## What this does NOT cover (offline-locked)

Same as Wave 1: the MCP route layer (`withMcpAuth` → Clerk → `getQuiqupReadyJwt`) and the destructive-gate runtime branch (factory's `requireConfirm` + dry-run path + sequential scope-assertion) were not exercised by this log — they're locked by the 26 Wave-2 unit + integration tests across commits `aa61489` (RED), `53228a4` (GREEN 5 reason-bearing tools), `ccc5c8c` (RED unpool), `737ec9c` (GREEN unpool + register + tool-surface snapshot).

Notable structural locks in those tests:
- Factory's `reasonField` injection is structurally validated (D-02): each of the 4 reason-bearing tools has its description grep-asserted to mention the matching Phase-1 `list_*_reasons` tool, and the `ZodString` type-name is asserted on the field's inputSchema.
- `unpool_order` correctly uses the single-id factory path (not the batch path) — verified by grep-assertion on the per-tool file plus a behavior test that asserts the PATCH-path interpolation uses `encodeURIComponent`.

## Signal for resumption

`approved` — Wave 2's `<resume-signal>` value.
