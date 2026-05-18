# Architecture — quiqup-mcp

_Last mapped: 2026-05-18_

## What this is

A **Next.js 16 App Router** application that exposes the Quiqup logistics platform as an **MCP (Model Context Protocol) server**. There is no traditional UI; the marketing landing page (`app/page.tsx`) is incidental. The one production surface is `POST /[transport]` (in practice `/mcp`), which speaks JSON-RPC over HTTP per the MCP spec.

Identity is brokered by **Clerk** end-to-end: inbound auth uses Clerk's OAuth `at+jwt` issuance; outbound calls to Quiqup use a **same-IdP token exchange** (V3b pattern) where the user's Clerk `userId` is exchanged for a Quiqup-shaped session JWT via Clerk's backend SDK. No Quiqup partner secret is held server-side.

## Entry points

| Surface | File | Role |
|---|---|---|
| MCP transport | `app/[transport]/route.ts` | Single chokepoint that registers every tool with `createMcpHandler`, wraps with `withMcpAuth`, exports as `GET`/`POST`. Dynamic segment lets the route serve `/mcp`, `/sse`, etc. |
| OAuth discovery | `app/.well-known/oauth-protected-resource/route.ts` | Emits MCP-spec-required `resource` metadata so Claude.ai/clients discover the Clerk issuer + scopes. Overrides the helper's default origin-only `resource` URL. |
| Next middleware | `middleware.ts` | `clerkMiddleware()` — installs `auth()` context on every matched request. No custom logic. |
| Eval runners | `evals/lastmile-order-creation.ts`, `evals/lastmile-order-roundtrip.ts` | `bun run` entrypoints; offline Langfuse experiments against the live tool spec. |
| Dev server | `next dev --turbopack` (via `pnpm dev`) | Standard Next dev loop. |

## Layering

```
app/[transport]/route.ts        <- composition root: imports every tool spec
        |
        v
lib/tools/*.ts                  <- one file per MCP tool (handler + Zod schemas)
        |
        v
lib/tools/register.ts           <- ToolSpec contract + registerTool() wrapper
        |
        v
lib/clients/quiqup-*.ts         <- typed HTTP clients (one per Quiqup base URL)
        |
        v
lib/quiqup.ts                   <- V3b token exchange (Clerk userId -> Quiqup JWT)
        |
        v
lib/auth.ts                     <- Clerk issuer URL derivation utility
```

**Dependency direction is strictly downward.** `app/` imports from `lib/`; `lib/tools/` imports from `lib/clients/` and `lib/quiqup.ts`; clients import nothing from tools. Two legacy tools (`claims-dump.ts`, `recent-orders.ts`) bypass `register.ts` and call `server.registerTool` directly — these predate the M2 `ToolSpec` contract and are flagged in route.ts as "legacy".

## Request lifecycle (happy path)

1. **Client → Next.js**: Claude.ai POSTs JSON-RPC to `https://<host>/mcp` with `Authorization: Bearer <at+jwt>`.
2. **Clerk middleware** matches the request and attaches Clerk auth context.
3. **`withMcpAuth` verifier** (in `route.ts`) calls `auth({ acceptsToken: "oauth_token" })` to validate the at+jwt as a Clerk OAuth access token. On success it returns `{ token, clientId, scopes, extra: { clerkAuth } }`. On failure the MCP handler responds 401 with a `WWW-Authenticate` pointing at the discovery doc.
4. **mcp-handler** parses the JSON-RPC envelope, looks up the tool by `name`, validates `arguments` against the registered Zod `inputSchema.shape`, invokes the handler closure.
5. **`registerTool` wrapper** (`lib/tools/register.ts`) builds a flat `AuthContext` from `extra.authInfo.extra.clerkAuth` (subject → userId, etc.) and calls the spec's `handler(auth, args)` inside a try/catch.
6. **Tool handler** asserts `auth.userId`, calls `getQuiqupReadyJwt(auth.userId)` to mint a Quiqup-shaped session JWT, constructs a `QuiqupLastmileClient` or `QuiqupFulfilmentClient`, and issues the upstream call.
7. **Quiqup HTTP client** sends `Authorization: Bearer <session-jwt>` to api-ae.quiqup.com or platform-api.quiqup.com; on non-2xx it throws `QuiqupHttpError(status, body)`.
8. **Response shaping**: handler returns `{ content: ContentBlock[] }` — usually a single `text` block with `JSON.stringify(upstream, null, 2)`, sometimes a `text + resource` pair for binary (PDF labels — see commit `94fa175`).
9. **Error mapping**: if the handler throws `QuiqupHttpError`, the wrapper converts it to an `{ isError: true, content: [text] }` payload with the body (truncated to 4KB) and a status-class hint. This is the only error normalisation today; other thrown errors propagate as RPC errors.

## V3b token exchange (`lib/quiqup.ts`)

The MCP receives an OAuth `at+jwt` that lacks the custom claims Quiqup's gateway expects (`salesforceID`, `email`, `orgID`, `coreID`, `orgRole`, …). `getQuiqupReadyJwt(userId)`:

1. Looks up the user's most recent **active Clerk session** (must have logged into Quiqdash or another Clerk-protected Quiqup app first to bootstrap).
2. Calls `clerk.sessions.getToken(sessionId, "default")` to mint a session-shaped JWT with the "default" template (matches what Quiqdash emits).
3. Caches per-userId for 50 seconds (10s safety margin under Clerk's ~60s real lifetime).
4. On a revoked session, re-lists and retries once before throwing.

This is the security boundary worth respecting: the cached JWT is in-process memory, key-by-userId, never persisted. The bearer token is also forwarded into `AuthContext.bearerToken` but is flagged for redaction at M6.

## MCP tool pattern

Every modern tool exports a `spec: ToolSpec<InputZ, OutputZ>` and is registered via `registerTool(server, spec)`:

```ts
// lib/tools/get-lastmile-order.ts (representative)
const inputSchema = z.object({ order_id: z.string().min(1) });
const outputSchema = z.object({ id: z.number(), state: z.string(), /* … */ }).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_lastmile_order",
  description: "Fetch a single Quiqup Last-Mile order by ID from api-ae.quiqup.com.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) throw new Error("…requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupLastmileClient({ jwt });
    const { order } = (await client.getOrder(args.order_id)) as { order: unknown };
    return { content: [{ type: "text" as const, text: JSON.stringify(order, null, 2) }] };
  },
};
```

Conventions:

- **Tool name** is snake_case matching the upstream operation (`create_lastmile_order`, `whoami_platform`).
- **File name** is kebab-case mirroring the tool name (`create-lastmile-order.ts`).
- **`inputSchema`** is always a `z.object({...})` (the SDK wants `.shape`, not a raw map). Use `.passthrough()` for optional/extensible payloads but **declare every field explicitly** — `.passthrough()` does not surface fields in the serialised JSON schema the LLM sees. This was the M4 fix in commit `7be13a9` (`create_lastmile_order` was serialising to `properties: {}` and the LLM was calling with `{}`).
- **`outputSchema`** is carried for tests; the wrapper does **not** enforce it at runtime (TODO M4).
- **Description is load-bearing.** Eval-driven improvement is documented in MEMORY.md (`eval-driven-description-improvement`): thin descriptions cost 4.5× args-consistency. The `create_lastmile_order` description is ~50 lines of explicit field guidance, warnings (e.g. the `references` poison footgun), and cross-field rules.
- **Auth check** is the first line of every handler: `if (!auth.userId) throw new Error(...)`.

## HTTP client pattern (`lib/clients/`)

Two clients, one per Quiqup base URL:

| Client | Base URL | Used by |
|---|---|---|
| `QuiqupLastmileClient` | `https://api-ae.quiqup.com` | Last-mile orders, labels, inventory reads. |
| `QuiqupFulfilmentClient` | `https://platform-api.quiqup.com` | Fulfilment orders, inbound slots, products, `whoami_platform`. |

Both share:

- Constructor takes `{ jwt, baseUrl? }`. JWT is forwarded as `Authorization: Bearer <jwt>`.
- Single `request(method, path, { body?, query? })` method. Body is JSON-stringified iff defined; query keys are appended verbatim (so `filters[state]` works without manual encoding).
- Non-2xx throws `QuiqupHttpError(status, body)` — the body string flows up to the wrapper's `quiqupErrorToToolResult`, which surfaces it to the LLM with a status-class hint.
- `204` returns `null`.
- **Binary handling**: `QuiqupLastmileClient.request` inspects `content-type`; non-JSON responses return `{ contentType, base64 }`. The `get_lastmile_order_label` tool (commit `94fa175`) re-packages that into an MCP `resource` content block with `mimeType: application/pdf, blob: <base64>` so the host extracts bytes without them entering model context.
- `QuiqupFulfilmentClient` does not currently have the binary branch — fulfilment endpoints all return JSON.

`QuiqupHttpError` is exported from `quiqup-lastmile.ts` and **re-exported** by `quiqup-fulfilment.ts` and consumed by `register.ts`. Single class across both clients.

## Auth flow (Clerk → tool handler)

```
1. inbound at+jwt
     |  Authorization: Bearer <at+jwt>
     v
2. middleware.ts: clerkMiddleware()
     |  attaches Clerk request context
     v
3. route.ts: withMcpAuth verifier
     |  await auth({ acceptsToken: "oauth_token" })
     |  -> { subject, clientId, scopes, orgId, sessionId }
     v
4. mcp-handler -> tool dispatch
     |  extra.authInfo.extra.clerkAuth = { subject, … }
     v
5. registerTool wrapper -> AuthContext
     |  { userId, orgId, sessionId, scopes, bearerToken }
     v
6. handler: getQuiqupReadyJwt(auth.userId)
     |  Clerk backend SDK: sessions.getToken(sessionId, "default")
     v
7. fetch upstream with new bearer
```

Two diagnostic tools exist for triaging this chain: `claims_dump` (decodes the inbound at+jwt) and `whoami_platform` (round-trips the exchanged JWT against `platform-api.quiqup.com/me`).

## Observability

- **Langfuse** is wired into the **eval scripts only**, not the production request path. `evals/lastmile-order-creation.ts` boots an OTel `NodeSDK` with `LangfuseSpanProcessor` + `AnthropicInstrumentation`, runs an experiment via `langfuse.experiment.run`, and explicitly drains `langfuse.shutdown()` + `otelSdk.shutdown()` (the 2026-05-13 fix for dropped scores).
- **Datasets** live in `evals/datasets/*.ts` as plain TS arrays; scoring functions in `evals/score-tool-call.ts`; CI gate in `evals/gate.ts` (opt-in via `EVAL_GATE=1`).
- **No instrumentation.ts** at the repo root — production requests are not yet traced to Langfuse. (Likely M5/M6 work.)
- **Per-call audit logging** is a flagged TODO inside `register.ts` and `quiqup.ts`; bearer-token redaction is the open requirement.

## Data flow — happy MCP request

```
Claude.ai
  | POST /mcp  Authorization: Bearer <at+jwt>
  v
Next.js middleware (Clerk context)
  v
app/[transport]/route.ts
  +-- withMcpAuth verifier --> auth({ acceptsToken: "oauth_token" })
  +-- createMcpHandler dispatches JSON-RPC "tools/call"
       v
       lib/tools/register.ts :: registerTool closure
         +-- builds AuthContext from extra.authInfo.extra.clerkAuth
         +-- calls spec.handler(auth, args)
              v
              lib/tools/<tool>.ts handler
                +-- getQuiqupReadyJwt(auth.userId)            [lib/quiqup.ts]
                |     -> Clerk backend SDK -> session JWT (cached 50s)
                +-- new QuiqupLastmileClient({ jwt })          [lib/clients/]
                +-- client.request("POST", "/orders", {body})
                |     -> fetch api-ae.quiqup.com
                |     -> 2xx JSON | 2xx binary({base64}) | throw QuiqupHttpError
                +-- shape ContentBlock[]                       (text | resource)
              ^
         +-- catch QuiqupHttpError -> quiqupErrorToToolResult (isError: true)
       v
  JSON-RPC response back to client
```

## Notable architectural decisions

- **Single composition root**: every tool import lands in `route.ts`. Add a tool = add an import + one `registerTool(server, spec)` line.
- **The wrapper is the single chokepoint** (`register.ts`) for future M4/M6 guardrails: output-size limits, scope enforcement, audit log, idempotency, output-schema warn. Today it's a thin pass-through.
- **No DB.** The MCP server is stateless except for the in-process JWT cache in `lib/quiqup.ts` (lost on cold start, intentionally).
- **`flow/flow_bpmn.html`** is a static one-off BPMN diagram of the auth flow; not loaded by the app. Treat as documentation, not code.
- **Two coexisting tool registration styles** (legacy `register*()` vs modern `ToolSpec` + `registerTool`). New tools must use the modern style; legacy `claims-dump` and `recent-orders` are technical debt called out in `route.ts` comments.
