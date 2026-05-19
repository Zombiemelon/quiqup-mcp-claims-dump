# State: Quiqup MCP — Full Frontend API Coverage

**Initialized:** 2026-05-19

## Project Reference

- **Core value:** Every backend endpoint that powers Quiqdash v3 must be reachable from an LLM via a single MCP server, with the same auth, the same error semantics, and the same observability as the existing staging-verified tools.
- **Current focus:** Phase 2 — Integrations (Shopify/Salla/WooCommerce + shared surface)

## Current Position

- **current_phase:** 2
- **current_plan:** 02-06 (next)
- **status:** in-progress (Phase 2 Waves 1 + 2 + 3 + 4 + 5 complete; destructive-gate canonical helper landed + INTG-02/22 shipped)
- **progress:** Phase 2: 5/6 plans complete — only Langfuse eval-coverage wave (02-06) remaining

```
[████                ] 20% (Phase 1 complete + Phase 2 5/6 plans)
```

## Performance Metrics

- Phases completed: 1 (Phase 1)
- Plans completed: 9 (01-01..01-04, 02-01, 02-02, 02-03, 02-04, 02-05)
- Requirements shipped (v1): see REQUIREMENTS.md (02-05 adds INTG-02 + INTG-22 — destructive deletes + canonical confirm:true gate)
- Service-host families with Langfuse eval: 4 (Platform/lastmile via create_lastmile_order, Fulfilment via baseline, Platform-reads via get_account, Google Places via lookup_google_place)

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

### Todos

(none yet — populated by `/gsd:plan-phase 1`)

### Blockers

(none)

## Session Continuity

- **Last session:** 2026-05-19 — completed Plan 02-05 (Phase 2 Wave 5: DESTRUCTIVE deletes + canonical confirm:true gate helper). Shipped: `lib/middleware/destructive.ts` (6 exports — `requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`); `delete_integration_source` (INTG-02, DELETE /{source}/delete/{shopName}); `delete_salla_connection` (INTG-22, DELETE /integrations/connections/{id}). Both tools: TIGHT 3/min rate-limit, audit:true, idempotency_key, `dry_run` short-circuit AFTER confirm, encoded path params. 22 helper unit tests + 11 integration tests with MSW request-count assertion proving NO upstream traffic on the negative paths. Tool-surface snapshot 82 → 84 enabled. Full `pnpm test` green (495/498 — 3 pre-existing skips), `EVAL_GATE=1 bun run eval:tool-surface` clean.
- **Next session:** `/gsd:execute-plan 02-06` (Phase 2 Wave 6 — Langfuse eval coverage for 5 Phase-2 sub-families + CI gate updates).

---
*State initialized: 2026-05-19*
*Last updated: 2026-05-19 (post 02-05 execution — destructive deletes + canonical confirm:true gate landed)*
