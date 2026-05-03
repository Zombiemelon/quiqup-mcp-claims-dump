import { z } from "zod";
import type { ToolSpec } from "./register";

// `order_id` is a string at the input boundary because URL path components
// are always strings — even though the Quiqup response shape carries `id`
// as a number (see lib/tools/recent-orders.ts). The handler will ToString
// any LLM-supplied number before constructing the URL. Don't "fix" the
// type to z.union([number, string]) — it muddles the contract.
// Flagged in 2026-05-03 review.
const inputSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
});

// Placeholder — fleshed out in T4.2 once cassette shape is known.
const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_lastmile_order",
  description:
    "Fetch a single Quiqup Last-Mile order by ID from api.quiqup.com.",
  inputSchema,
  outputSchema,
  handler: async () => {
    throw new Error("not implemented");
  },
};
