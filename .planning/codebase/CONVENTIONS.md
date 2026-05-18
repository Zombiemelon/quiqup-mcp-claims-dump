# Code conventions — quiqup-mcp

Snapshot: 2026-05-18. Source of truth: actual files, not aspiration. When a pattern is in flux (e.g. M3 thin pass-throughs awaiting M4 hardening) it is called out explicitly.

## TypeScript settings

`tsconfig.json`:

- `"strict": true` — full strict bundle (noImplicitAny, strictNullChecks, etc.)
- `"target": "ES2017"`, `"module": "esnext"`, `"moduleResolution": "bundler"`
- `"isolatedModules": true` (required by Next.js)
- `"noEmit": true` — `tsc` is type-check only; Next/Turbopack compiles
- Path alias: `"@/*": ["./*"]` — used throughout (`@/lib/...`)

There are no extra `noUncheckedIndexedAccess`, `noImplicitOverride`, or `exactOptionalPropertyTypes` opt-ins; default strict-mode rigor only.

## File naming

Uniformly **kebab-case `.ts`**, no exceptions in the surfaces inspected:

- `lib/tools/get-lastmile-order.ts`, `lib/tools/create-lastmile-order.ts`, `lib/tools/whoami-platform.ts`
- `lib/clients/quiqup-lastmile.ts`, `lib/clients/quiqup-fulfilment.ts`
- `tests/get-lastmile-order.test.ts`, `tests/mark-ready-for-collection.test.ts`
- `evals/lastmile-order-creation.ts`, `evals/datasets/lastmile-order-creation-v1.ts`

The tool *name* (the MCP-surfaced identifier) is **snake_case**: `create_lastmile_order`, `whoami_platform`. The filename is the kebab form of that name. This 1:1 mapping is load-bearing — `app/[transport]/route.ts` imports specs as `from "@/lib/tools/<kebab-of-tool-name>"`.

App Router uses Next.js conventions: `app/[transport]/route.ts`, `app/layout.tsx`, `app/page.tsx`.

## Module export style

- **Named exports throughout.** No `export default` in `lib/`, `tests/`, or `evals/`.
- Each tool file exports `export const spec: ToolSpec<...>` (modern pattern) — or, for two legacy tools (`claims-dump.ts`, `recent-orders.ts`), `export function registerXxx(server)` directly. M1 audit calls these out; new tools must use the `spec` pattern.
- No `index.ts` barrel files anywhere. Each consumer imports the specific module path.
- Schema constants are file-local (`const inputSchema = ...`) and not exported; tests import them transitively via `spec.inputSchema`.

## Schema conventions (Zod v4)

- Schemas live **co-located with the tool** in `lib/tools/*.ts`. No central `schemas/` directory.
- Naming: lowercase const, role-suffixed — `inputSchema`, `outputSchema`, plus locals like `addressSchema`, `contactSchema`, `itemSchema` (`lib/tools/create-lastmile-order.ts`).
- All input schemas are `z.object({...})` (the wrapper enforces this via `TIn extends z.ZodObject<any>` — see `lib/tools/register.ts:36`). The wrapper calls `spec.inputSchema.shape` and hands the raw shape map to the MCP SDK.
- **Every input schema declares its fields explicitly.** A bug fixed on 2026-05-14 (commit `7be13a9`) showed that `z.object({}).passthrough()` serialises to JSON-Schema `{ properties: {} }`, so MCP clients see an empty parameter list and call the tool with `{}`. `.passthrough()` only affects runtime parsing — never rely on it to hide fields from the LLM.
- Output schemas typically use `.passthrough()` to model only the load-bearing fields strictly while letting new upstream fields flow through (see `get-lastmile-order.ts:19-28`).
- `.describe()` is used sparingly — mostly in legacy `recent-orders.ts` (per-field) and a handful of new fields. Most field-level documentation lives in the tool **description string**, not on the schema.

## MCP tool definition pattern

The modern template (use this for new tools):

```ts
import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupLastmileClient } from "@/lib/clients/quiqup-lastmile";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

const inputSchema = z.object({ order_id: z.string().min(1, "order_id is required") });
const outputSchema = z.object({ /* load-bearing fields */ }).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_lastmile_order",
  description: "Fetch a single Quiqup Last-Mile order by ID from api-ae.quiqup.com.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) throw new Error("get_lastmile_order requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupLastmileClient({ jwt });
    // ...
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
};
```

Handlers receive a flat `AuthContext` (`userId`, `orgId`, `sessionId`, `scopes`, `bearerToken`) built by `registerTool` from `extra.authInfo` (`lib/tools/register.ts:182`). The wrapper extracts Clerk fields once so handlers never re-do that.

Registration is centralised in `app/[transport]/route.ts` — every new tool gets one `import { spec as fooSpec }` plus one `registerTool(server, fooSpec)` call.

## Error handling

Two layers, established at M4 (commit `eb750a2`):

1. **Client layer** (`lib/clients/quiqup-lastmile.ts:69`) — non-2xx responses raise `QuiqupHttpError(status, body)`. The class carries the raw upstream body as a string.
2. **Wrapper layer** (`lib/tools/register.ts:68`) — `registerTool` wraps every handler in a try/catch. Any `QuiqupHttpError` bubbling out becomes a structured MCP tool result with `isError: true`, body truncated to 4000 chars, and a status-specific *hint* (e.g. "inspect `attribute_errors[].detail` for the rejected field"). Other errors rethrow.

The hardened tool `get_lastmile_order` *additionally* remaps 404/401/403/5xx into human-readable `Error` messages inside the handler itself (`get-lastmile-order.ts:50-65`). Thin pass-through tools (M3) skip that and rely solely on the wrapper. Either path is valid; do not mix both inside one handler — pick one.

Tools that return `isError: true` directly (no throw) handle "expected" guard cases such as unexpected content-type from upstream (`get-lastmile-order-label.ts:66-79`).

## Logging / debugging

- No structured logger is wired up. `console.error` appears once in tests behind `eslint-disable` (`tests/get-lastmile-order.test.ts:93`).
- Production observability is via **Langfuse + OpenTelemetry** in the eval path (`evals/lastmile-order-creation.ts:38-42`). The MCP server itself does not currently emit Langfuse spans — that lands later.
- Diagnostic-by-design tools: `claims_dump` (decodes inbound `at+jwt`) and `whoami_platform` (resolves exchanged session-JWT against platform-api). When debugging auth-vs-payload issues, call `whoami_platform` first.

## Comments

Comments are **heavy and load-bearing**, not decorative. Three patterns recur:

- **Why-this-exists block** at top of file — paragraph explaining the auth/error model and the trade-offs taken. See `lib/quiqup.ts:1-25`, `lib/clients/quiqup-lastmile.ts:1-16`.
- **Inline bug-history notes** dated `YYYY-MM-DD` explaining a non-obvious decision (`create-lastmile-order.ts:14-18`, `get-lastmile-order-label.ts:6-13`). Future editors should *append* a new dated note rather than rewriting history.
- **`TODO(M4|M6|verify)` markers** with rationale and reviewer attribution ("Flagged in 2026-05-03 review"). These map to roadmap milestones — do not silently delete.

## Async style

`async/await` exclusively. No raw `.then()` chains in tool/client/test/eval code. The Quiqup client uses `await fetch(...)`; handlers `await client.request(...)`.

## Imports

- Path alias `@/` for cross-module references (`@/lib/tools/...`, `@/lib/clients/...`).
- Relative imports only for intra-directory neighbours (`./register`, `./datasets/lastmile-order-creation-v1`).
- Tests import the tool module via relative path (`../lib/tools/get-lastmile-order`) and use a **dynamic `await import(...)` inside each `it`**, not a top-of-file import, so that `vi.mock("@/lib/quiqup", ...)` hooks before module evaluation.

## Anti-patterns to avoid

- `AGENTS.md` warns: this is Next.js 16 — do **not** rely on training-data Next.js knowledge for App Router/Route Handler details. Read `node_modules/next/dist/docs/` first.
- `z.object({}).passthrough()` on inputs is a silent footgun (see Schema Conventions). Always declare fields.
- The Quiqup `references` field expects object-shaped entries, not strings — passing `["MY_REF"]` causes the API to reject the whole order. Use top-level `partner_order_id` instead. Reinforced in the `create_lastmile_order` description (`create-lastmile-order.ts:126-130`).
- `as` casts on `extra.authInfo.extra` are trust casts; a follow-up `TODO(M6)` calls for a runtime sanity check before they harden. Do not add more such casts without leaving a TODO and a tracking comment.
- `outputSchema` is **not** runtime-enforced yet (M4 TODO at `register.ts:120-124`); tests do `.safeParse()` against cassettes for now. Do not write code that assumes the wrapper validates handler output.
