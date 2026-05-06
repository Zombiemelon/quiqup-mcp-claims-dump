import { z } from "zod";
import type { ToolSpec } from "./register";

// Per skill SKILL.md guardrails: stock adjustments are always sensitive,
// regardless of sign or magnitude. Disabled pending M6 because the cost of
// a mistake (zeroing out a real merchant's inventory) is high and there's
// no LLM-callable confirmation pattern yet.

const inputSchema = z.object({
  sku: z.string().min(1, "sku is required"),
  bucket: z.string().min(1, "bucket is required (e.g. sellable, damaged, reserved)"),
  delta: z.number(),
  reason: z.string().min(1, "reason is required for audit"),
}).passthrough();

const outputSchema = z.object({}).passthrough();

// TODO(M6): enable when scope/audit/idempotency guardrails ship
export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "adjust_stock",
  description:
    "Adjust stock levels for a Quiqup Fulfilment SKU + bucket (POST /api/fulfilment/inventory/adjustments). CURRENTLY DISABLED pending M6 guardrails — inventory writes are always sensitive, including zeros and small deltas, and require audit + scope checks before LLM exposure.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error(
      "Tool registered but disabled pending M6 guardrails (multi-tenant scope, " +
      "rate limit, audit log, idempotency). See TODO(M6) markers in lib/tools/register.ts.",
    );
  },
};
