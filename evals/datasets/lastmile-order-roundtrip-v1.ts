/**
 * lastmile-order-roundtrip-v1 — ONLINE round-trip eval dataset.
 *
 * Each item triggers: Claude → POST /orders → GET /orders/{id} → cancel.
 * Hits the real Quiqup staging API. Synthetic test data only — no real PII.
 *
 * Starting with one item to keep the staging blast small. Add more later
 * once we're confident the round-trip is clean.
 */

export interface RoundtripInput {
  request: string;
}

export interface RoundtripExpected {
  tool: "create_lastmile_order";
}

export interface RoundtripItem {
  input: RoundtripInput;
  expectedOutput: RoundtripExpected;
}

export const items: RoundtripItem[] = [
  {
    input: {
      request:
        "Create a same-day, pre-paid TEST delivery. Pickup from our warehouse at " +
        "Test Street 1, Test Area, Dubai (contact: Test Merchant, +971500000000). " +
        "Drop at Test Building, Test Street 1, Test Area, Dubai (contact: Test Customer, " +
        "+971500000000). One small parcel named \"MCP eval probe\". " +
        "Set partner_order_id to a unique string starting with \"MCP_EVAL_\" followed by " +
        "a timestamp or random suffix.",
    },
    expectedOutput: { tool: "create_lastmile_order" },
  },
];
