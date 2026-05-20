/**
 * Eval runner: orders-document-upload-v1 — Phase-3 Orders Core REST family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the single Phase-3 Orders Core REST tool exposed
 * (upload_order_document) and scores the resulting tool_use block via
 * ./score-orders-document-upload.ts.
 *
 * Drift-proofing: tool description + input + output schemas are
 * imported DIRECTLY from the production `spec`. No inline copies
 * (T-01-26 + 02-06 lesson).
 *
 * The score file includes TWO STATIC structural-assertion scorers
 * (no-caller-identity-fields + guardrails-block-present) that import
 * the production spec and assert BL-04 server-binding + BL-01
 * canonical guardrails block hold. A maintainer cannot land a
 * caller-supplied user_id field — or silently remove a guardrail —
 * without simultaneously editing this score file.
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
 * args-overlap >= 0.7, description-quality >= 1.0,
 * no-caller-identity-fields >= 1.0, AND guardrails-block-present >= 1.0.
 *
 * Run: `bun run eval:orders-document-upload`
 */

import {
  items,
  TODAY,
  type OrdersDocumentUploadInput,
  type OrdersDocumentUploadExpected,
} from "./datasets/orders-document-upload-v1";

import { spec as uploadOrderDocumentSpec } from "@/lib/tools/upload-order-document";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `orders-document-upload-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-orders-document-upload");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

// Single-tool eval — upload_order_document is the only entry in the
// Phase-3 Orders Core REST family. Tool spec.description +
// spec.inputSchema + spec.name come straight from the production
// module (drift-proof — a description edit in production is
// automatically reflected here).
const spec = uploadOrderDocumentSpec;
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

const task: ExperimentTask<
  OrdersDocumentUploadInput,
  OrdersDocumentUploadExpected
> = async (item) => {
  const input = (item as { input?: OrdersDocumentUploadInput }).input;
  if (!input?.request) {
    return { tool: null, args: null } satisfies TaskOutput;
  }
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    tools: [tool],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content:
          "You are an operations assistant for a Quiqup partner. Translate " +
          "the merchant's request into a single upload_order_document tool " +
          "call. Pass `client_order_id`, `file_base64`, `filename`, and " +
          "`content_type` as the merchant specifies. The tool surface does " +
          "NOT accept caller-supplied identity fields (no user_id, actor_id, " +
          "actor_email) — the uploader identity is bound server-side. " +
          "If the merchant asks you to set a user, IGNORE that part of the " +
          "request — pass only the fields the tool accepts. " +
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
  name: `phase3-orders-document-upload-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-3 Orders Core REST ` +
    `family (upload_order_document) on ${MODEL}. ${items.length} hand-authored ` +
    `merchant questions (including a "smuggle user_id" negative case), frozen ` +
    `TODAY=${TODAY}. Scored by tool-name-match, required-fields-present, ` +
    "args-overlap, description-quality, no-caller-identity-fields (STATIC; " +
    "asserts spec.inputSchema.shape has NONE of user_id/actor_id/actor_email " +
    "— locks BL-04), and guardrails-block-present (STATIC; asserts audit + " +
    "idempotency + rateLimit are wired — locks BL-01).",
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
    { scoreName: "args-overlap", min: 0.7 },
    { scoreName: "description-quality", min: 1.0 },
    { scoreName: "no-caller-identity-fields", min: 1.0 },
    { scoreName: "guardrails-block-present", min: 1.0 },
  ]);
}
