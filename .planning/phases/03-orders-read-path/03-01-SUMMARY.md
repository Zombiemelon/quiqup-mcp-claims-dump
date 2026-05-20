---
phase: 03-orders-read-path
plan: 01
subsystem: api
tags: [graphql, orders-core, msw, vitest, mcp, bearer-jwt, clerk-bridge]

# Dependency graph
requires:
  - phase: 01-account-auth-reference
    provides: getQuiqupReadyJwt (Clerk → Quiqup actor-token bridge), environmentField + QuiqupEnvironment enum
  - phase: 02-integrations
    provides: registerTool wrapper, QuiqupHttpError error-mapping pattern, WR-05 env-cleanup convention in tests
provides:
  - "OrdersCoreGraphQLClient at lib/clients/orders-core-graphql.ts — canonical GraphQL client for `orders-api.quiqup.com/graph`; every future GraphQL-host tool in this project MUST import from this module."
  - "lookup_orders_ids tool (ORDL-02) — Orders Core GraphQL `ordersListingIdsQuery`. Fetches ONLY the clientOrderIDs of orders matching a where-filter. Cursor pagination; page-size capped at 500; orderBy.field locked to literal SUBMITTED_AT."
  - "bulk_orders_lookup tool (ORDL-03) — Orders Core GraphQL `bulkOrdersLookupQuery`. Re-fetches a bulk set of orders by clientOrderID with item-level weights + parcel barcodes. client_order_ids capped at 200 to mirror the upstream first:200 hard-cap."
  - "Partial-success contract — GraphQL `errors[]` in HTTP 200 responses are returned to the caller verbatim, never auto-thrown. Both tools surface `data` AND `errors` in their text output so the LLM can decide whether the response is actionable."
  - "Env-override wiring — QUIQUP_ORDERS_GRAPH_URL (prod) and QUIQUP_ORDERS_GRAPH_STAGING_URL (staging). Both honoured by getOrdersGraphUrl(); deleted in beforeEach in every test file that touches the host (WR-05)."
affects: 03-orders-read-path/03-02..05, 04-orders-write-path, 05-labels-pdfs (any future tool that hits the Orders Core GraphQL surface imports OrdersCoreGraphQLClient from this module)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Orders Core GraphQL client (new service host) — POST {baseUrl} JSON envelope { query, variables } with Bearer-JWT auth; HTTP non-2xx → QuiqupHttpError; HTTP 200 with errors[] → returned verbatim."
    - "GraphQL partial-success contract — never auto-throw on populated errors[]; tools surface both data and errors in their text output so partial-failure visibility is preserved (spec §7.1, Relay behaviour)."
    - "Inline GraphQL query constants — query strings are file-level constants; LLM-supplied data ONLY reaches the upstream via the variables envelope (threat T-03-08 / GraphQL injection)."
    - "Selection-set parity comment-pin — each tool's GraphQL query comment pins the Quiqdash frontend file it mirrors (orders-listing.query.ts / bulk-orders-lookup.query.ts) because Orders Core treats query text as the response contract."
    - "Service-host distinctness comment block — new client modules open with a header documenting (a) the host is distinct from existing service hosts, (b) the auth model used, (c) why a known exception pattern (google-places API-key) does NOT apply."

key-files:
  created:
    - lib/clients/orders-core-graphql.ts
    - lib/tools/lookup-orders-ids.ts
    - lib/tools/bulk-orders-lookup.ts
    - tests/clients/orders-core-graphql.test.ts
    - tests/tools/orders-graphql-reads.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Orders Core GraphQL is a NEW service host (orders-api.quiqup.com/graph) with its own client module — every future GraphQL-host tool in this project imports from lib/clients/orders-core-graphql.ts rather than re-implementing wire concerns."
  - "GraphQL errors[] in HTTP 200 responses are returned to the caller verbatim, NOT auto-thrown. Partial-success is a documented GraphQL pattern (spec §7.1); Relay (used by Quiqdash) treats partial-data + errors as a valid response."
  - "Bearer-JWT auth reused from quiqup-lastmile.ts — Orders Core is a first-party Quiqup service that accepts the same session-JWT as every other Quiqup egress. The google-places.ts API-key auth-exception is reserved for the truly-third-party Google host."
  - "lookup_orders_ids.orderBy.field is z.literal(\"SUBMITTED_AT\") — the Quiqdash frontend hard-codes this; free-string would let an LLM probe undocumented sort fields (threat T-03-04)."
  - "bulk_orders_lookup.client_order_ids capped at 200 to mirror the upstream bulkOrdersLookupQuery's first:200 hard-cap; over-large requests are rejected client-side instead of silently truncated upstream (threat T-03-03)."

patterns-established:
  - "Inline GraphQL query constant: query strings are file-level `const QUERY = '...'`; LLM-supplied variables only reach the upstream via the GraphQL variables envelope."
  - "Partial-success surfacing: tools JSON.stringify(result) where result = { data, errors? } from the client — never drop the errors array."
  - "Service-host distinctness header comment: new client modules document distinctness from prior hosts, the auth model used, and explicit non-patterns (which known exception is NOT applied here)."
  - "Env-override WR-05 cleanup: every test file that hits a service host with override vars deletes BOTH prod and staging vars in beforeEach so a developer with the var set in their shell does not silently route around MSW."

requirements-completed: [ORDL-02, ORDL-03]

# Metrics
duration: ~10min
completed: 2026-05-19
---

# Phase 3 Plan 01: Orders Core GraphQL — lookup_orders_ids + bulk_orders_lookup Summary

**Orders Core GraphQL client + two read tools — POST orders-api.quiqup.com/graph with Bearer-JWT, partial-success errors[] passthrough, page-size + ids-array caps mirrored from the Quiqdash frontend's hard-coded limits.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-05-19
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 2 (+3 planning docs)

## Accomplishments

- New service-host client at `lib/clients/orders-core-graphql.ts` for `orders-api.quiqup.com/graph` (prod) + `orders-api.staging.quiqup.com/graph` (staging) — POST {baseUrl} JSON envelope with Bearer-JWT auth, QuiqupHttpError on HTTP non-2xx, GraphQL `errors[]` returned verbatim on 200 partial-success.
- Two new GraphQL-shaped read tools registered on the MCP server: `lookup_orders_ids` (ORDL-02 → `ordersListingIdsQuery`) and `bulk_orders_lookup` (ORDL-03 → `bulkOrdersLookupQuery`).
- 19 new tests (6 client-level + 13 tool-level) covering: POST envelope shape, partial-success passthrough, HTTP-error mapping, both env-var overrides, staging-cluster routing, variables-envelope forwarding, errors[] surfacing in tools, schema-rejection edge cases (page-size cap 500, ids-array cap 200, orderBy literal lock), missing-auth.userId, and HTTP 401 → QuiqupHttpError mapping.
- `EVAL_GATE=1 bun run eval:tool-surface` exits 0; both new tools recorded as `enabled` in the alphabetically-sorted snapshot.
- Full test suite green: 527 passed, 3 skipped (was 508 passed before this plan — +19 net tests, 0 regressions).

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement the Orders Core GraphQL client** — `cfdf205` (feat)
2. **Task 2: Implement lookup_orders_ids + bulk_orders_lookup tools** — `3d80c4b` (feat)
3. **Task 3: Route registration + tool-surface snapshot bump** — `9a93110` (feat)

## Files Created/Modified

**Created:**

- `lib/clients/orders-core-graphql.ts` — Orders Core GraphQL client (NEW service host). Exports `ORDERS_GRAPH_URLS`, `getOrdersGraphUrl(env)`, and `OrdersCoreGraphQLClient` class with a single `query<T>(query, variables?)` method covering both ORDL-02 and ORDL-03 (and any future GraphQL-host tool).
- `lib/tools/lookup-orders-ids.ts` — ORDL-02 tool spec. Cursor-paginated; page-size capped at 500; orderBy.field is `z.literal("SUBMITTED_AT")`; where is `z.object({}).passthrough()` so the upstream's OrderWhereInput shape (validated server-side) can absorb fields the doc doesn't enumerate.
- `lib/tools/bulk-orders-lookup.ts` — ORDL-03 tool spec. `client_order_ids: z.array(z.number().int().positive()).min(1).max(200)` mirrors the upstream `first: 200` hard-cap. Translates the flat ids array into the upstream's `where: { clientOrderIDIn: number[] }` shape internally.
- `tests/clients/orders-core-graphql.test.ts` — 6 MSW-mocked client tests.
- `tests/tools/orders-graphql-reads.test.ts` — 13 MSW-mocked tool-level tests (one describe per tool).

**Modified:**

- `app/[transport]/route.ts` — Two new imports + two `registerTool(server, …)` calls under a new `// Phase 3: Orders read path — Orders Core GraphQL family (ORDL-02/03)` comment block.
- `evals/snapshots/tool-surface.json` — Added `bulk_orders_lookup: "enabled"` and `lookup_orders_ids: "enabled"` (alphabetically sorted; total tool count now 86).

## Decisions Made

- **Reuse QuiqupHttpError + Bearer-JWT, do NOT replicate the google-places.ts API-key auth-exception.** Orders Core is a first-party Quiqup service; the auth-exception pattern is reserved for the truly-third-party Google host. Locked in by a `grep -c "X-Goog-Api-Key\|api_key\|apiKey" lib/clients/orders-core-graphql.ts` == 0 acceptance check.
- **Partial-success contract (errors[] passthrough).** HTTP 200 responses with a populated `errors[]` are returned to the caller verbatim, never auto-thrown. Auto-throwing would silently discard `data` the agent may still want; the tool layer surfaces both `data` and `errors` in its text output so the LLM can decide what to do. Locked in by the client-level "returns { data, errors } as-is on populated errors[]" test and the tool-level "surfaces GraphQL errors[]" tests on both ORDL-02 and ORDL-03.
- **orderBy.field literal-locked to `SUBMITTED_AT`** (lookup_orders_ids). The Quiqdash frontend hard-codes this; a free-string would let an LLM probe undocumented sort fields (threat T-03-04). Widens with explicit review if Quiqdash extends the enum.
- **client_order_ids cap at 200** (bulk_orders_lookup). Matches the upstream `bulkOrdersLookupQuery`'s `first: 200` hard-cap so over-large requests are rejected client-side (loud) rather than silently truncated upstream (threat T-03-03).
- **`where` is `z.object({}).passthrough()` not a tight Zod shape.** The full OrderWhereInput type isn't enumerated in the source-doc; over-constraining client-side would lock out fields the FE quietly uses (the Phase-2 BL-01 footgun pattern). Quiqup BE validates the schema upstream; bad fields surface as GraphQL `errors[]` which the agent now sees.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria met; full verification block (pnpm tsc, pnpm vitest target suites, EVAL_GATE eval:tool-surface, full pnpm test) passes.

## Issues Encountered

None.

## Self-Check: PASSED

- `lib/clients/orders-core-graphql.ts` — present
- `lib/tools/lookup-orders-ids.ts` — present
- `lib/tools/bulk-orders-lookup.ts` — present
- `tests/clients/orders-core-graphql.test.ts` — present
- `tests/tools/orders-graphql-reads.test.ts` — present
- Commit `cfdf205` (task 1) — present in `git log --all`
- Commit `3d80c4b` (task 2) — present in `git log --all`
- Commit `9a93110` (task 3) — present in `git log --all`
- `pnpm tsc --noEmit` — exit 0
- `pnpm vitest run tests/clients/orders-core-graphql.test.ts tests/tools/orders-graphql-reads.test.ts` — 19/19 passed
- `EVAL_GATE=1 bun run eval:tool-surface` — exit 0
- `pnpm test` — 527 passed / 3 skipped / 0 regressions

## User Setup Required

None — no external service configuration required. (The new env-var overrides `QUIQUP_ORDERS_GRAPH_URL` and `QUIQUP_ORDERS_GRAPH_STAGING_URL` exist only for test/dev hooks; production uses the canonical URLs.)

## Next Phase Readiness

- The canonical Orders Core GraphQL client is now in place; Plans 03-02..03-05 (Quiqup REST history + Audit + find_order_by_id_or_barcode + Ex-core CSV + multipart upload + Phase-3 family eval) can proceed.
- Future GraphQL-host tools in any later phase MUST import `OrdersCoreGraphQLClient` from `lib/clients/orders-core-graphql.ts` rather than re-implementing wire concerns. The single-chokepoint property is what lets the audit / pii-redact / withMcpAuth pipeline cover this host with no per-tool branching.

---
*Phase: 03-orders-read-path*
*Completed: 2026-05-19*
