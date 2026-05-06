import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupLastmileClient } from "@/lib/clients/quiqup-lastmile";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

// TODO(M4): no cassette, no output schema, no error mapping. M3 thin
// pass-through per Slava's hybrid speed call (2026-05-03).
// New orders land in `pending` state; they only dispatch when
// mark_ready_for_collection is called (currently disabled-pending-M6).
// So creating an order via this tool is reversible until ready_for_collection.
const inputSchema = z.object({
  // Minimal known-required surface; the full request body is
  // documented in references/lastmile.md. Passthrough lets callers
  // include items, payment_mode, references, etc. without an exhaustive
  // schema.
}).passthrough();

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "create_lastmile_order",
  description:
    "Create a new Quiqup Last-Mile order. Lands in `pending` state; does NOT dispatch until mark_ready_for_collection is called separately. Pass the order body (origin, destination, items, payment_mode, references, etc.) — see Quiqup last-mile API docs for the full schema.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) throw new Error("create_lastmile_order requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupLastmileClient({ jwt });
    const data = await client.request("POST", "/orders", { body: args });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  },
};
