---
phase: 04-orders-write-path-lifecycle
plan: 03
subsystem: tools (single-order mutations)
tags: [destructive, single-order, schema-drift-catch, threat-register, numeric-bounds]
dependency_graph:
  requires:
    - 02-05 (canonical destructive-gate helpers)
    - 01-03 (assertOrderBelongsToUser, ScopeViolationError)
    - 01-04 (cancel-lastmile-orders-batch — canonical destructive analog for non-factory tools)
  provides:
    - "4 single-order mutation tools: export_order (ORDS-03), update_fulfilment_order_status (ORDS-04 — destructive), create_order_charge (ORDS-06), update_order_weight (ORDS-07)"
    - "T-04-13 amount cap (max 100_000 AED) on create_order_charge — runaway-charge mitigation"
    - "T-04-14 weight range (0 < kg ≤ 1000) on update_order_weight — absurd-value mitigation"
    - "T-04-15 destructive gate on update_fulfilment_order_status — canonical requireConfirm + destructiveDryRunField + 3/min cap"
  affects:
    - "AGENTS.md schema-drift catch fulfilled: live-staging surfaced that upstream wants weight_kg on the wire, NOT weight (commit 5d1b618 fixes)"
tech_stack:
  added: []
  patterns:
    - "Direct destructive handler (no factory) for non-batch single-order mutations"
    - "Layered guardrails: auth → scope-assertion → upstream"
    - "Live-staging confirms schema drift at the wire layer (AGENTS.md non-negotiable)"
key_files:
  created:
    - lib/tools/export-order.ts
    - lib/tools/update-fulfilment-order-status.ts
    - lib/tools/create-order-charge.ts
    - lib/tools/update-order-weight.ts
    - tests/tools/single-order-mutations.test.ts
    - .planning/phases/04-orders-write-path-lifecycle/CALL-LOG-wave-03.md
decisions:
  - "update_fulfilment_order_status is DESTRUCTIVE-gated (D-06 Claude's discretion). State mutation with the same would-not-want-to-undo property as the batch transitions; same confirm:true + dry_run contract."
  - "create_order_charge.amount: z.number().positive().max(100_000) — T-04-13 mitigates a runaway agent creating a million-AED charge. BE-side validation is the second line of defense per Wave-3 live-staging response."
  - "update_order_weight.weight_kg: z.number().positive().max(1000) — T-04-14 mitigates absurd values (e.g. negative weight, 999999kg). BE-side validation kicks in if input passes our cap."
  - "WIRE-FORMAT DRIFT CAUGHT: update_order_weight initially translated agent-facing weight_kg → wire `weight` (per a stale source-doc assumption). Live-staging CALL-LOG confirmed upstream demands `weight_kg` on the wire too. Commit 5d1b618 fixed both lib/tools/update-order-weight.ts:129 and tests/tools/single-order-mutations.test.ts:646. This is exactly the schema-drift catch AGENTS.md mandates the live CALL-LOG to surface — not a description-only fix."
  - "Deferred: upstream's PATCH /quiqdash/orders/{id}/weight ALSO requires an `items` field per the same 400 response. Whether the BE accepts the PATCH without items (i.e. weight-only updates) is unclear. Logged to deferred-items.md for Phase-4 follow-up."
metrics:
  duration: ~17min executor + ~3min orchestrator CALL-LOG + fix
  commits: 3 (49537ef, 56b6779, 5d1b618 fix)
  tests_added: 21 MSW + 4 schema assertion (single-order-mutations.test.ts)
  full_suite: 718 passed | 3 skipped at 56b6779; 718 passed | 3 skipped after fix 5d1b618
  completed: 2026-05-21
---

# Phase 4 Plan 03 Summary

Ship 4 single-order mutation tools spanning Quiqup REST (`export_order`) and Platform (`update_fulfilment_order_status`, `create_order_charge`, `update_order_weight`). Direct handler implementations (no factory). D-06 destructive gate on `update_fulfilment_order_status` only.

ORDS-03/04/06/07 shipped. Live-staging CALL-LOG **caught a real wire-format bug**: `update_order_weight` was sending `weight` but upstream demands `weight_kg` (confirmed by HTTP 400 with `"weight_kg":["This field is required."]`). Fixed in commit `5d1b618` — full suite still 718 passing.
