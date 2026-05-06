import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupFulfilmentClient } from "@/lib/clients/quiqup-fulfilment";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

// TODO(M4): no cassette, no output schema, no error mapping.
const inputSchema = z.object({});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "list_inbound_slots",
  description:
    "List available booking slots for inbound deliveries to Quiqup warehouses. Used as input to book_inbound_slot (currently disabled pending M6 guardrails).",
  inputSchema,
  outputSchema,
  handler: async (auth) => {
    if (!auth.userId) throw new Error("list_inbound_slots requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupFulfilmentClient({ jwt });
    const data = await client.request("GET", "/api/fulfilment/slots/available");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  },
};
