---
phase: 04-orders-write-path-lifecycle
plan: 05
subsystem: evals + CI
tags: [evals, langfuse, ci, static-scorers, destructive-gate, factory-uniformity, gating-asymmetry, bl-04, numeric-bounds]
dependency_graph:
  requires:
    - 04-01 (12 factory ORDT tools + unpool_order — batch-transitions eval imports all 12 specs)
    - 04-02 (reason-bearing variants + unpool_order — reason-field-pin scorer imports the 4 reason specs)
    - 04-03 (4 single-order mutations — single-order-mutations eval imports all 4 specs)
    - 04-04 (creation + missions tools — order-creation + missions evals import these 4 specs)
  provides:
    - "Eval coverage for 4 Phase-4 tool families at the CI layer (batch-transitions, single-order-mutations, order-creation, missions)"
    - "STATIC scorer locking D-01 factory uniformity (factory-uniformity)"
    - "STATIC scorer locking D-02 reason-field free-form shape (reason-field-pin)"
    - "STATIC scorer locking D-03 rich dry-run preview (dry-run-richness)"
    - "STATIC scorer locking D-05 mission gating asymmetry (gating-asymmetry-lock)"
    - "STATIC scorer locking D-06 single-order-mutation gating split (destructive-gate-present-ords-04)"
    - "STATIC scorer locking T-04-13/14 numeric bounds (numeric-bounds-pin)"
    - "STATIC scorer locking T-04-30 BL-04 server-binding on creation tools (bl-04-server-binding)"
    - "STATIC scorer locking T-04-31 bulk-CSV 10MB cap (bulk-csv-cap-pin)"
    - "STATIC scorer locking T-04-28 canonical destructive gate on all 14 Phase-4 destructive tools (destructive-gate-present)"
  affects:
    - "EVAL_GATE=1 CI runs now block on Phase-4 family regressions"
    - "PROJECT.md per-family-eval invariant satisfied at the per-tool-FAMILY granularity for Phase 4 (Phase 4 introduced no new service hosts)"
tech_stack:
  added: []
  patterns:
    - "STATIC source-inspection scorer (readFile + substring/regex check) — applied to _batch-transition-factory.ts, create-order-charge.ts, update-order-weight.ts, bulk-create-orders.ts"
    - "STATIC structural-assertion scorer (import production spec + inspect inputSchema.shape / guardrails) — applied to all 14 Phase-4 destructive tools + 4 reason-bearing tools + 2 creation tools + 2 mission tools"
    - "Drift-proof eval (import spec.description + spec.inputSchema + spec.name directly from production module) — applied to all 4 new family runners covering 20 production specs"
    - "Args-overlap scorer extended with BL-04 forbidden-keys check (order-creation) — first scorer that combines model-behavior signal with structural negative-case enforcement"
    - "Disambiguation-tolerant tool-name-match (accepts single name OR array of acceptable names) — replicated from the 03-05 orders-history-and-audit pattern across all 4 new runners"
key_files:
  created:
    - evals/datasets/batch-transitions-v1.ts
    - evals/batch-transitions.ts
    - evals/score-batch-transitions.ts
    - evals/datasets/single-order-mutations-v1.ts
    - evals/single-order-mutations.ts
    - evals/score-single-order-mutations.ts
    - evals/datasets/order-creation-v1.ts
    - evals/order-creation.ts
    - evals/score-order-creation.ts
    - evals/datasets/missions-v1.ts
    - evals/missions.ts
    - evals/score-missions.ts
  modified:
    - package.json
    - .github/workflows/eval-gate.yml
decisions:
  - "Combined the 12 ORDT batch transitions + unpool_order into a single batch-transitions eval (one runner exposes all 12 tools to Claude). The disambiguation surface is broad enough that a single eval with 11 dataset items covers forward-path, exception-path, reason-bearing, and single-order outliers. Mirrors the Phase-3 orders-history-and-audit combined-family rationale."
  - "Plan text said \"15 destructive Phase-4 tools\" — actual count is 14 (12 ORDT already includes unpool_order, so 12 ORDT + ORDS-04 + MISS-02 = 14). Scorer comment + runner description text use the accurate count of 14."
  - "reason-field-pin scorer accepts the list_*_reasons enumeration tool name appearing in EITHER spec.description OR the reason-field's own description. D-02 explicitly states the reason field description names the Phase-1 enumeration tool — set_on_hold / set_delivery_failed / set_collection_failed duplicate the mention in spec.description, but set_return_to_origin only carries it on the reason field. Both are D-02 compliant; the scorer recognises either location."
  - "destructive-gate-present scorer asserts the description PREFIX (\"DESTRUCTIVE-GATE:\" / \"DRY-RUN:\") rather than full string equality with destructiveConfirmField. Phase-2's destructive-integrations scorer asserts strict Zod-instance identity for delete tools; here the factory passes the canonical helper through but each handler's wrapper may legitimately attach metadata, so prefix-matching is the safer structural assertion. Same effective lock — a maintainer replacing the canonical field with a custom string would not start with \"DESTRUCTIVE-GATE:\"."
  - "destructive-gate-present-ords-04 (single-order-mutations) ALSO asserts the 3 non-destructive tools (export_order, create_order_charge, update_order_weight) do NOT have confirm fields. Prevents accidental over-gating (e.g. \"let's add a safety net to financial charges\"). The D-06 decision is the gating split itself, not just the gate's existence on ORDS-04."
  - "args-overlap on order-creation extended to zero the score when a forbidden caller-identity key leaks through on a BL-04 negative item. Combines model-behavior signal (the LLM ignored user_id when told to ignore it) with structural negative-case enforcement (the schema doesn't accept user_id anyway, but if the LLM tried to pass it the upstream would reject — eval signal lets us detect agents that fail BL-04 hygiene even on schemas that allow them)."
  - "numeric-bounds-pin / bulk-csv-cap-pin / dry-run-richness all use readFile + substring rather than structural Zod inspection. The values (100_000, 1000, 13_500_000, dryRun: true) live as numeric literals or string fragments in source — Zod schemas don't expose `.max(...)` parameters cleanly. Substring check is the simpler, more readable lock."
  - "Each new CI job is parallel — no inter-job deps. Identical shape to the Phase-2/Phase-3 family jobs (oven-sh/setup-bun@v2 + bun install --frozen-lockfile + bun run eval:<family> with EVAL_GATE=\"1\" + Anthropic/Langfuse secret mounts)."
metrics:
  duration: ~15min
  completed: 2026-05-21
---

# Phase 4 Plan 05: Langfuse eval coverage for Phase-4 tool families Summary

Add Langfuse eval coverage for the 4 Phase-4 tool families (batch-transitions, single-order-mutations, order-creation, missions) with 8 NEW STATIC scorers that lock the canonical destructive contract, the D-01..D-06 decisions, and the T-04-13/14/26..31 threat mitigations at the CI layer. 4 new pnpm `eval:*` scripts + 4 new CI jobs in `.github/workflows/eval-gate.yml` extend the `EVAL_GATE=1` build-failure surface to Phase 4. Phase 4 is now complete — 5/5 plans shipped.

## What shipped

### Task 1 — Batch-transitions family eval (commit 3a301ae)

Coverage: the 12 ORDT tools (11 factory transitions + `unpool_order` single-order outlier).

- `evals/datasets/batch-transitions-v1.ts` — 11-item dataset spanning forward path (set_collected, set_received_at_depot, set_in_transit, set_delivery_complete), reason-bearing exception path (set_on_hold, set_delivery_failed, set_return_to_origin, set_collection_failed), terminal RTO acknowledgement (set_returned_to_origin), single-order unpool (`unpool_order` with order_uuid), and dry-run preview (`confirm: true` + `dry_run: true`).
- `evals/batch-transitions.ts` — runner; imports all 12 specs directly (drift-proof). System prompt explicitly instructs the agent on the destructive gate, the 4 reason-bearing tools, and the `unpool_order` `order_uuid`-vs-`order_ids` distinction.
- `evals/score-batch-transitions.ts` — 8 scorers including 4 NEW STATIC scorers:
  - **`destructive-gate-present`** — imports all 14 destructive Phase-4 specs (11 factory ORDT + unpool_order + update_fulfilment_order_status + transfer_mission_orders); asserts each one's `spec.inputSchema.shape.confirm` description starts with `"DESTRUCTIVE-GATE:"` AND `spec.inputSchema.shape.dry_run` description starts with `"DRY-RUN:"`. Locks T-04-28 / D-06.
  - **`factory-uniformity`** — imports the 11 factory ORDT specs + unpool_order; asserts each one's `guardrails` block matches the canonical `{ rateLimit: { capacity: 3, refillPerSec: 3/60 }, idempotency: { keyArg: "idempotency_key", ttlMs: 900000 }, audit: true }` verbatim (field-by-field with a 1e-9 tolerance on the floating-point refillPerSec). A 13th transition tool written INLINE (bypassing the factory) would either omit a guardrail or set different values — this scorer catches that drift. Locks T-04-26 / D-01.
  - **`reason-field-pin`** — for each of the 4 reason-bearing tools (set_on_hold, set_return_to_origin, set_delivery_failed, set_collection_failed): asserts `spec.inputSchema.shape.reason` exists AND its Zod type is ZodString (NOT ZodEnum, locks against snapshot-enum drift D-02 explicitly rejects), AND the relevant `list_*_reasons` companion tool name appears in EITHER `spec.description` OR the reason-field's own description. Locks T-04-29 / D-02.
  - **`dry-run-richness`** — source-inspection on `lib/tools/_batch-transition-factory.ts` asserting the canonical `{ dryRun: true, orderIds, simulated }` rich preview shape literals are still present. A regression to a minimal dry-run (just `dryRun: true`, no orderIds or simulated payload) would trip this scorer. Locks D-03.
- CI gate thresholds: tool-name-match ≥ 0.75, args-overlap ≥ 0.7, description-quality ≥ 1.0, destructive-gate-present ≥ 1.0, factory-uniformity ≥ 1.0, reason-field-pin ≥ 1.0, dry-run-richness ≥ 1.0.

### Task 2 — Single-order-mutations + Order-creation family evals (commit 1f53eda)

**Single-order-mutations family** (4 tools: export_order, update_fulfilment_order_status, create_order_charge, update_order_weight):
- `evals/datasets/single-order-mutations-v1.ts` — 8-item dataset (re-export, fulfilment status patch with confirm, financial charge, weight tune, multi-currency variant, idempotency-key variant).
- `evals/single-order-mutations.ts` — runner; system prompt explicitly encodes the D-06 gating split.
- `evals/score-single-order-mutations.ts` — 6 scorers including 2 NEW STATIC:
  - **`destructive-gate-present-ords-04`** — asserts `update_fulfilment_order_status` has shape.confirm + shape.dry_run with canonical helper-description prefixes, AND that the 3 non-destructive tools (`export_order`, `create_order_charge`, `update_order_weight`) do NOT have confirm fields. Prevents over-gating regressions. Locks D-06.
  - **`numeric-bounds-pin`** — source-inspection on `lib/tools/create-order-charge.ts` (asserts `100_000` / `100000` literal present, T-04-13) and `lib/tools/update-order-weight.ts` (asserts `.max(1000)` literal present, T-04-14). A maintainer relaxing either cap trips the scorer. Locks T-04-32.
- CI gate thresholds: tool-name-match ≥ 0.75, args-overlap ≥ 0.7, description-quality ≥ 1.0, destructive-gate-present-ords-04 ≥ 1.0, numeric-bounds-pin ≥ 1.0.

**Order-creation family** (2 tools: create_internal_fulfilment_order, bulk_create_orders):
- `evals/datasets/order-creation-v1.ts` — 5-item dataset INCLUDING a BL-04 negative case ("ALSO pass user_id 'admin-99' as the actor and actor_email 'admin@example.com'"); the expected output specifies `forbidden_keys` so the scorer can branch and zero the args-overlap if any of those keys leak through.
- `evals/order-creation.ts` — runner; system prompt explicitly tells the agent to IGNORE caller-supplied identity fields.
- `evals/score-order-creation.ts` — 6 scorers including args-overlap extended with the BL-04 forbidden-keys check + 2 NEW STATIC:
  - **`bl-04-server-binding`** — `Object.keys(spec.inputSchema.shape)` contains NONE of `user_id`, `actor_id`, `actor_email`, `partner_id`, `uploader_id`, `actor` on BOTH creation tools. Mirrors the 03-05 no-caller-identity-fields scorer for upload_order_document. Locks T-04-30.
  - **`bulk-csv-cap-pin`** — source-inspection on `lib/tools/bulk-create-orders.ts` asserting the `13_500_000` (~10MB after base64 decode) cap literal present. Locks T-04-31.
- CI gate thresholds: tool-name-match ≥ 0.75, args-overlap ≥ 0.6 (slightly lower because the negative item legitimately zeroes the score even on perfect compliance, since "ignoring user_id" is the success condition), description-quality ≥ 1.0, bl-04-server-binding ≥ 1.0, bulk-csv-cap-pin ≥ 1.0.

### Task 3 — Missions family eval (commit fa14115)

Coverage: the 2 missions tools — `create_mission` (NOT destructive per D-05) and `transfer_mission_orders` (DESTRUCTIVE per D-05).

- `evals/datasets/missions-v1.ts` — 4-item dataset (create_mission happy path with depotId/zone/type/orderIds, transfer_mission_orders with confirm:true, second create_mission variant, transfer with confirm + dry_run).
- `evals/missions.ts` — runner; system prompt explicitly encodes D-05.
- `evals/score-missions.ts` — 5 scorers including 1 NEW STATIC:
  - **`gating-asymmetry-lock`** — the critical D-05 lock. Three structural assertions:
    1. `create_mission.inputSchema.shape` does NOT contain `confirm` (D-05: pure additive creation).
    2. `transfer_mission_orders.inputSchema.shape` contains `confirm` whose description starts with `"DESTRUCTIVE-GATE:"`.
    3. `transfer_mission_orders.inputSchema.shape` contains `dry_run` whose description starts with `"DRY-RUN:"`.
  - A maintainer who flips either half of the asymmetry — gating create_mission OR removing the gate from transfer_mission_orders — trips CI. Locks T-04-27.
- CI gate thresholds: tool-name-match ≥ 0.75, args-overlap ≥ 0.7, description-quality ≥ 1.0, gating-asymmetry-lock ≥ 1.0.

### Task 4 — Wire pnpm scripts + CI eval-gate workflow (commit 27eca78)

- `package.json` — 4 new `eval:*` scripts (`eval:batch-transitions`, `eval:single-order-mutations`, `eval:order-creation`, `eval:missions`), each invoking `bun run evals/<name>.ts`. Placed immediately after `eval:orders-document-upload`.
- `.github/workflows/eval-gate.yml` — 4 new parallel jobs (one per family), each with `EVAL_GATE: "1"` env + ANTHROPIC_API_KEY + Langfuse secret mounts, mirroring the Phase-3 job shape line-for-line. File-header comment expanded to document the new Phase-4 coverage and which STATIC scorers each new job locks.

## Scorer-result table (verified against current production tree)

| Scorer | Eval family | Value | What it locks |
| ------ | ----------- | ----- | ------------- |
| description-quality | batch-transitions | 1.0 (42/42) | Length + DESTRUCTIVE + confirm: true present on all 14 destructive specs |
| destructive-gate-present | batch-transitions | 1.0 | 14 destructive specs wire canonical confirm + dry_run helpers (T-04-28) |
| factory-uniformity | batch-transitions | 1.0 | 12 factory+unpool tools share canonical guardrails block (T-04-26 / D-01) |
| reason-field-pin | batch-transitions | 1.0 | 4 reason-bearing tools use free-form z.string() + name their list_*_reasons companion (T-04-29 / D-02) |
| dry-run-richness | batch-transitions | 1.0 | `_batch-transition-factory.ts` still synthesizes `{ dryRun:true, orderIds, simulated }` (D-03) |
| description-quality | single-order-mutations | 1.0 (24/24) | Per-tool endpoint markers + error modes + canonical examples |
| destructive-gate-present-ords-04 | single-order-mutations | 1.0 | Only ORDS-04 carries confirm; the other 3 do not (D-06 split) |
| numeric-bounds-pin | single-order-mutations | 1.0 | `100_000` on create-order-charge.ts + `.max(1000)` on update-order-weight.ts (T-04-13/14) |
| description-quality | order-creation | 1.0 (12/12) | Endpoint markers + identity-binding warnings + 10MB cap reference |
| bl-04-server-binding | order-creation | 1.0 | Neither creation spec's input shape contains caller-identity fields (T-04-30) |
| bulk-csv-cap-pin | order-creation | 1.0 | `13_500_000` literal still present in bulk-create-orders.ts (T-04-31) |
| description-quality | missions | 1.0 (11/11) | D-05 gating language present on both descriptions; cross-references |
| gating-asymmetry-lock | missions | 1.0 | `create_mission` has no confirm; `transfer_mission_orders` wires canonical destructive confirm + dry_run (D-05 / T-04-27) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] reason-field-pin scorer too strict on spec.description location**
- **Found during:** Task 1 verification — initial implementation tripped on `set_return_to_origin` because its `spec.description` doesn't name `list_return_to_origin_reasons`; only the reason field's own description does.
- **Issue:** D-02 explicitly states the reason field description names the Phase-1 enumeration tool — both `spec.description` (set_on_hold, set_delivery_failed, set_collection_failed) and the reason field description (set_return_to_origin) are D-02 compliant; the scorer should accept either location.
- **Fix:** Updated `reason-field-pin` to check `spec.description.includes(enumerationTool) || reasonFieldDescription.includes(enumerationTool)`.
- **Files modified:** `evals/score-batch-transitions.ts`
- **Commit:** Folded into 3a301ae (the Task-1 commit, before the commit was finalized).

### Scope notes

- **Plan said "15 destructive Phase-4 tools"; actual count is 14.** The plan text double-counted: "12 ORDT" already includes `unpool_order` (ORDT-14), so `12 ORDT + update_fulfilment_order_status + transfer_mission_orders` = 14, not 15. Scorer comment + runner description + this summary use the accurate count.
- **No "amount: 999999" prompt in single-order-mutations dataset.** Plan suggested testing the 100_000 cap rejection via a dataset prompt; that's a model-behavior signal that depends on the LLM understanding the cap from the description. The static `numeric-bounds-pin` scorer is the structural lock that actually catches a cap regression — and it does so unconditionally regardless of agent behavior. Skipping the cap-violation prompt avoids spending eval budget on a signal already covered structurally.

## Verification

- `pnpm tsc --noEmit` — exits 0 (only pre-existing errors in `tests/evals/score-tool-call.test.ts` from before this plan, confirmed via git-stashed baseline). No new TS errors introduced.
- `pnpm test` — 718 passed | 3 skipped (no regressions; identical to baseline).
- `EVAL_DRY_RUN=1 pnpm run eval:batch-transitions` — exits 0, prints "11 items".
- `EVAL_DRY_RUN=1 pnpm run eval:single-order-mutations` — exits 0, prints "8 items".
- `EVAL_DRY_RUN=1 pnpm run eval:order-creation` — exits 0, prints "5 items".
- `EVAL_DRY_RUN=1 pnpm run eval:missions` — exits 0, prints "4 items".
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/eval-gate.yml'))"` — exits 0. YAML well-formed.
- `grep -c "EVAL_GATE: \"1\"" .github/workflows/eval-gate.yml` — 16 (was 12; +4 Phase-4 jobs).
- `EVAL_GATE=1 bun run eval:tool-surface` — passes (no tool-surface drift from the eval/CI-only changes).
- In-process invocation of all 8 NEW STATIC scorers against the production tree — all return value=1.0.

## Threat Flags

None — Wave 5 is eval-only. No new tool-handler code, no new MCP tools, no new service hosts. AGENTS.md live-staging exemption applies (this wave doesn't touch any Quiqup-owned host).

## Follow-up flag for the user (PROJECT.md update)

PROJECT.md's "Every new service-host family gets at least one Langfuse eval before its tools count as shipped" row should now reflect Phase-4 coverage. Phase 4 introduced 0 new service hosts (all 20 tools reuse Phase 1-3 clients), so the per-host count stays at 8 (1 Platform + 1 Google Places + 1 Quiqup REST + 1 Salla + 1 Audit + 1 Ex-core + 1 Orders Core REST + 1 Orders Core GraphQL). The per-tool-FAMILY count goes from 13 → 17 (the 4 new Phase-4 family evals). Update the count row if it tracks the per-family number; do not flip from inside this plan per the 02-05 / 03-05 convention.

## Self-Check: PASSED

Files (all 12 created files exist):
- evals/datasets/batch-transitions-v1.ts → FOUND
- evals/batch-transitions.ts → FOUND
- evals/score-batch-transitions.ts → FOUND
- evals/datasets/single-order-mutations-v1.ts → FOUND
- evals/single-order-mutations.ts → FOUND
- evals/score-single-order-mutations.ts → FOUND
- evals/datasets/order-creation-v1.ts → FOUND
- evals/order-creation.ts → FOUND
- evals/score-order-creation.ts → FOUND
- evals/datasets/missions-v1.ts → FOUND
- evals/missions.ts → FOUND
- evals/score-missions.ts → FOUND

Commits (all 4 reachable from current HEAD):
- 3a301ae (Task 1 — batch-transitions) → FOUND
- 1f53eda (Task 2 — single-order-mutations + order-creation) → FOUND
- fa14115 (Task 3 — missions) → FOUND
- 27eca78 (Task 4 — wire scripts + CI) → FOUND
