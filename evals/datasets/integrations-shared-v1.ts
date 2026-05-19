/**
 * integrations-shared-v1 — first eval dataset for the Phase-2 shared-integrations
 * sub-family (cross-storefront integration substrate).
 *
 * Each item: a natural-language merchant question + the canonical Phase-2
 * shared-integrations tool call. Scored by ../score-integrations-shared.ts.
 *
 * The dataset spans the substrate's full disambiguation surface:
 *   - list_integration_connections (no args; cross-family catalog)
 *   - list_integration_order_reasons (triage query — 7 required params)
 *   - repair_integration_orders (retry POST — 8 required body fields)
 *   - get_integration_order (single-envelope by uuid)
 *   - confirm_ff_export (ack export by uuid)
 *
 * Tool-side reference (lib/tools/*.ts):
 *   list_integration_connections   — { environment? }
 *   list_integration_order_reasons — { sales_channel, status, start_date, end_date, limit, offset, environment? }
 *   repair_integration_orders      — { ids[], order_name, shop_name, site_url, source, start_date, end_date, idempotency_key?, environment? }
 *   (02-REVIEW BL-04: `user_id` is server-bound — not a caller arg.)
 *   get_integration_order          — { order_uuid, environment? }
 *   confirm_ff_export              — { order_uuid, idempotency_key?, environment? }
 *
 * No real merchant data. Shop names like "acme" / "acme-store" / shop urls like
 * "https://acme.myshopify.com" are obvious placeholders.
 */

export const TODAY = "2026-05-19";

export interface IntegrationsSharedInput {
  request: string;
}

export interface IntegrationsSharedExpected {
  tool:
    | "list_integration_connections"
    | "list_integration_order_reasons"
    | "repair_integration_orders"
    | "get_integration_order"
    | "confirm_ff_export";
  args: Record<string, unknown>;
}

export interface IntegrationsSharedItem {
  input: IntegrationsSharedInput;
  expectedOutput: IntegrationsSharedExpected;
}

export const items: IntegrationsSharedItem[] = [
  {
    input: {
      request:
        "Show me all my connected stores across shopify, woocommerce and salla.",
    },
    expectedOutput: {
      tool: "list_integration_connections",
      args: {},
    },
  },
  {
    input: {
      request:
        "What integration orders failed in the last 24 hours on my shopify store? My user id is u_123.",
    },
    // 02-REVIEW BL-04: user_id is server-bound (auth.userId) and is NOT a
    // caller-supplied arg, so it does not appear in expectedOutput.args.
    expectedOutput: {
      tool: "list_integration_order_reasons",
      args: {
        sales_channel: "shopify",
        status: "failed",
        start_date: "2026-05-18T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
        limit: 50,
        offset: 0,
      },
    },
  },
  {
    input: {
      request:
        "Retry failed integration orders with ids a, b, c on the acme shopify shop https://acme.myshopify.com. The order_name is '#1234', window 2026-05-01 through 2026-05-19.",
    },
    expectedOutput: {
      tool: "repair_integration_orders",
      args: {
        ids: ["a", "b", "c"],
        order_name: "#1234",
        shop_name: "acme",
        site_url: "https://acme.myshopify.com",
        source: "shopify",
        start_date: "2026-05-01T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
      },
    },
  },
  {
    input: {
      request: "Look up integration order with UUID xyz-123.",
    },
    expectedOutput: {
      tool: "get_integration_order",
      args: { order_uuid: "xyz-123" },
    },
  },
  {
    input: {
      request: "Ack the fulfilment export for order_uuid abc-456.",
    },
    expectedOutput: {
      tool: "confirm_ff_export",
      args: { order_uuid: "abc-456" },
    },
  },
  {
    input: {
      request:
        "Pull the failed-orders triage list for woocommerce, status pending, between 2026-05-10 and 2026-05-19, give me 100 rows.",
    },
    expectedOutput: {
      tool: "list_integration_order_reasons",
      args: {
        sales_channel: "woocommerce",
        status: "pending",
        start_date: "2026-05-10T00:00:00Z",
        end_date: "2026-05-19T00:00:00Z",
        limit: 100,
        offset: 0,
      },
    },
  },
  {
    input: {
      request:
        "Re-fetch the full envelope for integration order 5a8b4e2f-1234-4abc-9def-abcdef012345 to confirm the post-repair state.",
    },
    expectedOutput: {
      tool: "get_integration_order",
      args: { order_uuid: "5a8b4e2f-1234-4abc-9def-abcdef012345" },
    },
  },
];
