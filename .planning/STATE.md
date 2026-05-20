# State: Quiqup MCP — Full Frontend API Coverage

**Initialized:** 2026-05-19

## Project Reference

- **Core value:** Every backend endpoint that powers Quiqdash v3 must be reachable from an LLM via a single MCP server, with the same auth, the same error semantics, and the same observability as the existing staging-verified tools.
- **Current focus:** Phase 3 — Orders read path (Orders Core GraphQL + Audit + Ex-core CSV + Quiqup REST history)

## Current Position

- **current_phase:** 3 (in progress — Waves 1+2+3+4 shipped)
- **current_plan:** 03-05 (next — Langfuse eval coverage for the 4 new Phase-3 client families)
- **status:** Phase 3 Wave 4 complete (4/5 plans shipped — Ex-core CSV export + Orders Core REST multipart clients added; download_orders_export + upload_order_document tools live)
- **progress:** Phase 3: 4/5 plans complete — Orders Core GraphQL + Quiqup REST + Audit + Ex-core + Orders Core REST clients live; ORDL-02/03/04/05/06/07 + ORDS-02/05/08 tools shipped

```
[████████            ] 30% (Phase 1 complete + Phase 2 complete + Phase 3 Waves 1+2+3+4)
```

## Performance Metrics

- Phases completed: 2 (Phase 1 + Phase 2)
- Plans completed: 14 (01-01..01-04, 02-01..02-06, 03-01, 03-02, 03-03, 03-04)
- Requirements shipped (v1): see REQUIREMENTS.md (03-04 adds ORDL-07, ORDS-08 to the shipped set)
- Service-host families with Langfuse eval: 9 (4 Phase-1 + 5 Phase-2). Phase-3 family evals (Orders Core GraphQL, Quiqup REST, Audit, Platform-API reads, Ex-core, Orders Core REST) deferred to plan 03-05 per the canonical Phase-N final-wave eval pattern.
- New service hosts introduced this wave: 2 (Ex-core at ex-api.quiqup.com via EX_API_BASE_URL family; Orders Core REST at orders-api.quiqup.com via ORDERS_API_BASE_URL family with FE-aligned QUIQUP_ORDERS_GRAPH_URL minus /graph fallback chain)

### Plan Execution Log

| Phase | Plan | Duration | Tasks | Files | Completed |
| ----- | ---- | -------- | ----- | ----- | --------- |
| 01    | 01   | 3m 47s   | 2     | 11    | 2026-05-19 |
| 01    | 02   | ~       | ~     | ~     | 2026-05-19 |
| 01    | 03   | ~12m    | 3     | 8     | 2026-05-19 |
| 01    | 04   | ~10m    | 3     | 8     | 2026-05-19 |
| 02    | 01   | ~25m    | 3     | 8     | 2026-05-19 |
| 02    | 02   | ~10m    | 3     | 9     | 2026-05-19 |
| 02    | 03   | ~25m    | 3     | 9     | 2026-05-19 |
| 02    | 04   | ~20m    | 3     | 9     | 2026-05-19 |
| 02    | 05   | ~15m    | 3     | 6     | 2026-05-19 |
| 02    | 06   | ~25m    | 3     | 17    | 2026-05-19 |
| 03    | 01   | ~10m    | 3     | 6     | 2026-05-19 |
| 03    | 02   | ~15m    | 3     | 6     | 2026-05-19 |
| 03    | 03   | ~3m     | 2     | 5     | 2026-05-20 |
| 03    | 04   | ~10m    | 3     | 10    | 2026-05-20 |

## Accumulated Context

### Decisions

- 2026-05-19: Phase grouping follows service-host families (one phase per family or close cluster) — minimizes infra/client churn within a phase.
- 2026-05-19: Phase 12 ("Eval Coverage Pass") is a dedicated invariant-validation phase rather than spreading evals into each feature phase, because eval authoring benefits from cross-family pattern consistency.
- 2026-05-19: AUTH-07 (`update_account`) and FIN-05 (`update_bank_details`) hit the same PUT /accounts endpoint with different payload constraints — modeled as two distinct tools with disambiguating descriptions; collision resolved during Phase 10 planning.
- 2026-05-19: SRVR-01 / SRVR-02 expose-or-keep-internal decision deferred to Phase 11 plan.
- 2026-05-19 (01-01): Output schemas for the seven Phase-1 read tools left as `z.object({}).passthrough()` — payloads are partner-shape-dependent; tightening risks false rejects when upstream adds fields. M4 will retroactively harden as needed.
- 2026-05-19 (01-01): `get_account_capabilities.id` defaults to `"me"` (matches QuiqDash boot-time call shape); `get_account_by_id.id` has no default so admin/impersonation calls are always explicit.
- 2026-05-19 (01-01): Tool-surface snapshot pre-existing drift (`update_order_waypoint` missing from baseline despite being registered since PR #13) auto-fixed under Rule 3 to unblock EVAL_GATE verification.
- 2026-05-19 (01-04): Evals import production `spec.description` directly (no inline copies) — drift between live tool description and eval-time description is structurally impossible. Replaces the `recent-orders.ts` maintenance-comment pattern.
- 2026-05-19 (01-04): `auth-isolation` scorer in `score-lookup-google-place.ts` strips line + block comments before substring-checking — both `lib/tools/lookup-google-place.ts` and `lib/clients/google-places.ts` legitimately mention `getQuiqupReadyJwt` in header comments to document the auth-exception (the very thing the scorer locks in).
- 2026-05-19 (01-04): New `.github/workflows/eval-gate.yml` is distinct from `evals.yml` (lastmile suite, staging side effects). eval-gate.yml runs tool-surface + the two new family evals; lastmile remains gated in evals.yml to avoid duplicated CI secret usage.
- 2026-05-19 (02-02): `setup_shopify_callback` POSTs with all 3 params (shop_name, code, is_fulfillment) on the QUERY STRING — no JSON body. Description grep-locks the "single-use" OAuth-code warning per T-02-13; test asserts the empty body + absent Content-Type header.
- 2026-05-19 (02-02): `update_shopify_connection.token` marked SENSITIVE in the tool description (T-02-12); audit middleware already redacts the `token` key via ALWAYS_REDACT_KEYS at the at-rest layer; description-quality grep-lock prevents the wording from regressing.
- 2026-05-19 (02-02): `update_shopify_connection` rate limit set to 5/min (matching create_account_team_member privilege-escalation guardrail) — connection-credential mutations should be rare; rapid-fire calls almost certainly indicate misuse.
- 2026-05-19 (02-02): `update_shopify_config.wms_delay_minutes` bounded to [0, 10080] (1 week) per T-02-14 — prevents an LLM from setting an effectively-infinite delay that would freeze WMS pickup.
- 2026-05-19 (02-04): `get_salla_connection` strips upstream `token` field via destructure-and-discard (T-02-29). Locked in by .strict() output schema + canary regression test ("SECRET-TOKEN-DO-NOT-LEAK") + description-pin. Canonical Salla-vs-Shopify difference — Shopify exposes token on update_shopify_connection (merchant input); Salla NEVER exposes token (Quiqup-internal secret).
- 2026-05-19 (02-04): `get_salla_config` returns STRUCTURED `{ config: null, message }` on upstream 404 rather than throwing QuiqupHttpError (T-02-30). 404 here means "no config saved yet" — agent can immediately call `update_salla_config` without parsing an HTTP error. All other non-2xx (401/403/422/5xx) still throw.
- 2026-05-19 (02-04): `update_salla_config.delivery_methods[].service_kind` is z.string() (free-form) with description-pin to `list_service_kinds` (Phase 1 AUTH-08). Per threat-register T-02-33 accept disposition — duplicating the enum would create drift surface for a read-time taxonomy that may grow.
- 2026-05-19 (02-04): INTG-22 (`delete_salla_connection`) deliberately deferred to plan 02-05 — it requires the canonical `confirm:true` destructive gate that the next wave establishes.
- 2026-05-19 (02-05): The canonical destructive-gate helpers (`requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`) ship at `lib/middleware/destructive.ts`. Future destructive tools in Phases 4 (batch status transitions), 6 (cancel_inbound + delete_products), 8 (delete_dispatcher_rule_set), 10 (delete_stripe_payment_method) MUST import these exports rather than re-deriving the contract — uniform LLM behaviour across the destructive surface depends on it.
- 2026-05-19 (02-05): Destructive tools layer auth BEFORE confirm BEFORE dry_run BEFORE upstream call (T-02-37/38/39). `dry_run` cannot bypass `confirm` — to exercise dry-run the caller MUST set `confirm: true` AND `dry_run: true`. Semantic: dry-run is "I have already confirmed; show me what would happen" — not "skip confirm because I'm only previewing".
- 2026-05-19 (02-05): Rate limit on destructive tools set to TIGHT 3/min (matching `cancel_lastmile_orders_batch`) — deletions are irreversible and rare-by-design. Combined with `confirm: true` requirement, a runaway agent cannot sweep connections.
- 2026-05-19 (02-05): MSW request-count assertion on the negative paths (confirm missing / confirm:false / missing auth) proves the gate runs client-side — ZERO upstream traffic on any rejected destructive call.
- 2026-05-19 (02-05): PROJECT.md "Destructive endpoints gated with explicit confirmation parameters" key-decision row can now flip from `[ ]` to `[x]` — flagged for the user to flip in a project-status pass (do NOT flip from inside this plan).
- 2026-05-19 (02-06): Five Langfuse evals shipped — one per Phase-2 sub-family (shared / shopify / woocommerce / salla / destructive). PROJECT.md "Every new service-host family gets at least one Langfuse eval before its tools count as shipped" invariant is satisfied at the sub-family granularity for all of Phase 2.
- 2026-05-19 (02-06): Three new STATIC source-inspection scorer patterns established for Phase 2 onwards (token-omission, four-oh-four-as-null, confirm-gate-present). These are the canonical "lock production invariants at the CI layer" approach — readFile() the source and assert substrings, OR import a helper and assert Zod-instance identity. Future phases with similar must-haves SHOULD reuse this pattern. Mirrors plan 01-04 Task 2 Step B (auth-isolation on lookup-google-place).
- 2026-05-19 (02-06): EVAL_GATE thresholds calibrated per-family — args-overlap 0.7 for shared (8-arg repair tool) and destructive (no-literal-confirm prompt elicitation noise); 0.75 for shopify/woocommerce/salla. All STATIC item-independent scorers (description-quality, sensitive-and-single-use-language, quiqup-vs-woocommerce-state-disambiguation, token-omission, four-oh-four-as-null, confirm-gate-present) pinned at 1.0.
- 2026-05-19 (03-01): Orders Core GraphQL is a NEW service host (`orders-api.quiqup.com/graph` prod, `orders-api.staging.quiqup.com/graph` staging). Canonical client lives at `lib/clients/orders-core-graphql.ts` with `QUIQUP_ORDERS_GRAPH_URL` / `QUIQUP_ORDERS_GRAPH_STAGING_URL` env overrides; every future GraphQL-host tool in this project MUST import from this module rather than re-implementing wire concerns.
- 2026-05-19 (03-01): GraphQL `errors[]` in HTTP 200 responses are returned to the caller verbatim — NOT auto-thrown. Partial-success is a documented GraphQL pattern (spec §7.1) and Relay (used by Quiqdash) treats partial-data + errors as a valid response; auto-throwing would discard data the agent may still want. Tools surface both `data` and `errors` in their text output so the LLM can decide whether the response is actionable. Locked in by the client-level "returns { data, errors } as-is" test and tool-level "surfaces GraphQL errors[]" tests on both ORDL-02 and ORDL-03.
- 2026-05-19 (03-01): The Orders Core GraphQL client deliberately reuses `QuiqupHttpError` and the Clerk → Quiqup session-JWT bearer model — NOT the `google-places.ts` API-key auth exception. Orders Core is a first-party Quiqup service; the auth-exception pattern is reserved for the truly-third-party Google host. Locked in by a `grep -c "X-Goog-Api-Key\|api_key\|apiKey" lib/clients/orders-core-graphql.ts` == 0 acceptance check.
- 2026-05-19 (03-01): `lookup_orders_ids.orderBy.field` is `z.literal("SUBMITTED_AT")` — the Quiqdash frontend hard-codes this; free-string would let an LLM probe undocumented sort fields (threat T-03-04). If Quiqdash extends the enum in future this widens with explicit review.
- 2026-05-19 (03-01): `bulk_orders_lookup.client_order_ids` cap of 200 matches the upstream `bulkOrdersLookupQuery`'s `first: 200` hard-code. Mirroring the cap at the schema layer rejects over-large requests client-side instead of letting them be silently truncated upstream.
- 2026-05-20 (03-03): Phase-3 Wave 3 is a consolidation wave — three Platform-API read tools (`find_order_by_id_or_barcode`, `list_depots`, `list_missions_filter`) reuse the existing `getPlatformApiBaseUrl + getQuiqupReadyJwt + Bearer header + QuiqupHttpError` plumbing. NO new service client introduced. Establishes the "Wave-N consolidation lockup" pattern: when a wave introduces only tools and no new infrastructure, the SUMMARY documents the absence as a deliberate decision.
- 2026-05-20 (03-03): `find_order_by_id_or_barcode.intention` is a free-form `z.string().min(1)` (NOT a `z.enum`) — the upstream BE may add new transitions over time and over-constraining the client would silently break new intentions the moment Quiqup ships them. The description enumerates the observed-set (13 values from `app/hooks/order/use-bulk-change-state.ts`); bad inputs surface via the upstream structured 200-with-error envelope. T-03-19 accept disposition.
- 2026-05-20 (03-03): `list_depots` translates snake_case `main_depot` (MCP-side input field) → camelCase `mainDepot` (upstream wire-format query key) inside the handler. Booleans serialised via `String(args.main_depot)` to produce the literal `"true"`/`"false"` strings Go BE parses. Tested at both layers: schema-rejection of empty values, MSW assertion that the outbound URL carries `mainDepot=true`. Establishes the "wire-format translation testing" pattern for future tools where MCP-side naming diverges from upstream.
- 2026-05-20 (03-03): `find_order_by_id_or_barcode` no-match path is a 200 with `error` populated, NOT an HTTP 4xx — handler returns the upstream envelope verbatim (no exception, no `isError` flag). Rationale: the LLM needs to see the error message to route to the next step (e.g. ask the operator for a different ID); raising an exception would lose that information. T-03-20 accept disposition for the full-envelope read.
- 2026-05-20 (03-04): Canonical binary-response envelope locked in as `{ contentType, base64, filenameHint }` — Phase 5 (PDF labels), Phase 7 (inventory CSV), Phase 10 (Zoho PDFs) MUST reuse this exact shape verbatim rather than re-deriving a per-host envelope. Client layer returns the two-field `{ contentType, base64 }`; tool layer adds `filenameHint`. Ex-core's CSV export is the anchor implementation.
- 2026-05-20 (03-04): Orders Core REST host resolver implements the FE-aligned fallback chain `ORDERS_API_BASE_URL → QUIQUP_ORDERS_GRAPH_URL minus /graph → canonical` (source-doc §1 line 21). Preserves the dev ergonomic where ONE env var (`QUIQUP_ORDERS_GRAPH_URL=https://localhost.test/graph`) redirects BOTH the 03-01 GraphQL client AND this REST client to the same dev host. Per-environment overrides honoured (prod override does not affect staging).
- 2026-05-20 (03-04): `OrdersCoreRestClient.requestMultipart` deliberately omits the `Content-Type` header — fetch() sets `multipart/form-data; boundary=<random>` automatically from the FormData body. Manual override clobbers the boundary and the upstream rejects the body. Locked in by a runtime test that captures the outbound Content-Type and asserts `startsWith("multipart/form-data")` AND `contains("boundary=")`. This is the canonical multipart pattern for any future MCP tool uploading binary payloads.
- 2026-05-20 (03-04): `upload_order_document` (ORDS-08) is the first write tool in Phase 3 — carries the BL-01 canonical guardrails block (rateLimit 10/min, idempotency on idempotency_key with 15min TTL, audit:true) AND structurally omits user_id/actor_id/actor_email from its input schema (BL-04 server-binding — identity bound to auth.userId at handler level). Pre-flight 10MB cap (13_500_000 base64 chars) enforced BEFORE JWT mint AND BEFORE FormData construction so abusive callers cost the MCP nothing upstream.
- 2026-05-20 (03-04): Ex-core gets a SEPARATE ExCoreError class (not QuiqupHttpError reuse) — distinct service host with its own operational backstop, even though the auth bridge is shared. Mirrors QuiqupHttpError's shape (status + body) so callers branch on err.status uniformly. Conversely, Orders Core REST reuses QuiqupHttpError because Orders Core is a Quiqup-prefixed service and the registerTool wrapper's QuiqupHttpError → MCP-error mapping is the desired behaviour. Establishes the policy: NEW service-host families get their own error class; sibling clients of an existing host family reuse the existing class.

### Todos

(none yet — populated by `/gsd:plan-phase 1`)

### Blockers

(none)

## Session Continuity

- **Last session:** 2026-05-20 — completed Plan 03-04 (Phase 3 Wave 4: Ex-core CSV export + Orders Core REST multipart upload — ORDL-07/ORDS-08). Shipped: two NEW service clients (`lib/clients/ex-core.ts` with EX_API_BASE_URL family, `lib/clients/orders-core-rest.ts` with FE-aligned QUIQUP_ORDERS_GRAPH_URL minus /graph fallback chain), two tool specs (`lib/tools/download-orders-export.ts` returning the canonical `{ contentType, base64, filenameHint }` binary envelope, `lib/tools/upload-order-document.ts` carrying BL-01 canonical guardrails + BL-04 server-bound identity + 10MB pre-flight cap + filename hygiene), and three test files (6 ex-core client tests, 6 orders-core-rest client tests, 14 tool tests across 2 describe blocks). `requestMultipart` deliberately omits Content-Type — runtime test locks in the multipart-without-manual-Content-Type contract by asserting the captured Content-Type startsWith multipart/form-data AND contains boundary= parameter. `app/[transport]/route.ts` registers both new tools under a Phase-3 Wave-4 comment block; `evals/snapshots/tool-surface.json` records both as `enabled` (93 total tools, +2 from Wave 3's 91). Full suite: 585 passed, 3 skipped, 0 regressions (+26 vs Wave 3 baseline). `EVAL_GATE=1 bun run eval:tool-surface` exits 0. Commits: `1601297` (Task 1 — Ex-core client + ORDL-07), `69077cd` (Task 2 — Orders Core REST + ORDS-08), `c9e49c5` (Task 3 — tool tests + registration + snapshot).
- **Next session:** `/gsd:execute-phase 3` continues with Plan 03-05 (final Phase-3 wave — Langfuse eval coverage for the 4 new client families + CI gate updates per the canonical Phase-N final-wave eval pattern).

---
*State initialized: 2026-05-19*
*Last updated: 2026-05-20 (post 03-04 execution — Phase 3 Wave 4 complete; Ex-core CSV export + Orders Core REST multipart upload — ORDL-07 + ORDS-08 live)*
