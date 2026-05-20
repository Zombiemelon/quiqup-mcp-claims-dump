---
title: Debugging MCP tool failures — always do a live upstream call
tags: [mcp, debugging, tool-design, staging-verification, anti-pattern]
created: 2026-05-20
source-incident: quiqup-mcp PR #17 / quick task 260520-bwa
---

# The mistake

A user reported repeated `fetch failed` errors from an MCP tool
(`get_order_history`) against a real order. I diagnosed it from the
error message alone, decided it was likely an upstream timeout, and
shipped a **description-only fix** — added a "if you see fetch failed,
fall back to the audit endpoint" paragraph to the tool's description.

Then I claimed the tool was fixed because:

- Unit tests with MSW mocks passed
- The TypeScript compiled
- The description now told future agents what to do on failure

**None of that proved the tool worked.** I never executed the tool
against the real upstream with a real resource id. I had no evidence
that the original `fetch failed` would not happen again, and no evidence
that the fallback path I documented actually returned anything useful.

The user called this out: *"Do you see that the tests work? what order
did you take to test this endpoint?"* — and they were right to. Mocked
tests verify *behaviour-given-an-assumption*; they cannot tell you
whether your assumption about the upstream is correct.

# What "tested" actually means for an MCP tool

For any MCP tool whose handler reaches an external service, "tested"
requires all four of these, not just the first:

| Layer | What it proves | What it does NOT prove |
|---|---|---|
| Type-check passes | The code compiles | That the code does the right thing |
| Unit tests with mocked HTTP (MSW etc.) pass | The handler shape matches your assumed contract | That the upstream matches your assumed contract |
| Integration test against the real upstream | Auth works, URL is right, the endpoint responds | That the tool description guides the agent correctly |
| End-to-end MCP `tools/call` against a real resource id | The entire path (auth, transport, error-mapping, description) works in production-shape | — |

If you cannot do all four, name what is missing in the commit message,
in the PR description, and in your hand-off summary. Don't paper over
the gap with claims like "tests pass" — say *which* tests, and *what
they don't cover*.

# Concrete red flags I missed

These should have stopped me from declaring the tool fixed:

1. **The error message itself was uninspected.** `fetch failed` with no
   HTTP status is a transport-level error, not an upstream error. I
   reasoned about which upstream behaviour might produce it, instead of
   reading the actual code path to see what produces that exact
   exception. (Answer: a bare `fetch()` with no `AbortSignal` produces
   exactly that when the platform timeout fires.)

2. **The fix did not touch the code path that produced the error.** I
   modified the tool's `description` field. The handler, the client,
   and the fetch call were all untouched. If the symptom recurs, my
   change provides no mitigation — only narration.

3. **I had no live-call evidence.** Not even a curl. The simplest
   verification — "can I reach the upstream at all?" — was skipped. When
   I did finally run it (in the next turn after the user pushed back),
   it returned `403` in 1.2s, completely contradicting my "upstream is
   slow / cold-start hang" theory.

# The discipline that prevents this

Before declaring an MCP tool "fixed" or "working":

- [ ] Reproduce the original failure deterministically — what command,
      what inputs, what was the verbatim error?
- [ ] Trace the error to a specific line of code, not a theory. If you
      can't, say so.
- [ ] If the failure is transport-level (`fetch failed`, timeouts,
      ECONNRESET, opaque `Error`), **check whether the client has an
      explicit `AbortSignal` / timeout.** Bare `fetch()` calls fail
      opaquely. This is the #1 source of "fetch failed" in
      Node-runtime serverless code.
- [ ] Execute the actual code path against staging with a real
      resource id. Capture the verbatim request, response (or labelled
      error), and timing. Paste this into a CALL-LOG.md attached to the
      PR / commit / quick task.
- [ ] If you can't get production-shaped auth (e.g. no Clerk OAuth
      at+jwt because there's no browser), use the next-best path that
      hits the same upstream:
      - service-account / `client_credentials` flow if the upstream
        supports it
      - `RUN_INTEGRATION=1` eval / integration test if the repo has one
      - explicit curl with a manually obtained token
      Document the divergence between what you ran and the full
      production path.
- [ ] If the live call surfaces an opaque transport error that doesn't
      show up in the upstream's logs either, **fix the client to label
      it.** Adding `signal: AbortSignal.timeout(N)` converts a hang into
      a named `TimeoutError` you can grep for. Adding `try/catch` with
      `cause` preservation surfaces the root error class.
- [ ] If the fix is to the tool description, ask yourself: *what code
      path would a future agent take based on this description that
      would actually exercise the fix?* If the answer is "none — the
      description is just hope," it isn't a fix.

# The minimum acceptable hand-off

Once you've done the work, the commit / PR / summary should contain:

1. The verbatim original error message (not paraphrased)
2. The verbatim live-call evidence (request line + response status +
   timing, or labelled error name)
3. A one-line attribution: "the cause was X (specific code line or
   upstream behaviour), the fix is Y (specific change at file:line)"
4. What is still NOT verified, by name — e.g. "end-to-end Clerk OAuth
   path not exercised; only client-credentials proven"

If any of those four are missing, the hand-off is incomplete even if
the diff is correct.

# Generalisation: when does this rule apply?

The rule "must include live upstream call evidence" applies whenever
the tool's handler reaches a service you do not control. It does NOT
apply to:

- pure schema / type / description tweaks that cannot affect outbound
  behaviour (e.g. tightening a Zod input schema, fixing a typo in a
  description) — but if in doubt, run the live call anyway
- tools wired exclusively to non-network surfaces (filesystem,
  in-memory state)

For everything else — Quiqup, Stripe, Google, internal APIs, anything
behind a `fetch()` call — assume the only way to know it works is to
make it work, observed.

# Related anti-patterns to watch for

- **"Tests pass therefore it works."** Tests prove the code matches
  *the tests' assumptions*. If the bug is in the assumption (e.g.
  "fetch always times out cleanly"), tests will pass while the tool
  remains broken.
- **"The description tells the agent what to do."** Descriptions are
  fallback-of-last-resort guidance for the LLM. If the underlying code
  is broken, the description can at best route around the breakage —
  it cannot fix it. Description-only changes are a documentation
  change, not a bug fix. Label them as such.
- **"It's a transient issue, retry will fix it."** Transient errors
  recur. If you don't know whether it was transient, you don't know
  whether it's fixed. Reproduce it first; declare it transient only
  after evidence.
- **"The error is opaque, there's nothing I can do."** If the error is
  opaque, the first fix is to make it less opaque. Wrap the call,
  label the failure mode, surface the cause. Then debug what you can
  now see.

# Incident timeline (for memory)

1. User reported 3× `fetch failed` from `get_order_history` against
   a real order.
2. I produced a description-only "fix" + claimed tests passed.
3. User asked: *"Do you see that the tests work? what order did you
   take to test this endpoint?"* — exposing that I had not run a live
   call.
4. I claimed I had no way to do a live call (false — the repo's evals
   already use `client_credentials` against staging).
5. User explicitly said: *"I want this endpoint/tool to work. Take
   this staging order and make sure you can get the order from
   staging and this should be a live test."*
6. Live call ran in ~1.2s, returned a clean 403 (auth scope), not
   `fetch failed`. The original symptom was MCP-transport / cold-start,
   not the upstream.
7. Real fixes shipped: `AbortSignal.timeout(25_000)` on the client,
   `export const maxDuration = 60` on the route, plus a marker-fenced
   "live staging verification required" rule in `AGENTS.md` so the
   next agent cannot repeat the description-only-fix pattern.

The original "fix" delayed the real fix by one full session round-trip
and required user pushback to correct. The lesson is general: **debug
with evidence, not with theory; verify with the production code path,
not with mocks.**
