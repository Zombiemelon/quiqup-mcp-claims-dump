# Phase 04 Deferred Items

## Cross-wave: Wave 04-03 (ORDC-04/05) — out-of-scope for Wave 2

The following pre-existing failures exist in `tests/tools/order-creation.test.ts` and `tests/tools/single-order-mutations.test.ts`, landed via commit `49537ef` (Wave 04-03's prior work). Wave 2 (04-02, this executor) does NOT own these files and per the executor scope-boundary rule does NOT touch them:

- `tests/tools/order-creation.test.ts`: 2 vitest failures — `client.requestMultipart is not a function` (lib/tools/bulk-create-orders.ts line 160). `bulk_create_orders` references a method that does not exist on `PlatformApiClient`. Wave 04-03's executor needs to add the multipart helper to platform-api.ts OR refactor `bulk_create_orders` to use the existing multipart pattern in orders-core-rest.ts.
- `tests/tools/order-creation.test.ts`: ~30 tsc errors (`Cannot find module 'create-internal-fulfilment-order'`, `Cannot find module 'create-mission'`). Wave 04-03 wrote tests for ORDC-04/05 + MISS-01/02 tools that have not yet been implemented. Those tool files need to land.
- `tests/tools/single-order-mutations.test.ts`: 4 tsc errors — `Property 'confirm' does not exist` on `update_fulfilment_order_status` / `update_order_weight` schemas. The tests assert destructive-gate fields on tools whose schema does not yet include them.
- `tests/evals/score-tool-call.test.ts`: 11 tsc errors — `Property 'value' does not exist on type 'Evaluation | Evaluation[]'`. Pre-existing on baseline, unrelated to Phase 4.

These are tracked here so the orchestrator and Wave 04-03's continuation agent can pick them up.
