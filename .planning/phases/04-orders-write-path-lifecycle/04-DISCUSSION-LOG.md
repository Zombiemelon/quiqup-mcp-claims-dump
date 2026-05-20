# Phase 4: Orders — Write Path & Lifecycle - Discussion Log

**Date:** 2026-05-20
**Mode:** Interactive discussion (user invoked `/gsd:discuss-phase` explicitly; project default `workflow.skip_discuss: true` overridden for this phase)
**Outcome:** Ready for planning. CONTEXT.md created with 4 user-locked decisions + 4 Claude-discretion decisions.

## Areas Surfaced

Four phase-specific gray areas were surfaced after analysis of the ROADMAP phase goal, REQUIREMENTS.md entries (ORDS/ORDC/ORDT/MISS), the canonical destructive contract established in Phase 2-05, and the closest tool analog (`cancel-lastmile-orders-batch.ts`):

1. Batch transition authoring pattern
2. Reason-code field shape
3. `dry_run` response contract
4. Live-staging CALL-LOG.md batching

User selected ALL FOUR areas for discussion (no skip).

## Decisions

### Area 1 — Batch transition authoring pattern

**Question:** How should the 12 batch status-transition tools be authored?

**Options presented:**
- A. Factory + per-tool override (recommended)
- B. 12 hand-written files

**User selection:** A — Factory + per-tool override.

**Rationale captured:** uniformity-by-convention is what bit Phase 3's `recent-orders.ts` maintenance-comment pattern. A factory makes the destructive contract structurally uniform across all 12 transitions while preserving per-tool description tuning for eval scorers.

### Area 2 — Reason-code field shape

**Question:** How should the `reason` field be typed on the four reason-bearing transitions (`set_on_hold`, `set_return_to_origin`, `set_delivery_failed`, `set_collection_failed`)?

**Options presented:**
- A. `z.string()` free-form + description-pin to Phase-1 `list_*_reasons` (recommended)
- B. `z.enum()` from a hardcoded snapshot

**User selection:** A — `z.string()` free-form + description-pin.

**Rationale captured:** mirrors the Phase-3 03-03 `intention` field precedent. Avoids a second source of truth alongside the Phase-1 reason-code list tools. Bad inputs surface via upstream's structured 200-with-error envelope.

### Area 3 — `dry_run` response contract

**Question:** What should `dry_run` return?

**Options presented:**
- A. Rich: full simulated payload + `dryRun: true` (recommended)
- B. Minimal: `{ affectedCount, orderIds, dryRun: true }`

**User selection:** A — rich simulated payload.

**Rationale captured:** Phase-4 batch transitions move orders between concrete states an agent will then verify via Phase-3 read tools; a preview of the new shape is what lets the LLM verify intent before flipping confirm. Phase-2 minimal shape was sufficient for delete-style destructive tools where the post-state is trivial; Phase-4 transitions need richer feedback. Sets the canonical "rich dry-run" shape for future destructive tools whose post-state is non-trivial (Phase 5/7/10 cascades).

### Area 4 — Live-staging CALL-LOG.md batching

**Question:** How should the AGENTS.md live-staging CALL-LOG.md requirement be batched across 20 tools?

**Options presented:**
- A. One CALL-LOG per wave (recommended)
- B. One CALL-LOG per tool (strict)
- C. One master CALL-LOG per phase

**User selection:** A — one CALL-LOG per wave.

**Rationale captured:** matches how Phase-3 wave summaries already bundle multiple tools. Provides bisect granularity (per-wave) without 20-file scatter. Per-tool sections inside each wave's CALL-LOG.md preserve per-tool audit detail.

## Claude's Discretion (no user input required)

The following implementation choices were locked by Claude during discussion based on existing project patterns. Captured in CONTEXT.md `<decisions>` 5–8:

- Mission-tool destructive gating: `transfer_mission_orders` gated; `create_mission` NOT gated (pure creation).
- `update_fulfilment_order_status`: DESTRUCTIVE-gated (state mutation, undo-undesirable property matches batch transitions).
- Per-order scope assertion strategy: sequential pre-PUT loop (matches `cancel-lastmile-orders-batch.ts` exactly, avoids tripping upstream rate-limit on burst-paralleled assertions).
- `bulk_create_orders` row-error surface: pass upstream per-row errors verbatim to the LLM caller.

## Deferred Ideas

None — no scope-creep raised. Multipart-helper hoist decision (`lib/clients/_multipart.ts` vs duplicate small helper) noted in CONTEXT.md `<specifics>` for the planner.

## Canonical Refs Accumulated

Listed in CONTEXT.md `<canonical_refs>`. Adds `lib/middleware/destructive.ts`, `lib/middleware/scope.ts`, `lib/tools/cancel-lastmile-orders-batch.ts` to the standard ROADMAP/PROJECT/STATE/REQUIREMENTS refs.
