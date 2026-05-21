/**
 * `set_return_to_origin` (ORDT-10) — start the return-to-origin process
 * for a batch of orders via `PUT /quiqdash/orders/batch/set_return_to_origin`
 * with a REQUIRED `reason`.
 *
 * Exception-path lifecycle step: orders that cannot be delivered transition
 * to the in-progress return-to-origin state. Pair with `set_returned_to_origin`
 * (ORDT-11) which is the terminal acknowledgement once the return is complete.
 *
 * Reason field is free-form per decision D-02; description names
 * `list_return_to_origin_reasons` (Phase-1 ORDL-10) as the canonical
 * enumeration tool. The destructive gate + scope assertion + dry-run +
 * guardrails are all owned by the factory.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_return_to_origin",
  path: "/quiqdash/orders/batch/set_return_to_origin",
  description:
    "Start the return-to-origin process for a batch of orders — moves them " +
    "into the in-progress return state. Up to 10 orders per call. Distinct " +
    "from `set_returned_to_origin` which is the terminal acknowledgement " +
    "once the return is complete.",
  reasonField: {
    description:
      "Reason code for returning orders to origin. Call " +
      "`list_return_to_origin_reasons` (ORDL-10) to discover valid values.",
  },
});
