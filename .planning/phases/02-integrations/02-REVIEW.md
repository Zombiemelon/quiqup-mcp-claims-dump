---
phase: 02-integrations
reviewed: 2026-05-19T00:00:00Z
depth: deep
files_reviewed: 50
files_reviewed_list:
  - .github/workflows/eval-gate.yml
  - app/[transport]/route.ts
  - evals/datasets/destructive-integrations-v1.ts
  - evals/datasets/integrations-shared-v1.ts
  - evals/datasets/salla-integration-v1.ts
  - evals/datasets/shopify-integration-v1.ts
  - evals/datasets/woocommerce-integration-v1.ts
  - evals/destructive-integrations.ts
  - evals/integrations-shared.ts
  - evals/salla-integration.ts
  - evals/score-destructive-integrations.ts
  - evals/score-integrations-shared.ts
  - evals/score-salla-integration.ts
  - evals/score-shopify-integration.ts
  - evals/score-woocommerce-integration.ts
  - evals/shopify-integration.ts
  - evals/snapshots/tool-surface.json
  - evals/woocommerce-integration.ts
  - lib/middleware/destructive.ts
  - lib/tools/confirm-ff-export.ts
  - lib/tools/delete-integration-source.ts
  - lib/tools/delete-salla-connection.ts
  - lib/tools/get-integration-order.ts
  - lib/tools/get-salla-config.ts
  - lib/tools/get-salla-connection.ts
  - lib/tools/get-salla-platform-data.ts
  - lib/tools/get-shopify-config.ts
  - lib/tools/get-woocommerce-config.ts
  - lib/tools/install-salla.ts
  - lib/tools/list-integration-connections.ts
  - lib/tools/list-integration-order-reasons.ts
  - lib/tools/list-shopify-delivery-methods.ts
  - lib/tools/list-shopify-locations.ts
  - lib/tools/list-woocommerce-connections.ts
  - lib/tools/list-woocommerce-shipping-lines.ts
  - lib/tools/list-woocommerce-states.ts
  - lib/tools/repair-integration-orders.ts
  - lib/tools/setup-shopify-callback.ts
  - lib/tools/setup-woocommerce-connection.ts
  - lib/tools/toggle-salla-fulfillment.ts
  - lib/tools/update-salla-config.ts
  - lib/tools/update-shopify-config.ts
  - lib/tools/update-shopify-connection.ts
  - lib/tools/upsert-woocommerce-config.ts
  - package.json
  - tests/middleware/destructive.test.ts
  - tests/tools/destructive-integrations.test.ts
  - tests/tools/integrations-shared.test.ts
  - tests/tools/salla-integration.test.ts
  - tests/tools/shopify-integration.test.ts
  - tests/tools/woocommerce-integration.test.ts
findings:
  blocker: 4
  warning: 9
  info: 5
  total: 18
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** deep
**Files Reviewed:** 50
**Status:** issues_found

## Summary

Phase 2 ships ~50 MCP tools spanning the shared integrations surface, Shopify, WooCommerce, Salla, and two DESTRUCTIVE deletes — plus the new `lib/middleware/destructive.ts` canonical gate, 5 MSW test suites (~120 it-blocks), and 5 new Langfuse eval gates wired into CI. The destructive helper is well designed: documented, tested in isolation, identity-locked at the eval layer (T-02-52), and exercised through five MSW paths per tool with request-count assertions that prove the gate is client-side.

That said, this phase carries **4 BLOCKER-class defects** that materially exceed Phase 1's BL-01/BL-02 in severity, plus a sizeable bench of WARNING-class issues. The biggest concerns:

1. **Token leakage in the cross-family and WooCommerce catalogs.** `list_integration_connections` and `list_woocommerce_connections` use `.passthrough()` output schemas and `JSON.stringify` the raw upstream body — including the `token` field that the Salla family worked hard to strip. The Salla family's T-02-29 invariant is contradicted by sibling tools in the same phase. The static `tokenOmission` scorer at the eval layer ONLY inspects `get-salla-connection.ts`, so this regression is not caught anywhere.
2. **OAuth code never reaches the audit redactor.** `setup_shopify_callback` and `update_shopify_connection` take `code` as a top-level arg. `code` is NOT in `ALWAYS_REDACT_KEYS` in `lib/middleware/pii-redact.ts`. Every OAuth code (Shopify single-use, but still an exchangeable bearer for a brief window) lands in stdout audit logs in plaintext. Sister field `token` IS redacted, which makes the omission look like an oversight, not a deliberate carve-out.
3. **`delete_salla_connection` is family-misnamed but family-agnostic at the URL layer.** The endpoint is the generic `/integrations/connections/{id}` — a Shopify or WooCommerce connection id passed through this tool will be deleted just as happily as a Salla one. The description and schema imply Salla-only scope; nothing enforces it. This is the same shape as Phase 1's BL-02 (enforcement-omitted at the validation boundary).
4. **`update_shopify_connection` accepts a caller-supplied `user_id`** with no equality check against `auth.userId`. If the upstream Quiqup gateway uses the body's `user_id` (rather than the JWT subject) as the owner, this is a cross-tenant connection-rewrite vector. The MCP tool gives the LLM the rope to ask for it.

WARNING-level: `country_filter` is still bounded only by length-2 (Phase 1 BL-02's exact pattern); `start_date`/`end_date` accept any string including `""`; `install_salla` write-style auth has no audit/rate-limit; WR-07 (platformApiFetch helper) is confirmed deferred — 50 tools each inline the same 5-line fetch boilerplate.

## Structural Findings (fallow)

No `<structural_findings>` payload was provided with this review request. All findings below are AI-narrative-derived.

## Narrative Findings (AI reviewer)

### BLOCKER Issues

#### BL-01: `list_integration_connections` and `list_woocommerce_connections` leak the `token` field in the response

**Files:**
- `lib/tools/list-integration-connections.ts:78-94`
- `lib/tools/list-woocommerce-connections.ts:64-80`

**Issue:**
Both tools use `outputSchema = z.object({}).passthrough()` and `JSON.stringify(data, null, 2)` of the raw upstream body. Per their own source-doc references and per the MSW test fixture `tests/tools/integrations-shared.test.ts:84-90`:

```ts
const payload = {
  connections: [{ id: "conn_1", shop_name: "acme", ..., token: "tkn_x", ... }],
};
```

The test asserts `first.text` parses cleanly back to `{connections:[{...}]}` and DOES NOT assert the absence of `token` — so the canary `"tkn_x"` is forwarded into the tool's `content[0].text` block, i.e. into LLM context. This directly contradicts the T-02-29 invariant the Salla family enforces in `lib/tools/get-salla-connection.ts:116` (`const { token: _token, ...connectionSafe } = connection`), which is exactly the regression the static `tokenOmission` scorer in `evals/score-salla-integration.ts:210-256` is supposed to lock — but that scorer only inspects `get-salla-connection.ts`, not the sibling list tools.

Concretely: for the cross-family `list_integration_connections`, the upstream returns `{connections:[{...token: "<shopify-or-woo-or-salla-bearer>"...}]}` and the MCP layer forwards it verbatim. For `list_woocommerce_connections`, the response is documented as also including `order_created_webhook_secret` and `order_updated_webhook_secret` — both even more sensitive than `token` (a WooCommerce webhook secret in attacker hands lets them forge order events) and equally un-stripped.

**Fix:**
Apply the same destructure-and-discard pattern used in `get-salla-connection.ts` to the list responses, AND extend the static `tokenOmission` scorer to cover all three list tools so a future regression flips the gate.

```ts
// in list-integration-connections.ts handler:
const body = (await res.json()) as {
  connections?: Array<Record<string, unknown> & { token?: unknown }>;
};
const connectionsSafe = (body.connections ?? []).map(
  ({ token: _t, ...rest }) => rest,
);
return {
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({ connections: connectionsSafe }, null, 2),
    },
  ],
};

// and in list-woocommerce-connections.ts also strip the webhook secrets:
const SENSITIVE_KEYS = new Set([
  "token",
  "order_created_webhook_secret",
  "order_updated_webhook_secret",
]);
const connectionsSafe = (body.connections ?? []).map((c) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (!SENSITIVE_KEYS.has(k)) out[k] = v;
  return out;
});
```

Also tighten the output schema from `z.object({}).passthrough()` to `.strict()` after the strip, so the static `outputSchema.safeParse(payload)` style assertion the Salla family uses can lock the new contract. Then add a canary test mirroring `tests/tools/salla-integration.test.ts:136-165` for both tools, AND extend the static eval scorer to readFile() each list-tool source and assert the strip pattern is present (`tokenOmission` becomes `tokensOmittedEverywhere`).

---

#### BL-02: OAuth `code` argument is not in `ALWAYS_REDACT_KEYS` — every Shopify OAuth code lands in stdout audit logs in plaintext

**Files:**
- `lib/middleware/pii-redact.ts:108-136` (the redact set)
- `lib/tools/setup-shopify-callback.ts:44-52, 95-99` (declares `code`, enables `audit: true`)
- `lib/tools/update-shopify-connection.ts:47-50` (declares `code`, enables `audit: true`)

**Issue:**
`setup_shopify_callback` carries `audit: true` (correctly — it's a write tool). The audit middleware at `lib/middleware/audit.ts:109` calls `redactArgs(params.args, params.tool)` which walks the args and replaces any key in `ALWAYS_REDACT_KEYS` with `"[REDACTED]"`. The set at `pii-redact.ts:108-136` includes `token`, `bearer`, `jwt`, `api_key`, `secret` — but NOT `code`. So when an LLM call lands `{ shop_name: "acme", code: "shpat_oauth_temp_xyz", is_fulfillment: true }`, the audit log line is literally:

```
audit: {"...","argsRedacted":{"shop_name":"acme","code":"shpat_oauth_temp_xyz","is_fulfillment":true}}
```

`update_shopify_connection` is a worse case: it accepts `token` (correctly redacted as `[REDACTED]`) AND `code` (NOT redacted) AND `user_id` — so the audit line shows a `[REDACTED]` next to a plaintext OAuth code in the same record. The discrepancy is visually striking, and is exactly the kind of "we missed one field" mistake Phase 1's redact-set review should have caught.

The fact that Shopify rejects re-use of the code does NOT make this safe — the window between issuance and exchange is the attacker window, and stdout-on-Vercel is the audit transport (audit.ts:9-20). Logs are visible to whoever has Vercel log access; that population is plausibly broader than "people permitted to see customers' OAuth codes mid-exchange".

**Fix:**
Add `code` to `ALWAYS_REDACT_KEYS`. While there, audit the rest of the Phase-2 surface for other sensitive args that don't carry an obviously-sensitive key name (e.g. `consumer_secret`, `client_secret`, `webhook_secret`, `signing_key`).

```ts
// lib/middleware/pii-redact.ts
const ALWAYS_REDACT_KEYS = new Set<string>([
  ...,
  "token",
  "bearer",
  "jwt",
  "api_key",
  "secret",
  "code",                              // OAuth authorization code (Shopify, future Salla)
  "consumer_secret",                   // WooCommerce REST consumer secret (if ever named explicitly)
  "client_secret",                     // generic OAuth client secret
  "webhook_secret",                    // WooCommerce webhook signing secret
  "order_created_webhook_secret",      // explicit WooCommerce key per source-doc
  "order_updated_webhook_secret",      // explicit WooCommerce key per source-doc
]);
```

Then add a unit test in `tests/middleware/pii-redact.test.ts` (or wherever the existing redact tests live) that hits each new key. The eval layer should also gain an `audit-redaction` static scorer that imports `ALWAYS_REDACT_KEYS` and asserts every Phase-2 tool whose inputSchema declares a sensitive-named field has that name in the set — modelled on `confirmGatePresent` (T-02-52 pattern).

---

#### BL-03: `delete_salla_connection` will delete ANY integration connection — the upstream endpoint is family-agnostic

**File:** `lib/tools/delete-salla-connection.ts:51-73, 160-169`

**Issue:**
The endpoint is `DELETE /integrations/connections/{id}` (line 161). That route is the same one `get_salla_connection` reads from (`lib/tools/get-salla-connection.ts:96`) — and that route is the GENERIC cross-family connection endpoint, not a Salla-specific one. The tool name, description ("Salla connection id"), and the `resourceDescription` passed into `requireConfirm` ("`Salla connection id ${args.id}`", line 124) all imply scope to Salla, but nothing enforces it: the `id` schema is `z.string().min(1)`, no source-prefix check, no pre-flight GET to verify `source === "salla"`.

Two failure modes:

1. An LLM that has read `list_integration_connections` and picks a Shopify connection id while the user asked for a "Salla deletion" — the gate clears (id is a non-empty string), upstream happily deletes the Shopify connection, and the user-facing echo says `{ ok: true, deleted: { id: "shopify-conn-id" } }` while the human thinks they cleaned up Salla.
2. The companion `delete_integration_source` exists for the Shopify/WooCommerce/Salla source+shop_name shape — but the existence of a separate "Salla" tool encourages an LLM to assume the two carve up the namespace. Empirically (the `confirmElicited` scorer dataset includes `"Remove the woocommerce source for store acme-store"` routing to `delete_integration_source` with `source: "woocommerce"`), the agents understand that one. But they could equally fire `delete_salla_connection` with a foreign id if the wider conversation had mentioned a connection id.

This is the Phase-1 BL-02 shape: enforcement omitted at the validation boundary; description-only guarantees do not bind.

**Fix:**
Add a pre-DELETE source-check: GET `/integrations/connections/{id}`, inspect `connection.source`, refuse with a structured error if it isn't `"salla"`. The cost is one extra round-trip on a tool that is rate-limited to 3/min anyway, and it preserves the family-scoping promise the tool name makes.

```ts
// 4a. Source-scope pre-flight: this tool deletes Salla connections only.
//     The upstream endpoint is generic, so we verify the source ourselves.
const pre = await fetch(
  `${platformApiBase}/integrations/connections/${encodeURIComponent(args.id)}`,
  { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" } },
);
if (pre.status === 404) {
  throw new QuiqupHttpError(404, `connection ${args.id} not found`);
}
if (!pre.ok) throw new QuiqupHttpError(pre.status, await pre.text());
const peek = (await pre.json()) as { connection?: { source?: string } };
const source = peek.connection?.source;
if (source !== "salla") {
  return {
    isError: true,
    content: [{
      type: "text" as const,
      text: `delete_salla_connection refused: connection ${args.id} has source=${String(source)}, not 'salla'. ` +
        `Use delete_integration_source({ source: "${source}", shop_name: ... }) instead.`,
    }],
  };
}
```

Or alternatively rename the tool `delete_integration_connection_by_id` and update the description / planner docs to make the family-agnostic semantic explicit — then the bug becomes a doc bug, not a scoping bug. The current state is the worst of both worlds.

---

#### BL-04: `update_shopify_connection` accepts a caller-supplied `user_id` with no `auth.userId` equality check

**File:** `lib/tools/update-shopify-connection.ts:64-67, 123-141`

**Issue:**
The input schema requires `user_id: z.string().min(1)` (line 64) and forwards it into the upstream body verbatim (line 141). There is no check anywhere in the handler that `args.user_id === auth.userId`. An LLM that hallucinates (or is prompt-injected into supplying) a user_id from a different tenant will issue a PUT to `/shopify/connection` with that foreign user_id in the body.

Whether this is exploitable depends on whether the upstream platform-api trusts the body's `user_id` or the JWT subject. The defensive position — and the one Phase 1's account-scope work explicitly took — is to bind to `auth.userId` server-side rather than letting the LLM supply it. The body's `user_id` is at best redundant; at worst it's a cross-tenant write vector that the MCP layer is silently enabling.

The same shape exists in `repair_integration_orders` (`user_id` is a required string forwarded verbatim, `lib/tools/repair-integration-orders.ts:63-68, 138`) and in the query-param shape of `list_integration_order_reasons` (`user_id` forwarded as a query param, `lib/tools/list-integration-order-reasons.ts:75-81, 136`). For the read tool the worst case is enumeration; for the writes (repair, update connection) it's privilege escalation.

**Fix:**
Either
(a) remove `user_id` from the input schema and inject `auth.userId` server-side at body-build time — preferred, since the JWT already binds the call; or
(b) assert `args.user_id === auth.userId` at the top of the handler and refuse with a typed error otherwise.

```ts
// preferred (a):
const inputSchema = z.object({
  shop_name: ...,
  code: ...,
  is_fulfillment: ...,
  token: ...,
  // NOTE: user_id is taken from auth.userId by the handler — NOT a caller arg.
  ...,
});
// in handler:
const body: Record<string, unknown> = {
  shop_name: args.shop_name,
  code: args.code,
  is_fulfillment: args.is_fulfillment,
  token: args.token,
  user_id: auth.userId,   // bind to the JWT subject
};
```

Apply the same fix to `repair_integration_orders.user_id` and `list_integration_order_reasons.user_id`. The Phase 1 `get_account` family discovers `auth.userId` from the JWT bridge — that is the canonical source; the LLM should never have to (or be allowed to) re-supply it.

---

### WARNING Issues

#### WR-01: `country_filter` schema is length-2 only — same Phase-1 BL-02 shape: `"12"`, `"  "`, or `"\\n\\n"` all pass

**Files:**
- `lib/tools/update-salla-config.ts:112-118`
- `lib/tools/upsert-woocommerce-config.ts:90-96`

**Issue:**
Both tools use `z.array(z.string().length(2))` for the ISO-3166 alpha-2 country filter. `.length(2)` is a character-count check only — `["12", "??", "  ", "  "]` all parse successfully and are forwarded upstream verbatim. The test in `tests/tools/salla-integration.test.ts:527-535` confirms `"XYZ"` (length 3) is rejected and `"AE"` is accepted, but does not test `"12"` or lowercase `"ae"`.

Phase 1's BL-02 (per the context note "ISO-3166 enforcement") was the same shape. The fix the planner committed there should be lifted into a shared validator and reused.

**Fix:**

```ts
// lib/clients/quiqup-env.ts (or a new lib/validators.ts):
import { z } from "zod";

/** ISO-3166 alpha-2: exactly two uppercase ASCII letters. */
export const iso3166Alpha2 = z
  .string()
  .regex(/^[A-Z]{2}$/, "must be ISO-3166 alpha-2 (e.g. AE, SA)");
```

then replace `z.string().length(2)` in both tools with `iso3166Alpha2`, and add a negative test for `"12"` + a positive for `"AE"` in the existing test suites.

---

#### WR-02: `start_date` / `end_date` schemas accept any string including `""`

**Files:**
- `lib/tools/list-integration-order-reasons.ts:67-74`
- `lib/tools/repair-integration-orders.ts:69-75`

**Issue:**
Both tools document `start_date` / `end_date` as ISO-8601 date-time and forward the value verbatim into a query string (list) or body (repair). The schema is plain `z.string()` — no `.min(1)`, no `.datetime()` (Zod has had this since v3.20). An empty string passes Zod and is URL-encoded into `?start_date=&end_date=` which the upstream may interpret as `epoch`-or-`now`-or-422 depending on Rails parsing.

Same shape as Phase-1's input-validation gap. Easy fix.

**Fix:**

```ts
start_date: z
  .string()
  .datetime({ message: "must be ISO-8601 date-time, e.g. 2026-05-01T00:00:00Z" })
  .describe(...);
```

The Zod error message will flow back through `registerTool`'s schema-parse failure path, which is already wired.

---

#### WR-03: `install_salla` has no `guardrails` — audit / rate-limit / idempotency all unconfigured

**File:** `lib/tools/install-salla.ts:38-82`

**Issue:**
The tool returns a Salla OAuth install URL — a one-shot caller-redirect link with a (presumably) embedded `state` token. There is no `guardrails` config, so:

1. No audit record on calls — every Salla install attempt is invisible to the audit log.
2. No rate-limit — a runaway LLM could call this 10/sec, generating 10/sec OAuth URLs upstream (each may consume Salla-side state).
3. The URL itself includes a `state` (per the OAuth pattern), which appears in `content[0].text` to the LLM. If that state token is per-call, repeated calls are wasteful upstream; if it's session-bound, repeated calls return the same URL but a leaky audit is still a gap.

The other Salla read tools (`get_salla_connection`, `get_salla_platform_data`, `get_salla_config`) are pure reads, so no guardrails is reasonable. `install_salla` is a transactional-read that initiates a flow — closer to a write semantically.

**Fix:**
Add at minimum `audit: true` and a modest rate-limit (10/min is enough). Idempotency keying is unnecessary for a state-fetching read.

```ts
guardrails: {
  rateLimit: { capacity: 10, refillPerSec: 10 / 60 },
  audit: true,
},
```

Apply the same review to `setup_shopify_callback` (already has guardrails — good) vs `install_salla` (does not). The pattern should be "anything that initiates or completes an OAuth handshake is audited".

---

#### WR-04: Dry-run path skips JWT mint but description says "every pre-flight check (auth, scope, confirm)"

**File:** `lib/middleware/destructive.ts:65-76`, `lib/tools/delete-integration-source.ts:146-170`, `lib/tools/delete-salla-connection.ts:133-155`

**Issue:**
`destructiveDryRunField.describe(...)` says "run every pre-flight check (auth, scope, confirm) but DO NOT call the upstream destructive endpoint". The actual handler order:

1. `if (!auth.userId) throw` — yes.
2. `requireConfirm(...)` — yes.
3. `if (isDryRun(args)) return preview` — short-circuit HERE.
4. `await getQuiqupReadyJwt(auth.userId)` — never reached on dry-run.
5. `const platformApiBase = getPlatformApiBaseUrl(args.environment)` — never reached.
6. (No `scope` helper actually invoked — the description text mentions `scope` but no scope assertion exists for these tools.)

So the dry-run preview does NOT exercise the JWT bridge — meaning an agent can dry-run a delete from a userId whose `getQuiqupReadyJwt` would actually fail (e.g. revoked Clerk session, mid-token-rotation) and get a green "would_delete" response. The agent thinks the gate has cleared end-to-end; in reality the auth-bridge step is mocked away.

Either move the JWT mint above the dry-run short-circuit, or update the description to be honest about what runs in dry-run.

**Fix:**

```ts
// preferred — exercise the bridge so dry-run is a real pre-flight:
const jwt = await getQuiqupReadyJwt(auth.userId);  // moved above the dry-run check
const platformApiBase = getPlatformApiBaseUrl(args.environment);
if (isDryRun(args)) {
  return { ... };
}
// ... use jwt + platformApiBase below
```

If the JWT mint is left below (cheaper dry-run), update `destructiveDryRunField.describe` to read "run schema + confirm + auth-presence checks (NOT the JWT-bridge handshake)".

---

#### WR-05: `delete_integration_source.source` enum hardcodes `["shopify","woocommerce","salla"]` — drift risk vs `list_integration_connections.connections[].source`

**File:** `lib/tools/delete-integration-source.ts:52-58`

**Issue:**
The schema enum is `z.enum(["shopify","woocommerce","salla"])`. The companion read tool `list_integration_connections` documents the response shape (`list-integration-connections.ts:23-29`) as `source: 'shopify' | 'woocommerce' | 'salla' | …` — with the trailing ellipsis indicating future families. When (not if) upstream adds a 4th family (Magento, BigCommerce, etc.), the delete tool will silently refuse to delete those at schema-parse, while the corresponding `list_integration_connections` will happily list them. The error path is unobvious: a Zod parse failure returns "invalid_enum_value" without naming the upstream-vs-MCP-layer drift.

**Fix:**
Either pull the source enum into `lib/clients/quiqup-env.ts` as a single named export (`IntegrationSource = z.enum([...])`) and import it everywhere both the read and delete sides use it — so adding a family is a one-line change — or keep the per-tool enum but add a runtime-friendly error path that mentions "verify against `list_integration_connections[].source`". The shared-helper option is preferred.

---

#### WR-06: WooCommerce webhook secrets exposed in `list_woocommerce_connections` response

**File:** `lib/tools/list-woocommerce-connections.ts:42-44, 76-79`

**Issue:**
Per the description and the upstream OpenAPI reference in the file header, the response includes `order_created_webhook_secret` and `order_updated_webhook_secret`. A WooCommerce webhook signing secret is exactly the credential an attacker needs to forge `order.created` / `order.updated` webhook events into the Quiqup platform — substantially MORE dangerous than the REST `token` because the platform consumes those webhooks asynchronously and may auto-create fulfillment orders from them.

This is captured under BL-01 above but called out separately here as a WARNING because the webhook secret leakage is independently severe even if the `token` strip is implemented — both must be stripped, not just `token`.

**Fix:**
Strip all of `token`, `order_created_webhook_secret`, `order_updated_webhook_secret` from the response, per the BL-01 fix snippet.

---

#### WR-07: `platformApiFetch` helper still not adopted — 50 tools each inline the same fetch + Bearer + QuiqupHttpError block (Phase 1 WR-07 deferred)

**Files:**
- `lib/tools/*.ts` — every Phase-1 and Phase-2 platform tool

**Issue:**
The Phase 1 review (per the context note) flagged this as WR-07 and it was explicitly deferred. Phase 2 added another ~22 Platform-API tools, each with the same five-line block:

```ts
const jwt = await getQuiqupReadyJwt(auth.userId);
const platformApiBase = getPlatformApiBaseUrl(args.environment);
const res = await fetch(`${platformApiBase}/...`, {
  method: "GET",
  headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
});
if (!res.ok) throw new QuiqupHttpError(res.status, await res.text());
const data = await res.json();
```

Bash grep confirms: 50 tool files inline `Authorization` + `Bearer`, 80 import `getPlatformApiBaseUrl` / `getQuiqupReadyJwt`. Every new tool is another opportunity to forget the `if (!res.ok)` line, or pass the wrong `Accept` header, or build a URL without `encodeURIComponent`, or accidentally include a body on a DELETE.

This deferral is now a Phase-2-scale debt: extracting `platformApiFetch(args, "/path", {method, body?})` would let `delete_integration_source.handler` shrink from ~30 lines to ~8, would centralize the JWT-mint + base-URL + error-throw triad, and would let the scope-pre-flight pattern from BL-03 land in ONE place rather than 50.

**Fix:**

```ts
// lib/clients/platform-api.ts (new file)
import { getQuiqupReadyJwt } from "@/lib/quiqup";
import { QuiqupHttpError } from "@/lib/clients/quiqup-lastmile";
import { getPlatformApiBaseUrl } from "@/lib/clients/quiqup-env";

export interface PlatformApiFetchOpts {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;                            // serialized as JSON when present
  searchParams?: Record<string, string>;
}

export async function platformApiFetch(
  userId: string,
  environment: "production" | "staging" | undefined,
  path: string,                             // must start with "/"; caller responsible for encodeURIComponent
  opts: PlatformApiFetchOpts = {},
): Promise<unknown> {
  const jwt = await getQuiqupReadyJwt(userId);
  const base = getPlatformApiBaseUrl(environment);
  const url = new URL(`${base}${path}`);
  for (const [k, v] of Object.entries(opts.searchParams ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) throw new QuiqupHttpError(res.status, await res.text());
  if (res.status === 204) return null;
  return res.json();
}
```

Migrate over a few tools per PR to keep the diff reviewable; the destructive tools are good first candidates because their handlers are short and well-tested.

---

#### WR-08: `update_shopify_config` schema requires all 4 fields of `delivery_methods[]` items, but the upstream may accept partial — description says "partial update"

**File:** `lib/tools/update-shopify-config.ts:48-62`

**Issue:**
The description (line 105-106) says "All fields except `shop_name` are optional — only the keys supplied are forwarded upstream (partial update)." The handler body-build at lines 137-148 honors that for top-level fields. But within `delivery_methods[]`, the schema requires every item to carry all of `quiqup_name`, `shipping_method_id`, `shipping_profile_id`, `shopify_name`:

```ts
delivery_methods: z.array(z.object({
  quiqup_name: z.string(),
  shipping_method_id: z.string(),
  shipping_profile_id: z.string(),
  shopify_name: z.string(),
})).optional()
```

An LLM trying to "fix one delivery method" would have to re-supply all 4 fields of every method in the array. If the upstream actually does a wholesale replacement of `delivery_methods[]` (treating the array as authoritative), the description's "partial update" framing is misleading; if upstream does per-key merge, the schema is overly strict. Either way, the description and schema disagree.

**Fix:**
Decide which is upstream's actual behaviour (source-doc line 1487-1515 should say, per the file header) and reconcile. If upstream is array-replace, the description should clarify "you must re-send the full delivery_methods[] array — supplying a single item replaces all". If upstream is per-item merge, mark the inner fields optional.

---

#### WR-09: `delete_salla_connection.resourceDescription` reveals the connection id in `isError` text without `confirm`

**File:** `lib/tools/delete-salla-connection.ts:121-125`

**Issue:**
On a no-confirm rejection, the structured error result text (built by `buildConfirmationRequiredResult` in `lib/middleware/destructive.ts:136-150`) reads:

```
Confirmation required: `delete_salla_connection` would delete Salla connection id ${args.id}. NO upstream call was made. ...
```

`${args.id}` is dropped into the LLM-visible error text without any encoding or length cap. Two minor risks:

1. **Log injection.** If an LLM (or a misbehaving caller) passes `id = "abc\\nadmin_session: <fake-data>\\nlog_level: critical"`, the audit log line carrying the error gets a multi-line payload that downstream log-aggregation may mis-parse. (Mitigated by `JSON.stringify` in the audit emit, but the `error` field is currently `err.message` style — not JSON-stringified at the point of capture.)
2. **PII / unintended disclosure.** Connection ids aren't strictly PII, but the merchant didn't ask for them to be echoed back; the description-only doesn't constrain length, so an LLM that copy-pastes an entire `list_integration_connections` row into `id` will see that row reflected back.

This is a small thing but trivial to fix.

**Fix:**

```ts
const safeId = args.id.slice(0, 256).replace(/[\\r\\n]/g, " ");
requireConfirm(
  "delete_salla_connection",
  args,
  `Salla connection id ${JSON.stringify(safeId)}`,
);
```

The same idea for `delete_integration_source`'s `shop_name` interpolation (currently `\`${args.source} connection for shop "${args.shop_name}"\``).

---

### INFO Issues

#### IN-01: `lib/middleware/destructive.ts` header comment lists future-phase tool names that may drift

**File:** `lib/middleware/destructive.ts:6-14, 36-41`

**Issue:**
The header enumerates Phase 4/6/8/9/10 destructive tools by name ("batch status transitions, cancel_inbound, delete_products, delete_dispatcher_rule_set, delete_stripe_payment_method, …"). When those phases land they may rename — leaving this header out of date and slightly misleading.

**Fix:**
Either treat the list as illustrative (add "(names may evolve)") or wire a real cross-reference (e.g. `// see ROADMAP.md Phase 4–10 for the canonical list`). Lower priority — purely documentation.

---

#### IN-02: `ConfirmationRequiredError.message` and `buildConfirmationRequiredResult` text duplicate the same string with different formatting

**File:** `lib/middleware/destructive.ts:88-96, 136-150`

**Issue:**
The Error's own `message` is "Confirmation required: ${toolName} would delete ${resourceDescription}. Re-call with confirm: true to actually perform the deletion." The `buildConfirmationRequiredResult` text wraps the same toolName and resourceDescription in backticks and adds the dry-run hint. Two messages, two formats, easy to drift. If a future caller chooses to `throw` rather than `catch+convert`, the LLM sees a different string than the canonical one.

**Fix:**
Have `ConfirmationRequiredError.constructor` accept (or store) a single canonical message-render that `buildConfirmationRequiredResult` reuses verbatim. Small.

---

#### IN-03: `tests/tools/destructive-integrations.test.ts` has 14 it-blocks but two are nearly identical except for `confirm: false` vs missing

**File:** `tests/tools/destructive-integrations.test.ts` (path [1] and path [2] in each describe block)

**Issue:**
The "[1] confirm missing" and "[2] confirm: false (defense-in-depth)" tests for each tool differ only in whether `confirm: false` is set explicitly. Both assert the same thing: no upstream DELETE, `isError: true`, text contains the tool name + "confirm: true". A small `it.each([undefined, false])` parameterization would shrink the suite without losing coverage.

**Fix:**

```ts
it.each<{ label: string; confirm: boolean | undefined }>([
  { label: "[1] confirm missing", confirm: undefined },
  { label: "[2] confirm: false", confirm: false },
])("$label → isError, NO upstream DELETE", async ({ confirm }) => { ... });
```

---

#### IN-04: `evals/snapshots/tool-surface.json` not surfaced — relying on commit-time snapshot diff alone

**File:** `evals/snapshots/tool-surface.json` + `.github/workflows/eval-gate.yml:50-68`

**Issue:**
The tool-surface snapshot is the only protection against silently dropping a tool from the registered surface — and it's a flat JSON file with no schema. If a PR adds a tool but forgets to update the snapshot, the eval-gate `bun run eval:tool-surface` fails (good). But if a PR REMOVES a tool, updating the snapshot to "match" silently green-lights the regression — there's no human-friendly diff signal beyond what `git diff` shows.

**Fix:**
Make the tool-surface eval also emit a count of new vs removed tools and refuse to run when the diff includes a removal unless `ALLOW_TOOL_REMOVAL=1` is set. Low priority — current state is fine, this is a guardrail.

---

#### IN-05: `confirm_ff_export` rate-limit (30/min) is the highest among write tools; comment says "webhook-driven acks come in pulses"

**File:** `lib/tools/confirm-ff-export.ts:73-79`

**Issue:**
30/min is 5–10× the other Phase-2 write tools (most are 5–10/min). The justification comment is reasonable ("webhook-driven acks come in pulses") but worth double-checking against actual expected throughput. If pulses are typically 5–10 at a time but spread across seconds, the burst capacity might be set too high (a buggy agent could ack 30 unrelated orders in a single second under this limit).

**Fix:**
Confirm the actual webhook arrival shape with the platform team before this lands in production. If pulses are truly 30 at once, fine; if not, drop to 10/min with a smaller burst capacity. Lower priority — easy to tune later.

---

_Reviewed: 2026-05-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
