import { z } from "zod";
import type { ToolSpec } from "./register";

// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as getProductBySkuSpec } from "@/lib/tools/get-product-by-sku";
// registerTool(server, getProductBySkuSpec);

// SKU is treated as an opaque string at the input boundary because URL path
// components are always strings. Quiqup product SKUs are merchant-defined
// strings (alphanumeric, may include dashes) — see references/endpoints.md.
const inputSchema = z.object({
  sku: z.string().min(1, "sku is required"),
});

// Placeholder — fleshed out in T7/T8 once cassette shape is known.
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
