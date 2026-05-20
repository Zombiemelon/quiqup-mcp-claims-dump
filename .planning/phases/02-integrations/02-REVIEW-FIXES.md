---
phase: 02-integrations
fixed_at: 2026-05-19T23:10:00Z
review_path: .planning/phases/02-integrations/02-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 12
deferred: 1
skipped_info: 5
status: all_in_scope_addressed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-05-19
**Source review:** `.planning/phases/02-integrations/02-REVIEW.md`
**Iteration:** 1

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Blockers (BL-01..04) | 4 | All fixed |
| Warnings (WR-01..09) | 9 | 8 fixed, 1 deferred (WR-07) |
| Info (IN-01..05) | 5 | Skipped (out of scope per request) |

Full `pnpm test` → **508 passed | 2 files skipped** (pre-existing).
Full `pnpm tsc --noEmit` → **clean**.

## Fixed Issues

### BL-01 — token + webhook secrets leak in connection lists
**Files:** `lib/tools/list-integration-connections.ts`, `lib/tools/list-woocommerce-connections.ts`, `tests/tools/{integrations-shared,woocommerce-integration}.test.ts`, `evals/score-{integrations-shared,woocommerce-integration}.ts`
**Commit:** `8e02a9f`
- `list_integration_connections` now destructure-discards `token` per connection (mirrors the Salla `get-salla-connection.ts` T-02-29 pattern).
- `list_woocommerce_connections` strips `token`, `order_created_webhook_secret`, `order_updated_webhook_secret` via a SENSITIVE_KEYS set.
- MSW canary tests assert the canary substrings (`"tkn_x"`, `"ocs_canary_xxx"`, `"ous_canary_xxx"`) are absent.
- Two new static eval scorers — `listConnectionsTokenOmission` and `listWooCommerceConnectionsSecretOmission` — anchor on the destructure pattern + sensitive-key constants so a future regression flips the eval gate.

### BL-02 — OAuth `code` not in `ALWAYS_REDACT_KEYS`
**Files:** `lib/middleware/pii-redact.ts`, `tests/middleware/pii-redact.test.ts`
**Commit:** `ff864a6`
- Adds `code`, `consumer_secret`, `client_secret`, `webhook_secret`, `order_created_webhook_secret`, `order_updated_webhook_secret` to the audit-log redact set.
- New tests cover `setup_shopify_callback`, `update_shopify_connection`, and `upsert_woocommerce_config`.

### BL-03 — `delete_salla_connection` is family-misnamed but family-agnostic
**Files:** `lib/tools/delete-salla-connection.ts`, `tests/tools/destructive-integrations.test.ts`
**Commit:** `910a79b`
- Pre-flight `GET /integrations/connections/{id}` verifies `connection.source === "salla"` before the DELETE; structured isError otherwise with a pointer to `delete_integration_source`.
- Pre-flight runs **before** the dry-run short-circuit, so a dry-run preview also fails on a non-Salla id (also closes the WR-04 dry-run/JWT-bridge gap for this tool specifically).
- New tests: source=shopify refused, dry_run on source=woocommerce also refused.

### BL-04 — `user_id` smuggling on connection-write + repair + order-reasons
**Files:** `lib/tools/{update-shopify-connection,repair-integration-orders,list-integration-order-reasons}.ts`, `tests/tools/{shopify,integrations-shared}-integration.test.ts`, `evals/score-{integrations-shared,shopify}-integration.ts`, `evals/datasets/{integrations-shared,shopify-integration}-v1.ts`
**Commit:** `c809c69`
- Removed `user_id` from the input schema on all three tools; handler binds to `auth.userId` server-side at body/query build time.
- New canary tests spread-inject `{ user_id: "u_attacker" }` via `as unknown as Record<string, never>` and assert the captured upstream body/query uses `auth.userId` instead.
- Eval scorers + datasets updated so the LLM is no longer encouraged to supply `user_id`.

### WR-01 — `country_filter` length-2 admits "12", whitespace, lowercase
**Files:** `lib/clients/quiqup-env.ts`, `lib/tools/{update-salla-config,upsert-woocommerce-config}.ts`, `tests/tools/{salla,woocommerce}-integration.test.ts`
**Commit:** `a15f1ee`
- Adds shared `iso3166Alpha2 = z.string().regex(/^[A-Z]{2}$/, ...)` validator to `quiqup-env.ts`.
- Both call sites swapped in; negative coverage extended to `"12"`, `"  "`, `"\n\n"`, lowercase, `"A1"`, `"A-"`.

### WR-02 — `start_date` / `end_date` accept any string including `""`
**Files:** `lib/tools/{list-integration-order-reasons,repair-integration-orders}.ts`, `tests/tools/integrations-shared.test.ts`
**Commit:** `35d2f8e`
- `z.string().datetime({...})` on both fields in both tools.
- Negative coverage for `""`, `"today"`, date-only (`"2026-05-01"`), and slash-formatted strings.

### WR-03 — `install_salla` has no guardrails
**Files:** `lib/tools/install-salla.ts`, `tests/tools/salla-integration.test.ts`
**Commit:** `e17536a`
- Adds `audit: true` + 10/min rate limit (no idempotency — the upstream returns the same flow URL per session).
- New canary test asserts both guardrails are declared.

### WR-04 — dry-run skips JWT mint
**Files:** `lib/tools/delete-integration-source.ts`
**Commit:** `c0b7f37`
- Moved `getQuiqupReadyJwt(auth.userId)` above the dry-run short-circuit so dry-run exercises the Clerk → Quiqup actor-token bridge.
- `delete_salla_connection` was already fixed by BL-03's source-check pre-flight (which forced JWT-mint above the dry-run).

### WR-05 — source enum drift between read and write tools
**Files:** `lib/clients/quiqup-env.ts`, `lib/tools/{delete-integration-source,repair-integration-orders}.ts`
**Commit:** `eef58e6`
- `INTEGRATION_SOURCES`, `IntegrationSource`, `integrationSourceField` exported from `quiqup-env.ts`.
- Both consumers switched to the shared field; adding a fourth family is a one-line change in one place.

### WR-06 — WooCommerce webhook secrets exposed
**Covered by BL-01** — the BL-01 strip also handles `order_created_webhook_secret` and `order_updated_webhook_secret`, exactly per the WR-06 callout.

### WR-08 — `update_shopify_config.delivery_methods[]` partial-update mismatch
**Files:** `lib/tools/update-shopify-config.ts`
**Commit:** `ea6f19d`
- Description clarified: top-level fields are partial-update; `delivery_methods[]` and `locations[]` are **array-replace** when supplied (matches the schema's per-item required-fields shape). Read with `get_shopify_config` first, modify locally, PUT the full updated array back.
- Pure documentation fix — no schema or wire change.

### WR-09 — `resourceDescription` echoes caller args verbatim
**Files:** `lib/middleware/destructive.ts`, `lib/tools/{delete-salla-connection,delete-integration-source}.ts`, `tests/tools/destructive-integrations.test.ts`
**Commit:** `11029a9`
- New `sanitizeForResourceText` helper in `lib/middleware/destructive.ts` — caps length to 256, strips control characters.
- Routes `delete_salla_connection.id` and `delete_integration_source.shop_name` through the sanitizer + `JSON.stringify` so the value is visibly quoted in the error text.
- Regression test asserts newlines/tabs/CR don't survive into the confirmation-required error text.

## Deferred Issues

### WR-07 — `platformApiFetch` helper not adopted
**Status:** Deferred from rapid-fix mode
**Reason:** 50-file refactor across Phase 1 + Phase 2 tools — too disruptive to land alongside the BL-* security fixes in one session.
**Follow-up:** `.planning/backlog/platform-api-fetch-helper.md` (committed in `d2d4ea0`) captures the helper shape, a 3-PR migration plan, and a bonus design hook so the BL-03 source-check pattern can move into the helper later as a generic `scope` option.

## Skipped Issues (INFO — out of scope per fix request)

| ID | Title | Rationale |
|----|-------|-----------|
| IN-01 | `lib/middleware/destructive.ts` header lists future-phase tool names | Documentation drift — low priority |
| IN-02 | `ConfirmationRequiredError.message` vs `buildConfirmationRequiredResult` duplicate strings | Two formats, easy to drift — refactor-only |
| IN-03 | `destructive-integrations.test.ts` could `it.each` the confirm-missing pair | Test-DX only |
| IN-04 | tool-surface snapshot lacks new-vs-removed diff signal | Future guardrail improvement |
| IN-05 | `confirm_ff_export` rate-limit at 30/min — tune later | Awaiting throughput confirmation from platform team |

## Verification

- **Per-fix:** targeted `pnpm exec vitest run <tests>` after each commit.
- **Final sweep:** `pnpm test` → **508 passed | 3 skipped (pre-existing)** across 54 files.
- **TypeScript:** `pnpm exec tsc --noEmit` → **clean** (no errors).

## Commit log (newest first)

```
ea6f19d fix(02-REVIEW): WR-08 clarify delivery_methods[]/locations[] are array-replace
11029a9 fix(02-REVIEW): WR-09 sanitize args before destructive-error interpolation
d2d4ea0 docs(02-REVIEW): WR-07 defer platformApiFetch extraction, capture plan
eef58e6 fix(02-REVIEW): WR-05 share integrationSource enum across read/write tools
c0b7f37 fix(02-REVIEW): WR-04 mint JWT above dry-run in delete_integration_source
e17536a fix(02-REVIEW): WR-03 add audit + rate-limit guardrails to install_salla
35d2f8e fix(02-REVIEW): WR-02 enforce ISO-8601 datetime on start_date/end_date
a15f1ee fix(02-REVIEW): WR-01 enforce ISO-3166 alpha-2 on country_filter
c809c69 fix(02-REVIEW): BL-04 server-bind user_id (no cross-tenant smuggling)
910a79b fix(02-REVIEW): BL-03 source-check pre-flight in delete_salla_connection
8e02a9f fix(02-REVIEW): BL-01 strip token + webhook secrets from connection lists
ff864a6 fix(02-REVIEW): BL-02 add OAuth code + webhook secrets to ALWAYS_REDACT_KEYS
```

## Notes on the worktree

The fixer agent attempted to operate inside an isolated git worktree (`/tmp/sv-02-reviewfix-*`) per the standard rollback-isolation protocol. The local commit-signing helper (`/tmp/code-sign`) is bound to the canonical repo path (`/home/user/quiqup-mcp`) via its `sources` registry — commits from the worktree path failed with `signing server returned status 400: missing source`. After a clean rollback of the worktree (including the recovery sentinel), all fixes were applied directly to the main repo on branch `claude/add-skip-discuss-config-hIwXh`. No prior commits were touched; every fix is a NEW atomic commit.

---

_Fixed: 2026-05-19_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
