---
phase: 01-account-auth-reference-data
plan: 03
subsystem: account-writes-and-feature-flags
tags: [auth, writes, feature-flags, return-settings, team-management, phase-1, wave-3]
requires:
  - 01-01  # tools/register.ts + ToolSpec + auth context shape + MSW setup
  - 01-02  # established address-and-reasons write conventions; route block ordering
provides:
  - AUTH-07  # update_account — broad PUT /accounts
  - AUTH-10  # decide_feature_flags_bulk — POST /featureflags/decide-bulk
  - AUTH-11  # get_return_settings — GET /api/accounts/{id}/return-settings
  - AUTH-12  # update_return_settings — PUT /api/accounts/{id}/return-settings
  - AUTH-13  # create_account_team_member — POST /account/team
affects:
  - app/[transport]/route.ts  # +5 imports / +5 registerTool calls
  - evals/snapshots/tool-surface.json  # +5 enabled entries
tech_stack_added: []  # no new deps; reuses zod + msw
patterns:
  - "Identifier-binding: decide_feature_flags_bulk derives Identifier from auth.userId server-side; input schema does not expose the field."
  - "Twin disambiguation in description+test: update_account references both its read-twin (get_account) and its future narrow-variant (update_bank_details / FIN-05)."
  - "Path-param-not-body: update_return_settings sends account_id only in the URL, never in the body — encodeURIComponent at the boundary."
key_files:
  created:
    - lib/tools/update-account.ts                  # AUTH-07 — committed in f10c28d
    - lib/tools/decide-feature-flags-bulk.ts       # AUTH-10
    - lib/tools/get-return-settings.ts             # AUTH-11
    - lib/tools/update-return-settings.ts          # AUTH-12
    - lib/tools/create-account-team-member.ts      # AUTH-13
    - tests/tools/auth-account-writes.test.ts      # 5 describe blocks, 17 specs
  modified:
    - app/[transport]/route.ts                     # +5 imports, +5 registerTool
    - evals/snapshots/tool-surface.json            # +5 entries, alphabetized
decisions:
  - "AUTH-07 owns the broad PUT /accounts payload now. FIN-05 (Phase 10) will provide a constrained bank-details-only variant against the same endpoint. The disambiguation is locked into the codebase via three signals: get_account's description, update_account's description, and an assertion test."
  - "decide_feature_flags_bulk does NOT replicate the QuiqDash frontend's all-enabled fallback on upstream failure. Tools must surface errors honestly via QuiqupHttpError; silent fallback would let agents falsely believe flags are on."
  - "create_account_team_member is NOT gated by a confirm:true flag despite being a privilege-grant action. Rationale: the destructive-policy gate in PROJECT.md scopes to batch ops + DELETEs; creating a single team member is reversible (upstream removal). The description carries an explicit warning instead. T-01-20 disposition."
metrics:
  duration_minutes: ~12
  completed_at: 2026-05-19T20:37Z
  commits: 3
  tasks: 3
  files_created: 6
  files_modified: 2
---

# Phase 1 Plan 03: Auth & Account Writes + Feature Flags Summary

Five Phase-1 write tools (`update_account`, `decide_feature_flags_bulk`,
`get_return_settings`, `update_return_settings`, `create_account_team_member`)
shipped against platform-api.quiqup.com with an MSW-mocked Vitest suite that
locks in the AUTH-07/FIN-05 disambiguation, the decide_feature_flags_bulk
Identifier-binding invariant, and email validation on team-member creation.

## What changed

### Task 1 — update_account (AUTH-07) — commit `f10c28d`

- `lib/tools/update-account.ts` — PUT /accounts handler with the broad partner
  profile schema (name, contact_*, billing_email, default_currency,
  region_code, service_offering, settings blob, bank_*). All fields optional;
  handler builds the body from only supplied keys (no `undefined` keys
  forwarded upstream).
- Description carries the canonical AUTH-07 vs FIN-05 disambiguation, the
  reference back to `get_account` (AUTH-03), and the explicit prohibition on
  the `references` poison-memory field.

### Task 2 — AUTH-10/11/12/13 — commit `ae9480e`

- `lib/tools/decide-feature-flags-bulk.ts` — POST /featureflags/decide-bulk.
  Body is `{ Features, Identifier }`; **Identifier is sourced from auth.userId
  only**; the input schema does NOT expose an Identifier field. No silent
  all-enabled fallback (unlike the QuiqDash frontend).
- `lib/tools/get-return-settings.ts` — GET /api/accounts/{accountID}/return-settings.
  `account_id` defaults to `"me"`; `encodeURIComponent` at the URL boundary.
- `lib/tools/update-return-settings.ts` — PUT /api/accounts/{accountID}/return-settings.
  Partial-update semantics; `account_id` lives in the path, NOT the body.
  Fields: `return_window_days`, `allowed_reasons`, `settings`.
- `lib/tools/create-account-team-member.ts` — POST /account/team. Zod-validated
  email; explicit privilege-grant warning in the description.

All four handlers follow the standard Platform write pattern: auth guard →
`getQuiqupReadyJwt(auth.userId)` → fetch with Bearer + JSON →
`QuiqupHttpError` on non-2xx.

### Task 3 — tests + registration + snapshot — commit `7f3696b`

- `tests/tools/auth-account-writes.test.ts` — 5 describe blocks, **17 specs**,
  all green. Each tool has the standard 3-assertion contract (happy path,
  upstream 401 → QuiqupHttpError, missing auth.userId → Error). Extras:
  - `update_account`: description includes `FIN-05`, `update_bank_details`,
    `get_account` (lockdown of the disambiguation policy as code).
  - `decide_feature_flags_bulk`: MSW captures the outbound body and asserts
    `Identifier === "user_test"`; also asserts
    `spec.inputSchema.shape.Identifier === undefined`.
  - `update_return_settings`: captured URL includes encoded `account_id`; body
    does NOT include `account_id`.
  - `create_account_team_member`: `shape.email` exists; an invalid email fails
    `safeParse`.
- `app/[transport]/route.ts` — new `// -- Phase 1: account + return-settings
  writes + feature flags --` section with 5 imports + 5 `registerTool` calls,
  placed after the Phase-1 reads + ADDR/ORDL blocks and before the M3 writes
  block (route line ordering matches the plan).
- `evals/snapshots/tool-surface.json` — 5 new entries (`create_account_team_member`,
  `decide_feature_flags_bulk`, `get_return_settings`, `update_account`,
  `update_return_settings`), all `enabled`, sorted alphabetically. Total tool
  surface count: 54 → 59. `EVAL_GATE=1 bun run eval:tool-surface` exits 0.

## Verification

| Gate | Result |
|------|--------|
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm vitest run tests/tools/auth-account-writes.test.ts` | 17 passed |
| `EVAL_GATE=1 bun run eval:tool-surface` | exit 0 |
| `pnpm test` (full suite) | 378 passed, 3 skipped, no regressions |

Plan acceptance grep gates (Task 1):

- `grep -c "FIN-05" lib/tools/update-account.ts` → 3 (≥ 1 required).
- `grep -c "update_bank_details" lib/tools/update-account.ts` → 1.
- `grep -c "get_account" lib/tools/update-account.ts` → 1.
- `grep -c "getQuiqupReadyJwt(auth.userId)" lib/tools/update-account.ts` → 1.
- `grep -c '"PUT"' lib/tools/update-account.ts` → 1.

Task 2:

- `grep -c "Identifier" lib/tools/decide-feature-flags-bulk.ts` → 8 (≥ 1).
- `grep -c "auth.userId" lib/tools/decide-feature-flags-bulk.ts` → 5 (≥ 2).
- `grep -c '"Identifier".*args' lib/tools/decide-feature-flags-bulk.ts` → 0.
- `grep -c "/api/accounts/" lib/tools/get-return-settings.ts` → 5.
- `grep -c "/api/accounts/" lib/tools/update-return-settings.ts` → 5.
- `grep -Fc "z.string().email" lib/tools/create-account-team-member.ts` → 1.
- `grep -c "encodeURIComponent" lib/tools/{get,update}-return-settings.ts` → 2.
- `grep -c "getQuiqupReadyJwt(auth.userId)"` on the 4 new files → 1+1+1+1 = 4.

Task 3:

- `grep -c "^describe(" tests/tools/auth-account-writes.test.ts` → 5.
- `grep -c "Identifier" tests/tools/auth-account-writes.test.ts` → 7 (≥ 1).
- `grep -c "FIN-05" tests/tools/auth-account-writes.test.ts` → 4 (≥ 1).
- `registerTool(server, ...)` count in route.ts → 57 (52 pre-plan + 5).
- `jq '.tools | keys | length' evals/snapshots/tool-surface.json` → 59 (54 + 5).

## Deviations from Plan

**1. [Rule 1 — Bug] MSW path-param decoding in update_return_settings test**

- **Found during:** Task 3, first test run.
- **Issue:** The plan’s suggested assertion `expect(params.id).toBe("acct%20123")`
  failed because MSW v2 decodes path-parameter capture groups (`params.id`)
  back to their raw form before exposing them — `params.id === "acct 123"`,
  not `"acct%20123"`. The handler URL itself is correctly percent-encoded.
- **Fix:** Switched the assertion to compare against `request.url` (the
  fully-encoded outbound URL) via the existing `capturedUrl` variable —
  `expect(capturedUrl).toContain("/api/accounts/acct%20123/return-settings")`.
  The intent of the test (lock in that the handler runs `encodeURIComponent`
  on the path segment) is preserved.
- **Files modified:** tests/tools/auth-account-writes.test.ts.
- **Commit:** 7f3696b.

Otherwise: plan executed exactly as written.

## Threat-model follow-ups (from PLAN.md threat register)

### T-01-21 — Bank-detail PII redaction in audit logs

`lib/middleware/pii-redact.ts`'s `ALWAYS_REDACT_KEYS` set does NOT currently
include `bank_iban`, `bank_swift`, `bank_account_number`, or
`bank_account_holder`. Per the plan's stated policy (mitigate via redaction;
log a follow-up rather than block this plan), the audit-redaction expansion
is filed as an out-of-scope TODO:

> **TODO (audit-redaction expansion):** Add `bank_iban`, `bank_swift`,
> `bank_account_number`, `bank_account_holder` to
> `ALWAYS_REDACT_KEYS` in `lib/middleware/pii-redact.ts`. Cross-cutting work
> covering the audit subsystem; not scoped to Phase 1. If/when M6 lands
> guardrails on the Phase-1 write tools, this TODO becomes a blocker for
> `update_account`.

The current Phase-1 tools do NOT set `guardrails` (M6 has not landed), so the
audit middleware does not emit args for these handlers at present — the
disclosure window is therefore zero in practice. The TODO matters only once
guardrails are wired on for Phase-1 writes.

### T-01-22 — Audit coverage gap

Existing pre-condition, not introduced by this plan: the registerTool wrapper
only emits audit records when `spec.guardrails` is set. These 5 writes do
NOT set guardrails (consistent with the rest of the Phase-1 surface; M6 will
wire them on retroactively). Flagged here purely for visibility.

## Self-Check: PASSED

- File `lib/tools/update-account.ts` — FOUND.
- File `lib/tools/decide-feature-flags-bulk.ts` — FOUND.
- File `lib/tools/get-return-settings.ts` — FOUND.
- File `lib/tools/update-return-settings.ts` — FOUND.
- File `lib/tools/create-account-team-member.ts` — FOUND.
- File `tests/tools/auth-account-writes.test.ts` — FOUND.
- File `app/[transport]/route.ts` — MODIFIED (5 imports + 5 registerTool).
- File `evals/snapshots/tool-surface.json` — MODIFIED (54 → 59 entries).
- Commit `f10c28d` (Task 1) — FOUND.
- Commit `ae9480e` (Task 2) — FOUND.
- Commit `7f3696b` (Task 3) — FOUND.
