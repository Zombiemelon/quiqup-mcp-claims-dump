---
phase: 02-integrations
verified: 2026-05-19T22:40:02Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
---

# Phase 2: Integrations (Shopify / WooCommerce / Salla) Verification Report

**Phase Goal:** Expose every Quiqdash integrations endpoint so an agent can list connections, configure Shopify/WooCommerce/Salla, complete OAuth callbacks, repair stuck orders, and delete sources safely.
**Verified:** 2026-05-19T22:40:02Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| #   | Truth                                                                                                                                                                                                                | Status     | Evidence                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Agent can list integration connections + order reasons + order + repair + ff_export ack (`list_integration_connections` / `list_integration_order_reasons` / `get_integration_order` / `repair_integration_orders` / `confirm_ff_export`). | ✓ VERIFIED | All 5 tool files exist (95–162 lines each), imported and registered in `app/[transport]/route.ts` lines 64–68 and 175–180; present as `enabled` in `evals/snapshots/tool-surface.json`.                                                                                                                                            |
| 2   | Agent can fully configure Shopify end-to-end (`get_shopify_config` / `list_shopify_delivery_methods` / `list_shopify_locations` / `update_shopify_config` / `update_shopify_connection` / `setup_shopify_callback`). | ✓ VERIFIED | All 6 tool files exist (94–169 lines), registered in `route.ts` lines 71–76 and 183–188; present in tool-surface snapshot as `enabled`; integration test file `tests/tools/shopify-integration.test.ts` present.                                                                                                                  |
| 3   | Agent can fully configure WooCommerce (`list_woocommerce_connections` / `get_woocommerce_config` / `list_woocommerce_states` / `list_woocommerce_shipping_lines` / `setup_woocommerce_connection` / `upsert_woocommerce_config`). | ✓ VERIFIED | All 6 tool files exist, registered in `route.ts` lines 79–84 and 191–196; present in tool-surface snapshot as `enabled`; integration test file `tests/tools/woocommerce-integration.test.ts` present.                                                                                                                              |
| 4   | Agent can install Salla + read connection/config/platform-data + toggle fulfillment + update config (`install_salla` / `get_salla_connection` / `get_salla_platform_data` / `get_salla_config` / `update_salla_config` / `toggle_salla_fulfillment`). | ✓ VERIFIED | All 6 tool files exist, registered in `route.ts` lines 87–92 and 199–204; present in tool-surface snapshot as `enabled`; integration test file `tests/tools/salla-integration.test.ts` present.                                                                                                                                    |
| 5   | Both DESTRUCTIVE deletes (`delete_integration_source`, `delete_salla_connection`) refuse to fire without `confirm: true` and surface clear error semantics on missing confirmation.                                  | ✓ VERIFIED | Both tools import all 6 canonical helpers from `lib/middleware/destructive.ts` (`requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`); call `requireConfirm` at the top of handler; catch `ConfirmationRequiredError` and return `buildConfirmationRequiredResult(err)`. Tests in `tests/tools/destructive-integrations.test.ts` cover [1] missing confirm, [2] confirm:false, [3] confirm:true + dry_run (no upstream call), [4] confirm:true only (exactly one DELETE), [5] confirm:true + 404. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `lib/tools/list-integration-connections.ts` | INTG-01 tool | ✓ VERIFIED | 95 lines; imported + registered. |
| `lib/tools/list-integration-order-reasons.ts` | INTG-03 tool | ✓ VERIFIED | 157 lines; imported + registered. |
| `lib/tools/repair-integration-orders.ts` | INTG-04 tool | ✓ VERIFIED | 162 lines; imported + registered. |
| `lib/tools/get-integration-order.ts` | INTG-05 tool | ✓ VERIFIED | 100 lines; imported + registered. |
| `lib/tools/confirm-ff-export.ts` | INTG-06 tool | ✓ VERIFIED | 111 lines; imported + registered. |
| `lib/tools/get-shopify-config.ts` ... `setup-shopify-callback.ts` (6 files) | INTG-07/08/09/10/11/12 | ✓ VERIFIED | All 6 present, 94–169 lines each, imported + registered. |
| `lib/tools/list-woocommerce-connections.ts` ... `upsert-woocommerce-config.ts` (6 files) | INTG-13/14/15/16/17/18 | ✓ VERIFIED | All 6 present, imported + registered. |
| `lib/tools/install-salla.ts` ... `toggle-salla-fulfillment.ts` (6 files) | INTG-20/21/23/24/25/26 | ✓ VERIFIED | All 6 present, imported + registered. |
| `lib/tools/delete-integration-source.ts` | INTG-02 DESTRUCTIVE | ✓ VERIFIED | Imports all 6 canonical helpers; `requireConfirm` called pre-flight. |
| `lib/tools/delete-salla-connection.ts` | INTG-22 DESTRUCTIVE | ✓ VERIFIED | Imports all 6 canonical helpers; `requireConfirm` called pre-flight. |
| `lib/middleware/destructive.ts` | Canonical 6-export helper | ✓ VERIFIED | Exports `requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`. |
| `app/[transport]/route.ts` | Register all 25 Phase-2 tools | ✓ VERIFIED | 25 `registerTool(server, ...Spec)` calls for Phase-2 specs (lines 175–213); 25 matching imports (lines 64–98). |
| `evals/snapshots/tool-surface.json` | 84 enabled tools | ✓ VERIFIED | 84/84 enabled; all 25 Phase-2 tool names present; zero disabled. |
| `evals/integrations-shared.ts` | Shared family eval | ✓ VERIFIED | EVAL_DRY_RUN supported (returns 7 items); CI gate present with `args-overlap >= 0.7`, `description-quality >= 1.0`. |
| `evals/shopify-integration.ts` | Shopify family eval | ✓ VERIFIED | EVAL_DRY_RUN + CI gate (`args-overlap >= 0.75`, `description-quality >= 1.0`, `sensitive-and-single-use-language >= 1.0`). |
| `evals/woocommerce-integration.ts` | WooCommerce family eval | ✓ VERIFIED | EVAL_DRY_RUN + CI gate (`args-overlap >= 0.75`, `description-quality >= 1.0`, `quiqup-vs-woocommerce-state-disambiguation >= 1.0`). |
| `evals/salla-integration.ts` | Salla family eval | ✓ VERIFIED | EVAL_DRY_RUN + CI gate (`args-overlap >= 0.75`, `description-quality >= 1.0`, `token-omission >= 1.0`, `four-oh-four-as-null >= 1.0`). |
| `evals/destructive-integrations.ts` | DESTRUCTIVE family eval | ✓ VERIFIED | EVAL_DRY_RUN (returns 5 items); CI gate (`args-overlap >= 0.7`, `confirm-elicited >= 0.75`, `confirm-gate-present >= 1.0`). |
| `.github/workflows/eval-gate.yml` | CI wiring for 5 Phase-2 evals | ✓ VERIFIED | 5 dedicated jobs (`integrations-shared`, `shopify-integration`, `woocommerce-integration`, `salla-integration`, `destructive-integrations`) each invoking `bun run eval:<family>`. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `app/[transport]/route.ts` | 25 Phase-2 tool specs | `import { spec as ... } from "@/lib/tools/..."` | ✓ WIRED | 25 imports, 25 `registerTool(server, ...)` calls. |
| `delete-integration-source.ts` | `lib/middleware/destructive.ts` | Named imports of all 6 canonical helpers | ✓ WIRED | Lines 43–48; called inline in handler (`requireConfirm`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`). |
| `delete-salla-connection.ts` | `lib/middleware/destructive.ts` | Named imports of all 6 canonical helpers | ✓ WIRED | Lines 43–48; called inline in handler. |
| Phase-2 evals | `evals/gate.ts` | `gate(result, [...])` under `process.env.EVAL_GATE === "1"` | ✓ WIRED | All 5 evals conditionally call `gate(...)` with score thresholds. |
| CI workflow | Phase-2 evals | `bun run eval:<family>` in dedicated job step | ✓ WIRED | All 5 jobs present in `eval-gate.yml`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| TypeScript clean compile | `pnpm tsc --noEmit` | Exit 0 (no errors) | ✓ PASS |
| Test suite passes at expected counts | `pnpm test` | 52 files passed / 2 skipped; **495 tests passed / 3 skipped (498)** in 10.28s | ✓ PASS — matches SUMMARY claim exactly |
| Tool-surface snapshot matches | `cat evals/snapshots/tool-surface.json` | 84 enabled, 0 disabled, all 25 Phase-2 tools present | ✓ PASS — matches "84 enabled" claim |
| Phase-2 eval dry-run (shared) | `EVAL_DRY_RUN=1 bun run evals/integrations-shared.ts` | `integrations-shared-v1 dry-run: 7 items (TODAY=2026-05-19)` | ✓ PASS |
| Phase-2 eval dry-run (destructive) | `EVAL_DRY_RUN=1 bun run evals/destructive-integrations.ts` | `destructive-integrations-v1 dry-run: 5 items (TODAY=2026-05-19)` | ✓ PASS |
| Destructive helper exports | grep `export` in `lib/middleware/destructive.ts` | All 6 canonical names (`requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`) exported | ✓ PASS |

### Requirements Coverage

| Requirement | Tool | Plan | Status | Evidence |
| ----------- | ---- | ---- | ------ | -------- |
| INTG-01 | `list_integration_connections` | 02-01 | ✓ SATISFIED | File + registration + snapshot. (REQUIREMENTS.md table still shows "Pending" — doc-sync drift, not a goal failure.) |
| INTG-02 | `delete_integration_source` (DESTRUCTIVE) | 02-05 | ✓ SATISFIED | File + canonical destructive helpers wired + test paths [1]–[5]. |
| INTG-03 | `list_integration_order_reasons` | 02-01 | ✓ SATISFIED | File + registration + snapshot. (Doc-sync drift in table.) |
| INTG-04 | `repair_integration_orders` | 02-01 | ✓ SATISFIED | File + registration + snapshot. (Doc-sync drift in table.) |
| INTG-05 | `get_integration_order` | 02-01 | ✓ SATISFIED | File + registration + snapshot. (Doc-sync drift in table.) |
| INTG-06 | `confirm_ff_export` | 02-01 | ✓ SATISFIED | File + registration + snapshot. (Doc-sync drift in table.) |
| INTG-07..12 | Shopify family (6 tools) | 02-02 | ✓ SATISFIED | All 6 files + registration + snapshot + integration test. Top REQUIREMENTS.md list correctly shows `[x]`. |
| INTG-13..18 | WooCommerce family (6 tools) | 02-03 | ✓ SATISFIED | All 6 files + registration + snapshot + integration test. (Top list still `[ ]` and mapping table still "Pending" — doc-sync drift.) |
| INTG-20 / 21 / 23 / 24 / 25 / 26 | Salla non-destructive (6 tools) | 02-04 | ✓ SATISFIED | All 6 files + registration + snapshot + integration test. Top list and mapping table both `[x]`/Shipped. |
| INTG-22 | `delete_salla_connection` (DESTRUCTIVE) | 02-05 | ✓ SATISFIED | File + canonical destructive helpers wired + test paths [1]–[5]. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `.planning/REQUIREMENTS.md` | INTG-01/03/04/05/06/13–18 rows | Stale `Pending` / `[ ]` markers in mapping table even though tools shipped this phase | ℹ️ Info | Documentation drift only — does not affect phase goal achievement, code, registration, snapshot, or tests. Recommend a follow-up doc-sync flip to `Complete (2026-05-19)`. |

No debt markers (`TBD`, `FIXME`, `XXX`, `TODO` without issue ref, `HACK`, `PLACEHOLDER`) found in any Phase-2 tool file. No empty handlers, hardcoded empty returns, or unwired exports detected.

### Human Verification Required

None — every Success Criterion is verifiable from code/tests/snapshots/CI config without human-only signals (no UI, no live OAuth flow, no visual check, no third-party staging dependency). The DESTRUCTIVE confirmation semantics are fully exercised by MSW-backed tests with 5 distinct paths per tool.

### Gaps Summary

No gaps. Every ROADMAP Success Criterion is satisfied by an artifact + registration + snapshot + test triad. The one observation is a documentation drift in `.planning/REQUIREMENTS.md` (the INTG mapping table and several `[ ]`/`[x]` markers were not flipped to "Complete" for INTG-01/03/04/05/06/13–18). The code is correct; the cross-reference table is stale. This is recorded as Info-level only — it does not block Phase 3 and can be resolved with a single sweep of REQUIREMENTS.md when convenient.

---

_Verified: 2026-05-19T22:40:02Z_
_Verifier: Claude (gsd-verifier)_
