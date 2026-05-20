---
phase: 02-integrations
plan: 06
subsystem: integrations / eval-coverage
tags: [evals, langfuse, ci, drift-proof, source-inspection, integrations, shopify, woocommerce, salla, destructive]
requires:
  - 02-01  # shared-integrations substrate (5 tools)
  - 02-02  # Shopify family (6 tools)
  - 02-03  # WooCommerce family (6 tools)
  - 02-04  # Salla family (6 tools)
  - 02-05  # destructive integrations (2 tools)
provides:
  - "evals/integrations-shared.ts — Phase-2 shared-integrations family eval (5 tools)"
  - "evals/shopify-integration.ts — Phase-2 Shopify family eval (6 tools)"
  - "evals/woocommerce-integration.ts — Phase-2 WooCommerce family eval (6 tools)"
  - "evals/salla-integration.ts — Phase-2 Salla family eval (6 tools) + STATIC token-omission + 404-as-null scorers"
  - "evals/destructive-integrations.ts — Phase-2 destructive family eval (2 tools) + STATIC confirm-gate-present scorer"
affects:
  - ".github/workflows/eval-gate.yml (+5 CI jobs)"
  - "package.json (+5 eval:* scripts)"
tech_stack:
  added: []
  patterns:
    - "STATIC source-inspection scorers — readFile() the production tool source and substring-check for canonical invariants. Three new instances established in Phase 2 (token-omission on get-salla-connection.ts, four-oh-four-as-null on get-salla-config.ts, confirm-gate-present that imports destructiveConfirmField + destructiveDryRunField and asserts Zod-instance identity on spec.inputSchema.shape). Mirrors the auth-isolation pattern from plan 01-04 T-01-28. Future phases with similar must-haves SHOULD reuse this pattern."
    - "spec.description drift-proofing — every Phase 2 eval imports the production `spec` directly and the Anthropic tool description text is read from `spec.description` at experiment-run time. No inline string copies anywhere; drift between production tool description and eval-time description is structurally impossible (T-02-49, mirroring plan 01-04 T-01-26)."
    - "Per-family description-quality scorer with substring checklist — each tool's description is asserted to contain its endpoint path, a 401 error mode hint, and its canonical companion-tool reference. EVAL_GATE pins these at 1.0."
    - "Isolated confirm-elicited signal — destructive eval has a per-item scorer that returns 1.0 iff the LLM produced `confirm: <expected>` in its args. Lets the trace-level view distinguish description-elicitation regressions from broader args-overlap dips."
key_files:
  created:
    - evals/datasets/integrations-shared-v1.ts
    - evals/integrations-shared.ts
    - evals/score-integrations-shared.ts
    - evals/datasets/shopify-integration-v1.ts
    - evals/shopify-integration.ts
    - evals/score-shopify-integration.ts
    - evals/datasets/woocommerce-integration-v1.ts
    - evals/woocommerce-integration.ts
    - evals/score-woocommerce-integration.ts
    - evals/datasets/salla-integration-v1.ts
    - evals/salla-integration.ts
    - evals/score-salla-integration.ts
    - evals/datasets/destructive-integrations-v1.ts
    - evals/destructive-integrations.ts
    - evals/score-destructive-integrations.ts
  modified:
    - package.json  # +5 eval:* scripts
    - .github/workflows/eval-gate.yml  # +5 CI jobs (EVAL_GATE: "1" count 3 -> 8)
decisions:
  - "Five evals, not 25 — one per Phase-2 sub-family (shared / shopify / woocommerce / salla / destructive). The source-doc groups Phase 2 tools by these sub-families and each has its own description-quality regression surface, so one eval per sub-family closes the surface without exploding maintenance cost. PROJECT.md 'every new service-host family has at least one Langfuse eval' invariant is satisfied at the sub-family granularity."
  - "STATIC source-inspection scorers are the canonical 'lock production invariants at the CI layer' pattern for Phase 2 onwards. Three new instances established here: token-omission (get-salla-connection.ts) and four-oh-four-as-null (get-salla-config.ts) follow the readFile + substring-check shape; confirm-gate-present follows a stricter Zod-instance identity shape (imports destructiveConfirmField + destructiveDryRunField and asserts `spec.inputSchema.shape.confirm === destructiveConfirmField` on both delete tools). All three are PR-visible — a regression now requires deleting or weakening the scorer alongside the production change."
  - "EVAL_GATE thresholds calibrated per-family — args-overlap is 0.7 for the shared family (repair_integration_orders has 8 required args so one LLM miss tanks per-item scores) and the destructive family (the confirm field elicitation has some noise on the 'no literal confirm in the prompt' case); 0.75 for shopify/woocommerce/salla where the prompt-to-args mapping is tighter. description-quality, token-omission, four-oh-four-as-null, sensitive-and-single-use-language, quiqup-vs-woocommerce-state-disambiguation, and confirm-gate-present are all pinned at 1.0 (these are STATIC item-independent scorers where 'every assertion passes' is the only acceptable state)."
  - "destructive eval is the only Phase-2 eval with two args-overlap variants (the generic one + the isolated confirm-elicited scorer). The isolation lets a maintainer distinguish 'description-elicitation language drift' (confirm-elicited drops) from 'general tool-pick / args quality drift' (args-overlap drops) without manual trace inspection."
metrics:
  duration: ~25m
  completed: 2026-05-19
  tasks: 3
  files_total: 17  # 15 new files + 2 modified (package.json + workflow)
  tests_added: 0   # eval scorers run inside Langfuse, not vitest
  total_test_count: 495 passed (unchanged — eval coverage is additive at the CI layer, not the vitest layer)
---

# Phase 2 Plan 6: Phase-2 Langfuse eval coverage + CI gate Summary

Added Langfuse eval coverage for all 5 Phase-2 service-host sub-families (shared-integrations, Shopify, WooCommerce, Salla, destructive-integrations) and wired all 5 new evals into the CI eval-gate workflow with `EVAL_GATE: "1"`. Three new STATIC source-inspection scorer patterns are now established for Phase 2 onwards: `token-omission` (readFile on get-salla-connection.ts), `four-oh-four-as-null` (readFile on get-salla-config.ts), and `confirm-gate-present` (imports `destructiveConfirmField` + `destructiveDryRunField` and asserts Zod-instance identity on both delete tools' `inputSchema.shape`). Phase 2 now ships with **5/5 family eval coverage** and the PROJECT.md "every new service-host family has at least one Langfuse eval" invariant is satisfied.

Phase 2 is complete.

## What Shipped

### Task 1 — shared / Shopify / WooCommerce family evals (commit `afde6d8`)

9 new files (3 datasets × 7 items, 3 score files, 3 experiment runners) + 3 new `package.json` scripts.

**Shared-integrations (5 tools)** — `evals/integrations-shared.ts` + dataset + 4 scorers (tool-name-match, required-fields-present with per-tool rules, args-overlap, description-quality). Description-quality checklist asserts each of the 5 tool descriptions contains its endpoint path, "401", AND the canonical companion-tool reference (e.g. `get_integration_order` description mentions `repair_integration_orders`). EVAL_GATE: args-overlap ≥ 0.7, description-quality ≥ 1.0.

**Shopify (6 tools)** — `evals/shopify-integration.ts` + dataset + 5 scorers. The 5th is the STATIC `sensitive-and-single-use-language` scorer that asserts `update_shopify_connection` description contains "sensitive" or "secret" (T-02-12) AND `setup_shopify_callback` description contains "single-use" (T-02-13). EVAL_GATE: args-overlap ≥ 0.75, description-quality ≥ 1.0, sensitive-and-single-use-language ≥ 1.0.

**WooCommerce (6 tools)** — `evals/woocommerce-integration.ts` + dataset + 5 scorers. The 5th is the STATIC `quiqup-vs-woocommerce-state-disambiguation` scorer that asserts `list_woocommerce_states` description contains BOTH "quiqup" and "woocommerce" (case-insensitive). description-quality also asserts `upsert_woocommerce_config` description references both `list_woocommerce_states` AND `list_woocommerce_shipping_lines`. EVAL_GATE: args-overlap ≥ 0.75, description-quality ≥ 1.0, quiqup-vs-woocommerce-state-disambiguation ≥ 1.0.

### Task 2 — Salla + destructive family evals with STATIC source-inspection scorers (commit `78c3a9c`)

6 new files (2 datasets × 7/5 items, 2 score files, 2 experiment runners) + 2 new `package.json` scripts.

**Salla (6 tools, 7-item dataset)** — `evals/salla-integration.ts` + dataset + 6 scorers. Two are NEW STATIC source-inspection patterns:

- **`token-omission`** — readFile on `lib/tools/get-salla-connection.ts`; asserts source contains `...connectionSafe`, `token: _token` (the discard binding), AND `JSON.stringify(connectionSafe` on the return path. Locks T-02-29 at the eval layer.
- **`four-oh-four-as-null`** — readFile on `lib/tools/get-salla-config.ts`; asserts source contains `status === 404` AND `config: null`. Locks T-02-30 at the eval layer.

description-quality additionally asserts `update_salla_config` description references `list_service_kinds` (cross-phase T-02-33), `get_salla_config` references `config: null` (T-02-30 documentation contract), and `get_salla_connection` references "token" (T-02-29 documentation contract). EVAL_GATE: args-overlap ≥ 0.75, description-quality ≥ 1.0, token-omission ≥ 1.0, four-oh-four-as-null ≥ 1.0.

**Destructive (2 tools, 5-item dataset)** — `evals/destructive-integrations.ts` + dataset + 5 scorers. Two are NEW patterns:

- **`confirm-elicited`** — per-item; scores 1.0 iff the LLM's output `args.confirm` matches `expected.args.confirm`. Reported SEPARATELY from args-overlap so a regression in the description's confirm-elicitation language (T-02-37) is visible at the trace level even when overall args quality is mostly green.
- **`confirm-gate-present`** — STATIC; imports `destructiveConfirmField` AND `destructiveDryRunField` from `lib/middleware/destructive.ts` and asserts `spec.inputSchema.shape.confirm` AND `spec.inputSchema.shape.dry_run` on BOTH delete tools are the SAME Zod instances as the canonical helpers. 4 identity checks total; score = 1.0 only if all pass. A maintainer cannot rename or detach the gate without simultaneously editing this scorer (T-02-52).

The dataset mixes 4 prompt styles to exercise the confirm-elicitation surface:
1. Explicit "confirm true" prompt → expects `confirm: true`.
2. Dry-run prompt → expects `confirm: true` + `dry_run: true` (T-02-39: dry_run cannot bypass confirm).
3. **No** literal "confirm" word in the prompt → still expects `confirm: true` (tests T-02-37 elicitation contract).
4. "Do not actually delete, just preview" → expects `confirm: true` + `dry_run: true`.

EVAL_GATE: args-overlap ≥ 0.7, confirm-elicited ≥ 0.75, confirm-gate-present ≥ 1.0.

### Task 3 — CI eval-gate wiring (commit `21003b8`)

`.github/workflows/eval-gate.yml`: added 5 new jobs (`integrations-shared`, `shopify-integration`, `woocommerce-integration`, `salla-integration`, `destructive-integrations`) mirroring the existing `get-account` / `lookup-google-place` skeleton (same bun-setup, frozen-lockfile install, same secrets+env block, same `EVAL_GATE: "1"`). Existing 3 jobs (`tool-surface`, `get-account`, `lookup-google-place`) remain unchanged.

EVAL_GATE: "1" line count: **3 → 8** (+5 exactly).

## Drift-Proofing (T-02-49)

All 5 experiment runners build the Anthropic `tools[]` payload by importing the production `spec` from `@/lib/tools/*` and reading `spec.name`, `spec.description`, `z.toJSONSchema(spec.inputSchema)` at run-time. Zero inline string duplication. A maintainer cannot change a tool description in `lib/tools/*.ts` without simultaneously changing the eval-time text — the eval AUTOMATICALLY runs against the new description on the next CI run.

## STATIC Source-Inspection Scorers — The Canonical Pattern

Phase 2 establishes THREE new STATIC source-inspection scorer instances. The pattern is now reusable for Phase 3-11:

| Scorer name | File inspected | Contract | Threat ID |
|-------------|----------------|----------|-----------|
| token-omission | `lib/tools/get-salla-connection.ts` | `...connectionSafe` rest-destructure + `token: _token` discard + `JSON.stringify(connectionSafe)` on return path | T-02-29, T-02-51 |
| four-oh-four-as-null | `lib/tools/get-salla-config.ts` | `status === 404` branch + `config: null` structured response | T-02-30 |
| confirm-gate-present | `lib/middleware/destructive.ts` (import) + 2 delete tool specs (shape identity) | `spec.inputSchema.shape.confirm === destructiveConfirmField` AND `spec.inputSchema.shape.dry_run === destructiveDryRunField` on BOTH delete tools | T-02-52 |

**Why the pattern matters:** these are CI-layer mirrors of must-have production invariants. A maintainer cannot regress the production code without simultaneously deleting/relocating the scorer (which is PR-visible) — and the scorer file lives in `evals/` so the diff is reviewed by humans who know what the assertion locks.

**Future-phase guidance:** any plan whose `must_haves` include "X MUST be true at the production layer" (token strip, structured 404, gate identity, auth isolation, etc.) SHOULD ship with at least one STATIC source-inspection scorer in the family eval. Mirrors plan 01-04 Task 2 Step B (auth-isolation on `lib/tools/lookup-google-place.ts`).

## Phase 2 Family Eval Coverage Summary

| Family | Tools | Dataset items | Scorers | STATIC must-have scorers |
|--------|-------|---------------|---------|--------------------------|
| shared-integrations | 5 | 7 | 4 | description-quality (1.0) |
| shopify-integration | 6 | 7 | 5 | description-quality (1.0) + sensitive-and-single-use-language (1.0) |
| woocommerce-integration | 6 | 7 | 5 | description-quality (1.0) + quiqup-vs-woocommerce-state-disambiguation (1.0) |
| salla-integration | 6 | 7 | 6 | description-quality (1.0) + token-omission (1.0) + four-oh-four-as-null (1.0) |
| destructive-integrations | 2 | 5 | 5 | confirm-elicited (0.75) + confirm-gate-present (1.0) |

5/5 family eval coverage. Phase 12 (Eval Coverage Pass) continues this pattern for Phases 3-11.

## Verification

All from-plan verification steps run green:

```bash
EVAL_DRY_RUN=1 bun run eval:integrations-shared       # 7 items
EVAL_DRY_RUN=1 bun run eval:shopify-integration       # 7 items
EVAL_DRY_RUN=1 bun run eval:woocommerce-integration   # 7 items
EVAL_DRY_RUN=1 bun run eval:salla-integration         # 7 items
EVAL_DRY_RUN=1 bun run eval:destructive-integrations  # 5 items
pnpm tsc --noEmit                                     # clean
pnpm test                                             # 495 passed | 3 skipped
```

Identity check on the confirm-gate-present scorer (smoke-tested via bun):

```
delete_integration_source.confirm === destructiveConfirmField? true
delete_integration_source.dry_run === destructiveDryRunField? true
delete_salla_connection.confirm  === destructiveConfirmField? true
delete_salla_connection.dry_run  === destructiveDryRunField? true
```

YAML linter: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/eval-gate.yml'))"` exits 0.

## Deviations from Plan

None. The plan was executed exactly as written — same 5 datasets, same scorer files, same EVAL_GATE thresholds, same CI job structure. The pre-existing `evals/datasets/integrations-shared-v1.ts` (7 items, already committed before Wave 6 began) was reused without modification per the plan's `read_first` guidance.

## Threat Flags

None — Wave 6 adds offline eval scaffolding only. No new network surface, no new auth paths, no new file-access patterns, no schema changes at trust boundaries. All threat IDs T-02-47 through T-02-53 in the plan's `<threat_model>` are mitigated (47/49 via hand-authored placeholder datasets + drift-proof spec.description imports; 48 via EVAL_GATE grep-asserted 5x in workflow; 50 accepted (description-quality static-substring trade-off); 51 mitigated via the new token-omission scorer; 52 mitigated via the new confirm-gate-present scorer; 53 accepted (confirm-elicited 0.75 threshold calibrated for description-elicitation noise)).

## Self-Check: PASSED

Created files exist:
- `evals/datasets/integrations-shared-v1.ts` ✓
- `evals/integrations-shared.ts` ✓
- `evals/score-integrations-shared.ts` ✓
- `evals/datasets/shopify-integration-v1.ts` ✓
- `evals/shopify-integration.ts` ✓
- `evals/score-shopify-integration.ts` ✓
- `evals/datasets/woocommerce-integration-v1.ts` ✓
- `evals/woocommerce-integration.ts` ✓
- `evals/score-woocommerce-integration.ts` ✓
- `evals/datasets/salla-integration-v1.ts` ✓
- `evals/salla-integration.ts` ✓
- `evals/score-salla-integration.ts` ✓
- `evals/datasets/destructive-integrations-v1.ts` ✓
- `evals/destructive-integrations.ts` ✓
- `evals/score-destructive-integrations.ts` ✓

Commits exist:
- `afde6d8` — Task 1 (shared+Shopify+WooCommerce evals)
- `78c3a9c` — Task 2 (Salla+destructive evals with STATIC source-inspection scorers)
- `21003b8` — Task 3 (CI eval-gate wiring)
