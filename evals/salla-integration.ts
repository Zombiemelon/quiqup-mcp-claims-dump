/**
 * Eval runner: salla-integration-v1 — Phase-2 Salla family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 6 Phase-2 Salla tools exposed (install_salla,
 * get_salla_connection, get_salla_platform_data, get_salla_config,
 * update_salla_config, toggle_salla_fulfillment) and scores the resulting
 * tool_use block via ./score-salla-integration.ts.
 *
 * Drift-proofing: tool descriptions are imported DIRECTLY from each
 * production `spec` (T-02-49).
 *
 * The Salla family's score file includes TWO STATIC source-inspection
 * scorers (token-omission + four-oh-four-as-null) that readFile the
 * production tool sources and assert the canonical Salla invariants
 * (T-02-29 + T-02-30). These are the eval-layer mirrors of the unit-test
 * invariants — a maintainer cannot regress either without simultaneously
 * editing or deleting this eval's scorer file.
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
 * description-quality >= 1.0, token-omission >= 1.0, AND
 * four-oh-four-as-null >= 1.0 at the end.
 *
 * Run: `bun run eval:salla-integration`
 */

import {
  items,
  TODAY,
  type SallaIntegrationInput,
  type SallaIntegrationExpected,
} from "./datasets/salla-integration-v1";

import { spec as installSallaSpec } from "@/lib/tools/install-salla";
import { spec as getSallaConnectionSpec } from "@/lib/tools/get-salla-connection";
import { spec as getSallaPlatformDataSpec } from "@/lib/tools/get-salla-platform-data";
import { spec as getSallaConfigSpec } from "@/lib/tools/get-salla-config";
import { spec as updateSallaConfigSpec } from "@/lib/tools/update-salla-config";
import { spec as toggleSallaFulfillmentSpec } from "@/lib/tools/toggle-salla-fulfillment";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `salla-integration-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-salla-integration");

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
  installSallaSpec,
  getSallaConnectionSpec,
  getSallaPlatformDataSpec,
  getSallaConfigSpec,
  updateSallaConfigSpec,
  toggleSallaFulfillmentSpec,
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

const task: ExperimentTask<SallaIntegrationInput, SallaIntegrationExpected> =
  async (item) => {
    const input = (item as { input?: SallaIntegrationInput }).input;
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
            "with Salla. Translate the merchant's question into the single " +
            "most appropriate Phase-2 Salla-family tool call. " +
            "Disambiguation: install/OAuth URL vs connection read vs LIVE " +
            "platform-data catalog vs SAVED config (with 404-as-null " +
            "semantics) vs UPSERT config vs fulfillment toggle. " +
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
  name: `phase2-salla-integration-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-2 Salla family on ` +
    `${MODEL}. ${items.length} hand-authored merchant questions, frozen ` +
    `TODAY=${TODAY}. Scored by tool-name-match, required-fields-present ` +
    "(per-tool rules), args-overlap, description-quality (per-tool " +
    "substring checklist), token-omission (STATIC source-inspection on " +
    "lib/tools/get-salla-connection.ts; T-02-29) and four-oh-four-as-null " +
    "(STATIC source-inspection on lib/tools/get-salla-config.ts; T-02-30).",
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
    { scoreName: "token-omission", min: 1.0 },
    { scoreName: "four-oh-four-as-null", min: 1.0 },
  ]);
}
