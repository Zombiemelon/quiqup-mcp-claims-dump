/**
 * Eval runner: lastmile-order-creation-v1.
 *
 * Hands each dataset item's natural-language request to Claude with the
 * `create_lastmile_order` tool exposed, captures the tool_use block, and
 * scores it via ../score-tool-call.ts. Results stream to Langfuse as a
 * trace per item plus scores.
 *
 * Offline: does NOT hit the Quiqup API. Measures LLM tool-call quality
 * against today's MCP tool description, not end-to-end correctness.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Run: `bun run eval:lastmile-orders`
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { LangfuseClient } from "@langfuse/client";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { ExperimentTask } from "@langfuse/client";

import { spec as createLastmileOrderSpec } from "@/lib/tools/create-lastmile-order";
import {
  items,
  type CreateLastmileOrderInput,
  type CreateLastmileOrderExpected,
} from "./datasets/lastmile-order-creation-v1";
import { evaluators } from "./score-tool-call";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

// Tool spec mirrors the live MCP tool: same name, same description, AND
// same JSON-Schema-serialised input shape. Earlier this hand-built a
// wide-open `{ type: "object", additionalProperties: true }`, which masked
// the 2026-05-14 bug where the production schema serialised to empty
// `{ properties: {} }` and Claude.ai sent `{}`. By deriving the schema
// from the actual spec the eval now catches that class of regression.
const inputJsonSchema = z.toJSONSchema(createLastmileOrderSpec.inputSchema, {
  target: "draft-07",
  io: "input",
}) as Record<string, unknown>;
const tool = {
  name: createLastmileOrderSpec.name,
  description: createLastmileOrderSpec.description,
  input_schema: { ...inputJsonSchema, type: "object" as const },
};

interface TaskOutput {
  tool: string | null;
  args: Record<string, unknown> | null;
}

const task: ExperimentTask<CreateLastmileOrderInput, CreateLastmileOrderExpected> = async (
  item,
) => {
  const input = (item as { input?: CreateLastmileOrderInput }).input;
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
          "You are a logistics assistant for a Dubai-based merchant. " +
          "Translate the merchant's request into a create_lastmile_order tool call " +
          "with the right arguments. Use sensible defaults for unspecified fields.\n\n" +
          `Request: ${input.request}`,
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
  name: `lastmile-order-creation-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for create_lastmile_order on ${MODEL}. ` +
    "6 hand-authored merchant requests scored by tool-name-match, " +
    "required-fields-present, and args-overlap.",
  data: items,
  task,
  evaluators,
});

console.log(await result.format());

// Drain the Langfuse score queue BEFORE shutting OTEL down — without this,
// scores from late-running evaluators get dropped on process exit. (Verified
// 2026-05-13: first run lost 8/18 scores due to missing flush.)
await langfuse.shutdown();
await otelSdk.shutdown();

// CI gate (opt-in via EVAL_GATE=1; no-op locally).
if (process.env.EVAL_GATE === "1") {
  const { gate } = await import("./gate");
  gate(result, [{ scoreName: "args-overlap", min: 0.85 }]);
}
