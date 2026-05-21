/**
 * `set_on_hold` (ORDT-09) — place a batch of orders on hold via
 * `PUT /quiqdash/orders/batch/set_on_hold` with a REQUIRED `reason`.
 *
 * Exception-path lifecycle step: orders move into the on-hold state
 * pending operator follow-up. The `reason` field is free-form
 * (z.string().min(1)) per decision D-02 — the upstream BE is the
 * source of truth for valid codes and may add new ones over time.
 * The reason-field description names `list_on_hold_reasons` (Phase-1
 * ORDL-09) so the LLM caller can discover the current valid set.
 *
 * The destructive gate, scope-assertion loop, dry-run shape, and
 * guardrails block all live in the factory at
 * `lib/tools/_batch-transition-factory.ts`. This file is intentionally
 * a single `defineBatchTransition(...)` call.
 */

import { defineBatchTransition } from "./_batch-transition-factory";

export const spec = defineBatchTransition({
  name: "set_on_hold",
  path: "/quiqdash/orders/batch/set_on_hold",
  description:
    "Place a batch of orders on hold — moves them into the on-hold state " +
    "pending operator follow-up. Up to 10 orders per call. Requires a " +
    "reason code (free-form string, discoverable via `list_on_hold_reasons`).",
  reasonField: {
    description:
      "Reason code for placing orders on hold. Free-form string accepted " +
      "by the upstream — call `list_on_hold_reasons` (ORDL-09) to " +
      "discover the current set of valid codes; the BE may add new codes " +
      "over time. Bad values surface via the upstream's structured error " +
      "envelope.",
  },
});
