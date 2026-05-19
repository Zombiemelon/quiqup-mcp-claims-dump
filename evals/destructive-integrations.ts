/**
 * Eval runner: destructive-integrations-v1 — Phase-2 destructive-integrations
 * sub-family (delete_integration_source + delete_salla_connection).
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 2 Phase-2 destructive tools exposed and scores the resulting
 * tool_use block via ./score-destructive-integrations.ts.
 *
 * Drift-proofing: tool descriptions are imported DIRECTLY from each
 * production `spec` (T-02-49).
 *
 * The destructive family's score file includes a STATIC confirm-gate-present
 * scorer that imports the canonical `destructiveConfirmField` +
 * `destructiveDryRunField` from lib/middleware/destructive.ts and asserts
 * BOTH delete tools wire those exact Zod instances on their
 * spec.inputSchema.shape. A maintainer cannot silently remove or rename the
 * gate without simultaneously editing this scorer (T-02-52).
 *
 * Offline: does NOT hit the Quiqup API — and CANNOT trigger an upstream
 * DELETE, since the LLM never actually executes the tool. Even if it did,
 * the destructive gate would reject any call without `confirm: true`.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit.
 *
 * CI gate: set EVAL_GATE=1 to enforce args-overlap >= 0.7,
 * confirm-elicited >= 0.75, AND confirm-gate-present >= 1.0 at the end.
 *
 * Run: `bun run eval:destructive-integrations`
 */

import {
  items,
  TODAY,
  type DestructiveIntegrationsInput,
  type DestructiveIntegrationsExpected,
} from "./datasets/destructive-integrations-v1";

import { spec as deleteIntegrationSourceSpec } from "@/lib/tools/delete-integration-source";
import { spec as deleteSallaConnectionSpec } from "@/lib/tools/delete-salla-connection";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `destructive-integrations-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-destructive-integrations");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

const specs = [deleteIntegrationSourceSpec, deleteSallaConnectionSpec] as const;

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
  DestructiveIntegrationsInput,
  DestructiveIntegrationsExpected
> = async (item) => {
  const input = (item as { input?: DestructiveIntegrationsInput }).input;
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
          "the merchant's question into the single most appropriate " +
          "destructive integration tool call. " +
          "These tools require `confirm: true` to actually perform the " +
          "deletion — if the description tells you confirm is required, " +
          "include it in your args. Use `dry_run: true` (paired with " +
          "`confirm: true`) when the merchant asks for a preview. " +
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
  name: `phase2-destructive-integrations-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-2 destructive-` +
    `integrations family on ${MODEL}. ${items.length} hand-authored merchant ` +
    `prompts, frozen TODAY=${TODAY}. Scored by tool-name-match, ` +
    "required-fields-present, args-overlap, confirm-elicited (per-item " +
    "isolation of the `confirm: true` elicitation signal), and " +
    "confirm-gate-present (STATIC; imports the canonical " +
    "destructiveConfirmField + destructiveDryRunField and asserts identity " +
    "on both delete tools' inputSchema.shape; T-02-52).",
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
    { scoreName: "args-overlap", min: 0.7 },
    { scoreName: "confirm-elicited", min: 0.75 },
    { scoreName: "confirm-gate-present", min: 1.0 },
  ]);
}
