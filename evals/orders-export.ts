/**
 * Eval runner: orders-export-v1 — Phase-3 Ex-core family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the single Phase-3 Ex-core tool exposed (download_orders_export)
 * and scores the resulting tool_use block via ./score-orders-export.ts.
 *
 * Drift-proofing: tool description + input + output schemas are
 * imported DIRECTLY from the production `spec`. No inline copies
 * (T-01-26 + 02-06 lesson).
 *
 * The score file includes TWO STATIC source-inspection scorers
 * (binary-envelope-contract + csv-date-format-pin) that readFile()
 * `lib/tools/download-orders-export.ts` and lock the binary-envelope
 * contract for Phase 5 (PDF labels), Phase 7 (inventory CSV), and
 * Phase 10 (Zoho PDFs) reuse.
 *
 * Offline: does NOT hit the Quiqup API.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit.
 *
 * CI gate: set EVAL_GATE=1 to enforce tool-name-match >= 0.9,
 * args-overlap >= 0.75, description-quality >= 1.0,
 * binary-envelope-contract >= 1.0, AND csv-date-format-pin >= 1.0.
 *
 * Run: `bun run eval:orders-export`
 */

import {
  items,
  TODAY,
  type OrdersExportInput,
  type OrdersExportExpected,
} from "./datasets/orders-export-v1";

import { spec as downloadOrdersExportSpec } from "@/lib/tools/download-orders-export";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `orders-export-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-orders-export");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

// Single-tool eval — download_orders_export is the only entry in the
// Phase-3 Ex-core family. Tool spec.description + spec.inputSchema +
// spec.name come straight from the production module (drift-proof — a
// description edit in production is automatically reflected here).
const spec = downloadOrdersExportSpec;
const inputJsonSchema = z.toJSONSchema(spec.inputSchema, {
  target: "draft-07",
  io: "input",
}) as Record<string, unknown>;
const tool = {
  name: spec.name,
  description: spec.description,
  input_schema: { ...inputJsonSchema, type: "object" as const },
};

interface TaskOutput {
  tool: string | null;
  args: Record<string, unknown> | null;
}

const task: ExperimentTask<OrdersExportInput, OrdersExportExpected> = async (
  item,
) => {
  const input = (item as { input?: OrdersExportInput }).input;
  if (!input?.request) {
    return { tool: null, args: null } satisfies TaskOutput;
  }
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [tool],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content:
          "You are an operations assistant for a Quiqup partner. Translate " +
          "the merchant's request into a single download_orders_export tool " +
          "call. The upstream uses yyyy-mm-dd date format (NOT full ISO-8601). " +
          "Set `from` and `to` literally as yyyy-mm-dd strings. Only include " +
          "`order_ids` if the merchant names specific IDs. Set `per_page` only " +
          "if the merchant specifies it. " +
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
  name: `phase3-orders-export-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-3 Ex-core family ` +
    `(download_orders_export) on ${MODEL}. ${items.length} hand-authored ` +
    `merchant questions, frozen TODAY=${TODAY}. Scored by tool-name-match, ` +
    "required-fields-present (from + to), args-overlap, description-quality, " +
    "binary-envelope-contract (STATIC; readFile + assert { contentType, " +
    "base64, filenameHint } present — locks the shape for Phase 5/7/10 " +
    "reuse), and csv-date-format-pin (STATIC; readFile + assert yyyy-mm-dd " +
    "regex present — WR-02 lesson).",
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
    { scoreName: "tool-name-match", min: 0.9 },
    { scoreName: "args-overlap", min: 0.75 },
    { scoreName: "description-quality", min: 1.0 },
    { scoreName: "binary-envelope-contract", min: 1.0 },
    { scoreName: "csv-date-format-pin", min: 1.0 },
  ]);
}
