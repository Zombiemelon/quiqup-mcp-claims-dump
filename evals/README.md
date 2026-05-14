# evals

Langfuse-based evals for the Quiqup MCP tool surface. First milestone in the
M8 "continuous evals" track — currently one eval, run on-demand from a local
box.

## What's here

| File | Purpose |
|---|---|
| `lastmile-order-creation.ts` | Runner for the v1 eval — Anthropic call with `create_lastmile_order` exposed, scores via Langfuse Experiments. |
| `datasets/lastmile-order-creation-v1.ts` | 6 hand-authored merchant requests + canonical expected tool calls. |
| `score-tool-call.ts` | Three programmatic scorers: tool-name-match, required-fields-present, args-overlap. |

## Setup

Add to `.env.local`:

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or https://us.cloud.langfuse.com
ANTHROPIC_API_KEY=sk-ant-...
```

Then:

```bash
bun install
bun run eval:lastmile-orders
```

Results print to stdout; full traces + scores appear in the Langfuse UI.

## Design notes

**Offline.** Does NOT hit the Quiqup API. Measures LLM tool-call quality
against today's MCP tool description, not end-to-end order creation. M2-M4
tests cover tool correctness; this eval covers LLM judgment.

**Wide-open schema.** `create_lastmile_order`'s Zod input is
`z.object({}).passthrough()` (M3 thin pass-through). The eval feeds Claude
the live MCP description and an `additionalProperties: true` JSON schema —
so the LLM has to guess the field shape from the description alone. That's
the point: when the description improves (M4), scores should improve.

**Lenient scorers.** Extras in the LLM output don't penalize. String matches
are case-insensitive substring matches. Exact JSON equality is not the
target — directional signal is.

**Versioned datasets.** `lastmile-order-creation-v1.ts` is the baseline. v2,
v3 land as separate files so v1 stays stable for trend comparison.

## CI gate

Both runners support an opt-in gate via `EVAL_GATE=1`. When set, the
runner reads `result.itemResults`, averages each named score, and
exits 1 if any average falls below the threshold. No-op locally.

Thresholds (also pinned in `.github/workflows/evals.yml`):

| Runner | Score | Min |
|---|---|---|
| `eval:lastmile-orders` (v1 offline) | `args-overlap` | `0.85` |
| `eval:lastmile-roundtrip` (v3 online) | `create-2xx` | `1.0` |

GitHub Actions runs `.github/workflows/evals.yml` on PRs that touch:

- `lib/tools/create-lastmile-order.ts`
- `lib/clients/quiqup-lastmile.ts`
- anything under `evals/`
- `package.json` / `bun.lock`

Required repo secrets (Settings → Secrets and variables → Actions):

- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` — both jobs
- `ANTHROPIC_API_KEY` — both jobs
- `QUIQUP_STAGING_CLIENT_ID`, `QUIQUP_STAGING_CLIENT_SECRET` — v3 job only
  (must be **last-mile-scoped**; fulfilment clients will 401 against
  `api.staging.quiqup.com/oauth/token`)

The workflow also exposes `workflow_dispatch` so you can run either
job manually from the Actions tab without opening a PR.
