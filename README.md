# quiqup-mcp

> Renamed from `quiqup-mcp-claims-dump` on 2026-05-02. `claims_dump` was the first tool — the repo is now the home for the broader **Quiqup MCP** curated tool surface (see the [learning track](https://github.com/Zombiemelon/slava-personal-vault/tree/main/wiki/personal/learning/quiqup-mcp) in the personal vault). The deployed Vercel project keeps its original name (`quiqup-mcp-claims-dump.vercel.app/mcp`) until the M7 production-deploy migration.

A production-shaped MCP server for [Quiqup](https://quiqup.com)'s Fulfilment + Last-Mile APIs. Authenticates any MCP client (Claude.ai, Claude Code, Codex, ChatGPT) via the production `clerk.quiqup.com` tenant and exposes a curated tool surface (currently: `claims_dump`, `recent_orders`; expanding under TDD per the learning track).

**Origin:** built as the anchor project for the [auth-for-ai-apps](https://github.com/Zombiemelon/slava-personal-vault/tree/main/wiki/personal/learning/auth-for-ai-apps) track (M3–M5: Clerk OAuth, MCP authorization spec, V3b same-IdP shape conversion). Now the anchor for the [quiqup-mcp](https://github.com/Zombiemelon/slava-personal-vault/tree/main/wiki/personal/learning/quiqup-mcp) track (M0 baseline → M8 continuous evals). See [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) for the auth-pipeline walkthrough.

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
