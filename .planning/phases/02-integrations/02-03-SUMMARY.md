---
phase: 02-integrations
plan: 03
subsystem: woocommerce-integration
tags: [woocommerce, integrations, platform-api, mcp-tool, guardrails]
dependency_graph:
  requires:
    - "lib/quiqup.ts (getQuiqupReadyJwt)"
    - "lib/clients/quiqup-env.ts (environmentField, getPlatformApiBaseUrl)"
    - "lib/clients/quiqup-lastmile.ts (QuiqupHttpError)"
    - "lib/tools/register.ts (ToolSpec, registerTool)"
    - "lib/tools/list-integration-connections.ts (companion-tool — discovery)"
  provides:
    - "list_woocommerce_connections — partner's WooCommerce connection catalog"
    - "get_woocommerce_config — saved mapping/config per site (path-param siteName)"
    - "list_woocommerce_states — canonical Quiqup order-state taxonomy"
    - "list_woocommerce_shipping_lines — live WC shipping-method catalog per site"
    - "setup_woocommerce_connection — create connection from REST consumer secret"
    - "upsert_woocommerce_config — create-or-partial-update WC mapping"
  affects:
    - "app/[transport]/route.ts (6 new registerTool calls)"
    - "evals/snapshots/tool-surface.json (+6 enabled tools, 70 → 76)"
tech_stack:
  added: []
  patterns:
    - "platform-api read pattern (Bearer JWT + Accept JSON → QuiqupHttpError on non-2xx)"
    - "BL-01 canonical guardrails block on writes (rateLimit + idempotency + audit:true)"
    - "skip-undefined body builder (upsert_woocommerce_config mirrors update-account.ts)"
    - "URLSearchParams query encoding (mirrors Shopify delivery-methods pattern)"
    - "encodeURIComponent path-param encoding (mirrors get_shopify_config)"
    - "z.string().url() schema-layer bounds (T-02-21 SSRF mitigation)"
    - "z.string().length(2) ISO-3166 alpha-2 bounds on country_filter (T-02-24)"
    - "z.number().int().min(0).max(10080) wms_delay_minutes bounds (T-02-25)"
key_files:
  created:
    - lib/tools/list-woocommerce-connections.ts
    - lib/tools/get-woocommerce-config.ts
    - lib/tools/list-woocommerce-states.ts
    - lib/tools/list-woocommerce-shipping-lines.ts
    - lib/tools/setup-woocommerce-connection.ts
    - lib/tools/upsert-woocommerce-config.ts
    - tests/tools/woocommerce-integration.test.ts
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json
decisions:
  - "WooCommerce setup has NO OAuth dance: setup_woocommerce_connection takes a REST consumer secret directly (vs setup_shopify_callback's single-use code) — documented in description and threat register as T-02-22."
  - "z.string().url() on site_url is a schema-layer bound only. Per T-02-21, the value is a lookup KEY against Quiqup's saved connections — Quiqup does NOT fetch the URL. SSRF is structurally impossible."
  - "delivery_method[].woocommerce is z.record(z.string(), z.unknown()) (intentionally open) per T-02-23 'accept' disposition: WooCommerce's per-storefront delivery-method shape is highly variable."
  - "list_woocommerce_states description-pin: the response IS the canonical Quiqup-side enum used in mappings; the WC-native statuses live in states[].woocommerce_state (free-form). Disambiguation locked in by description-quality test."
metrics:
  duration_minutes: ~25
  completed_date: "2026-05-19"
  tasks_total: 3
  tasks_completed: 3
  tests_added: 21
  tools_added: 6
---

# Phase 2 Plan 3: WooCommerce Integration Summary

Ship 6 WooCommerce tools (INTG-13..18) that mirror the Shopify family's surface — list/get/upsert config, list states, list live shipping-lines, set up new connection — wired into the MCP route with MSW-backed Vitest coverage and an updated tool-surface snapshot.

## What landed

**4 read tools (commit d992513, pre-existing):**
- `list_woocommerce_connections` — GET /woocommerce/connections; cross-family disambiguation points to `list_integration_connections`.
- `get_woocommerce_config` — GET /woocommerce/config/{site_name} with `encodeURIComponent` path encoding.
- `list_woocommerce_states` — GET /woocommerce/states; description explicitly disambiguates the Quiqup canonical taxonomy from WC native statuses.
- `list_woocommerce_shipping_lines` — GET /woocommerce/shipping-lines with URLSearchParams query encoding and `z.string().url()` schema bounds on `site_url`.

**2 write tools (commit c58bdcf, this execution):**
- `setup_woocommerce_connection` — POST /woocommerce/connection. Body `{ shop_name, site_url, token, is_fulfillment }`. Description distinguishes WC (REST consumer secret pasted directly from admin) from Shopify (OAuth code dance) and marks `token` as SENSITIVE per the BL-01 audit-redaction policy.
- `upsert_woocommerce_config` — PUT /woocommerce/settings/config/upsert. Skip-undefined body builder. Description references `list_woocommerce_states` and `list_woocommerce_shipping_lines` as the source-of-truth for legal mapping values. `country_filter` bounded to ISO-3166 alpha-2 (length 2); `wms_delay_minutes` bounded to [0, 10080].

Both writes carry the canonical BL-01 guardrails block:
```
guardrails: { rateLimit, idempotency, audit: true }
```

**Tests + wiring (commit 54a9b52, this execution):**
- `tests/tools/woocommerce-integration.test.ts` — 6 describe blocks, 21 tests total. Each tool exercises happy path, upstream 401 → QuiqupHttpError, and `auth.userId === null` → plain Error before any fetch. Tool-specific extras:
  - `get_woocommerce_config`: percent-encoded path-param assertion.
  - `list_woocommerce_shipping_lines`: URL-encoded query param + `z.string().url()` schema rejects `"not-a-url"`.
  - `list_woocommerce_states`: description-quality assertion locks in the Quiqup vs WooCommerce disambiguation.
  - `setup_woocommerce_connection`: outbound body equals exactly `{ shop_name, site_url, token, is_fulfillment }` (`idempotency_key`/`environment` MUST NOT leak); description marks `token` "sensitive" per T-02-22.
  - `upsert_woocommerce_config`: skip-undefined body verified (keys not supplied MUST NOT appear); `country_filter: ["USA"]` rejected (length 3); `wms_delay_minutes: 10081` rejected; description references `list_woocommerce_states` + `list_woocommerce_shipping_lines`.
- `app/[transport]/route.ts` — 6 new imports + 6 `registerTool` calls under a new `// -- Phase 2: WooCommerce integration --` block, placed after the Shopify block and before the M3 enabled-writes block.
- `evals/snapshots/tool-surface.json` — +6 enabled tool entries, re-sorted. Tool count 70 → 76.

## Verification

- `pnpm tsc --noEmit` — exit 0.
- `pnpm vitest run tests/tools/woocommerce-integration.test.ts` — 21 tests pass.
- `pnpm test` (full suite) — 439 passed, 3 skipped, 0 failed.
- `EVAL_GATE=1 bun run eval:tool-surface` — "Tool-surface snapshot matches baseline. No drift detected."

## Threat-model coverage (per <threat_model>)

| Threat ID | Mitigation landed |
|-----------|-------------------|
| T-02-19 (spoofing) | Every handler throws on `!auth.userId`. 6/6 describe blocks include the "missing auth.userId throws" assertion. |
| T-02-20 (path injection) | `encodeURIComponent` on `site_name` path param; test asserts the raw special-char value does NOT appear verbatim while the encoded form does. |
| T-02-21 (SSRF via site_url) | `z.string().url()` schema bound; URLSearchParams query encoding (not raw concat). SSRF structurally impossible — `site_url` is a lookup key, not a fetch target. |
| T-02-22 (token leakage) | Tool description marks `token` SENSITIVE; description-quality test grep-locks the wording. `audit: true` is set on the write so token-supply attempts are traceable. The audit middleware's `ALWAYS_REDACT_KEYS` covers `token` automatically. |
| T-02-23 (delivery_method blob abuse) | Accept disposition — `woocommerce` field is `z.record(z.string(), z.unknown())` because per-storefront shape varies. Description tells the agent to pass through what `list_woocommerce_shipping_lines` returned. |
| T-02-24 (country_filter abuse) | `z.array(z.string().length(2))` enforces ISO-3166 alpha-2 at the schema layer. Test asserts `["USA"]` rejected, `["AE", "SA"]` accepted. |
| T-02-25 (wms_delay_minutes abuse) | `z.number().int().min(0).max(10080)`. Test asserts 10081 rejected, 10080 accepted. |
| T-02-26 (audit trail) | `audit: true` on both writes; reads do not set guardrails (no audit noise on read paths). |
| T-02-27 (setup flood) | `rateLimit: { capacity: 5, refillPerSec: 5/60 }` + 15-min idempotency window on `setup_woocommerce_connection`. |
| T-02-SC | No new packages installed — uses existing zod + msw + mcp-handler. |

## Deviations from Plan

**1. [Rule 3 - Blocking] zod v4 `z.record()` signature**
- **Found during:** Task 2 (`upsert_woocommerce_config`).
- **Issue:** Plan called for `woocommerce: z.record(z.unknown())`. The codebase is on zod v4, which requires `z.record(keySchema, valueSchema)`. The single-arg form failed `pnpm tsc --noEmit` with `TS2554: Expected 2-3 arguments, but got 1`.
- **Fix:** Used `z.record(z.string(), z.unknown())`, matching the existing pattern in `update-account.ts`, `decide-feature-flags-bulk.ts`, and `create-lastmile-order.ts`.
- **Files modified:** `lib/tools/upsert-woocommerce-config.ts` (pre-commit, included in c58bdcf).
- **Commit:** c58bdcf (included).

## Self-Check: PASSED

- File `lib/tools/list-woocommerce-connections.ts`: FOUND
- File `lib/tools/get-woocommerce-config.ts`: FOUND
- File `lib/tools/list-woocommerce-states.ts`: FOUND
- File `lib/tools/list-woocommerce-shipping-lines.ts`: FOUND
- File `lib/tools/setup-woocommerce-connection.ts`: FOUND
- File `lib/tools/upsert-woocommerce-config.ts`: FOUND
- File `tests/tools/woocommerce-integration.test.ts`: FOUND
- Commit d992513 (4 reads): FOUND
- Commit c58bdcf (2 writes): FOUND
- Commit 54a9b52 (tests + route + snapshot): FOUND
- `evals/snapshots/tool-surface.json` tool count: 76 (was 70, +6 — verified)
- `pnpm test`: 439 passed / 3 skipped / 0 failed
- `EVAL_GATE=1 bun run eval:tool-surface`: no drift
- `pnpm tsc --noEmit`: exit 0
