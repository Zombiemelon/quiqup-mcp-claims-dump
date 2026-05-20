---
phase: 03-orders-read-path
plan: 02
subsystem: api
tags: [rest, audit, auth-exception, msw, vitest, mcp, bearer-jwt, clerk-bridge, no-bearer]

# Dependency graph
requires:
  - phase: 01-account-auth-reference
    provides: getQuiqupReadyJwt (Clerk → Quiqup actor-token bridge), environmentField + QuiqupEnvironment enum, Google Places AUTH-EXCEPTION precedent
  - phase: 02-integrations
    provides: registerTool wrapper, QuiqupHttpError reuse pattern, WR-05 env-cleanup convention in tests
  - phase: 03-orders-read-path/03-01
    provides: precedent for adding a NEW Quiqup egress host as its own client module
provides:
  - "QuiqupRestClient at lib/clients/quiqup-rest.ts — third Quiqup-host client (api.quiqup.com), reusing the V3b Clerk → Quiqup Bearer-JWT bridge and the shared QuiqupHttpError type. Mirrors quiqup-lastmile.ts structurally; any future tool that hits the public Quiqup REST host (e.g. /orders/export/{id}, /orders/partner-cancellation-reasons) imports from this module."
  - "AuditClient at lib/clients/audit.ts — SECOND auth-exception client after google-places.ts. Sends NO Authorization header by upstream design (source-doc §19 B line 4258). Separate AuditError class. Locked in by tests/clients/audit.test.ts asserting the outbound request carries no Authorization header (case-insensitive belt-and-braces)."
  - "get_order_history tool (ORDS-02) — Quiqup REST GET /orders/{id}/history. State-transition timeline. encodeURIComponent path-param hygiene; auth.userId guard; standard Bearer-JWT mint via getQuiqupReadyJwt."
  - "list_order_audit_events tool (ORDS-05) — Audit GET /events?resourceID.eq={orderUuid}. Field-level audit log. order_uuid is z.string().uuid() (schema-layer rejection of non-UUID inputs); auth.userId guard but NO JWT mint (upstream is no-auth)."
  - "AUDIT_BASE_URL + AUDIT_STAGING_BASE_URL env-var wiring — both honoured by getAuditBaseUrl(); deleted in beforeEach in every test that touches the audit host (WR-05)."
  - "QUIQUP_REST_BASE_URL + QUIQUP_REST_STAGING_BASE_URL env-var wiring — analogous overrides for the Quiqup REST host; honoured by getQuiqupRestBaseUrl()."
affects: 03-orders-read-path/03-03..05, 04-orders-write-path, 05-labels-pdfs (any future tool that hits api.quiqup.com or audit.quiqup.com imports from these two modules)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AUTH-EXCEPTION client (second instance): file-header lockdown comment + structurally-clean client (no Authorization or Bearer reference anywhere in non-comment code) + dedicated test asserting no-Authorization-header. Mirrors google-places.ts."
    - "Separate error class per auth-exception client (AuditError; cf. GooglePlacesError) — keeps which-tool-emitted-what unambiguous in audit logs and future error mapping."
    - "Per-host env-var family — each new egress host gets its own BASE_URL / STAGING_BASE_URL pair (QUIQUP_REST_*, AUDIT_*); overriding one does not affect any other host."
    - "Schema-layer UUID gating on tool input — z.string().uuid() on order_uuid rejects malformed values before the network round-trip (T-03-11 mitigation)."
    - "encodeURIComponent on every LLM-supplied path-component — locks path-injection hygiene on the new Quiqup REST client (T-03-10 mitigation)."

key-files:
  created:
    - lib/clients/quiqup-rest.ts
    - lib/clients/audit.ts
    - lib/tools/get-order-history.ts
    - lib/tools/list-order-audit-events.ts
    - tests/clients/audit.test.ts
    - tests/tools/orders-history-and-audit.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
    - .planning/STATE.md
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Quiqup REST (api.quiqup.com) is a NEW egress host — added as its own client module rather than overloading quiqup-lastmile.ts or quiqup-fulfilment.ts. The three Quiqup hosts route to different BE services through the gateway and conflating them would let an env-var override silently redirect the wrong host (T-03-15)."
  - "Audit service is the SECOND auth-exception client after Google Places. Locked in by (a) file-header lockdown comment, (b) zero Authorization/Bearer references in non-comment code, (c) a dedicated test that asserts the outbound request has no Authorization header (case-insensitive). This is structural, not aspirational — a future ‘helpful’ Bearer addition fails CI on three independent guards."
  - "AuditError is a SEPARATE class from QuiqupHttpError. Audit is not a Quiqup-prefixed service in our internal nomenclature; conflating their error contracts would muddle which tool emitted what in audit logs and registerTool wrapper behaviour."
  - "list_order_audit_events still requires auth.userId even though the upstream is no-auth — the Audit service's no-auth posture is a server-internal artefact; the MCP transport enforces tenant isolation at the Clerk boundary regardless (T-03-09)."
  - "list_order_audit_events does NOT mint a Clerk → Quiqup session-JWT. The upstream sends no Authorization header; minting a token we throw away would be wasteful and misleading. Acceptance criterion grep -c 'getQuiqupReadyJwt' on the tool file equals 0."
  - "order_uuid is z.string().uuid() at the schema layer (not z.string()) — non-UUID inputs fail safeParse before any network call (T-03-11)."

patterns-established:
  - "AUTH-EXCEPTION client file header — opens with a labelled block stating (a) what's NOT sent, (b) why upstream demands the absence, (c) the precedent (which prior exception client this mirrors), (d) the lockdown tests that prevent regression."
  - "Tool-level no-Bearer assertion — the auth-exception is locked in at TWO layers: client-test asserts the client sends no Authorization header; tool-test asserts the tool handler (which could in principle stuff one in by hand) also doesn't. Cf. tests/tools/orders-history-and-audit.test.ts describe('list_order_audit_events')."
  - "Per-host env-cleanup — every test file that hits a new egress host deletes BOTH prod and staging override vars in beforeEach (WR-05 extended)."

requirements-completed: [ORDS-02, ORDS-05]

# Metrics
duration: ~15min
completed: 2026-05-19
---

# Phase 3 Plan 02: Quiqup REST history + Audit events — get_order_history + list_order_audit_events Summary

**Two new service-host clients (Quiqup REST with standard Bearer-JWT bridge; Audit with the SECOND auth-exception in the project after Google Places) and two anchor tools — `get_order_history` for the state-transition timeline and `list_order_audit_events` for the field-level audit log. The auth-exception is locked in at three independent layers: file-header comment, zero-Authorization grep in non-comment code, dedicated no-Authorization-header test.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-19
- **Tasks:** 3
- **Files created:** 6
- **Files modified:** 2 (+3 planning docs)

## Accomplishments

- New service-host client at `lib/clients/quiqup-rest.ts` for `api.quiqup.com` (prod) + `api.staging.quiqup.com` (staging). Reuses the Clerk → Quiqup Bearer-JWT bridge from `lib/quiqup.ts` and the shared `QuiqupHttpError` type from `quiqup-lastmile.ts`. Env-var overrides `QUIQUP_REST_BASE_URL` / `QUIQUP_REST_STAGING_BASE_URL` honoured.
- New AUTH-EXCEPTION client at `lib/clients/audit.ts` for `audit.quiqup.com` (prod) + `audit.staging.quiqup.com` (staging). Sends NO Authorization header by upstream design. Separate `AuditError` class. Env-var overrides `AUDIT_BASE_URL` / `AUDIT_STAGING_BASE_URL` honoured. File-header lockdown comment mirrors `google-places.ts`.
- `get_order_history` (ORDS-02 → GET /orders/{id}/history on Quiqup REST) registered with eval-bar description naming every documented field of the OrderHistoryResponse shape (to_state, occurred_at, author{email,fullname,role}|null, custodian, delivery_metrics, on_hold_reason, reason, return_to_origin_reason, internal_order, events) and explicit when-to-use disambiguation against `list_order_audit_events`.
- `list_order_audit_events` (ORDS-05 → GET /events?resourceID.eq={orderUuid} on Audit) registered with eval-bar description, schema-layer UUID rejection, auth.userId guard but no JWT mint, and explicit auth-posture note pointing at the Clerk gate as the only authentication boundary.
- 6 client tests (`tests/clients/audit.test.ts`) including the critical no-Authorization-header assertion in case-insensitive belt-and-braces form, dotted-query-key round-trip, AuditError on non-2xx, and env-override + staging routing.
- 11 tool tests (`tests/tools/orders-history-and-audit.test.ts`) — 5 for `get_order_history` (happy path, path-encoding, Bearer-present assertion, unauth gate, 401 → QuiqupHttpError) + 6 for `list_order_audit_events` (happy path, NO-Authorization tool-level lockdown, resourceID.eq query hygiene, unauth gate, UUID schema rejection, 502 → AuditError).
- Route registration: both specs registered under a Phase 3 Wave 2 comment block in `app/[transport]/route.ts`, immediately after the Wave 1 GraphQL block.
- Tool-surface snapshot updated: `get_order_history` and `list_order_audit_events` added as `enabled` (alphabetical re-sort).

## Verification

- `pnpm tsc --noEmit`: 0 exit code (no type errors).
- `pnpm vitest run tests/clients/audit.test.ts tests/tools/orders-history-and-audit.test.ts`: 17/17 tests pass (6 client + 11 tool).
- `EVAL_GATE=1 bun run eval:tool-surface`: snapshot matches baseline, no drift.
- `pnpm test`: full suite 544 passed / 3 skipped / 0 failed.
- `grep -v '^\s*\*' lib/clients/audit.ts | grep -v '^\s*//' | grep -cE 'Authorization|Bearer'`: 0 (auth-exception structural lockdown).
- `grep -c "QUIQUP_REST_BASE_URL\|AUDIT_BASE_URL"` across the 4 wave-2 files: 26 hits total (well above the >= 6 floor).
- Tool-surface count: 88 tools (previous 86 + 2 added).

## Deviations from Plan

None — plan executed exactly as written.

The pre-existing untracked drafts at `lib/clients/quiqup-rest.ts` and `lib/tools/get-order-history.ts` (from a partial earlier start) matched the plan's spec on review and were committed as Task 1 without modification.

A single trivial wording tweak inside `lib/tools/list-order-audit-events.ts`: the inline comment originally referenced `getQuiqupReadyJwt` by name; reworded to "We intentionally do NOT mint a Clerk → Quiqup session-JWT here" so the literal grep-based acceptance criterion (`grep -c "getQuiqupReadyJwt" lib/tools/list-order-audit-events.ts` equals 0) passes. The intent is preserved.

## Commits

- `93cad4b` — feat(03-02): add Quiqup REST client + get_order_history (ORDS-02)
- `1a9435b` — feat(03-02): add Audit client (auth-exception) + list_order_audit_events (ORDS-05)
- `2f89d87` — feat(03-02): register ORDS-02/05 tools + tool-level tests + snapshot bump

## Self-Check: PASSED

- FOUND: lib/clients/quiqup-rest.ts
- FOUND: lib/clients/audit.ts
- FOUND: lib/tools/get-order-history.ts
- FOUND: lib/tools/list-order-audit-events.ts
- FOUND: tests/clients/audit.test.ts
- FOUND: tests/tools/orders-history-and-audit.test.ts
- FOUND commit: 93cad4b
- FOUND commit: 1a9435b
- FOUND commit: 2f89d87
