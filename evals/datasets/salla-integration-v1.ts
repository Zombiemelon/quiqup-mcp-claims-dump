/**
 * salla-integration-v1 — first eval dataset for the Phase-2 Salla family.
 *
 * Each item: a natural-language merchant question + the canonical Phase-2
 * Salla-family tool call. Scored by ../score-salla-integration.ts.
 *
 * The dataset spans the family's disambiguation surface:
 *   - install_salla              (OAuth install URL)
 *   - get_salla_connection       (TOKEN-OMISSION contract; T-02-29)
 *   - get_salla_platform_data    (LIVE catalog)
 *   - get_salla_config           (404-as-null contract; T-02-30)
 *   - update_salla_config        (UPSERT; references list_service_kinds)
 *   - toggle_salla_fulfillment   (flip is_fulfillment)
 *
 * No real merchant data — connection ids like "c-abc" / "conn_abc123" are
 * obvious placeholders.
 *
 * Tool-side reference (lib/tools/*.ts):
 *   install_salla              — { environment? }
 *   get_salla_connection       — { id, environment? }
 *   get_salla_platform_data    — { connection_id, environment? }
 *   get_salla_config           — { connection_id, environment? }
 *   update_salla_config        — { connection_id, ...partial, environment? }
 *   toggle_salla_fulfillment   — { id, is_fulfillment, environment? }
 */

export const TODAY = "2026-05-19";

export interface SallaIntegrationInput {
  request: string;
}

export interface SallaIntegrationExpected {
  tool:
    | "install_salla"
    | "get_salla_connection"
    | "get_salla_platform_data"
    | "get_salla_config"
    | "update_salla_config"
    | "toggle_salla_fulfillment";
  args: Record<string, unknown>;
}

export interface SallaIntegrationItem {
  input: SallaIntegrationInput;
  expectedOutput: SallaIntegrationExpected;
}

export const items: SallaIntegrationItem[] = [
  {
    input: { request: "Get me the salla install/oauth URL." },
    expectedOutput: {
      tool: "install_salla",
      args: {},
    },
  },
  {
    input: {
      request: "Read the salla connection with id c-abc.",
    },
    expectedOutput: {
      tool: "get_salla_connection",
      args: { id: "c-abc" },
    },
  },
  {
    input: {
      request:
        "Show me the salla platform data (shipping methods + locations) for connection c-abc.",
    },
    expectedOutput: {
      tool: "get_salla_platform_data",
      args: { connection_id: "c-abc" },
    },
  },
  {
    input: {
      request: "Is there a salla config saved for connection c-abc?",
    },
    expectedOutput: {
      tool: "get_salla_config",
      args: { connection_id: "c-abc" },
    },
  },
  {
    input: {
      request:
        "Save salla config for c-abc: awb_trigger ready_for_collection, sync_products true.",
    },
    expectedOutput: {
      tool: "update_salla_config",
      args: {
        connection_id: "c-abc",
        awb_trigger: "ready_for_collection",
        sync_products: true,
      },
    },
  },
  {
    input: {
      request: "Turn on fulfillment for salla connection c-abc.",
    },
    expectedOutput: {
      tool: "toggle_salla_fulfillment",
      args: { id: "c-abc", is_fulfillment: true },
    },
  },
  {
    input: {
      request:
        "Bump wms_delay_minutes to 45 on salla connection c-abc via the config endpoint.",
    },
    expectedOutput: {
      tool: "update_salla_config",
      args: { connection_id: "c-abc", wms_delay_minutes: 45 },
    },
  },
];
