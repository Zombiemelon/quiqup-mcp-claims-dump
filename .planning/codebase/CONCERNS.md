# Concerns — quiqup-mcp

Map date: 2026-05-18. Branch: `fix/lastmile-label-binary-content`. Focus: tech debt, security, performance, fragile areas. Severities are conservative — `[HIGH]` means it could realistically cause an incident in current usage.

---

## Tech debt

### TODO/FIXME inventory

40+ `TODO(M4)` and `TODO(M6)` markers, no `FIXME`/`HACK`/`XXX`. Heavily bucketed — this is *staged* debt, not random rot.

- **`TODO(M4)` — "no cassette, no output schema, no error mapping"** appears on ~16 M3 thin-pass-through tools: `lib/tools/create-fulfilment-order.ts:6`, `update-fulfilment-order.ts:6`, `update-lastmile-order.ts:6`, `create-product.ts:6`, `update-product.ts:6`, `get-product-by-sku.ts:6`, `get-batch.ts:6`, `get-inbound-items.ts:6`, `get-inbound.ts:6`, `get-inbound-state-history.ts:6`, `list-inbounds.ts:6`, `list-inbound-slots.ts:6`, `list-sku-batches.ts:6`, `list-inventory.ts:6`, `get-inventory-by-sku.ts:6`, `add-parcel-to-order.ts:6`, `create-lastmile-order.ts:6`. Same pattern is acknowledged top-of-file in `app/[transport]/route.ts:14,29`. [MED] — predictable hardening backlog, but means most write paths have no regression net.
- **`TODO(M6)` — disabled-pending-guardrails** on 7 destructive tools: `mark-ready-for-collection.ts:1`, `cancel-lastmile-orders-batch.ts:15`, `remove-parcel-from-order.ts:15`, `adjust-stock.ts:18`, `book-inbound-slot.ts:14`, `bulk-validate-products.ts:1`, `bulk-commit-products.ts:1`. All four throw at runtime. Pattern is consistent. [LOW] — intentional surface-coverage trick (registered so `tools/list` advertises them) and the handlers fail closed.
- **`TODO(verify)` on the trust cast** in `lib/tools/register.ts:126`: handlers receive `args as z.infer<TIn>` *assuming* the SDK pre-validates against `spec.inputSchema.shape`. If `mcp-handler` doesn't actually validate, every typed handler is lying about its argument type. No wrapper-level test exists to confirm (`lib/tools/register.ts:114`). [HIGH] — silent type unsoundness across the entire tool surface.

### Schema declaration inconsistency (the 7be13a9 blind spot)

Commit 7be13a9 fixed `create-lastmile-order` after `z.object({}).passthrough()` serialised to MCP as an empty parameter list. **The same anti-pattern survives in other writers**:

- `lib/tools/add-parcel-to-order.ts:11` — `parcel: z.object({}).passthrough()` (the nested object the LLM has to fill is opaque).
- `lib/tools/create-fulfilment-order.ts`, `lib/tools/update-fulfilment-order.ts`, `lib/tools/update-product.ts`, `lib/tools/create-product.ts:18` — outer object is `.passthrough()` but only 3–4 fields are declared; the real Quiqup payload has more required fields per the description text, which the LLM only sees prose-wise.
- `outputSchema` is universally `z.object({}).passthrough()` (cosmetic — not enforced at runtime per `register.ts:120`).

[HIGH] — the eval baseline that caught `create_lastmile_order` only covers that one tool; sibling writers are likely to hit the same "LLM calls with `{}`, upstream 422s with no useful field" loop in the wild.

### Inconsistent error handling

Three distinct shapes coexist for upstream errors:

1. **Mapped via wrapper** — `register.ts:68-112` catches `QuiqupHttpError`, formats body + hint. Applies to every tool registered through `registerTool`.
2. **Hand-rolled in handler** — `lib/tools/get-lastmile-order.ts:51-65` re-throws as `new Error(...)` with status-specific text. Predates the wrapper's catch. Duplication; less informative (no body, no `attribute_errors` hint).
3. **String-only via legacy** — `lib/quiqup.ts:135` (`quiqupLastmileGet`) throws `Error("Quiqup ${path} failed: ${status} ${text}")`; consumed only by `recent-orders.ts` and `whoami-platform.ts`-style legacy paths. No `QuiqupHttpError` produced ⇒ wrapper's error mapping never fires for these calls.

[MED] — three error paths, only one rich. Hides upstream detail for legacy tools.

### Package manager confusion

`package.json:31` declares `packageManager: pnpm@10.30.3`. `bun.lock` is committed at 99KB. `README.md:12` says `bun install`. CI (`evals.yml:61,85`) runs `bun install --frozen-lockfile`. There is no `pnpm-lock.yaml`. [MED] — pnpm declaration is dead; Bun is the real tool. Either delete `packageManager` from `package.json` or switch to a `pnpm-lock.yaml`. Risk: someone trusting the `packageManager` field installs with pnpm, gets a different resolution graph, and ships a broken build.

### Stale boilerplate (9227c86 was incomplete)

Commit 9227c86 claimed to "replace Next.js boilerplate branding with Quiqup logo" but `app/page.tsx:10` still loads `/next.svg`, `app/page.tsx:17` still says `<h1>To get started, edit the page.tsx file.</h1>`, and `app/page.tsx:47` still loads `/vercel.svg`. `public/` still contains `next.svg`, `vercel.svg`, `globe.svg`, `window.svg`, `file.svg`. [LOW] — cosmetic, but the root `/` page is publicly reachable.

### Likely dead code

- `flow/flow_bpmn.html` (41KB) — referenced nowhere in `app/`, `lib/`, `tests/`, `evals/`. Title says `quiqup-mcp-claims-dump — End-to-End Flow (v1)`, i.e. pre-rename artifact. [LOW]
- `next.config.ts` is the empty default scaffold. [LOW] — fine for now.

---

## Security

### Bearer token surface

- `lib/tools/register.ts:19` deliberately stores the inbound `at+jwt` in `AuthContext.bearerToken`. Comment flags audit-log redaction need. Currently only `claims_dump` reads it (and only to decode header/payload, not to echo the raw token).
- `lib/tools/claims-dump.ts:19-26` decodes the JWT and surfaces the full header + payload **into LLM context**. Payload includes `sub`, `email`, `org_id`, `azp`, etc. [MED] — by design (diagnostic tool), but every host-connected LLM conversation that calls `claims_dump` durably captures the user's Clerk identity claims in its transcript. Worth a doc warning in the tool description.
- `lib/quiqup.ts:108` caches minted JWTs in a process-scoped `Map<userId, CachedAuth>`. Lives until cold start. Cross-tenant leak risk if a future code path keys lookups wrong. [LOW] today.

### Input validation gaps

- All M3 thin writers accept `.passthrough()` (see "Schema declaration inconsistency"). The LLM can stuff arbitrary fields through to Quiqup. If Quiqup adds a sensitive admin-only field, a creative prompt-injection could try to set it. Quiqup's API gateway is the real authority, but defence-in-depth is absent at our boundary. [MED]
- `lib/tools/update-lastmile-order.ts:10-21` is the *one* counter-example — explicit field whitelist (`payment_mode`, `payment_amount` only). This is the pattern other writers should follow. [LOW once propagated]

### Output / trust boundary

- `lib/tools/register.ts:97-106` passes the upstream Quiqup error body **verbatim** into the LLM tool response (truncated at 4000 chars). If a malicious staging endpoint (or a compromised Quiqup-side service) returns crafted text, it becomes LLM-visible content the model may act on (prompt injection vector). [MED] — same trust assumption every passthrough makes; document it.
- `lib/tools/whoami-platform.ts` and the JSON-dumping write tools echo Quiqup responses straight into `text` blocks via `JSON.stringify(data, null, 2)`. No sanitization. Same trust boundary.

### Auth surface

- `app/[transport]/route.ts:113` sets `withMcpAuth({ required: true })`. Good — no unauth path.
- Per-tool "auth required" enforcement is **missing**: `register.ts:164` flags this. Today, every typed tool re-checks `if (!auth.userId) throw new Error(...)` inside the handler. If a future tool forgets that check, it silently runs with `userId: null` — and `getQuiqupReadyJwt(null)` would currently throw, but defence-in-depth says the wrapper should fail closed. [MED]
- `lib/tools/register.ts:158` — unsafe cast of `extra.authInfo.extra`. If Clerk renames `clerkAuth` or `subject`, every handler silently sees `userId: null` and refuses with a generic "requires an authenticated user". Loud failure preferred. [LOW] until Clerk SDK changes.

### Secrets exposure

`.env.local` is `.gitignored`; `.env.example` is committed with placeholder values only. `git ls-files` confirms no `.env` variant is tracked. [LOW] — good hygiene.

---

## Performance / cost

### LLM cost surfaces

- `evals/lastmile-order-creation.ts` and `evals/lastmile-order-roundtrip.ts` call Anthropic and (for v3) staging Quiqup. CI gates run on every PR that touches the trigger paths (`.github/workflows/evals.yml:30-37`). No rate-limit or cost-cap logic in the evals themselves. [LOW] — staging-only, datasets are small, path-filtered.
- No cost telemetry on the MCP server itself; LLM cost is the host's problem (Claude.ai, etc.), not ours.

### Response size / context bloat

- Many M3 tools `JSON.stringify(data, null, 2)` the full Quiqup response into a text block: `get-fulfilment-order.ts:30`, `list-inventory.ts:28`, `list-inbounds.ts`, `get-batch.ts:28`, `get-inbound-items.ts:30`, `whoami-platform.ts:92`, `get-inventory-by-sku.ts:28`, etc. Quiqup `/orders` responses can be 150+ lines each — `list_inventory` with `per_page=200` could push tens of KB into the model's context per call. Only `recent_orders` (`lib/tools/recent-orders.ts:129-142`) does an explicit projection. The 94fa175 commit fixed binary-bloat specifically for PDFs; the JSON-bloat case is untouched. [MED]
- `register.ts:72` truncates *error* bodies at 4000 chars. Success bodies have no cap. [MED]

### Caching

- `lib/quiqup.ts:53` caches minted JWTs for 50s. Lost on cold start (Vercel function); intentional.
- No caching of Quiqup GETs themselves. Every `get_lastmile_order`/`list_inventory` call hits upstream. For order-label PDFs (~28KB), this is wasted bandwidth on retries. [LOW] — premature to add until usage data exists.

### Cold start

Next.js 16 + Vercel functions + Clerk Backend SDK + `@arizeai/openinference-instrumentation-anthropic` + OpenTelemetry SDK. The OTel + Langfuse stack is in `devDependencies` only — confirm via `package.json`. [LOW]

---

## Fragile areas

### MCP edge cases

- **Binary content** — fixed for `get_lastmile_order_label` (94fa175). The label tool returns `type: "resource"` (`lib/tools/get-lastmile-order-label.ts:91-93`). No other tool currently produces binary. **But** `QuiqupLastmileClient.request` (`lib/clients/quiqup-lastmile.ts:70-78`) auto-detects non-JSON and returns `{contentType, base64}` — so any future endpoint that serves binary (e.g. an invoice PDF) would currently surface as a base64-string-in-text again, repeating the bug. The wrapper-level fix isn't generalised. [MED]
- **Large responses** — see "Response size" above.
- **Streaming** — not used; Next.js route handler returns full response. [LOW]

### Eval blind spots

The 7be13a9 commit closed `create_lastmile_order`'s blind spot by declaring schema fields. Likely remaining blind spots:

- Other writers (`add-parcel-to-order`, `create-product`, `update-product`, `create-fulfilment-order`, `update-fulfilment-order`) have the same `.passthrough()` pattern and **no eval coverage at all** (only `lastmile-order-creation-v1` and `lastmile-order-roundtrip-v1` datasets exist in `evals/datasets/`).
- The eval scorer (`evals/score-tool-call.ts`) measures args-overlap vs an expected payload. It does not verify upstream 2xx for any tool except in the roundtrip eval. A regression that *changes* what the LLM emits but *still* gets 2xx would pass the offline gate. [MED]

### Tests with conditional execution

- `tests/integration/mcp-flow.test.ts:4` is `describe.runIf(SHOULD_RUN)` gated on `RUN_INTEGRATION=1`. The only `npm test` invocation in `package.json:7` is `vitest run`, which does **not** set the flag. So integration tests silently skip in default runs.
- **No GitHub Actions workflow runs `vitest` at all.** `.github/workflows/` contains only `claude-review.yml` and `evals.yml`; neither runs unit tests. [HIGH] — every unit test in `tests/*.test.ts` (auth, get-lastmile-order, get-lastmile-order-label, claims-dump, create-product, mark-ready-for-collection, etc.) can break on `main` and CI will pass.

### MSW cassette drift

- `tests/cassettes/README.md` documents anonymization rules but no automated refresh process. Only two cassettes exist (`get-lastmile-order.json`, `get-lastmile-order-label.json`). If Quiqup adds/renames a field, cassettes lie until someone manually re-records. [MED]
- `tests/setup/msw.ts` uses `onUnhandledRequest: "error"` — good, catches stub gaps loudly. [LOW]

---

## Known issues / open questions

- **`recent_orders` and `claims_dump` are pre-wrapper legacy.** They use their own `server.registerTool(...)` calls (`lib/tools/recent-orders.ts:39`, `claims-dump.ts:48`). Bypass `quiqupErrorToToolResult`. Either port to `ToolSpec` or document why they're frozen. [LOW]
- **`order_id` typing contract** (`lib/tools/get-lastmile-order.ts:5-10`) — comment explicitly warns "don't fix to z.union([number, string])". Worth surfacing in `AGENTS.md` so reviewers don't "helpfully" change it.
- **`partner_order_id` vs `references`** — codified in `create-lastmile-order.ts:127-133` description and in user memory. Confirm same warning lives in any future "create order" docs.
- **Output schemas are decorative.** Every `outputSchema = z.object({}).passthrough()`. Test-time `.safeParse` would catch shape drift but no test currently does it on the M3 writers (only the M2 `get-lastmile-order` test does — `tests/get-lastmile-order.test.ts:31` even acknowledges it asserts only the spec object).
- **`flow/flow_bpmn.html`** — kill or move under `docs/`.
- **`app/page.tsx`** — still Next.js scaffold; either replace with a "this is an MCP endpoint, see /mcp" page or delete.

---

## Highest-severity rollup

1. `[HIGH]` No CI runs `vitest` — unit tests are decorative for the protection of `main`.
2. `[HIGH]` `args as z.infer<TIn>` trust cast in `register.ts` is unverified; the entire typed-handler surface assumes SDK-side validation that hasn't been tested.
3. `[HIGH]` 7+ writers still use `.passthrough()`-without-declared-fields — same shape 7be13a9 just fixed for `create_lastmile_order`.
4. `[MED]` Three distinct error-handling paths (wrapper / hand-rolled / legacy `quiqupLastmileGet`), only one rich.
5. `[MED]` Binary-content fix isn't generalised in `QuiqupLastmileClient.request` — next binary endpoint repeats the bug.
