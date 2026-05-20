---
phase: 03-orders-read-path
plan: 05
subsystem: evals + CI
tags: [evals, langfuse, ci, static-scorers, auth-exception, binary-envelope, server-binding]
dependency_graph:
  requires:
    - 03-01 (lookup_orders_ids + bulk_orders_lookup ship in Orders Core GraphQL)
    - 03-02 (get_order_history + list_order_audit_events ship across Quiqup REST + Audit)
    - 03-04 (download_orders_export + upload_order_document ship in Ex-core + Orders Core REST)
  provides:
    - "Eval coverage for 4 new Phase-3 service-host families at the CI layer"
    - "STATIC source-inspection scorer for the second-ever auth-exception client (audit.ts)"
    - "STATIC scorer locking the binary-envelope contract for Phase 5/7/10 reuse"
    - "STATIC structural-assertion scorer locking BL-04 server-binding on upload_order_document"
    - "STATIC structural-assertion scorer locking BL-01 canonical guardrails block"
  affects:
    - "EVAL_GATE=1 CI runs now block on Phase-3 family regressions"
    - "PROJECT.md per-family eval invariant is satisfied for Phase 3"
tech_stack:
  added: []
  patterns:
    - "STATIC source-inspection scorer (readFileSync + comment-strip + substring check)"
    - "STATIC structural-assertion scorer (import production spec + inspect inputSchema.shape / guardrails)"
    - "Drift-proof eval (import spec.description + spec.inputSchema + spec.name directly from production module)"
    - "Disambiguation dataset with array-of-acceptable expected tool (orders-history-and-audit)"
    - "Negative dataset item (orders-document-upload smuggle-user_id)"
key_files:
  created:
    - evals/datasets/orders-history-and-audit-v1.ts
    - evals/orders-graphql.ts
    - evals/orders-history-and-audit.ts
    - evals/score-orders-history-and-audit.ts
    - evals/datasets/orders-export-v1.ts
    - evals/orders-export.ts
    - evals/score-orders-export.ts
    - evals/datasets/orders-document-upload-v1.ts
    - evals/orders-document-upload.ts
    - evals/score-orders-document-upload.ts
  modified:
    - evals/datasets/orders-graphql-v1.ts  (existing; runner now imports it)
    - evals/score-orders-graphql.ts        (existing; runner now imports it)
    - package.json
    - .github/workflows/eval-gate.yml
decisions:
  - "Combined Quiqup REST + Audit into a single eval (orders-history-and-audit) because both anchor on order-detail reads and share prompt language — mirrors the Phase-2 sub-family grouping rationale."
  - "audit-no-bearer scorer strips line + block comments BEFORE substring-checking — the audit.ts file header LEGITIMATELY mentions 'Authorization' and 'Bearer' in its AUTH EXCEPTION lockdown block, and a naive substring search would false-positive on the comment that documents the lockdown. Comment-strip approach mirrors the Phase-1 auth-isolation scorer for Google Places."
  - "Disambiguation prompt in orders-history-and-audit-v1.ts uses an ARRAY expected.tool — the runner's tool-name-match scorer was wrapped to accept either a single name or an array, so a reasonable agent pick on the 'state changes AND field edits' prompt scores 1.0 regardless of which tool it chose."
  - "orders-document-upload dataset includes a NEGATIVE prompt where the user asks the agent to pass `user_id` — the args-overlap scorer rewards the agent for IGNORING that field because the tool surface deliberately has no user_id slot (BL-04 server-binding)."
  - "binary-envelope-contract scorer pins ALL THREE keys (contentType + base64 + filenameHint) because Phase 5/7/10 will all reuse this exact shape — locking just one key would let a maintainer silently rename one of the others."
  - "guardrails-block-present scorer asserts the LITERAL keyArg value 'idempotency_key' rather than just presence — a maintainer renaming the arg (e.g. 'idem_key') would silently break idempotency replays for callers; the eval gate now catches that."
  - "Each new CI job is parallel — no inter-job deps. Same shape as the Phase-2 family jobs."
metrics:
  duration: ~25min
  completed: 2026-05-20
---

# Phase 3 Plan 05: Langfuse eval coverage for Phase-3 client families Summary

Add Langfuse eval coverage for every new service-host family introduced in Phase 3 (Orders Core GraphQL, Quiqup REST + Audit combined, Ex-core, Orders Core REST), with STATIC source-inspection and structural-assertion scorers that lock the auth-exception, binary-envelope, and server-binding invariants established in Waves 1-4. 4 new pnpm `eval:*` scripts + 4 new CI jobs in `.github/workflows/eval-gate.yml` extend the EVAL_GATE=1 build-failure surface to Phase 3.

## What shipped

### Task 1 — Orders Core GraphQL + Quiqup REST/Audit family evals (commit 52ea02b)

**Orders Core GraphQL family** (2 tools: lookup_orders_ids, bulk_orders_lookup):
- `evals/orders-graphql.ts` — runner; imports spec.description / spec.inputSchema / spec.name directly from both production modules (drift-proof).
- `evals/score-orders-graphql.ts` — pre-existing scorers (tool-name-match, required-fields-present, args-overlap, description-quality) now invoked by the new runner.
- `evals/datasets/orders-graphql-v1.ts` — pre-existing 7-item dataset; spans the disambiguation surface (ID-only listing vs. bulk weights/barcodes lookup, page cursors, source filters).
- CI gate thresholds: tool-name-match ≥ 0.75, args-overlap ≥ 0.7, description-quality ≥ 1.0.

**Quiqup REST + Audit family** (2 tools, combined eval: get_order_history, list_order_audit_events):
- `evals/datasets/orders-history-and-audit-v1.ts` — 7-item dataset with one disambiguation prompt using `expected.tool: [...]` array.
- `evals/orders-history-and-audit.ts` — runner with array-of-acceptable tool name handling.
- `evals/score-orders-history-and-audit.ts` — 6 scorers including two STATIC source-inspection scorers:
  - **`audit-no-bearer`** — `readFile('lib/clients/audit.ts')` + strip line + block comments + assert ZERO occurrences of "authorization" / "bearer" (case-insensitive) in the comment-stripped source. Mirrors the Phase-1 auth-isolation scorer for Google Places + the Phase-2 token-omission scorer for Salla.
  - **`audit-exception-header-present`** — `readFile('lib/clients/audit.ts')` + assert literal "AUTH EXCEPTION" substring present. Documents design intent without locking exact comment wording.
- CI gate thresholds: tool-name-match ≥ 0.75, args-overlap ≥ 0.7, description-quality ≥ 1.0, audit-no-bearer ≥ 1.0, audit-exception-header-present ≥ 1.0.

### Task 2 — Ex-core + Orders Core REST family evals (commit 32b909f)

**Ex-core family** (1 tool: download_orders_export):
- `evals/datasets/orders-export-v1.ts` — 5-item dataset spanning date-range exports, order-id-filtered exports, and explicit per_page knobs (all using yyyy-mm-dd dates).
- `evals/orders-export.ts` — single-tool runner with local `const spec = downloadOrdersExportSpec` so `spec.description` / `spec.inputSchema` literals appear in the file (satisfies the drift-proofing grep gate).
- `evals/score-orders-export.ts` — 6 scorers including two STATIC source-inspection scorers:
  - **`binary-envelope-contract`** — `readFile('lib/tools/download-orders-export.ts')` + assert ALL THREE substrings ("contentType", "base64", "filenameHint") present. Locks the binary envelope shape for Phase 5 (PDF labels), Phase 7 (inventory CSV), and Phase 10 (Zoho PDFs) reuse.
  - **`csv-date-format-pin`** — `readFile('lib/tools/download-orders-export.ts')` + assert the literal `\d{4}-\d{2}-\d{2}` regex fragment present. WR-02 lesson: upstream uses yyyy-mm-dd, not full ISO-8601 — "modernization" to ISO-8601 trips this scorer.
- CI gate thresholds: tool-name-match ≥ 0.9, args-overlap ≥ 0.75, description-quality ≥ 1.0, binary-envelope-contract ≥ 1.0, csv-date-format-pin ≥ 1.0.

**Orders Core REST family** (1 tool: upload_order_document):
- `evals/datasets/orders-document-upload-v1.ts` — 6-item dataset including a NEGATIVE prompt where the user explicitly asks to pass `user_id` — the agent is rewarded for ignoring that field.
- `evals/orders-document-upload.ts` — single-tool runner; system prompt explicitly instructs the agent to ignore caller-supplied identity fields.
- `evals/score-orders-document-upload.ts` — 6 scorers including two STATIC structural-assertion scorers (import production spec, inspect `inputSchema.shape` / `guardrails`):
  - **`no-caller-identity-fields`** — assert `Object.keys(spec.inputSchema.shape)` contains NONE of `user_id`, `actor_id`, `actor_email`, `partner_id`, `uploader_id`, `actor`. Locks BL-04 server-binding. Mirrors the confirm-gate-present pattern from `score-destructive-integrations.ts`.
  - **`guardrails-block-present`** — assert `spec.guardrails.audit === true`, `spec.guardrails.idempotency.keyArg === "idempotency_key"`, `spec.guardrails.rateLimit.capacity > 0`. Locks BL-01 canonical write-tool guardrails block.
- CI gate thresholds: tool-name-match ≥ 0.9, args-overlap ≥ 0.7, description-quality ≥ 1.0, no-caller-identity-fields ≥ 1.0, guardrails-block-present ≥ 1.0.

### Task 3 — Wire scripts + CI workflow (commit cddef8d)

- `package.json` — 4 new `eval:*` scripts added immediately after `eval:destructive-integrations`.
- `.github/workflows/eval-gate.yml` — 4 new parallel CI jobs, each with `EVAL_GATE: "1"` env, same Anthropic + Langfuse secret mount as the Phase-2 family jobs. File-header comment updated to document Phase-3 coverage.

## Verification

- `pnpm tsc --noEmit` → 0 errors.
- `EVAL_DRY_RUN=1 pnpm run eval:orders-graphql` → exit 0 (7 items).
- `EVAL_DRY_RUN=1 pnpm run eval:orders-history-and-audit` → exit 0 (7 items).
- `EVAL_DRY_RUN=1 pnpm run eval:orders-export` → exit 0 (5 items).
- `EVAL_DRY_RUN=1 pnpm run eval:orders-document-upload` → exit 0 (6 items).
- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/eval-gate.yml'))"` → exit 0 (YAML well-formed).
- `pnpm test` → 585 passed | 3 skipped (62 test files, 11.00s).
- All 6 new STATIC scorers verified to return value=1.0 against current production source:
  - audit-no-bearer: "audit.ts (sans comments) is free of Authorization/Bearer references — auth-exception holds"
  - audit-exception-header-present: "lib/clients/audit.ts contains the AUTH EXCEPTION header"
  - binary-envelope-contract: "download-orders-export.ts wires the canonical { contentType, base64, filenameHint } envelope"
  - csv-date-format-pin: "pins yyyy-mm-dd via the canonical regex — WR-02 lesson held"
  - no-caller-identity-fields: "Keys: [client_order_id, file_base64, filename, content_type, document_type, admin_override, idempotency_key, environment]" (NO user_id / actor_id / etc.)
  - guardrails-block-present: "audit + idempotency(idempotency_key) + rateLimit — BL-01 canonical block intact"

## Deviations from Plan

None — plan executed as written. All 3 tasks landed with the documented files, scorers, thresholds, and CI jobs. The pre-existing `evals/datasets/orders-graphql-v1.ts` + `evals/score-orders-graphql.ts` (committed in an earlier wave) were honored as-is; the new `evals/orders-graphql.ts` runner imports them unchanged.

## Phase 3 status

**Phase 3 is now complete** — 5/5 plans shipped:

| Plan  | Subject                                                            |
|-------|--------------------------------------------------------------------|
| 03-01 | Orders Core GraphQL client + lookup_orders_ids + bulk_orders_lookup |
| 03-02 | Quiqup REST + Audit clients + get_order_history + list_order_audit_events |
| 03-03 | Platform read tools (ORDL-04/05/06)                                |
| 03-04 | Ex-core + Orders Core REST clients + download_orders_export + upload_order_document |
| 03-05 | Langfuse eval coverage for the 4 new Phase-3 service-host families (this plan) |

**Tool count after Phase 3:** ~85 tools registered, 585 tests passing, 62 test files.

**Service-host family eval coverage** (PROJECT.md invariant: "Every new service-host family gets at least one Langfuse eval before its tools count as shipped"): 4/4 new Phase-3 families now have at least one Langfuse eval at the CI layer (Orders Core GraphQL, Quiqup REST + Audit combined, Ex-core, Orders Core REST).

## Project-status follow-ups

Flag for the user (per the 02-05 convention — do NOT flip invariant rows from inside an execute plan):

- PROJECT.md: mark the "Every new service-host family gets at least one Langfuse eval before its tools count as shipped" row as compliant for Phase 3 across all 4 new families.
- PROJECT.md: consider adding a row that documents the second-ever auth-exception client (lib/clients/audit.ts) alongside the Google Places precedent.
- PROJECT.md: consider adding a row that locks the binary-envelope contract (`{ contentType, base64, filenameHint }`) as the canonical shape for Phase 5 (PDF labels), Phase 7 (inventory CSV), Phase 10 (Zoho PDFs).

## Self-Check: PASSED

- evals/datasets/orders-history-and-audit-v1.ts: FOUND
- evals/orders-graphql.ts: FOUND
- evals/orders-history-and-audit.ts: FOUND
- evals/score-orders-history-and-audit.ts: FOUND
- evals/datasets/orders-export-v1.ts: FOUND
- evals/orders-export.ts: FOUND
- evals/score-orders-export.ts: FOUND
- evals/datasets/orders-document-upload-v1.ts: FOUND
- evals/orders-document-upload.ts: FOUND
- evals/score-orders-document-upload.ts: FOUND
- Commit 52ea02b: FOUND
- Commit 32b909f: FOUND
- Commit cddef8d: FOUND
