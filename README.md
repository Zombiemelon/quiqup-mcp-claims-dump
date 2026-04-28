# quiqup-mcp-claims-dump

A diagnostic MCP server replicating the [datacube](https://github.com/quiqupltd/datacube) Clerk-OAuth architecture. Authenticates any MCP client (Claude.ai, Claude Code, Codex, ChatGPT) via the production `clerk.quiqup.com` tenant and exposes one tool: `claims_dump`, which returns the decoded JWT.

**Purpose:** auth-pipeline learning artifact. The dumb tool exists so the auth flow has something to gate. See [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) for the walkthrough.

## Quickstart

```bash
bun install
cp .env.example .env.local   # fill in values from Clerk dashboard
bun run dev
curl -i http://localhost:3000/mcp   # expect 401 + WWW-Authenticate
```

## Test

```bash
bun run test                  # Layer 1 unit tests (9 tests)
bun run test:integration      # Layer 2 (requires CLERK_SECRET_KEY + RUN_INTEGRATION=1)
```

Layer 3 (end-to-end) is manual: add the deployed URL as a connector in Claude.ai or Claude Code, complete the OAuth flow, call `claims_dump`.

## Stack

- Next.js 16 App Router + TypeScript + Bun
- `@modelcontextprotocol/sdk`, `mcp-handler`, `@clerk/mcp-tools`, `@clerk/nextjs`
- Vitest

## Reference

- [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) — runtime walkthrough, file-by-file
- [datacube](https://github.com/quiqupltd/datacube) — original Mastra-based MCP this replicates
- [clerk/mcp-nextjs-example](https://github.com/clerk/mcp-nextjs-example) — Clerk's canonical example
