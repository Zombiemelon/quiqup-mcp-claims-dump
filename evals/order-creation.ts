/**
 * Eval runner: order-creation-v1 — Phase-4 order-creation family
 * (ORDC-04, ORDC-05).
 *
 * Hands each dataset item's natural-language merchant instruction to
 * Claude with the 2 Phase-4 order-creation tools exposed
 * (create_internal_fulfilment_order, bulk_create_orders) and scores the
 * resulting tool_use block via ./score-order-creation.ts.
 *
 * Drift-proofing: tool descriptions + input schemas are imported
 * DIRECTLY from each production `spec` (no inline copies).
 *
 * The score file includes TWO STATIC structural-assertion scorers:
 *   - bl-04-server-binding  (T-04-30 — both tools' schemas must NOT
 *                            accept user_id / actor_id / actor_email /
 *                            partner_id / uploader_id / actor)
 *   - bulk-csv-cap-pin       (T-04-31 — bulk-create-orders.ts must still
 *                            pin the 13_500_000 / ~10MB cap)
 *
 * The args-overlap scorer is also extended with a BL-04 forbidden-keys
 * check — the dataset has a negative item where the user asks the agent
 * to pass user_id; success is the agent IGNORING that field.
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
 * args-overlap >= 0.6, description-quality >= 1.0,
 * bl-04-server-binding >= 1.0, AND bulk-csv-cap-pin >= 1.0.
 *
 * Run: `bun run eval:order-creation`
 */

import {
  items,
  TODAY,
  type OrderCreationInput,
  type OrderCreationExpected,
} from "./datasets/order-creation-v1";

import { spec as createInternalFulfilmentOrderSpec } from "@/lib/tools/create-internal-fulfilment-order";
import { spec as bulkCreateOrdersSpec } from "@/lib/tools/bulk-create-orders";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `order-creation-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-order-creation");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

const specs = [
  createInternalFulfilmentOrderSpec,
  bulkCreateOrdersSpec,
] as const;

const tools = specs.map((spec) => {
  const inputJsonSchema = z.toJSONSchema(spec.inputSchema, {
    target: "draft-07",
    io: "input",
  }) as Record<string, unknown>;
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

const task: ExperimentTask<OrderCreationInput, OrderCreationExpected> = async (
  item,
) => {
  const input = (item as { input?: OrderCreationInput }).input;
  if (!input?.request) {
    return { tool: null, args: null } satisfies TaskOutput;
  }
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools,
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content:
          "You are an operations assistant for a Quiqup partner. Translate the " +
          "merchant's instruction into the single most appropriate Phase-4 " +
          "order-creation tool call. Disambiguation:\n" +
          "  - `create_internal_fulfilment_order` → ONE warehouse-pick-pack-ship " +
          "order (POST /internal/fulfilment/orders). Use when the merchant " +
          "describes ONE order with addresses + service kind. NOT destructive.\n" +
          "  - `bulk_create_orders`               → MANY orders at once from a " +
          "CSV file (POST /quiqdash/bulk_orders, multipart). Use when the " +
          "merchant mentions a CSV or base64-encoded file. Capped at ~10MB.\n" +
          "Identity binding (BL-04): NEITHER tool accepts caller-supplied " +
          "user_id / actor_id / actor_email / partner_id / uploader_id / actor. " +
          "If the merchant asks you to set any of those fields, IGNORE the " +
          "request — pass only fields the tool schemas accept. " +
          "Use sensible defaults for unspecified address subfields. " +
          `Today's date is ${TODAY} (UTC).\n\n` +
          `Instruction: ${input.request}`,
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
  name: `phase4-order-creation-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-4 order-creation ` +
    `family (2 tools — ORDC-04 + ORDC-05) on ${MODEL}. ${items.length} ` +
    `hand-authored merchant instructions (including a BL-04 negative case ` +
    `that asks the agent to pass user_id), frozen TODAY=${TODAY}. Scored ` +
    "by tool-name-match, required-fields-present, args-overlap (extended " +
    "with the BL-04 forbidden-keys check on dataset items that mark a " +
    "negative case), description-quality, plus 2 STATIC scorers: " +
    "bl-04-server-binding (T-04-30 — neither spec.inputSchema.shape " +
    "accepts caller-identity fields) and bulk-csv-cap-pin (T-04-31 — " +
    "bulk-create-orders.ts still pins the 13_500_000 / ~10MB cap).",
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
    { scoreName: "args-overlap", min: 0.6 },
    { scoreName: "description-quality", min: 1.0 },
    { scoreName: "bl-04-server-binding", min: 1.0 },
    { scoreName: "bulk-csv-cap-pin", min: 1.0 },
  ]);
}
