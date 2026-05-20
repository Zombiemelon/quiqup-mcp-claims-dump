/**
 * `set_received_at_depot` (ORDT-04) — mark a batch of collected orders
 * as received at the depot via
 * `PUT /quiqdash/orders/batch/set_received_at_depot`.
 *
 * Lifecycle distinction: `received_at_depot` is the FIRST scan when
 * orders physically arrive at the sorting hub. `set_at_depot` is the
 * sustained state after that — see `set-at-depot.ts`.
 *
 * Destructive contract lives entirely in
 * `lib/tools/_batch-transition-factory.ts`; this file is a single
 * `defineBatchTransition(...)` call per decision D-01.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_received_at_depot",
  path: "/quiqdash/orders/batch/set_received_at_depot",
  description:
    "Mark a batch of collected orders as received at the depot — confirms " +
    "physical receipt at the sorting hub.",
});
