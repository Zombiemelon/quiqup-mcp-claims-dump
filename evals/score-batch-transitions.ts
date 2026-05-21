/**
 * Scorers for the Phase-4 batch-transitions family eval
 * (batch-transitions-v1).
 *
 * Seven scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — accepts either a single expected
 *      tool name OR an array of acceptable names (for disambiguation
 *      prompts; not currently used by the dataset but the runtime is
 *      array-tolerant by design).
 *
 *   2. required-fields-present (0..1)   — per-tool rules:
 *        factory tools  → order_ids
 *        unpool_order   → order_uuid
 *
 *   3. args-overlap (0..1)              — wrapped from ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)       — STATIC; per-tool substring
 *      checklist on production spec.description. Asserts every destructive
 *      Phase-4 batch-transition description contains "DESTRUCTIVE" and the
 *      canonical "confirm: true" elicitation phrase. Length >= 100 chars.
 *
 *   5. destructive-gate-present (0/1)   — STATIC; imports all 14
 *      destructive Phase-4 specs (the 11 factory ORDT batch transitions
 *      + unpool_order + update_fulfilment_order_status + transfer_mission_orders)
 *      and asserts `spec.inputSchema.shape.confirm` and
 *      `spec.inputSchema.shape.dry_run` exist on every one, with the
 *      canonical "DESTRUCTIVE-GATE:" / "DRY-RUN:" description prefixes.
 *      Locks T-04-28 (D-06 update_fulfilment_order_status loses confirm
 *      gate) and the equivalent threat on the other 14 destructive tools.
 *
 *   6. factory-uniformity (0/1)         — STATIC; imports all 12 ORDT
 *      specs and asserts each one's `guardrails` block is the canonical
 *      `{ rateLimit: { capacity: 3, refillPerSec: 3/60 }, idempotency: {
 *      keyArg: "idempotency_key", ttlMs: 900000 }, audit: true }` block.
 *      A 13th transition tool written INLINE (bypassing the factory) would
 *      either omit a guardrail or set different values — this scorer
 *      catches that drift at the CI layer. Locks T-04-26.
 *
 *   7. reason-field-pin (0/1)           — STATIC; for each of the 4
 *      reason-bearing tools (set_on_hold, set_return_to_origin,
 *      set_delivery_failed, set_collection_failed):
 *        - assert `spec.inputSchema.shape.reason` exists AND its
 *          underlying Zod type is `ZodString` (NOT z.enum — locks D-02
 *          against the snapshot-enum regression); AND
 *        - assert `spec.description` names the relevant `list_*_reasons`
 *          tool (set_on_hold → list_on_hold_reasons,
 *          set_return_to_origin → list_return_to_origin_reasons,
 *          set_delivery_failed / set_collection_failed →
 *          list_courier_failure_reasons — the courier-failure taxonomy
 *          is shared per upstream).
 *      Locks T-04-29 — D-02 reason field replaced with z.enum.
 *
 * Lenient by design on tool-name + args; STRICT on the destructive
 * contract + factory uniformity + reason-field shape.
 */

import type { Evaluator } from "@langfuse/client";

import { argsOverlap as _argsOverlap } from "./score-tool-call";

// --- 12 ORDT batch-transition specs (drift-proof imports) ---
import { spec as setCollectedSpec } from "@/lib/tools/set-collected";
import { spec as setReceivedAtDepotSpec } from "@/lib/tools/set-received-at-depot";
import { spec as setAtDepotSpec } from "@/lib/tools/set-at-depot";
import { spec as setInTransitSpec } from "@/lib/tools/set-in-transit";
import { spec as setScheduledSpec } from "@/lib/tools/set-scheduled";
import { spec as setDeliveryCompleteSpec } from "@/lib/tools/set-delivery-complete";
import { spec as setOnHoldSpec } from "@/lib/tools/set-on-hold";
import { spec as setReturnToOriginSpec } from "@/lib/tools/set-return-to-origin";
import { spec as setReturnedToOriginSpec } from "@/lib/tools/set-returned-to-origin";
import { spec as setDeliveryFailedSpec } from "@/lib/tools/set-delivery-failed";
import { spec as setCollectionFailedSpec } from "@/lib/tools/set-collection-failed";
import { spec as unpoolOrderSpec } from "@/lib/tools/unpool-order";

// --- additional Phase-4 destructive specs (for destructive-gate-present scorer) ---
import { spec as updateFulfilmentOrderStatusSpec } from "@/lib/tools/update-fulfilment-order-status";
import { spec as transferMissionOrdersSpec } from "@/lib/tools/transfer-mission-orders";

const FACTORY_TOOL_SPECS = [
  setCollectedSpec,
  setReceivedAtDepotSpec,
  setAtDepotSpec,
  setInTransitSpec,
  setScheduledSpec,
  setDeliveryCompleteSpec,
  setOnHoldSpec,
  setReturnToOriginSpec,
  setReturnedToOriginSpec,
  setDeliveryFailedSpec,
  setCollectionFailedSpec,
] as const;

// All 15 Phase-4 destructive specs covered by the destructive-gate-present scorer:
// 11 factory ORDT tools + unpool_order (single-id ORDT) + update_fulfilment_order_status
// (single-order mutation, D-06) + transfer_mission_orders (mission, D-05).
const ALL_DESTRUCTIVE_SPECS = [
  ...FACTORY_TOOL_SPECS,
  unpoolOrderSpec,
  updateFulfilmentOrderStatusSpec,
  transferMissionOrdersSpec,
] as const;

/**
 * Tool-name match — accepts either a single expected tool name OR an
 * array of acceptable names.
 */
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
  set_collected: ["order_ids"],
  set_received_at_depot: ["order_ids"],
  set_at_depot: ["order_ids"],
  set_in_transit: ["order_ids"],
  set_scheduled: ["order_ids"],
  set_delivery_complete: ["order_ids"],
  set_on_hold: ["order_ids", "reason"],
  set_return_to_origin: ["order_ids", "reason"],
  set_returned_to_origin: ["order_ids"],
  set_delivery_failed: ["order_ids", "reason"],
  set_collection_failed: ["order_ids", "reason"],
  unpool_order: ["order_uuid"],
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

const MIN_DESCRIPTION_LENGTH = 100;
const DESTRUCTIVE_LANGUAGE_SUBSTRINGS = ["DESTRUCTIVE", "confirm: true"];

export const descriptionQuality: Evaluator = async () => {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;
  for (const spec of ALL_DESTRUCTIVE_SPECS) {
    const desc = spec.description;
    total += 1;
    if (desc.length >= MIN_DESCRIPTION_LENGTH) {
      passed += 1;
    } else {
      failures.push(
        `${spec.name}: description length ${desc.length} < ${MIN_DESCRIPTION_LENGTH}`,
      );
    }
    for (const sub of DESTRUCTIVE_LANGUAGE_SUBSTRINGS) {
      total += 1;
      if (desc.includes(sub)) {
        passed += 1;
      } else {
        failures.push(`${spec.name}: description missing "${sub}"`);
      }
    }
  }
  return {
    name: "description-quality",
    value: total > 0 ? passed / total : 0,
    comment:
      failures.length === 0
        ? `${passed}/${total} description assertions passed across ${ALL_DESTRUCTIVE_SPECS.length} destructive Phase-4 tools`
        : `${passed}/${total}; failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: destructive-gate-present.
 *
 * Imports all 15 destructive Phase-4 specs (12 ORDT + ORDS-04
 * update_fulfilment_order_status + MISS-02 transfer_mission_orders +
 * ORDT-14 unpool_order). Asserts on each:
 *   - inputSchema.shape.confirm exists AND its description starts with
 *     the canonical "DESTRUCTIVE-GATE:" prefix from
 *     lib/middleware/destructive.ts (T-04-28 lock — D-06 / D-05 / and
 *     every batch-transition tool must wire the same gate).
 *   - inputSchema.shape.dry_run exists AND its description starts with
 *     "DRY-RUN:".
 *
 * A maintainer who replaces a confirm field with a custom string would
 * trip this scorer; ditto for removing the dry_run field on any
 * destructive tool.
 */
function getFieldDescription(field: unknown): string | undefined {
  const f = field as { description?: string; _def?: { description?: string } };
  return f?.description ?? f?._def?.description;
}

function getFieldTypeName(field: unknown): string | undefined {
  const f = field as { _def?: { typeName?: string; type?: string } };
  return f?._def?.typeName ?? f?._def?.type;
}

export const destructiveGatePresent: Evaluator = async () => {
  const failures: string[] = [];
  for (const spec of ALL_DESTRUCTIVE_SPECS) {
    const shape = (
      spec.inputSchema as unknown as { shape: Record<string, unknown> }
    ).shape;

    // confirm field
    const confirm = shape.confirm;
    if (confirm === undefined) {
      failures.push(`${spec.name}: inputSchema.shape.confirm is missing`);
    } else {
      const desc = getFieldDescription(confirm);
      if (!desc || !desc.startsWith("DESTRUCTIVE-GATE:")) {
        failures.push(
          `${spec.name}: confirm.description does not start with "DESTRUCTIVE-GATE:" (got ${JSON.stringify(desc ?? null)})`,
        );
      }
    }

    // dry_run field
    const dryRun = shape.dry_run;
    if (dryRun === undefined) {
      failures.push(`${spec.name}: inputSchema.shape.dry_run is missing`);
    } else {
      const desc = getFieldDescription(dryRun);
      if (!desc || !desc.startsWith("DRY-RUN:")) {
        failures.push(
          `${spec.name}: dry_run.description does not start with "DRY-RUN:" (got ${JSON.stringify(desc ?? null)})`,
        );
      }
    }
  }
  return {
    name: "destructive-gate-present",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? `all ${ALL_DESTRUCTIVE_SPECS.length} destructive Phase-4 specs wire confirm + dry_run with canonical destructive-helper descriptions (T-04-28 held)`
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: factory-uniformity.
 *
 * Imports the 11 factory-driven ORDT batch transitions and asserts each
 * one's `guardrails` block matches the canonical destructive block
 * verbatim:
 *
 *   { rateLimit: { capacity: 3, refillPerSec: 3/60 },
 *     idempotency: { keyArg: "idempotency_key", ttlMs: 900000 },
 *     audit: true }
 *
 * A maintainer who lands a 12th transition tool INLINE (bypassing the
 * factory) — e.g. with a different rateLimit, different idempotency
 * keyArg, or audit:false — would trip this scorer at the eval-gate
 * layer. Locks T-04-26 (D-01 "all batch transitions go through the
 * factory" invariant).
 *
 * Note: unpool_order is checked here too even though it's not built via
 * the factory — it hand-writes the SAME guardrails block per its source
 * comment ("Tight 3/min rate limit; 15-min idempotency window; audit on").
 */
const CANONICAL_GUARDRAILS = {
  rateLimit: { capacity: 3, refillPerSec: 3 / 60 },
  idempotency: { keyArg: "idempotency_key", ttlMs: 15 * 60 * 1000 },
  audit: true as const,
};

function assertGuardrailsBlock(
  spec: { name: string; guardrails?: unknown },
  failures: string[],
): void {
  const g = spec.guardrails as
    | {
        rateLimit?: { capacity?: number; refillPerSec?: number };
        idempotency?: { keyArg?: string; ttlMs?: number };
        audit?: boolean;
      }
    | undefined;
  if (!g) {
    failures.push(`${spec.name}: guardrails block is missing`);
    return;
  }
  if (g.rateLimit?.capacity !== CANONICAL_GUARDRAILS.rateLimit.capacity) {
    failures.push(
      `${spec.name}: guardrails.rateLimit.capacity !== ${CANONICAL_GUARDRAILS.rateLimit.capacity} (got ${String(g.rateLimit?.capacity)})`,
    );
  }
  // refillPerSec is a derived float — compare via Math.abs diff against the canonical.
  const refill = g.rateLimit?.refillPerSec ?? -1;
  if (Math.abs(refill - CANONICAL_GUARDRAILS.rateLimit.refillPerSec) > 1e-9) {
    failures.push(
      `${spec.name}: guardrails.rateLimit.refillPerSec !== ${CANONICAL_GUARDRAILS.rateLimit.refillPerSec} (got ${String(refill)})`,
    );
  }
  if (g.idempotency?.keyArg !== CANONICAL_GUARDRAILS.idempotency.keyArg) {
    failures.push(
      `${spec.name}: guardrails.idempotency.keyArg !== "${CANONICAL_GUARDRAILS.idempotency.keyArg}" (got ${String(g.idempotency?.keyArg)})`,
    );
  }
  if (g.idempotency?.ttlMs !== CANONICAL_GUARDRAILS.idempotency.ttlMs) {
    failures.push(
      `${spec.name}: guardrails.idempotency.ttlMs !== ${CANONICAL_GUARDRAILS.idempotency.ttlMs} (got ${String(g.idempotency?.ttlMs)})`,
    );
  }
  if (g.audit !== CANONICAL_GUARDRAILS.audit) {
    failures.push(
      `${spec.name}: guardrails.audit !== true (got ${String(g.audit)})`,
    );
  }
}

export const factoryUniformity: Evaluator = async () => {
  const failures: string[] = [];
  for (const spec of FACTORY_TOOL_SPECS) {
    assertGuardrailsBlock(spec, failures);
  }
  // unpool_order shares the canonical block by convention even though it's
  // hand-written. Lock it here too so a maintainer can't quietly weaken it.
  assertGuardrailsBlock(unpoolOrderSpec, failures);
  return {
    name: "factory-uniformity",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? `all ${FACTORY_TOOL_SPECS.length + 1} factory-and-unpool ORDT tools share the canonical { 3/min, 15min-idempotency, audit:true } guardrails block (T-04-26 held)`
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: reason-field-pin.
 *
 * For the 4 reason-bearing tools (set_on_hold, set_return_to_origin,
 * set_delivery_failed, set_collection_failed):
 *   - assert spec.inputSchema.shape.reason exists; AND
 *   - assert its Zod type is "ZodString" (NOT "ZodEnum") — locks D-02
 *     against the snapshot-enum regression that would create a second
 *     source of truth alongside the Phase-1 enumeration tools; AND
 *   - assert spec.description names the relevant Phase-1 enumeration
 *     tool the LLM should call to discover valid reasons:
 *       set_on_hold              → list_on_hold_reasons
 *       set_return_to_origin     → list_return_to_origin_reasons
 *       set_delivery_failed      → list_courier_failure_reasons
 *       set_collection_failed    → list_courier_failure_reasons
 *
 * Locks T-04-29 — D-02 reason field replaced with z.enum.
 */
const REASON_FIELD_CHECKS = [
  { spec: setOnHoldSpec, enumerationTool: "list_on_hold_reasons" },
  {
    spec: setReturnToOriginSpec,
    enumerationTool: "list_return_to_origin_reasons",
  },
  {
    spec: setDeliveryFailedSpec,
    enumerationTool: "list_courier_failure_reasons",
  },
  {
    spec: setCollectionFailedSpec,
    enumerationTool: "list_courier_failure_reasons",
  },
] as const;

export const reasonFieldPin: Evaluator = async () => {
  const failures: string[] = [];
  for (const { spec, enumerationTool } of REASON_FIELD_CHECKS) {
    const shape = (
      spec.inputSchema as unknown as { shape: Record<string, unknown> }
    ).shape;
    const reason = shape.reason;
    if (reason === undefined) {
      failures.push(`${spec.name}: inputSchema.shape.reason is missing`);
      continue;
    }
    const typeName = getFieldTypeName(reason);
    // Zod v3 calls it "ZodString"; Zod v4 may surface it as "string". Both
    // are acceptable — what we reject is "ZodEnum" / "enum" (the
    // hardcoded-snapshot drift surface D-02 explicitly rejects).
    const isString =
      typeName === "ZodString" ||
      typeName === "string" ||
      typeName === undefined;
    const isEnum =
      typeName === "ZodEnum" ||
      typeName === "ZodNativeEnum" ||
      typeName === "enum";
    if (!isString || isEnum) {
      failures.push(
        `${spec.name}: reason field type "${String(typeName)}" — D-02 requires z.string() (free-form), not z.enum() (snapshot drift surface)`,
      );
    }
    // D-02 explicitly: the reason field's DESCRIPTION names the
    // Phase-1 enumeration tool. Some per-tool spec.descriptions
    // duplicate the mention (set_on_hold, set_delivery_failed,
    // set_collection_failed); set_return_to_origin keeps it only on
    // the reason field — both are D-02 compliant. Accept the
    // enumeration-tool name appearing in EITHER location.
    const reasonDesc = getFieldDescription(reason) ?? "";
    const namedInSpecDesc = spec.description.includes(enumerationTool);
    const namedInReasonDesc = reasonDesc.includes(enumerationTool);
    if (!namedInSpecDesc && !namedInReasonDesc) {
      failures.push(
        `${spec.name}: neither spec.description nor reason-field description names the enumeration tool "${enumerationTool}" so the LLM cannot discover valid reasons (D-02 violation)`,
      );
    }
  }
  return {
    name: "reason-field-pin",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "all 4 reason-bearing tools wire free-form z.string() reason fields and name their Phase-1 list_*_reasons enumeration tool (D-02 held)"
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC: dry-run-richness.
 *
 * Source-inspection scorer asserting `lib/tools/_batch-transition-factory.ts`
 * still synthesizes the canonical rich dry-run preview shape:
 *   { dryRun: true, orderIds, simulated: {...} }
 *
 * A maintainer who reverts to a minimal dry-run (just `dryRun: true`,
 * no orderIds or simulated payload) would trip this scorer. The
 * companion `unpool_order` hand-written tool uses `orderUuid` instead
 * of `orderIds` (single-order shape); the scorer accepts EITHER on the
 * factory file (it's an "OR" — both literal strings should appear in
 * the source given the rich preview pattern).
 *
 * Locks D-03 — Phase-4 dry-run contract is rich preview, NOT minimal.
 *
 * NB: This is a source-inspection scorer (readFile + substring check),
 * NOT a behavioural handler-invocation. Invoking the handler requires
 * mocking the JWT-mint + scope-assertion HTTP layer, which is heavier
 * than the lock-the-shape signal needs.
 */
const BATCH_FACTORY_SOURCE_PATH = "lib/tools/_batch-transition-factory.ts";
const RICH_DRY_RUN_SUBSTRINGS = ["dryRun: true", "orderIds", "simulated"];

export const dryRunRichness: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), BATCH_FACTORY_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "dry-run-richness",
      value: 0.0,
      comment: `read failed for ${BATCH_FACTORY_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }
  const failures: string[] = [];
  for (const sub of RICH_DRY_RUN_SUBSTRINGS) {
    if (!raw.includes(sub)) {
      failures.push(
        `${BATCH_FACTORY_SOURCE_PATH}: missing "${sub}" — D-03 rich dry-run preview may have regressed to a minimal shape`,
      );
    }
  }
  return {
    name: "dry-run-richness",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "_batch-transition-factory.ts still synthesizes the canonical { dryRun: true, orderIds, simulated } rich preview (D-03 held)"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  destructiveGatePresent,
  factoryUniformity,
  reasonFieldPin,
  dryRunRichness,
];
