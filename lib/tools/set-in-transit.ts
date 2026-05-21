/**
 * `set_in_transit` (ORDT-06) — mark a batch of orders as in transit via
 * `PUT /quiqdash/orders/batch/set_in_transit`.
 *
 * Lifecycle step: orders have left the depot toward final delivery
 * (en route, on the courier's vehicle, not yet delivered).
 *
 * Destructive contract lives entirely in
 * `lib/tools/_batch-transition-factory.ts`; this file is a single
 * `defineBatchTransition(...)` call per decision D-01.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_in_transit",
  path: "/quiqdash/orders/batch/set_in_transit",
  description:
    "Mark a batch of orders as in transit — orders have left the depot " +
    "toward final delivery.",
});
