/**
 * single-order-mutations-v1 — first eval dataset for the Phase-4
 * single-order-mutations family (ORDS-03/04/06/07): the 4 single-order
 * mutation tools.
 *
 * Coverage:
 *   - export_order                  (ORDS-03 — re-export, NOT destructive)
 *   - update_fulfilment_order_status (ORDS-04 — DESTRUCTIVE, D-06)
 *   - create_order_charge           (ORDS-06 — financial CREATE, NOT destructive)
 *   - update_order_weight           (ORDS-07 — numeric tune, NOT destructive)
 *
 * Scored by ../score-single-order-mutations.ts.
 *
 * Tool-side reference:
 *   export_order                    — { order_id, idempotency_key?, environment? }
 *   update_fulfilment_order_status  — { order_id, status, confirm, dry_run?, idempotency_key?, environment? }
 *   create_order_charge             — { order_id, amount, currency, description?, idempotency_key?, environment? }
 *   update_order_weight             — { order_id, weight_kg, idempotency_key?, environment? }
 */

export const TODAY = "2026-05-21";

export interface SingleOrderMutationsInput {
  request: string;
}

export type SingleOrderMutationToolName =
  | "export_order"
  | "update_fulfilment_order_status"
  | "create_order_charge"
  | "update_order_weight";

export interface SingleOrderMutationsExpected {
  tool:
    | SingleOrderMutationToolName
    | SingleOrderMutationToolName[];
  args: Record<string, unknown>;
}

export interface SingleOrderMutationsItem {
  input: SingleOrderMutationsInput;
  expectedOutput: SingleOrderMutationsExpected;
}

export const items: SingleOrderMutationsItem[] = [
  {
    input: {
      request:
        "Re-export order 12345 to the integration layer — the Shopify sync didn't pick it up the first time.",
    },
    expectedOutput: {
      tool: "export_order",
      args: { order_id: "12345" },
    },
  },
  {
    input: {
      request:
        "Set fulfilment order 67890 to status 'shipped' — pickers just signed it off. Confirmed.",
    },
    expectedOutput: {
      tool: "update_fulfilment_order_status",
      args: {
        order_id: "67890",
        status: "shipped",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "Charge 25 AED to order 11111 for an extra-weight surcharge. Currency AED.",
    },
    expectedOutput: {
      tool: "create_order_charge",
      args: {
        order_id: "11111",
        amount: 25,
        currency: "AED",
      },
    },
  },
  {
    input: {
      request:
        "The actual weight of order 22222 is 5.2 kg — please update it.",
    },
    expectedOutput: {
      tool: "update_order_weight",
      args: {
        order_id: "22222",
        weight_kg: 5.2,
      },
    },
  },
  {
    input: {
      request:
        "Apply a 150 GBP reimbursement charge to order 33333 — description: 'goodwill refund'.",
    },
    expectedOutput: {
      tool: "create_order_charge",
      args: {
        order_id: "33333",
        amount: 150,
        currency: "GBP",
        description: "goodwill refund",
      },
    },
  },
  {
    input: {
      request:
        "Move fulfilment order 44444 into 'picking' state — confirmed by warehouse, go ahead.",
    },
    expectedOutput: {
      tool: "update_fulfilment_order_status",
      args: {
        order_id: "44444",
        status: "picking",
        confirm: true,
      },
    },
  },
  {
    input: {
      request:
        "The integration didn't see order 55555 — re-export it. Pass an idempotency_key 'manual-reexport-55555-2026-05-21' so retries are safe.",
    },
    expectedOutput: {
      tool: "export_order",
      args: {
        order_id: "55555",
        idempotency_key: "manual-reexport-55555-2026-05-21",
      },
    },
  },
  {
    input: {
      request:
        "Order 66666 weighs 0.85 kg, not 2 — fix the weight.",
    },
    expectedOutput: {
      tool: "update_order_weight",
      args: {
        order_id: "66666",
        weight_kg: 0.85,
      },
    },
  },
];
