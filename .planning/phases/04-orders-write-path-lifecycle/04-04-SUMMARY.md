---
phase: 04-orders-write-path-lifecycle
plan: 04
subsystem: tools (creation + mission orchestration) + multipart codec hoist
tags: [destructive, multipart-csv, mission-gating-asymmetry, row-error-passthrough, multipart-hoist]
dependency_graph:
  requires:
    - 02-05 (canonical destructive-gate helpers)
    - 01-03 (assertOrderBelongsToUser)
    - 03-04 (multipart codec precedent on Orders Core REST — hoisted in this wave)
  provides:
    - "Shared multipart codec at lib/clients/_multipart.ts — Phase-6 third multipart consumer (Fulfilment bulk products) inherits it for free"
    - "Platform requestMultipart method delegating to the shared codec"
    - "create_internal_fulfilment_order (ORDC-04, Platform JSON POST)"
    - "bulk_create_orders (ORDC-05, Platform multipart CSV) — first multipart write on platform-api.quiqup.com"
    - "create_mission (MISS-01, Platform JSON POST) — NOT destructive-gated (D-05)"
    - "transfer_mission_orders (MISS-02, Platform PUT) — DESTRUCTIVE-gated, per-id scope-checked, 50-order cap"
  affects:
    - "lib/clients/orders-core-rest.ts refactored to delegate to the shared codec — Content-Type-omission lockup is now in exactly one place"
    - "Mission-tool gating asymmetry: create=open, transfer=gated. Wave-5 gating-asymmetry-lock scorer locks this at CI"
tech_stack:
  added: []
  patterns:
    - "Multipart codec hoist: lib/clients/_multipart.ts is the single source of truth; both Orders Core REST and Platform clients delegate"
    - "Row-error verbatim passthrough (D-08): upstream's { errors: [{row, error}] } shape surfaces unmodified to the LLM caller — no aggregation, no first-error-wins reduction"
    - "Mission gating asymmetry (D-05): creation tools are not gated (no resource overwritten); state-mutating transfer tools ARE gated"
key_files:
  created:
    - lib/clients/_multipart.ts (shared codec)
    - lib/tools/create-internal-fulfilment-order.ts
    - lib/tools/bulk-create-orders.ts
    - lib/tools/create-mission.ts
    - lib/tools/transfer-mission-orders.ts
    - tests/tools/order-creation.test.ts
    - tests/tools/missions.test.ts
    - .planning/phases/04-orders-write-path-lifecycle/CALL-LOG-wave-04.md
  modified:
    - lib/clients/orders-core-rest.ts (refactored — requestMultipart delegates to shared codec)
    - lib/clients/platform-api.ts (extended — requestMultipart method added)
    - app/[transport]/route.ts (Wave 4 register block + Wave-3 imports auto-fixed under Rule-3)
    - evals/snapshots/tool-surface.json (+4 alphabetically slotted entries)
decisions:
  - "Multipart codec hoisted to lib/clients/_multipart.ts (Task-1 decision). Rationale: Phase 3 added the codec inline to orders-core-rest.ts; Phase 4 Wave 4 needs it on Platform host; Phase 6 will add a third multipart consumer (Fulfilment bulk-validate / bulk-commit). With three consumers in flight the DRY win is clear. Both clients now expose a host-aware requestMultipart method that delegates to the shared helper."
  - "D-05 mission gating asymmetry: create_mission is NOT destructive-gated (pure creation; no resource overwritten). transfer_mission_orders IS gated (state-mutating; sequential per-id scope-check on order_ids; 50-order cap)."
  - "D-08 bulk_create_orders row-error passthrough: upstream's { errors: [{row, error}] } shape surfaces verbatim. No client-side aggregation. Live-staging confirmed the wire shape: { status: error, code: 400, message: { errors: [{row:1, error:[...]}] } }."
  - "transfer_mission_orders: 50-order cap matches the existing batch tools' philosophy of 'rare-by-design'. Source-mission membership not separately checked because tenant-level scope subsumes it (T-04-22 documented reasoning in handler)."
  - "Sandbox / worktree note: an early git stash pop pulled cross-worktree WIP into the working tree (stash refs are shared across linked worktrees). Detected, reverted, and ensured all 7 Wave-4 commits contain only Wave-4 files. The destructive_git_prohibition section explicitly forbids git stash for exactly this reason."
  - "Wave-3 left dangling registerTool calls in app/[transport]/route.ts (4 calls referencing symbols never imported). Wave 4 added the missing 4 import lines under Rule-3 auto-fix so the file compiles — Wave-3 tool implementations not touched. Documented inline in route.ts and in commit 5c7ae8d."
metrics:
  duration: ~16min executor + ~5min orchestrator CALL-LOG
  commits: 7 (be9f17c hoist, 87493c9 RED, 1428755 GREEN ORDC-04/MISS-01, 4a43ce1 GREEN ORDC-05, 5b1d5c1 RED MISS-02, 2f143fd GREEN MISS-02, 5c7ae8d route+snapshot+stub)
  tests_added: 26 (17 order-creation + 9 missions)
  full_suite: 718 passed | 3 skipped (721 total)
  completed: 2026-05-21
---

# Phase 4 Plan 04 Summary

Ship 4 creation + mission tools (`create_internal_fulfilment_order`, `bulk_create_orders` multipart, `create_mission`, `transfer_mission_orders`) and hoist the multipart codec to `lib/clients/_multipart.ts` so the Content-Type-omission lockup lives in exactly one place. Platform `requestMultipart` added.

ORDC-04/05 + MISS-01/02 shipped. Live-staging CALL-LOG confirmed:
- The multipart hoist works on the Platform host (no 415, no Content-Type drift)
- D-08 row-error passthrough is wire-correct (upstream returns `{ errors: [{row:1, error:[...]}] }` verbatim — matches our tool's surface)
- D-05 gating asymmetry locked structurally (create not gated, transfer gated)
