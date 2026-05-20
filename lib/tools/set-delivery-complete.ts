/**
 * `set_delivery_complete` (ORDT-08) — mark a batch of orders as
 * delivery complete via `PUT /quiqdash/orders/batch/set_delivery_complete`.
 *
 * Final happy-path terminal state. For non-happy-path terminals use
 * `set_delivery_failed` (ORDT-11, ships in Wave 2 with a `reason` field).
 *
 * Destructive contract lives entirely in
 * `lib/tools/_batch-transition-factory.ts`; this file is a single
 * `defineBatchTransition(...)` call per decision D-01.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_delivery_complete",
  path: "/quiqdash/orders/batch/set_delivery_complete",
  description:
    "Mark a batch of orders as delivery complete — final happy-path " +
    "terminal state. Use set_delivery_failed for non-happy-path terminals.",
});
