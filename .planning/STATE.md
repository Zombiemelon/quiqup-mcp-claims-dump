# State: Quiqup MCP — Full Frontend API Coverage

**Initialized:** 2026-05-19

## Project Reference

- **Core value:** Every backend endpoint that powers Quiqdash v3 must be reachable from an LLM via a single MCP server, with the same auth, the same error semantics, and the same observability as the existing staging-verified tools.
- **Current focus:** Phase 3 — Orders read path (Orders Core GraphQL + Audit + Ex-core CSV + Quiqup REST history)

## Current Position

- **current_phase:** 3 (in progress — Waves 1+2 shipped)
- **current_plan:** 03-03 (next)
- **status:** Phase 3 Wave 2 complete (2/5 plans shipped — Quiqup REST + Audit clients landed)
- **progress:** Phase 3: 2/5 plans complete — Orders Core GraphQL + Quiqup REST + Audit clients live; ORDL-02/03 + ORDS-02/05 tools shipped

```
[██████              ] 25% (Phase 1 complete + Phase 2 complete + Phase 3 Waves 1+2)
```

## Performance Metrics

- Phases completed: 2 (Phase 1 + Phase 2)
- Plans completed: 12 (01-01..01-04, 02-01..02-06, 03-01, 03-02)
- Requirements shipped (v1): see REQUIREMENTS.md (03-02 adds ORDS-02, ORDS-05 to the shipped set)
- Service-host families with Langfuse eval: 9 (4 Phase-1 + 5 Phase-2). Phase-3 family evals (Orders Core GraphQL, Quiqup REST, Audit) deferred to plan 03-05 per the canonical Phase-N final-wave eval pattern.
- New service hosts introduced this wave: 2 (`api.quiqup.com` — public Quiqup REST, distinct from Last-Mile and Platform; `audit.quiqup.com` — Audit service, SECOND auth-exception host after Google Places)

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

### Todos

(none yet — populated by `/gsd:plan-phase 1`)

### Blockers

(none)

## Session Continuity

- **Last session:** 2026-05-19 — completed Plan 03-01 (Phase 3 Wave 1: Orders Core GraphQL client + ORDL-02/03 read tools). Shipped: new `lib/clients/orders-core-graphql.ts` (POST {baseUrl} JSON envelope, Bearer-JWT auth, QuiqupHttpError on HTTP non-2xx, `errors[]` passthrough on 200 partial-success); two new tool specs (`lib/tools/lookup-orders-ids.ts` for the `ordersListingIdsQuery` "ids only" companion query, `lib/tools/bulk-orders-lookup.ts` for the `bulkOrdersLookupQuery` items+weights re-fetch). MSW client tests (6) cover POST envelope shape, partial-success passthrough, HTTP-error mapping, both env-var overrides, and the staging cluster route. Tool tests (13) cover happy path, variables-envelope forwarding, errors[] surfacing, schema-rejection edge cases (page-size cap 500, ids-array cap 200, orderBy literal lock), missing-auth.userId, and HTTP 401 → QuiqupHttpError. `app/[transport]/route.ts` registers both specs under a Phase-3 comment block; `evals/snapshots/tool-surface.json` records both as `enabled` (86 total tools). Full suite: 527 passed, 3 skipped, 0 regressions. EVAL_GATE=1 bun run eval:tool-surface exits 0.
- **Next session:** `/gsd:execute-phase 3` continues with Plan 03-02 (Quiqup REST history client + Audit client + get_order_history + list_order_audit_events — ORDS-02/05).

---
*State initialized: 2026-05-19*
*Last updated: 2026-05-19 (post 03-01 execution — Phase 3 Wave 1 complete; Orders Core GraphQL client + ORDL-02/03 tools live)*
