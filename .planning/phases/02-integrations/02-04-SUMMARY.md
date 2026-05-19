---
phase: 02-integrations
plan: 04
subsystem: salla-integration
tags: [salla, integrations, platform-api, mcp-tool, guardrails, token-omission]
dependency_graph:
  requires:
    - "lib/quiqup.ts (getQuiqupReadyJwt)"
    - "lib/clients/quiqup-env.ts (environmentField, getPlatformApiBaseUrl)"
    - "lib/clients/quiqup-lastmile.ts (QuiqupHttpError)"
    - "lib/tools/register.ts (ToolSpec, registerTool)"
    - "lib/tools/list-integration-connections.ts (companion-tool — discovery)"
    - "lib/tools/list-service-kinds.ts (Phase 1 AUTH-08 — service_kind enum source)"
  provides:
    - "install_salla — Salla OAuth install URL (INTG-20)"
    - "get_salla_connection — connection read with token-strip + envelope unwrap (INTG-21)"
    - "toggle_salla_fulfillment — flip is_fulfillment flag (INTG-23)"
    - "get_salla_platform_data — live Salla shipping_methods + locations catalog (INTG-24)"
    - "get_salla_config — saved config with 404-as-null structured response (INTG-25)"
    - "update_salla_config — UPSERT config; partial-update on existing connections (INTG-26)"
  affects:
    - "app/[transport]/route.ts (6 new registerTool calls)"
    - "evals/snapshots/tool-surface.json (+6 enabled tools, 76 → 82)"
tech_stack:
  added: []
  patterns:
    - "platform-api read pattern (Bearer JWT + Accept JSON → QuiqupHttpError on non-2xx)"
    - "BL-01 canonical guardrails block on writes (rateLimit + idempotency + audit:true)"
    - "skip-undefined body builder (update_salla_config mirrors update-shopify-config.ts)"
    - "encodeURIComponent path-param encoding on every dynamic path"
    - "envelope-unwrap on read (get_salla_connection drops `{ connection }`; get_salla_config drops `{ config }`)"
    - "defensive token-strip via destructure-and-discard (T-02-29 — get_salla_connection)"
    - "404-as-structured-null special case (T-02-30 — get_salla_config)"
    - "synthesized echo response for empty-body PUTs (toggle_salla_fulfillment + update_salla_config)"
    - "z.enum 6-value strict schema on awb_trigger (T-02-32)"
    - "z.string().length(2) ISO-3166 alpha-2 bounds on country_filter (T-02-34)"
    - "z.number().int().min(0).max(10080) wms_delay_minutes bounds (T-02-34)"
key_files:
  created:
    - lib/tools/install-salla.ts
    - lib/tools/get-salla-connection.ts
    - lib/tools/get-salla-platform-data.ts
    - lib/tools/get-salla-config.ts
    - lib/tools/toggle-salla-fulfillment.ts
    - lib/tools/update-salla-config.ts
    - tests/tools/salla-integration.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
decisions:
  - "get_salla_connection strips the upstream `token` field via destructure-and-discard, locked in by .strict() output schema AND a canary regression test ('SECRET-TOKEN-DO-NOT-LEAK'). This is the canonical Salla-vs-Shopify difference — Shopify exposes token on update_shopify_connection because the merchant supplies it; Salla NEVER exposes token because it's a Quiqup-internal secret, only used server-side via the JWT bridge."
  - "get_salla_config treats upstream 404 as a STRUCTURED `{ config: null, message: ... }` response (NOT a thrown QuiqupHttpError). 404 here means 'no config saved yet' — surfacing it as a clean negative read lets an agent immediately call update_salla_config without parsing an HTTP error. All OTHER non-2xx (401/403/422/5xx) still throw."
  - "update_salla_config description pins `delivery_methods[].service_kind` to the values from list_service_kinds (Phase 1 AUTH-08). service_kind is z.string() (free-form) per threat-register T-02-33 accept disposition — upstream enforces the enum, and duplicating it here would create a drift surface for a Phase-1 read-time taxonomy that may grow."
  - "PUT response synthesis: both write tools wrap the empty upstream response into a structured echo (`{ ok: true, ... }`) so the LLM gets a positive confirmation rather than parsing an empty string."
  - "INTG-22 (delete_salla_connection) deliberately deferred to plan 02-05 — it requires the canonical `confirm:true` destructive gate that this phase establishes in the next wave."
metrics:
  duration_minutes: ~20
  completed_date: "2026-05-19"
  tasks_total: 3
  tasks_completed: 3
  tests_added: 23
  tools_added: 6
---

# Phase 2 Plan 4: Salla Integration Summary

Ship the 6 non-destructive Salla tools (INTG-20/21/23/24/25/26) completing the Salla integration surface — install URL, connection read, fulfillment toggle, live platform-data catalog, saved-config read with 404-as-null semantics, and UPSERT config. INTG-22 (destructive delete) is deferred to plan 02-05.

## What landed

**4 read tools (commit 6781345):**
- `install_salla` — GET /integrations/install/salla; output schema tightened to `z.object({ url: z.string().url() })` since the response is the simple `{ url }` shape.
- `get_salla_connection` — GET /integrations/connections/{id}; **unwraps the `{ connection }` envelope AND defensively strips the upstream `token` field**. Output schema is `.strict()` so any future leakage would fail tsc.
- `get_salla_platform_data` — GET /integrations/configs/{connectionId}/platform-data; returns live `shipping_methods[]` + `locations[]` to feed `update_salla_config` payloads.
- `get_salla_config` — GET /integrations/configs/{connectionId}; **404 → STRUCTURED `{ config: null, message }` response**, not a thrown error. All other non-2xx still throw. Unwraps `{ config }` envelope on 200.

**2 write tools (commit 7a24f62):**
- `toggle_salla_fulfillment` — PUT /integrations/connections/{id}/fulfillment; body `{ is_fulfillment }`. Synthesizes echo `{ ok, is_fulfillment, id }` since upstream returns empty.
- `update_salla_config` — PUT /integrations/configs/{connectionId}; body is the UNWRAPPED config shape (no envelope on write). awb_trigger is a strict 6-value enum. service_kind cross-references `list_service_kinds` (Phase 1 AUTH-08) per description-pin.

Both writes carry the canonical BL-01 guardrails block:
```
guardrails: { rateLimit, idempotency, audit: true }
```

**Tests + wiring (commit d125172):**
- `tests/tools/salla-integration.test.ts` — 6 `describe` blocks, 23 tests. Locks in:
  - **Canary token-omission regression** (`SECRET-TOKEN-DO-NOT-LEAK` is in MSW's `get_salla_connection` response; assertion verifies it does NOT appear in tool output AND no `token` substring leaks).
  - **404-as-null positive path** on `get_salla_config` (returns `{ config: null, message }` non-error).
  - **401 still throws** on `get_salla_config` (404 special case is scoped tightly).
  - Body shape + URL-encode + envelope-unwrap + schema-validation tests per tool.
  - Description-quality assertions (token-mention on get_salla_connection, `no salla config` on get_salla_config, `list_service_kinds` on update_salla_config, `OAuth` on install_salla).
- `app/[transport]/route.ts` — new `// -- Phase 2: Salla integration --` block with 6 imports + 6 `registerTool` calls.
- `evals/snapshots/tool-surface.json` — 6 new `enabled` entries (76 → 82 tools).

## Threat-register coverage

| Threat ID | Mitigation landed |
|-----------|-------------------|
| T-02-28 | Every handler throws on `!auth.userId`; 6× "missing auth.userId throws" tests |
| T-02-29 | Token-strip via destructure-and-discard + .strict() output schema + canary regression test + description-pin |
| T-02-30 | 404-only special case in `get_salla_config`; 401 test asserts other non-2xx still throws |
| T-02-31 | `encodeURIComponent` on every path param across all 6 tools; URL-encode tests on get_salla_connection, get_salla_platform_data, toggle_salla_fulfillment, update_salla_config |
| T-02-32 | `awb_trigger` is `z.enum([...6 values])`; schema-rejection test on `"invalid_value"` |
| T-02-33 | `service_kind` accept disposition documented; description-pin to `list_service_kinds`; cross-phase reference test |
| T-02-34 | `country_filter: z.array(z.string().length(2))` + `wms_delay_minutes` bounded [0, 10080]; schema-rejection tests on `["XYZ"]` and `10081` |
| T-02-35 | Both writes set `audit: true`; reads omit guardrails |
| T-02-36 | Install URL accept — not sensitive in itself |
| T-02-SC | No new packages installed |

## Deviations from Plan

None — plan executed exactly as written. The 3 read-tool files (`install-salla.ts`, `get-salla-connection.ts`, `get-salla-platform-data.ts`) were pre-staged as untracked files before this execution wave; `get-salla-config.ts` was written from scratch; both writes were written from scratch. All 4 acceptance-criteria grep sets pass.

## Verification

- `pnpm tsc --noEmit` → exit 0
- `pnpm vitest run tests/tools/salla-integration.test.ts` → 23 pass
- `EVAL_GATE=1 bun run eval:tool-surface` → "Tool-surface snapshot matches baseline. No drift detected."
- `pnpm test` → 462 pass / 3 skip (was 439/3 → +23 new Salla tests)
- Canary regression: `SECRET-TOKEN-DO-NOT-LEAK` mocked in `get_salla_connection` MSW response is verified absent from tool output.
- 404-as-null: `get_salla_config` with MSW 404 returns `{ config: null, message }` with `isError` falsy.

## Commits

| Task | Hash | Description |
|------|------|-------------|
| 1 | 6781345 | feat(02-04): add 4 Salla read tools (INTG-20/21/24/25) |
| 2 | 7a24f62 | feat(02-04): add 2 Salla write tools (INTG-23/26) |
| 3 | d125172 | test(02-04): wire 6 Salla tools, MSW suite, snapshot bump |

## Known Stubs

None. All 6 tools are fully wired with real platform-api endpoints, MSW-mocked tests, and registered on the MCP route. INTG-22 (`delete_salla_connection`) is intentionally deferred to plan 02-05 where the canonical destructive `confirm:true` gate lands; this is documented in the plan's must-haves and in the route-block comment, not stubbed here.

## Self-Check: PASSED

All 6 tool files, the test file, and SUMMARY.md exist on disk. All 3 task commits (6781345, 7a24f62, d125172) exist in `git log`. Full suite green (462 pass / 3 skip), tool-surface snapshot eval passes.
