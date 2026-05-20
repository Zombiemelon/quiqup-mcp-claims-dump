/**
 * Eval runner: woocommerce-integration-v1 — Phase-2 WooCommerce family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 6 Phase-2 WooCommerce tools exposed
 * (list_woocommerce_connections, get_woocommerce_config,
 * list_woocommerce_states, list_woocommerce_shipping_lines,
 * setup_woocommerce_connection, upsert_woocommerce_config) and scores the
 * resulting tool_use block via ./score-woocommerce-integration.ts.
 *
 * Drift-proofing: tool descriptions are imported DIRECTLY from each
 * production `spec` (T-02-49).
 *
 * Offline: does NOT hit the Quiqup API.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit.
 *
 * CI gate: set EVAL_GATE=1 to enforce args-overlap >= 0.75,
 * description-quality >= 1.0, and
 * quiqup-vs-woocommerce-state-disambiguation >= 1.0.
 *
 * Run: `bun run eval:woocommerce-integration`
 */

import {
  items,
  TODAY,
  type WooCommerceIntegrationInput,
  type WooCommerceIntegrationExpected,
} from "./datasets/woocommerce-integration-v1";

import { spec as listWooCommerceConnectionsSpec } from "@/lib/tools/list-woocommerce-connections";
import { spec as getWooCommerceConfigSpec } from "@/lib/tools/get-woocommerce-config";
import { spec as listWooCommerceStatesSpec } from "@/lib/tools/list-woocommerce-states";
import { spec as listWooCommerceShippingLinesSpec } from "@/lib/tools/list-woocommerce-shipping-lines";
import { spec as setupWooCommerceConnectionSpec } from "@/lib/tools/setup-woocommerce-connection";
import { spec as upsertWooCommerceConfigSpec } from "@/lib/tools/upsert-woocommerce-config";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `woocommerce-integration-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-woocommerce-integration");

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
  listWooCommerceConnectionsSpec,
  getWooCommerceConfigSpec,
  listWooCommerceStatesSpec,
  listWooCommerceShippingLinesSpec,
  setupWooCommerceConnectionSpec,
  upsertWooCommerceConfigSpec,
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
  WooCommerceIntegrationInput,
  WooCommerceIntegrationExpected
> = async (item) => {
  const input = (item as { input?: WooCommerceIntegrationInput }).input;
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
          "You are an operations assistant for a Quiqup partner integrating " +
          "with WooCommerce. Translate the merchant's question into the " +
          "single most appropriate Phase-2 WooCommerce-family tool call. " +
          "Disambiguation: WooCommerce-only catalog vs cross-family catalog, " +
          "SAVED mapping/config vs LIVE storefront catalog, Quiqup-canonical " +
          "states vs WooCommerce-native statuses. " +
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
  name: `phase2-woocommerce-integration-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-2 WooCommerce family ` +
    `on ${MODEL}. ${items.length} hand-authored merchant questions, frozen ` +
    `TODAY=${TODAY}. Scored by tool-name-match, required-fields-present ` +
    "(per-tool rules), args-overlap, description-quality (per-tool " +
    "substring checklist) and a static " +
    "quiqup-vs-woocommerce-state-disambiguation scorer.",
  data: items,
  task,
  evaluators,
});

console.log(await result.format());

await langfuse.shutdown();
await otelSdk.shutdown();

if (process.env.EVAL_GATE === "1") {
  const { gate } = await import("./gate");
  gate(result, [
    { scoreName: "args-overlap", min: 0.75 },
    { scoreName: "description-quality", min: 1.0 },
    { scoreName: "quiqup-vs-woocommerce-state-disambiguation", min: 1.0 },
  ]);
}
