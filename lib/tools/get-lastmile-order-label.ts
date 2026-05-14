import { z } from "zod";
import type { ToolSpec } from "./register";
import { QuiqupLastmileClient } from "@/lib/clients/quiqup-lastmile";
import { getQuiqupReadyJwt } from "@/lib/quiqup";

// 2026-05-14 — switched from a single text block (which wrapped a 28KB
// base64 PDF in JSON-stringified text and made client LLMs burn turns
// trying to decode it through bash heredocs) to MCP's hybrid
// text+resource content shape. The text block summarises the result for
// the model; the resource block carries the PDF as a binary blob the
// host extracts without the bytes ever entering model context. Design
// doc: docs/design/get-lastmile-order-label-api.md.
//
// PDF body contains customer PII (name, address on the AWB). Flagged for
// audit-log redaction at M6.
const inputSchema = z.object({
  order_id: z.string().min(1, "order_id is required"),
});

// The upstream non-JSON branch in QuiqupLastmileClient.request returns
// { contentType, base64 }. Output schema reflects that thin shape; runtime
// shape of the MCP tool result (text + resource blocks) is asserted by
// tests/get-lastmile-order-label.test.ts since the M3 wrapper doesn't yet
// enforce outputSchema at runtime (TODO M4).
const outputSchema = z
  .object({
    contentType: z.string().optional(),
    base64: z.string().optional(),
  })
  .passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "get_lastmile_order_label",
  description:
    "Download the AWB (airway bill) label PDF for a Quiqup Last-Mile order. " +
    "Returns a short text summary plus a `resource` content block with the PDF " +
    "bytes (mimeType: application/pdf, blob: base64). The MCP host extracts the " +
    "resource directly — do NOT attempt to decode the base64 yourself or pipe it " +
    "through shell tools; just acknowledge the resource was retrieved. The PDF " +
    "body contains the customer name and shipping address as printed on the label.",
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId)
      throw new Error("get_lastmile_order_label requires an authenticated user");
    const jwt = await getQuiqupReadyJwt(auth.userId);
    const client = new QuiqupLastmileClient({ jwt });
    const data = (await client.request(
      "GET",
      `/order_label/${encodeURIComponent(args.order_id)}`,
    )) as { contentType?: string; base64?: string } | null;

    if (!data?.base64) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Label unavailable for order ${args.order_id}: upstream returned no PDF body.`,
          },
        ],
        isError: true,
      };
    }

    const rawContentType = data.contentType?.split(";")[0]?.trim() ?? "";
    if (rawContentType && !rawContentType.startsWith("application/pdf")) {
      // Upstream returned non-PDF bytes (e.g. an HTML error page with 200
      // from an edge). Surface as a tool error rather than letting the LLM
      // try to make sense of garbage.
      return {
        content: [
          {
            type: "text" as const,
            text: `Unexpected content type "${rawContentType}" from upstream label endpoint for order ${args.order_id}; refusing to forward the body.`,
          },
        ],
        isError: true,
      };
    }

    const mimeType = rawContentType || "application/pdf";
    const bytes = Math.floor((data.base64.length * 3) / 4);
    const uri = `quiqup-lastmile://order_label/${encodeURIComponent(args.order_id)}.pdf`;

    return {
      content: [
        {
          type: "text" as const,
          text: `Retrieved AWB label PDF for order_id=${args.order_id} (${mimeType}, ~${bytes} bytes). Bytes attached as a resource block; do not attempt to decode them yourself.`,
        },
        {
          type: "resource" as const,
          resource: { uri, mimeType, blob: data.base64 },
        },
      ],
    };
  },
};
