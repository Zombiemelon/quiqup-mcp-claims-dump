import { z } from "zod";
import type { ToolSpec } from "./register";

// Per references/lastmile.md: cancellation + batch — guardrailed,
// confirm per batch (≤10 orders). Per skill SKILL.md guardrails:
// destructive surface that an LLM agent must not call without M6
// scope+audit+idempotency in place.

const inputSchema = z.object({
  order_ids: z.array(z.string().min(1)).min(1).max(10),
});

const outputSchema = z.object({}).passthrough();

// TODO(M6): enable when scope/audit/idempotency guardrails ship
export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "cancel_lastmile_orders_batch",
  description:
    "Cancel one or more pending Quiqup Last-Mile orders in a single batch. CURRENTLY DISABLED pending M6 guardrails (multi-tenant scope, audit log, idempotency). Will be enabled with confirmation gates per batch.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error(
      "Tool registered but disabled pending M6 guardrails (multi-tenant scope, " +
      "rate limit, audit log, idempotency). See TODO(M6) markers in lib/tools/register.ts.",
    );
  },
};
