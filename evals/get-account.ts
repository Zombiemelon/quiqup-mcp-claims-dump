/**
 * Eval runner: get-account-v1 — Phase-1 Platform-read family.
 *
 * Hands each dataset item's natural-language merchant question to Claude
 * with the 6 Phase-1 read tools exposed (get_account, get_permissions,
 * get_account_capabilities, get_account_by_id, list_account_addresses,
 * whoami_platform) and scores the resulting tool_use block via
 * ./score-get-account.ts. Results stream to Langfuse as a trace per item
 * plus scores.
 *
 * Drift-proofing: tool descriptions are imported DIRECTLY from each
 * production `spec` (no inline copies). If a tool's description text
 * changes in lib/tools/*.ts, this eval automatically sees the new text on
 * the next run — there is no parallel string to maintain.
 *
 * Offline: does NOT hit the Quiqup API. Measures tool-pick quality plus
 * description-quality on the production spec text.
 *
 * Env vars (auto-loaded by bun from .env.local):
 *   LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL
 *   ANTHROPIC_API_KEY
 *
 * Dry-run: set EVAL_DRY_RUN=1 to print item count and exit (skips loading
 * the heavy OTel / Anthropic SDKs entirely).
 *
 * CI gate: set EVAL_GATE=1 to enforce args-overlap >= 0.8 and
 * description-quality >= 1.0 at the end.
 *
 * Run: `bun run eval:get-account`
 */

import {
  items,
  TODAY,
  type GetAccountInput,
  type GetAccountExpected,
} from "./datasets/get-account-v1";

// Production tool specs — imported statically so the Anthropic `tools`
// payload reads `spec.description` and `spec.inputSchema` from the live
// production source. No inline string copies = no drift surface (T-01-26
// in 01-04-PLAN.md's threat register).
import { spec as getAccountSpec } from "@/lib/tools/get-account";
import { spec as getPermissionsSpec } from "@/lib/tools/get-permissions";
import { spec as getAccountCapabilitiesSpec } from "@/lib/tools/get-account-capabilities";
import { spec as getAccountByIdSpec } from "@/lib/tools/get-account-by-id";
import { spec as listAccountAddressesSpec } from "@/lib/tools/list-account-addresses";
import { spec as whoamiPlatformSpec } from "@/lib/tools/whoami-platform";

if (process.env.EVAL_DRY_RUN === "1") {
  console.log(
    `get-account-v1 dry-run: ${items.length} items (TODAY=${TODAY})`,
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

const { evaluators } = await import("./score-get-account");

import type { ExperimentTask } from "@langfuse/client";

const MODEL = process.env.EVAL_MODEL ?? "claude-sonnet-4-6";

const otelSdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [new AnthropicInstrumentation()],
});
otelSdk.start();

const langfuse = new LangfuseClient();
const anthropic = new Anthropic();

// Build the Anthropic tool list from production specs directly — no inline
// description duplication, so the eval can never drift from the live tool.
// Each tool's input schema is serialised via z.toJSONSchema (the same path
// lastmile-order-creation.ts uses).
const specs = [
  getAccountSpec,
  getPermissionsSpec,
  getAccountCapabilitiesSpec,
  getAccountByIdSpec,
  listAccountAddressesSpec,
  whoamiPlatformSpec,
] as const;

const tools = specs.map((spec) => {
  const inputJsonSchema = z.toJSONSchema(spec.inputSchema, {
    target: "draft-07",
    io: "input",
  }) as Record<string, unknown>;
  // Pull description straight from the production `spec.description` — the
  // whole point of this drift-proofing approach.
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

const task: ExperimentTask<GetAccountInput, GetAccountExpected> = async (
  item,
) => {
  const input = (item as { input?: GetAccountInput }).input;
  if (!input?.request) {
    return { tool: null, args: null } satisfies TaskOutput;
  }
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    tools,
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content:
          "You are an operations assistant for a Quiqup partner (Dubai-based " +
          "merchant). Translate the merchant's question into the single most " +
          "appropriate Phase-1 Platform-read tool call. Disambiguation guide:\n" +
          "  - `get_account`             → read the signed-in partner's account profile.\n" +
          "  - `get_permissions`         → list permission scopes for the signed-in user.\n" +
          "  - `get_account_capabilities`→ capability flags (fulfillment_enabled, wms_setup_complete).\n" +
          "  - `get_account_by_id`       → resolve an account by Salesforce id (admin/impersonation).\n" +
          "  - `list_account_addresses`  → the address book (warehouses + dropoffs).\n" +
          "  - `whoami_platform`         → auth-vs-payload triage against /me (different endpoint).\n" +
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
  name: `phase1-platform-reads-v1 (${MODEL})`,
  description:
    `Offline tool-call quality baseline for the Phase-1 Platform-read family on ${MODEL}. ` +
    `${items.length} hand-authored merchant questions, frozen TODAY=${TODAY}. ` +
    "Scored by tool-name-match, required-fields-present (id on get_account_by_id), " +
    "args-overlap, and a static description-quality scorer that asserts the " +
    "disambiguation language locked in by the eval-driven-description-improvement loop.",
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
  ]);
}
