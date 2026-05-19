# Phase 3: Orders — Read Path - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Cover every read-only orders surface (GraphQL lookups, Audit events, Quiqup REST history, Ex-core CSV export, document upload) so agents can inspect any order's full lifecycle without yet mutating it.

**Requirements covered:** ORDL-02, ORDL-03, ORDL-04, ORDL-05, ORDL-06, ORDL-07, ORDS-02, ORDS-05, ORDS-08

**Depends on:** Phase 1 (reason-code enums for filtering — now complete).

**Introduces three new service clients:** Orders Core GraphQL, Quiqup REST history, Audit (with new `AUDIT_BASE_URL` env wiring), Ex-core CSV export.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per user setting. Use ROADMAP phase goal, success criteria, and codebase conventions (Phase 1 + 2 established Platform-API patterns; this phase will need new client modules) to guide decisions.

</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Closest analogs for new service clients: lib/clients/quiqup-lastmile.ts, lib/clients/google-places.ts (API-key auth-exception pattern).

</code_context>

<specifics>
## Specific Ideas

No specific requirements — discuss phase skipped. Refer to ROADMAP phase description and success criteria.

</specifics>

<deferred>
## Deferred Ideas

None — discuss phase skipped.

</deferred>
