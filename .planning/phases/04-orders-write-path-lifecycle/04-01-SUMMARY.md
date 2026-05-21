---
phase: 04-orders-write-path-lifecycle
plan: 01
subsystem: tools (destructive write path — batch transitions)
tags: [destructive, factory, batch-transitions, scope-assertion, dry-run, rate-limit, idempotency]
dependency_graph:
  requires:
    - 02-05 (canonical destructive-gate helpers at lib/middleware/destructive.ts)
    - 01-03 (assertOrderBelongsToUser + ScopeViolationError at lib/middleware/scope.ts)
    - 01-04 (cancel_lastmile_orders_batch — canonical batch-destructive analog)
  provides:
    - "Canonical batch-transition factory (lib/tools/_batch-transition-factory.ts) — single chokepoint for 12 ORDT-* batch tools across Waves 1+2"
    - "Rich dry-run response shape: { dryRun: true, orderIds, ...simulated upstream envelope } locked at factory level (D-03 user-locked decision)"
    - "6 forward-path Wave-1 batch transition tools: set_collected, set_received_at_depot, set_at_depot, set_in_transit, set_scheduled, set_delivery_complete"
  affects:
    - "Phase 4 Wave 2 (04-02) extended the factory for reasonField + single-id mode without breaking the 14 Wave-1 factory tests"
    - "Phase 5/7/10 future destructive tools with non-trivial post-state should reuse the rich dry-run shape (D-03 sets the canonical shape)"
tech_stack:
  added: []
  patterns:
    - "Factory-as-single-chokepoint for repeated destructive tool shapes (D-01)"
    - "Rich dry-run preview with synthesized upstream envelope (D-03)"
    - "Structural grep gates banning inline destructive logic in per-tool wrappers"
    - "TDD: 14 factory unit tests RED → GREEN, then 21 integration tests RED → GREEN"
key_files:
  created:
    - lib/tools/_batch-transition-factory.ts
    - lib/tools/set-collected.ts
    - lib/tools/set-received-at-depot.ts
    - lib/tools/set-at-depot.ts
    - lib/tools/set-in-transit.ts
    - lib/tools/set-scheduled.ts
    - lib/tools/set-delivery-complete.ts
    - tests/tools/_batch-transition-factory.test.ts
    - tests/tools/batch-transitions-happy-path.test.ts
    - .planning/phases/04-orders-write-path-lifecycle/CALL-LOG.md
  modified:
    - app/[transport]/route.ts (Phase 4 Wave 1 register block — 6 new tools)
    - evals/snapshots/tool-surface.json (+6 alphabetically slotted entries)
decisions:
  - "Factory injects the destructive gate, scope-assertion loop, guardrails block, and dry-run branch — per-tool files are pure config (name/path/description). Grep gate on each per-tool file makes the chokepoint structural. A maintainer writing a 13th inline transition tool would fail both the per-tool gate AND the Wave-5 factory-uniformity scorer."
  - "Dry-run returns the full simulated 'batch acknowledged' upstream envelope with top-level dryRun:true + orderIds. Phase-2 minimal shape rejected because batch transitions move orders between concrete states the agent reads back via Phase-3 tools — the LLM needs to preview shape, not just count."
  - "Per-id scope assertion runs sequentially (not Promise.all). The upstream assertOrderBelongsToUser endpoint is rate-limited per-user; burst-paralleling 10 calls would trip the limit before the destructive PUT even reaches the gate."
  - "Live-staging CALL-LOG used the 260520 client_credentials divergence. Proved URL existence (6/6), auth acceptance, body shape, error-envelope stability. The MCP route layer + destructive-gate runtime branch are locked offline by 35 tests across commits 98da37b/690330b/4cbfa2f/a356342."
metrics:
  duration: ~17min executor + ~5min orchestrator CALL-LOG
  commits: 5 (98da37b, 690330b, 4cbfa2f, a356342, bff1cb6)
  tests_added: 35 (14 factory unit + 21 integration)
  full_suite: 634 passed | 3 skipped (637 total) across 63 files at a356342
  completed: 2026-05-20
---

# Phase 4 Plan 01 Summary

Ship the canonical batch-transition factory + 6 forward-path Wave-1 transitions. Honors D-01 (factory pattern) and D-03 (rich dry-run) structurally — per-tool grep gates ban inline destructive logic; behavior tests assert the literal `dryRun: true` + `orderIds` keys in dry-run.

ORDT-03..08 shipped. Wave 2's reasonField + single-id factory extension built on this without breaking the 14 Wave-1 factory tests. Live-staging CALL-LOG confirmed all 6 upstream URLs exist + body shape correct; no schema drift since 260520.
