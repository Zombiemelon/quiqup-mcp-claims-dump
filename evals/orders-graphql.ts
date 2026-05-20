/**
 * Eval runner: orders-graphql-v1 — Phase-3 Orders Core GraphQL family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 2 Phase-3 Orders Core GraphQL tools exposed
 * (lookup_orders_ids, bulk_orders_lookup) and scores the resulting
 * tool_use block via ./score-orders-graphql.ts.
 *
 * Drift-proofing: tool descriptions are imported DIRECTLY from each
 * production `spec` (no inline copies — T-01-26 + 02-06 lesson).
 *
 * Offline: does NOT hit the Quiqup API.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit.
 *
 * CI gate: set EVAL_GATE=1 to enforce tool-name-match >= 0.75,
 * args-overlap >= 0.7, AND description-quality >= 1.0 at the end.
 *
 * Run: `bun run eval:orders-graphql`
 */

import {
  items,
  TODAY,
  type OrdersGraphqlInput,
  type OrdersGraphqlExpected,
} from "./datasets/orders-graphql-v1";

import { spec as lookupOrdersIdsSpec } from "@/lib/tools/lookup-orders-ids";
import { spec as bulkOrdersLookupSpec } from "@/lib/tools/bulk-orders-lookup";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `orders-graphql-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
  );
  process.exit(0);
}

const { NodeSDK } = await import("@opentelemetry/sdk-node");
const { LangfuseSpanProcessor } = await import("@langfuse/otel");
const { LangfuseClient } = await import("@langfuse/client");
const { AnthropicInstrumentation } = await import(
  "@arizeai/openinference-instrumentation-anthropic"
);
const Anthropic = (await import("@anthropic-ai/sdk")).default;
const { z } = await import("zod");

const { evaluators } = await import("./score-orders-graphql");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

const specs = [lookupOrdersIdsSpec, bulkOrdersLookupSpec] as const;

const tools = specs.map((spec) => {
  const inputJsonSchema = z.toJSONSchema(spec.inputSchema, {
    target: "draft-07",
    io: "input",
  }) as Record<string, unknown>;
  // Pull description straight from the production `spec.description` — the
  // whole point of this drift-proofing approach. spec.name + spec.inputSchema
  // similarly come from the live production source, never inline copies.
  return {
    name: spec.name,
    description: spec.description,
    input_schema: { ...inputJsonSchema, type: "object" as const },
  };
});

interface TaskOutput {
  tool: string | null;
  args: Record<string, unknown> | null;
}

const task: ExperimentTask<OrdersGraphqlInput, OrdersGraphqlExpected> = async (
  item,
) => {
  const input = (item as { input?: OrdersGraphqlInput }).input;
  if (!input?.request) {
    return { tool: null, args: null } satisfies TaskOutput;
  }
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools,
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content:
          "You are an operations assistant for a Quiqup partner (Dubai-based " +
          "merchant) integrating with the Orders Core GraphQL endpoint. " +
          "Translate the merchant's question into the single most appropriate " +
          "Phase-3 Orders Core GraphQL tool call. Disambiguation guide:\n" +
          "  - `lookup_orders_ids`   → fetch ONLY the clientOrderIDs of orders " +
          "matching a where-filter (typical bulk-action pre-flight).\n" +
          "  - `bulk_orders_lookup`  → re-fetch the items + per-item weights + " +
          "parcel barcodes for a known set of clientOrderIDs (capped at 200).\n" +
          "Use sensible defaults for unspecified fields. " +
          `Today's date is ${TODAY} (UTC).\n\n` +
          `Question: ${input.request}`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    return { tool: null, args: null } satisfies TaskOutput;
  }
  return {
    tool: block.name,
    args: block.input as Record<string, unknown>,
  } satisfies TaskOutput;
};

const result = await langfuse.experiment.run({
  name: `phase3-orders-graphql-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-3 Orders Core GraphQL ` +
    `family on ${MODEL}. ${items.length} hand-authored merchant questions, ` +
    `frozen TODAY=${TODAY}. Scored by tool-name-match, required-fields-present ` +
    "(client_order_ids on bulk_orders_lookup; nothing hard-required on " +
    "lookup_orders_ids), args-overlap, and description-quality (STATIC " +
    "per-tool substring checklist — endpoint markers, 401 error-mode, " +
    "cross-tool disambiguation, canonical Example block).",
  data: items,
  task,
  evaluators,
});

console.log(await result.format());

await langfuse.shutdown();
await otelSdk.shutdown();

// CI gate (opt-in via EVAL_GATE=1; no-op locally).
if (process.env.EVAL_GATE === "1") {
  const { gate } = await import("./gate");
  gate(result, [
    { scoreName: "tool-name-match", min: 0.75 },
    { scoreName: "args-overlap", min: 0.7 },
    { scoreName: "description-quality", min: 1.0 },
  ]);
}
