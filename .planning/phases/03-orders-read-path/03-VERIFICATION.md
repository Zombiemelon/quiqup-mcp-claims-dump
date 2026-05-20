---
phase: 03-orders-read-path
verified: 2026-05-20T05:10:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 3: Orders — Read Path Verification Report

**Phase Goal:** Cover every read-only orders surface (GraphQL lookups, Audit events, Quiqup REST history, Ex-core CSV export, document upload) so agents can inspect any order's full lifecycle without yet mutating it.

**Verified:** 2026-05-20T05:10:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Branch:** claude/add-skip-discuss-config-hIwXh
**Commits verified:** cfdf205..dfb995c (19 commits across waves 03-01..03-05)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + Phase-Level Operational Truths)

| #   | Truth                                                                                                                                                                                  | Status     | Evidence                                                                                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Agent can resolve order IDs in bulk via `lookup_orders_ids` and `bulk_orders_lookup` (Orders Core GraphQL client) and find a single order by ID or barcode via `find_order_by_id_or_barcode`. | VERIFIED | All 3 tool files exist (`lib/tools/lookup-orders-ids.ts` 217 lines, `bulk-orders-lookup.ts` 153, `find-order-by-id-or-barcode.ts` 131). Both GraphQL tools import `OrdersCoreGraphQLClient` from `@/lib/clients/orders-core-graphql` (147 lines). `find_order_by_id_or_barcode` uses Platform API via `getPlatformApiBaseUrl + getQuiqupReadyJwt`. All 3 registered in `app/[transport]/route.ts` lines 117-118, 125, 252-253, 260. |
| 2   | Agent can enumerate depots and missions via `list_depots` and `list_missions_filter`.                                                                                                  | VERIFIED   | `lib/tools/list-depots.ts` (107 lines) + `list-missions-filter.ts` (84 lines) exist; both wire Platform API (`getPlatformApiBaseUrl`) and registered at route.ts:126-127, 261-262.                                                                                                                                                                  |
| 3   | Agent can read an order's full history via `get_order_history` (Quiqup REST client) and its audit-event timeline via `list_order_audit_events` (Audit client with `AUDIT_BASE_URL` env wiring). | VERIFIED | `get-order-history.ts` (88 lines) imports `QuiqupRestClient` from `@/lib/clients/quiqup-rest` (136 lines). `list-order-audit-events.ts` (99 lines) imports `AuditClient` from `@/lib/clients/audit` (138 lines). `AUDIT_BASE_URL` env wiring present at audit.ts:62-65 (production + staging fallbacks). Registered at route.ts:121-122, 256-257. |
| 4   | Agent can download a CSV export of orders via `download_orders_export` (Ex-core client) — CSV returned as base64 per the binary-response contract.                                     | VERIFIED   | `download-orders-export.ts` (164 lines) imports `ExCoreClient` from `@/lib/clients/ex-core` (155 lines). Binary-envelope contract locked by `binary-envelope-contract` static scorer (evals/score-orders-export.ts:166-194) and `csv-date-format-pin` scorer (lines 221-241). Registered at route.ts:130, 265.                                       |
| 5   | Agent can upload a document to an order via `upload_order_document` (multipart against Orders Core REST) and receive the resulting document reference.                                 | VERIFIED   | `upload-order-document.ts` (211 lines) imports `OrdersCoreRestClient` from `@/lib/clients/orders-core-rest` (187 lines). Multipart implementation uses native `FormData` (lines 186-193) and calls `client.requestMultipart("POST", path, fd)` (line 203). Registered at route.ts:131, 266.                                                          |
| 6   | All 9 new tools registered in `app/[transport]/route.ts` and snapshot at 93 enabled.                                                                                                   | VERIFIED   | 9 `registerTool(server, ...)` calls confirmed at route.ts lines 252-253, 256-257, 260-262, 265-266. `evals/snapshots/tool-surface.json` parsed: 93 entries, all `enabled`; all 9 phase-3 tools present with status `enabled`.                                                                                                                        |
| 7   | `audit.ts` is the second auth-exception client (no Bearer header — locked by `audit-no-bearer` scorer).                                                                                | VERIFIED   | audit.ts has NO `Authorization`/`Bearer` references in non-comment code (comment-stripped scan confirmed by replicating the scorer's `stripComments` regex — both substrings = false). `AuditClientOptions` has no `jwt` field (line 78-86). Scorer present at `evals/score-orders-history-and-audit.ts:223-259` and wired into CI gate at `eval-gate.yml:289`. Auth-exception precedent (Google Places) cited in audit.ts header lines 15-20. |
| 8   | 4 new Langfuse evals scaffolded; `EVAL_DRY_RUN=1` runs for each exit 0; 6 static scorers exist.                                                                                        | VERIFIED   | `evals/orders-graphql.ts`, `orders-history-and-audit.ts`, `orders-export.ts`, `orders-document-upload.ts` all run dry-run with exit 0 (orders-graphql-v1 7 items, orders-history-and-audit-v1 7 items, orders-export-v1 5 items, orders-document-upload-v1 6 items). 6 static scorers found by name: `audit-no-bearer`, `audit-exception-header-present`, `binary-envelope-contract`, `csv-date-format-pin`, `no-caller-identity-fields`, `guardrails-block-present`. All 4 evals also wired into `.github/workflows/eval-gate.yml` at jobs `orders-graphql`, `orders-history-and-audit`, `orders-export`, `orders-document-upload` (lines 250-344). |

**Score:** 8/8 truths verified.

### Required Artifacts

| Artifact                                  | Expected                                                  | Status     | Details                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| `lib/clients/orders-core-graphql.ts`      | Orders Core GraphQL client                                | VERIFIED   | 147 lines; imported by lookup-orders-ids.ts, bulk-orders-lookup.ts; substantive (not stub).              |
| `lib/clients/quiqup-rest.ts`              | Quiqup REST client (history)                              | VERIFIED   | 136 lines; imported by get-order-history.ts; reuses Last-Mile Bearer JWT bridge.                         |
| `lib/clients/audit.ts`                    | Audit client (auth-exception, no Bearer)                  | VERIFIED   | 138 lines; imported by list-order-audit-events.ts; no `Authorization`/`Bearer` in non-comment code.      |
| `lib/clients/ex-core.ts`                  | Ex-core CSV export client                                 | VERIFIED   | 155 lines; imported by download-orders-export.ts.                                                        |
| `lib/clients/orders-core-rest.ts`         | Orders Core REST multipart client                         | VERIFIED   | 187 lines; imported by upload-order-document.ts; supports `requestMultipart` via FormData.               |
| `lib/tools/lookup-orders-ids.ts`          | ORDL-02 tool                                              | VERIFIED   | 217 lines; registered route.ts:252.                                                                       |
| `lib/tools/bulk-orders-lookup.ts`         | ORDL-03 tool                                              | VERIFIED   | 153 lines; registered route.ts:253.                                                                       |
| `lib/tools/find-order-by-id-or-barcode.ts`| ORDL-04 tool                                              | VERIFIED   | 131 lines; registered route.ts:260.                                                                       |
| `lib/tools/list-depots.ts`                | ORDL-05 tool                                              | VERIFIED   | 107 lines; registered route.ts:261.                                                                       |
| `lib/tools/list-missions-filter.ts`       | ORDL-06 tool                                              | VERIFIED   | 84 lines; registered route.ts:262.                                                                       |
| `lib/tools/get-order-history.ts`          | ORDS-02 tool                                              | VERIFIED   | 88 lines; registered route.ts:256.                                                                       |
| `lib/tools/list-order-audit-events.ts`    | ORDS-05 tool                                              | VERIFIED   | 99 lines; registered route.ts:257.                                                                       |
| `lib/tools/download-orders-export.ts`     | ORDL-07 tool                                              | VERIFIED   | 164 lines; registered route.ts:265.                                                                       |
| `lib/tools/upload-order-document.ts`      | ORDS-08 tool                                              | VERIFIED   | 211 lines; registered route.ts:266.                                                                       |
| `evals/orders-graphql.ts`                 | Family eval — Orders Core GraphQL                         | VERIFIED   | Dry-run exit 0; wired into eval-gate.yml job `orders-graphql`.                                            |
| `evals/orders-history-and-audit.ts`       | Family eval — Quiqup REST + Audit                         | VERIFIED   | Dry-run exit 0; eval-gate job `orders-history-and-audit`.                                                  |
| `evals/orders-export.ts`                  | Family eval — Ex-core CSV export                          | VERIFIED   | Dry-run exit 0; eval-gate job `orders-export`.                                                            |
| `evals/orders-document-upload.ts`         | Family eval — Orders Core REST multipart                  | VERIFIED   | Dry-run exit 0; eval-gate job `orders-document-upload`.                                                   |
| `evals/snapshots/tool-surface.json`       | Enabled tools snapshot                                    | VERIFIED   | 93 entries, all `enabled`. All 9 new phase-3 tools present.                                               |
| `.github/workflows/eval-gate.yml`         | CI gate updates for Phase-3 evals                         | VERIFIED   | Lines 25-34 document Phase-3 additions; jobs at lines 250-344.                                            |

### Key Link Verification

| From                              | To                                       | Via                                        | Status | Details                                                                                                                   |
| --------------------------------- | ---------------------------------------- | ------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| `lookup-orders-ids.ts`            | `orders-core-graphql.ts`                 | `import { OrdersCoreGraphQLClient }`       | WIRED  | Import + class instantiation present; `client.request(...)` called.                                                       |
| `bulk-orders-lookup.ts`           | `orders-core-graphql.ts`                 | `import { OrdersCoreGraphQLClient }`       | WIRED  | Same pattern.                                                                                                              |
| `get-order-history.ts`            | `quiqup-rest.ts`                         | `import { QuiqupRestClient }`              | WIRED  | `new QuiqupRestClient(...)` + `await client.request(...)` at lines 73, 77.                                                |
| `list-order-audit-events.ts`      | `audit.ts`                               | `import { AuditClient }`                   | WIRED  | Tool imports AuditClient; AuditClient sends NO Authorization header (locked by scorer).                                   |
| `download-orders-export.ts`       | `ex-core.ts`                             | `import { ExCoreClient }`                  | WIRED  | `new ExCoreClient(...)` + `await client.request("GET", "/orders/download", { query })` at lines 117, 132.                |
| `upload-order-document.ts`        | `orders-core-rest.ts`                    | `import { OrdersCoreRestClient }`         | WIRED  | FormData built (lines 186-193); `await client.requestMultipart("POST", path, fd)` at line 203.                            |
| `find-order-by-id-or-barcode.ts`  | Platform API                             | `getPlatformApiBaseUrl + getQuiqupReadyJwt`| WIRED  | Reuses existing Platform-API pattern (no new client — by design, per plan 03-03 must_have #4).                            |
| `list-depots.ts`                  | Platform API                             | `getPlatformApiBaseUrl + getQuiqupReadyJwt`| WIRED  | Same.                                                                                                                      |
| `list-missions-filter.ts`         | Platform API                             | `getPlatformApiBaseUrl + getQuiqupReadyJwt`| WIRED  | Same.                                                                                                                      |
| `app/[transport]/route.ts`        | All 9 tool specs                         | `registerTool(server, spec)`               | WIRED  | 9 explicit registrations confirmed (lines 252-266).                                                                       |
| `eval-gate.yml`                   | 4 Phase-3 family evals                   | `bun run eval:...`                         | WIRED  | Job steps at lines 272, 296, 320, 344.                                                                                    |
| `audit.ts`                        | `AUDIT_BASE_URL` / `AUDIT_STAGING_BASE_URL` env | `process.env.AUDIT_BASE_URL ??`         | WIRED  | Lines 62-65; per-env fallback to canonical AUDIT_BASE_URLS.                                                              |

### Data-Flow Trace (Level 4)

| Artifact                          | Data Variable | Source                                       | Produces Real Data         | Status     |
| --------------------------------- | ------------- | -------------------------------------------- | -------------------------- | ---------- |
| `get-order-history.ts`            | `data`        | `await client.request(method, path)` (Quiqup REST) | Yes — proxies upstream     | FLOWING    |
| `download-orders-export.ts`       | `result`      | `await client.request("GET", "/orders/download", { query })` (Ex-core) | Yes — returns base64 envelope | FLOWING    |
| `upload-order-document.ts`        | `data`        | `await client.requestMultipart("POST", ..., fd)` (Orders Core REST) | Yes — returns upstream document ref | FLOWING    |
| `list-order-audit-events.ts`      | response data | `AuditClient.request("GET", "/events", { query })` (Audit, no auth) | Yes — proxies AUDIT_BASE_URL/events | FLOWING    |
| `lookup-orders-ids.ts` / `bulk-orders-lookup.ts` | GraphQL result | `OrdersCoreGraphQLClient.request(query, variables)` | Yes — surfaces `errors[]` verbatim per plan | FLOWING |
| `find-order-by-id-or-barcode.ts` / `list-depots.ts` / `list-missions-filter.ts` | fetch result | Platform-API `fetch + Bearer JWT` | Yes — existing pattern | FLOWING |

### Behavioral Spot-Checks

| Behavior                                    | Command                                                  | Result                                | Status |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------- | ------ |
| TypeScript compiles clean                   | `pnpm tsc --noEmit`                                      | exit 0, no errors                     | PASS   |
| Full test suite passes (~585)               | `pnpm test`                                              | 60 files, 585 passed / 3 skipped      | PASS   |
| Tool-surface snapshot count                 | parse `evals/snapshots/tool-surface.json`                | 93 enabled                            | PASS   |
| `EVAL_DRY_RUN=1 pnpm eval:orders-graphql`   | `EVAL_DRY_RUN=1 pnpm eval:orders-graphql`                | exit 0; 7 items                       | PASS   |
| `EVAL_DRY_RUN=1 pnpm eval:orders-history-and-audit` | same                                              | exit 0; 7 items                       | PASS   |
| `EVAL_DRY_RUN=1 pnpm eval:orders-export`    | same                                                     | exit 0; 5 items                       | PASS   |
| `EVAL_DRY_RUN=1 pnpm eval:orders-document-upload` | same                                              | exit 0; 6 items                       | PASS   |
| audit-no-bearer property holds              | strip comments from `audit.ts`, scan for "authorization"/"bearer" | both `false`                  | PASS   |

### Probe Execution

| Probe | Command | Result | Status |
| ----- | ------- | ------ | ------ |
| n/a   | n/a     | n/a    | SKIPPED — no `scripts/*/tests/probe-*.sh` files exist in this project; phase does not declare probe-based verification (text mentions of "probe" in PLAN/SUMMARY are unrelated — they refer to threat-model wording about LLMs "probing" undocumented sort fields). |

### Requirements Coverage

| Requirement | Source Plan | Description                                                              | Status    | Evidence                                                                                                                     |
| ----------- | ----------- | ------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| ORDL-02     | 03-01       | `lookup_orders_ids` — `ordersListingIdsQuery` GraphQL                    | SATISFIED | Tool registered; client wired; tests in `tests/tools/orders-graphql-reads.test.ts`; REQUIREMENTS.md line 70 marked `[x]`.    |
| ORDL-03     | 03-01       | `bulk_orders_lookup` — `bulkOrdersLookupQuery` GraphQL                   | SATISFIED | Same test file; REQUIREMENTS.md line 71 marked `[x]`.                                                                        |
| ORDL-04     | 03-03       | `find_order_by_id_or_barcode` — Platform                                  | SATISFIED | Tool registered; tests in `tests/tools/orders-platform-reads.test.ts`; REQUIREMENTS.md line 72 marked `[x]`.                 |
| ORDL-05     | 03-03       | `list_depots` — Platform                                                  | SATISFIED | Same test file; REQUIREMENTS.md line 73 marked `[x]`.                                                                        |
| ORDL-06     | 03-03       | `list_missions_filter` — Platform                                         | SATISFIED | Same test file; REQUIREMENTS.md line 74 marked `[x]`.                                                                        |
| ORDL-07     | 03-04       | `download_orders_export` — Ex-core CSV                                    | SATISFIED | Tests in `tests/tools/orders-export-and-upload.test.ts`; REQUIREMENTS.md line 75 marked `[x]`.                              |
| ORDS-02     | 03-02       | `get_order_history` — Quiqup REST                                         | SATISFIED | Tool + client implemented (commit 93cad4b); tests in `tests/tools/orders-history-and-audit.test.ts`. REQUIREMENTS.md line 85 still shows `[ ]` / "Pending" — see Anti-Patterns: doc drift warning W-1. |
| ORDS-05     | 03-02       | `list_order_audit_events` — Audit (no auth)                               | SATISFIED | Tool + client implemented (commit 1a9435b); audit-no-bearer scorer verifies auth exception. REQUIREMENTS.md line 88 still shows `[ ]` / "Pending" — see W-1. |
| ORDS-08     | 03-04       | `upload_order_document` — Orders Core REST multipart                      | SATISFIED | Tool implemented; tests in `tests/tools/orders-export-and-upload.test.ts`; REQUIREMENTS.md line 91 marked `[x]`.            |

**Orphaned requirements:** None — every requirement claimed by Phase 3 plans matches REQUIREMENTS.md's Phase-3 mapping.

### Anti-Patterns Found

| ID  | File                                                  | Line(s)    | Pattern                                                            | Severity | Impact                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------- | ---------- | ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | `.planning/REQUIREMENTS.md`                           | 85, 88, 345, 348 | ORDS-02 / ORDS-05 still marked `[ ]` / "Pending" in REQUIREMENTS.md even though implementations shipped in commits 93cad4b and 1a9435b (wave 03-02). | Warning  | Documentation drift only — the code is in place, tests pass, tools registered, scorer locked. The REQUIREMENTS.md status lines were missed during the 03-02 commit. Does NOT block phase: implementation matches Success Criteria #3 and the family eval (`orders-history-and-audit`) is wired. Recommend follow-up commit to flip these two checkboxes and the table rows. |

No `TBD` / `FIXME` / `XXX` / `HACK` / placeholder strings found in any of the 14 phase-3 files scanned (5 clients + 9 tools).

### Gaps Summary

No gaps blocking Phase 3 goal achievement. All 5 ROADMAP Success Criteria are observable in the codebase, all 9 tools are registered and wired through to real upstream calls, all 5 new clients exist with the correct auth posture (4 use the Clerk → Quiqup JWT bridge, 1 — `audit.ts` — deliberately uses NO Bearer header, second-ever auth-exception client). 585 tests pass; tsc clean; 93 enabled tools in the snapshot; all 4 family evals dry-run exit 0; all 6 static scorers exist; CI gate updated.

The only flagged item is documentation drift on REQUIREMENTS.md (W-1): ORDS-02 / ORDS-05 status checkboxes were not flipped when wave 03-02 shipped. This is a doc-only inconsistency that does not affect goal achievement, since the implementation, tests, and CI gate all confirm the requirements are satisfied. Recommend a follow-up commit to update REQUIREMENTS.md lines 85, 88, 345, 348 — but Phase 3 is otherwise complete.

---

_Verified: 2026-05-20T05:10:00Z_
_Verifier: Claude (gsd-verifier)_
