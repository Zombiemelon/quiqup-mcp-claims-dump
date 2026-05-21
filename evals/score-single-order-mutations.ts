/**
 * Scorers for the Phase-4 single-order-mutations family eval
 * (single-order-mutations-v1).
 *
 * Six scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — accepts single name or array.
 *
 *   2. required-fields-present (0..1)   — per-tool rules:
 *        export_order                   → order_id
 *        update_fulfilment_order_status → order_id, status, confirm
 *        create_order_charge            → order_id, amount, currency
 *        update_order_weight            → order_id, weight_kg
 *
 *   3. args-overlap (0..1)              — wrapped from ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)       — STATIC; per-tool substring
 *      checklist on production spec.description (endpoint marker, error
 *      modes, canonical example).
 *
 *   5. destructive-gate-present-ords-04 (0/1) — STATIC; asserts
 *      update_fulfilment_order_status.inputSchema.shape.confirm exists
 *      AND its description starts with "DESTRUCTIVE-GATE:" AND
 *      shape.dry_run exists with "DRY-RUN:" prefix. The OTHER 3 tools
 *      are NOT destructive (D-06 split — only ORDS-04 is gated), so the
 *      scorer asserts their shapes do NOT contain `confirm` either —
 *      preventing a maintainer from accidentally gating export_order /
 *      create_order_charge / update_order_weight (which would be a UX
 *      regression: every charge / weight-edit shouldn't require a
 *      confirm-elicitation handshake).
 *
 *   6. numeric-bounds-pin (0/1)         — STATIC source-inspection;
 *      readFile()s `lib/tools/create-order-charge.ts` and
 *      `lib/tools/update-order-weight.ts`. Asserts:
 *        - create-order-charge.ts contains the `100_000` literal cap
 *          (T-04-13 — agent-abuse mitigation on amount).
 *        - update-order-weight.ts contains the `1000` literal cap
 *          (T-04-14 — absurd-weight mitigation).
 *      Locks T-04-32 — numeric-bound regression on either tool would
 *      trip the eval gate.
 *
 * Lenient on tool-name + args; STRICT on the D-06 gating split and the
 * numeric caps.
 */

import type { Evaluator } from "@langfuse/client";

import { argsOverlap as _argsOverlap } from "./score-tool-call";

import { spec as exportOrderSpec } from "@/lib/tools/export-order";
import { spec as updateFulfilmentOrderStatusSpec } from "@/lib/tools/update-fulfilment-order-status";
import { spec as createOrderChargeSpec } from "@/lib/tools/create-order-charge";
import { spec as updateOrderWeightSpec } from "@/lib/tools/update-order-weight";

export const toolNameMatch: Evaluator = async ({ output, expectedOutput }) => {
  const actual = (output as { tool?: string } | undefined)?.tool ?? null;
  const expected = (expectedOutput as { tool?: string | string[] } | undefined)
    ?.tool;
  const acceptable: string[] = Array.isArray(expected)
    ? expected
    : expected
      ? [expected]
      : [];
  const match = actual !== null && acceptable.includes(actual);
  return {
    name: "tool-name-match",
    value: match ? 1.0 : 0.0,
    comment: match
      ? `Called ${actual}`
      : `Expected one of [${acceptable.join(", ") || "<none>"}], got ${actual ?? "<no tool call>"}`,
  };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  export_order: ["order_id"],
  update_fulfilment_order_status: ["order_id", "status", "confirm"],
  create_order_charge: ["order_id", "amount", "currency"],
  update_order_weight: ["order_id", "weight_kg"],
};

export const requiredFieldsPresent: Evaluator = async ({
  output,
  expectedOutput,
}) => {
  const args =
    (output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const expectedTool =
    (expectedOutput as { tool?: string | string[] } | undefined)?.tool;
  const actualTool = (output as { tool?: string } | undefined)?.tool ?? null;
  const toolKey =
    actualTool && REQUIRED_FIELDS[actualTool]
      ? actualTool
      : typeof expectedTool === "string"
        ? expectedTool
        : Array.isArray(expectedTool) && expectedTool[0]
          ? expectedTool[0]
          : null;
  const required = toolKey ? REQUIRED_FIELDS[toolKey] ?? [] : [];
  if (required.length === 0) {
    return {
      name: "required-fields-present",
      value: 1.0,
      comment: `no required args for ${toolKey ?? "<unknown>"}`,
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
    spec: exportOrderSpec,
    substrings: [
      "/orders/export/",
      "401",
      "Example:",
      "scope-checked",
    ],
  },
  {
    spec: updateFulfilmentOrderStatusSpec,
    substrings: [
      "/api/fulfilment/orders/",
      "401",
      "DESTRUCTIVE",
      "confirm: true",
      "Example:",
    ],
  },
  {
    spec: createOrderChargeSpec,
    substrings: [
      "/quiqdash/order-charge",
      "401",
      "100,000",
      "T-04-13",
      "Example:",
    ],
  },
  {
    spec: updateOrderWeightSpec,
    substrings: [
      "/quiqdash/orders/",
      "weight",
      "401",
      "1000",
      "T-04-14",
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

/**
 * STATIC: destructive-gate-present-ords-04.
 *
 * D-06 locks the gating split: ONLY update_fulfilment_order_status is
 * destructive among the 4 single-order mutations. This scorer asserts:
 *   - update_fulfilment_order_status has shape.confirm with
 *     "DESTRUCTIVE-GATE:" description AND shape.dry_run with "DRY-RUN:".
 *   - export_order, create_order_charge, update_order_weight do NOT
 *     have a confirm field on their input shape (preventing accidental
 *     over-gating).
 *
 * A maintainer who adds confirm:true to create_order_charge (e.g. as a
 * "safety net" for financial side-effects) would trip this scorer —
 * making the over-gate decision PR-visible.
 */
function getFieldDescription(field: unknown): string | undefined {
  const f = field as { description?: string; _def?: { description?: string } };
  return f?.description ?? f?._def?.description;
}

export const destructiveGatePresentOrds04: Evaluator = async () => {
  const failures: string[] = [];

  // The ONE destructive tool: update_fulfilment_order_status.
  const ufosShape = (
    updateFulfilmentOrderStatusSpec.inputSchema as unknown as {
      shape: Record<string, unknown>;
    }
  ).shape;
  if (!ufosShape.confirm) {
    failures.push(
      "update_fulfilment_order_status: shape.confirm is missing (D-06 requires DESTRUCTIVE gate)",
    );
  } else {
    const desc = getFieldDescription(ufosShape.confirm);
    if (!desc || !desc.startsWith("DESTRUCTIVE-GATE:")) {
      failures.push(
        `update_fulfilment_order_status: confirm.description does not start with "DESTRUCTIVE-GATE:"`,
      );
    }
  }
  if (!ufosShape.dry_run) {
    failures.push("update_fulfilment_order_status: shape.dry_run is missing");
  } else {
    const desc = getFieldDescription(ufosShape.dry_run);
    if (!desc || !desc.startsWith("DRY-RUN:")) {
      failures.push(
        `update_fulfilment_order_status: dry_run.description does not start with "DRY-RUN:"`,
      );
    }
  }

  // The THREE non-destructive tools must NOT have confirm.
  for (const spec of [exportOrderSpec, createOrderChargeSpec, updateOrderWeightSpec]) {
    const shape = (
      spec.inputSchema as unknown as { shape: Record<string, unknown> }
    ).shape;
    if ("confirm" in shape && shape.confirm !== undefined) {
      failures.push(
        `${spec.name}: unexpected DESTRUCTIVE confirm field — D-06 keeps this tool NON-destructive (over-gating regression)`,
      );
    }
  }

  return {
    name: "destructive-gate-present-ords-04",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "update_fulfilment_order_status wires the canonical destructive gate; export_order / create_order_charge / update_order_weight remain non-destructive (D-06 split held)"
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: numeric-bounds-pin.
 *
 * Source-inspection on create-order-charge.ts and update-order-weight.ts
 * — asserts the canonical numeric caps are still present in source:
 *   - create-order-charge.ts contains the `100_000` literal (T-04-13).
 *   - update-order-weight.ts contains the `1000` literal (T-04-14, on
 *     the weight_kg field; checks for `.max(1000)` to dodge false
 *     positives on other numeric literals in the file).
 *
 * A maintainer who relaxes either cap (`.max(1_000_000)` etc.) would
 * trip this scorer at the eval-gate layer.
 */
const CHARGE_SOURCE_PATH = "lib/tools/create-order-charge.ts";
const WEIGHT_SOURCE_PATH = "lib/tools/update-order-weight.ts";

export const numericBoundsPin: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  let chargeSrc = "";
  let weightSrc = "";
  try {
    chargeSrc = await readFile(
      path.resolve(process.cwd(), CHARGE_SOURCE_PATH),
      "utf-8",
    );
    weightSrc = await readFile(
      path.resolve(process.cwd(), WEIGHT_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "numeric-bounds-pin",
      value: 0.0,
      comment: `read failed: ${(err as Error).message}`,
    };
  }

  const failures: string[] = [];
  // Accept either `100_000` (preferred numeric-literal style) or
  // `100000` (plain literal) — both are equivalent in JS and the
  // production file uses the underscore form.
  if (!chargeSrc.includes("100_000") && !chargeSrc.includes("100000")) {
    failures.push(
      `${CHARGE_SOURCE_PATH}: missing 100_000 / 100000 literal — T-04-13 amount cap may have regressed`,
    );
  }
  if (!weightSrc.includes(".max(1000)") && !weightSrc.includes(".max(1_000)")) {
    failures.push(
      `${WEIGHT_SOURCE_PATH}: missing \`.max(1000)\` — T-04-14 weight cap may have regressed`,
    );
  }

  return {
    name: "numeric-bounds-pin",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "create-order-charge.ts pins 100_000 (T-04-13); update-order-weight.ts pins .max(1000) (T-04-14)"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  destructiveGatePresentOrds04,
  numericBoundsPin,
];
