// TODO(M6): enable when scope/audit/idempotency guardrails ship
import { z } from "zod";
import type { ToolSpec } from "./register";

// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as bulkCommitProductsSpec } from "@/lib/tools/bulk-commit-products";
// registerTool(server, bulkCommitProductsSpec);
//
// Per [[quiqup-mcp-spec]] M6: phase 2 of the bulk product upload, paired with
// bulk_validate_products. Disabled pending M6 guardrails for the same
// reasons (multi-tenant scope leakage, idempotency on a destructive bulk
// write, audit log).

const inputSchema = z.object({
  upload_id: z.string().min(1, "upload_id is required (returned by bulk_validate_products)"),
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "bulk_commit_products",
  description:
    "Phase 2 of the two-phase bulk product upload: commits an upload_id " +
    "previously returned by bulk_validate_products. Currently DISABLED " +
    "pending M6.",
  inputSchema,
  outputSchema,
  // TODO(M6): enable when scope/audit/idempotency guardrails ship
  handler: async () => {
    throw new Error(
      "Tool registered but disabled pending M6 guardrails (multi-tenant scope, " +
      "rate limit, audit log, idempotency). See [[multi-tenant-scope-leakage]] " +
      "and TODO(M6) markers in lib/tools/register.ts.",
    );
  },
};
