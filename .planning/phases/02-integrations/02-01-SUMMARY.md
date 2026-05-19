---
phase: 02-integrations
plan: 01
subsystem: integrations
tags: [phase-2, wave-1, integrations, shared-surface, intg-01, intg-03, intg-04, intg-05, intg-06]
dependency_graph:
  requires:
    - lib/quiqup.ts (getQuiqupReadyJwt — Clerk → actor-token bridge)
    - lib/clients/quiqup-env.ts (environmentField, getPlatformApiBaseUrl)
    - lib/clients/quiqup-lastmile.ts (QuiqupHttpError)
    - lib/tools/register.ts (ToolSpec, registerTool, GuardrailConfig)
  provides:
    - list_integration_connections (INTG-01) — cross-family integration catalog
    - list_integration_order_reasons (INTG-03) — failed-order triage table
    - repair_integration_orders (INTG-04) — batch repair (≤50 ids/call)
    - get_integration_order (INTG-05) — post-repair re-fetch envelope
    - confirm_ff_export (INTG-06) — fulfilment-order export ack
  affects:
    - app/[transport]/route.ts (5 new registerTool calls)
    - evals/snapshots/tool-surface.json (59 → 64 enabled tools)
tech_stack:
  added: []
  patterns:
    - URLSearchParams for query construction (T-02-03 mitigation)
    - encodeURIComponent for path-param hygiene (T-02-02 mitigation)
    - BL-01 canonical guardrails shape on writes (rateLimit + idempotency + audit:true)
    - WR-05 test pattern (unset QUIQUP_PLATFORM_API_BASE_URL in beforeEach)
key_files:
  created:
    - lib/tools/list-integration-connections.ts
    - lib/tools/list-integration-order-reasons.ts
    - lib/tools/get-integration-order.ts
    - lib/tools/repair-integration-orders.ts
    - lib/tools/confirm-ff-export.ts
    - tests/tools/integrations-shared.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
decisions:
  - "Repair-orders rate limit pinned at 5/minute (50-id batch × 5/min ⇒ ≤250 attempts/min) per T-02-08 disposition."
  - "confirm_ff_export rate limit pinned at 30/minute — webhook-driven acks come in pulses; high enough for a normal pulse, bounded enough to stop a runaway loop."
  - "Tool-layer fields (idempotency_key, environment) are explicitly stripped from upstream bodies; test asserts the strip on both writes."
  - "T-02-09 envelope leakage on get_integration_order accepted (no MCP-side re-filtering — Platform API is the visibility source of truth)."
metrics:
  duration: ~25 minutes
  completed: 2026-05-19
  tasks: 3
  commits: 3
  tests_added: 17
  tools_added: 5
  files_created: 6
  files_modified: 2
---

# Phase 2 Plan 01: Shared Integrations Surface Summary

5 shared-integration tools (INTG-01/03/04/05/06) ship as Phase-2 Wave-1 substrate: cross-family `list_integration_connections` catalog, the failed-orders `list_integration_order_reasons` triage table, the `repair_integration_orders` batch (≤50 ids/call, 5/min rate-limited, idempotency-keyed, audited), the post-repair `get_integration_order` re-fetch, and the `confirm_ff_export` ack — all 1:1 wrappers over existing platform-api.quiqup.com endpoints through the existing Clerk → Quiqup actor-token bridge, with full MSW Vitest coverage and an updated tool-surface snapshot.

## Objective met

All five shared-integration substrate tools are in place so the Shopify/WooCommerce/Salla family plans (02-02..04) can proceed without re-implementing the cross-family lookup, failure-queue triage, repair-batch, or export-ack endpoints. The MCP server registers all 5 specs through `registerTool`, `EVAL_GATE=1 bun run eval:tool-surface` is green (no drift), `pnpm test` is green at 398/401 (3 pre-existing skips unrelated to this plan), and `pnpm tsc --noEmit` exits 0.

## Tasks executed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | INTG-01/03/05 read tools | `2eaa158` | lib/tools/list-integration-connections.ts, lib/tools/list-integration-order-reasons.ts, lib/tools/get-integration-order.ts |
| 2 | INTG-04/06 write tools (with BL-01 guardrails) | `55d603e` | lib/tools/repair-integration-orders.ts, lib/tools/confirm-ff-export.ts |
| 3 | MSW tests + route registration + snapshot bump | `aff131c` | tests/tools/integrations-shared.test.ts, app/[transport]/route.ts, evals/snapshots/tool-surface.json |

## Verification

| Check | Result |
|-------|--------|
| `pnpm tsc --noEmit` | exits 0 |
| `pnpm vitest run tests/tools/integrations-shared.test.ts` | 17/17 pass |
| `EVAL_GATE=1 bun run eval:tool-surface` | "Tool-surface snapshot matches baseline. No drift detected." |
| `pnpm test` (full suite) | 398 passed / 3 skipped / 0 failed across 47 files |
| `jq '.tools | keys | length' evals/snapshots/tool-surface.json` | 64 (= 59 + 5) |

## Acceptance criteria

- [x] `grep -c "getQuiqupReadyJwt(auth.userId)" lib/tools/{list-integration-connections,list-integration-order-reasons,get-integration-order}.ts` == 3
- [x] `grep -c "encodeURIComponent" lib/tools/get-integration-order.ts` ≥ 1
- [x] `grep -c "URLSearchParams\|searchParams" lib/tools/list-integration-order-reasons.ts` ≥ 1
- [x] limit + offset typed as `z.number().int()` ≥ 2 hits in `list-integration-order-reasons.ts`
- [x] `grep -c "QuiqupHttpError" lib/tools/list-integration-connections.ts` ≥ 1
- [x] `grep -c "guardrails:"` ≥ 1 on each write tool
- [x] `grep -c "audit: true"` ≥ 1 on each write tool
- [x] `grep -c "idempotency_key" lib/tools/repair-integration-orders.ts` ≥ 2 (input field + guardrails keyArg)
- [x] `grep -c '"POST"'` ≥ 1 on each write tool
- [x] `repair_integration_orders` enforces `ids.max(50)`
- [x] 5 describe blocks in `tests/tools/integrations-shared.test.ts`
- [x] +5 `registerTool(server, ...)` calls in `app/[transport]/route.ts`
- [x] +5 alpha-sorted entries in `evals/snapshots/tool-surface.json`
- [x] All 5 new tool names appear as `enabled` in the snapshot

## Threat-model dispositions honoured

| Threat ID | Mitigation in code |
|-----------|--------------------|
| T-02-01 (spoofing) | Every handler throws `Error("<tool> requires an authenticated user")` when `auth.userId` is null. Locked in by a missing-auth assertion in each describe. |
| T-02-02 (path injection) | `encodeURIComponent(args.order_uuid)` in `get_integration_order`. Locked in by the round-trip test using a special-char uuid (`"uuid:1234/with special"`). |
| T-02-03 (query injection) | All 7 query params on `list_integration_order_reasons` go through `URL.searchParams.set()` (URLSearchParams under the hood). `limit` capped at 200, `offset.min(0)`. |
| T-02-04 (mass-repair abuse) | `ids.array().min(1).max(50)`, `source` enum (`shopify`/`woocommerce`/`salla`), 5/min rate-limit, 15-min idempotency, `audit: true`. |
| T-02-05 (ack spoofing) | `order_uuid.min(1)`; upstream 404 surfaces via `QuiqupHttpError`. |
| T-02-06 (bearer leakage) | No tool logs the JWT; QuiqupHttpError carries only status + body. |
| T-02-07 (write repudiation) | `audit: true` on both writes; reads intentionally do NOT carry guardrails (Phase-1 read pattern). |
| T-02-08 (DoS via repair) | 5/min × 50 ids cap ⇒ ≤250 repair attempts/minute. |
| T-02-09 (envelope leakage) | Accepted — Platform API is the visibility source of truth. |
| T-02-SC (slopsquatting) | No new packages installed; uses only existing zod + msw. |

## Deviations from Plan

None — plan executed exactly as written. The 3 read-tool files were already present on the branch from a prior session; they were inspected, found to fully match the plan's spec (auth-throw phrasing, URLSearchParams, encodeURIComponent, QuiqupHttpError, eval-driven descriptions), passed `pnpm tsc --noEmit`, and were committed as-is under Task 1.

## Authentication gates

None — all work was code-only; no external auth was required during execution.

## Known stubs

None. All 5 tools have fully wired handlers (no hardcoded empty arrays/objects, no "coming soon" placeholders). The output schemas use `z.object({}).passthrough()` by design — the upstream envelopes (e.g. the integration-order full envelope at source-doc lines 1144-1411) are too large to enumerate exhaustively and the registerTool wrapper does not enforce output schemas at runtime (TODO(M4) in `lib/tools/register.ts`).

## Self-Check: PASSED

Verified all created files exist:
- `lib/tools/list-integration-connections.ts` — FOUND
- `lib/tools/list-integration-order-reasons.ts` — FOUND
- `lib/tools/get-integration-order.ts` — FOUND
- `lib/tools/repair-integration-orders.ts` — FOUND
- `lib/tools/confirm-ff-export.ts` — FOUND
- `tests/tools/integrations-shared.test.ts` — FOUND

Verified commits exist on `claude/add-skip-discuss-config-hIwXh`:
- `2eaa158` (Task 1) — FOUND
- `55d603e` (Task 2) — FOUND
- `aff131c` (Task 3) — FOUND
