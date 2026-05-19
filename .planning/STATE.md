# State: Quiqup MCP — Full Frontend API Coverage

**Initialized:** 2026-05-19

## Project Reference

- **Core value:** Every backend endpoint that powers Quiqdash v3 must be reachable from an LLM via a single MCP server, with the same auth, the same error semantics, and the same observability as the existing staging-verified tools.
- **Current focus:** Phase 1 — Account, Auth & Reference Data (auth/lookup substrate)

## Current Position

- **current_phase:** 2 (next)
- **current_plan:** 02-01 (next)
- **status:** phase-1-complete (awaiting gsd-verifier)
- **progress:** Phase 1: 4/4 plans complete — phase ready for verifier

```
[█▋                  ] 8% (1/12 phases pending verifier) — Phase 1 4/4 plans
```

## Performance Metrics

- Phases completed: 0 (Phase 1 awaiting verifier)
- Plans completed: 4 (01-01, 01-02, 01-03, 01-04)
- Requirements shipped (v1): see REQUIREMENTS.md (01-04 ships no new REQ-IDs; only eval coverage)
- Service-host families with Langfuse eval: 4 (Platform/lastmile via create_lastmile_order, Fulfilment via baseline, Platform-reads via get_account [new 01-04], Google Places via lookup_google_place [new 01-04])

### Plan Execution Log

| Phase | Plan | Duration | Tasks | Files | Completed |
| ----- | ---- | -------- | ----- | ----- | --------- |
| 01    | 01   | 3m 47s   | 2     | 11    | 2026-05-19 |
| 01    | 02   | ~       | ~     | ~     | 2026-05-19 |
| 01    | 03   | ~12m    | 3     | 8     | 2026-05-19 |
| 01    | 04   | ~10m    | 3     | 8     | 2026-05-19 |

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

### Todos

(none yet — populated by `/gsd:plan-phase 1`)

### Blockers

(none)

## Session Continuity

- **Last session:** 2026-05-19 — completed Plan 01-04 (Langfuse eval coverage for Platform reads + Google Places). 2 new evals (get-account, lookup-google-place), 5 scorers each, new `.github/workflows/eval-gate.yml`. All 378 vitest tests + tsc + dry-runs green. Phase 1 is now 4/4 plans complete — handing off to gsd-verifier.
- **Next session:** Run gsd-verifier on Phase 1 as a whole; then `/gsd:execute-plan 02-01` (Phase 2: Integrations).

---
*State initialized: 2026-05-19*
*Last updated: 2026-05-19 (post 01-04 execution — Phase 1 complete)*
