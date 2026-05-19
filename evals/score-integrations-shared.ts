/**
 * Scorers for the Phase-2 shared-integrations family eval
 * (integrations-shared-v1) — covers the 5 cross-storefront tools:
 *   list_integration_connections, list_integration_order_reasons,
 *   repair_integration_orders, get_integration_order, confirm_ff_export.
 *
 * Four scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)         — wraps ./score-tool-call.ts so the
 *      literal scorer name is owned by this file (eval-gate grep audit).
 *
 *   2. required-fields-present (0..1) — per-tool rules:
 *        repair_integration_orders → ids + order_name + shop_name + site_url +
 *                                    source + user_id + start_date + end_date
 *        list_integration_order_reasons → sales_channel + status + start_date +
 *                                         end_date + user_id + limit + offset
 *        get_integration_order → order_uuid
 *        confirm_ff_export → order_uuid
 *        list_integration_connections → no required fields (environment defaults)
 *
 *   3. args-overlap (0..1)            — wraps ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)     — STATIC; per-tool substring checklist on
 *      production `spec.description`. Each tool MUST contain its endpoint
 *      path AND "401" AND (where applicable) the canonical companion-tool
 *      reference (e.g. get_integration_order description mentions
 *      repair_integration_orders).
 *
 * Lenient by design — extras don't penalize. Mirrors the
 * eval-driven-description-improvement pattern from Phase 1 (T-01-26).
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as listIntegrationConnectionsSpec } from "@/lib/tools/list-integration-connections";
import { spec as listIntegrationOrderReasonsSpec } from "@/lib/tools/list-integration-order-reasons";
import { spec as repairIntegrationOrdersSpec } from "@/lib/tools/repair-integration-orders";
import { spec as getIntegrationOrderSpec } from "@/lib/tools/get-integration-order";
import { spec as confirmFfExportSpec } from "@/lib/tools/confirm-ff-export";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

/**
 * Per-tool required-fields rules. Each entry lists the args the upstream
 * endpoint hard-requires (no Zod default). The scorer reports the fraction
 * of required args present.
 */
const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  list_integration_connections: [],
  list_integration_order_reasons: [
    "sales_channel",
    "status",
    "start_date",
    "end_date",
    "user_id",
    "limit",
    "offset",
  ],
  repair_integration_orders: [
    "ids",
    "order_name",
    "shop_name",
    "site_url",
    "source",
    "user_id",
    "start_date",
    "end_date",
  ],
  get_integration_order: ["order_uuid"],
  confirm_ff_export: ["order_uuid"],
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
      comment: `no required args for ${expectedTool ?? "<unknown tool>"}`,
    };
  }
  const present = required.filter((k) => k in args);
  return {
    name: "required-fields-present",
    value: present.length / required.length,
    comment: `${present.length}/${required.length}: [${present.join(", ")}]`,
  };
};

/**
 * Description-quality assertions per shared-integrations tool.
 *
 * Each tool gets a per-tool substring checklist. Failures land the score
 * below 1.0 and the EVAL_GATE block fails the run (min 1.0).
 */
interface DescriptionCheck {
  spec: { name: string; description: string };
  substrings: string[];
}

const DESCRIPTION_CHECKS: DescriptionCheck[] = [
  {
    spec: listIntegrationConnectionsSpec,
    substrings: [
      "/integrations/connections",
      "401",
      // Cross-family catalog reference — should mention sibling family tools.
      "list_woocommerce_connections",
    ],
  },
  {
    spec: listIntegrationOrderReasonsSpec,
    substrings: [
      "/integrations/order-reasons",
      "401",
      // Triage table — must point at repair_integration_orders as the companion.
      "repair_integration_orders",
    ],
  },
  {
    spec: repairIntegrationOrdersSpec,
    substrings: [
      "/integrations/repair-orders",
      "401",
      // Repair flow — must reference list_integration_order_reasons as the
      // upstream that produces the ids[].
      "list_integration_order_reasons",
    ],
  },
  {
    spec: getIntegrationOrderSpec,
    substrings: [
      "/order/",
      "401",
      // Post-repair re-fetch path — canonical companion is repair_integration_orders.
      "repair_integration_orders",
    ],
  },
  {
    spec: confirmFfExportSpec,
    substrings: [
      "/orders/confirm-ff-export",
      "401",
      // Ack flow — pair with get_integration_order to verify status flip.
      "get_integration_order",
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
