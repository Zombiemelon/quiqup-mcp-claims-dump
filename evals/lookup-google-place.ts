/**
 * Eval runner: lookup-google-place-v1 — Google Places family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the `lookup_google_place` tool exposed (single-tool eval — this
 * family currently has one entry), captures the tool_use block, and
 * scores it via ./score-lookup-google-place.ts. Results stream to
 * Langfuse as a trace per item plus scores.
 *
 * Drift-proofing: the tool's description and input schema are imported
 * DIRECTLY from the production `spec`. No inline duplication.
 *
 * Offline: does NOT hit places.googleapis.com (no live Google quota
 * consumed by the eval — the dataset's place_ids are illustrative, not
 * required to resolve).
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit (skips loading
 * the heavy OTel / Anthropic SDKs entirely).
 *
 * CI gate: set EVAL_GATE=1 to enforce args-overlap >= 0.8,
 * description-quality >= 1.0, AND auth-isolation >= 1.0 at the end.
 *
 * Run: `bun run eval:lookup-google-place`
 */

import {
  items,
  TODAY,
  type LookupGooglePlaceInput,
  type LookupGooglePlaceExpected,
} from "./datasets/lookup-google-place-v1";

// Production tool spec — imported statically so the Anthropic `tools`
// payload reads `spec.description` and `spec.inputSchema` from the live
// production source. No inline string copies = no drift surface.
import { spec as lookupGooglePlaceSpec } from "@/lib/tools/lookup-google-place";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `lookup-google-place-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-lookup-google-place");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

// Single-tool eval — lookup_google_place is the only entry in the Google
// Places family today. Tool description + input shape come straight from
// the production spec (see spec.description usage below).
const inputJsonSchema = z.toJSONSchema(lookupGooglePlaceSpec.inputSchema, {
  target: "draft-07",
  io: "input",
}) as Record<string, unknown>;
const tool = {
  name: lookupGooglePlaceSpec.name,
  description: lookupGooglePlaceSpec.description,
  input_schema: { ...inputJsonSchema, type: "object" as const },
};

interface TaskOutput {
  tool: string | null;
  args: Record<string, unknown> | null;
}

const task: ExperimentTask<LookupGooglePlaceInput, LookupGooglePlaceExpected> =
  async (item) => {
    const input = (item as { input?: LookupGooglePlaceInput }).input;
    if (!input?.request) {
      return { tool: null, args: null } satisfies TaskOutput;
    }
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      tools: [tool],
      tool_choice: { type: "any" },
      messages: [
        {
          role: "user",
          content:
            "You are a logistics assistant integrating with the Google Places " +
            "(New) API. Translate the merchant's question into a single " +
            "lookup_google_place tool call. Use the literal place_id the " +
            "merchant supplies. If they ask for a specific field (e.g. " +
            'formattedAddress, location, displayName), set field_mask to ' +
            "that field; otherwise omit field_mask and let the server-side " +
            `default cover it. Today's date is ${TODAY} (UTC).\n\n` +
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
  name: `lookup-google-place-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for lookup_google_place on ${MODEL}. ` +
    `${items.length} hand-authored merchant questions, frozen TODAY=${TODAY}. ` +
    "Scored by tool-name-match, required-fields-present (place_id), " +
    "args-overlap, description-quality (asserts the auth-exception language " +
    "on spec.description), and auth-isolation (asserts the tool + client " +
    "sources do not import Quiqup-bridge identifiers).",
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
    { scoreName: "args-overlap", min: 0.8 },
    { scoreName: "description-quality", min: 1.0 },
    { scoreName: "auth-isolation", min: 1.0 },
  ]);
}
