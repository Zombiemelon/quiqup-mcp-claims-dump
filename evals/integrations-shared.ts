/**
 * Eval runner: integrations-shared-v1 — Phase-2 shared-integrations family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 5 Phase-2 shared-integrations tools exposed
 * (list_integration_connections, list_integration_order_reasons,
 * repair_integration_orders, get_integration_order, confirm_ff_export) and
 * scores the resulting tool_use block via ./score-integrations-shared.ts.
 * Results stream to Langfuse as a trace per item plus scores.
 *
 * Drift-proofing: tool descriptions are imported DIRECTLY from each
 * production `spec` (no inline copies). Mirrors plan 01-04 T-01-26.
 *
 * Offline: does NOT hit the Quiqup API.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit.
 *
 * CI gate: set EVAL_GATE=1 to enforce args-overlap >= 0.7 and
 * description-quality >= 1.0 at the end.
 *
 * Run: `bun run eval:integrations-shared`
 */

import {
  items,
  TODAY,
  type IntegrationsSharedInput,
  type IntegrationsSharedExpected,
} from "./datasets/integrations-shared-v1";

// Production tool specs — drift-proof; spec.description flows in automatically.
import { spec as listIntegrationConnectionsSpec } from "@/lib/tools/list-integration-connections";
import { spec as listIntegrationOrderReasonsSpec } from "@/lib/tools/list-integration-order-reasons";
import { spec as repairIntegrationOrdersSpec } from "@/lib/tools/repair-integration-orders";
import { spec as getIntegrationOrderSpec } from "@/lib/tools/get-integration-order";
import { spec as confirmFfExportSpec } from "@/lib/tools/confirm-ff-export";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `integrations-shared-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-integrations-shared");

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
  listIntegrationConnectionsSpec,
  listIntegrationOrderReasonsSpec,
  repairIntegrationOrdersSpec,
  getIntegrationOrderSpec,
  confirmFfExportSpec,
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
  IntegrationsSharedInput,
  IntegrationsSharedExpected
> = async (item) => {
  const input = (item as { input?: IntegrationsSharedInput }).input;
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
          "You are an operations assistant for a Quiqup partner. Translate " +
          "the merchant's question into the single most appropriate Phase-2 " +
          "shared-integrations tool call. Disambiguation guide:\n" +
          "  - `list_integration_connections`   → cross-family catalog (Shopify+WooCommerce+Salla).\n" +
          "  - `list_integration_order_reasons` → triage failed integration orders.\n" +
          "  - `repair_integration_orders`      → retry a batch of failed orders by id.\n" +
          "  - `get_integration_order`          → re-fetch a single envelope by UUID.\n" +
          "  - `confirm_ff_export`              → ack a fulfilment-order export by UUID.\n" +
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
  name: `phase2-integrations-shared-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-2 shared-integrations ` +
    `family on ${MODEL}. ${items.length} hand-authored merchant questions, ` +
    `frozen TODAY=${TODAY}. Scored by tool-name-match, required-fields-present ` +
    "(per-tool rules), args-overlap, and a static description-quality scorer " +
    "that asserts the per-tool substring checklist (endpoint path, 401, " +
    "canonical companion-tool reference).",
  data: items,
  task,
  evaluators,
});

console.log(await result.format());

await langfuse.shutdown();
await otelSdk.shutdown();

// CI gate (opt-in via EVAL_GATE=1; no-op locally).
// args-overlap min 0.7: repair_integration_orders has 8 required args so a
// single LLM miss tanks the per-item score; 0.7 keeps the gate green while
// still catching regressions on companion-tool elicitation language.
if (process.env.EVAL_GATE === "1") {
  const { gate } = await import("./gate");
  gate(result, [
    { scoreName: "args-overlap", min: 0.7 },
    { scoreName: "description-quality", min: 1.0 },
  ]);
}
