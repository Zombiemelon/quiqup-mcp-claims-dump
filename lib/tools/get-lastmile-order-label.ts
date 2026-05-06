import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupLastmileClient } from "@/lib/clients/quiqup-lastmile";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

// TODO(M4): no cassette, no output schema, no error mapping. M3 thin
// pass-through per Slava's hybrid speed call (2026-05-03). Returns base64-
// encoded PDF; LLM clients can decode for download or OCR. PDF body may
// contain customer PII (name, address printed on AWB) — flag for redaction
// at M4 if exposing to non-merchant LLMs.
const inputSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
});

const outputSchema = z.object({
  contentType: z.string().optional(),
  base64: z.string().optional(),
}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_lastmile_order_label",
  description:
    "Download the AWB (airway bill) label PDF for a Quiqup Last-Mile order. Returns the PDF as base64-encoded bytes plus content type. Note: the PDF body contains the customer name and shipping address as printed on the label.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) throw new Error("get_lastmile_order_label requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupLastmileClient({ jwt });
    const data = await client.request(
      "GET",
      `/order_label/${encodeURIComponent(args.order_id)}`,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  },
};
