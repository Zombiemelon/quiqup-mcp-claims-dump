/**
 * `set_returned_to_origin` (ORDT-11) — acknowledge that a batch of orders
 * has completed its return-to-origin via
 * `PUT /quiqdash/orders/batch/set_returned_to_origin`.
 *
 * Terminal exception-path lifecycle step: distinct from `set_return_to_origin`
 * (ORDT-10) which is the IN-PROGRESS transition. This tool has NO reason
 * field — it's a pure terminal acknowledgement.
 *
 * Same destructive gate + scope assertion + dry-run + guardrails as the
 * forward-path Wave-1 tools, just on a different path. All semantics
 * owned by the factory.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_returned_to_origin",
  path: "/quiqdash/orders/batch/set_returned_to_origin",
  description:
    "Mark a batch of orders as returned to origin — terminal state " +
    "acknowledging the return-to-origin completion. Different from " +
    "`set_return_to_origin` which is the IN-PROGRESS transition. Up to " +
    "10 orders per call.",
});
