# State: Quiqup MCP — Full Frontend API Coverage

**Initialized:** 2026-05-19

## Project Reference

- **Core value:** Every backend endpoint that powers Quiqdash v3 must be reachable from an LLM via a single MCP server, with the same auth, the same error semantics, and the same observability as the existing staging-verified tools.
- **Current focus:** Phase 2 — Integrations (Shopify/Salla/WooCommerce + shared surface)

## Current Position

- **current_phase:** 2
- **current_plan:** 02-03 (next)
- **status:** in-progress (Phase 2 Waves 1 + 2 complete; Shopify family landed)
- **progress:** Phase 2: 2/6 plans complete — Salla/WooCommerce/Mintsoft/SBL still pending

```
[██                  ] 12% (Phase 1 complete + Phase 2 2/6 plans)
```

## Performance Metrics

- Phases completed: 1 (Phase 1)
- Plans completed: 6 (01-01..01-04, 02-01, 02-02)
- Requirements shipped (v1): see REQUIREMENTS.md (02-02 adds INTG-07/08/09/10/11/12)
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

### Todos

(none yet — populated by `/gsd:plan-phase 1`)

### Blockers

(none)

## Session Continuity

- **Last session:** 2026-05-19 — completed Plan 02-02 (Shopify integration: 6 tools — INTG-07/08/09/10/11/12). Reads use encodeURIComponent + URLSearchParams; writes carry BL-01 guardrails (rateLimit + idempotency + audit:true); setup_shopify_callback description locks in the single-use OAuth-code warning; update_shopify_connection description marks token SENSITIVE — both pinned by description-quality grep assertions in the 20-test MSW suite. Tool-surface snapshot 64 → 70 enabled, full `pnpm test` green (418/421 — 3 pre-existing skips), `EVAL_GATE=1 bun run eval:tool-surface` clean.
- **Next session:** `/gsd:execute-plan 02-03` (Phase 2 Wave 3 — Salla family).

---
*State initialized: 2026-05-19*
*Last updated: 2026-05-19 (post 02-02 execution — Shopify family complete)*
