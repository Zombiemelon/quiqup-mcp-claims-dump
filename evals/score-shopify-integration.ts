/**
 * Scorers for the Phase-2 Shopify integration family eval
 * (shopify-integration-v1).
 *
 * Five scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)             — wraps ./score-tool-call.ts.
 *
 *   2. required-fields-present (0..1)    — per-tool rules.
 *
 *   3. args-overlap (0..1)               — wraps ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)        — STATIC; per-tool substring checklist
 *      on production spec.description (endpoint path, "401", canonical
 *      companion-tool refs).
 *
 *   5. sensitive-and-single-use-language (0..1) — STATIC; asserts the two
 *      regression-prone Phase-2 Shopify invariants:
 *        - update_shopify_connection description contains "sensitive" or "secret"
 *          (T-02-12 — token treatment).
 *        - setup_shopify_callback description contains "single-use"
 *          (T-02-13 — OAuth code semantics).
 *      A maintainer cannot silently weaken either contract without dropping
 *      this score below 1.0 and tripping the EVAL_GATE block.
 *
 * Lenient by design — extras don't penalize.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as getShopifyConfigSpec } from "@/lib/tools/get-shopify-config";
import { spec as listShopifyDeliveryMethodsSpec } from "@/lib/tools/list-shopify-delivery-methods";
import { spec as listShopifyLocationsSpec } from "@/lib/tools/list-shopify-locations";
import { spec as updateShopifyConfigSpec } from "@/lib/tools/update-shopify-config";
import { spec as updateShopifyConnectionSpec } from "@/lib/tools/update-shopify-connection";
import { spec as setupShopifyCallbackSpec } from "@/lib/tools/setup-shopify-callback";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  get_shopify_config: ["shop_name"],
  list_shopify_delivery_methods: ["shop_name"],
  list_shopify_locations: ["shop_name"],
  update_shopify_config: ["shop_name"],
  update_shopify_connection: [
    "shop_name",
    "code",
    "is_fulfillment",
    "token",
    "user_id",
  ],
  setup_shopify_callback: ["shop_name", "code", "is_fulfillment"],
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
    spec: getShopifyConfigSpec,
    substrings: [
      "/shopify/config",
      "401",
      // Must point at the LIVE catalogs as companions for building update payloads.
      "list_shopify_delivery_methods",
    ],
  },
  {
    spec: listShopifyDeliveryMethodsSpec,
    substrings: [
      "/shopify/delivery-methods",
      "401",
      // LIVE-vs-SAVED disambiguation.
      "get_shopify_config",
    ],
  },
  {
    spec: listShopifyLocationsSpec,
    substrings: [
      "/shopify/locations",
      "401",
      "get_shopify_config",
    ],
  },
  {
    spec: updateShopifyConfigSpec,
    substrings: [
      "/shopify/config",
      "401",
      // Must call out the sibling write (credentials).
      "update_shopify_connection",
    ],
  },
  {
    spec: updateShopifyConnectionSpec,
    substrings: [
      "/shopify/connection",
      "401",
      // Sibling write (mapping/config).
      "update_shopify_config",
    ],
  },
  {
    spec: setupShopifyCallbackSpec,
    substrings: [
      "/shopify/callback",
      "401",
      "update_shopify_connection",
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
 * STATIC: sensitive-token + single-use-OAuth-code language.
 *
 * Two assertions:
 *   - update_shopify_connection MUST flag the token as sensitive/secret.
 *     Phrase contract: description.toLowerCase() contains "sensitive" OR
 *     "secret" (T-02-12).
 *   - setup_shopify_callback MUST flag the OAuth code as single-use
 *     (T-02-13). Phrase contract: description contains "single-use"
 *     (case-insensitive).
 *
 * Score = fraction of assertions passing. EVAL_GATE pin to 1.0.
 */
export const sensitiveAndSingleUseLanguage: Evaluator = async () => {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;

  total += 1;
  const connDesc = updateShopifyConnectionSpec.description.toLowerCase();
  if (connDesc.includes("sensitive") || connDesc.includes("secret")) {
    passed += 1;
  } else {
    failures.push(
      `update_shopify_connection: description missing "sensitive" or "secret" (T-02-12)`,
    );
  }

  total += 1;
  const cbDesc = setupShopifyCallbackSpec.description.toLowerCase();
  if (cbDesc.includes("single-use")) {
    passed += 1;
  } else {
    failures.push(
      `setup_shopify_callback: description missing "single-use" (T-02-13)`,
    );
  }

  return {
    name: "sensitive-and-single-use-language",
    value: total > 0 ? passed / total : 0,
    comment:
      failures.length === 0
        ? `${passed}/${total} sensitive/single-use assertions passed`
        : `${passed}/${total}; failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  sensitiveAndSingleUseLanguage,
];
