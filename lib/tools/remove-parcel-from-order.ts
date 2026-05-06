import { z } from "zod";
import type { ToolSpec } from "./register";

// Per references/lastmile.md: DELETE — guardrailed. Cannot remove the last
// parcel. Per skill SKILL.md guardrails: any DELETE is dangerous;
// destructive surface that an LLM must not call without M6 in place.

const inputSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
  parcel_id: z.string().min(1, "parcel_id is required"),
});

const outputSchema = z.object({}).passthrough();

// TODO(M6): enable when scope/audit/idempotency guardrails ship
export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "remove_parcel_from_order",
  description:
    "Remove a parcel from a Quiqup Last-Mile order (DELETE). CURRENTLY DISABLED pending M6 guardrails. Note: cannot remove the last parcel of an order.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error(
      "Tool registered but disabled pending M6 guardrails (multi-tenant scope, " +
      "rate limit, audit log, idempotency). See TODO(M6) markers in lib/tools/register.ts.",
    );
  },
};
