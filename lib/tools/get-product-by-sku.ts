import { z } from "zod";
import type { ToolSpec } from "./register";

// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as getProductBySkuSpec } from "@/lib/tools/get-product-by-sku";
// registerTool(server, getProductBySkuSpec);

// TODO(SLAVA_REVIEW): cassette + happy path NOT recorded for this tool.
// During M3 recording, the only OAuth client available (default fulfilment
// prod creds in the quiqup-api skill .env) returned:
//   GET  /api/fulfilment/products/<sku> → 401 "role required for authorization"
//   POST /api/fulfilment/products       → 500 "Business account for user
//                                              00108000034d7PnAAI is inactive.
//                                              Product/Inventory operations
//                                              are disabled." (same on staging)
// Inventory list endpoint returns empty on both envs — no real SKU exists
// to probe with. Need either (a) a merchant client_id/_secret with active
// product ops scope, or (b) someone to enable Product/Inventory on the
// existing test merchant. Stub + input validation shipped; cassette,
// happy-path, output-schema, and error-mapping remain TODO once a
// product-capable client is provisioned.

// SKU is treated as an opaque string at the input boundary because URL path
// components are always strings. Quiqup product SKUs are merchant-defined
// strings (alphanumeric, may include dashes) — see references/endpoints.md.
const inputSchema = z.object({
  sku: z.string().min(1, "sku is required"),
});

// Placeholder — fleshed out once cassette shape is known (blocked, see TODO above).
const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_product_by_sku",
  description:
    "Fetch a single Quiqup Fulfilment product by SKU from platform-api.quiqup.com.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error("not implemented");
  },
};
