# INTEGRATIONS.md

> External services, APIs, and auth providers wired into `quiqup-mcp`. Last updated 2026-05-18.

## At-a-glance

| Integration | Direction | Auth | Purpose | Where |
|---|---|---|---|---|
| **Clerk** | Inbound + outbound (IdP) | `oauth_token` (in) / Backend API session JWT (out) | User identity at both trust boundaries | `middleware.ts`, `app/[transport]/route.ts`, `lib/quiqup.ts` |
| **Quiqup Last-Mile API** | Outbound | `Bearer <Clerk session-JWT>` | Courier / delivery orders, AWB labels | `lib/clients/quiqup-lastmile.ts` |
| **Quiqup Fulfilment API** | Outbound | `Bearer <Clerk session-JWT>` | Inventory, inbound, products, fulfilment orders | `lib/clients/quiqup-fulfilment.ts` |
| **Quiqup platform-api `/me`** | Outbound | `Bearer` + `x-api-version: 1` | Diagnostic identity probe | `lib/tools/whoami-platform.ts` |
| **MCP transport** | Inbound | OAuth resource server | Tool surface to Claude.ai / any MCP client | `app/[transport]/route.ts` |
| **Anthropic API** | Outbound (eval-time only) | `ANTHROPIC_API_KEY` | Model under test in evals | `evals/lastmile-order-creation.ts`, `evals/lastmile-order-roundtrip.ts` |
| **Langfuse** | Outbound (eval-time only) | `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | OTel traces + experiment scoring | `evals/lastmile-order-creation.ts` (NodeSDK + LangfuseSpanProcessor) |
| **Quiqup staging OAuth** | Outbound (roundtrip eval only) | `client_credentials` | Online end-to-end create/cancel | `evals/lastmile-order-roundtrip.ts` |

## MCP transport (inbound)

- **Endpoint:** dynamic — `app/[transport]/route.ts`. The same handler is exported as both `GET` and `POST`, letting the path itself disambiguate transports (`/mcp`, `/sse`, etc.).
- **Server construction:** `createMcpHandler((server) => { /* register tools */ }, {}, { basePath: "" })` from `mcp-handler`.
- **Auth wrapper:** `withMcpAuth(handler, async (_req, bearerToken) => { ... }, { required: true, resourceMetadataPath: '/.well-known/oauth-protected-resource' })`.
- **Inbound JWT verification:** uses `auth({ acceptsToken: 'oauth_token' })` from `@clerk/nextjs/server`. The `at+jwt` token from Claude.ai is verified against Clerk's JWKS; the resulting `clerkAuth.subject` (the Clerk userId) is what propagates to tool handlers.

```ts
// app/[transport]/route.ts (excerpt)
const clerkAuth = await auth({ acceptsToken: "oauth_token" });
if (!clerkAuth?.subject) return undefined;
return {
  token: bearerToken,
  clientId: clerkAuth.clientId ?? "",
  scopes: clerkAuth.scopes ?? [],
  extra: { clerkAuth },
};
```

- **Tool registration:** A central `registerTool(server, spec)` wrapper (`lib/tools/register.ts`) reads `extra.authInfo.extra.clerkAuth`, builds an `AuthContext` (`{ userId, orgId, sessionId, scopes, bearerToken }`), and dispatches to `spec.handler(auth, args)`. Two legacy tools (`claims_dump`, `recent_orders`) still use their own `register*()` functions per the M1 audit.
- **Tools registered today** (29): the `M2` hardened tool (`get_lastmile_order`), a diagnostic (`whoami_platform`), 12 M3 thin-passthrough reads, 7 enabled M3 writes, and 7 disabled-pending-M6 writes (handlers throw until guardrails land). Surface listing: see `route.ts` lines 49–92.

## Clerk

**Trust model:** Clerk is the IdP at *both* boundaries — same-IdP token exchange (V3b). This is the load-bearing architectural choice; details are inlined in `lib/quiqup.ts`.

### Inbound (request → MCP)
- `middleware.ts` wraps every non-static request in `clerkMiddleware()`.
- Route handler calls `auth({ acceptsToken: 'oauth_token' })` and forwards `subject` (userId), `orgId`, `sessionId`, `scopes` into the MCP auth extras.

### Outbound (MCP → Quiqup)
- `lib/quiqup.ts` mints a *templated session JWT* for the inbound user via `@clerk/backend`'s `clerk.sessions.getToken(sessionId, 'default')`.
- The `"default"` template's claims (`salesforceID`, `email`, `orgID`, `coreID`, `orgRole`, `firstName`, `lastName`, `courierSalesforceID`) are what Quiqup's platform-api gateway accepts — see `quiqupltd/quiqup-platform` `/auth/auth_api/domain/service.go → getUserFromClerkJWT`.
- Sessions aren't created synthetically; we reuse the user's existing active Clerk session (e.g. their Quiqdash login). If none exists, `getQuiqupReadyJwt` throws asking the user to sign into Quiqdash first.
- Cache is module-scoped `Map<userId, { sessionId, jwt, expiresAt }>` with a 50 s TTL (Clerk session JWTs live ~60 s in practice, despite dashboard).

### Issuer URL discovery
`lib/auth.ts:getClerkIssuerUrl()` honours `CLERK_ISSUER_URL` if set; otherwise decodes the `pk_(test|live)_<base64>` publishable key to recover the issuer domain. This drives the `jwks_uri` advertised at `/.well-known/oauth-protected-resource`.

## Quiqup APIs (outbound)

Quiqup splits its surface across two hostnames; the MCP exposes both through dedicated clients.

### Last-Mile API — `api-ae.quiqup.com`
- Client: `lib/clients/quiqup-lastmile.ts` (`QuiqupLastmileClient`).
- Override: `QUIQUP_LASTMILE_BASE_URL`.
- Auth: `Authorization: Bearer <minted Clerk session-JWT>` on every call.
- Errors: HTTP non-2xx maps to `QuiqupHttpError(status, body)`, which the tool wrapper catches and turns into a structured `isError: true` content block with field-level hints (`attribute_errors[].detail`, `error_details[].detail`).
- Special: non-JSON responses (PDF labels, etc.) are returned as `{ contentType, base64 }` from `client.request(...)`; consumers (e.g. `get_lastmile_order_label`) wrap them as an MCP `resource` block.
- Endpoints surfaced via MCP tools (path → tool name):
  - `GET /orders/{id}` — `get_lastmile_order`, `get_fulfilment_order` (no — see Fulfilment below)
  - `GET /orders/{id}/label` — `get_lastmile_order_label`
  - `POST /orders` — `create_lastmile_order`
  - `PATCH /orders/{id}` — `update_lastmile_order`
  - `POST /orders/{id}/parcels` — `add_parcel_to_order`
  - `DELETE /orders/{id}/parcels/{parcelId}` — `remove_parcel_from_order` *(disabled-pending-M6)*
  - `PUT /orders/batch/set_cancelled` — `cancel_lastmile_orders_batch` *(disabled)*
  - Plus other batch and "ready for collection" endpoints — see `lib/tools/*.ts` for exact paths.

There is also a small legacy convenience helper `quiqupLastmileGet<T>(path, query, userId)` in `lib/quiqup.ts` used by `recent_orders` — same auth, same error shape, slightly different ergonomics from the typed client.

### Fulfilment API — `platform-api.quiqup.com`
- Client: `lib/clients/quiqup-fulfilment.ts` (`QuiqupFulfilmentClient`).
- Override: `QUIQUP_FULFILMENT_BASE_URL`.
- Auth + errors: identical model to the last-mile client (shares `QuiqupHttpError` and `HttpMethod` re-exports).
- Endpoints surfaced via MCP tools (see `docs/quiqup-api/references/endpoints.md` for the full catalogue):
  - **Inventory**: `GET /api/fulfilment/inventory`, `GET /api/fulfilment/inventory/{sku}`, `GET /api/fulfilment/inventory/{sku}/batches`, `GET /api/fulfilment/batches/{batchId}`, `POST /api/fulfilment/inventory/adjustments`.
  - **Inbound**: `GET /api/fulfilment/slots/available`, `POST /api/fulfilment/inbound/book`, `GET /api/fulfilment/inbounds`, `GET /api/fulfilment/inbound/{id}`, `/{id}/state-history`, `/{id}/items`.
  - **Orders**: `POST /api/fulfilment/orders`, `GET /api/fulfilment/orders/{id}`, `PATCH /api/fulfilment/orders/{id}`.
  - **Products**: `POST /api/fulfilment/products`, `GET/PATCH /api/fulfilment/products/{sku}`, `POST /api/fulfilment/products/bulk/{validate,commit}`.

**Cross-border caveat (load-bearing):** the fulfilment `PATCH /api/fulfilment/orders/{id}` only routes *domestic* orders. For `service_kind` ∈ `{partner_export, partner_next_day}` with non-AE destinations, callers must instead use the last-mile host: `PUT https://api-ae.quiqup.com/orders/export/{id}`. The `update_fulfilment_order` tool description delegates this routing decision to the LLM — documented in `docs/quiqup-api/references/endpoints.md` and the `quiqup-fulfilment.ts` header.

### Platform-api `/me` probe
- `lib/tools/whoami-platform.ts` calls `GET https://platform-api.quiqup.com/me` with the exchanged JWT plus `x-api-version: 1` and surfaces `core_api_user_id`, `email`, `salesforce_id`, `region_code` (e.g. `uae.dubai`), roles, and `admin/courier/csr` flags. This is the canonical "is auth working?" probe; pair it with `claims_dump` (which decodes the *inbound* token).
- Override: `QUIQUP_PLATFORM_API_BASE_URL`.

## Anthropic API (eval-time only)

- Used by `evals/lastmile-order-creation.ts` and `evals/lastmile-order-roundtrip.ts`.
- Default model: `claude-sonnet-4-6` (override via `EVAL_MODEL`).
- Auto-instrumented through `@arizeai/openinference-instrumentation-anthropic` so every `anthropic.messages.create` lands as a Langfuse span.
- The eval *exposes the production tool spec* (`createLastmileOrderSpec.name` + `description` + `z.toJSONSchema(spec.inputSchema, ...)`) so regressions in the tool description / schema fail at eval time.
- **Not** used at MCP runtime. The MCP server does not call any LLM.

## Langfuse (eval-time only)

- SDK: `@langfuse/client ^5.3.0` + `@langfuse/otel ^5.3.0`.
- Bootstrap is per-eval (`evals/lastmile-order-creation.ts`):
  ```ts
  const otelSdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
    instrumentations: [new AnthropicInstrumentation()],
  });
  otelSdk.start();
  const langfuse = new LangfuseClient();
  ```
- Each dataset row becomes a trace; scorers in `evals/score-tool-call.ts` attach scores; the CI gate (`evals/gate.ts`, enabled via `EVAL_GATE=1`) enforces minimums (e.g. `args-overlap >= 0.85` for the offline suite, `create-2xx >= 1.0` for the online roundtrip).
- **Critical shutdown sequence:** `await langfuse.shutdown()` *then* `await otelSdk.shutdown()`. Without the explicit Langfuse drain, scores from late-running evaluators are dropped on process exit (verified 2026-05-13).
- **Env-var trap (per MEMORY.md):** CLI uses `LANGFUSE_HOST`; the SDK uses `LANGFUSE_BASE_URL`. The project is on `us.cloud.langfuse.com`.

## Quiqup staging OAuth (roundtrip eval only)

`evals/lastmile-order-roundtrip.ts` deliberately bypasses the V3b Clerk pipeline and hits `api.staging.quiqup.com` directly with OAuth2 `client_credentials`:

```ts
POST /oauth/token?grant_type=client_credentials&client_id=...&client_secret=...
```

This validates "Claude's args produce a valid order on staging" — not the full MCP HTTP/Clerk pipeline. Staging tokens live 1 h (vs 7 d on prod per `docs/quiqup-api/references/endpoints.md`). The eval cleans up after itself: try/finally around the create call attempts `PUT /orders/batch/set_cancelled` even on failure; orphaned orders are logged for manual cleanup.

## Webhooks, cron, scheduled work

None. The MCP server is purely request/response — no scheduled jobs, no webhooks, no background workers. The only "scheduled" component is GitHub Actions:

- `.github/workflows/evals.yml` — runs offline + online evals when eval-related paths change. Online job hits staging.
- `.github/workflows/claude-review.yml` — Anthropic-powered code review on every PR (skipped for forks because GitHub blocks secret access).

## Diagnostics quick-reference

| Symptom | First tool to call |
|---|---|
| "Is the inbound token valid? What claims does it carry?" | `claims_dump` (decodes the inbound `at+jwt` — pre-exchange) |
| "Does the exchanged token resolve on Quiqup's platform-api?" | `whoami_platform` (GET `/me`) |
| "What region/role is this request going to execute under?" | `whoami_platform` (returns `region_code`, `admin`, `courier`, `csr`) |
| Upstream 422 with no field detail | Tool wrapper now surfaces `attribute_errors[].detail` automatically — see `quiqupErrorToToolResult` in `lib/tools/register.ts` |
