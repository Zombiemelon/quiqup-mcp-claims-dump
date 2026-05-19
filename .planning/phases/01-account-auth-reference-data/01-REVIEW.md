---
phase: 01-account-auth-reference-data
reviewed: 2026-05-19T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - app/[transport]/route.ts
  - lib/clients/google-places.ts
  - lib/tools/get-account.ts
  - lib/tools/get-permissions.ts
  - lib/tools/get-account-capabilities.ts
  - lib/tools/get-account-by-id.ts
  - lib/tools/get-quiqdash-init.ts
  - lib/tools/whoami-platform.ts
  - lib/tools/list-service-kinds.ts
  - lib/tools/list-quiqup-order-states.ts
  - lib/tools/list-account-addresses.ts
  - lib/tools/create-partner-address.ts
  - lib/tools/update-partner-address.ts
  - lib/tools/list-countries.ts
  - lib/tools/list-country-states.ts
  - lib/tools/list-country-cities.ts
  - lib/tools/list-state-cities.ts
  - lib/tools/lookup-google-place.ts
  - lib/tools/list-partner-cancellation-reasons.ts
  - lib/tools/list-on-hold-reasons.ts
  - lib/tools/list-return-to-origin-reasons.ts
  - lib/tools/list-cancellation-reasons.ts
  - lib/tools/list-courier-failure-reasons.ts
  - lib/tools/update-account.ts
  - lib/tools/decide-feature-flags-bulk.ts
  - lib/tools/get-return-settings.ts
  - lib/tools/update-return-settings.ts
  - lib/tools/create-account-team-member.ts
  - tests/tools/auth-account-reads.test.ts
  - tests/tools/address-and-reasons-reads.test.ts
  - tests/tools/auth-account-writes.test.ts
  - tests/tools/google-places.test.ts
  - evals/get-account.ts
  - evals/lookup-google-place.ts
  - evals/score-get-account.ts
  - evals/score-lookup-google-place.ts
  - evals/datasets/get-account-v1.ts
  - evals/datasets/lookup-google-place-v1.ts
  - .github/workflows/eval-gate.yml
findings:
  critical: 0
  blocker: 2
  warning: 9
  info: 5
  total: 16
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-19
**Depth:** standard
**Scope:** 17 commits `4654098..f705d1e` on branch `claude/add-skip-discuss-config-hIwXh`. ~26 new MCP tool files under `lib/tools/`, the new `lib/clients/google-places.ts`, the modified `app/[transport]/route.ts`, two new MSW test suites under `tests/tools/`, and the Langfuse eval scaffolding under `evals/`.
**Status:** issues_found

## Summary

The Phase-1 substrate is unusually careful about the two highest-value security concerns:
1. Google Places API-key isolation (key never echoed, no Bearer header, tested at unit + eval layers); and
2. `decide_feature_flags_bulk` Identifier server-binding (Identifier sourced from `auth.userId`, locked in by test and described as a security invariant).

Both are implemented correctly and well-tested. The "AUTH EXCEPTION" comment block in `google-places.ts` is exemplary defensive documentation.

That said, the broader Phase-1 write surface (`update_account`, `update_return_settings`, `update_partner_address`, `create_partner_address`, `create_account_team_member`, `decide_feature_flags_bulk`) ships with **no `guardrails` block at all** — no rate-limit, no idempotency, no audit. Per `register.ts:265-376` that means these writes are completely off the audit log. `create_account_team_member`'s own description calls itself "a privilege-escalation action" — that is exactly the operation the audit log exists for. This is the dominant blocker below.

A second blocker is the ISO-3166 validation slip in `create_partner_address.country` (`.min(2)` rather than `.length(2)`), which lets non-ISO values through to upstream where they'll fail with an opaque 422.

Everything else is warning- or info-grade: schema/type sharpness, defensive bounds, repeated boilerplate that could be factored, and a couple of test/eval edge cases.

## Blocker Issues

### BL-01: Phase-1 write tools ship with no guardrails — no audit, no rate-limit, no idempotency

**Files:**
- `lib/tools/update-account.ts:66-138`
- `lib/tools/update-return-settings.ts:60-114`
- `lib/tools/update-partner-address.ts:43-104`
- `lib/tools/create-partner-address.ts:45-106`
- `lib/tools/create-account-team-member.ts:48-98`
- `lib/tools/decide-feature-flags-bulk.ts:45-98`

**Issue:** None of the six Phase-1 write tools set the `guardrails` field on their `ToolSpec`. Per `lib/tools/register.ts:269-270` (`const auditEnabled = guardrails ? guardrails.audit !== false : false`), this means **no audit record is emitted for any of these writes** — successes, failures, or rate-limit denials. There is also no idempotency for `create_account_team_member` (a Clerk-team binding that the description itself calls "a privilege-escalation action"; a retry-after-network-blip will provision a second invite or 409), no idempotency for `update_account` (a PUT against the bank-details-bearing endpoint), and no rate limit anywhere on the write surface.

The decision-log entry in `update-account.ts:9-19` carves in the AUTH-07 / FIN-05 disambiguation but does not mention guardrails; the omission appears to be drift, not a deliberate "thin pass-through" choice — `create_account_team_member.ts:55-58` itself acknowledges the operation is privilege-escalating and recommends operator confirmation. Audit log existence is the minimum bar.

**Fix:** Add a `guardrails` block to each write spec, e.g.:

```ts
// create-account-team-member.ts — privilege-escalation, narrow burst
guardrails: {
  rateLimit: { capacity: 5, refillPerSec: 5 / 60 },
  idempotency: { keyArg: "idempotency_key", ttlMs: 15 * 60 * 1000 },
  audit: true,
},
```

Add an optional `idempotency_key: z.string().optional()` field to the input schema for each of the four create/update tools so the LLM can deduplicate retries. `decide_feature_flags_bulk` does not need idempotency (it's a read-shaped POST) but should still emit audit because it reveals the partner's feature surface; set `guardrails: { audit: true }` at minimum.

---

### BL-02: `create_partner_address.country` allows non-ISO-3166 values through to upstream

**File:** `lib/tools/create-partner-address.ts:30-32`

**Issue:** The country field is validated as `z.string().min(2, "country is required (ISO-3166 alpha-2, e.g. 'AE')")` but the description and downstream contract both require an ISO-3166 alpha-2 code (exactly 2 characters). `.min(2)` accepts `"USA"`, `"United Arab Emirates"`, or any other longer string — those flow straight to `POST /partner/addresses` and surface as opaque 422s with no actionable field-level detail at the LLM layer.

Compare `list_country_states.country_iso2` (`lib/tools/list-country-states.ts:21`), which correctly uses `.length(2)`. The schema is inconsistent with itself across the surface.

**Fix:**

```ts
// create-partner-address.ts
country: z
  .string()
  .length(2, "country must be ISO-3166 alpha-2 (e.g. 'AE')")
  .describe("ISO-3166 alpha-2 country code"),
```

Mirror the same change in `update-partner-address.ts:29-33` (`z.string().min(2).optional()` → `z.string().length(2).optional()`).

## Warnings

### WR-01: `update_account` accepts bank fields with no string bounds and no luhn/format validation

**File:** `lib/tools/update-account.ts:46-62`

**Issue:** `bank_account_number`, `bank_iban`, `bank_swift`, `bank_account_holder` are `z.string().optional()` — no min, max, or format check. An LLM hallucinating an IBAN or a malformed BIC will get a remote 422 with whatever Quiqup happens to return; meanwhile, in the interim, the write is in-flight with the bad value. Combined with the absence of audit (BL-01), there is no trace of the rejected attempt.

This file also references a future `update_bank_details` (FIN-05, Phase 10) as the safer constrained variant — but `update_account` is the **only** path that exposes bank fields today, so the "safer narrower variant" disclaimer is aspirational, not effective.

**Fix:** Add minimum format guards at the Zod layer to fail fast and surface a useful message:

```ts
bank_iban: z
  .string()
  .regex(/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/i, "IBAN must start with two letters + two digits")
  .optional(),
bank_swift: z
  .string()
  .regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i, "SWIFT/BIC must be 8 or 11 chars")
  .optional(),
bank_account_number: z.string().min(4).max(34).optional(),
bank_account_holder: z.string().min(1).max(140).optional(),
```

---

### WR-02: `coordinates.lat`/`lng` accept `NaN` and unbounded strings

**Files:**
- `lib/tools/create-partner-address.ts:23,33,76-78`
- `lib/tools/update-partner-address.ts:21,34,72-77`

**Issue:** `const coordinate = z.union([z.string(), z.number()])` accepts `NaN`, `Infinity`, and any string (including the empty string and `"not-a-number"`). The handler then unconditionally `String(args.coordinates.lat)` — so `NaN` becomes the literal string `"NaN"` and is shipped to `/partner/addresses`, where it will 422 with no field-level detail.

**Fix:** Reject NaN/Infinity and bound lat/lng at the schema:

```ts
const coordinate = z.union([
  z
    .number()
    .finite()
    .refine((n) => !Number.isNaN(n), "coordinate must be a real number"),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, "coordinate string must be a numeric literal"),
]);
```

Optionally bound: `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]` after coercion.

---

### WR-03: Wide-open `z.record()` blobs ship with no bounds

**Files:**
- `lib/tools/update-account.ts:55` — `settings: z.record(z.string(), z.unknown()).optional()`
- `lib/tools/update-return-settings.ts:51-54` — `settings: z.record(z.string(), z.unknown()).optional()`

**Issue:** Both writes accept an unbounded `settings` blob. An LLM emitting a giant nested object (or one with control chars in keys) will silently ship MBs of JSON upstream. Combined with BL-01 (no audit), there is no record of what was sent. Even with audit, the absence of a size cap means a single confused tool call can balloon the audit-log line size.

**Fix:** Add a serialised-size guard at the handler (cheaper than per-key validation):

```ts
if (args.settings !== undefined) {
  const serialised = JSON.stringify(args.settings);
  if (serialised.length > 64_000) {
    throw new Error("settings blob exceeds 64KB; narrow the payload");
  }
  body.settings = args.settings;
}
```

---

### WR-04: `update_partner_address.coordinates` requires both `lat` and `lng` for a partial update

**File:** `lib/tools/update-partner-address.ts:34`

**Issue:** The field is `z.object({ lat: coordinate, lng: coordinate }).optional()`. A caller patching ONLY the latitude has no way to express that without re-supplying the longitude they may not remember. Since the description explicitly promises "partial update; only fields included in the call are mutated", this is a contract mismatch.

**Fix:** Either (a) keep both required when `coordinates` is supplied but document the all-or-nothing semantics in the description, or (b) make the inner fields optional:

```ts
coordinates: z
  .object({ lat: coordinate.optional(), lng: coordinate.optional() })
  .refine((c) => c.lat !== undefined || c.lng !== undefined, {
    message: "supply lat, lng, or both",
  })
  .optional(),
```

The handler must then guard the `String(args.coordinates.lat)` / `String(args.coordinates.lng)` calls before sending.

---

### WR-05: `auth-account-reads.test.ts` setup does not unset `QUIQUP_PLATFORM_API_BASE_URL`

**Files:**
- `tests/tools/auth-account-reads.test.ts:53-55`
- `tests/tools/address-and-reasons-reads.test.ts:47-49`
- `tests/tools/auth-account-writes.test.ts:52-54`

**Issue:** The MSW handlers all use the production base URL string `https://platform-api.quiqup.com`. The test comment (`auth-account-reads.test.ts:18-21`) acknowledges this requires that no `QUIQUP_PLATFORM_API_BASE_URL` override exist in the test env, but the `beforeEach` only calls `vi.clearAllMocks()` — it does NOT delete the env var. A developer who has `QUIQUP_PLATFORM_API_BASE_URL` set in their shell will see every assertion in these three suites fail silently because `getPlatformApiBaseUrl` will route the fetch to a host MSW is not intercepting.

The `google-places.test.ts` suite correctly handles this for `GOOGLE_PLACES_BASE_URL` (`beforeEach` deletes it, `afterEach` restores), so the pattern is known to the codebase.

**Fix:** Mirror the google-places pattern in the three platform-api suites:

```ts
const originalPlatformUrl = process.env.QUIQUP_PLATFORM_API_BASE_URL;
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
});
afterEach(() => {
  if (originalPlatformUrl === undefined) delete process.env.QUIQUP_PLATFORM_API_BASE_URL;
  else process.env.QUIQUP_PLATFORM_API_BASE_URL = originalPlatformUrl;
});
```

---

### WR-06: Tests bypass Zod input parsing — `.default("production")` is never exercised

**Files:** all three new test suites (`auth-account-reads.test.ts`, `address-and-reasons-reads.test.ts`, `auth-account-writes.test.ts`)

**Issue:** Every test calls `mod.spec.handler(auth, { environment: "production" })` directly. The handler signature accepts `z.input<TInput>` raw — so the Zod schema is never run on the args object. This means:

1. The `.default("production")` on `environmentField` is never tested.
2. Invalid `delivery_type` values for `list_courier_failure_reasons` would not be caught at the unit-test layer (you'd only catch them via the SDK's pre-handler parse in production, which `register.ts:188-193` flags as "TODO(verify)" — i.e. unverified).
3. The `email().` validation in `create_account_team_member` is tested via `inputSchema.safeParse` (`auth-account-writes.test.ts:330-336`) but NOT via the handler-invocation path — so an unverified-by-SDK regression would slip through.

**Fix:** Add at least one schema-parse-then-handler-invoke test per write tool:

```ts
const parsed = mod.spec.inputSchema.safeParse({ /* args without environment */ });
expect(parsed.success).toBe(true);
if (!parsed.success) return;
const result = await mod.spec.handler(auth, parsed.data);
```

Locks in `.default("production")` and any future `.refine()` checks.

---

### WR-07: Repeated platform-API boilerplate across 23 tool files invites drift

**Files:** every tool file in this phase except `lookup-google-place.ts`.

**Issue:** Every reads-and-writes tool repeats this skeleton verbatim:

```ts
if (!auth.userId) throw new Error("<name> requires an authenticated user");
const jwt = await getQuiqupReadyJwt(auth.userId);
const platformApiBase = getPlatformApiBaseUrl(args.environment);
const res = await fetch(`${platformApiBase}/<path>`, {
  method: "<M>",
  headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" /* +Content-Type when body */ },
  body: JSON.stringify(body),
});
if (!res.ok) throw new QuiqupHttpError(res.status, await res.text());
return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
```

This is ~20 lines × 23 tools = ~460 lines of structurally identical code. Three real concerns flow from this:

1. **Drift**: `get_permissions` correctly sends `x-api-version: 1`, but `whoami_platform` also requires it (it does — line 81 — good). However, future additions are easy to miss. There is no central place that says "if your endpoint is `/permissions` or `/me`, include the version header".
2. **Inconsistency**: A handful of tools (`get_account`, `get_account_capabilities`, `get_account_by_id`, `list_account_addresses`, all reasons tools) all use a near-identical inline GET shape that differs only in path. A small `platformGet(path, jwt, opts)` helper would eliminate ~150 lines.
3. **Missing chokepoint**: `register.ts` already has the wrapper concept; a `platformFetch` helper would be the matching chokepoint where things like `x-api-version`, `User-Agent`, request-id propagation, or upstream-circuit-breaking get added later. Right now those additions require touching every tool.

**Fix:** Extract a `lib/clients/platform-api.ts` helper:

```ts
export async function platformApiFetch(
  auth: AuthContext,
  args: { environment?: QuiqupEnvironment },
  init: { method: HttpMethod; path: string; body?: unknown; query?: Record<string, string>; apiVersion?: string },
): Promise<unknown> {
  const jwt = await getQuiqupReadyJwt(auth.userId!);
  const base = getPlatformApiBaseUrl(args.environment);
  const url = new URL(`${base}${init.path}`);
  if (init.query) for (const [k, v] of Object.entries(init.query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    Accept: "application/json",
  };
  if (init.apiVersion) headers["x-api-version"] = init.apiVersion;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(url.toString(), {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new QuiqupHttpError(res.status, await res.text());
  return res.json();
}
```

Each tool collapses to ~6 lines. (This is also where you'd add the auth.userId guard once, making BL-01 easier to roll out.)

---

### WR-08: `decide_feature_flags_bulk` ignores extraneous args silently

**File:** `lib/tools/decide-feature-flags-bulk.ts:73-77`

**Issue:** The security comment correctly says the handler ignores any `Identifier` smuggled in args because the body is built field-by-field from `auth.userId`. But the test (`auth-account-writes.test.ts:111-138`) only verifies that the schema does not list `Identifier` — it does NOT verify that smuggling `Identifier` via raw args is in fact ignored. Because the handler runs from `z.input<TInput>` (not parsed), an LLM could in principle pass `{ features: [...], Identifier: "victim-id" }` and the only thing protecting the invariant is the field-by-field extraction in the body builder. That extraction is correct today, but a future refactor to `body = { Features: args.features, Identifier: auth.userId, ...args }` (spread) would silently break the invariant.

**Fix:** Add a regression test that hits the handler with a smuggled Identifier and asserts the body still carries `auth.userId`:

```ts
it("ignores smuggled Identifier in args (T-01-18 regression guard)", async () => {
  let captured: Record<string, unknown> | undefined;
  server.use(http.post(`${PLATFORM}/featureflags/decide-bulk`, async ({ request }) => {
    captured = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({});
  }));
  const mod = await import("../../lib/tools/decide-feature-flags-bulk");
  // Cast to bypass TS — simulating what the SDK would forward if mcp-handler doesn't strip extras.
  await mod.spec.handler(auth, {
    features: ["new_dashboard"],
    environment: "production",
    Identifier: "victim_account",
  } as never);
  expect(captured!.Identifier).toBe("user_test"); // NOT "victim_account"
});
```

---

### WR-09: Eval source-string scorer's comment-stripper is regex-fragile

**File:** `evals/score-lookup-google-place.ts:182-186`

**Issue:** `stripComments`:

```ts
.replace(/\/\*[\s\S]*?\*\//g, "")          // block comments
.replace(/(^|[^:])\/\/.*$/gm, "$1");        // line comments (skip protocol-//-)
```

The block-comment regex will gladly strip the contents of a string literal that happens to contain `/* … */` (e.g. a doc URL with `/*` in a query string). The protocol guard `[^:]` for line comments is asymmetric — it correctly skips `https://` but it also passes through `;//` and `'//` (you might want it to). More importantly, neither pass understands template literals — `` `foo /* not a comment */ bar` `` will be partially deleted.

For today's two source files this happens to be safe (no string literals contain those sequences). But the scorer is also documented as a CI gate (`auth-isolation`, `min: 1.0`); a future edit to either file that introduces an innocuous URL-with-block-comment-syntax could turn the scorer into a false-positive blocker on PRs.

**Fix:** Either constrain the search to import statements only (more conservative for the intent):

```ts
const importLineRe = /^\s*import\s.*$/gm;
const imports = source.match(importLineRe) ?? [];
return imports.join("\n");
```

…or accept the regex as a heuristic and add a comment that any false-positive can be worked around by quoting the identifier (`"getQuiqup" + "ReadyJwt"`). The current state advertises stronger guarantees than it actually delivers.

## Info

### IN-01: `GooglePlacesClient.defaultFieldMask` opt is declared but never set by the lone consumer

**Files:**
- `lib/clients/google-places.ts:39-59`
- `lib/tools/lookup-google-place.ts:80`

**Issue:** `lookup-google-place.ts:80` does `new GooglePlacesClient({ apiKey })` — never passing `defaultFieldMask`. The opt exists in the type but no caller exercises it; in practice the fallback chain is always `init.fieldMask ?? undefined ?? DEFAULT_FIELD_MASK`. The opt is harmless and may be useful for future consumers, but consider deleting it until a second consumer appears — it's currently dead surface and the module's `GOOGLE_PLACES_DEFAULT_FIELD_MASK` re-export covers the same need.

**Fix:** Optional — either delete `defaultFieldMask` from `GooglePlacesClientOptions` until a second caller wants it, or leave with a `// reserved for future consumers` comment.

---

### IN-02: `list_country_cities.country_name_or_iso2.min(2)` is permissive on purpose, but not documented

**File:** `lib/tools/list-country-cities.ts:18-26`

**Issue:** Unlike `list_country_states.country_iso2.length(2)`, this field's `.min(2)` is intentional because upstream accepts EITHER ISO2 OR a full name. The description explains the dual-form upstream behaviour, but the schema description doesn't mention the contrast with `list_country_states` (which is alpha-2 only). An LLM might pass `"AE"` here but `"United Arab Emirates"` to `list_country_states`, which would 404 because that endpoint is alpha-2-only.

**Fix:** Two-line nudge in the description:

```
"Either the ISO2 code (e.g. 'AE') or the full country name (e.g. 'United Arab Emirates'). " +
"NOTE: unlike `list_country_states`, this endpoint also accepts the full name — but ISO2 is always safer."
```

---

### IN-03: `create_account_team_member` description says destructive-gate is intentionally NOT applied, but does not link to PROJECT.md policy

**File:** `lib/tools/create-account-team-member.ts:14-18`

**Issue:** The comment justifies the absence of a `confirm: true` literal gate (and the absence of any DESTRUCTIVE marker — the codebase doesn't have one yet either; only `cancel_lastmile_orders_batch` shows a partial pattern with idempotency + rate-limit). The justification is "it's reversible". That's defensible, but the description tells the LLM "WARNING: adding a team member is a privilege-escalation action; confirm intent with the user" — relying on the model to gate the call.

The mismatch between "code does not gate" and "description says the LLM should gate" creates an asymmetric attack surface: a prompt-injection attack that overrides the LLM's confirmation behaviour will still successfully provision team members. Combined with BL-01 (no audit), the action would not even be visible.

**Fix:** When BL-01 is addressed for this tool, also add an explicit `requires_confirmation: z.literal(true).describe("Set to true to confirm intent")` schema field — at least the LLM has to actively pass it, and the audit-log line records that the model did so.

---

### IN-04: Tool descriptions repeatedly use the soft phrase "auth issue (run `whoami_platform`)" — pattern is fine, but the canonical word for one of them ("scope") is buried

**Files:** every tool file with an "Error modes" block.

**Issue:** 401 means unauthenticated, 403 means lacks-permission. The descriptions collapse both to "auth issue (run `whoami_platform`)". `whoami_platform` is the right next step for 401 but tells the agent nothing about 403 — the right next step for 403 is `get_permissions` (which several files do mention separately, e.g. `get_account_capabilities.ts:51`). Inconsistent — some tools mention both, most only `whoami_platform`.

**Fix:** Standardise the error-modes block:

```
"Error modes: 401 → auth (run `whoami_platform`); 403 → scope/permission (run `get_permissions`); 5xx → retry."
```

This is the kind of thing IN-07's helper extraction would also normalise.

---

### IN-05: `evals/get-account.ts:70` model literal `"claude-sonnet-4-6"` is a magic string

**File:** `evals/get-account.ts:70` and `evals/lookup-google-place.ts:62`.

**Issue:** Both eval files define `const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6"`. The default version is duplicated across files; a model-bump touches both. Trivial, but the rest of the file is meticulous about not duplicating literal strings ("drift-proofing" is mentioned in both headers), so the inconsistency stands out.

**Fix:** Move the model default into a shared module:

```ts
// evals/_shared/model.ts
export const DEFAULT_EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";
```

---

_Reviewed: 2026-05-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
