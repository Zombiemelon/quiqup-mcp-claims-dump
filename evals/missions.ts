/**
 * Eval runner: missions-v1 — Phase-4 missions family (MISS-01, MISS-02).
 *
 * Hands each dataset item's natural-language merchant instruction to
 * Claude with the 2 Phase-4 missions tools exposed (create_mission,
 * transfer_mission_orders) and scores the resulting tool_use block via
 * ./score-missions.ts.
 *
 * Drift-proofing: tool descriptions + input schemas are imported
 * DIRECTLY from each production `spec` (no inline copies).
 *
 * The score file includes ONE critical STATIC structural-assertion
 * scorer:
 *   - gating-asymmetry-lock — the D-05 lock. Asserts the exact gating
 *                             split: create_mission has NO confirm field,
 *                             transfer_mission_orders DOES have confirm
 *                             with the canonical "DESTRUCTIVE-GATE:"
 *                             description prefix AND dry_run with
 *                             "DRY-RUN:". A maintainer who flips either
 *                             half of the asymmetry trips the gate.
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
 * args-overlap >= 0.7, description-quality >= 1.0, AND
 * gating-asymmetry-lock >= 1.0.
 *
 * Run: `bun run eval:missions`
 */

import {
  items,
  TODAY,
  type MissionsInput,
  type MissionsExpected,
} from "./datasets/missions-v1";

import { spec as createMissionSpec } from "@/lib/tools/create-mission";
import { spec as transferMissionOrdersSpec } from "@/lib/tools/transfer-mission-orders";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(`missions-v1 dry-run: ${items.length} items (TODAY=${TODAY})`);
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

const { evaluators } = await import("./score-missions");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

const specs = [createMissionSpec, transferMissionOrdersSpec] as const;

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

const task: ExperimentTask<MissionsInput, MissionsExpected> = async (item) => {
  const input = (item as { input?: MissionsInput }).input;
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
          "You are an operations assistant for a Quiqup partner. Translate the " +
          "merchant's instruction into the single most appropriate Phase-4 " +
          "missions-family tool call. Disambiguation:\n" +
          "  - `create_mission`         → CREATE a new mission with depot + " +
          "zone + type + initial orderIds. NOT destructive — pure additive.\n" +
          "  - `transfer_mission_orders` → MOVE orders into an existing mission " +
          "by mission_id. DESTRUCTIVE (D-05) — you MUST pass `confirm: true`. " +
          "Optionally pair with `dry_run: true` for a preview.\n" +
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
  name: `phase4-missions-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-4 missions family ` +
    `(2 tools — MISS-01 + MISS-02) on ${MODEL}. ${items.length} hand- ` +
    `authored merchant instructions, frozen TODAY=${TODAY}. Scored by ` +
    "tool-name-match, required-fields-present, args-overlap, description-" +
    "quality, plus the critical STATIC gating-asymmetry-lock scorer that " +
    "locks D-05: create_mission must have no confirm field; " +
    "transfer_mission_orders must wire the canonical destructive " +
    'confirm ("DESTRUCTIVE-GATE:" prefix) + dry_run ("DRY-RUN:" prefix). ' +
    "Locks T-04-27 — gating flip would trip CI.",
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
    { scoreName: "gating-asymmetry-lock", min: 1.0 },
  ]);
}
