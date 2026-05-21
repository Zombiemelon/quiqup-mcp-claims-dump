/**
 * Eval runner: batch-transitions-v1 — Phase-4 batch-transitions family
 * (ORDT-03..14 — 11 batch transitions + unpool_order single-order outlier).
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 12 Phase-4 batch-transition tools exposed (the 11 factory ORDT
 * tools + `unpool_order`) and scores the resulting tool_use block via
 * ./score-batch-transitions.ts.
 *
 * Drift-proofing: tool descriptions, input schemas, and tool names are
 * imported DIRECTLY from each production `spec` (no inline copies —
 * T-01-26 + 02-06 + 03-05 lesson).
 *
 * The score file includes FOUR STATIC scorers that lock the Phase-4
 * destructive surface at the CI layer:
 *   - destructive-gate-present  (T-04-28 — all 15 destructive tools wire
 *                                the canonical confirm + dry_run fields)
 *   - factory-uniformity        (T-04-26 — all 11 factory ORDT tools +
 *                                unpool_order share the canonical
 *                                guardrails block)
 *   - reason-field-pin          (T-04-29 — the 4 reason-bearing tools
 *                                use free-form z.string() and name their
 *                                Phase-1 list_*_reasons companion)
 *   - dry-run-richness          (D-03 — _batch-transition-factory.ts
 *                                synthesizes the canonical rich preview)
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
 * destructive-gate-present >= 1.0, factory-uniformity >= 1.0,
 * reason-field-pin >= 1.0, AND dry-run-richness >= 1.0.
 *
 * Run: `bun run eval:batch-transitions`
 */

import {
  items,
  TODAY,
  type BatchTransitionsInput,
  type BatchTransitionsExpected,
} from "./datasets/batch-transitions-v1";

import { spec as setCollectedSpec } from "@/lib/tools/set-collected";
import { spec as setReceivedAtDepotSpec } from "@/lib/tools/set-received-at-depot";
import { spec as setAtDepotSpec } from "@/lib/tools/set-at-depot";
import { spec as setInTransitSpec } from "@/lib/tools/set-in-transit";
import { spec as setScheduledSpec } from "@/lib/tools/set-scheduled";
import { spec as setDeliveryCompleteSpec } from "@/lib/tools/set-delivery-complete";
import { spec as setOnHoldSpec } from "@/lib/tools/set-on-hold";
import { spec as setReturnToOriginSpec } from "@/lib/tools/set-return-to-origin";
import { spec as setReturnedToOriginSpec } from "@/lib/tools/set-returned-to-origin";
import { spec as setDeliveryFailedSpec } from "@/lib/tools/set-delivery-failed";
import { spec as setCollectionFailedSpec } from "@/lib/tools/set-collection-failed";
import { spec as unpoolOrderSpec } from "@/lib/tools/unpool-order";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `batch-transitions-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-batch-transitions");

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
  setCollectedSpec,
  setReceivedAtDepotSpec,
  setAtDepotSpec,
  setInTransitSpec,
  setScheduledSpec,
  setDeliveryCompleteSpec,
  setOnHoldSpec,
  setReturnToOriginSpec,
  setReturnedToOriginSpec,
  setDeliveryFailedSpec,
  setCollectionFailedSpec,
  unpoolOrderSpec,
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
  BatchTransitionsInput,
  BatchTransitionsExpected
> = async (item) => {
  const input = (item as { input?: BatchTransitionsInput }).input;
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
          "merchant) executing batch lifecycle transitions on orders. Translate " +
          "the merchant's instruction into the single most appropriate Phase-4 " +
          "batch-transition tool call. Disambiguation guide:\n" +
          "  - Forward path: `set_collected` → `set_received_at_depot` → " +
          "`set_at_depot` → `set_in_transit` → `set_scheduled` → " +
          "`set_delivery_complete`.\n" +
          "  - Exception path (reason-bearing): `set_on_hold`, " +
          "`set_return_to_origin`, `set_delivery_failed`, " +
          "`set_collection_failed`. All four require a free-form `reason` " +
          "string; discover valid codes via the Phase-1 `list_*_reasons` " +
          "tools.\n" +
          "  - Terminal acknowledgement of an RTO: `set_returned_to_origin` " +
          "(no reason).\n" +
          "  - Single-order outlier: `unpool_order` — takes `order_uuid` " +
          "(NOT order_ids) to sever an order's mission assignment.\n" +
          "DESTRUCTIVE GATE: every tool in this family is DESTRUCTIVE — you " +
          "MUST pass `confirm: true` in the args. Optionally pair with " +
          "`dry_run: true` for a preview. Use sensible defaults for " +
          "unspecified fields. " +
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
  name: `phase4-batch-transitions-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-4 batch-transitions ` +
    `family (12 tools — 11 factory ORDT + unpool_order) on ${MODEL}. ` +
    `${items.length} hand-authored merchant instructions, frozen ` +
    `TODAY=${TODAY}. Scored by tool-name-match, required-fields-present ` +
    "(order_ids on factory tools; order_uuid on unpool_order; reason on the " +
    "4 reason-bearing tools), args-overlap, description-quality, plus 4 " +
    "STATIC scorers locking the Phase-4 destructive contract: " +
    "destructive-gate-present (15 specs share canonical confirm+dry_run), " +
    "factory-uniformity (12 factory+unpool tools share canonical guardrails " +
    "block), reason-field-pin (4 tools use z.string() + name their " +
    "list_*_reasons companion), dry-run-richness (factory still synthesizes " +
    "the rich { dryRun:true, orderIds, simulated } preview).",
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
    { scoreName: "destructive-gate-present", min: 1.0 },
    { scoreName: "factory-uniformity", min: 1.0 },
    { scoreName: "reason-field-pin", min: 1.0 },
    { scoreName: "dry-run-richness", min: 1.0 },
  ]);
}
