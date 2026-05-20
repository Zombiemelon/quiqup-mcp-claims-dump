/**
 * `set_scheduled` (ORDT-07) — mark a batch of orders as scheduled for
 * delivery via `PUT /quiqdash/orders/batch/set_scheduled`.
 *
 * Lifecycle step: orders have been assigned a delivery slot but are NOT
 * yet out for delivery. This is the planning state — the courier
 * knows when to deliver but hasn't started the run.
 *
 * Destructive contract lives entirely in
 * `lib/tools/_batch-transition-factory.ts`; this file is a single
 * `defineBatchTransition(...)` call per decision D-01.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_scheduled",
  path: "/quiqdash/orders/batch/set_scheduled",
  description:
    "Mark a batch of orders as scheduled for delivery — assigned a " +
    "delivery slot but not yet out for delivery.",
});
