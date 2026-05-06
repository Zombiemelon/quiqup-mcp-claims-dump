import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupFulfilmentClient } from "@/lib/clients/quiqup-fulfilment";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

// TODO(M4): no cassette, no output schema, no error mapping.
const inputSchema = z.object({
  batch_id: z.string().min(1, "batch_id is required"),
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_batch",
  description:
    "Fetch detail for a single Quiqup Fulfilment inventory batch by batch ID. Includes lot, expiry, received date, and per-bucket stock breakdown.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) throw new Error("get_batch requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupFulfilmentClient({ jwt });
    const data = await client.request(
      "GET",
      `/api/fulfilment/batches/${encodeURIComponent(args.batch_id)}`,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  },
};
