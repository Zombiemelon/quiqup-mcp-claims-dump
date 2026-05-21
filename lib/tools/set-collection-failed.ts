/**
 * `set_collection_failed` (ORDT-13) — mark a batch of orders as
 * collection-failed via `PUT /quiqdash/courier/orders/set_collection_failed`
 * with a REQUIRED `reason`.
 *
 * Exception-path lifecycle step: courier was unable to complete the
 * collection from the partner. Per REQ ORDT-13 the upstream path root
 * is DIFFERENT from the other batch transitions:
 *   - other batch tools: PUT /quiqdash/orders/batch/{transition}
 *   - this tool:         PUT /quiqdash/courier/orders/set_collection_failed
 *
 * Per upstream, collection failures share the courier-failure taxonomy
 * with delivery failures, so both reason-bearing tools call
 * `list_courier_failure_reasons` (Phase-1 ORDL-12) to discover valid
 * values.
 *
 * Distinct from the legacy `set_collection_failed_batch` STAGING-ONLY
 * helper in `lib/tools/set-collection-failed-batch.ts` — that tool uses
 * the api-ae REST root with both failure_reason_uid AND failure_reason
 * keys, talks to the Last-Mile cluster, and is pinned to staging. This
 * Phase-4 tool talks to platform-api, takes a single free-form `reason`,
 * and runs against production by default.
 *
 * All destructive semantics owned by the factory.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_collection_failed",
  path: "/quiqdash/courier/orders/set_collection_failed",
  description:
    "Mark a batch of orders as collection-failed — the courier was unable " +
    "to complete the collection from the partner. Up to 10 orders per " +
    "call. Requires a courier-failure reason code (discoverable via " +
    "`list_courier_failure_reasons`). Note: this tool's upstream path is " +
    "DIFFERENT from the other batch transitions — `/quiqdash/courier/" +
    "orders/set_collection_failed` instead of `/quiqdash/orders/batch/...`.",
  reasonField: {
    description:
      "Reason code for the collection failure. Call " +
      "`list_courier_failure_reasons` (ORDL-12) to discover valid values " +
      "(collection failures use the same courier-failure taxonomy as " +
      "delivery failures per upstream).",
  },
});
