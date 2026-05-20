---
phase: 02-integrations
plan: 02
subsystem: integrations
tags: [phase-2, wave-2, shopify, integrations, intg-07, intg-08, intg-09, intg-10, intg-11, intg-12]
dependency_graph:
  requires:
    - lib/quiqup.ts (getQuiqupReadyJwt — Clerk → actor-token bridge)
    - lib/clients/quiqup-env.ts (environmentField, getPlatformApiBaseUrl)
    - lib/clients/quiqup-lastmile.ts (QuiqupHttpError)
    - lib/tools/register.ts (ToolSpec, registerTool, GuardrailConfig)
    - lib/tools/list-integration-connections.ts (02-01 — shop_name discovery anchor)
  provides:
    - get_shopify_config (INTG-07) — GET /shopify/config/{shopName}
    - list_shopify_delivery_methods (INTG-08) — GET /shopify/delivery-methods?shop_name=
    - list_shopify_locations (INTG-09) — GET /shopify/locations?shop_name=
    - update_shopify_config (INTG-10) — PUT /shopify/config
    - update_shopify_connection (INTG-11) — PUT /shopify/connection
    - setup_shopify_callback (INTG-12) — POST /shopify/callback?shop_name=&code=&is_fulfillment=
  affects:
    - app/[transport]/route.ts (6 new registerTool calls)
    - evals/snapshots/tool-surface.json (64 → 70 enabled tools)
tech_stack:
  added: []
  patterns:
    - encodeURIComponent on path param (T-02-11 mitigation)
    - URLSearchParams via URL.searchParams.set for query construction
    - BL-01 canonical guardrails on writes (rateLimit + idempotency + audit:true)
    - Description-quality grep-locks for "single-use" (T-02-13) and "sensitive" (T-02-12)
    - WR-05 test pattern (delete QUIQUP_PLATFORM_API_BASE_URL in beforeEach)
key_files:
  created:
    - lib/tools/get-shopify-config.ts
    - lib/tools/list-shopify-delivery-methods.ts
    - lib/tools/list-shopify-locations.ts
    - lib/tools/update-shopify-config.ts
    - lib/tools/update-shopify-connection.ts
    - lib/tools/setup-shopify-callback.ts
    - tests/tools/shopify-integration.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
decisions:
  - "update_shopify_config rate limit pinned at 10/minute matching update_account/update_return_settings (BL-01 default for mapping updates)."
  - "update_shopify_connection rate limit pinned at 5/minute (credential mutations should be rare — same shape as create_account_team_member privilege-escalation guardrail)."
  - "setup_shopify_callback rate limit pinned at 5/minute (T-02-17): combined with Shopify's single-use OAuth code, the agent cannot meaningfully flood this endpoint."
  - "setup_shopify_callback sends NO request body — all 3 params (shop_name, code, is_fulfillment) go on the query string per source-doc lines 1539-1551; the test asserts the empty body and the absent Content-Type header."
  - "Tool-layer fields (idempotency_key, environment) are stripped from upstream bodies/queries; tests assert the strip on all 3 writes."
  - "wms_delay_minutes bounded to [0, 10080] (1 week) per T-02-14; schema-parse test locks the upper bound."
  - "update_shopify_connection.token relies on the audit middleware ALWAYS_REDACT_KEYS list for at-rest redaction; description marks the field SENSITIVE so the LLM does not echo it (T-02-12)."
metrics:
  duration: ~10 minutes
  completed: 2026-05-19
  tasks: 3
  commits: 3
  tests_added: 20
  tools_added: 6
  files_created: 7
  files_modified: 2
---

# Phase 2 Plan 02: Shopify Integration Summary

6 Shopify-family tools (INTG-07/08/09/10/11/12) ship as Phase-2 Wave-2, letting an agent fully configure a Shopify shop end-to-end: read SAVED config + LIVE delivery-methods + LIVE locations, update mapping + connection credentials, and complete the OAuth dance. All 6 wrap platform-api.quiqup.com endpoints through the existing Clerk → Quiqup actor-token bridge. Writes carry the BL-01 guardrail shape (rate-limit + idempotency + audit:true), `setup_shopify_callback`'s description locks in the single-use OAuth-code warning, and `update_shopify_connection`'s description marks `token` as SENSITIVE — both pinned by grep assertions in the MSW Vitest suite.

## Objective met

Phase 2 success criterion #2 satisfied — an agent can now fully configure a Shopify shop end-to-end via the MCP surface. All 6 tools are registered through `registerTool`, `EVAL_GATE=1 bun run eval:tool-surface` is green (no drift; 64 → 70 enabled), `pnpm test` is green at 418/421 (3 pre-existing skips unrelated to this plan), and `pnpm tsc --noEmit` exits 0. The canonical patterns (path-param encoding, URLSearchParams, BL-01 write guardrails, description-quality grep-locks) are now established for the follow-on Salla and WooCommerce family plans (02-03 / 02-04).

## Tasks executed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | INTG-07/08/09 Shopify read tools | `7ba9f12` | lib/tools/get-shopify-config.ts, lib/tools/list-shopify-delivery-methods.ts, lib/tools/list-shopify-locations.ts |
| 2 | INTG-10/11/12 Shopify write tools (BL-01 guardrails) | `553f851` | lib/tools/update-shopify-config.ts, lib/tools/update-shopify-connection.ts, lib/tools/setup-shopify-callback.ts |
| 3 | MSW tests + route registration + snapshot bump | `4bb8b0c` | tests/tools/shopify-integration.test.ts, app/[transport]/route.ts, evals/snapshots/tool-surface.json |

## Verification

| Check | Result |
|-------|--------|
| `pnpm tsc --noEmit` | exits 0 |
| `pnpm vitest run tests/tools/shopify-integration.test.ts` | 20/20 pass |
| `EVAL_GATE=1 bun run eval:tool-surface` | "Tool-surface snapshot matches baseline. No drift detected." |
| `pnpm test` (full suite) | 418 passed / 3 skipped / 0 failed across 48 files |
| `jq '.tools | keys | length' evals/snapshots/tool-surface.json` | 70 (= 64 + 6) |

## Acceptance criteria

### Task 1 (reads)
- [x] 3 files exist; each exports `spec`
- [x] `grep -c "getQuiqupReadyJwt(auth.userId)" lib/tools/{get-shopify-config,list-shopify-delivery-methods,list-shopify-locations}.ts` == 3
- [x] `grep -c "encodeURIComponent" lib/tools/get-shopify-config.ts` ≥ 1
- [x] `grep -c "URLSearchParams\|searchParams" lib/tools/list-shopify-delivery-methods.ts` ≥ 1 (same for list-shopify-locations.ts)
- [x] `grep -c "list_integration_connections" lib/tools/get-shopify-config.ts` ≥ 1 (companion-tool disambiguation)
- [x] `grep -c "QuiqupHttpError" lib/tools/get-shopify-config.ts` ≥ 1

### Task 2 (writes)
- [x] 3 files exist; each exports `spec`
- [x] `grep -c "guardrails:"` ≥ 1 on each write tool
- [x] `grep -c "audit: true"` ≥ 1 on each write tool (3 total)
- [x] `grep -c "single-use\|SINGLE-USE" lib/tools/setup-shopify-callback.ts` ≥ 1 (= 6 — file body + description)
- [x] `grep -c "idempotency_key" lib/tools/update-shopify-config.ts` ≥ 2 (input field + guardrails keyArg)
- [x] `grep -c "URLSearchParams\|searchParams" lib/tools/setup-shopify-callback.ts` ≥ 1
- [x] `grep -c '"PUT"' lib/tools/update-shopify-config.ts lib/tools/update-shopify-connection.ts` == 2
- [x] `grep -c '"POST"' lib/tools/setup-shopify-callback.ts` ≥ 1
- [x] `grep -c "getQuiqupReadyJwt(auth.userId)" lib/tools/{update-shopify-config,update-shopify-connection,setup-shopify-callback}.ts` == 3

### Task 3 (tests + route + snapshot)
- [x] 6 describe blocks in `tests/tools/shopify-integration.test.ts`
- [x] `grep -c "single-use" tests/tools/shopify-integration.test.ts` ≥ 1 (locks setup_shopify_callback description assertion)
- [x] `grep -c "sensitive\|secret" tests/tools/shopify-integration.test.ts` ≥ 1 (locks update_shopify_connection token-sensitivity assertion)
- [x] +6 `registerTool(server, ...)` calls in `app/[transport]/route.ts`
- [x] `jq '.tools | keys | length' evals/snapshots/tool-surface.json` == 70 (was 64)
- [x] All 6 new tool names appear as `enabled` in the snapshot
- [x] `pnpm vitest run tests/tools/shopify-integration.test.ts` exits 0
- [x] `EVAL_GATE=1 bun run eval:tool-surface` exits 0

## Threat-model dispositions honoured

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-02-10 (spoofing) | Every handler throws `Error("<tool> requires an authenticated user")` when `auth.userId` is null. Locked in by a missing-auth assertion in each describe. |
| T-02-11 (path injection on get_shopify_config) | `encodeURIComponent(args.shop_name)` in the URL path. Locked in by a round-trip test using a special-char shop_name (`"acme store/with special"`) — assertion confirms the encoded form appears and the raw form does NOT. |
| T-02-12 (token leakage on update_shopify_connection) | (a) Description marks `token` as SENSITIVE in plain language; (b) audit middleware already redacts the `token` key via ALWAYS_REDACT_KEYS; (c) test grep-locks the "sensitive"/"secret" wording on the description. |
| T-02-13 (OAuth-code replay on setup_shopify_callback) | (a) Description warns single-use; (b) `audit:true` emits a record on every call so replay attempts are traceable; (c) `guardrails.idempotency` (15-min TTL on idempotency_key) dedupes legitimate retries; (d) test grep-locks the "single-use" wording on the description. |
| T-02-14 (wms_delay_minutes abuse) | `z.number().int().min(0).max(10080)` bounds the delay to [0, 1 week]. Schema-parse test asserts 10081 rejected and 10080 accepted. |
| T-02-15 (delivery_methods array cardinality) | Accepted — no max cardinality on the array, matching upstream Shopify reality. Audit-log layer's 64KB bound on logged args remains the backstop. |
| T-02-16 (write repudiation) | All 3 writes set `audit: true` per BL-01. Reads intentionally do NOT carry guardrails (matches Phase-1 read pattern). |
| T-02-17 (callback flood) | `guardrails.rateLimit: { capacity: 5, refillPerSec: 5/60 }` = 5/min — combined with single-use OAuth-code semantics, agents cannot meaningfully flood this endpoint. |
| T-02-18 (get_shopify_config envelope leakage) | Accepted — Platform API is the visibility source of truth via the Bearer token. |
| T-02-SC (slopsquatting) | No new packages installed by this plan; uses only existing zod + msw + vitest. |

## Deviations from Plan

None — plan executed exactly as written. The 3 read-tool files (Task 1) were already present on the branch from a prior session (commit `7ba9f12`); they were inspected, found to fully satisfy the plan's spec (path/query encoding, auth gate, QuiqupHttpError, eval-driven companion-tool disambiguation), passed `pnpm tsc --noEmit`, and Task 1 was carried forward unmodified.

## Authentication gates

None — all work was code-only; no external auth was required during execution.

## Known stubs

None. All 6 tools have fully wired handlers (no hardcoded empty arrays/objects, no "coming soon" placeholders). The output schemas use `z.object({}).passthrough()` by design — the upstream envelopes are too partner-shape-dependent to enumerate exhaustively, and the registerTool wrapper does not enforce output schemas at runtime (TODO(M4) in `lib/tools/register.ts`).

## Self-Check: PASSED

Verified all created files exist:
- `lib/tools/get-shopify-config.ts` — FOUND
- `lib/tools/list-shopify-delivery-methods.ts` — FOUND
- `lib/tools/list-shopify-locations.ts` — FOUND
- `lib/tools/update-shopify-config.ts` — FOUND
- `lib/tools/update-shopify-connection.ts` — FOUND
- `lib/tools/setup-shopify-callback.ts` — FOUND
- `tests/tools/shopify-integration.test.ts` — FOUND

Verified commits exist on `claude/add-skip-discuss-config-hIwXh`:
- `7ba9f12` (Task 1 — INTG-07/08/09 reads) — FOUND
- `553f851` (Task 2 — INTG-10/11/12 writes) — FOUND
- `4bb8b0c` (Task 3 — tests + route + snapshot) — FOUND
