/**
 * Scorers for the Phase-4 order-creation family eval (order-creation-v1).
 *
 * Six scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — accepts single name or array.
 *
 *   2. required-fields-present (0..1)   — per-tool rules:
 *        create_internal_fulfilment_order →
 *          partner_order_id, payment_mode, service_kind, source,
 *          needs_manual_confirmation
 *        bulk_create_orders               → csv_base64
 *
 *   3. args-overlap (0..1)              — wrapped + augmented with the
 *      BL-04 forbidden-keys check (a dataset item with
 *      `expectedOutput.forbidden_keys` set must produce chosen_args
 *      that contain NONE of those keys; if any forbidden key leaks
 *      through, the args-overlap score drops to 0 on that item).
 *
 *   4. description-quality (0..1)       — STATIC; substring checklist
 *      on both spec.description strings (endpoint marker, identity-
 *      binding warning, error modes, canonical example).
 *
 *   5. bl-04-server-binding (0/1)       — STATIC; imports both specs
 *      and asserts `Object.keys(spec.inputSchema.shape)` contains NONE
 *      of user_id / actor_id / actor_email / partner_id / uploader_id /
 *      actor. Locks T-04-30 — BL-04 server-binding regression on either
 *      creation tool would trip this scorer.
 *
 *   6. bulk-csv-cap-pin (0/1)           — STATIC source-inspection;
 *      readFile()s `lib/tools/bulk-create-orders.ts` and asserts the
 *      canonical 13_500_000 (~10MB after base64 decode) cap literal is
 *      present. Locks T-04-31 — bulk_create_orders 10MB cap regression
 *      would trip this scorer.
 *
 * Lenient on tool-name + args; STRICT on BL-04 + the bulk cap.
 */

import type { Evaluator } from "@langfuse/client";

import { argsOverlap as _argsOverlap } from "./score-tool-call";

import { spec as createInternalFulfilmentOrderSpec } from "@/lib/tools/create-internal-fulfilment-order";
import { spec as bulkCreateOrdersSpec } from "@/lib/tools/bulk-create-orders";

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

/**
 * args-overlap — extended to also penalize BL-04 violations: if the
 * dataset item specifies `forbidden_keys`, any forbidden key appearing
 * in the LLM's chosen_args zeroes the score on that item (the LLM was
 * told to pass user_id but the tool surface forbids it; agent compliance
 * is the test).
 */
export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  const base = { ...r, name: "args-overlap" };

  const forbidden = (
    ctx.expectedOutput as { forbidden_keys?: readonly string[] } | undefined
  )?.forbidden_keys;
  if (!forbidden || forbidden.length === 0) {
    return base;
  }
  const args =
    (ctx.output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const leaks = forbidden.filter((k) => k in args);
  if (leaks.length > 0) {
    return {
      ...base,
      value: 0.0,
      comment: `BL-04 violation: chosen_args contains forbidden caller-identity key(s) [${leaks.join(", ")}] — agent should have ignored them`,
    };
  }
  return base;
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  create_internal_fulfilment_order: [
    "partner_order_id",
    "payment_mode",
    "service_kind",
    "source",
    "needs_manual_confirmation",
  ],
  bulk_create_orders: ["csv_base64"],
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
    spec: createInternalFulfilmentOrderSpec,
    substrings: [
      "/internal/fulfilment/orders",
      "401",
      // Identity-binding warning — BL-04 lesson surfaced in the description
      // so the LLM knows not to pass caller-supplied identity fields.
      "user/actor/partner",
      "idempotency_key",
    ],
  },
  {
    spec: bulkCreateOrdersSpec,
    substrings: [
      "/quiqdash/bulk_orders",
      "multipart",
      "401",
      "BL-04",
      "10MB",
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
 * STATIC: bl-04-server-binding.
 *
 * Imports both creation tools' production specs and asserts
 * Object.keys(spec.inputSchema.shape) contains NONE of the forbidden
 * caller-identity field names. Mirrors the no-caller-identity-fields
 * scorer from 03-05 (upload_order_document) — adding `user_id: z.string()`
 * to either creation tool's schema would surface that key in `.shape`
 * and trip this scorer.
 *
 * Zod note: `.passthrough()` does NOT add keys to `.shape`, so a
 * passthrough-style schema cannot bypass this structural check.
 *
 * Locks T-04-30 — BL-04 regression on either creation tool.
 */
const FORBIDDEN_IDENTITY_KEYS = [
  "user_id",
  "actor_id",
  "actor_email",
  "partner_id",
  "uploader_id",
  "actor",
] as const;

export const bl04ServerBinding: Evaluator = async () => {
  const failures: string[] = [];
  for (const spec of [createInternalFulfilmentOrderSpec, bulkCreateOrdersSpec]) {
    const shape = (
      spec.inputSchema as unknown as { shape: Record<string, unknown> }
    ).shape;
    const keys = Object.keys(shape);
    const offenders = FORBIDDEN_IDENTITY_KEYS.filter((k) => keys.includes(k));
    if (offenders.length > 0) {
      failures.push(
        `${spec.name}: BL-04 VIOLATION — spec.inputSchema.shape contains forbidden caller-identity field(s): [${offenders.join(", ")}]`,
      );
    }
  }
  return {
    name: "bl-04-server-binding",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "create_internal_fulfilment_order + bulk_create_orders schemas contain no caller-identity fields — BL-04 server-binding holds (T-04-30 locked)"
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: bulk-csv-cap-pin.
 *
 * Source-inspection on bulk-create-orders.ts asserting the canonical
 * 10MB-after-base64-decode cap literal `13_500_000` is still present.
 * Locks T-04-31 — bulk_create_orders 10MB cap regression would trip
 * this scorer at the eval-gate layer.
 */
const BULK_SOURCE_PATH = "lib/tools/bulk-create-orders.ts";

export const bulkCsvCapPin: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), BULK_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "bulk-csv-cap-pin",
      value: 0.0,
      comment: `read failed for ${BULK_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }
  // Accept either `13_500_000` (preferred numeric-literal style) or
  // `13500000` (plain literal) — both are equivalent in JS.
  const present = raw.includes("13_500_000") || raw.includes("13500000");
  return {
    name: "bulk-csv-cap-pin",
    value: present ? 1.0 : 0.0,
    comment: present
      ? `${BULK_SOURCE_PATH} pins the 13_500_000 (~10MB after base64) CSV cap (T-04-31 held)`
      : `${BULK_SOURCE_PATH}: missing 13_500_000 / 13500000 literal — bulk-CSV cap may have regressed`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  bl04ServerBinding,
  bulkCsvCapPin,
];
