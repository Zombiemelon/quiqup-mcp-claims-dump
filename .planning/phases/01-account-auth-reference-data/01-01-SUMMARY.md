---
phase: 01-account-auth-reference-data
plan: 01
subsystem: mcp-tools
tags: [auth, account, reference-data, platform-api, read-only]
dependency-graph:
  requires:
    - lib/quiqup.ts (getQuiqupReadyJwt — Clerk → Quiqup actor-token bridge)
    - lib/clients/quiqup-lastmile.ts (QuiqupHttpError)
    - lib/clients/quiqup-env.ts (environmentField, getPlatformApiBaseUrl)
    - lib/tools/register.ts (ToolSpec, registerTool)
  provides:
    - get_account tool spec (AUTH-03)
    - get_permissions tool spec (AUTH-04)
    - get_account_capabilities tool spec (AUTH-05)
    - get_account_by_id tool spec (AUTH-06)
    - get_quiqdash_init tool spec (AUTH-09)
    - list_service_kinds tool spec (AUTH-08)
    - list_quiqup_order_states tool spec (INTG-19)
  affects:
    - app/[transport]/route.ts (7 new registerTool calls)
    - evals/snapshots/tool-surface.json (8 net additions: 7 new + 1 drift fix)
    - lib/tools/whoami-platform.ts (reciprocal disambiguation clause)
tech-stack:
  added: []
  patterns:
    - 1:1 GET-wrapper modeled on lib/tools/whoami-platform.ts (inline fetch, Bearer auth, QuiqupHttpError on non-2xx)
    - Description-driven disambiguation between adjacent tools, locked in by test assertions
key-files:
  created:
    - lib/tools/get-account.ts
    - lib/tools/get-permissions.ts
    - lib/tools/get-account-capabilities.ts
    - lib/tools/get-account-by-id.ts
    - lib/tools/get-quiqdash-init.ts
    - lib/tools/list-service-kinds.ts
    - lib/tools/list-quiqup-order-states.ts
    - tests/tools/auth-account-reads.test.ts
  modified:
    - app/[transport]/route.ts
    - lib/tools/whoami-platform.ts
    - evals/snapshots/tool-surface.json
decisions:
  - "Output schemas are intentionally loose (z.object({}).passthrough()) — payloads are partner-shape dependent; tightening risks false rejects when upstream adds fields."
  - "get_account_capabilities defaults `id` to \"me\" (matches QuiqDash useGetAccountCapabilitiesOnLoad)."
  - "get_account_by_id has no default — admin / impersonation contexts always pass an explicit Salesforce id."
  - "Rule 3 fix: added missing `update_order_waypoint` entry to evals/snapshots/tool-surface.json (pre-existing baseline drift from #13) so the EVAL_GATE verification could pass."
metrics:
  duration: "3m 47s"
  completed: "2026-05-19"
  tasks_completed: 2
  files_touched: 11
  tests_added: 23
---

# Phase 1 Plan 1: Account, Auth & Reference-Data Reads Summary

Shipped seven read-only MCP tools wrapping `platform-api.quiqup.com` endpoints (AUTH-03/04/05/06/08/09 + INTG-19), each a 1:1 GET pass-through over the existing Clerk → Quiqup actor-token bridge, with MSW-mocked Vitest coverage and a tool-surface snapshot bump.

## What changed

Five core /account reads (Task 1):

- `get_account`             → `GET /account`
- `get_permissions`         → `GET /permissions` (sends `x-api-version: 1`)
- `get_account_capabilities` → `GET /accounts/{id}/capabilities` (default `id="me"`)
- `get_account_by_id`        → `GET /accounts/{id}` (Salesforce id, `encodeURIComponent`-escaped)
- `get_quiqdash_init`        → `GET /quiqdash/init`

Two reference-data lookups (Task 2):

- `list_service_kinds`        → `GET /quiqup/service-kinds`
- `list_quiqup_order_states`  → `GET /quiqup/orders/states`

Plus:

- 7 new `registerTool(...)` calls under a new `// -- Phase 1: account + permissions reads --` block in `app/[transport]/route.ts`.
- `tests/tools/auth-account-reads.test.ts` — 8 describe blocks, 23 assertions: happy-path + upstream 401 + missing-auth for each of the 7 tools, plus a description-grep assertion that pins the canonical `get_account` / `whoami_platform` / `get_account_by_id` disambiguation in both directions.
- `lib/tools/whoami-platform.ts` description gains a reciprocal sentence: "use `get_account` to read the partner's account profile (different endpoint, different payload)".
- `evals/snapshots/tool-surface.json` re-sorted with the 7 new entries.

## Verification

| Command                                                            | Result          |
| ------------------------------------------------------------------ | --------------- |
| `pnpm vitest run tests/tools/auth-account-reads.test.ts`           | 23 passed, 0 failed |
| `pnpm tsc --noEmit`                                                | exit 0          |
| `EVAL_GATE=1 bun run eval:tool-surface`                            | exit 0          |
| `pnpm test` (full regression)                                      | 320 passed, 3 skipped, 0 failed |

## Decisions Made

- **Loose output schemas (`z.object({}).passthrough()`)** — Account/permissions/init payloads are partner-shape dependent (which fields are populated varies by account type and feature toggles). Strict schemas would create false-positive rejects every time upstream adds a field. `passthrough` keeps the contract loose while letting tests still `.safeParse` for sanity.
- **`get_account_capabilities.id` defaults to `"me"`** — matches the QuiqDash `useGetAccountCapabilitiesOnLoad` boot-time call shape. Admin callers pass an explicit Salesforce id.
- **`get_account_by_id` has no `id` default** — this tool is intentionally admin-scoped; forcing the caller to pass an id avoids accidental "read my own account" calls that should have used `get_account`.
- **Rule 3 fix: `update_order_waypoint` added to the tool-surface baseline** — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Pre-existing baseline drift in `evals/snapshots/tool-surface.json`**

- **Found during:** Task 2 verification (`EVAL_GATE=1 bun run eval:tool-surface`).
- **Issue:** The `update_order_waypoint` tool (registered in `app/[transport]/route.ts` since commit `18eaea2` / PR #13) was missing from `evals/snapshots/tool-surface.json`. The eval gate failed with `Added tools (in code, missing from baseline): + update_order_waypoint`, which blocked the plan's `<verification>` requirement that `EVAL_GATE=1 bun run eval:tool-surface` exits 0.
- **Fix:** Added a single `"update_order_waypoint": "enabled"` entry to the snapshot alongside the 7 Phase-1 additions. The tool is genuinely registered and `enabled` in code, so this brings the baseline back into agreement with reality.
- **Files modified:** `evals/snapshots/tool-surface.json`.
- **Commit:** `2485d09`.

### Scope-Boundary Notes

None — all changes were directly required by the plan's two tasks (plus the one Rule 3 blocking-issue fix above).

### Auth Gates

None.

## Self-Check: PASSED

- `lib/tools/get-account.ts` — exists.
- `lib/tools/get-permissions.ts` — exists.
- `lib/tools/get-account-capabilities.ts` — exists.
- `lib/tools/get-account-by-id.ts` — exists.
- `lib/tools/get-quiqdash-init.ts` — exists.
- `lib/tools/list-service-kinds.ts` — exists.
- `lib/tools/list-quiqup-order-states.ts` — exists.
- `tests/tools/auth-account-reads.test.ts` — exists, 23/23 tests pass.
- Commit `b9c51cd` — found in `git log` (Task 1).
- Commit `2485d09` — found in `git log` (Task 2).

## Commits

| Hash      | Task | Message |
| --------- | ---- | ------- |
| `b9c51cd` | 1    | `feat(01-01): implement five core /account read tools (AUTH-03/04/05/06/09)` |
| `2485d09` | 2    | `feat(01-01): register Phase 1 reads, add MSW test suite, bump tool-surface snapshot` |
