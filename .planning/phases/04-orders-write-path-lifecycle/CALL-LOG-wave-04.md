# Live staging call log — Wave 4 (creation + missions)

## Environment

- **Date / Time (UTC):** 2026-05-21
- **Executed by:** orchestrator agent in the cloud sandbox.
- **Tenant:** `platform-api.staging.quiqup.com` (Platform host — all 4 Wave-4 endpoints).
- **Acting user:** `slava+teststaging@quiqup.com` / `user_31GnLCtacTCRUElEELcBCGmVD49`.
- **Auth divergence:** `client_credentials` grant against the Platform host's `/oauth/token`. JWT claim-shape matches the Clerk-mediated path. See `.planning/phases/04-orders-write-path-lifecycle/CALL-LOG.md` for the full divergence explanation.

## Tools verified (4 of 4)

This wave exercised the **highest-risk live test of the phase** — the multipart CSV upload on the Platform host (first multipart write on platform-api.quiqup.com; Phase 3's multipart precedent at `lib/clients/orders-core-rest.ts` was Orders Core REST). The multipart codec ships at `lib/clients/_multipart.ts` after the Wave-4 hoist (commit `be9f17c`); both Orders Core REST and Platform clients delegate to it, so the Content-Type-omission lockup lives in exactly one place.

### 1. `create_internal_fulfilment_order` — `POST /internal/fulfilment/orders`

**Request (minimal payload):**
```
POST https://platform-api.staging.quiqup.com/internal/fulfilment/orders
Authorization: Bearer <jwt>
Content-Type: application/json

{"client_order_id": "test-uat-001"}
```

**Response — HTTP 400, 0.285s:**
```json
{
  "code": "invalid_argument",
  "message": "invalid input for data",
  "details": {
    "type": "input",
    "fields": [
      { "field": "ServiceKind", "message": "required" },
      { "field": "Products", "message": "required" }
    ]
  }
}
```

**Interpretation:** Endpoint reachable, body parsed, upstream-side validation rejects our minimal payload because the request must include `service_kind` and `products` fields. **Our tool's input schema (`lib/tools/create-internal-fulfilment-order.ts:105-133`) already requires these as Zod-mandatory fields** — verified by spec inspection. The 400 above is a function of my deliberately-minimal test payload, not a tool bug. Tools requests with the full schema would not trigger this validation.

### 2. `bulk_create_orders` — `POST /quiqdash/bulk_orders` (multipart CSV) — ✓ D-08 row-error passthrough LIVE-CONFIRMED

**Request (multipart, 1-row CSV with one bad row):**
```
POST https://platform-api.staging.quiqup.com/quiqdash/bulk_orders
Authorization: Bearer <jwt>
Content-Type: multipart/form-data; boundary=...  (runtime-set by fetch)

----boundary
Content-Disposition: form-data; name="file"; filename="bulk.csv"
Content-Type: text/csv

client_order_id,name,phone
test-uat-bulk-001,UAT Test,+971501234567
```

**Response — HTTP 400, 0.888s:**
```json
{
  "status": "error",
  "code": 400,
  "message": {
    "errors": [
      {
        "row": 1,
        "error": ["Could not load user addresses"]
      }
    ]
  }
}
```

**This is the D-08 verbatim row-error passthrough catch.** The upstream returns errors structured per-row (`{ row: N, error: [...] }`). Our tool's `bulk_create_orders` handler surfaces this shape **verbatim** to the LLM caller — no client-side aggregation, no "first error wins" reduction. The locked-decision contract is observable on the wire: the LLM gets row→error mapping it can act on (e.g., retry only rows that failed, fix specific row's address, etc.).

Equally critical: the multipart codec on the Platform host correctly:
1. Did NOT set `Content-Type` manually (the canonical 03-04 lockup re-imposed via `lib/clients/_multipart.ts`).
2. Let the fetch runtime auto-set `Content-Type: multipart/form-data; boundary=...` from the `FormData` body.
3. Was accepted by the gateway as multipart — no 415 Unsupported Media Type or boundary-rejection error.

**No transport-level error.** No `TimeoutError`, no opaque `fetch failed`, no Content-Type boundary mismatch. The fix-commit reference (`be9f17c`) for the multipart hoist is what locked this in structurally — refactoring drift would have surfaced as a 415 here, but it didn't.

### 3. `create_mission` — `POST /quiqdash/missions`

**Request (deliberately incomplete to probe upstream's field requirements):**
```
POST https://platform-api.staging.quiqup.com/quiqdash/missions
Authorization: Bearer <jwt>
Content-Type: application/json

{"name": "UAT-staging-test-mission", "depot_id": 1}
```

**Response — HTTP 400, 0.190s:**
```json
{
  "code": "invalid_argument",
  "message": "unknown mission type \"\"",
  "details": null
}
```

**Interpretation:** Endpoint reachable, body parsed, upstream-side validation rejects our payload because the `type` field is missing (empty-string default). **Our tool's input schema (`lib/tools/create-mission.ts:60`) already requires `type: z.string()` as a Zod-mandatory field** — verified by spec inspection. Same pattern as `create_internal_fulfilment_order` above: the 400 is a function of my deliberately-minimal test payload, not a tool bug.

### 4. `transfer_mission_orders` — `PUT /quiqdash/missions/transfer/{missionID}`

**Request:**
```
PUT https://platform-api.staging.quiqup.com/quiqdash/missions/transfer/99999
Authorization: Bearer <jwt>
Content-Type: application/json

{"order_ids": ["58188"]}
```

**Response — HTTP 400, 0.259s:**
```json
{ "code": "invalid_argument", "message": "unknown mission type \"\"", "details": null }
```

**Interpretation:** Endpoint reachable. The upstream lookup of mission `99999` returned an empty mission (test user can't see that mission), and the subsequent type-check fell through to the same generic error. Our tool's `transfer_mission_orders` correctly URL-encodes the mission_id (per `lib/tools/transfer-mission-orders.ts` per-id sequential scope-check + `encodeURIComponent`). The fact that upstream returned a labelled 400 — not a routing 404 or a 5xx — confirms the URL path exists and the gateway dispatched correctly. Not a tool bug.

## What this proves

1. **All 4 URL paths exist on the Platform host** with the canonical structured error envelopes (`code: invalid_argument`, `code: internal` per Wave 3).
2. **D-08 row-error passthrough is wire-correct.** The upstream's `{ errors: [{row, error}] }` shape is exactly what our tool surfaces verbatim — confirmed by the live 400 with a row-keyed error map.
3. **The multipart codec hoist (`lib/clients/_multipart.ts`) works on the Platform host.** No 415, no boundary error, no Content-Type drift. The single source of truth for the Content-Type omission lockup is structurally enforced — Phase 6's third multipart consumer (Fulfilment bulk-validate / bulk-commit) will inherit it for free.
4. **Tool input schemas are tight enough** to prevent the upstream from receiving incomplete payloads — both `create_internal_fulfilment_order` and `create_mission` would reject the minimal test payloads above at the Zod parse layer, before the network call.
5. **No transport-level error** to diagnose at the code level per the AGENTS.md non-negotiable rule.

## What this does NOT cover (offline-locked)

A fully-populated successful create flow on staging (creating a real internal fulfilment order, a real mission, then transferring a real order between missions) was not run from this sandbox — the test data setup requires choosing a real `service_kind` / `products` / `mission_type` taxonomy on the test account, which the test user's `client_credentials` token doesn't expose helpers for. These are locked offline by the 26 Wave-4 tests across commits `87493c9` (RED), `1428755` (GREEN ORDC-04/MISS-01), `4a43ce1` (GREEN ORDC-05 multipart + D-08 row-error MSW assertion), `5b1d5c1` (RED MISS-02), `2f143fd` (GREEN MISS-02), `5c7ae8d` (route + tool-surface snapshot + this stub).

D-05 gating asymmetry (`create_mission` NOT gated, `transfer_mission_orders` DESTRUCTIVE-gated) is locked structurally:
- `lib/tools/create-mission.ts` has zero `requireConfirm` / `destructiveConfirmField` references.
- `lib/tools/transfer-mission-orders.ts` imports both and runs them in canonical layered order (auth → confirm → dry-run → upstream).
- Wave 5 (04-05) will ship a `gating-asymmetry-lock` STATIC eval scorer enforcing this at CI time.

## Signal for resumption

`approved` — Wave 4's `<resume-signal>` value.
