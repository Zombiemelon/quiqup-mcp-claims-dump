# Testing & evals — quiqup-mcp

Snapshot: 2026-05-18. Two distinct quality surfaces: **Vitest tests** (unit + opt-in integration) cover code correctness; **Langfuse evals** cover LLM-judgment quality. They have different runners, different harnesses, and different CI gates.

## Vitest setup

`vitest.config.ts` (entire file):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup/msw.ts"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname },
  },
});
```

- Environment is `node` — no jsdom, no browser globals.
- The `@` alias mirrors `tsconfig.json` `paths` so production import paths resolve in tests.
- A single global setup file (`tests/setup/msw.ts`) wires MSW lifecycle hooks (see below).
- Vitest version pinned at `^4.1.5` in `package.json`.

## Test layout

```
tests/
  setup/msw.ts                       # MSW lifecycle, used by all tests
  cassettes/                         # Anonymised prod-response fixtures (JSON)
    README.md                        # Anonymisation rules
    get-lastmile-order.json
    get-lastmile-order-label.json
  integration/mcp-flow.test.ts       # End-to-end against running server
  *.test.ts                          # Per-tool unit tests
```

- Naming: `*.test.ts` only (`*.spec.ts` is **not** used).
- Test filename mirrors the tool filename: `lib/tools/get-lastmile-order.ts` → `tests/get-lastmile-order.test.ts`.
- One test file per tool / per module. No grouped “all tools” suite.

Coverage at time of snapshot: 9 unit test files (`auth`, `bulk-commit-products`, `bulk-validate-products`, `claims-dump`, `create-product`, `get-lastmile-order`, `get-lastmile-order-label`, `get-product-by-sku`, `mark-ready-for-collection`, `update-product`) + 1 integration file. Most M3 thin pass-through tools have **no** test file yet (M4 work).

## Unit vs integration split

The split is gated by `RUN_INTEGRATION=1`:

```ts
// tests/integration/mcp-flow.test.ts:4
const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";
describe.runIf(SHOULD_RUN)("MCP flow integration", () => { ... });
```

- `pnpm test` → runs everything matched by `tests/**/*.test.ts`, but the integration block is skipped when env var is absent.
- `pnpm test:integration` → `RUN_INTEGRATION=1 vitest run`. Requires `CLERK_SECRET_KEY` and a running MCP server (default `http://localhost:3000`, override with `MCP_BASE_URL`). It calls `clerk.testingTokens.createTestingToken()` and POSTs to `/mcp` — exercising the real HTTP path and the registered tool dispatcher.
- Unit tests do *not* spin up the Next.js server. They import `spec` directly and invoke `spec.handler(auth, args)` — MSW intercepts the outbound fetch.

## MSW cassettes

The "msw at fetch (seam 3)" pattern from internal docs is enforced in `tests/setup/msw.ts`:

```ts
export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- `onUnhandledRequest: "error"` — **any** test that triggers an un-stubbed fetch fails loudly. Tests must declare every Quiqup endpoint they touch via `server.use(http.get(...))`.
- Handlers are added per-test, not globally; `afterEach` resets so cassettes don't leak between tests.

Cassettes live in `tests/cassettes/` as JSON files captured (and anonymised) from prod responses. `tests/cassettes/README.md` is the source of truth for anonymisation rules — synthetic `Test Customer`, `+971500000000`, `test@example.com`, partner IDs replaced with `999999`. The PDF-label cassette wraps binary as a JSON envelope `{status, content_type, body_base64}` that the test decodes before serving:

```ts
const replayLabel = (orderId: string) =>
  http.get(`https://api-ae.quiqup.com/order_label/${orderId}`, () => {
    const bytes = Buffer.from(cassette.body_base64, "base64");
    return new HttpResponse(bytes, {
      status: cassette.status,
      headers: { "content-type": cassette.content_type },
    });
  });
```

Cassettes are referenced via `import cassette from "./cassettes/get-lastmile-order.json"` — no recorder/replay tooling, just raw JSON committed to the repo.

## Test patterns

`tests/get-lastmile-order.test.ts` is the canonical example. Structure:

- Top-level `vi.mock("@/lib/quiqup", ...)` to stub `getQuiqupReadyJwt` — short-circuits Clerk-session minting; the real HTTP boundary is what we want to exercise.
- A fixed `auth` constant satisfying `AuthContext` shape.
- One `describe("<tool_name>")` per file, with nested describes grouping concerns:
  - `registration` — module exports `spec`, name + description shape
  - `input validation` — `safeParse` against bad inputs (defends against vacuous-green via `T4.1 discipline` notes)
  - `happy path` — MSW handler, call `spec.handler`, assert content blocks
  - `output schema` — `safeParse(cassette)` plus a deliberate negative case
  - `error mapping` — MSW returns 404/401/5xx, assert handler error message

`describe.runIf(...)` is used to gate the integration suite. AAA structure is informal but consistent: stub → invoke → assert.

## Mocking strategy

- **Mocked:** the Quiqup HTTP boundary (via MSW). The Clerk session-JWT minting (`getQuiqupReadyJwt`) is `vi.mock`-stubbed in unit tests so MSW sees a known bearer.
- **Not mocked:** Zod parsing, the `registerTool` wrapper, error mapping, content-block construction. Tests run the production code paths end-to-end up to `fetch()`.
- **Real for integration:** Clerk (`createClerkClient` with `CLERK_SECRET_KEY`), the live MCP server, and (intentionally) the Clerk-token surface. The Quiqup upstream is **still mocked** even in `RUN_INTEGRATION=1` — there's no end-to-end-to-Quiqup CI test in the Vitest tree. That gap is filled by the eval roundtrip.

## Eval harness (`evals/`)

Different runner entirely — `bun run evals/<file>.ts`, not Vitest. Two evals exist:

| File | Hits Quiqup? | CI gate |
|---|---|---|
| `evals/lastmile-order-creation.ts` | No (offline LLM tool-call quality) | `args-overlap >= 0.85` |
| `evals/lastmile-order-roundtrip.ts` | Yes (staging — creates + cancels) | `create-2xx == 1.0` |

What's measured: each item in `evals/datasets/lastmile-order-creation-v1.ts` is a natural-language merchant request + hand-authored expected tool call. The runner hands the request to Anthropic with the **live MCP tool spec** exposed (`tool = { name, description, input_schema: z.toJSONSchema(spec.inputSchema) }`), captures the `tool_use` block, and Langfuse's `experiment.run` invokes the three scorers from `evals/score-tool-call.ts`:

- `tool-name-match` (0/1) — did the LLM pick the right tool
- `required-fields-present` (0..1) — fraction of `origin|destination|payment_mode|items` declared
- `args-overlap` (0..1) — leaf-level lenient match (case-insensitive substring for strings, numeric-coerce for "150.0" vs 150)

Lenient by design: extras don't penalise; the goal is directional signal on description quality. Datasets are version-suffixed (`-v1.ts`) — v2/v3 land as new files so baselines stay comparable.

Telemetry routes via OpenTelemetry → `LangfuseSpanProcessor`, with `AnthropicInstrumentation` capturing the Claude calls. Always `await langfuse.shutdown(); await otelSdk.shutdown()` at the bottom of a runner — without the flush, scores from late-running evaluators get dropped (verified 2026-05-13).

**CI gate.** Each runner opts into `evals/gate.ts` when `EVAL_GATE=1`. The gate averages each named score across `result.itemResults` and `process.exit(1)` if any threshold is unmet. Locally, the gate is a no-op. In CI, `.github/workflows/evals.yml` runs both jobs in parallel and is path-filtered to `lib/tools/create-lastmile-order.ts`, `lib/clients/quiqup-lastmile.ts`, anything under `evals/`, and `package.json`/`bun.lock`. The v3 job consumes Quiqup staging quota (creates real pending orders), so the path filter matters.

## Running tests

From `package.json` (verbatim):

```
pnpm test                  # vitest run                       — unit tests, integration skipped
pnpm test:watch            # vitest                           — watch mode
pnpm test:integration      # RUN_INTEGRATION=1 vitest run     — adds the integration block
pnpm eval:lastmile-orders  # bun run evals/lastmile-order-creation.ts
pnpm eval:lastmile-roundtrip  # bun run evals/lastmile-order-roundtrip.ts
```

Package manager is pnpm 10.30 (per `packageManager` field); `bun` is required only for the eval runners and CI.

## Coverage

No coverage config is present (`vitest.config.ts` has no `coverage` block, no `@vitest/coverage-v8` dep, no `coverage` script in `package.json`). The repo currently relies on per-tool test files and the M4 hardening checklist rather than a percentage gate. If you add coverage, do it via the standard `coverage.provider: "v8"` option and gate per-directory thresholds rather than a single global number.

## Test data

- `tests/cassettes/*.json` — anonymised Quiqup responses (last-mile only at snapshot time). Add fixtures alongside; document new field-class redactions in `tests/cassettes/README.md`.
- `evals/datasets/*-v1.ts` — synthetic merchant requests for LLM evals. Hand-authored; never PII; always versioned.
- No central fixture factory. The `auth` object used by tool-handler tests is copy-pasted across files — acceptable given how rarely its shape changes; if `AuthContext` gains fields, expect a sweep across tests.
