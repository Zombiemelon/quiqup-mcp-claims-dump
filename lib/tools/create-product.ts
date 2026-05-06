import { z } from "zod";
import type { ToolSpec } from "./register";

// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as createProductSpec } from "@/lib/tools/create-product";
// registerTool(server, createProductSpec);

// TODO(SLAVA_REVIEW): cassette + happy path NOT recorded. Both prod and
// staging fulfilment OAuth clients in the quiqup-api skill .env returned
// "Business account inactive — Product/Inventory operations are disabled"
// when probed during M3 (prod userId 00108000034d7PnAAI, staging
// 001P400000dKjozIAC). Need a merchant-scoped client with active product
// ops to record. Stub + input validation shipped; cassette, happy-path,
// output-schema, and error-mapping deferred until a product-capable
// client is provisioned.
//
// Required fields discovered empirically by POSTing a near-empty body and
// reading the 400 `details.fields[]`: { sku, name, selling_price, currency }.
// There may be additional optional fields (e.g. weight, dimensions, hs_code)
// — leaving the schema minimal-required for now and `passthrough()`-ing the
// rest until a successful cassette confirms the full surface.

const inputSchema = z.object({
  sku: z.string().min(1, "sku is required"),
  name: z.string().min(1, "name is required"),
  selling_price: z
    .number()
    .nonnegative("selling_price must be a non-negative number (in minor units, e.g. fils)"),
  currency: z.string().min(1, "currency is required (e.g. AED)"),
}).passthrough();

// Placeholder — fleshed out once cassette shape is known (blocked, see TODO above).
const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "create_product",
  description:
    "Create a new Quiqup Fulfilment product on platform-api.quiqup.com. " +
    "Requires sku, name, selling_price, currency.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error("not implemented");
  },
};
