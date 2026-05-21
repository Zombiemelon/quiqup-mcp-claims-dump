/**
 * `set_delivery_failed` (ORDT-12) — mark a batch of orders as
 * delivery-failed via `PUT /quiqdash/orders/batch/set_delivery_failed`
 * with a REQUIRED `reason`.
 *
 * Exception-path lifecycle step: courier was unable to complete the
 * delivery. Per upstream, delivery failures share the courier-failure
 * taxonomy with collection failures — both reason-bearing tools call
 * `list_courier_failure_reasons` (Phase-1 ORDL-12) to discover valid
 * values.
 *
 * Distinct from the legacy `set_delivery_failed_batch` STAGING-ONLY
 * helper in `lib/tools/set-delivery-failed-batch.ts` — that tool uses
 * the api-ae REST root with both failure_reason_uid AND failure_reason
 * keys, talks to the Last-Mile cluster, and is pinned to staging. This
 * Phase-4 tool talks to platform-api at `/quiqdash/...`, takes a single
 * free-form `reason`, and runs against production by default.
 *
 * All destructive semantics owned by the factory.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_delivery_failed",
  path: "/quiqdash/orders/batch/set_delivery_failed",
  description:
    "Mark a batch of orders as delivery-failed — the courier was unable " +
    "to complete the delivery. Up to 10 orders per call. Requires a " +
    "courier-failure reason code (discoverable via " +
    "`list_courier_failure_reasons`).",
  reasonField: {
    description:
      "Reason code for the delivery failure. Call " +
      "`list_courier_failure_reasons` (ORDL-12) to discover valid values.",
  },
});
