# Phase 4: Orders — Write Path & Lifecycle - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning
**Mode:** Interactive discussion (user invoked /gsd:discuss-phase explicitly; project default `workflow.skip_discuss: true` overridden)

<domain>
## Phase Boundary

Cover every order-mutation endpoint exposed by Quiqdash v3: 20 new tools across five sub-surfaces — batch status transitions (12), single-order mutations (4), order creation (2), and mission orchestration (2). Every tool is DESTRUCTIVE-gated via the canonical `confirm: true` + `dry_run` contract from Phase 2.

**Requirements covered (20):** ORDS-03, ORDS-04, ORDS-06, ORDS-07, ORDC-04, ORDC-05, ORDT-03, ORDT-04, ORDT-05, ORDT-06, ORDT-07, ORDT-08, ORDT-09, ORDT-10, ORDT-11, ORDT-12, ORDT-13, ORDT-14, MISS-01, MISS-02.

**Depends on:**
- Phase 1 (reason-code enumeration tools — `list_on_hold_reasons`, `list_return_to_origin_reasons`, `list_cancellation_reasons`, `list_courier_failure_reasons`) — used at runtime by the LLM caller to discover valid reason values.
- Phase 3 (read-path) — verification flows for the new mutations (an agent reads the order before and after the write).

**Sub-surfaces and tool counts:**
- Batch status transitions (12, all DESTRUCTIVE): ORDT-03..14 → `set_collected`, `set_received_at_depot`, `set_at_depot`, `set_in_transit`, `set_scheduled`, `set_delivery_complete`, `set_on_hold`, `set_return_to_origin`, `set_returned_to_origin`, `set_delivery_failed`, `set_collection_failed`, `unpool_order`.
- Single-order mutations (4): `export_order` (ORDS-03, Quiqup REST PUT), `update_fulfilment_order_status` (ORDS-04, Platform PATCH), `create_order_charge` (ORDS-06, Platform POST), `update_order_weight` (ORDS-07, Platform PATCH).
- Order creation (2): `create_internal_fulfilment_order` (ORDC-04, Platform POST), `bulk_create_orders` (ORDC-05, Platform POST multipart CSV).
- Mission orchestration (2, both DESTRUCTIVE): `create_mission` (MISS-01, Platform POST), `transfer_mission_orders` (MISS-02, Platform PUT).

**No new service hosts.** Every tool reuses existing clients introduced in Phases 1–3: `lib/clients/platform-api.ts` (most), `lib/clients/quiqup-rest.ts` (export_order, ORDS-03), `lib/clients/orders-core-rest.ts` (multipart pattern from 03-04 already lives there if `bulk_create_orders` reuses it; otherwise stays on Platform).

</domain>

<decisions>
## Implementation Decisions

### 1. Batch transition authoring pattern — Factory + per-tool override

The 12 `ORDT-03..14` tools all share the shape `PUT /quiqdash/orders/batch/{transition}` with body `{ order_ids: [...] }` plus optional reason / metadata for the four reason-bearing transitions. Author a single canonical factory at `lib/tools/_batch-transition-factory.ts` that takes a config `{ name, path, description, reasonField? }` and returns a fully-formed `ToolSpec` with:

- the canonical `destructiveConfirmField` + `destructiveDryRunField` from `lib/middleware/destructive.ts` injected on every instance;
- the standard `order_ids: z.array(z.string().min(1)).min(1).max(10)` array (max-10 cap matches `cancel_lastmile_orders_batch`);
- per-id `assertOrderBelongsToUser` pre-PUT scope-assertion loop (the cancel-lastmile-orders-batch pattern);
- canonical guardrails block: `rateLimit: { capacity: 3, refillPerSec: 3 / 60 }`, `idempotency: { keyArg: "idempotency_key", ttlMs: 15 * 60 * 1000 }`, `audit: true`;
- the canonical "DESTRUCTIVE-GATE: MUST set confirm: true" error shape via `throw + buildConfirmationRequiredResult` (no per-tool reinvention).

Each of the 12 tools is then a thin per-file wrapper that calls the factory once with the tool-specific name + path + description + optional `reasonField`. This keeps each `lib/tools/set-*.ts` file greppable / discoverable (so existing eval scorers that import `spec.description` continue to work per-tool) while saving ~400 LOC and structurally guaranteeing that the destructive contract cannot drift between transitions.

**Rejected alternative:** 12 hand-written files. Uniformity-by-convention is exactly what bit Phase 3 in the prior `recent-orders.ts` maintenance-comment pattern (replaced by direct-import-from-spec in 01-04). A factory makes uniformity structural.

### 2. Reason-code field shape — z.string() free-form + description-pin

For the four reason-bearing transitions (`set_on_hold`, `set_return_to_origin`, `set_delivery_failed`, `set_collection_failed`), the `reason` argument is `z.string().min(1)` (free-form) with a description that names the Phase-1 enumeration tool the LLM should call to discover valid values.

This mirrors the Phase-3 03-03 `find_order_by_id_or_barcode.intention` precedent (decision logged 2026-05-20). Rationale (re-stated for the planner): the upstream backend may add new reason codes over time, and overconstraining the client schema would silently break new codes the moment Quiqup ships them. Bad inputs surface via the upstream's structured 200-with-error envelope. Threat-register disposition per the prior `intention` precedent: accept.

**Rejected alternative:** `z.enum([...])` from a hardcoded snapshot. Creates a second source of truth alongside the Phase-1 reason-code list tools and adds a drift surface that an LLM with up-to-date reasoning would route around anyway.

### 3. `dry_run` response contract — Rich: full simulated payload + `dryRun: true`

When a destructive tool is invoked with `confirm: true` AND `dry_run: true`, the response is the full simulated upstream response payload, with a top-level `dryRun: true` flag stamped on, and an explicit `orderIds: [...]` array naming every order the real PUT would touch. The `dryRun: true` flag is the unmistakable signal that no upstream traffic occurred; the simulated payload shape lets the LLM preview the new status, the transition-timestamp shape, and any side-effect fields BEFORE committing.

Implementation: the factory's handler runs the same scope-assertion loop as the real call (so dry-run still fails fast on out-of-scope orders), then builds a synthesized response object whose shape matches what the upstream `PUT` would return for a successful batch. The synthesized shape may be the canonical "batch acknowledged" envelope upstream returns, with the order_ids and would-be new state filled in client-side.

**Why richer than Phase 2:** Phase-2 destructive tools (delete connections, ...) had no useful state-change preview — the resource is gone, and the agent does not need to inspect a simulated payload. Phase-4 batch transitions move orders between concrete states the agent will then read back via Phase-3 tools, and a preview of the new shape is what lets the LLM verify "yes, this transition is what I meant" before flipping confirm.

**Phase 5/7/10 reuse implication:** future destructive tools whose post-state is non-trivial (e.g., delete-with-cascade) SHOULD reuse this rich-dry-run shape. Phase-2-style minimal dry-run is acceptable when the post-state is trivial.

### 4. Live-staging CALL-LOG.md — One per wave

Per AGENTS.md, every tool in this phase touching a Quiqup-owned host requires a live staging call against a REAL order through `POST http://localhost:3000/mcp` `tools/call`, with verbatim request/response captured. Across 20 tools, the per-wave bundling is:

- One `CALL-LOG.md` file per wave directory under `.planning/phases/04-orders-write-path-lifecycle/`.
- Each `CALL-LOG.md` contains a section per tool shipped in that wave (header: tool name, body: request + response or error-name + status + diagnosis-if-failure).
- The file is referenced from the wave's `04-NN-SUMMARY.md` and committed alongside the wave's code commits.

**Why per-wave and not per-tool:** 20 separate files would scatter the evidence across the phase directory without adding bisect granularity that a single per-wave file with per-tool sections already provides. Per-wave matches how Phase-3 wave summaries already bundle multiple tools.

**Why not master per-phase:** a single 20-tool log would be hard to bisect when a tool regresses six weeks later; a per-wave file lands with the wave's PR and stays scoped.

### 5. Mission-tool destructive gating (Claude's discretion)

- `transfer_mission_orders` (MISS-02): DESTRUCTIVE-gated. Moves orders between missions; affects downstream dispatch state.
- `create_mission` (MISS-01): NOT destructive-gated. Pure creation; no resource is overwritten. Standard auth + rate-limit + idempotency.

### 6. `update_fulfilment_order_status` destructive gating (Claude's discretion)

DESTRUCTIVE-gated. It is a state mutation on a fulfilment order with the same "would-not-want-to-undo" property as the batch transitions. Same `confirm: true` + `dry_run` contract.

### 7. Per-order scope assertion strategy (Claude's discretion — locks in cancel-lastmile-orders-batch pattern)

For all batch tools (12 transitions + transfer_mission_orders): pre-PUT loop over `assertOrderBelongsToUser`, collecting denials, refusing the whole batch with a structured error naming every denied id. Sequential (not Promise.all) — the upstream `assertOrderBelongsToUser` endpoint is rate-limited per-user, and burst-paralleling 10 calls would trip the limit before the destructive call even reaches the gate.

### 8. `bulk_create_orders` row-error surface (Claude's discretion)

When upstream returns per-row errors, surface the full row→error map verbatim in the tool response. No client-side aggregation. The LLM caller is the right place to decide whether to retry the failed rows.

</decisions>

<code_context>
## Existing Code Insights

**Canonical destructive helpers (locked, Phase 2-05):**
- `lib/middleware/destructive.ts` — exports `requireConfirm`, `destructiveConfirmField`, `destructiveDryRunField`, `isDryRun`, `ConfirmationRequiredError`, `buildConfirmationRequiredResult`. MUST be imported directly; no copy-paste, no rename.
- Layer order on every destructive handler: auth → confirm → dry_run → upstream (T-02-37/38/39 in PROJECT.md threat register).
- Rate-limit on every destructive tool: `{ capacity: 3, refillPerSec: 3 / 60 }`.

**Closest tool analog (locked, Phase 1):**
- `lib/tools/cancel-lastmile-orders-batch.ts` — the canonical batch-destructive shape. Per-id scope assertion before PUT, denials collected and surfaced together, 10-order cap, idempotency key, tight rate-limit, audit on. The Phase-4 batch-transition factory replicates this exactly.

**Reusable clients (no new clients in Phase 4):**
- `lib/clients/platform-api.ts` — used by ORDT-03..14 (`PUT /quiqdash/orders/batch/...`), ORDS-04 (`PATCH /api/fulfilment/orders/{id}`), ORDS-06 (`POST /quiqdash/order-charge`), ORDS-07 (`PATCH /quiqdash/orders/{orderId}/weight`), ORDC-04 (`POST /internal/fulfilment/orders`), ORDC-05 (`POST /quiqdash/bulk_orders` multipart), MISS-01/02 (`POST /quiqdash/missions`, `PUT /quiqdash/missions/transfer/{missionID}`).
- `lib/clients/quiqup-rest.ts` — used by ORDS-03 (`PUT /orders/export/{id}`).
- Multipart pattern already established in 03-04 (`upload_order_document` against Orders Core REST). The bulk-CSV upload for `bulk_create_orders` reuses the same multipart codec — confirm host (Platform vs Orders Core REST) during planning.

**Reason-code enumeration tools (locked, Phase 1):**
- `list_on_hold_reasons`, `list_return_to_origin_reasons`, `list_cancellation_reasons`, `list_courier_failure_reasons` — referenced from the `reason` field descriptions on the four reason-bearing transitions.

**Scope-assertion helper (locked, Phase 1):**
- `lib/middleware/scope.ts` exports `assertOrderBelongsToUser` + `ScopeViolationError`. The factory imports these directly.

**Audit middleware (locked, Phase 1):**
- Every destructive tool sets `guardrails.audit: true`. `ALWAYS_REDACT_KEYS` already redacts tokens at the at-rest layer; no per-tool redaction tuning needed.

</code_context>

<specifics>
## Specific Ideas

- **Factory file naming:** `lib/tools/_batch-transition-factory.ts` (underscore prefix marks it as an internal building block, not a tool that registers itself with the MCP surface).
- **Per-tool files:** `lib/tools/set-collected.ts`, `lib/tools/set-received-at-depot.ts`, ..., one file per transition. Each imports the factory and calls it once.
- **Existing `mark-ready-for-collection.ts` and `cancel-lastmile-orders-batch.ts` stay hand-written** — they pre-date the factory and were shipped with bespoke description text the live eval scorers depend on. Do NOT retroactively refactor them through the factory in this phase; that would risk eval-gate regressions outside the phase scope.
- **`unpool_order` (ORDT-14) is a single-order endpoint** (`PUT /quiqdash/missions/unpool/orders/{orderUUID}`) — it goes through the factory with a different path template but the same DESTRUCTIVE gate, dry-run, scope-assertion, and guardrails. Factory must support single-id mode (likely a sibling factory or a config flag).
- **`bulk_create_orders` multipart codec:** if it ships on Platform (`POST /quiqdash/bulk_orders`), the multipart helper in `lib/clients/orders-core-rest.ts` may need either (a) lift-and-shift to a shared `lib/clients/_multipart.ts` or (b) duplicate the small helper in `platform-api.ts`. Decision deferred to the planner; flag it.

</specifics>

<canonical_refs>
## Canonical References

Downstream agents (researcher, planner, executor) MUST read these before acting:

- `AGENTS.md` — live-staging CALL-LOG requirement for every Quiqup-owned-host tool change. Non-negotiable.
- `.planning/PROJECT.md` — project-level invariants (destructive gate, eval coverage, audit, scope-assertion).
- `.planning/REQUIREMENTS.md` — ORDS-03/04/06/07, ORDC-04/05, ORDT-03..14, MISS-01/02 specs (lines 82–127 in current revision).
- `.planning/STATE.md` — accumulated decisions including the canonical destructive-gate lockup (Phase 2-05 entries dated 2026-05-19) and the Phase-3 free-string `intention` precedent (entry dated 2026-05-20).
- `.planning/ROADMAP.md` — Phase 4 section (lines 90–101) with goal, dependencies, requirements list, and success criteria.
- `lib/middleware/destructive.ts` — canonical helpers. Import directly.
- `lib/middleware/scope.ts` — `assertOrderBelongsToUser` + `ScopeViolationError`. Import directly.
- `lib/tools/cancel-lastmile-orders-batch.ts` — canonical batch-destructive analog. The factory replicates this shape.
- `.planning/phases/03-orders-read-path/03-CONTEXT.md` — Phase 3 context (auto-generated, brief).
- `.planning/phases/02-integrations/02-CONTEXT.md` — Phase 2 context. The destructive-gate canonical decisions were made in Phase 2 plan 02-05.
- `.planning/phases/02-integrations/02-05-SUMMARY.md` — the wave that established the destructive contract; the source of every locked decision the Phase-4 factory must honour.

</canonical_refs>

<deferred>
## Deferred Ideas

None raised during discussion — the user accepted all four recommended decisions verbatim. No scope-creep redirections needed.

</deferred>
