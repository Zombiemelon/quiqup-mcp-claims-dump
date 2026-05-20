/**
 * `find_order_by_id_or_barcode` — single-order lookup by clientOrderID or
 * parcel barcode with target-state-compatibility validation
 * (Phase 3 / ORDL-04).
 *
 * Endpoint: GET https://platform-api.quiqup.com/quiqdash/orders/find_by_id_or_barcode
 * Headers:  Authorization: Bearer <session-JWT> (Clerk → Quiqup actor-token bridge),
 *           Accept: application/json
 *
 * Query params (both REQUIRED):
 *   - value:     clientOrderID OR parcel barcode (upstream tries id then barcode)
 *   - intention: target-state intention used by the BE to validate the
 *                looked-up order is in a compatible source state. Modelled as
 *                free-form z.string() (T-03-19) because the BE may add new
 *                intentions over time; over-constraining the client would
 *                silently break new transitions. Observed values mirror the
 *                bulk-change-state set (see description below).
 *
 * Built via URLSearchParams (T-03-18 hygiene) — never string concatenation.
 *
 * Error semantics:
 *   - 200 with `error` populated → "no match" / "incompatible intention".
 *     This is the upstream's structured no-match contract, NOT an exception.
 *     The tool returns it as-is so the LLM can see the message.
 *   - 401 / 403 → auth issue (run `whoami_platform` to confirm the JWT
 *     resolves on platform-api).
 *   - 5xx → upstream temporarily unavailable; retry after a few seconds.
 *
 * When-to-use disambiguation:
 *   - SINGLE-order lookup before a bulk-change-state operation       → this tool.
 *   - Multi-order ID retrieval (the select-all flow)                 → `lookup_orders_ids`.
 *   - Full order detail without an intention check                   → `get_lastmile_order`.
 */

import { z } from "zod";
import type { ToolSpec } from "./register";
import { getQuiqupReadyJwt } from "@/lib/quiqup";
import { QuiqupHttpError } from "@/lib/clients/quiqup-lastmile";
import { environmentField, getPlatformApiBaseUrl } from "@/lib/clients/quiqup-env";

const inputSchema = z.object({
  value: z
    .string()
    .min(1)
    .describe(
      'Either a clientOrderID (e.g. "12345") or a parcel barcode (e.g. "QUI-AE-001-1"). The upstream tries the ID first then falls back to barcode — the `found_by` field in the response names which match path hit.',
    ),
  intention: z
    .string()
    .min(1)
    .describe(
      "Target-state intention. The BE uses this to validate the looked-up order is in a compatible source state for the named transition. Observed values: 'set_collected', 'set_received_at_depot', 'set_at_depot', 'set_in_transit', 'set_scheduled', 'set_delivery_complete', 'set_on_hold', 'set_return_to_origin', 'set_returned_to_origin', 'set_delivery_failed', 'set_collection_failed', 'set_ready_for_collection', 'set_cancelled'. Pass the intention that matches the operation you're about to perform.",
    ),
  environment: environmentField,
});

// Output is left loose — the order envelope is large and partner-shape
// dependent; passthrough keeps the contract loose while letting tests still
// .safeParse for sanity. `error` is populated when no match is found (the
// 200-with-error upstream contract — not an exception).
const outputSchema = z
  .object({
    error: z.string().optional(),
    found_by: z.string().optional(),
    order: z.object({}).passthrough().optional(),
  })
  .passthrough();

export const spec: ToolSpec<typeof inputSchema, typeof outputSchema> = {
  name: "find_order_by_id_or_barcode",
  description:
    "GET /quiqdash/orders/find_by_id_or_barcode (Platform API, platform-api.quiqup.com). " +
    "Single-order lookup that BOTH finds the order AND validates the named target-state " +
    "transition is legal on its current state. " +
    "Response shape: `{ error, found_by, order }`. `error` is populated (with status 200) " +
    "when found_by indicates no match or the intention is incompatible with the order's " +
    "current state. `found_by` names the match path: typically 'id', 'barcode', or 'uuid'. " +
    "`order` carries the full envelope: `allowed_payment_types[]`, `billing_identifier`, " +
    "`brand_name`, `collection_attempts`, `collection_time`, `created_at`, " +
    "`delivery_attempts`, `delivery_failure_reason`, `delivery_time`, `destination`, " +
    "`display_items_info`, `forward_order_id`, `forward_partner_order_id`, `id`, " +
    "`item_quantity_count`, `items[]`, `kind`, `last_event`, `on_hold_reason`, `origin`, " +
    "`partner_order_id`, `payment_amount`, `payment_mode`, `print_label`, `products[]`, " +
    "`reason`, `references[]`, `region_name`, `required_documents[]`, `return_order_id`, " +
    "`return_partner_order_id`, `return_to_origin_reason`, `scheduled_for`, " +
    "`service_kind`, `sku_info`, `state`, `state_updated_at`, `submitted_at`, " +
    "`tracking_url`, `uuid`, `weight_kg`. " +
    "When to use which: use this tool for a SINGLE-order lookup before a bulk-change-state " +
    "operation — it both finds the order AND validates the intended transition is legal on " +
    "its current state. For multi-order ID retrieval (the select-all flow), use " +
    "`lookup_orders_ids` instead. For full order detail without an intention check, use " +
    "`get_lastmile_order`. " +
    "Error modes: 401/403 → auth issue (run `whoami_platform`); 404 path is unused — the " +
    "BE returns 200 with `error` populated when no match is found (no exception is " +
    "thrown); 5xx → upstream temporarily unavailable, retry. " +
    'Example: `{ "value": "12345", "intention": "set_on_hold", "environment": "production" }`.',
  inputSchema,
  outputSchema,
  handler: async (auth, args) => {
    if (!auth.userId) {
      throw new Error("find_order_by_id_or_barcode requires an authenticated user");
    }

    const jwt = await getQuiqupReadyJwt(auth.userId);
    const platformApiBase = getPlatformApiBaseUrl(args.environment);

    const url = new URL(`${platformApiBase}/quiqdash/orders/find_by_id_or_barcode`);
    const params = new URLSearchParams({
      value: args.value,
      intention: args.intention,
    });
    url.search = params.toString();

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
