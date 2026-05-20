/**
 * `set_at_depot` (ORDT-05) — mark a batch of orders as currently at the
 * depot via `PUT /quiqdash/orders/batch/set_at_depot`.
 *
 * Lifecycle distinction (vs `set_received_at_depot`): `received_at_depot`
 * is the first scan; `at_depot` is the sustained state after that.
 * Some orders may skip the `received_at_depot` step if their workflow
 * starts at the depot directly.
 *
 * Destructive contract lives entirely in
 * `lib/tools/_batch-transition-factory.ts`; this file is a single
 * `defineBatchTransition(...)` call per decision D-01.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_at_depot",
  path: "/quiqdash/orders/batch/set_at_depot",
  description:
    "Mark a batch of orders as currently at the depot — distinct from " +
    "received_at_depot in lifecycle ordering; received_at_depot is the " +
    "first scan, at_depot is the sustained state.",
});
