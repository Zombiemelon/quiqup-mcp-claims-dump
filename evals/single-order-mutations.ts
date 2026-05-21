/**
 * Eval runner: single-order-mutations-v1 — Phase-4 single-order mutations
 * family (ORDS-03/04/06/07).
 *
 * Hands each dataset item's natural-language merchant instruction to
 * Claude with the 4 Phase-4 single-order-mutation tools exposed
 * (export_order, update_fulfilment_order_status, create_order_charge,
 * update_order_weight) and scores the resulting tool_use block via
 * ./score-single-order-mutations.ts.
 *
 * Drift-proofing: tool descriptions + input schemas are imported
 * DIRECTLY from each production `spec` (no inline copies).
 *
 * The score file includes TWO STATIC structural-assertion scorers:
 *   - destructive-gate-present-ords-04 (D-06 — ONLY ORDS-04 is gated;
 *                                       the other 3 must NOT be over-gated)
 *   - numeric-bounds-pin              (T-04-13/14 — locks 100_000 amount
 *                                       cap on create_order_charge AND
 *                                       .max(1000) weight cap on
 *                                       update_order_weight)
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
 * args-overlap >= 0.7, description-quality >= 1.0,
 * destructive-gate-present-ords-04 >= 1.0, AND numeric-bounds-pin >= 1.0.
 *
 * Run: `bun run eval:single-order-mutations`
 */

import {
  items,
  TODAY,
  type SingleOrderMutationsInput,
  type SingleOrderMutationsExpected,
} from "./datasets/single-order-mutations-v1";

import { spec as exportOrderSpec } from "@/lib/tools/export-order";
import { spec as updateFulfilmentOrderStatusSpec } from "@/lib/tools/update-fulfilment-order-status";
import { spec as createOrderChargeSpec } from "@/lib/tools/create-order-charge";
import { spec as updateOrderWeightSpec } from "@/lib/tools/update-order-weight";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `single-order-mutations-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-single-order-mutations");

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
  exportOrderSpec,
  updateFulfilmentOrderStatusSpec,
  createOrderChargeSpec,
  updateOrderWeightSpec,
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

const task: ExperimentTask<
  SingleOrderMutationsInput,
  SingleOrderMutationsExpected
> = async (item) => {
  const input = (item as { input?: SingleOrderMutationsInput }).input;
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
          "merchant). Translate the merchant's instruction into the single most " +
          "appropriate Phase-4 single-order-mutation tool call. Disambiguation:\n" +
          "  - `export_order`                   → re-trigger Quiqup's order-export " +
          "side-effect (PUT /orders/export/{id}). NOT destructive. Use when an " +
          "integration didn't pick the order up.\n" +
          "  - `update_fulfilment_order_status` → change a fulfilment order's " +
          "status (PATCH /api/fulfilment/orders/{id}). DESTRUCTIVE (D-06) — you " +
          "MUST pass `confirm: true`.\n" +
          "  - `create_order_charge`            → POST a one-off charge against " +
          "the order (POST /quiqdash/order-charge). NOT destructive. Amount capped " +
          "at 100,000 in the chosen currency.\n" +
          "  - `update_order_weight`            → PATCH the order's weight " +
          "(PATCH /quiqdash/orders/{id}/weight). NOT destructive. Weight must be " +
          "> 0 and <= 1000 kg. The agent-facing field is `weight_kg`.\n" +
          "Use sensible defaults for unspecified fields. " +
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
  name: `phase4-single-order-mutations-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-4 single-order ` +
    `mutations family (4 tools — ORDS-03/04/06/07) on ${MODEL}. ` +
    `${items.length} hand-authored merchant instructions, frozen ` +
    `TODAY=${TODAY}. Scored by tool-name-match, required-fields-present ` +
    "(per-tool), args-overlap, description-quality, plus 2 STATIC scorers: " +
    "destructive-gate-present-ords-04 (D-06 — locks the gating split so " +
    "ONLY update_fulfilment_order_status carries confirm/dry_run, the " +
    "other 3 do NOT) and numeric-bounds-pin (T-04-13/14 — locks the " +
    "100_000 amount cap on create_order_charge and the .max(1000) weight " +
    "cap on update_order_weight).",
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
    { scoreName: "destructive-gate-present-ords-04", min: 1.0 },
    { scoreName: "numeric-bounds-pin", min: 1.0 },
  ]);
}
