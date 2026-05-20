/**
 * woocommerce-integration-v1 — first eval dataset for the Phase-2 WooCommerce
 * family.
 *
 * Each item: a natural-language merchant question + the canonical Phase-2
 * WooCommerce-family tool call. Scored by ../score-woocommerce-integration.ts.
 *
 * The dataset spans the family's disambiguation surface:
 *   - list_woocommerce_connections  (WooCommerce-only catalog)
 *   - get_woocommerce_config        (saved mapping/config)
 *   - list_woocommerce_states       (canonical QUIQUP state taxonomy)
 *   - list_woocommerce_shipping_lines (LIVE catalog)
 *   - setup_woocommerce_connection  (create new connection; sensitive token)
 *   - upsert_woocommerce_config     (upsert mapping/config)
 *
 * No real merchant data — site_url "https://acme.example.com" / "SECRET" are
 * obvious placeholders.
 *
 * Tool-side reference (lib/tools/*.ts):
 *   list_woocommerce_connections     — { environment? }
 *   get_woocommerce_config           — { site_name, environment? }
 *   list_woocommerce_states          — { environment? }
 *   list_woocommerce_shipping_lines  — { site_url, environment? }
 *   setup_woocommerce_connection     — { shop_name, site_url, token, is_fulfillment, environment? }
 *   upsert_woocommerce_config        — { site_url, ...partial, environment? }
 */

export const TODAY = "2026-05-19";

export interface WooCommerceIntegrationInput {
  request: string;
}

export interface WooCommerceIntegrationExpected {
  tool:
    | "list_woocommerce_connections"
    | "get_woocommerce_config"
    | "list_woocommerce_states"
    | "list_woocommerce_shipping_lines"
    | "setup_woocommerce_connection"
    | "upsert_woocommerce_config";
  args: Record<string, unknown>;
}

export interface WooCommerceIntegrationItem {
  input: WooCommerceIntegrationInput;
  expectedOutput: WooCommerceIntegrationExpected;
}

export const items: WooCommerceIntegrationItem[] = [
  {
    input: { request: "List my woocommerce connections." },
    expectedOutput: {
      tool: "list_woocommerce_connections",
      args: {},
    },
  },
  {
    input: {
      request:
        "What quiqup order states are available for mapping into my woocommerce config?",
    },
    expectedOutput: {
      tool: "list_woocommerce_states",
      args: {},
    },
  },
  {
    input: {
      request:
        "What shipping lines does my acme woocommerce site at https://acme.example.com currently have?",
    },
    expectedOutput: {
      tool: "list_woocommerce_shipping_lines",
      args: { site_url: "https://acme.example.com" },
    },
  },
  {
    input: {
      request:
        "Set up a woocommerce connection for shop_name acme at https://acme.example.com using consumer secret SECRET, fulfillment yes.",
    },
    expectedOutput: {
      tool: "setup_woocommerce_connection",
      args: {
        shop_name: "acme",
        site_url: "https://acme.example.com",
        token: "SECRET",
        is_fulfillment: true,
      },
    },
  },
  {
    input: {
      request:
        "Save woocommerce config for https://acme.example.com: only ship to US and AE, sync_products true.",
    },
    expectedOutput: {
      tool: "upsert_woocommerce_config",
      args: {
        site_url: "https://acme.example.com",
        country_filter: ["US", "AE"],
        sync_products: true,
      },
    },
  },
  {
    input: {
      request: "Show me the woocommerce config for site acme-store.",
    },
    expectedOutput: {
      tool: "get_woocommerce_config",
      args: { site_name: "acme-store" },
    },
  },
  {
    input: {
      request:
        "Bump wms_delay_minutes to 45 in the woocommerce config for https://acme.example.com.",
    },
    expectedOutput: {
      tool: "upsert_woocommerce_config",
      args: {
        site_url: "https://acme.example.com",
        wms_delay_minutes: 45,
      },
    },
  },
];
