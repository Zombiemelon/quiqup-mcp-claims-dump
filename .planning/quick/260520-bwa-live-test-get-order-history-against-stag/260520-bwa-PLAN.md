---
quick_id: 260520-bwa
type: execute
autonomous: false
files_modified:
  - lib/clients/quiqup-rest.ts
  - app/[transport]/route.ts
  - AGENTS.md
  - .planning/quick/260520-bwa-live-test-get-order-history-against-stag/CALL-LOG.md

must_haves:
  truths:
    - "A real HTTP call from a locally-running MCP route hits api.staging.quiqup.com/orders/57282/history and returns either a 2xx JSON body OR a labelled, agent-actionable error (NOT bare 'fetch failed')."
    - "If the upstream is reachable, the response body for staging order 57282 is captured to CALL-LOG.md verbatim."
    - "If the upstream times out or rejects, the timeout window, error class, and HTTP status (if any) are captured to CALL-LOG.md verbatim."
    - "AGENTS.md contains a checklist item that BLOCKS declaring any Quiqup-side tool change 'working' until a live staging call against a real order has been executed and the result attached to the PR / commit message."
  artifacts:
    - path: "lib/clients/quiqup-rest.ts"
      provides: "QuiqupRestClient.request with explicit AbortSignal.timeout(25_000)"
      contains: "AbortSignal.timeout"
    - path: "app/[transport]/route.ts"
      provides: "Vercel/Next.js serverless function maxDuration override"
      contains: "export const maxDuration"
    - path: "AGENTS.md"
      provides: "Live-staging-verification-required rule (hard checklist item)"
      contains: "Live staging verification"
    - path: ".planning/quick/260520-bwa-live-test-get-order-history-against-stag/CALL-LOG.md"
      provides: "Captured request + response (or error) from the live invocation"
  key_links:
    - from: "lib/tools/get-order-history.ts handler"
      to: "lib/clients/quiqup-rest.ts QuiqupRestClient.request"
      via: "client.request('GET', `/orders/${encodeURIComponent(order_id)}/history`)"
      pattern: "QuiqupRestClient.*request"
    - from: "local POST http://localhost:3000/mcp tools/call get_order_history"
      to: "api.staging.quiqup.com/orders/57282/history"
      via: "withMcpAuth -> Clerk OAuth at+jwt -> getQuiqupReadyJwt -> Bearer to Quiqup"
      pattern: "tools/call.*get_order_history"
---

<objective>
Live-test `get_order_history` (and, if it fails, the `list_order_audit_events`
fallback) end-to-end against staging order 57282
(https://quiqdash-beta.staging.quiqup.com/order/57282).

Two code-level fixes derived from the prior session's `fetch failed`
finding are bundled in BEFORE the live invocation, because without them
the live call will repeat the same opaque failure and produce no
actionable signal:

  1. `lib/clients/quiqup-rest.ts:112` — bare `fetch()` with no
     `AbortSignal`. Adding `AbortSignal.timeout(25_000)` converts cold-start
     hangs / upstream stalls into a labelled `AbortError` the agent can
     reason about, instead of the Node-runtime opaque `fetch failed`.
  2. `app/[transport]/route.ts` — no `export const maxDuration`. The
     Vercel/Next serverless default (10s) is shorter than the heavier
     `/orders/{id}/history` cold-path; bumping to 60s (the mcp-handler
     README's documented ceiling) removes the *route-level* timeout as a
     suspect.

After the fixes ship, the plan drives a *real* MCP tool-path invocation
against staging order 57282 — `bun run dev`, then a POST to
`http://localhost:3000/mcp` with `tools/call` for `get_order_history`,
`{ order_id: "57282", environment: "staging" }`, using an OAuth at+jwt
minted for a Clerk userId that has an active Quiqdash staging session.
The captured request + response (or error) is written to CALL-LOG.md as
the durable evidence trail.

The session ends by adding a HARD rule to AGENTS.md — every Quiqup-side
tool change must be backed by a live staging call against a real order
before being declared working. Description-only fixes are no longer
acceptable.

Purpose: turn "fetch failed" from a black box into either a verified
success or a labelled, attributable failure — and lock the discipline in
so future agents can't skip the step.

Output: Two source-code changes (timeout + maxDuration), one durable
evidence file (CALL-LOG.md), one process rule (AGENTS.md).
</objective>

<execution_context>
@/Users/svetoslavdimitrov/Documents/quiqup-mcp/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@AGENTS.md
@CLAUDE.md
@.planning/STATE.md
@lib/tools/get-order-history.ts
@lib/tools/list-order-audit-events.ts
@lib/clients/quiqup-rest.ts
@lib/clients/audit.ts
@lib/quiqup.ts
@app/[transport]/route.ts
@tests/integration/mcp-flow.test.ts
@.env.example

<interfaces>
<!-- Key exports the executor needs. Use these directly — no codebase exploration required. -->

From lib/clients/quiqup-rest.ts (current state — request() does NOT pass signal):

  export class QuiqupRestClient {
    constructor(private readonly opts: QuiqupRestClientOptions) {}
    async request(
      method: HttpMethod,
      path: string,
      init: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
    ): Promise<unknown> {
      // ... build URL + headers ...
      const res = await fetch(url.toString(), {
        method,
        headers: { Authorization: `Bearer ${this.opts.jwt}`, Accept: "application/json", ... },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      // ... error/parse branches ...
    }
  }

From lib/tools/get-order-history.ts (call site — unchanged by this plan):

  const data = await client.request(
    "GET",
    `/orders/${encodeURIComponent(args.order_id)}/history`,
  );

From app/[transport]/route.ts (no maxDuration currently exported):

  const handler = createMcpHandler(...);
  const authHandler = withMcpAuth(handler, ..., { required: true, ... });
  export { authHandler as GET, authHandler as POST };

From lib/quiqup.ts:

  export async function getQuiqupReadyJwt(userId: string): Promise<string>
    // Mints a Clerk session-JWT (default template) for an EXISTING active
    // session. Throws if no active session exists for userId.

From tests/integration/mcp-flow.test.ts (existing local-call pattern):

  POST `${MCP_BASE_URL ?? "http://localhost:3000"}/mcp`
    headers: Authorization: Bearer <token>, Content-Type: application/json,
             Accept: "application/json, text/event-stream"
    body: { jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: <tool>, arguments: { ... } } }

NOTE: That existing test uses a Clerk `testingToken` which is session-shaped,
NOT an oauth_token. `withMcpAuth` in route.ts requires `acceptsToken: 'oauth_token'`.
For the live call in Task 2, the executor needs an actual OAuth at+jwt minted
through the Clerk OAuth flow against this MCP server's resource — see Task 2
for the concrete bootstrap recipe.

</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add explicit fetch timeout to QuiqupRestClient + bump MCP route maxDuration</name>
  <files>lib/clients/quiqup-rest.ts, app/[transport]/route.ts, tests/tools/orders-history-and-audit.test.ts</files>
  <action>
Implement two surgical, additive changes — no behavioural change to any
existing happy or error path; only the "hangs forever and surfaces as
opaque 'fetch failed'" path gets a real label.

(a) lib/clients/quiqup-rest.ts — inside `QuiqupRestClient.request`, add
`signal: AbortSignal.timeout(25_000)` to the `fetch()` init object. The
25s window is deliberately chosen below both the new 60s Vercel
`maxDuration` (Task 1b) and Anthropic's per-tool ~30s expectation, so a
stalled upstream surfaces inside the route lifetime as an `AbortError`
named "TimeoutError" — agent-actionable — rather than as the route-level
504 that hides the underlying cause. Do NOT wrap or rename the error;
let it propagate so the existing `registerTool` MCP envelope reports
`name: "TimeoutError"` verbatim. Update the file-header comment block to
note the 25s timeout discipline alongside the existing error-model
paragraph (one sentence — do not rewrite the header).

(b) app/[transport]/route.ts — add `export const maxDuration = 60;` near
the top of the module (after the imports, before `const handler = ...`).
60 is the mcp-handler README's documented ceiling and gives the
25s-bounded upstream call plus the inbound Clerk verification + outbound
session-JWT mint comfortable headroom on cold start. Do NOT change any
other route export — `GET`, `POST`, and the `withMcpAuth` wiring stay
exactly as-is.

(c) tests/tools/orders-history-and-audit.test.ts — add ONE new test case
in the existing `describe("get_order_history", ...)` block that asserts
a stalled upstream surfaces as a TimeoutError, not as 'fetch failed':

  - Use MSW to register a handler at `${QUIQUP_REST}/orders/:id/history`
    that delays ~30s (longer than the 25s client timeout) using
    `await new Promise((r) => setTimeout(r, 30_000))` before responding.
  - vi.useFakeTimers() before the test; vi.advanceTimersByTimeAsync(26_000)
    after kicking off the handler() call.
  - Assert the rejection's `name === "TimeoutError"` (the standard name
    for `AbortSignal.timeout()`'s abort reason). Do NOT assert the
    message — that is runtime-version-specific.
  - Restore real timers in afterEach.

If MSW's body-stream delay is awkward with fake timers, an acceptable
alternative is to mock `fetch` directly inside the test to return a
Promise that never resolves, then assert the same TimeoutError name.

Do NOT add a maxDuration test — that's a Vercel/Next deployment-time
concern, not a unit-testable behaviour at the route level. The plan's
verification step covers it by build-time grep.
  </action>
  <verify>
    <automated>cd /home/user/quiqup-mcp &amp;&amp; pnpm test -- orders-history-and-audit &amp;&amp; grep -n 'AbortSignal.timeout' lib/clients/quiqup-rest.ts &amp;&amp; grep -n 'export const maxDuration' app/[transport]/route.ts</automated>
  </verify>
  <done>
- `lib/clients/quiqup-rest.ts` `request()` passes `signal: AbortSignal.timeout(25_000)` to `fetch()`.
- `app/[transport]/route.ts` exports `maxDuration = 60`.
- `tests/tools/orders-history-and-audit.test.ts` has a new passing test that asserts a stalled upstream rejects with `name === "TimeoutError"` (not the bare "fetch failed" string).
- All other tests in `orders-history-and-audit.test.ts` still pass — the existing happy-path, 401, 404, 5xx, and path-encoding cases are NOT regressed.
- File-header comment in `quiqup-rest.ts` mentions the 25s timeout in one sentence.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Live invocation against staging order 57282 — record verbatim to CALL-LOG.md</name>
  <files>.planning/quick/260520-bwa-live-test-get-order-history-against-stag/CALL-LOG.md</files>
  <what-built>
Task 1 added the AbortSignal timeout and the route `maxDuration` export.
The MCP tool path is now ready to be exercised end-to-end against
staging. THIS task is the live invocation itself — Claude cannot run it
autonomously because it requires (i) credentials that live only in the
user's local `.env.local`, and (ii) an active Clerk session for the
target userId on the Quiqdash staging tenant. Claude's job here is to
PRESENT the exact recipe to the user, capture what comes back, and
write it verbatim to CALL-LOG.md.
  </what-built>
  <how-to-verify>
Execute these steps from the repo root and paste each command's stdout
+ stderr into CALL-LOG.md as you go. Do not summarise — verbatim only.

PRE-FLIGHT (one-time)
---------------------
1. Confirm `.env.local` has at minimum: `CLERK_SECRET_KEY`,
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_DOMAIN`,
   `NEXT_PUBLIC_APP_URL=http://localhost:3000`,
   `LABEL_URL_SIGNING_SECRET` (any non-empty hex is fine for this run).
   The Quiqup REST client uses CLERK_SECRET_KEY to mint the outbound
   session-JWT — no separate Quiqup partner secret is needed (V3b).
2. Confirm a Clerk user with an active Quiqdash staging session exists.
   Easiest: sign into https://quiqdash-beta.staging.quiqup.com as your
   own user just before running the live call. Note the Clerk userId
   (visible in the Clerk dashboard under Users — the `user_...` string).
3. `bun install` if node_modules is stale.

RUN THE SERVER
--------------
4. In terminal A: `bun run dev`
   Wait for "Ready in ...". Confirm http://localhost:3000 responds.

MINT A REAL OAUTH at+jwt FOR THE MCP RESOURCE
---------------------------------------------
The route requires `acceptsToken: "oauth_token"` — a Clerk testingToken
(session-shaped) will NOT pass. There are two acceptable ways to get an
at+jwt; pick the one that works in your tenant:

   Option A — via the Claude.ai connector flow (cleanest):
     a. Visit Claude.ai → Settings → Connectors → Add a custom
        connector → URL: http://localhost:3000/mcp
        (use ngrok / cloudflared if Claude.ai can't reach localhost).
     b. Walk through the Clerk OAuth consent screen as your test user.
     c. Open the browser devtools Network tab on the next tool call;
        copy the `Authorization: Bearer <token>` value.

   Option B — direct OAuth dance against Clerk:
     a. Discover the AS metadata:
          curl -s http://localhost:3000/.well-known/oauth-protected-resource | jq .
     b. Follow the standard authorization_code + PKCE flow against the
        resulting authorization_server URL with `resource=http://localhost:3000`
        per RFC 8707. Capture the resulting `access_token` (at+jwt shape).

   Save the token to a shell var: `export AT_JWT="<paste>"`

INVOKE get_order_history AGAINST STAGING ORDER 57282
----------------------------------------------------
5. In terminal B:
     curl -i -X POST http://localhost:3000/mcp \
       -H "Authorization: Bearer $AT_JWT" \
       -H "Content-Type: application/json" \
       -H "Accept: application/json, text/event-stream" \
       -d '{
         "jsonrpc": "2.0",
         "id": 1,
         "method": "tools/call",
         "params": {
           "name": "get_order_history",
           "arguments": { "order_id": "57282", "environment": "staging" }
         }
       }'

6. Expected — three legitimate outcomes:
   - SUCCESS: HTTP 200 with `result.content[0].text` containing a JSON
     `{ history: [...] }` for order 57282. Paste the full body
     verbatim. This is the "tool actually works against staging" signal.
   - LABELLED FAILURE (acceptable as a triage signal): HTTP 200 with
     `result.isError: true` and `content[0].text` mentioning either
     `TimeoutError` (upstream hung > 25s — Task 1's fix is doing its
     job), `QuiqupHttpError 401/403` (Clerk session ↔ Quiqup mapping
     issue — run step 7), or `QuiqupHttpError 404` (clientOrderID
     mismatch — run step 8).
   - UNLABELLED FAILURE: anything else — especially bare `fetch failed`
     after Task 1 lands. THIS IS A BUG IN TASK 1's TIMEOUT WIRING.
     Stop and fix before treating the staging call as complete.

7. If 401/403: run `whoami_platform` (same recipe, swap the tool name +
   drop the arguments to `{}`) to confirm the Clerk → Quiqup session-JWT
   round-trip resolves. Paste that result too. If `whoami_platform`
   itself 401s, the userId you signed in as does NOT have an active
   Clerk session (re-do pre-flight step 2).

8. If 404: the Quiqup REST host expects the order's `clientOrderID`, not
   the database id. The staging URL `/order/57282` could be either; if
   you have access run `lookup_orders_ids` or `find_order_by_id_or_barcode`
   with `{ q: "57282", environment: "staging" }` to disambiguate, then
   retry `get_order_history` with the returned clientOrderID. Paste
   both responses.

9. FALLBACK — if `get_order_history` cannot be made to return a 2xx
   within a reasonable retry budget, exercise the documented fallback
   path: `list_order_audit_events` against the order's `uuid`. Get the
   uuid via `find_order_by_id_or_barcode` or `bulk_orders_lookup` with
   `{ q: "57282", environment: "staging" }`, then:
     curl ... -d '{
       "jsonrpc": "2.0", "id": 2, "method": "tools/call",
       "params": { "name": "list_order_audit_events",
                   "arguments": { "order_uuid": "<uuid-from-step-9a>",
                                  "environment": "staging" } } }'
   Paste both responses to CALL-LOG.md. A successful audit-events
   response with the same order id is acceptable end-to-end evidence
   for THIS quick task (per the get-order-history tool description's
   own guidance), but the failure of get_order_history must be recorded
   as a known issue requiring its own follow-up.

WRITE CALL-LOG.md
-----------------
10. Create `.planning/quick/260520-bwa-live-test-get-order-history-against-stag/CALL-LOG.md`
    with the following sections, each filled with VERBATIM output:

    # Live staging call log — order 57282

    ## Environment
    - Date / Time (UTC): ...
    - Clerk userId used: user_...
    - Node version: `node --version`
    - `bun --version`

    ## Step 5 — get_order_history call
    ### Request (curl)
    ```
    <paste the curl command>
    ```
    ### Response (HTTP status + headers + body)
    ```
    <paste verbatim>
    ```

    ## Step 7 / 8 / 9 — fallback calls (if any)
    <repeat sections per call>

    ## Outcome
    One of:
      - VERIFIED — get_order_history returns a 2xx history payload for order 57282.
      - VERIFIED-VIA-FALLBACK — list_order_audit_events returns events for the
        order's uuid; get_order_history failed with <labelled error>. Follow-up:
        <one-line issue description>.
      - BLOCKED — describe blocker (auth, infra, network).

  </how-to-verify>
  <resume-signal>
After CALL-LOG.md is written, type:
  - "verified" if get_order_history returned 2xx for order 57282.
  - "verified-via-fallback" if list_order_audit_events stood in for it.
  - "blocked: <reason>" if neither call could be executed (e.g. cannot
    obtain an at+jwt for a staging-session userId).
On "blocked:", Task 3 still proceeds — the AGENTS.md rule MUST be added
regardless of whether THIS particular staging call succeeded, because
the rule is what prevents the next agent from repeating the
description-only-fix mistake.
  </resume-signal>
</task>

<task type="auto">
  <name>Task 3: Lock the "live staging verification required" rule into AGENTS.md</name>
  <files>AGENTS.md, CLAUDE.md</files>
  <action>
Append a new fenced rule block to `AGENTS.md` AFTER the existing
`<!-- END:nextjs-agent-rules -->` line — do not modify the existing
block. The new block MUST use distinct BEGIN/END markers so future
sed/grep-driven updates can target it surgically:

  <!-- BEGIN:live-staging-verification-rule -->
  # Tool changes require a live staging call before they ship

  When you change ANY tool under `lib/tools/` whose handler reaches a
  Quiqup-owned service (api.quiqup.com, api-ae.quiqup.com,
  platform-api.quiqup.com, audit.quiqup.com, ex-api.quiqup.com,
  orders-api.quiqup.com, or their `.staging.` siblings), you MUST
  satisfy every item on this checklist before declaring the tool
  "working" — in PR descriptions, commit messages, hand-off summaries,
  STATE.md updates, anywhere:

  - [ ] Unit tests pass (MSW-mocked happy path + at least one error
        path). Mocks are necessary but NOT sufficient.
  - [ ] A live call against `*.staging.quiqup.com` against a REAL order
        / account / resource id has been executed end-to-end through
        `POST http://localhost:3000/mcp` `tools/call` (or a deployed
        preview), using a Clerk OAuth at+jwt minted for a userId with
        an active Quiqdash staging session.
  - [ ] The verbatim request + response (or error name + status) is
        attached to the PR / commit / quick task as a CALL-LOG.md
        (template: `.planning/quick/260520-bwa-*/CALL-LOG.md`).
  - [ ] If the live call surfaced a `TimeoutError`, opaque
        `fetch failed`, or any unlabelled transport error, the
        underlying cause was diagnosed and fixed at the code level (NOT
        just documented in the tool description). The fix is referenced
        in the commit message.

  Description-only fixes — "added a warning to the tool description
  about timeouts" — DO NOT satisfy this rule. The tool's behaviour
  against the real upstream is what gets verified, not the prose around
  the tool.

  Exemptions:
   - Tools wired exclusively to non-Quiqup upstreams (currently:
     `lookup_google_place`). These need their own provider's live-call
     evidence, not a Quiqup one.
   - Pure description / schema-only changes that cannot affect outbound
     behaviour. If in doubt, run the staging call anyway.
  <!-- END:live-staging-verification-rule -->

Then verify `CLAUDE.md` still `@-includes` `AGENTS.md` (it should — the
current CLAUDE.md is a single line: `@AGENTS.md`). No edit to CLAUDE.md
is needed unless that include is missing.

Do NOT touch any other file. Do NOT reflow the existing
`nextjs-agent-rules` block.
  </action>
  <verify>
    <automated>cd /home/user/quiqup-mcp &amp;&amp; grep -c 'BEGIN:live-staging-verification-rule' AGENTS.md &amp;&amp; grep -c 'BEGIN:nextjs-agent-rules' AGENTS.md &amp;&amp; grep -c '@AGENTS.md' CLAUDE.md</automated>
  </verify>
  <done>
- `AGENTS.md` contains both the original `nextjs-agent-rules` block AND a new `live-staging-verification-rule` block, each with matching BEGIN/END markers.
- The new block enumerates the 4-item checklist (unit tests, live staging call, CALL-LOG.md attached, root-cause fix for unlabelled errors).
- The new block explicitly forbids description-only fixes.
- `CLAUDE.md` still includes `@AGENTS.md` (unchanged).
- No other file is modified.
  </done>
</task>

</tasks>

<verification>
Overall phase checks (executor MUST pass all three before this quick task is closed):

1. `pnpm test -- orders-history-and-audit` passes — including the new
   TimeoutError assertion from Task 1.
2. CALL-LOG.md exists at
   `.planning/quick/260520-bwa-live-test-get-order-history-against-stag/CALL-LOG.md`
   with a verbatim request + response (or labelled error) for order
   57282, and an Outcome line of either VERIFIED, VERIFIED-VIA-FALLBACK,
   or BLOCKED with a stated reason.
3. AGENTS.md contains the `live-staging-verification-rule` block with
   the 4-item checklist; the existing `nextjs-agent-rules` block is
   intact.
</verification>

<success_criteria>
- The bare `fetch failed` symptom from the previous session can no
  longer occur silently from this client — a stalled upstream surfaces
  as a labelled `TimeoutError` inside 25s, locked in by a unit test.
- The Vercel/Next route timeout is no longer a hidden suspect: the
  `[transport]/route.ts` module declares `maxDuration = 60`.
- There is durable, verbatim evidence (CALL-LOG.md) of an actual MCP
  tool-path invocation against staging order 57282 — either a green
  history payload, a green audit-events payload via the documented
  fallback, or a labelled-error trail with the root cause identified.
- The next agent who edits a Quiqup-side tool cannot ship a
  description-only "fix" without violating an explicit, marker-fenced
  rule in AGENTS.md (which CLAUDE.md @-includes — so it's binding from
  the first turn of every session).
</success_criteria>

<output>
Create `.planning/quick/260520-bwa-live-test-get-order-history-against-stag/CALL-LOG.md` (Task 2) and a `SUMMARY.md` in the same directory when the quick task is done.
</output>
