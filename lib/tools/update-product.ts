import { z } from "zod";
import type { ToolSpec } from "./register";

// ROUTE-REGISTRATION REMINDER (for human merger):
// import { spec as updateProductSpec } from "@/lib/tools/update-product";
// registerTool(server, updateProductSpec);

// TODO(SLAVA_REVIEW): cassette + happy path NOT recorded. Same blocker as
// get_product_by_sku and create_product — the available fulfilment OAuth
// clients return "Business account inactive — Product/Inventory operations
// are disabled" (prod userId 00108000034d7PnAAI, staging 001P400000dKjozIAC).
// Stub + input validation shipped; cassette, happy-path, output-schema, and
// error-mapping deferred until a product-capable merchant client lands.

// PATCH semantics: caller passes a `patch` object containing only the fields
// they want to change. We require at least one key to avoid round-tripping
// no-ops to the API. Field names mirror the create_product surface; we
// passthrough() the rest until cassette confirms the full mutable subset.
const inputSchema = z.object({
  sku: z.string().min(1, "sku is required"),
  patch: z
    .object({
      name: z.string().min(1).optional(),
      selling_price: z.number().nonnegative().optional(),
      currency: z.string().min(1).optional(),
    })
    .passthrough()
    .refine(
      (obj) => Object.keys(obj).length > 0,
      { message: "patch must contain at least one field to update" },
    ),
});

// Placeholder — fleshed out once cassette shape is known (blocked, see TODO above).
const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "update_product",
  description:
    "Update an existing Quiqup Fulfilment product (PATCH) by SKU on " +
    "platform-api.quiqup.com. Pass changed fields under `patch`.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error("not implemented");
  },
};
