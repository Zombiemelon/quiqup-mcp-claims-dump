# Phase 4 Wave 4 — Live-staging CALL-LOG

**Wave:** 04-04 (creation + missions)
**Tools shipped:**
- `create_internal_fulfilment_order` (ORDC-04, Platform JSON POST)
- `bulk_create_orders` (ORDC-05, Platform multipart CSV — first multipart write on the Platform host)
- `create_mission` (MISS-01, Platform JSON POST, NOT destructive-gated per D-05)
- `transfer_mission_orders` (MISS-02, Platform PUT, DESTRUCTIVE-gated)

**Status:** PENDING — populated by the orchestrator at the Task-4 human-verify checkpoint.

The unit-test suite is GREEN (17/17 order-creation tests + 9/9 missions tests = 26/26 passing).
Live-staging calls run AFTER all parallel waves return and the orchestrator
boots the dev server. Per AGENTS.md the multipart-CSV (`bulk_create_orders`)
is the highest-risk live test because it's the first multipart write on
platform-api.quiqup.com (Phase 3's multipart was Orders Core REST).

## To populate at the checkpoint

For each of the 4 tools below, capture the verbatim staging request +
response. For `bulk_create_orders` ALSO capture the per-row error surface
on a CSV with one intentionally-bad row, to confirm the D-08 verbatim
passthrough contract live.

### create_internal_fulfilment_order

(pending — orchestrator fills in: minimal staging body, the created order id,
verbatim response payload)

### bulk_create_orders

(pending — orchestrator fills in: 1-2 row CSV base64-encoded, verbatim response)

### bulk_create_orders — Per-Row Error Surface (D-08 live confirmation)

(pending — orchestrator fills in: CSV with ONE intentionally-bad row,
verbatim response showing the row→error map. Unit-test parallel: Test 5 in
`tests/tools/order-creation.test.ts::bulk_create_orders` enforces the
in-process equivalent.)

### create_mission

(pending — orchestrator fills in: minimal staging mission body, created
mission id, verbatim response. The mission id is reused in the next section.)

### transfer_mission_orders

(pending — orchestrator fills in: dry-run first, then live transfer of 1-2
staging orders into the mission from the previous section. Both responses
captured verbatim.)

### Multipart transport diagnoses (if any)

(pending — if the multipart CSV surfaces a TimeoutError or opaque
`fetch failed`, AGENTS.md anchors on this case. Diagnose at code level:
verify Content-Type is NOT being set manually (the canonical 03-04 lockup
re-imposed on the Platform host via lib/clients/_multipart.ts), verify the
boundary appears in the runtime-set Content-Type, verify the JWT mint is
not the cause. Document the diagnosis + fix-commit ref here.)
