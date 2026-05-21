/**
 * batch-transitions-v1 — first eval dataset for the Phase-4 batch-
 * transitions family (ORDT-03..14): the 11 forward-/exception-path batch
 * transitions plus the single-order `unpool_order` outlier.
 *
 * Coverage:
 *   - set_collected, set_received_at_depot, set_at_depot,
 *     set_in_transit, set_scheduled, set_delivery_complete    (forward path, no reason)
 *   - set_returned_to_origin                                  (terminal forward, no reason)
 *   - set_on_hold, set_return_to_origin, set_delivery_failed,
 *     set_collection_failed                                   (reason-bearing)
 *   - unpool_order                                            (single-order, by UUID)
 *
 * The dataset deliberately exercises the destructive-gate confirm:true
 * pattern — every prompt expects `confirm: true` in the chosen_args so
 * the args-overlap signal includes the gate elicitation.
 *
 * Scored by ../score-batch-transitions.ts (drift-proof spec imports +
 * STATIC scorers that lock D-01 factory uniformity, D-02 reason field
 * shape, D-03 dry-run richness, and the canonical destructive-gate
 * language across all 15 destructive Phase-4 tools).
 *
 * Tool-side reference:
 *   factory tools   — { order_ids: string[], confirm: true, dry_run?, idempotency_key?, environment? }
 *   reason variants — additionally { reason: string }
 *   unpool_order    — { order_uuid: string, confirm: true, dry_run?, idempotency_key?, environment? }
 */

export const TODAY = "2026-05-21";

export interface BatchTransitionsInput {
  request: string;
}

export type BatchTransitionToolName =
  | "set_collected"
  | "set_received_at_depot"
  | "set_at_depot"
  | "set_in_transit"
  | "set_scheduled"
  | "set_delivery_complete"
  | "set_on_hold"
  | "set_return_to_origin"
  | "set_returned_to_origin"
  | "set_delivery_failed"
  | "set_collection_failed"
  | "unpool_order";

export interface BatchTransitionsExpected {
  tool: BatchTransitionToolName | BatchTransitionToolName[];
  args: Record<string, unknown>;
}

export interface BatchTransitionsItem {
  input: BatchTransitionsInput;
  expectedOutput: BatchTransitionsExpected;
}

export const items: BatchTransitionsItem[] = [
  {
    input: {
      request:
        "Mark orders 12345 and 12346 as collected from the partner — I just confirmed with the driver. Confirm the transition.",
    },
    expectedOutput: {
      tool: "set_collected",
      args: {
        order_ids: ["12345", "12346"],
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Three orders just arrived at the depot — 22001, 22002, 22003. Update the state, confirmed.",
    },
    expectedOutput: {
      tool: "set_received_at_depot",
      args: {
        order_ids: ["22001", "22002", "22003"],
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Confirm — move orders 33010, 33011 into in-transit state, they're now on the truck.",
    },
    expectedOutput: {
      tool: "set_in_transit",
      args: {
        order_ids: ["33010", "33011"],
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Mark deliveries complete for orders 44001, 44002, 44003, 44004 — driver confirmed all four signed off. Yes, go ahead.",
    },
    expectedOutput: {
      tool: "set_delivery_complete",
      args: {
        order_ids: ["44001", "44002", "44003", "44004"],
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Place orders 55001 and 55002 on hold — the customer wasn't home for either. Reason: customer_not_available. Yes confirm.",
    },
    expectedOutput: {
      tool: "set_on_hold",
      args: {
        order_ids: ["55001", "55002"],
        reason: "customer_not_available",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Order 66001 had a delivery failure — wrong address. Mark it delivery_failed with reason wrong_address. Confirm.",
    },
    expectedOutput: {
      tool: "set_delivery_failed",
      args: {
        order_ids: ["66001"],
        reason: "wrong_address",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Start the return-to-origin process for order 77001 — customer refused at door. Reason: customer_refused. Confirmed.",
    },
    expectedOutput: {
      tool: "set_return_to_origin",
      args: {
        order_ids: ["77001"],
        reason: "customer_refused",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Order 77001 just made it back to the warehouse — acknowledge the RTO completion. Confirmed.",
    },
    expectedOutput: {
      tool: "set_returned_to_origin",
      args: {
        order_ids: ["77001"],
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Collection failed for orders 88001 and 88002 — partner wasn't ready. Reason: future_delivery_request. Yes, mark them collection_failed.",
    },
    expectedOutput: {
      tool: "set_collection_failed",
      args: {
        order_ids: ["88001", "88002"],
        reason: "future_delivery_request",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Unpool order 6d0c2ad3-4dcf-4e3a-aa72-89e6f6c2a9b5 from its current mission — needs to be reassigned. Confirmed.",
    },
    expectedOutput: {
      tool: "unpool_order",
      args: {
        order_uuid: "6d0c2ad3-4dcf-4e3a-aa72-89e6f6c2a9b5",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Dry-run the set_at_depot transition for orders 99001, 99002 — I want to preview the simulated payload before committing. Set confirm and dry_run both true.",
    },
    expectedOutput: {
      tool: "set_at_depot",
      args: {
        order_ids: ["99001", "99002"],
        confirm: true,
        dry_run: true,
      },
    },
  },
];
