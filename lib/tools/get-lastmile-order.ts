import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupLastmileClient } from "@/lib/clients/quiqup-lastmile";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

// `order_id` is a string at the input boundary because URL path components
// are always strings — even though the Quiqup response shape carries `id`
// as a number (see lib/tools/recent-orders.ts). The handler will ToString
// any LLM-supplied number before constructing the URL. Don't "fix" the
// type to z.union([number, string]) — it muddles the contract.
// Flagged in 2026-05-03 review.
const inputSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
});

// Placeholder — fleshed out at T4.2 once cassette shape is known.
const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_lastmile_order",
  description:
    "Fetch a single Quiqup Last-Mile order by ID from api-ae.quiqup.com.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) {
      throw new Error("get_lastmile_order requires an authenticated user");
    }

    // V3b same-IdP exchange: mint a Quiqup-shaped JWT from the Clerk userId
    // (mocked in tests via vi.mock("@/lib/quiqup")).
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupLastmileClient({ jwt });
    const response = (await client.getOrder(args.order_id)) as { order: unknown };

    // Quiqup returns `{order: {...}}`; unwrap for the MCP content payload.
    const order = response.order;
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(order, null, 2) },
      ],
    };
  },
};
