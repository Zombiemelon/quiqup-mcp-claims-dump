/**
 * Scorers for the Phase-2 WooCommerce integration family eval
 * (woocommerce-integration-v1).
 *
 * Five scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)
 *   2. required-fields-present (0..1)
 *   3. args-overlap (0..1)
 *   4. description-quality (0..1)              — STATIC; per-tool substring
 *      checklist. Includes the assertion that upsert_woocommerce_config
 *      description references BOTH list_woocommerce_states AND
 *      list_woocommerce_shipping_lines (the two source-of-truth lookups).
 *   5. quiqup-vs-woocommerce-state-disambiguation (0..1) — STATIC; asserts
 *      list_woocommerce_states description contains BOTH "quiqup"
 *      (case-insensitive) AND "woocommerce" (case-insensitive). This is the
 *      regression-prone disambiguation language that prevents the LLM from
 *      confusing Quiqup's canonical order-state taxonomy with WooCommerce's
 *      native order statuses.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as listWooCommerceConnectionsSpec } from "@/lib/tools/list-woocommerce-connections";
import { spec as getWooCommerceConfigSpec } from "@/lib/tools/get-woocommerce-config";
import { spec as listWooCommerceStatesSpec } from "@/lib/tools/list-woocommerce-states";
import { spec as listWooCommerceShippingLinesSpec } from "@/lib/tools/list-woocommerce-shipping-lines";
import { spec as setupWooCommerceConnectionSpec } from "@/lib/tools/setup-woocommerce-connection";
import { spec as upsertWooCommerceConfigSpec } from "@/lib/tools/upsert-woocommerce-config";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  list_woocommerce_connections: [],
  get_woocommerce_config: ["site_name"],
  list_woocommerce_states: [],
  list_woocommerce_shipping_lines: ["site_url"],
  setup_woocommerce_connection: [
    "shop_name",
    "site_url",
    "token",
    "is_fulfillment",
  ],
  upsert_woocommerce_config: ["site_url"],
};

export const requiredFieldsPresent: Evaluator = async ({
  output,
  expectedOutput,
}) => {
  const args =
    (output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const expectedTool =
    (expectedOutput as { tool?: string } | undefined)?.tool ?? null;
  const required = expectedTool ? REQUIRED_FIELDS[expectedTool] ?? [] : [];
  if (required.length === 0) {
    return {
      name: "required-fields-present",
      value: 1.0,
      comment: `no required args for ${expectedTool ?? "<unknown>"}`,
    };
  }
  const present = required.filter((k) => k in args);
  return {
    name: "required-fields-present",
    value: present.length / required.length,
    comment: `${present.length}/${required.length}: [${present.join(", ")}]`,
  };
};

interface DescriptionCheck {
  spec: { name: string; description: string };
  substrings: string[];
}

const DESCRIPTION_CHECKS: DescriptionCheck[] = [
  {
    spec: listWooCommerceConnectionsSpec,
    substrings: [
      "/woocommerce/connections",
      "401",
      // Cross-family alternative reference.
      "list_integration_connections",
    ],
  },
  {
    spec: getWooCommerceConfigSpec,
    substrings: [
      "/woocommerce/config",
      "401",
      // LIVE-vs-SAVED disambiguation.
      "list_woocommerce_shipping_lines",
    ],
  },
  {
    spec: listWooCommerceStatesSpec,
    substrings: [
      "/woocommerce/states",
      "401",
      // The Quiqup-vs-WooCommerce disambiguation is enforced by its own scorer.
      "upsert_woocommerce_config",
    ],
  },
  {
    spec: listWooCommerceShippingLinesSpec,
    substrings: [
      "/woocommerce/shipping-lines",
      "401",
      "upsert_woocommerce_config",
    ],
  },
  {
    spec: setupWooCommerceConnectionSpec,
    substrings: [
      "/woocommerce/connection",
      "401",
      // Companion: post-setup config wiring.
      "upsert_woocommerce_config",
    ],
  },
  {
    spec: upsertWooCommerceConfigSpec,
    substrings: [
      "/woocommerce/settings/config/upsert",
      "401",
      // MUST reference both source-of-truth lookups so the LLM can build a
      // legal mapping payload.
      "list_woocommerce_states",
      "list_woocommerce_shipping_lines",
    ],
  },
];

const MIN_DESCRIPTION_LENGTH = 200;

export const descriptionQuality: Evaluator = async () => {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;
  for (const check of DESCRIPTION_CHECKS) {
    const desc = check.spec.description;
    total += 1;
    if (desc.length >= MIN_DESCRIPTION_LENGTH) {
      passed += 1;
    } else {
      failures.push(
        `${check.spec.name}: description length ${desc.length} < ${MIN_DESCRIPTION_LENGTH}`,
      );
    }
    for (const sub of check.substrings) {
      total += 1;
      if (desc.includes(sub)) {
        passed += 1;
      } else {
        failures.push(`${check.spec.name}: description missing "${sub}"`);
      }
    }
  }
  return {
    name: "description-quality",
    value: total > 0 ? passed / total : 0,
    comment:
      failures.length === 0
        ? `${passed}/${total} description assertions passed`
        : `${passed}/${total}; failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: Quiqup-vs-WooCommerce state disambiguation.
 *
 * list_woocommerce_states.description MUST contain BOTH "quiqup"
 * (case-insensitive) AND "woocommerce" (case-insensitive). This locks the
 * disambiguation language at the eval layer — a maintainer cannot reword
 * the description in a way that drops either word without flipping this
 * score below 1.0 and tripping the EVAL_GATE block.
 */
export const quiqupVsWoocommerceStateDisambiguation: Evaluator = async () => {
  const desc = listWooCommerceStatesSpec.description.toLowerCase();
  const hasQuiqup = desc.includes("quiqup");
  const hasWoo = desc.includes("woocommerce");
  const failures: string[] = [];
  if (!hasQuiqup) {
    failures.push('list_woocommerce_states description missing "quiqup"');
  }
  if (!hasWoo) {
    failures.push('list_woocommerce_states description missing "woocommerce"');
  }
  return {
    name: "quiqup-vs-woocommerce-state-disambiguation",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "list_woocommerce_states description disambiguates Quiqup vs WooCommerce states"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  quiqupVsWoocommerceStateDisambiguation,
];
