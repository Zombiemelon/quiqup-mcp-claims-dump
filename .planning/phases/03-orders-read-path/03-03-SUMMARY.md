---
phase: 03-orders-read-path
plan: 03
subsystem: api
tags: [platform-api, read-tools, msw, vitest, mcp, bearer-jwt, clerk-bridge, urlsearchparams, snake-case-to-camel-case]

# Dependency graph
requires:
  - phase: 01-account-auth-reference
    provides: getQuiqupReadyJwt (Clerk → Quiqup actor-token bridge), environmentField + getPlatformApiBaseUrl, QuiqupHttpError reuse pattern, WR-05 env-cleanup convention
  - phase: 02-integrations
    provides: registerTool wrapper, eval-driven-description bar, T-03-18 URLSearchParams hygiene
  - phase: 03-orders-read-path/03-01
    provides: precedent for Phase-3 wave-level read-tool registration
  - phase: 03-orders-read-path/03-02
    provides: WR-05 dual env-var (prod + staging) cleanup convention
provides:
  - "find_order_by_id_or_barcode tool (ORDL-04) — GET /quiqdash/orders/find_by_id_or_barcode. Single-order lookup by clientOrderID or parcel barcode WITH a target-state compatibility intention. Returns the upstream's 200-with-error envelope as-is (no exception thrown on no-match — by design)."
  - "list_depots tool (ORDL-05) — GET /quiqdash/depots. Enumerates depots filtered by region + main/satellite flag. snake_case `main_depot` MCP input → camelCase `mainDepot` wire param translation (locked in by test)."
  - "list_missions_filter tool (ORDL-06) — GET /quiqdash/missions. Autocomplete for the Transfer Mission picker."
  - "orders-platform-reads.test.ts MSW suite — 15 tests across 3 describe blocks: happy-path + URL-query-forwarding (T-03-18) + schema-rejection + auth (T-03-17) + 401-maps-to-QuiqupHttpError."
  - "Snake_case → camelCase wire-translation precedent: where the upstream insists on camelCase (e.g. `mainDepot`), the MCP-side schema uses the rest-of-surface snake_case (`main_depot`) and the handler translates inside URLSearchParams. Tested at both layers (input-schema rejection of empty values + outbound URL-query assertion)."
affects: 03-orders-read-path/03-04..05 (write-path tools that consume the discovery surface), 04-orders-write-path (find→change-state flows)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave-3 consolidation pattern — no new service client introduced; all three tools reuse the existing Platform-API auth+host plumbing (getPlatformApiBaseUrl + getQuiqupReadyJwt + Bearer header + QuiqupHttpError). Confirms the Platform-API surface is a stable foundation."
    - "URL-query forwarding assertion in tests — MSW handler captures request URL, test asserts new URL(request.url).searchParams.get(...) matches expected wire-format key/value. Catches both string-concatenation regressions AND wrong-case (camel vs snake) regressions."
    - "Free-form z.string() with observed-set in description — `intention` on find_order_by_id_or_barcode is a free-form z.string().min(1) (not z.enum) so the BE can add transitions without breaking the client. Observed values are enumerated in the description; bad values surface via the upstream 200-with-error envelope (T-03-19 accept disposition)."
    - "200-with-error contract lock-in — find_order_by_id_or_barcode's no-match path is a 200 with an `error` field populated, NOT an HTTP 4xx. Test asserts the result is returned without isError set (the LLM sees the message and routes accordingly)."

key-files:
  created:
    - lib/tools/find-order-by-id-or-barcode.ts
    - lib/tools/list-depots.ts
    - lib/tools/list-missions-filter.ts
    - tests/tools/orders-platform-reads.test.ts
    - .planning/phases/03-orders-read-path/03-03-SUMMARY.md
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json

key-decisions:
  - "No new service client — Phase-3 Wave-3 is a consolidation wave: all three tools wrap Platform-API endpoints and reuse the existing Clerk → actor-token bridge. Adding a 'Quiqdash client' module would have been over-engineering (the existing one-line `fetch(...)` pattern in get-account.ts is already terse and locally checkable)."
  - "Free-form `intention` rather than z.enum — the upstream BE may add new transitions over time; over-constraining the client would silently break new transitions the moment Quiqup ships them. Description enumerates the observed-set (13 values from app/hooks/order/use-bulk-change-state.ts) as a hint, and the BE's structured 200-with-error envelope handles bad inputs cleanly. T-03-19 accept disposition."
  - "snake_case → camelCase translation lives in the handler, not in the schema — MCP-side users see `main_depot` (matching the surface convention); the upstream wire-format `mainDepot` is an implementation detail. Tested at both ends: input-schema rejects empty `main_depot`, MSW test asserts `mainDepot=true` on the outbound URL."
  - "200-with-error treated as a successful tool call — find_order_by_id_or_barcode returns the upstream envelope verbatim when found_by indicates no match. NOT mapped to an exception. Rationale: the LLM needs to see the error message to route to the next step (e.g. ask the operator for a different ID); raising an exception would lose that information."
  - "Booleans serialised via String() for URLSearchParams — `String(args.main_depot)` produces the literal 'true'/'false' strings that the Go BE parses. URLSearchParams' implicit coercion would actually do the same thing, but the explicit String() makes the intent grep-visible and immune to future TS-narrowing surprises."

patterns-established:
  - "Wave-N consolidation lockup — when a wave introduces only tools (no new clients/services), the SUMMARY documents the absence of new infrastructure as a deliberate decision, not an omission."
  - "Wire-format translation testing — when MCP-side input field naming differs from the upstream wire-format (e.g. snake_case → camelCase, boolean → 'true' string), the test suite must assert BOTH: (a) the MCP input-schema rejects bad values in the MCP-side naming, (b) the outbound query string carries the upstream-naming. Single-layer testing would let half a regression slip through."
  - "Per-tool URL-query forwarding test — every Platform-API read tool gets a 'forwards X as query param' test that captures request.url and asserts each searchParam. Locks in T-03-18 hygiene (URLSearchParams, never string-concat) at the integration layer rather than relying on grep alone."

requirements-completed: [ORDL-04, ORDL-05, ORDL-06]

# Metrics
duration: ~3min
completed: 2026-05-20
---

# Phase 3 Plan 03: Platform read tools — find_order_by_id_or_barcode + list_depots + list_missions_filter Summary

**Three Phase-3 Wave-3 Platform read tools (`find_order_by_id_or_barcode`, `list_depots`, `list_missions_filter`) finish the order-discovery surface. All three wrap a Platform-API GET endpoint, reuse the existing Clerk → Quiqup-ready Bearer-JWT bridge (no new client introduced), build query strings via URLSearchParams (T-03-18 hygiene), and ship eval-bar descriptions naming every documented response field. The 15-test MSW suite locks in URL-query forwarding (including snake_case → camelCase translation on `main_depot` → `mainDepot`), schema-layer rejection of empty required fields, the unauthenticated-caller refusal, and the 401 → QuiqupHttpError mapping.**

## Performance

- **Duration:** ~3 min (Task 1 already committed before this executor run; Task 2 + SUMMARY executed in this session)
- **Completed:** 2026-05-20
- **Tasks:** 2 (Task 1: 3 tool spec modules; Task 2: tests + route registration + snapshot bump + SUMMARY commit)
- **Files created:** 5 (3 tool specs, 1 test suite, 1 SUMMARY)
- **Files modified:** 2 (app/[transport]/route.ts, evals/snapshots/tool-surface.json)
- **Commits:** 2 (`05d2327` Task 1 tools, `e28ff04` Task 2 tests + registration + snapshot)
- **Test count after this plan:** 559 passing (3 skipped) — up from the 527+ baseline noted in the executor context; +15 new tests from this plan, plus growth from earlier-wave contributions captured in the same suite run.

## What Landed

### lib/tools/find-order-by-id-or-barcode.ts (ORDL-04)

- `name: "find_order_by_id_or_barcode"`
- Endpoint: `GET {platformApiBase}/quiqdash/orders/find_by_id_or_barcode`
- Input: `value` (string, ≥1 — clientOrderID or parcel barcode), `intention` (string, ≥1 — target-state intention, free-form by design), `environment`.
- Output: passthrough envelope with optional `error`, `found_by`, `order` (full envelope: 38 named fields in the description).
- Auth: refuses without `auth.userId`; mints session-JWT via `getQuiqupReadyJwt`.
- Errors: 401/403 → `QuiqupHttpError`; 200-with-error → returned to LLM as-is (no exception).

### lib/tools/list-depots.ts (ORDL-05)

- `name: "list_depots"`
- Endpoint: `GET {platformApiBase}/quiqdash/depots`
- Input: `region` (string, ≥1), `main_depot` (boolean), `environment`.
- **Wire-format translation:** snake_case `main_depot` (MCP-side) → camelCase `mainDepot` (upstream). Boolean serialised as the literal string `"true"` / `"false"` via `String(args.main_depot)`.
- Output: passthrough `{ depots: [{...}] }`.
- Auth + error contract identical to find_order_by_id_or_barcode.

### lib/tools/list-missions-filter.ts (ORDL-06)

- `name: "list_missions_filter"`
- Endpoint: `GET {platformApiBase}/quiqdash/missions`
- Input: `value` (string, ≥1 — search prefix), `environment`.
- Output: passthrough `{ results: string[] }` (flat array, autocomplete contract).
- Auth + error contract identical to the other two.

### tests/tools/orders-platform-reads.test.ts

- 3 `describe` blocks, 15 tests total. All pass.
- WR-05 env cleanup: deletes both `QUIQUP_PLATFORM_API_BASE_URL` and `QUIQUP_PLATFORM_API_STAGING_BASE_URL` in `beforeEach`; restores in `afterEach`.
- Per-tool coverage: happy-path, URL-query forwarding (T-03-18 hygiene + camelCase wire-translation for depots), schema rejection of empty required strings, unauthenticated-caller rejection (T-03-17), 401 → QuiqupHttpError mapping.
- `find_order_by_id_or_barcode` has an extra test asserting the 200-with-error envelope is returned as a non-error result (no `isError` flag set).

### app/[transport]/route.ts

- New imports block + register block under a `// -- Phase 3: Orders read path — Platform reads (ORDL-04/05/06) --` comment, placed after the Phase 3 Wave 2 (ORDS-02/05) block.
- `registerTool(server, ...)` count increased by exactly 3.

### evals/snapshots/tool-surface.json

- 3 new entries (`find_order_by_id_or_barcode`, `list_depots`, `list_missions_filter`), all `enabled`.
- Alphabetical sort verified (`diff <actual> <sorted>` produced no output).
- Total tool count: 88 → 91.
- `EVAL_GATE=1 bun run eval:tool-surface` exits 0 — no drift.

## Verification

| Check | Result |
| --- | --- |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm vitest run tests/tools/orders-platform-reads.test.ts` | 15/15 passing |
| `EVAL_GATE=1 bun run eval:tool-surface` | exit 0 (no drift) |
| `pnpm test` (full suite) | 559 passing / 3 skipped / 0 failing |
| Task 1 ACs (getQuiqupReadyJwt count, URLSearchParams count, guardrails count, mainDepot/main_depot grep) | all pass |
| Task 2 ACs (describe blocks, WR-05 cleanup, spec references in route, tools-count delta) | all pass |

## Deviations from Plan

None — plan executed exactly as written. No Rule-1/2/3 auto-fixes were required, and no Rule-4 architectural questions surfaced.

**Note on continuation:** Task 1 was already committed by a prior executor run (`05d2327 feat(03-03): add Platform read tools find/depots/missions (ORDL-04/05/06)`) before this session started; the Wave-2 SUMMARY-commit oversight flagged in the executor prompt was the trigger for re-spawning. This session executed Task 2 cleanly (commit `e28ff04`) and is committing the SUMMARY in the same final docs commit (NOT repeating the Wave-2 mistake).

## Threat Model Coverage

| Threat ID | Mitigation Landed |
| --- | --- |
| T-03-17 (Spoofing — handlers refuse without auth.userId) | mitigated; per-tool "rejects unauthenticated callers" test |
| T-03-18 (Tampering — query-string injection) | mitigated; URLSearchParams used in every handler; per-tool "forwards X as query param" test asserts wire format |
| T-03-19 (Tampering — free-form intention) | accept disposition; rationale documented in description and SUMMARY |
| T-03-20 (Info Disclosure — full order envelope) | accept; upstream-enforced visibility scoping |
| T-03-21 (Info Disclosure — Bearer in logs) | mitigated; no logging of JWT; QuiqupHttpError carries only status + body |
| T-03-22 (DoS — repeated reads) | accept; read-only tools per Phase 1/2 convention |
| T-03-SC (npm install slopsquat risk) | mitigated; no new packages introduced |

## Self-Check: PASSED
- lib/tools/find-order-by-id-or-barcode.ts: FOUND
- lib/tools/list-depots.ts: FOUND
- lib/tools/list-missions-filter.ts: FOUND
- tests/tools/orders-platform-reads.test.ts: FOUND
- Commit 05d2327 (Task 1): FOUND in git log
- Commit e28ff04 (Task 2): FOUND in git log
