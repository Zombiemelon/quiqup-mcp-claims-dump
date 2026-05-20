/**
 * `set_collected` (ORDT-03) — mark a batch of orders as collected from
 * the partner via `PUT /quiqdash/orders/batch/set_collected`.
 *
 * Forward-path lifecycle step: orders move from `awaiting_collection`
 * to `collected`. Up to 10 orders per call.
 *
 * The destructive gate, scope-assertion loop, dry-run shape, and
 * guardrails block all live in the factory at
 * `lib/tools/_batch-transition-factory.ts`. This file is intentionally
 * a single `defineBatchTransition(...)` call — see decision D-01 in
 * `.planning/phases/04-orders-write-path-lifecycle/04-CONTEXT.md`.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_collected",
  path: "/quiqdash/orders/batch/set_collected",
  description:
    "Mark a batch of orders as collected from the partner — moves them " +
    "from awaiting-collection to collected state. Up to 10 orders per call.",
});
