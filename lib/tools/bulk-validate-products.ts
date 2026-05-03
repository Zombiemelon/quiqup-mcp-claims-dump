// TODO(M6): enable when scope/audit/idempotency guardrails ship
import { z } from "zod";
import type { ToolSpec } from "./register";

// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as bulkValidateProductsSpec } from "@/lib/tools/bulk-validate-products";
// registerTool(server, bulkValidateProductsSpec);
//
// Per [[quiqup-mcp-spec]] M6: bulk product surfaces are deferred because
// they're hard to scope per-merchant and the validate→commit two-phase shape
// needs deliberate idempotency + audit-log + rate-limit guardrails before
// being callable. Tool is registered (so it shows up in tools/list for
// surface-coverage) but the handler permanently throws.

const inputSchema = z.object({
  // CSV uploaded as base64 — the MCP transport doesn't have a native file
  // upload primitive, so the canonical shape is base64 + filename.
  file_base64: z.string().min(1, "file_base64 is required"),
  filename: z.string().min(1, "filename is required"),
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "bulk_validate_products",
  description:
    "Phase 1 of the two-phase bulk product upload: validates a CSV and " +
    "returns an upload_id for later commit. Currently DISABLED pending M6.",
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
