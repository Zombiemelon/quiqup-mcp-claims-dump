import { z } from "zod";
import type { ToolSpec } from "./register";

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
