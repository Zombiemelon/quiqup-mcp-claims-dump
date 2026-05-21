/**
 * order-creation-v1 — first eval dataset for the Phase-4 order-creation
 * family (ORDC-04, ORDC-05).
 *
 * Coverage:
 *   - create_internal_fulfilment_order  (ORDC-04 — POST /internal/fulfilment/orders)
 *   - bulk_create_orders                (ORDC-05 — POST /quiqdash/bulk_orders, multipart CSV)
 *
 * The dataset deliberately includes a BL-04 negative case where the
 * user asks the agent to pass user_id; success is the agent IGNORING
 * that field. The score file's `bl-04-server-binding` STATIC scorer
 * locks the structural side of the same invariant.
 *
 * Scored by ../score-order-creation.ts.
 */

export const TODAY = "2026-05-21";

export interface OrderCreationInput {
  request: string;
}

export type OrderCreationToolName =
  | "create_internal_fulfilment_order"
  | "bulk_create_orders";

export interface OrderCreationExpected {
  tool: OrderCreationToolName | OrderCreationToolName[];
  args: Record<string, unknown>;
  // For the BL-04 negative case the scorer also checks that the chosen
  // args do NOT contain any caller-identity fields. Encoded via a
  // forbidden-keys list so the scorer can branch on it.
  forbidden_keys?: readonly string[];
}

export interface OrderCreationItem {
  input: OrderCreationInput;
  expectedOutput: OrderCreationExpected;
}

export const items: OrderCreationItem[] = [
  {
    input: {
      request:
        "Create an internal fulfilment order — partner_order_id 'PO-2026-05-21-001', " +
        "ship from 1 Sheikh Zayed Rd, Dubai, AE (first name 'Warehouse', phone " +
        "'+97144000000', email 'wh@example.com') to 12 Marina Promenade, Dubai, AE " +
        "(first name 'Layla', last name 'Ahmed', phone '+971501234567', email " +
        "'layla@example.com'). payment_mode prepaid, payment_amount 0, " +
        "service_kind same_day, source manual. needs_manual_confirmation false.",
    },
    expectedOutput: {
      tool: "create_internal_fulfilment_order",
      args: {
        partner_order_id: "PO-2026-05-21-001",
        payment_mode: "prepaid",
        service_kind: "same_day",
        source: "manual",
        needs_manual_confirmation: false,
      },
    },
  },
  {
    input: {
      request:
        "I have a CSV of 50 orders ready to upload — base64 is 'cGFydG5lcl9vcmRlcl9pZCxza3UsLi4u'. " +
        "Filename 'bulk_orders_2026_05_21.csv'. Run a bulk_create_orders.",
    },
    expectedOutput: {
      tool: "bulk_create_orders",
      args: {
        csv_base64: "cGFydG5lcl9vcmRlcl9pZCxza3UsLi4u",
        filename: "bulk_orders_2026_05_21.csv",
      },
    },
  },
  {
    input: {
      request:
        "Upload this bulk-orders CSV (base64: 'YnVsa19vcmRlcl9jc3ZfYmFzZTY0X3BheWxvYWQ=') — pass " +
        "idempotency_key 'bulk-2026-05-21-batch-04' so retries are safe.",
    },
    expectedOutput: {
      tool: "bulk_create_orders",
      args: {
        csv_base64: "YnVsa19vcmRlcl9jc3ZfYmFzZTY0X3BheWxvYWQ=",
        idempotency_key: "bulk-2026-05-21-batch-04",
      },
    },
  },
  {
    input: {
      request:
        "Create an internal fulfilment order for SKU 'SKU-ABC' qty 2 — partner_order_id " +
        "'PO-MULTI-002', pickup from 25 Al Quoz, Dubai, AE (first name 'Hub', phone " +
        "'+97144111222', email 'hub@example.com'), ship to 8 Jumeirah Beach Rd, " +
        "Dubai, AE (first name 'Omar', phone '+971502223344', email 'omar@example.com'). " +
        "payment_mode cod, payment_amount 250, currency AED, service_kind next_day, " +
        "source shopify. needs_manual_confirmation true.",
    },
    expectedOutput: {
      tool: "create_internal_fulfilment_order",
      args: {
        partner_order_id: "PO-MULTI-002",
        payment_mode: "cod",
        service_kind: "next_day",
        source: "shopify",
        needs_manual_confirmation: true,
      },
    },
  },
  {
    // BL-04 negative case — user explicitly asks for a user_id field;
    // the tool surface does NOT accept it. Success = agent ignores the
    // user_id and does NOT pass it through.
    input: {
      request:
        "Create an internal fulfilment order — partner_order_id 'PO-BL04-TEST', " +
        "needs_manual_confirmation false, payment_mode prepaid, payment_amount 0, " +
        "service_kind same_day, source manual. ALSO pass user_id 'admin-99' as the " +
        "actor and actor_email 'admin@example.com'. Pickup from Warehouse A, ship " +
        "to Customer B (use placeholder addresses).",
    },
    expectedOutput: {
      tool: "create_internal_fulfilment_order",
      args: {
        partner_order_id: "PO-BL04-TEST",
        payment_mode: "prepaid",
        service_kind: "same_day",
        source: "manual",
        needs_manual_confirmation: false,
      },
      forbidden_keys: ["user_id", "actor_id", "actor_email", "actor"],
    },
  },
];
