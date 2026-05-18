# STACK.md

> Snapshot of language, runtime, framework, and tooling choices for `quiqup-mcp`. Last updated 2026-05-18.

## Languages & runtime

| Concern | Value | Source |
|---|---|---|
| Primary language | TypeScript (`^5`) | `package.json` devDependencies |
| TS `target` | `ES2017` | `tsconfig.json` |
| TS `module` / `moduleResolution` | `esnext` / `bundler` | `tsconfig.json` |
| JSX | `react-jsx` | `tsconfig.json` |
| Path alias | `@/*` → `./*` | `tsconfig.json` |
| `strict` | enabled | `tsconfig.json` |
| Node typings | `@types/node ^25.6.0` | `package.json` (devDeps) |
| Node engine | not pinned in `package.json` — Vercel runtime + Next 16 implicitly require Node ≥ 20 | — |
| React / React DOM | `19.2.4` | `package.json` |

The repo is a Next.js app (App Router), so the runtime in production is whatever Vercel's Node 20+ runtime exposes; locally it's whichever runtime is used to invoke `next` (see below).

## Package manager — pnpm declared, bun observed

The repo is contradictory and **bun is what's actually being used today**:

- `package.json` declares `"packageManager": "pnpm@10.30.3+sha512..."` — i.e. Corepack will resolve to pnpm.
- The only committed lockfile is `bun.lock` (lockfileVersion 1, root workspace name `quiqup-mcp-claims-dump`). No `pnpm-lock.yaml` exists.
- The evals scripts in `package.json` invoke `bun run ...` directly:
  ```json
  "eval:lastmile-orders": "bun run evals/lastmile-order-creation.ts",
  "eval:lastmile-roundtrip": "bun run evals/lastmile-order-roundtrip.ts"
  ```
- `README.md` / `evals/README.md` document `bun install`, `bun run dev`, `bun run test`.
- CI (`.github/workflows/evals.yml`) uses bun.

The `packageManager` field is the only signal pointing at pnpm. Action item for future planners: either delete the pnpm declaration (and the `trustedDependencies` / `ignoreScripts` keys which are pnpm-flavoured) or restore a `pnpm-lock.yaml` and stop calling `bun run` from scripts. As of today, **assume bun**.

## Framework — Next.js 16 (App Router + Turbopack)

- `next@16.2.4` with Turbopack-enabled dev server (`next dev --turbopack`).
- App Router layout under `app/`:
  - `app/layout.tsx` — root layout, Geist fonts.
  - `app/page.tsx` + `page.module.css` — marketing/landing for the MCP endpoint.
  - `app/[transport]/route.ts` — **the MCP transport endpoint** (dynamic segment), exports `GET` and `POST` bound to the same auth-wrapped handler.
- `middleware.ts` runs Clerk middleware globally (matcher excludes Next internals + static assets, always includes `/(api|trpc|.well-known)`).
- `next.config.ts` is empty — no custom config.
- `next-env.d.ts` present.

**AGENTS.md flag** (project root): _"This is NOT the Next.js you know. This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."_ Treat as binding; do not assume Next 14/15 conventions.

## Key dependencies (grouped by purpose)

### MCP server core
- `@modelcontextprotocol/sdk ^1.29.0` — typed `McpServer`, `ContentBlock`, tool registration.
- `mcp-handler ^1.1.0` — `createMcpHandler` + `withMcpAuth`. This is the Next-route adapter that turns the MCP server into a `GET`/`POST` HTTP handler.

### Auth (Clerk)
- `@clerk/nextjs ^7.2.7` — `clerkMiddleware`, `auth({ acceptsToken: 'oauth_token' })` for inbound JWT verification.
- `@clerk/backend ^3.4.1` (devDep — but used at runtime by `lib/quiqup.ts`!) — `createClerkClient` for outbound session-JWT minting via Backend API.
- `@clerk/mcp-tools ^0.5.0` — Clerk's helper layer for the MCP/OAuth dance.

> NOTE: `@clerk/backend` lives in `devDependencies` despite being imported by runtime code (`lib/quiqup.ts`). It happens to work because `@clerk/nextjs` transitively pulls `@clerk/backend` into the runtime bundle, but this should be moved to `dependencies` to be honest about it.

### Validation
- `zod ^4.3.6` — schemas on every tool's `inputSchema` and `outputSchema`. Note this is Zod **v4** (`z.toJSONSchema(...)` is used in `evals/lastmile-order-creation.ts` — a v4 API).

### Observability / evals (devDeps only — not loaded by the MCP server itself)
- `@langfuse/client ^5.3.0` and `@langfuse/otel ^5.3.0` — Langfuse OTel span processor + experiment runner. Only initialised inside `evals/*.ts`; the production MCP route has no Langfuse instrumentation today.
- `@opentelemetry/sdk-node ^0.218.0` — NodeSDK used by the eval runners.
- `@arizeai/openinference-instrumentation-anthropic ^0.1.10` — auto-instruments Anthropic SDK calls inside evals so each `messages.create` becomes a Langfuse span.
- `@anthropic-ai/sdk ^0.95.2` — the model under test in evals.

### Testing
- `vitest ^4.1.5` — unit tests under `tests/*.test.ts`.
- `msw ^2.14.2` — HTTP mocking at the `fetch` seam. Configured in `tests/setup/msw.ts` with `onUnhandledRequest: "error"` (no silent live network from tests).
- Cassettes (HTTP recordings) live in `tests/cassettes/`; integration suite in `tests/integration/mcp-flow.test.ts`.

## Build / run scripts (`package.json`)

```
dev                    next dev --turbopack
build                  next build
start                  next start
test                   vitest run
test:watch             vitest
test:integration       RUN_INTEGRATION=1 vitest run
eval:lastmile-orders   bun run evals/lastmile-order-creation.ts
eval:lastmile-roundtrip  bun run evals/lastmile-order-roundtrip.ts
```

`ignoreScripts: ["sharp","unrs-resolver"]` and `trustedDependencies: ["sharp","unrs-resolver"]` are pnpm-flavoured fields with no effect under bun.

## Config files reference

| File | Purpose | Highlights |
|---|---|---|
| `next.config.ts` | Next.js config | Empty (`NextConfig = {}`). |
| `tsconfig.json` | TS compiler | `strict`, `bundler` resolution, `@/*` alias, `target: ES2017`. |
| `vitest.config.ts` | Vitest | Node env, includes `tests/**/*.test.ts`, mirrors the `@` alias, registers `tests/setup/msw.ts`. |
| `middleware.ts` | Next middleware | `clerkMiddleware()` with a matcher that excludes static assets but includes `/api`, `/trpc`, `/.well-known`. |
| `.env.example` | Env var template | See below — values redacted. |
| `.github/workflows/evals.yml` | CI | Runs `eval:lastmile-orders` (offline gate `args-overlap >= 0.85`) and `eval:lastmile-roundtrip` (online, hits staging). |
| `.github/workflows/claude-review.yml` | CI | Auto code review on PRs via Anthropic. |

## Environment variables (key names only — no values)

From `.env.example`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   # Clerk publishable key (frontend, required by @clerk/nextjs)
CLERK_SECRET_KEY                    # Clerk backend secret — ONLY stored secret. Used for:
                                    #   1. Inbound JWT verification (auth() in route.ts)
                                    #   2. Outbound session-JWT minting (lib/quiqup.ts, V3b exchange)
CLERK_DOMAIN                        # e.g. clerk.quiqup.com — derives AS metadata
NEXT_PUBLIC_APP_URL                 # Resource indicator (RFC 8707) — must match deployed URL
CLERK_ISSUER_URL                    # Optional override; otherwise decoded from the pk_* key (see lib/auth.ts)

# Evals only (not used by the MCP server itself):
LANGFUSE_PUBLIC_KEY                 # Langfuse — pk-lf-...
LANGFUSE_SECRET_KEY                 # Langfuse — sk-lf-...
LANGFUSE_BASE_URL                   # https://cloud.langfuse.com (per MEMORY: project is on us.cloud.langfuse.com)
ANTHROPIC_API_KEY                   # Model under test
QUIQUP_STAGING_CLIENT_ID            # OAuth2 client_credentials for the online round-trip eval
QUIQUP_STAGING_CLIENT_SECRET        # ditto
QUIQUP_LM_STAGING_BASE_URL          # Optional; default https://api.staging.quiqup.com
```

Used by code but **not** in `.env.example` — discovered via grep:

```
QUIQUP_LASTMILE_BASE_URL            # lib/clients/quiqup-lastmile.ts; default https://api-ae.quiqup.com
QUIQUP_FULFILMENT_BASE_URL          # lib/clients/quiqup-fulfilment.ts; default https://platform-api.quiqup.com
QUIQUP_PLATFORM_API_BASE_URL        # lib/tools/whoami-platform.ts; default https://platform-api.quiqup.com
EVAL_MODEL                          # evals/*; default claude-sonnet-4-6
EVAL_GATE                           # set to "1" to enforce CI gates (evals/gate.ts)
RUN_INTEGRATION                     # set to "1" to enable tests/integration/mcp-flow.test.ts
```

## Top-level directory layout

```
app/                  Next.js App Router
  [transport]/route.ts  ← MCP HTTP endpoint (GET/POST)
  layout.tsx, page.tsx, globals.css, icon.svg

lib/
  auth.ts             Clerk issuer URL derivation
  quiqup.ts           V3b outbound auth: Clerk session-JWT mint + cache + quiqupLastmileGet()
  clients/
    quiqup-lastmile.ts    Typed client → api-ae.quiqup.com
    quiqup-fulfilment.ts  Typed client → platform-api.quiqup.com
  tools/              One file per MCP tool; register.ts is the wrapper (ToolSpec + auth ctx)

evals/                Offline + online eval runners (Anthropic + Langfuse)
tests/                Vitest unit + integration tests, MSW handlers, JSON cassettes
docs/                 HOW-IT-WORKS.md, quiqup-api/ skill, design notes
flow/                 (small) — flow diagrams / scratch
public/               Static assets
middleware.ts         Clerk middleware
```

## Unusual / load-bearing choices

- **V3b same-IdP token exchange.** No Quiqup-side OAuth client credentials are stored. The MCP receives a Clerk `at+jwt`, then `lib/quiqup.ts` uses `@clerk/backend` to mint a *session-shaped* JWT (template `"default"`) for the same user and forwards that to Quiqup's gateway. The only secret on this server is `CLERK_SECRET_KEY`. See `lib/quiqup.ts` header comment for the full rationale.
- **Cached session-JWTs are short-lived (~50 s).** Despite Clerk dashboard claims, observed lifetime is short; cache TTL in `lib/quiqup.ts` is `50_000 ms` with a 10 s safety margin.
- **Tools are registered through a custom `ToolSpec` wrapper.** `lib/tools/register.ts` extracts `clerkAuth` from `extra.authInfo.extra`, builds an `AuthContext`, and (importantly) converts upstream `QuiqupHttpError` into structured tool-result blocks (`isError: true`) with field-level hints. The wrapper does **not** yet enforce `outputSchema` at runtime — that's a tagged `TODO(M4)`.
- **Tool-result content uses the full `ContentBlock` union, not just text.** PDF labels return as a `resource` block, not a base64 text blob — see `lib/tools/get-lastmile-order-label.ts` and the 2026-05-14 fix comment.
- **JSON-Schema-for-tools is derived from the Zod schema.** Eval runner uses `z.toJSONSchema(spec.inputSchema, { target: 'draft-07', io: 'input' })` so the LLM in the eval sees the exact shape MCP serialises in production — protects against the 2026-05-14 `{ properties: {} }` regression where `.passthrough()` produced an empty schema.
- **Two `package.json` keys (`ignoreScripts`, `trustedDependencies`) are pnpm-only.** Currently no-ops under bun.
