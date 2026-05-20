/**
 * Scorers for the Phase-3 Orders Core GraphQL family eval
 * (orders-graphql-v1).
 *
 * Four scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — wrapped from ./score-tool-call.ts.
 *
 *   2. required-fields-present (0..1)   — per-tool rules:
 *        bulk_orders_lookup → client_order_ids
 *        lookup_orders_ids  → none hard-required (every input field has a
 *                              default OR is naturally optional — agent
 *                              picks `first` + `where` as needed).
 *
 *   3. args-overlap (0..1)              — wrapped from ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)       — STATIC; per-tool substring checklist
 *      on production spec.description. Asserts:
 *        - lookup_orders_ids description contains "ordersListingIdsQuery"
 *          (endpoint marker), "401" (error-modes), and "bulk_orders_lookup"
 *          (cross-tool disambiguation).
 *        - bulk_orders_lookup description contains "bulkOrdersLookupQuery"
 *          (endpoint marker), "401", and "lookup_orders_ids" (companion).
 *        - both descriptions include the "Example:" literal.
 *      Returns proportion of assertions passed across both tools.
 *
 * Lenient by design — extras don't penalize, same philosophy as
 * ./score-tool-call.ts.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as lookupOrdersIdsSpec } from "@/lib/tools/lookup-orders-ids";
import { spec as bulkOrdersLookupSpec } from "@/lib/tools/bulk-orders-lookup";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  lookup_orders_ids: [],
  bulk_orders_lookup: ["client_order_ids"],
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
    spec: lookupOrdersIdsSpec,
    substrings: [
      // Endpoint / query-name marker.
      "ordersListingIdsQuery",
      // Error-modes section.
      "401",
      // Cross-tool disambiguation (must mention the companion tool).
      "bulk_orders_lookup",
      // Canonical example block.
      "Example:",
    ],
  },
  {
    spec: bulkOrdersLookupSpec,
    substrings: [
      "bulkOrdersLookupQuery",
      "401",
      "lookup_orders_ids",
      "Example:",
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

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
];
