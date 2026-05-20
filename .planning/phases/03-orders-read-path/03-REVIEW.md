---
phase: 03-orders-read-path
reviewed: 2026-05-20T05:06:00Z
depth: deep
files_reviewed: 19
files_reviewed_list:
  - lib/clients/orders-core-graphql.ts
  - lib/clients/quiqup-rest.ts
  - lib/clients/audit.ts
  - lib/clients/ex-core.ts
  - lib/clients/orders-core-rest.ts
  - lib/tools/lookup-orders-ids.ts
  - lib/tools/bulk-orders-lookup.ts
  - lib/tools/find-order-by-id-or-barcode.ts
  - lib/tools/list-depots.ts
  - lib/tools/list-missions-filter.ts
  - lib/tools/get-order-history.ts
  - lib/tools/list-order-audit-events.ts
  - lib/tools/download-orders-export.ts
  - lib/tools/upload-order-document.ts
  - tests/clients/audit.test.ts
  - tests/clients/orders-core-rest.test.ts
  - tests/clients/ex-core.test.ts
  - tests/tools/orders-export-and-upload.test.ts
  - evals/score-orders-document-upload.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-05-20T05:06:00Z
**Depth:** deep
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 3 adds 5 new service clients (Orders Core GraphQL, Quiqup REST, Audit auth-exception, Ex-core, Orders Core REST) and 9 new tools covering the read-only Orders surface plus one document upload. The implementation is unusually disciplined — Phase 1 and Phase 2 review lessons are all applied:

- **BL-01 (guardrails on writes):** The only write tool (`upload_order_document`) has the full canonical guardrails block (`audit: true`, `idempotency.keyArg: "idempotency_key"`, `rateLimit: 10/min`). All eight read tools correctly omit `guardrails`. Verified at the schema layer by `score-orders-document-upload.ts:guardrailsBlockPresent`.
- **BL-02 (country `.length(2)`):** N/A — no new country fields introduced this phase.
- **BL-01 Phase 2 (no `token`/secret in passthrough output):** No new tool exposes auth-bearing keys in its output schema. Audit and history responses carry `actor.email` (PII, documented and intentional) but no tokens.
- **BL-02 Phase 2 (`code` in ALWAYS_REDACT_KEYS):** OAuth/secret keys are not touched here; `file_base64` is already in `ALWAYS_REDACT_KEYS` (lib/middleware/pii-redact.ts:129), which is the right call for the upload tool.
- **BL-03 Phase 2 (source-verification on destructives):** N/A — no destructive ops.
- **BL-04 Phase 2 (no caller-supplied identity fields):** `upload_order_document` schema carries NO `user_id`/`actor_id`/`actor_email`/`partner_id`/`uploader_id`/`actor` — verified by a static `noCallerIdentityFields` eval scorer AND by an in-repo test (`tests/tools/orders-export-and-upload.test.ts:397`). The identity-binding lockdown is excellent.
- **Audit auth-exception:** Verified at three layers — (1) file header reads correctly with the same precedent reference to Google Places; (2) the `AuditClientOptions` interface deliberately has no `jwt` field with an explanatory comment; (3) `tests/clients/audit.test.ts:49` asserts both `Authorization` and `authorization` headers are null on the outbound request.
- **Multipart Content-Type:** `orders-core-rest.ts` deliberately omits `Content-Type` on the multipart path with an explicit comment, and `tests/clients/orders-core-rest.test.ts:63` asserts the runtime-set `multipart/form-data; boundary=...` is intact.

Findings below are all WARNING or INFO — no BLOCKERs.

## Warnings

### WR-01: `platformApiFetch` helper still not extracted — 90+ tools now duplicate the same inline `fetch` boilerplate

**File:** `lib/tools/find-order-by-id-or-barcode.ts:104-130`, `lib/tools/list-depots.ts:77-105`, `lib/tools/list-missions-filter.ts:60-83`
**Issue:** WR-07 from the Phase 1 and Phase 2 reviews flagged the missing `platformApiFetch` helper and is now deferred for a third phase. Phase 3 adds three more Platform-API inline fetch sites (`find_order_by_id_or_barcode`, `list_depots`, `list_missions_filter`) which all repeat the same six-step ritual: `getPlatformApiBaseUrl(env)` → `new URL(...)` → `new URLSearchParams(...)` → `url.search = params.toString()` → `fetch(url.toString(), { Authorization: Bearer ${jwt}, Accept: application/json })` → `if (!res.ok) throw new QuiqupHttpError(res.status, await res.text())`. A repo-wide grep shows **54 inline `fetch(` sites** in `lib/tools/` after this phase.

This is a structural tech-debt accumulator. Each new tool re-derives header construction (one typo away from a missing `Authorization` header) and error mapping (one typo away from a missed `QuiqupHttpError`). Phase 4+ writes will keep paying this tax.

**Fix:** Land a `lib/clients/platform-api.ts` analogous to `quiqup-rest.ts`/`quiqup-lastmile.ts` exposing `PlatformApiClient.request(method, path, init?)` with the standard Bearer + Accept headers and `QuiqupHttpError` mapping. Migrate the three new Phase 3 inline sites in the same PR as part of the helper landing — it sets the precedent for Phase 4 instead of growing the deficit. Use the JSON/binary content-type branch from `quiqup-rest.ts:124-135` verbatim.

---

### WR-02: `find_order_by_id_or_barcode.intention` is unvalidated free-form string but drives upstream state-transition logic

**File:** `lib/tools/find-order-by-id-or-barcode.ts:48-53`
**Issue:** `intention` is typed `z.string().min(1)` with the documented set of ~13 observed values listed in the description. The tool description correctly tells the LLM the expected values, but a malformed/typo'd intention from a hostile or buggy caller silently round-trips to the upstream. The 200-with-`error` contract means the LLM sees the error verbatim, so this is not a security bug — but it's a UX regression vs other Phase 3 schemas which use `z.enum` for known finite sets (e.g. `list-depots.main_depot`, `lookup-orders-ids.orderBy.direction`).

The author's comment (line 16: "Modelled as free-form z.string() (T-03-19) because the BE may add new intentions over time") is defensible. But a `z.union([z.enum([... known set ...]), z.string()])` or a no-`.strict()` enum with a documented escape hatch would catch typos client-side without locking out future intentions.

**Fix:** Either keep `z.string()` and accept the tradeoff explicitly (lift the comment from line 16 into the field's `.describe()` so the policy is visible at the schema layer), OR add an enum-of-observed-values + `z.string()` union with a `z.preprocess` that warns on unknown values. Recommend the lift-the-comment option as lower-touch.

---

### WR-03: `bulk_orders_lookup` GraphQL query hard-codes `first: 200` but does not request `pageInfo` — silent truncation possible if upstream `clientOrderIDIn` semantics ever change

**File:** `lib/tools/bulk-orders-lookup.ts:77-96`
**Issue:** The query string requests `orders(first: 200, where: $where)` and selects only `edges.node.*`. It does NOT request `pageInfo { hasNextPage }` or `totalCount`. Today this is safe because (a) the schema caps `client_order_ids.max(200)` and (b) `clientOrderIDIn` is presumed exact-match. But:

- If upstream behavior for `clientOrderIDIn` ever broadens (e.g. soft-deleted orders, fuzzy match), the response would silently truncate at 200 and the agent would have no signal that data was lost.
- The companion query `lookup_orders_ids` DOES request `pageInfo + totalCount`. Asymmetric selection across two tools that the agent is supposed to use in sequence is a footgun for debugging.

**Fix:** Add `totalCount` (and ideally `pageInfo { hasNextPage }`) to the `BULK_ORDERS_LOOKUP_QUERY` selection set. The tool handler doesn't need to act on them — surfacing them in the response is enough for the agent to detect truncation.

---

### WR-04: `download_orders_export` happy-path returns the binary envelope inside a `text` content block instead of a `resource` block — re-introduces the WR widened-in-`get_lastmile_order_label` pattern

**File:** `lib/tools/download-orders-export.ts:148-152`
**Issue:** `lib/tools/register.ts:108` includes an explicit comment from 2026-05-14 widening `ToolSpec.handler` return to the full `ContentBlock[]` union "in response to `get_lastmile_order_label` returning 28KB base64 inside a text block, which forced client LLMs into bash-heredoc gymnastics to decode bytes that should have flowed as a `resource` block to begin with." The Phase-3 export tool is bigger (a CSV export can easily be megabytes of base64) and ships the same anti-pattern: it builds a `{ contentType, base64, filenameHint }` envelope, then `JSON.stringify`-wraps it inside a `text` block.

This is the same regression the widening was supposed to retire. Any LLM downstream consumer that wants to save the CSV to disk now has to extract the base64 from a JSON-in-text block and decode — exactly the bash-heredoc gymnastics the comment flags.

**Fix:** Return a `resource` content block (or `resource_link` if the upload mechanism prefers a URL handoff) instead of a `text` block. Mirror whatever shape `get_lastmile_order_label` should have been retrofitted to — if that retrofit is still TODO, do both at the same time to set the right precedent for Phase 5 (PDFs), Phase 7 (CSV), and Phase 10 (Zoho PDFs), all of which the file headers say will reuse this envelope.

## Info

### IN-01: `bulk_orders_lookup` and `lookup_orders_ids` outputs include `data.errors[]` partial-success — but the partial-success path is never unit-tested

**File:** `tests/tools/orders-graphql-reads.test.ts`
**Issue:** The two GraphQL tools deliberately do NOT auto-throw on a 200-with-populated-`errors[]` response, surfacing both `data` and `errors[]` per GraphQL §7.1 partial-success. The file headers explain this contract carefully. However, the test suite for these tools does not appear to assert that path — only the happy path and the non-2xx path. A future maintainer "tidying" the client to auto-throw on `errors[]` would not trip a test.
**Fix:** Add one test per tool that stubs a 200 response carrying both `data` and `errors[]`, and asserts the tool's text output JSON-roundtrips both keys. Trivial to add given the existing MSW scaffolding.

### IN-02: Audit-client outbound-header lockdown asserts only `Authorization` — not `Cookie`, `X-Api-Key`, `X-Auth-Token`

**File:** `tests/clients/audit.test.ts:49-70`
**Issue:** The "no Authorization header" test is the right lockdown for the BL-01 Google-Places-style regression, but a future maintainer could "helpfully" add a `Cookie` or `X-Api-Key` header (e.g. "for service-to-service authentication") without tripping this assertion. The Audit upstream is documented as no-auth-by-design — any auth-style header is a structural violation.
**Fix:** Add one assertion that the only headers sent are `Accept` (+ runtime-set headers like `Host`/`Content-Length`/`User-Agent`). Either enumerate the allowed set or assert the disallowed set (`Authorization`, `Cookie`, `X-Api-Key`, `X-Auth-Token`, `Proxy-Authorization`).

### IN-03: `upload_order_document` filename hygiene only strips `/` and `\`; no null-byte or control-char stripping

**File:** `lib/tools/upload-order-document.ts:176`
**Issue:** `args.filename.replace(/[\\/]/g, "_")` strips POSIX and Windows path separators, which is the minimum hygiene. Null bytes, newlines, and other shell-metachars round-trip to the upstream as the multipart-part filename label. The upstream service probably handles these, but a defense-in-depth strip would be cheap.
**Fix:** Extend the regex to also strip control characters and null bytes: `args.filename.replace(/[\\/\x00-\x1f\x7f]/g, "_")` (the existing test `pod-12345.jpg` continues to pass).

### IN-04: `download_orders_export` `order_ids` cap of 500 vs upstream `per_page` cap of 5000 — silent under-fetch when callers supply > 500 ids

**File:** `lib/tools/download-orders-export.ts:54`, `61-71`
**Issue:** `order_ids.max(500)` is a client-side cap, but `per_page.max(5000)` suggests the upstream tolerates 5000-row pages. A caller asking for an export of 1000 specific clientOrderIDs will get a Zod rejection rather than a clean "split into two calls" pathway. Today this is loud (Zod rejects), so it is not a silent-data-loss bug. But the doc string says "Capped at 500 to bound the upstream cost" without naming the cost source — a future maintainer reading this won't know whether 500 is a hard upstream constraint or a tunable.
**Fix:** Either bump to 5000 (matching `per_page`), or pin the rationale ("upstream `/orders/download` rejects > 500 entries in `filters[order_id]` per source-doc §X line Y") in the `.describe()` so the cap rationale survives.

### IN-05: `list_order_audit_events` output schema is fully passthrough `z.object({}).passthrough()` — no shape hint even for the documented `{events: [...]}` envelope

**File:** `lib/tools/list-order-audit-events.ts:39`
**Issue:** Every other tool in this phase narrows its output schema at least to `{events: array, ...passthrough}` or similar. `list_order_audit_events` leaves it completely loose. The file header says "The frontend stores this whole response without parsing — fields beyond the documented set may appear" which is fine rationale for passthrough, but the top-level `events: z.array(...)` IS contracted (line 47 description claims it). Cassette-conformance tests that `.safeParse` the output get no signal from this schema.
**Fix:** Tighten to `z.object({ events: z.array(z.unknown()) }).passthrough()` — matches the contracted top-level shape without locking down the per-event passthrough fields.

### IN-06: GraphQL `query` constants live inline in two separate tool files — easy to drift from upstream's contract-by-text behavior

**File:** `lib/tools/lookup-orders-ids.ts:144-150`, `lib/tools/bulk-orders-lookup.ts:77-96`
**Issue:** The file headers correctly emphasize that Orders Core treats the query text as the response contract (selection set MUST match the FE's `orders-listing.query.ts` / `bulk-orders-lookup.query.ts`). Today both queries are inline constants in their respective tool files. As more GraphQL tools land (probably in Phase 4 or later), the risk of two tools accidentally diverging on a shared fragment (e.g. `OrderPageInfoFragment`) grows.
**Fix:** When the second-or-third GraphQL tool ships, hoist the query constants to `lib/clients/orders-core-graphql.queries.ts` so the selection-set drift surface is one file, not N. Not urgent at N=2 — flagged as a Phase-4 watch item.

---

_Reviewed: 2026-05-20T05:06:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
