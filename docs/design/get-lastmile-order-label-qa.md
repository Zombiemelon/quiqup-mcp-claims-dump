# QA plan — `get_lastmile_order_label` redesign

Scope: test design only. Mirrors the gold-standard pattern at `tests/get-lastmile-order.test.ts:1` (vitest + `vi.mock` of `getQuiqupReadyJwt` + msw stub at the fetch boundary via `tests/setup/msw`). Two output shapes are in play — tag each test (a) `resource`/blob, (b) `resource_link`/URL. Unmarked = both.

## 1. Unit tests (`tests/get-lastmile-order-label.test.ts`)

### Registration & input validation
- Registration assertion mirroring `tests/get-lastmile-order.test.ts:38` — name `get_lastmile_order_label`, description regex `/label|pdf/i`, `inputSchema.safeParse({order_id:"abc"}).success === true`.
- `inputSchema` rejects missing `order_id` (path `["order_id"]`) and empty string — driven by `z.string().min(1)` already at `lib/tools/get-lastmile-order-label.ts:12`. Mirrors `tests/get-lastmile-order.test.ts:50`.

### Happy path
- (a) 200 PDF body → `result.content[0]` has `type:"resource"`, `resource.mimeType === "application/pdf"`, `resource.blob` is a base64 string whose decoded first 5 bytes equal `%PDF-` (`Buffer.from(blob,"base64").subarray(0,5).toString() === "%PDF-"`, equivalent to the `JVBERi0` base64 prefix). Assert `resource.uri` is present (MCP `resource` items require it; use a stable scheme like `quiqup://lastmile-label/{order_id}`).
- (b) 200 PDF body → `result.content[0]` has `type:"resource_link"`, `uri` matches `/\/api\/lastmile-label\/<order_id>(?:\?|$)/`, `mimeType === "application/pdf"`, optional `name` includes the order id. No blob present.
- Output schema (`outputSchema.safeParse`) accepts the happy-path payload and **rejects** a payload missing the discriminating field (`blob` for (a), `uri` for (b)) — defends the vacuous-green per `tests/get-lastmile-order.test.ts:98`.

### Error mapping (both shapes — `QuiqupHttpError` is thrown by `QuiqupLastmileClient.request` at the fetch boundary, then re-shaped in the handler)
- 404 → `/label not found/i` (the order-not-found message at `tests/get-lastmile-order.test.ts:118` won't fit; the label endpoint can 404 on a valid order that has no AWB yet — recommend distinct copy).
- 401 → `/authentication failed/i` (parity with `:130`).
- 403 → `/not authorized.*label/i` — order belongs to a different merchant; distinct from 401 so the LLM stops retrying with the same creds.
- 5xx → `/temporarily unavailable.*retry/i` (parity with `:142`).
- Non-PDF 200 (upstream returns `text/html` error page with status 200, a real Cloudflare-edge failure mode) → **recommend: reject as a tool error** `/unexpected content type/i`. Pass-through would force the LLM to redecode garbage. The client at `lib/clients/quiqup-lastmile.ts` already branches on `content-type`; assert handler-level rejection when the resulting object lacks a `application/pdf` content type.
- Large file (5 MB synthetic PDF, generated in-test via `Buffer.alloc(5*1024*1024,0x20)` prefixed with `%PDF-1.4\n` and `%%EOF`) → completes under a soft 2 s budget and does not throw `RangeError`. Applies to (a); for (b) the handler never holds the bytes, so assert the route is not invoked.

## 2. Cassette strategy

**Recommend: synthetic minimum-viable PDF stub, committed as `tests/cassettes/get-lastmile-order-label.json`** with envelope `{status:200, content_type:"application/pdf", body_base64:"<base64 of '%PDF-1.4\\n1 0 obj<<>>endobj\\ntrailer<<>>\\n%%EOF\\n'>"}` — matches the envelope already documented at `tests/cassettes/README.md` (the file referenced there does not yet exist on disk; this PR creates it). Reasons: (1) real labels carry customer PII and the anonymization table at `tests/cassettes/README.md` has no rule for raster-text-inside-PDF; (2) a 28 KB binary in git review is noisy; (3) synthetic stub keeps the magic-bytes assertion meaningful without exposing AWB layout. The msw handler unwraps the envelope and replays as `new HttpResponse(buf, {headers:{"content-type":"application/pdf"}})`.

## 3. Integration tests (`tests/integration/lastmile-label.test.ts`)

Gate with `describe.runIf(process.env.RUN_INTEGRATION === "1")` mirroring `tests/integration/mcp-flow.test.ts:4`. Mint a testing token via Clerk, POST to `/mcp` `tools/call` with a known-good staging order id from `QUIQUP_TEST_ORDER_ID` env. Assert `res.status === 200`, content shape matches the chosen (a)/(b), and (a) decoded blob starts with `%PDF-`. **Run policy: label-gated, not every PR** — it hits live staging, depends on a fixture order staying alive, and the 28 KB→base64 round-trip is already covered by unit tests. Gate behind the `integration` label like the existing flow test.

## 4. Shape (b) only — `/api/lastmile-label/:id` route tests (`tests/api-lastmile-label.test.ts`)

- Missing/expired JWT → 401, body `{error:"unauthenticated"}`.
- Valid JWT, order owned by a different merchant → 403 (cross-merchant leakage is the headline risk of shape (b)).
- Valid JWT, owner match → 200, `content-type: application/pdf`, `content-disposition: attachment; filename="lastmile-label-<id>.pdf"`, body bytes start `%PDF-`.
- Signed-URL TTL (if the design uses HMAC-signed URLs): expired signature → 401/403; tampered `sig` → 401/403; clock-skew window honored.
- Upstream 404 → route returns 404, not 500.
- `Range: bytes=0-99` → respond `206` with correct `Content-Range` **or** `200` with full body (recommend: 200 — labels are small, range support adds attack surface for little gain; assert whichever is implemented).
- HEAD request returns headers without body.

## 5. Schema-snapshot test inheritance

The forthcoming `tests/tools-schema-snapshot.test.ts` will snapshot every tool's `name + inputSchema + outputSchema + description`. **Overlap to exclude from this plan**: do not re-assert the snapshot-able surface (tool name, raw zod shape) beyond the one registration smoke test above. **Keep here** (snapshot can't cover): runtime content-block shape, base64 magic-bytes / mimeType, error-message regex mapping, route-level auth, large-payload behavior. If the snapshot test lands first, drop the description regex from the registration test to avoid double-maintenance on copy changes.