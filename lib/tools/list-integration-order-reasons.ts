/**
 * `list_integration_order_reasons` — read the recently-failed
 * integration-order triage table from platform-api.quiqup.com
 * (Phase 2 / INTG-03).
 *
 * Endpoint: GET https://platform-api.quiqup.com/integrations/order-reasons
 * Headers:  Authorization: Bearer <session-JWT> (Clerk → Quiqup actor-token bridge),
 *           Accept: application/json
 *
 * Per source-doc lines 1102-1141 the endpoint takes 7 REQUIRED query params:
 *   sales_channel, status, start_date, end_date, user_id, limit, offset
 * Built into the URL via `URLSearchParams` (T-02-03: avoids query-string
 * injection via deterministic percent-encoding).
 *
 * Response shape (per source-doc, authoritative):
 *   {
 *     limit: number,
 *     offset: number,
 *     total: number,
 *     reasons: Array<{
 *       id: number,
 *       order_id: string,
 *       order_number: string,
 *       fulfillment_order_id: string,
 *       sales_channel: string,
 *       reason: string,
 *       status: string,
 *       attempts: number,
 *       last_attempt_at: string /* date-time *\/,
 *       shop_name: string,
 *       site_url: string,
 *       details: string,
 *       location: string,
 *       shipping_method: string,
 *       submitted_at: string,
 *       created_at: string,
 *       updated_at: string,
 *       user_id: string,
 *     }>,
 *   }
 *
 * Error modes:
 *   - 401 / 403 → auth issue (run `whoami_platform`).
 *   - 422       → validation failure (inspect body — likely bad date range).
 *   - 5xx       → upstream temporarily unavailable, retry.
 */

import { z } from "zod";
import type { ToolSpec } from "./register";
import { getQuiqupReadyJwt } from "@/lib/quiqup";
import { QuiqupHttpError } from "@/lib/clients/quiqup-lastmile";
import { environmentField, getPlatformApiBaseUrl } from "@/lib/clients/quiqup-env";

const inputSchema = z.object({
  sales_channel: z
    .string()
    .min(1)
    .describe(
      "Source channel filter, e.g. 'shopify', 'woocommerce', 'salla'.",
    ),
  status: z
    .string()
    .min(1)
    .describe(
      "Order-reason status filter; common values: 'pending', 'failed', 'resolved'.",
    ),
  start_date: z
    .string()
    .describe(
      "ISO-8601 date-time inclusive lower bound, e.g. 2026-05-01T00:00:00Z.",
    ),
  end_date: z
    .string()
    .describe("ISO-8601 date-time exclusive upper bound."),
  user_id: z
    .string()
    .min(1)
    .describe(
      "Partner user id — use the value returned by `get_account` if you " +
        "don't already have it.",
    ),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  environment: environmentField,
});

const outputSchema = z.object({}).passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "list_integration_order_reasons",
  description:
    "List recently-failed integration orders (with their failure reasons) " +
    "via GET /integrations/order-reasons on platform-api.quiqup.com. " +
    "This is the triage table for the Shopify/WooCommerce/Salla failure " +
    "queue — pair it with `repair_integration_orders` to retry the listed " +
    "failures, and with `get_integration_order` to inspect a single " +
    "envelope post-repair. " +
    "Response shape: `{ limit, offset, total, reasons: [{ id, order_id, " +
    "order_number, fulfillment_order_id, sales_channel, reason, status, " +
    "attempts, last_attempt_at, shop_name, site_url, ... }] }`. The " +
    "`attempts` field is the count of retry attempts already made — agents " +
    "should bias toward repairing orders with low attempts first. " +
    "All 7 filter args are REQUIRED upstream (sales_channel, status, " +
    "start_date, end_date, user_id, limit, offset). `limit` is capped at " +
    "200 client-side to bound response size. " +
    "Error modes: 401/403 → auth issue (run `whoami_platform`); 422 → " +
    "validation failure (likely bad date format — must be ISO-8601 " +
    "date-time); 5xx → upstream temporarily unavailable, retry. " +
    'Example: `{ "sales_channel": "shopify", "status": "failed", ' +
    '"start_date": "2026-05-01T00:00:00Z", "end_date": ' +
    '"2026-05-19T00:00:00Z", "user_id": "u_123", "limit": 50, "offset": 0 }`.',
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) {
      throw new Error(
        "list_integration_order_reasons requires an authenticated user",
      );
    }

    const jwt = await getQuiqupReadyJwt(auth.userId);
    const platformApiBase = getPlatformApiBaseUrl(args.environment);

    // Defaults applied for limit/offset (Zod .default()) — but z.input typing
    // surfaces them as possibly-undefined on the handler args. Fall back
    // explicitly so URLSearchParams never receives the literal string
    // "undefined".
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;

    const url = new URL(`${platformApiBase}/integrations/order-reasons`);
    url.searchParams.set("sales_channel", args.sales_channel);
    url.searchParams.set("status", args.status);
    url.searchParams.set("start_date", args.start_date);
    url.searchParams.set("end_date", args.end_date);
    url.searchParams.set("user_id", args.user_id);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new QuiqupHttpError(res.status, await res.text());
    }

    const data = await res.json();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  },
};
