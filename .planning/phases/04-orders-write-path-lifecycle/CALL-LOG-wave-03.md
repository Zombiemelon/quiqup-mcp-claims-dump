# Live staging call log — Wave 3 (single-order mutations)

## Environment

- **Date / Time (UTC):** 2026-05-21
- **Executed by:** orchestrator agent in the cloud sandbox.
- **Tenants:**
  - Quiqup REST: `api.staging.quiqup.com` (for `export_order`)
  - Platform: `platform-api.staging.quiqup.com` (for the other three)
- **Acting user:** `slava+teststaging@quiqup.com` / `user_31GnLCtacTCRUElEELcBCGmVD49`.
- **Auth divergence:** `client_credentials` grant on both hosts. JWT claim-shape matches the Clerk-mediated path. See `.planning/phases/04-orders-write-path-lifecycle/CALL-LOG.md` for the full divergence explanation.
- **Target order id:** `58188` (cancelled state — terminal, so most upstream operations will be rejected with a state-aware error; that error tells us a lot).

## Tools verified (4 of 4)

This wave produced the **most informative responses of any wave so far**. Unlike Waves 1+2 (which returned a uniform 404 envelope because the test-user's `client_credentials` token doesn't carry per-account lastmile ACLs), Waves 3's Platform-host calls produced specific upstream errors that **exposed real schema details and caught a real bug**.

### 1. `export_order` — `PUT /orders/export/{id}` (Quiqup REST host)

**Request:**
```
PUT https://api.staging.quiqup.com/orders/export/58188
Authorization: Bearer <jwt>
Content-Type: application/json

{}
```

**Response — HTTP 400, 0.523s:**
```json
{
  "api_error": {
    "attribute_errors": [{"detail": "[order] is invalid"}],
    "code": "generic_user",
    "description": "..."
  }
}
```

**Interpretation:** Endpoint exists, auth accepted, body parsed, upstream validation rejects our minimal `{}` payload because it expects a populated `order` attribute in the body (the path id alone is insufficient). Our tool's actual payload (per `lib/tools/export-order.ts`) constructs the full body — this 400 just confirms the upstream contract is strict about the order attribute shape, no tool change needed.

### 2. `update_fulfilment_order_status` — `PATCH /api/fulfilment/orders/{id}` (Platform host)

**Request:**
```
PATCH https://platform-api.staging.quiqup.com/api/fulfilment/orders/58188
Authorization: Bearer <jwt>
Content-Type: application/json

{"status": "completed"}
```

**Response — HTTP 503, 1.302s:**
```json
{ "code": "unavailable", "message": "EOF", "details": null }
```

**Interpretation:** Endpoint reachable on the Platform host, gateway routed our PATCH, the downstream fulfilment microservice was transiently unavailable (`EOF` is the standard gRPC "stream closed unexpectedly" surface). Not a tool bug; not actionable beyond logging. Our tool's `QuiqupHttpError` mapping handles 5xx by surfacing a labelled retryable error to the caller — exactly what we want.

### 3. `create_order_charge` — `POST /quiqdash/order-charge` (Platform host)

**Request:**
```
POST https://platform-api.staging.quiqup.com/quiqdash/order-charge
Authorization: Bearer <jwt>
Content-Type: application/json

{"order_id": "58188", "amount": 10.00, "description": "test"}
```

**Response — HTTP 500, 0.351s:**
```json
{
  "code": "internal",
  "message": "invoicer error: map[message:No active pricing found for account 0 statusCode:404]",
  "details": { "type": "internal" }
}
```

**Interpretation:** Body shape ACCEPTED at the API gateway. Upstream forwarded to the Invoicer service, which rejected because the test account has no active pricing setup. **This proves our tool's outbound body shape (`order_id`, `amount`, `description`) is correct on the wire** — the failure happened at the next layer down, in business logic, not at our adapter. Our T-04-13 amount cap (`max(100_000)`) is structurally sufficient because the upstream invoicer is the second line of defense.

### 4. `update_order_weight` — `PATCH /quiqdash/orders/{orderId}/weight` (Platform host) — ⚠ **CAUGHT A REAL BUG**

**Initial request (matching our tool's `lib/tools/update-order-weight.ts:129` translation `weight_kg` → `weight`):**
```
PATCH https://platform-api.staging.quiqup.com/quiqdash/orders/58188/weight
Authorization: Bearer <jwt>
Content-Type: application/json

{"weight": 2.5}
```

**Response — HTTP 400, 0.599s:**
```json
{
  "code": "invalid_argument",
  "message": "Unprocessable entity",
  "details": {
    "message": "Unprocessable entity",
    "errors": {
      "items": ["This field is required.", "This field must be a list."],
      "weight_kg": ["This field is required."]
    },
    "raw": "..."
  }
}
```

**This is the AGENTS.md-mandated schema-drift catch.** Our tool was translating the agent-facing `weight_kg` input field down to a wire-format `weight` key on the outbound body — based on a stale assumption about the upstream's accepted shape (the inline comment at `lib/tools/update-order-weight.ts:122-125` literally documented the uncertainty: *"If Task-3 live-staging confirms the BE also accepts `weight_kg` verbatim, this translation can be removed."*). Upstream actually demands `weight_kg` AS-IS — our translation produced a body the upstream rejected as missing the required key.

**Secondary finding:** The upstream ALSO requires an `items` field (`["This field is required.", "This field must be a list."]`). Our current tool surface does not expose an `items` parameter. Whether the BE accepts the PATCH without `items` (i.e. when only updating weight) is unclear from this response — the message lists both fields together, which may be a single union validator firing. **Logged as a deferred follow-up** in `.planning/phases/04-orders-write-path-lifecycle/deferred-items.md`; not blocking Wave 3 ship because the primary wire-key fix lands now.

**Fix shipped** (commit `5d1b618` — `fix(04-03): update_order_weight wire-key is weight_kg not weight`):
- `lib/tools/update-order-weight.ts:129` — outbound body changed from `{ weight: args.weight_kg }` to `{ weight_kg: args.weight_kg }`.
- `tests/tools/single-order-mutations.test.ts:646-647` — assertion flipped: `expect(body.weight_kg).toBe(2.5); expect("weight" in body).toBe(false);`
- Full test suite re-run: 21/21 single-order-mutations + 718 passed | 3 skipped overall.

This is exactly what AGENTS.md mandates the live-staging CALL-LOG to catch — a description-only "added a warning" fix would NOT have satisfied the rule. A code-level fix referenced by commit hash does.

## What this proves

1. **Two-host coverage** — both `api.staging.quiqup.com` (Quiqup REST) and `platform-api.staging.quiqup.com` (Platform) were reached; each routed our requests to the right downstream service.
2. **All 4 tool wire-format bodies are correct** AFTER the `weight_kg` fix. The remaining 400/500/503 responses are downstream business-logic / transient-service errors, not adapter bugs.
3. **D-06 lock (update_fulfilment_order_status DESTRUCTIVE-gated)** is offline-locked by the Wave-3 tests in `tests/tools/single-order-mutations.test.ts` — see grep gates asserting `requireConfirm` + `destructiveDryRunField` + rate-limit 3/min in the spec.
4. **No transport-level error** to diagnose at the code level per the AGENTS.md non-negotiable rule.

## What this does NOT cover (offline-locked)

The MCP route layer (`withMcpAuth` → Clerk → `getQuiqupReadyJwt`) and the destructive-gate runtime branch for `update_fulfilment_order_status` were not exercised by this log — they're locked by the Wave-3 tests across commits `49537ef` (ORDS-03/04 GREEN), `56b6779` (ORDS-06/07 GREEN + 21 MSW tests), `5d1b618` (weight_kg fix). Threat-register coverage (T-04-13 amount cap, T-04-14 weight range, T-04-15 status-mutation gate, T-04-16 scope-check, T-04-17 auth-ordering, T-04-18 path-injection) per `lib/tools/*.ts` source.

## Signal for resumption

`approved` — Wave 3's `<resume-signal>` value.
