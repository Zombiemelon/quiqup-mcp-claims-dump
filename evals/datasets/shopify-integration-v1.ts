/**
 * shopify-integration-v1 — first eval dataset for the Phase-2 Shopify family.
 *
 * Each item: a natural-language merchant question + the canonical Phase-2
 * Shopify-family tool call. Scored by ../score-shopify-integration.ts.
 *
 * The dataset spans the family's disambiguation surface:
 *   - get_shopify_config           (saved config + mapping)
 *   - list_shopify_delivery_methods (LIVE catalog)
 *   - list_shopify_locations       (LIVE catalog)
 *   - update_shopify_config        (mapping/config update)
 *   - update_shopify_connection    (credentials update; sensitive token)
 *   - setup_shopify_callback       (SINGLE-USE OAuth callback)
 *
 * No real merchant data. Shop names like "acme-store" / token "TOK" are
 * obvious placeholders.
 *
 * Tool-side reference (lib/tools/*.ts):
 *   get_shopify_config              — { shop_name, environment? }
 *   list_shopify_delivery_methods   — { shop_name, environment? }
 *   list_shopify_locations          — { shop_name, environment? }
 *   update_shopify_config           — { shop_name, ...partial, environment? }
 *   update_shopify_connection       — { shop_name, code, is_fulfillment, token, environment? }
 *                                       (02-REVIEW BL-04: `user_id` is server-bound — not a caller arg)
 *   setup_shopify_callback          — { shop_name, code, is_fulfillment, environment? }
 */

export const TODAY = "2026-05-19";

export interface ShopifyIntegrationInput {
  request: string;
}

export interface ShopifyIntegrationExpected {
  tool:
    | "get_shopify_config"
    | "list_shopify_delivery_methods"
    | "list_shopify_locations"
    | "update_shopify_config"
    | "update_shopify_connection"
    | "setup_shopify_callback";
  args: Record<string, unknown>;
}

export interface ShopifyIntegrationItem {
  input: ShopifyIntegrationInput;
  expectedOutput: ShopifyIntegrationExpected;
}

export const items: ShopifyIntegrationItem[] = [
  {
    input: {
      request: "Show me the saved config for my shopify store acme-store.",
    },
    expectedOutput: {
      tool: "get_shopify_config",
      args: { shop_name: "acme-store" },
    },
  },
  {
    input: {
      request:
        "List the live shipping methods for my acme-store shopify storefront.",
    },
    expectedOutput: {
      tool: "list_shopify_delivery_methods",
      args: { shop_name: "acme-store" },
    },
  },
  {
    input: {
      request:
        "What ship-from locations does my acme-store shopify shop currently expose?",
    },
    expectedOutput: {
      tool: "list_shopify_locations",
      args: { shop_name: "acme-store" },
    },
  },
  {
    input: {
      request:
        "Update the shopify config for acme-store: turn off auto_mark_as_rfc.",
    },
    expectedOutput: {
      tool: "update_shopify_config",
      args: { shop_name: "acme-store", auto_mark_as_rfc: false },
    },
  },
  {
    input: {
      request:
        "Complete the shopify oauth callback for acme-store with code XYZ and is_fulfillment true.",
    },
    expectedOutput: {
      tool: "setup_shopify_callback",
      args: { shop_name: "acme-store", code: "XYZ", is_fulfillment: true },
    },
  },
  {
    input: {
      // 02-REVIEW BL-04: user_id is server-bound (auth.userId) — not a caller arg.
      request:
        "Update the shopify connection credentials for acme-store using token TOK, code XYZ, as fulfillment.",
    },
    expectedOutput: {
      tool: "update_shopify_connection",
      args: {
        shop_name: "acme-store",
        code: "XYZ",
        token: "TOK",
        is_fulfillment: true,
      },
    },
  },
  {
    input: {
      request:
        "Bump the WMS pickup delay on acme-store to 60 minutes via the shopify config.",
    },
    expectedOutput: {
      tool: "update_shopify_config",
      args: { shop_name: "acme-store", wms_delay_minutes: 60 },
    },
  },
];
