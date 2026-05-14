/**
 * lastmile-order-creation-v1 — first eval dataset for the Quiqup MCP.
 *
 * Each item: a natural-language merchant request + a hand-authored canonical
 * `create_lastmile_order` tool call. Scored by ../score-tool-call.ts.
 *
 * Field names mirror the real Quiqup last-mile order shape (see
 * tests/cassettes/get-lastmile-order.json). Synthetic data only — no PII.
 *
 * Versioning: this file is the baseline. Future dataset variants land as
 * lastmile-order-creation-v2.ts, etc. — keeping v1 stable for trend comparison.
 */

export interface CreateLastmileOrderInput {
  request: string;
}

export interface CreateLastmileOrderExpected {
  tool: "create_lastmile_order";
  args: Record<string, unknown>;
}

export interface CreateLastmileOrderItem {
  input: CreateLastmileOrderInput;
  expectedOutput: CreateLastmileOrderExpected;
}

export const items: CreateLastmileOrderItem[] = [
  {
    input: {
      request:
        "Send a parcel from our warehouse in Al Quoz, Dubai to a customer in Sharjah. " +
        "The customer pays AED 150 cash on delivery. One small item, 1 kg.",
    },
    expectedOutput: {
      tool: "create_lastmile_order",
      args: {
        origin: {
          address: { town: "Dubai", country: "AE", address1: "Al Quoz" },
        },
        destination: {
          address: { town: "Sharjah", country: "AE" },
        },
        payment_mode: "paid_on_delivery",
        payment_amount: "150.0",
        kind: "partner_same_day",
        items: [{ quantity: 1, weight: "1.0" }],
      },
    },
  },
  {
    input: {
      request:
        "Prepaid delivery from Dubai Marina to JLT. Two boxes, each about 5kg. " +
        "Customer already paid online so no money to collect.",
    },
    expectedOutput: {
      tool: "create_lastmile_order",
      args: {
        origin: { address: { town: "Dubai", country: "AE", address1: "Dubai Marina" } },
        destination: { address: { town: "Dubai", country: "AE", address1: "Jumeirah Lake Towers" } },
        payment_mode: "pre_paid",
        payment_amount: "0.0",
        kind: "partner_same_day",
        items: [
          { quantity: 1, weight: "5.0" },
          { quantity: 1, weight: "5.0" },
        ],
      },
    },
  },
  {
    input: {
      request:
        "Need to ship a fragile cosmetics order to Abu Dhabi tomorrow. " +
        "Pickup from Business Bay, drop in Khalifa City. Customer pays 320 AED COD. " +
        "Three items total.",
    },
    expectedOutput: {
      tool: "create_lastmile_order",
      args: {
        origin: { address: { town: "Dubai", country: "AE", address1: "Business Bay" } },
        destination: { address: { town: "Abu Dhabi", country: "AE", address1: "Khalifa City" } },
        payment_mode: "paid_on_delivery",
        payment_amount: "320.0",
        kind: "partner_next_day",
        items: [
          { quantity: 1 },
          { quantity: 1 },
          { quantity: 1 },
        ],
      },
    },
  },
  {
    input: {
      request:
        "Same-day order from our DXB store in Mall of the Emirates to Jumeirah Beach Residence. " +
        "It's a single pair of shoes, prepaid.",
    },
    expectedOutput: {
      tool: "create_lastmile_order",
      args: {
        origin: { address: { town: "Dubai", country: "AE", address1: "Mall of the Emirates" } },
        destination: { address: { town: "Dubai", country: "AE", address1: "Jumeirah Beach Residence" } },
        payment_mode: "pre_paid",
        payment_amount: "0.0",
        kind: "partner_same_day",
        items: [{ quantity: 1 }],
      },
    },
  },
  {
    input: {
      request:
        "Bulky furniture delivery, Dubai to Ajman. One sofa, around 40 kg. " +
        "Cash on delivery, AED 2,500.",
    },
    expectedOutput: {
      tool: "create_lastmile_order",
      args: {
        origin: { address: { town: "Dubai", country: "AE" } },
        destination: { address: { town: "Ajman", country: "AE" } },
        payment_mode: "paid_on_delivery",
        payment_amount: "2500.0",
        kind: "partner_same_day",
        items: [{ quantity: 1, weight: "40.0" }],
      },
    },
  },
  {
    input: {
      request:
        "Pickup from Quiqup HQ in Al Quoz, drop at Test Customer's address in Sharjah Industrial Area. " +
        "Five small electronics items, total weight 3 kg, customer is prepaying online.",
    },
    expectedOutput: {
      tool: "create_lastmile_order",
      args: {
        origin: { address: { town: "Dubai", country: "AE", address1: "Al Quoz" } },
        destination: { address: { town: "Sharjah", country: "AE", address1: "Sharjah Industrial Area" } },
        payment_mode: "pre_paid",
        payment_amount: "0.0",
        kind: "partner_same_day",
        items: [
          { quantity: 1 },
          { quantity: 1 },
          { quantity: 1 },
          { quantity: 1 },
          { quantity: 1 },
        ],
      },
    },
  },
];
