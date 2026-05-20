<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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
