import { z } from "zod";
import type { ToolSpec } from "./register";

// Per references/endpoints.md + skill SKILL.md: booking moves real warehouse
// capacity. Slot is a finite resource — overbooking has cascade effects.
// Disabled pending M6 (scope to confirm, audit, idempotency).

const inputSchema = z.object({
  slot_id: z.string().min(1, "slot_id is required (from list_inbound_slots)"),
}).passthrough();

const outputSchema = z.object({}).passthrough();

// TODO(M6): enable when scope/audit/idempotency guardrails ship
export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "book_inbound_slot",
  description:
    "Book an inbound delivery slot at a Quiqup warehouse. CURRENTLY DISABLED pending M6 guardrails — booking consumes real warehouse capacity; overbooking has cascade effects on other merchants. Use list_inbound_slots to see availability without committing.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error(
      "Tool registered but disabled pending M6 guardrails (multi-tenant scope, " +
      "rate limit, audit log, idempotency). See TODO(M6) markers in lib/tools/register.ts.",
    );
  },
};
