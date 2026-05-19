---
phase: 02-integrations
plan: 05
subsystem: integrations / destructive-safety
tags: [destructive, confirm-gate, dry-run, integrations, salla, shopify, woocommerce, middleware]
requires:
  - 02-01  # list_integration_connections (source for shop_name + id discovery)
  - 02-04  # get_salla_connection (pre-delete preview path)
provides:
  - "lib/middleware/destructive.ts — canonical confirm:true gate helpers (reused by Phases 4/6/8/9/10)"
  - "delete_integration_source — INTG-02 DELETE /{source}/delete/{shopName}"
  - "delete_salla_connection — INTG-22 DELETE /integrations/connections/{id}"
affects:
  - "app/[transport]/route.ts (+2 registerTool calls under new DESTRUCTIVE block)"
  - "evals/snapshots/tool-surface.json (82 → 84 enabled)"
tech_stack:
  added: []
  patterns:
    - "Canonical destructive-gate helper module — confirm: true required, dry_run pairs with confirm, tight 3/min rate-limit, audit:true on every call. Reused via direct import (no copy-paste) by future destructive tools in Phases 4/6/8/9/10."
    - "MSW request-count assertion (deleteCount === 0 on negative paths) — bypass-proof lock proving destructive gate runs CLIENT-SIDE."
    - "Auth gate BEFORE confirm gate BEFORE dry_run BEFORE upstream call — strict ordering documented in module header (T-02-37/38/39 mitigations)."
key_files:
  created:
    - lib/tools/delete-integration-source.ts
    - lib/tools/delete-salla-connection.ts
    - tests/tools/destructive-integrations.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
    - .planning/STATE.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
  pre_existing:
    - lib/middleware/destructive.ts  # Task 1 — committed in fa4217b prior to this execution
    - tests/middleware/destructive.test.ts  # Task 1 — committed in fa4217b prior to this execution
decisions:
  - "Canonical destructive-gate API codified at lib/middleware/destructive.ts — future phases (4/6/8/9/10) MUST import requireConfirm + destructiveConfirmField + destructiveDryRunField + isDryRun + ConfirmationRequiredError + buildConfirmationRequiredResult rather than re-deriving them."
  - "Auth layered OUTSIDE confirm gate (T-02-37) — missing auth.userId throws before requireConfirm runs, so the canonical 'confirm required' error never leaks information to unauthenticated callers."
  - "dry_run does NOT bypass confirm (T-02-39) — caller MUST set both confirm:true AND dry_run:true to exercise the preview path. Intentional: dry-run is 'I have confirmed, show me what would happen' — not 'skip confirm because I'm only previewing'."
  - "Tight 3/min rate-limit on both destructive tools — matches cancel_lastmile_orders_batch (the closest existing 'rare-by-design' destructive). Combined with confirm:true, a runaway agent cannot sweep connections."
  - "Synthesized response shape `{ ok, deleted: { ... }, upstream_status }` on success — upstream returns empty body (INTG-22) or undocumented body (INTG-02 per source-doc line 182), so the MCP layer provides a deterministic positive confirmation rather than passing an unknown shape to the LLM."
metrics:
  duration: ~15m
  completed: 2026-05-19
  tasks: 3
  files_total: 6  # 2 new tool files + 1 new test file + 3 modified (route, snapshot, planning docs)
  tests_added: 11  # integration tests (Task 1's 22 helper unit tests were pre-committed in fa4217b)
  total_test_count: 495 passed (was 462 after 02-04; +22 helper unit + 11 integration = 495)
---

# Phase 2 Plan 5: DESTRUCTIVE deletes + canonical confirm:true gate Summary

Established the canonical `requireConfirm` destructive-gate helper module at `lib/middleware/destructive.ts` and shipped the two DESTRUCTIVE Phase-2 deletes (INTG-02 `delete_integration_source`, INTG-22 `delete_salla_connection`) that use it. The 5-path coverage contract (confirm missing / confirm:false / confirm+dry_run / confirm only / missing auth) with MSW request-count assertion is now locked in — no upstream DELETE traffic ever fires on a negative path. Phase 2 destructive coverage is complete; only the eval-coverage wave (02-06) remains for the phase.

## What Shipped

### Task 1 — Canonical destructive-gate helper (pre-committed in fa4217b)

`lib/middleware/destructive.ts` (6 exports — the stable Phase 2+ destructive surface):

| Export | Type | Purpose |
|--------|------|---------|
| `destructiveConfirmField` | Zod field | Optional boolean; description pins canonical "DESTRUCTIVE-GATE: MUST be set to true" phrase. |
| `destructiveDryRunField` | Zod field | Optional boolean with default `false`; description pins canonical dry-run semantic. |
| `ConfirmationRequiredError` | Error subclass | Carries `toolName` + `resourceDescription` as readonly fields. |
| `requireConfirm(toolName, args, resourceDescription)` | Function | Throws `ConfirmationRequiredError` unless `args.confirm === true` (strict equality — no coercion). |
| `isDryRun(args)` | Function | Returns `true` iff `args.dry_run === true` (strict equality). |
| `buildConfirmationRequiredResult(err)` | Function | Converts the typed error into a structured MCP `{ content, isError: true }` result whose text contains tool + resource + literal `confirm: true` recovery hint. |

`tests/middleware/destructive.test.ts` — 22 unit tests in isolation (no MCP server, no MSW, no JWT mints). Covers Zod parse shape for both fields, strict-equality gate in `requireConfirm` (rejects `"true"`, `1`, etc.), strict-equality gate in `isDryRun`, and the structured-result shape from `buildConfirmationRequiredResult`.

### Task 2 — Two DESTRUCTIVE delete tools (commit `2596253`)

**`lib/tools/delete-integration-source.ts`** (INTG-02) — `DELETE /{source}/delete/{shopName}`:
- Input: `source` (enum `shopify`/`woocommerce`/`salla`, path-injection lock), `shop_name` (string, encoded), `confirm`, `dry_run`, `idempotency_key`, `environment`.
- Handler order: auth → `requireConfirm` → `isDryRun` short-circuit → JWT mint → DELETE → synthesized echo `{ ok, deleted: { source, shop_name }, upstream_status }`.
- Guardrails: `rateLimit: { capacity: 3, refillPerSec: 3/60 }`, idempotency (15m TTL), `audit: true`.

**`lib/tools/delete-salla-connection.ts`** (INTG-22) — `DELETE /integrations/connections/{id}`:
- Input: `id` (encoded), `confirm`, `dry_run`, `idempotency_key`, `environment`.
- Description references `get_salla_connection` as the pre-delete preview path.
- Handler order: auth → `requireConfirm` → `isDryRun` short-circuit → JWT mint → DELETE → synthesized echo `{ ok, deleted: { id }, upstream_status }`.
- Guardrails: same TIGHT 3/min block.

### Task 3 — Integration tests + route + snapshot (commit `3ea053f`)

`tests/tools/destructive-integrations.test.ts` — 11 tests across both tools covering all 5 paths plus tool-specific schema/encoding canaries:

| # | Path | Assertion |
|---|------|-----------|
| 1 | confirm missing | `deleteCount === 0`, `isError: true`, text contains tool name + resource + `confirm: true` |
| 2 | confirm: false | same as 1 (defense-in-depth) |
| 3 | confirm: true + dry_run: true | `deleteCount === 0`, non-error, parsed `{ ok, dry_run: true, would_delete, note }` |
| 4 | confirm: true only | `deleteCount === 1`, method `DELETE`, encoded path params, empty body, parsed `{ ok, deleted, upstream_status: 200 }` |
| 5 | missing auth.userId | `rejects.toThrow(/authenticated user/)`, `deleteCount === 0` |
| extra | `delete_integration_source` schema rejects `source: "magento"` | Zod safeParse fails (enum-bound) |
| extra | `delete_salla_connection` encodes `id` containing `/` | URL contains percent-encoded form, NOT the raw `/` |

`app/[transport]/route.ts` — new comment-delimited block `// -- Phase 2: DESTRUCTIVE deletes (INTG-02, INTG-22) — confirm:true gated --` with 2 imports + 2 `registerTool` calls, placed AFTER the Salla block and BEFORE the M3 enabled writes block.

`evals/snapshots/tool-surface.json` — +2 alphabetically-sorted entries (`delete_integration_source`, `delete_salla_connection`), both `enabled`. Total surface 82 → 84.

## Verification Gates

| Gate | Result |
|------|--------|
| `pnpm tsc --noEmit` | PASS |
| `pnpm vitest run tests/middleware/destructive.test.ts` | PASS — 22/22 |
| `pnpm vitest run tests/tools/destructive-integrations.test.ts` | PASS — 11/11 |
| `EVAL_GATE=1 bun run eval:tool-surface` | PASS — snapshot matches baseline |
| `pnpm test` (full suite) | PASS — 495/498 (3 pre-existing skips) |

## Future-Phase Reuse Contract — IMPORTANT

The canonical destructive-gate API codified here is the **stable Phase 2+ surface**. Future phases that ship destructive tools MUST import these exports directly:

| Phase | Plan(s) | Destructive tools that will reuse this module |
|-------|---------|----------------------------------------------|
| 4 | Order write-path | `set_collection_failed_batch` (already exists; M6 will retroactively wire), other batch status transitions, `set_on_hold_batch`, `set_return_to_origin_batch` |
| 6 | Inbound + Products | `cancel_inbound`, `delete_products` |
| 8 | Shipper / Dispatcher | `delete_dispatcher_rule_set` (SHPR-04) |
| 9 | (dispatcher tools) | — |
| 10 | Finance | `delete_stripe_payment_method` (FIN-11) |

The exports' names are part of the library's stable surface. Do NOT rename `requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, or `buildConfirmationRequiredResult` without a coordinated update across every importer. The module header at `lib/middleware/destructive.ts` documents this contract.

## Deviations from Plan

None — plan executed exactly as written. Task 1 (the helper module + unit tests) was pre-committed as commit `fa4217b` before this execution session; verification confirms it satisfies every Task 1 acceptance criterion as written, so Task 1 was treated as already-done and verified rather than re-implemented.

## Threat Mitigations Confirmed (STRIDE register, plan threat_model section)

| Threat ID | Mitigation evidence |
|-----------|---------------------|
| T-02-37 (Spoofing) | Auth check (`if (!auth.userId) throw`) runs BEFORE `requireConfirm`. MSW assertion (test path 5) confirms ZERO upstream DELETE on missing-auth call. |
| T-02-38 (Tampering — accidental delete) | `requireConfirm` throws unless `args.confirm === true` (strict equality). MSW assertion (test paths 1+2) confirms ZERO upstream DELETE on confirm-missing / confirm-false calls. |
| T-02-39 (Tampering — dry_run as confirm bypass) | Handler runs `requireConfirm` BEFORE `isDryRun`. Test path 3 sets BOTH `confirm: true` AND `dry_run: true` — the only legitimate way to exercise the preview path. |
| T-02-40 (Path injection — source) | `z.enum(["shopify", "woocommerce", "salla"])` rejects any other value at schema-parse. Extra test confirms `source: "magento"` fails `safeParse`. |
| T-02-41 (Path injection — shop_name / id) | `encodeURIComponent` on both path params. Test path 4 for INTG-02 asserts a shop_name with spaces is percent-encoded; test path 4 for INTG-22 asserts an id with `/` is percent-encoded (NOT routed as nested path). |
| T-02-42 (DoS — mass-delete sweep) | TIGHT `rateLimit: { capacity: 3, refillPerSec: 3/60 }` (3/min). Combined with confirm-true requirement. |
| T-02-43 (Repudiation — destructive traceability) | `audit: true` on both tools — every call (success / dry-run / rejected) emits an audit record. |

## Known Stubs

None.

## Threat Flags

None — no security-relevant surface was introduced outside the plan's STRIDE register.

## Self-Check: PASSED

- `[x]` `lib/middleware/destructive.ts` exists (pre-committed in fa4217b; verified via `Read`)
- `[x]` `tests/middleware/destructive.test.ts` exists (pre-committed in fa4217b)
- `[x]` `lib/tools/delete-integration-source.ts` exists (commit 2596253)
- `[x]` `lib/tools/delete-salla-connection.ts` exists (commit 2596253)
- `[x]` `tests/tools/destructive-integrations.test.ts` exists (commit 3ea053f)
- `[x]` `app/[transport]/route.ts` modified — new `// -- Phase 2: DESTRUCTIVE deletes` block with 2 registerTool calls (commit 3ea053f)
- `[x]` `evals/snapshots/tool-surface.json` updated — `delete_integration_source` + `delete_salla_connection` entries present (commit 3ea053f)
- `[x]` Commit `fa4217b` (Task 1) present in `git log` — `feat(02-05): add canonical requireConfirm destructive-gate helper`
- `[x]` Commit `2596253` (Task 2) present in `git log` — `feat(02-05): add 2 DESTRUCTIVE delete tools (INTG-02, INTG-22)`
- `[x]` Commit `3ea053f` (Task 3) present in `git log` — `test(02-05): wire 2 destructive tools, 5-path MSW suite, snapshot bump`

## Flag for User

The `PROJECT.md` "Destructive endpoints (DELETE, batch status transitions, mass operations) gated with explicit confirmation parameters" key-decision row can flip from `[ ]` to `[x]` after this plan ships — the canonical helper module + 2 destructive tools + 5-path coverage with MSW request-count assertion together SATISFY the requirement for the Phase 2 deletes. Per the plan's `<output>` block, this flip is deferred to the user's project-status pass and is NOT performed from inside this plan.
