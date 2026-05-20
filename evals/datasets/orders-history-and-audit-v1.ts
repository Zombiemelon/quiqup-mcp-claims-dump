/**
 * orders-history-and-audit-v1 — first eval dataset for the Phase-3
 * Quiqup REST history + Audit families (combined; both anchor on
 * order-detail reads).
 *
 * Each item: a natural-language merchant question + the canonical
 * Phase-3 tool call. Scored by ../score-orders-history-and-audit.ts.
 *
 * The dataset deliberately spans the disambiguation surface:
 *   - get_order_history       → STATE-TRANSITION timeline (pending →
 *                                live → delivered, with operator + reasons).
 *                                Source: Quiqup REST GET /orders/{id}/history.
 *   - list_order_audit_events → FIELD-LEVEL audit log (who edited the
 *                                address, when, before/after diff).
 *                                Source: Audit service GET /events.
 *
 * NOTE: get_order_history takes the clientOrderID as a string (`order_id`);
 * list_order_audit_events takes the order UUID (`order_uuid`). The
 * dataset uses distinguishable shapes (small numeric strings vs. full
 * UUIDs) so the agent can pick the right tool from the input shape alone
 * even when the wording is ambiguous.
 *
 * Tool-side reference (lib/tools/*.ts):
 *   get_order_history       — { order_id: <string>, environment? }
 *   list_order_audit_events — { order_uuid: <uuid>,  environment? }
 */

export const TODAY = "2026-05-19";

export interface OrdersHistoryAndAuditInput {
  request: string;
}

export interface OrdersHistoryAndAuditExpected {
  // Some disambiguation prompts accept EITHER tool — encoded as an array.
  tool:
    | "get_order_history"
    | "list_order_audit_events"
    | Array<"get_order_history" | "list_order_audit_events">;
  args: Record<string, unknown>;
}

export interface OrdersHistoryAndAuditItem {
  input: OrdersHistoryAndAuditInput;
  expectedOutput: OrdersHistoryAndAuditExpected;
}

export const items: OrdersHistoryAndAuditItem[] = [
  {
    input: {
      request: "Show me the state-transition history for clientOrderID 12345.",
    },
    expectedOutput: {
      tool: "get_order_history",
      args: { order_id: "12345" },
    },
  },
  {
    input: {
      request:
        "Who edited the address on order 6d0c2ad3-4dcf-4e3a-aa72-89e6f6c2a9b5 and when?",
    },
    expectedOutput: {
      tool: "list_order_audit_events",
      args: { order_uuid: "6d0c2ad3-4dcf-4e3a-aa72-89e6f6c2a9b5" },
    },
  },
  {
    input: {
      request:
        "What's the audit trail for order UUID 7e1d3be4-5edf-4f4b-bb83-9af7e7d3ba66?",
    },
    expectedOutput: {
      tool: "list_order_audit_events",
      args: { order_uuid: "7e1d3be4-5edf-4f4b-bb83-9af7e7d3ba66" },
    },
  },
  {
    input: {
      request:
        "When did order 67890 go from pending → live → delivered, and which operator handled each step?",
    },
    expectedOutput: {
      tool: "get_order_history",
      args: { order_id: "67890" },
    },
  },
  {
    input: {
      request:
        "List the field-level changes on order 8f2e4cf5-6fea-4a5c-cc94-abb8f8e4cb77's billing address.",
    },
    expectedOutput: {
      tool: "list_order_audit_events",
      args: { order_uuid: "8f2e4cf5-6fea-4a5c-cc94-abb8f8e4cb77" },
    },
  },
  {
    // Disambiguation prompt — both tools could be relevant. Either is OK;
    // the args-overlap signal stays meaningful regardless of which tool the
    // agent picks because the args shape is distinguishable (order_id vs
    // order_uuid).
    input: {
      request:
        "Tell me everything that happened to order 99999 last week — both state changes AND field edits.",
    },
    expectedOutput: {
      tool: ["get_order_history", "list_order_audit_events"],
      args: { order_id: "99999" },
    },
  },
  {
    input: {
      request:
        "What return-to-origin reason did clientOrderID 11122 hit last Friday?",
    },
    expectedOutput: {
      tool: "get_order_history",
      args: { order_id: "11122" },
    },
  },
];
