/**
 * destructive-integrations-v1 — first eval dataset for the Phase-2
 * destructive-integrations sub-family (the two delete tools).
 *
 * Each item: a natural-language merchant question + the canonical Phase-2
 * destructive-family tool call. Scored by
 * ../score-destructive-integrations.ts.
 *
 * The dataset MIXES positive and "preview" paths so the confirm-elicitation
 * scorer has real signal:
 *   - An explicit "confirm true" prompt for delete_integration_source.
 *   - A dry-run prompt for delete_salla_connection.
 *   - A prompt where the user does NOT use the literal word "confirm" but
 *     the canonical description SHOULD steer the LLM into setting
 *     `confirm: true` anyway (this tests T-02-37 elicitation language).
 *   - A "do not actually delete, just preview" prompt — expected args
 *     include BOTH `confirm: true` (still required to dry-run; T-02-39)
 *     AND `dry_run: true`.
 *
 * No real merchant data — shop names like "acme-store" / connection ids
 * like "c-abc" are placeholders.
 *
 * Tool-side reference (lib/tools/*.ts):
 *   delete_integration_source   — { source, shop_name, confirm?, dry_run?, idempotency_key?, environment? }
 *   delete_salla_connection     — { id, confirm?, dry_run?, idempotency_key?, environment? }
 */

export const TODAY = "2026-05-19";

export interface DestructiveIntegrationsInput {
  request: string;
}

export interface DestructiveIntegrationsExpected {
  tool: "delete_integration_source" | "delete_salla_connection";
  args: Record<string, unknown>;
}

export interface DestructiveIntegrationsItem {
  input: DestructiveIntegrationsInput;
  expectedOutput: DestructiveIntegrationsExpected;
}

export const items: DestructiveIntegrationsItem[] = [
  {
    input: {
      request:
        "Delete my shopify integration source for shop acme-store, confirm true.",
    },
    expectedOutput: {
      tool: "delete_integration_source",
      args: { source: "shopify", shop_name: "acme-store", confirm: true },
    },
  },
  {
    input: {
      request:
        "Preview what would happen if I deleted the salla connection c-abc — dry-run.",
    },
    expectedOutput: {
      tool: "delete_salla_connection",
      args: { id: "c-abc", confirm: true, dry_run: true },
    },
  },
  {
    input: {
      // No literal "confirm" in the prompt. The canonical description text on
      // delete_integration_source SHOULD steer the LLM into setting
      // `confirm: true` anyway (T-02-37 elicitation contract).
      request: "Remove the woocommerce source for store acme-store.",
    },
    expectedOutput: {
      tool: "delete_integration_source",
      args: { source: "woocommerce", shop_name: "acme-store", confirm: true },
    },
  },
  {
    input: {
      request:
        "Do not actually delete, just preview the salla deletion for connection c-abc.",
    },
    expectedOutput: {
      tool: "delete_salla_connection",
      args: { id: "c-abc", confirm: true, dry_run: true },
    },
  },
  {
    input: {
      request:
        "Delete the salla connection with id conn_abc123. I have already verified the shop_name; go ahead and confirm.",
    },
    expectedOutput: {
      tool: "delete_salla_connection",
      args: { id: "conn_abc123", confirm: true },
    },
  },
];
