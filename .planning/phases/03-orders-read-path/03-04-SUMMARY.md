---
phase: 03-orders-read-path
plan: 04
subsystem: api
tags: [ex-core, orders-core-rest, csv-export, multipart-upload, base64-envelope, binary-response-contract, bl-01-guardrails, bl-04-server-binding, wr-05-env-cleanup, msw, vitest, mcp, bearer-jwt, clerk-bridge]

# Dependency graph
requires:
  - phase: 01-account-auth-reference
    provides: getQuiqupReadyJwt (Clerk → Quiqup session-JWT bridge), environmentField, WR-05 env-cleanup convention
  - phase: 02-integrations
    provides: registerTool wrapper + GuardrailConfig, BL-01 canonical guardrails (rateLimit + idempotency + audit:true), BL-04 server-binding (no caller-supplied identity), BL-02/03 ALWAYS_REDACT_KEYS audit redactor
  - phase: 03-orders-read-path/03-01
    provides: QUIQUP_ORDERS_GRAPH_URL env-var convention (fallback chain consumes it), QuiqupHttpError reuse precedent
  - phase: 03-orders-read-path/03-02
    provides: Dual env-var (prod + staging) WR-05 cleanup pattern
  - phase: 03-orders-read-path/03-03
    provides: Wave-level registration comment-block convention + tool-surface snapshot insertion order
provides:
  - "Ex-core CSV-export client (lib/clients/ex-core.ts) — ex-api.quiqup.com host with EX_API_BASE_URL / EX_API_STAGING_BASE_URL env wiring, Bearer-JWT via the Clerk → Quiqup bridge, distinct ExCoreError type. Returns the canonical binary envelope `{ contentType, base64 }` for non-JSON responses; parses JSON for application/json content-type."
  - "Orders Core REST client (lib/clients/orders-core-rest.ts) — orders-api.quiqup.com host. Implements the FE-aligned fallback chain: ORDERS_API_BASE_URL → QUIQUP_ORDERS_GRAPH_URL minus /graph → canonical URL. Provides BOTH a JSON `request()` method AND a `requestMultipart()` method. requestMultipart deliberately does NOT set Content-Type — the runtime sets multipart/form-data; boundary=… from the FormData body."
  - "download_orders_export tool (ORDL-07) — GET /orders/download. Returns the canonical binary envelope `{ contentType: 'text/csv', base64: <bytes>, filenameHint: 'orders-export-<from>-to-<to>.csv' }`. yyyy-mm-dd date format (NOT full ISO-8601 — per upstream); order_ids capped at 500; per_page 1-5000 default 1000. Read-only — no guardrails block."
  - "upload_order_document tool (ORDS-08) — POST /orders-by-client-id/{clientOrderID}/documents. BL-01 canonical guardrails (rateLimit 10/min, idempotency on idempotency_key with 15min TTL, audit:true). BL-04 server-bound identity — schema has NO user_id/actor_id/actor_email field. 10MB pre-flight cap, filename path-separator strip, encodeURIComponent on client_order_id."
  - "Canonical binary-response contract `{ contentType, base64, filenameHint }` — Phase 5 (PDF labels), Phase 7 (inventory CSV), Phase 10 (Zoho PDFs) will all reuse this exact shape."
  - "Multipart-without-manual-Content-Type pattern locked in by runtime test (assert request.headers.get('Content-Type').startsWith('multipart/form-data') AND captures boundary= parameter)."
  - "tests/clients/ex-core.test.ts + tests/clients/orders-core-rest.test.ts (6 + 6 client tests) + tests/tools/orders-export-and-upload.test.ts (14 tool tests across 2 describe blocks)."
affects: 03-05 (Phase 3 final wave — eval), 05-pdf-labels (binary-response contract reuse), 07-inventory-csv (binary-response contract reuse), 10-zoho-pdfs (binary-response contract reuse), Phase 4 write-path (multipart pattern reuse if other doc upload endpoints emerge)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Binary-response envelope contract — `{ contentType, base64, filenameHint }`. Client layer returns `{ contentType, base64 }`; tool layer layers on `filenameHint`. Shape is identical across Ex-core (CSV) and QuiqupLastmile (PDF labels) so downstream agents see a uniform decode story regardless of MIME."
    - "FE-aligned fallback chain — when an FE env var has documented fallback semantics (here: VITE_ORDERS_API_BASE_URL ?? VITE_ORDERS_API_GRAPH_URL.replace(/\\/graph$/, '')), the server-side resolver mirrors it. Rationale: one env var (QUIQUP_ORDERS_GRAPH_URL) redirects BOTH the GraphQL and REST surfaces to the same dev host, matching how an FE developer expects the override to behave."
    - "Multipart-without-manual-Content-Type — never set the Content-Type header when passing FormData to fetch(). The runtime sets `multipart/form-data; boundary=<random>` automatically; manual override clobbers the boundary. Locked by a runtime test that captures the Content-Type and asserts startsWith('multipart/form-data') + contains('boundary=')."
    - "Pre-flight DoS cap — file_base64 size check enforced BEFORE JWT mint AND BEFORE FormData construction, so abusive callers cost the MCP no network bandwidth. Combined with the BL-01 rateLimit guardrail (10/min), a runaway uploader is bounded to ~100MB/min of pre-flight work — well below abuse threshold."
    - "BL-04 schema-level server-binding — the input schema STRUCTURALLY omits user_id/actor_id/actor_email fields. Caller-supplied identity is impossible by construction, not just by handler convention. Locked by an Object.keys(spec.inputSchema.shape) test."

key-files:
  created:
    - lib/clients/ex-core.ts
    - lib/clients/orders-core-rest.ts
    - lib/tools/download-orders-export.ts
    - lib/tools/upload-order-document.ts
    - tests/clients/ex-core.test.ts
    - tests/clients/orders-core-rest.test.ts
    - tests/tools/orders-export-and-upload.test.ts
    - .planning/phases/03-orders-read-path/03-04-SUMMARY.md
  modified:
    - app/[transport]/route.ts
    - evals/snapshots/tool-surface.json

key-decisions:
  - "Separate ExCoreError class (not QuiqupHttpError reuse) — Ex-core is a distinct service host with its own operational backstop on the Quiqup side, even though the auth bridge is shared. Mirrors QuiqupHttpError's shape (status + body) so callers branch on err.status uniformly. (Compare: OrdersCoreRestClient reuses QuiqupHttpError because the registerTool wrapper's QuiqupHttpError → MCP-error mapping is the desired behaviour for Orders Core, and Orders Core is a Quiqup-prefixed service.)"
  - "Accept */* on Ex-core (not application/json) — Ex-core's /orders/download returns text/csv. Forcing Accept: application/json would 406 the request. Belt-and-braces: the client also dispatches on the response's Content-Type (JSON parse vs base64 envelope), so a future endpoint that returns JSON works without code changes."
  - "FE-aligned fallback chain on Orders Core REST host — ORDERS_API_BASE_URL → QUIQUP_ORDERS_GRAPH_URL minus /graph → canonical. Matches source-doc §1 line 21. Rationale: a dev who sets QUIQUP_ORDERS_GRAPH_URL=https://localhost.test/graph redirects BOTH the 03-01 GraphQL client AND this REST client to the same dev host without needing two separate env vars."
  - "requestMultipart deliberately omits Content-Type — fetch() sets `multipart/form-data; boundary=<random>` from the FormData body. Manual override clobbers the boundary and the upstream rejects the body. Locked by source-level convention (no `\"Content-Type\":` inside requestMultipart) AND runtime test (captured Content-Type startsWith multipart/form-data with boundary= param)."
  - "BL-04 server-binding via schema-shape omission — the input schema has NO user_id / actor_id / actor_email field. Identity is bound server-side to auth.userId at the handler. Caller-supplied identity is structurally impossible, not just conventionally rejected. Test asserts Object.keys(spec.inputSchema.shape) does not include those keys. (Description string MENTIONS the absent keys to warn LLM callers — the planner's grep-based AC was satisfied via the test-level assertion.)"
  - "10MB pre-flight cap (13_500_000 base64 chars) enforced BEFORE JWT mint AND BEFORE FormData construction — abusive callers cost the MCP nothing upstream. Combined with the BL-01 rateLimit 10/min, a runaway uploader is bounded to ~100MB/min of pre-flight work."
  - "yyyy-mm-dd date regex on download_orders_export — the source-doc §19 H line 4720 explicitly states the upstream accepts dates, NOT full ISO-8601 timestamps. WR-02 generalised: enforce the format the upstream actually expects, not the nearest-cousin standard."
  - "download_orders_export has NO guardrails block — it's an export (read), not a mutation. The per_page cap (5000) and order_ids cap (500) bound per-call cost without rate-limiting reads."

patterns-established:
  - "Canonical binary-response envelope — `{ contentType, base64, filenameHint }`. Phase 5/7/10 will reuse this exact shape. The client layer returns the two-field envelope; the tool layer adds filenameHint."
  - "FE-aligned env-var fallback chains — when source-doc documents an FE-side fallback (e.g. VITE_X ?? VITE_Y.replace(suffix)), the server-side resolver mirrors it. Centralises the dev-override surface to a single env var per host family."
  - "Multipart upload pattern — `new FormData()`, append file as `new Blob([bytes], { type: contentType })` with original-filename, append scalar fields as `String(value)`. NEVER set Content-Type header. Locked by runtime test."

requirements-completed: [ORDL-07, ORDS-08]

# Metrics
duration: ~10min
completed: 2026-05-20
---

# Phase 3 Plan 04: Ex-core CSV export + Orders Core REST multipart upload Summary

**Phase-3 Wave-4 closes the orders read path by introducing the two remaining service clients the phase needed (Ex-core for CSV exports; Orders Core REST for multipart document uploads) and shipping the two anchor tools that exercise them (`download_orders_export` ORDL-07 + `upload_order_document` ORDS-08). The wave establishes the canonical binary-response envelope `{ contentType, base64, filenameHint }` that Phase 5 (PDF labels), Phase 7 (inventory CSV), and Phase 10 (Zoho PDFs) will reuse verbatim, and locks in the multipart-without-manual-Content-Type contract via a runtime test that captures the fetch-generated `multipart/form-data; boundary=…` header.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-05-20
- **Tasks:** 3 (Task 1: Ex-core client + download_orders_export + client tests; Task 2: Orders Core REST client + upload_order_document + client tests; Task 3: tool-level test suite + route registration + snapshot bump)
- **Files created:** 8 (2 clients, 2 tool specs, 3 test files, 1 SUMMARY)
- **Files modified:** 2 (`app/[transport]/route.ts`, `evals/snapshots/tool-surface.json`)
- **Commits:** 3 (`1601297` Task 1 Ex-core + ORDL-07, `69077cd` Task 2 Orders REST + ORDS-08, `c9e49c5` Task 3 tool tests + registration + snapshot)
- **Test count after this plan:** 585 passing / 3 skipped — up from 559 baseline (+26: 6 ex-core client tests + 6 orders-core-rest client tests + 14 tool tests).

## What Landed

### lib/clients/ex-core.ts

- Service host: `ex-api.quiqup.com` (prod), `ex-api.staging.quiqup.com` (staging). Env overrides `EX_API_BASE_URL` / `EX_API_STAGING_BASE_URL`.
- Auth: same Clerk → Quiqup Bearer-JWT bridge as Last-Mile / Platform / Orders Core. NOT an auth-exception client (the two exceptions remain Audit and Google Places).
- Generic `request(method, path, init?)` with bracket-style query-key handling via `URLSearchParams.set` (e.g. `filters[order_id]` → `filters%5Border_id%5D` on the wire).
- Response branch: JSON content-type → parsed; otherwise → `{ contentType, base64 }` binary envelope. ArrayBuffer → `Buffer.from(buf).toString("base64")` mirrors the QuiqupLastmileClient binary branch.
- Distinct `ExCoreError` class (status + body) — separate operational backstop from QuiqupHttpError.

### lib/tools/download-orders-export.ts (ORDL-07)

- `name: "download_orders_export"` — GET /orders/download on Ex-core.
- Input: `from` / `to` (z.string().regex(/^\d{4}-\d{2}-\d{2}$/) — yyyy-mm-dd UTC, NOT full ISO-8601), `order_ids` optional (array of int | string, max 500), `per_page` (1-5000, default 1000), `environment`.
- Wire-format: `filters[order_id]` query key only when `order_ids` non-empty.
- Output: `{ contentType: "text/csv", base64: <bytes>, filenameHint: "orders-export-<from>-to-<to>.csv" }`.
- Read-only — NO guardrails block (export is a read, not a mutation).
- Handler refuses without `auth.userId`; mints session-JWT via `getQuiqupReadyJwt`.

### lib/clients/orders-core-rest.ts

- Service host: `orders-api.quiqup.com` (prod), `orders-api.staging.quiqup.com` (staging).
- Fallback chain: `ORDERS_API_BASE_URL` → `QUIQUP_ORDERS_GRAPH_URL` minus `/graph` → canonical. Mirrors FE source-doc §1 line 21. Per-env overrides honoured.
- Auth: same Clerk → Quiqup Bearer-JWT bridge.
- Errors: reuses `QuiqupHttpError` (Orders Core is a Quiqup-prefixed service; the registerTool wrapper's QuiqupHttpError → MCP-error mapping applies).
- Two methods: `request()` for JSON (Last-Mile-shape mirror) AND `requestMultipart()` for multipart POSTs. requestMultipart sets Authorization + Accept but NOT Content-Type — the runtime sets `multipart/form-data; boundary=…` from the FormData body.

### lib/tools/upload-order-document.ts (ORDS-08)

- `name: "upload_order_document"` — POST /orders-by-client-id/{clientOrderID}/documents on Orders Core REST.
- Input: `client_order_id` (int | string), `file_base64` (string, ≥1 char), `filename` (string, ≤255), `content_type` (string MIME), `document_type` (default `"proof_of_delivery"`), `admin_override` (boolean, default true), `idempotency_key` (optional), `environment`. **NO `user_id` / `actor_id` / `actor_email` field — identity is bound server-side to `auth.userId`.**
- BL-01 canonical guardrails:
  - `rateLimit: { capacity: 10, refillPerSec: 10 / 60 }` (10 uploads/min)
  - `idempotency: { keyArg: "idempotency_key", ttlMs: 15 * 60 * 1000 }`
  - `audit: true`
- Pre-flight 10MB cap: `args.file_base64.length <= 13_500_000` (~10MB after base64 expansion). Enforced BEFORE JWT mint AND BEFORE FormData construction.
- Filename hygiene: `replace(/[\\/]/g, "_")` strips both POSIX and Windows path separators (`../../etc/passwd` → `.._.._etc_passwd`).
- Path-param hygiene: `encodeURIComponent(String(args.client_order_id))` — `"12/345"` → `"12%2F345"`.
- Multipart body: `file` (Blob with content_type, original-filename), `document_type`, `admin_override` (stringified boolean).

### tests/clients/ex-core.test.ts (6 tests)

- Bearer header captured + asserted; base64 envelope round-trip (Buffer.from(base64).toString matches the input bytes); JSON content-type parsed; ExCoreError on 502; `EX_API_BASE_URL` env override routes to override host; bracket-style query key encoding via URLSearchParams.
- WR-05 cleanup: `EX_API_BASE_URL` + `EX_API_STAGING_BASE_URL` deleted in beforeEach.

### tests/clients/orders-core-rest.test.ts (6 tests)

- requestMultipart sends Bearer WITHOUT manual Content-Type (asserts captured Content-Type startsWith `multipart/form-data` AND contains `boundary=`); form fields round-trip via `request.formData()`; QuiqupHttpError on 422; fallback chain to `QUIQUP_ORDERS_GRAPH_URL` minus `/graph` when `ORDERS_API_BASE_URL` is unset; `ORDERS_API_BASE_URL` direct override wins over fallback; staging env routes to staging cluster.
- WR-05 cleanup: ALL FOUR env vars (`ORDERS_API_BASE_URL`, `ORDERS_API_STAGING_BASE_URL`, `QUIQUP_ORDERS_GRAPH_URL`, `QUIQUP_ORDERS_GRAPH_STAGING_URL`) captured+restored.

### tests/tools/orders-export-and-upload.test.ts (14 tests, 2 describe blocks)

- `download_orders_export` (6 tests): happy-path base64 envelope + filenameHint, from/to/per_page query forwarding, filters[order_id] only when order_ids non-empty (percent-encoded + decode round-trip), filters omitted when undefined, schema-rejection of `2026/05/01` (yyyy-mm-dd only), unauthenticated rejection.
- `upload_order_document` (8 tests): happy-path document_id return, multipart envelope shape (runtime-set Content-Type + 4 form fields round-trip), encodeURIComponent on path-character-containing client_order_id (`12/345` → `12%2F345`), filename path-separator strip (`../../etc/passwd` → `.._.._etc_passwd`), pre-flight 10MB cap rejection with zero network calls, BL-04 schema invariant (no user_id/actor_id/actor_email keys, unknown keys stripped by Zod), BL-01 guardrails shape (rateLimit 10/min + idempotency_key + audit:true), unauthenticated rejection.
- WR-05 cleanup: ALL FOUR new env-var families captured+restored.

### app/[transport]/route.ts

- New imports block + register block under a `// -- Phase 3: Orders read path — Ex-core CSV export + Orders Core REST multipart (ORDL-07/ORDS-08) --` comment.
- `registerTool(server, ...)` count increased by exactly 2 (89 → 91).

### evals/snapshots/tool-surface.json

- 2 new entries (`download_orders_export`, `upload_order_document`), both `enabled`.
- Alphabetically inserted in-place.
- Total tool count: 91 → 93.
- `EVAL_GATE=1 bun run eval:tool-surface` exits 0 — no drift.

## Verification

| Check | Result |
| --- | --- |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm vitest run tests/clients/ex-core.test.ts tests/clients/orders-core-rest.test.ts tests/tools/orders-export-and-upload.test.ts` | 26/26 passing |
| `EVAL_GATE=1 bun run eval:tool-surface` | exit 0 (no drift) |
| `pnpm test` (full suite) | 585 passing / 3 skipped / 0 failing |
| Task 1 ACs (env wiring, Bearer, base64, getQuiqupReadyJwt, filenameHint, no guardrails on read tool) | all pass |
| Task 2 ACs (env wiring + fallback chain, no manual Content-Type on multipart path — verified at runtime, guardrails+audit:true+idempotency_key, FormData, encodeURIComponent, 10MB cap, schema field BL-04 — verified via Object.keys test) | pass with one planner-grep nuance documented below |
| Task 3 ACs (2 describe blocks, WR-05 env-delete count, registerTool +2 delta, spec refs in route, snapshot +2 = 93) | all pass |

## Deviations from Plan

### [Rule 3 — Planner grep verbiage] `grep "user_id\|actor_id\|actor_email" lib/tools/upload-order-document.ts` returns 2

The plan's `<acceptance_criteria>` and `<verification>` blocks both include:

```
grep -v '^//' lib/tools/upload-order-document.ts | grep -v '^ \*' | grep -c "user_id\|actor_id\|actor_email"  ==  0
```

The intent of this check is the BL-04 invariant: the input schema must not accept caller-supplied identity. The schema does NOT — `Object.keys(spec.inputSchema.shape)` returns `[client_order_id, file_base64, filename, content_type, document_type, admin_override, idempotency_key, environment]` only.

However the planner's grep also catches matches inside the description STRING — specifically the lines warning LLM callers `"Do not pass user_id, actor_id, or actor_email — they will be ignored at best and rejected at worst."` This warning is exactly what the BL-04 lesson asks for (telling the model the absence is intentional), but the grep cannot distinguish a string literal from a schema key.

Resolution: the BL-04 invariant is locked in by a dedicated tool test (`tests/tools/orders-export-and-upload.test.ts` → `"does NOT accept caller-supplied identity fields"`) that asserts `Object.keys(spec.inputSchema.shape).includes("user_id")` is false (and similarly for actor_id/actor_email/partner_id), AND parses an args object with a stray `user_id` field and asserts Zod strips it. This is a stronger structural check than the source-level grep. The grep-AC is structurally unsatisfiable without removing the user-facing warning, so the test-level assertion is the canonical lock.

### [Rule 3 — Planner grep verbiage] `grep '"Content-Type":' lib/clients/orders-core-rest.ts` returns 1

The plan says `grep -c '"Content-Type":' lib/clients/orders-core-rest.ts` should be 0, with the explanatory `equals 0 inside requestMultipart (we test this at runtime too)`. The one occurrence in the file is on the JSON `request()` method (line 129), which legitimately needs Content-Type when sending a JSON body. The `requestMultipart()` method does NOT set Content-Type — locked in by the dedicated runtime test that captures the outbound Content-Type and asserts it starts with `multipart/form-data` AND contains a `boundary=` parameter set by fetch().

Resolution: the actual invariant (no manual Content-Type on the multipart path) is satisfied and locked by the runtime test. The whole-file grep would force splitting the client into two modules to pass literally, which would be over-engineering; the runtime test is the stronger lock.

### [Rule 3 — Planner grep verbiage] `grep "^  describe(" tests/tools/orders-export-and-upload.test.ts` returns 0

Plan's check used 2-space-indented `describe(` regex; the codebase convention (verified against the sibling `tests/tools/orders-platform-reads.test.ts`) is top-level `describe(` at column 0. With `grep "^describe("` the count is 2, satisfying the "exactly 2 describe blocks" intent.

Resolution: top-level describes are the established convention; the planner's leading-whitespace regex was a small typo.

### [Pre-existing partial work] Untracked Task-1 files at executor start

The executor session inherited untracked `lib/clients/ex-core.ts` and `lib/tools/download-orders-export.ts` from a prior session. Both files had a JSDoc bug — the `Accept: */*` literal inside a `/** ... */` block prematurely terminated the comment, breaking `pnpm tsc --noEmit`. Fixed by replacing `*/*` with `*<slash>*` in the doc-comment prose (the runtime header value remains the literal `*/*`).

Resolution: prose-only edit; runtime semantics preserved. Recorded under Rule 3 because it was a build-blocking issue caused by inherited state and unblocking the executor was a precondition for the rest of the work.

## Threat Model Coverage

| Threat ID | Mitigation Landed |
| --- | --- |
| T-03-23 (Spoofing — upload_order_document caller-identity smuggle) | mitigated; input schema STRUCTURALLY omits user_id/actor_id/actor_email; tool test asserts via Object.keys(spec.inputSchema.shape) |
| T-03-24 (Tampering — client_order_id path injection) | mitigated; encodeURIComponent at the URL boundary; test asserts `"12/345"` → `"/orders-by-client-id/12%2F345/documents"` |
| T-03-25 (Tampering — filename path traversal) | mitigated; `replace(/[\\/]/g, "_")` strips both separators; test asserts `"../../etc/passwd"` → `".._.._etc_passwd"` |
| T-03-26 (Tampering — filters[order_id] injection) | mitigated; order_ids capped at 500; URLSearchParams encoding deterministic; test asserts decoded round-trip |
| T-03-27 (DoS — oversized file_base64) | mitigated; 10MB pre-flight cap enforced BEFORE JWT mint AND BEFORE FormData; combined with 10/min rateLimit bounds runaway to ~100MB/min of pre-flight work; test asserts the throw AND zero network calls |
| T-03-28 (DoS — repeated CSV exports) | accept; download_orders_export is read-only; per_page (5000) + order_ids (500) caps bound per-call cost |
| T-03-29 (Repudiation — upload audit trail) | mitigated; guardrails.audit:true on upload_order_document; ALWAYS_REDACT_KEYS strips file_base64 + filename at the redact layer |
| T-03-30 (Info Disclosure — upstream document URL echo-back) | accept; documented success-path contract |
| T-03-31 (Tampering — manual Content-Type clobbering multipart boundary) | mitigated; requestMultipart deliberately does not set Content-Type; runtime test asserts captured Content-Type starts with multipart/form-data AND contains boundary= parameter |
| T-03-32 (Info Disclosure — auth-bearing fields leaking) | mitigated; output schema is z.object({}).passthrough() but no documented upstream shape carries token/bearer/jwt/code; ALWAYS_REDACT_KEYS belt-and-braces at the audit layer |
| T-03-SC (npm install slopsquat risk) | mitigated; no new packages introduced; uses existing zod + msw + stdlib `fetch` + `FormData` + `Blob` (both Node-20+ globals) |

## Self-Check: PASSED

- lib/clients/ex-core.ts: FOUND
- lib/clients/orders-core-rest.ts: FOUND
- lib/tools/download-orders-export.ts: FOUND
- lib/tools/upload-order-document.ts: FOUND
- tests/clients/ex-core.test.ts: FOUND
- tests/clients/orders-core-rest.test.ts: FOUND
- tests/tools/orders-export-and-upload.test.ts: FOUND
- Commit 1601297 (Task 1 — Ex-core client + ORDL-07): FOUND in git log
- Commit 69077cd (Task 2 — Orders Core REST + ORDS-08): FOUND in git log
- Commit c9e49c5 (Task 3 — tool tests + registration + snapshot): FOUND in git log
