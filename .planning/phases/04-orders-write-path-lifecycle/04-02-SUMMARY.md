---
phase: 04-orders-write-path-lifecycle
plan: 02
subsystem: tools (destructive write path — exception transitions + unpool)
tags: [destructive, factory-extension, reason-field, single-id-transition, scope-assertion]
dependency_graph:
  requires:
    - 04-01 (canonical batch-transition factory)
    - 01 (Phase-1 reason-code enumeration tools — list_on_hold_reasons, list_return_to_origin_reasons, list_courier_failure_reasons)
  provides:
    - "5 reason-bearing / non-reason batch transition tools: set_on_hold, set_return_to_origin, set_returned_to_origin, set_delivery_failed, set_collection_failed"
    - "unpool_order single-id PUT tool (ORDT-14) — proves factory's single-id mode"
    - "Factory extension: reasonField support — Zod string + description-pin to Phase-1 list_*_reasons (D-02)"
  affects:
    - "Phase 4 Wave 5 STATIC scorer reason-field-pin asserts ZodString type-name on all 4 reason-bearing tools"
tech_stack:
  added: []
  patterns:
    - "Factory extension via optional config field (reasonField) — backwards-compatible"
    - "Single-id PUT variant in the same factory (unpool_order's /quiqdash/missions/unpool/orders/{UUID})"
    - "Description-pin to the Phase-1 enumeration tool — free-form z.string() schema avoids enum drift (D-02 mirrors Phase-3 03-03 intention precedent)"
key_files:
  created:
    - lib/tools/set-on-hold.ts
    - lib/tools/set-return-to-origin.ts
    - lib/tools/set-returned-to-origin.ts
    - lib/tools/set-delivery-failed.ts
    - lib/tools/set-collection-failed.ts
    - lib/tools/unpool-order.ts
    - tests/tools/batch-transitions-exception-path.test.ts
    - tests/tools/unpool-order.test.ts
    - .planning/phases/04-orders-write-path-lifecycle/CALL-LOG-wave-02.md
    - .planning/phases/04-orders-write-path-lifecycle/deferred-items.md
  modified:
    - lib/tools/_batch-transition-factory.ts (extended with reasonField + single-id mode)
    - app/[transport]/route.ts (Wave 2 register block — 6 tools)
    - evals/snapshots/tool-surface.json (+6 alphabetically slotted entries)
decisions:
  - "Reason field is z.string().min(1) free-form with description naming the Phase-1 list_*_reasons enumeration tool (D-02). z.enum() snapshot rejected — would create drift surface alongside the canonical Phase-1 reason-code list tools."
  - "set_collection_failed uses different URL prefix /quiqdash/courier/orders/... (per REQUIREMENTS.md:117) — factory parameterised on path, so the divergence is per-tool config not a special-case."
  - "unpool_order uses single-id PUT (/quiqdash/missions/unpool/orders/{UUID}). Factory extended with single-id mode rather than a sibling helper — same destructive gate / dry-run / scope-assertion contract applies."
  - "Multiple sibling-wave agents (04-03, 04-04) landed commits during this run. Shared-file conflicts on app/[transport]/route.ts + tool-surface.json resolved by re-applying Wave-2 edits at commit time. The git stash global stack pulled in cross-worktree WIP — restored with git checkout HEAD -- on protected planning files (per executor guard) and on legitimately-committed foreign tool files. Documented as 'parallel-execution coordination encountered' for future phases."
metrics:
  duration: ~16min executor + ~3min orchestrator CALL-LOG
  commits: 4 (aa61489, 53228a4, ccc5c8c, 737ec9c)
  tests_added: 21 (16 exception-path integration + 5 unpool-specific)
  full_suite: 709/721 at 737ec9c (9 failures and 3 skipped were pre-existing Wave-4 RED tests; cleared to 718/721 after Wave 4 GREEN landed)
  completed: 2026-05-21
---

# Phase 4 Plan 02 Summary

Ship 5 exception-path batch transitions (`set_on_hold`, `set_return_to_origin`, `set_returned_to_origin`, `set_delivery_failed`, `set_collection_failed`) plus the single-id `unpool_order`. Factory extended with `reasonField` (D-02) and single-id mode without breaking the 14 Wave-1 factory tests.

ORDT-09..14 shipped. Live-staging CALL-LOG proved all 6 URL paths exist including the `set_collection_failed` `/quiqdash/courier/orders/` divergence and the `unpool_order` `/quiqdash/missions/unpool/orders/{UUID}` single-id endpoint.
