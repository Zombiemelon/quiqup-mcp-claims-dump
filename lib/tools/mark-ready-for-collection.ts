// TODO(M6): enable when scope/audit/idempotency guardrails ship
//
// This tool is REGISTERED but DISABLED at M3. The handler permanently
// throws — the point is for `tools/list` to advertise the surface so
// clients know this capability exists, while making it impossible for an
// LLM to invoke it before M6 ships:
//   - multi-tenant scope enforcement
//   - rate limit (one per minute or so per user)
//   - audit log (every call recorded with userId, orgId, args)
//   - idempotency (Quiqup re-dispatch on retry would double-bill)
//
// Why this endpoint is the most-dangerous of the writer set: it transitions
// the order from `pending` (cancellable, free) into the live dispatch
// pipeline. From the moment Quiqup picks up the parcel there's real money
// + SLA on the line. References: lastmile.md guardrail-mapping section
// flags it as "irreversible-ish — guardrailed". Never let an LLM call this
// without scope check + explicit confirmation + audit trail.
//
// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as markReadyForCollectionSpec } from "@/lib/tools/mark-ready-for-collection";
// registerTool(server, markReadyForCollectionSpec);

import { z } from "zod";
import type { ToolSpec } from "./register";

const inputSchema = z.object({
  order_id: z
    .string()
    .min(1, "order_id is required")
    .describe(
      "Quiqup Last-Mile order ID (string). Order must be in `pending` state. After this call the order enters dispatch and can no longer be cancelled freely.",
    ),
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "mark_ready_for_collection",
  description:
    "Mark a pending Quiqup Last-Mile order ready for collection (PUT /orders/{order_id}/ready_for_collection). DISABLED-PENDING-M6: irreversible-ish, triggers Quiqup dispatch and creates billable work — re-enabled only after scope + rate-limit + audit + idempotency guardrails ship.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error(
      "Tool registered but disabled pending M6 guardrails (multi-tenant scope, " +
        "rate limit, audit log, idempotency). See [[multi-tenant-scope-leakage]] " +
        "and TODO(M6) markers in lib/tools/register.ts.",
    );
  },
};
