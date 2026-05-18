# Structure — quiqup-mcp

_Last mapped: 2026-05-18_

## Top-level layout

```
quiqup-mcp/
├── app/                          Next.js 16 App Router surface
│   ├── [transport]/route.ts      THE MCP endpoint (dynamic segment: /mcp, /sse, …)
│   ├── .well-known/
│   │   └── oauth-protected-resource/route.ts   OAuth discovery for MCP clients
│   ├── layout.tsx, page.tsx      Marketing landing page (incidental)
│   ├── globals.css, page.module.css, icon.svg
├── lib/                          Domain logic
│   ├── auth.ts                   Clerk issuer-URL derivation helper
│   ├── quiqup.ts                 V3b token exchange (Clerk userId -> Quiqup JWT)
│   ├── clients/
│   │   ├── quiqup-lastmile.ts    HTTP client for api-ae.quiqup.com (+ QuiqupHttpError)
│   │   └── quiqup-fulfilment.ts  HTTP client for platform-api.quiqup.com
│   └── tools/                    One file per MCP tool
│       ├── register.ts           ToolSpec contract + registerTool() wrapper
│       ├── claims-dump.ts        Legacy style (own register*() function)
│       ├── recent-orders.ts      Legacy style
│       ├── get-lastmile-order.ts            M2 hardened
│       ├── create-lastmile-order.ts         M3 thin pass-through (eval-tuned desc)
│       ├── get-lastmile-order-label.ts      Binary -> MCP resource block
│       ├── whoami-platform.ts               Auth-vs-payload diagnostic
│       └── ... (28 tool files total)
├── middleware.ts                 clerkMiddleware() at root, default config
├── evals/                        Offline Langfuse evals (bun scripts)
│   ├── lastmile-order-creation.ts        Eval runner (entrypoint)
│   ├── lastmile-order-roundtrip.ts       Eval runner (entrypoint)
│   ├── score-tool-call.ts                Shared evaluators
│   ├── gate.ts                           CI gate (EVAL_GATE=1)
│   ├── README.md
│   └── datasets/
│       ├── lastmile-order-creation-v1.ts
│       └── lastmile-order-roundtrip-v1.ts
├── tests/                        Vitest unit + integration
│   ├── setup/
│   │   ├── msw.ts                MSW server, onUnhandledRequest: "error"
│   │   └── oauth-protected-resource/
│   ├── cassettes/                Recorded Quiqup responses (JSON)
│   │   ├── get-lastmile-order.json
│   │   ├── get-lastmile-order-label.json
│   │   └── README.md
│   ├── integration/
│   │   └── mcp-flow.test.ts      RUN_INTEGRATION=1; uses Clerk testingTokens
│   ├── auth.test.ts
│   ├── get-lastmile-order.test.ts, get-lastmile-order-label.test.ts
│   ├── create-product.test.ts, update-product.test.ts
│   ├── claims-dump.test.ts, mark-ready-for-collection.test.ts
│   ├── bulk-commit-products.test.ts, bulk-validate-products.test.ts
│   └── get-product-by-sku.test.ts
├── docs/
│   ├── HOW-IT-WORKS.md           Auth + token exchange explainer
│   ├── design/                   Per-tool design docs (label-api/evals/qa)
│   └── quiqup-api/               Upstream API references + extraction scripts
│       ├── SKILL.md
│       ├── references/           Endpoint docs the LLM/devs consult
│       └── scripts/
├── flow/flow_bpmn.html           One-off BPMN diagram of the auth flow (static)
├── public/                       Static assets
├── .github/                      CI workflows
├── .claude/                      Local Claude Code config (commands, hooks, agents)
├── .planning/codebase/           This directory
├── package.json                  pnpm; deps + bun-run eval scripts
├── tsconfig.json                 Path alias: @/* -> ./*
├── vitest.config.ts              Loads tests/setup/msw.ts
├── next.config.ts, next-env.d.ts
├── README.md, AGENTS.md, CLAUDE.md (-> AGENTS.md)
└── .env.example, .env.local
```

## Per-directory purpose

### `app/`
Next.js App Router. Production code is **only** in `[transport]/route.ts` and `.well-known/oauth-protected-resource/route.ts`. The marketing `page.tsx` exists because Next requires a root route; not part of the MCP surface.

### `lib/clients/`
Typed Quiqup HTTP clients. Two files, one per upstream base URL. Both expose a generic `request(method, path, { body?, query? })`. Add a new file here **only** when integrating a new Quiqup base URL — otherwise extend an existing client with a typed wrapper or use `.request(...)` directly from the tool.

### `lib/tools/`
One file per MCP tool. The file is the unit of testability, eval-ability, and review. Every modern file exports `export const spec: ToolSpec<...>` and is imported by `app/[transport]/route.ts`. Two legacy files (`claims-dump.ts`, `recent-orders.ts`) export `registerClaimsDump`/`registerRecentOrders` functions instead — flagged for migration.

### `lib/` (root utilities)
- `auth.ts` — decodes the Clerk publishable key to derive the issuer URL.
- `quiqup.ts` — **load-bearing**. The V3b token exchange + in-memory session-JWT cache. Also contains a legacy `quiqupLastmileGet` helper still used by `recent-orders.ts`.

### `evals/`
Offline eval harness, runs via `bun run`. Datasets are plain TS exports. Scoring uses Langfuse evaluators (`evals/score-tool-call.ts`). The runners boot OTel + Langfuse, run the experiment, and shut down explicitly (mandatory — otherwise scores drop).

### `tests/`
Vitest. **Seam: MSW at fetch** (see `tests/setup/msw.ts` — `onUnhandledRequest: "error"` to enforce no accidental network hits). Recorded Quiqup responses live as JSON cassettes in `tests/cassettes/` and are loaded by individual `*.test.ts` files. Integration test in `tests/integration/mcp-flow.test.ts` is gated by `RUN_INTEGRATION=1` and uses Clerk's testingTokens API.

### `docs/`
- `HOW-IT-WORKS.md` — auth flow primer.
- `design/` — per-tool design docs (e.g., the PDF-as-resource decision).
- `quiqup-api/references/` — upstream API documentation; the source of truth for what Quiqup accepts.

### `flow/`
Single static HTML file (`flow_bpmn.html`, 41KB) — a BPMN diagram of the auth flow. **Not loaded by the app.** Treat as documentation. Likely scaffolding scheduled for cleanup.

## Naming conventions

| Layer | File case | Symbol case | Example |
|---|---|---|---|
| Tool files | `kebab-case.ts` | `spec` (const) | `create-lastmile-order.ts` exports `spec` |
| Tool names (MCP) | `snake_case` string | — | `"create_lastmile_order"` |
| HTTP clients | `kebab-case.ts` | `PascalCase` class | `quiqup-lastmile.ts` -> `QuiqupLastmileClient` |
| Tests | `<tool-name>.test.ts` | — | `create-product.test.ts` |
| Cassettes | `<tool-name>.json` | — | `get-lastmile-order.json` |
| Eval datasets | `<eval-name>-v<n>.ts` | — | `lastmile-order-creation-v1.ts` |
| Zod schemas | `inputSchema` / `outputSchema` (consts inside the tool file) | — | always these two names |

## Where new code goes

### New MCP tool
1. Create `lib/tools/<tool-name>.ts` exporting `export const spec: ToolSpec<typeof inputSchema, typeof outputSchema>`. Mirror an existing modern tool (`get-lastmile-order.ts` is the canonical M2 example; `create-lastmile-order.ts` shows the eval-tuned description pattern).
2. **Declare every input field explicitly** in `inputSchema`. `.passthrough()` does not surface fields in the JSON schema the LLM sees (see commit `7be13a9`).
3. Add the import + one `registerTool(server, spec);` line in `app/[transport]/route.ts`.
4. Add `tests/<tool-name>.test.ts`; if the tool calls a new Quiqup endpoint, drop a cassette in `tests/cassettes/`.
5. If the tool warrants an eval, add a dataset in `evals/datasets/` and a runner script + a `eval:<name>` script in `package.json`.

### New Quiqup endpoint client method
Extend `QuiqupLastmileClient` or `QuiqupFulfilmentClient` in `lib/clients/`. Add a typed wrapper method only when the tool is being hardened (cassette + tests); otherwise use the generic `.request(...)` from the tool handler.

### New Quiqup base URL
New file in `lib/clients/`. Re-use `QuiqupHttpError` from `quiqup-lastmile.ts` (don't redefine).

### New eval
1. Dataset in `evals/datasets/<name>-v<n>.ts` exporting `items` array typed against `ExperimentTask`-compatible shapes.
2. Runner script in `evals/<name>.ts` that boots OTel + Langfuse, calls `langfuse.experiment.run`, then `langfuse.shutdown()` + `otelSdk.shutdown()` (mandatory).
3. Add `"eval:<name>": "bun run evals/<name>.ts"` to `package.json`.
4. Optionally invoke `gate(result, [...])` under `EVAL_GATE=1` for CI.

### New test
Unit/seam tests next to siblings in `tests/`. Use MSW (`server.use(...)`) to stub Quiqup; do **not** make real network calls — `onUnhandledRequest: "error"` will fail the run. Mock `@/lib/quiqup` with `vi.mock` to bypass the Clerk-backed JWT mint.

## Files worth bookmarking

| File | Why |
|---|---|
| `app/[transport]/route.ts` | Tool registry. Every tool import lands here. |
| `lib/tools/register.ts` | `ToolSpec` contract + the only place where Quiqup errors are mapped to MCP tool errors. M4/M6 guardrails will land here. |
| `lib/quiqup.ts` | V3b token exchange + JWT cache. Single source for "how outbound auth works". |
| `lib/clients/quiqup-lastmile.ts` | The HTTP shape every tool sees. Carries the binary/JSON content-type branch. |
| `lib/tools/create-lastmile-order.ts` | The eval-tuned-description benchmark; mirror its description style for new write tools. |
| `lib/tools/get-lastmile-order.ts` | The M2 hardened reference (cassette + error mapping + output schema). |
| `lib/tools/get-lastmile-order-label.ts` | The PDF-as-MCP-resource pattern (commit `94fa175`). |
| `tests/setup/msw.ts` | Seam policy: no accidental network. |
| `evals/lastmile-order-creation.ts` | The eval runner template (OTel + Langfuse + shutdown). |
| `docs/quiqup-api/references/` | Upstream API truth — consult before guessing field names. |

## Load-bearing files (by size)

```
199 lib/tools/register.ts                 ToolSpec + wrapper + error mapper
159 lib/quiqup.ts                         V3b token exchange + cache
150 lib/tools/recent-orders.ts            Legacy-style registration
150 lib/tools/create-lastmile-order.ts    ~50-line description, full Zod tree
 98 lib/tools/get-lastmile-order-label.ts Binary + resource handling
 95 lib/tools/whoami-platform.ts          Diagnostic, full output schema
 85 lib/clients/quiqup-lastmile.ts        HTTP client + QuiqupHttpError
 82 lib/tools/claims-dump.ts              Legacy-style registration
 77 lib/tools/get-lastmile-order.ts       M2 hardened canonical
 62 lib/clients/quiqup-fulfilment.ts      HTTP client (reuses QuiqupHttpError)
```

Most tool files are 30–45 lines (thin M3 pass-throughs). The four files above 80 lines carry real logic and tests; treat them as architectural surface area.

## Things to ignore

- `flow/flow_bpmn.html` — static documentation diagram, not loaded.
- `app/page.tsx`, `app/page.module.css`, `app/globals.css` — incidental landing page.
- `next-env.d.ts`, `tsconfig.tsbuildinfo` — generated.
- `.next/`, `.vercel/`, `node_modules/`, `bun.lock` — build artifacts / lockfile.

## Path alias

`tsconfig.json` maps `@/*` → repo root. Imports always look like `@/lib/tools/register`, `@/lib/clients/quiqup-lastmile`, `@/lib/quiqup`.
