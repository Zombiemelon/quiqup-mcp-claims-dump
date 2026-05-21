/**
 * Scorers for the Phase-4 missions family eval (missions-v1).
 *
 * Five scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — accepts single name or array.
 *
 *   2. required-fields-present (0..1)   — per-tool rules:
 *        create_mission         → depotId, orderIds, type, zone
 *        transfer_mission_orders → mission_id, order_ids, confirm
 *
 *   3. args-overlap (0..1)              — wrapped from ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)       — STATIC; per-tool substring
 *      checklist on production spec.description (endpoint marker,
 *      D-05 gating language, identity-binding, error modes, example).
 *
 *   5. gating-asymmetry-lock (0/1)      — STATIC structural assertion;
 *      the critical D-05 lock. Asserts:
 *        - `create_mission.inputSchema.shape` does NOT contain `confirm`
 *          (D-05: create is NOT destructive-gated); AND
 *        - `transfer_mission_orders.inputSchema.shape` DOES contain
 *          `confirm` with the canonical "DESTRUCTIVE-GATE:" description
 *          prefix; AND
 *        - `transfer_mission_orders.inputSchema.shape` DOES contain
 *          `dry_run` with the canonical "DRY-RUN:" description prefix.
 *
 *      D-05 decision flip — gating create_mission OR removing the gate
 *      from transfer_mission_orders — would trip this scorer at CI.
 *      A maintainer who decides "actually let's gate create_mission too"
 *      can do so, but they MUST simultaneously edit this scorer and the
 *      04-CONTEXT.md decision record — both edits PR-visible.
 *
 *      Locks T-04-27.
 *
 * Lenient on tool-name + args; STRICT on the D-05 gating split.
 */

import type { Evaluator } from "@langfuse/client";

import { argsOverlap as _argsOverlap } from "./score-tool-call";

import { spec as createMissionSpec } from "@/lib/tools/create-mission";
import { spec as transferMissionOrdersSpec } from "@/lib/tools/transfer-mission-orders";

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
  create_mission: ["depotId", "orderIds", "type", "zone"],
  transfer_mission_orders: ["mission_id", "order_ids", "confirm"],
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
    spec: createMissionSpec,
    substrings: [
      "/quiqdash/missions",
      "401",
      // D-05 gating language — description must explain WHY this tool
      // is NOT destructive-gated (vs. transfer_mission_orders which is).
      "NOT destructive",
      "transfer_mission_orders",
    ],
  },
  {
    spec: transferMissionOrdersSpec,
    substrings: [
      "/quiqdash/missions/transfer/",
      "DESTRUCTIVE",
      "confirm: true",
      // D-05 cross-reference — description must name the create_mission
      // companion and explain the asymmetry.
      "create_mission",
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
 * STATIC: gating-asymmetry-lock — the critical D-05 lock.
 *
 * Asserts the exact gating split decided in 04-CONTEXT.md decision 5:
 *   - create_mission         → NOT destructive-gated (pure additive
 *                              creation; no resource overwritten).
 *   - transfer_mission_orders → DESTRUCTIVE-gated (moves orders between
 *                              missions; mutates dispatch state on both
 *                              source AND target mission).
 *
 * Three structural assertions:
 *   1. `confirm` NOT in create_mission.inputSchema.shape.
 *   2. `confirm` IS in transfer_mission_orders.inputSchema.shape AND
 *      its description starts with "DESTRUCTIVE-GATE:" (the canonical
 *      destructiveConfirmField prefix from lib/middleware/destructive.ts).
 *   3. `dry_run` IS in transfer_mission_orders.inputSchema.shape AND
 *      its description starts with "DRY-RUN:".
 *
 * Decision flips that would trip this scorer:
 *   - Adding confirm to create_mission (e.g. "let's add a safety net
 *     to mission creation too") → fails assertion 1.
 *   - Removing confirm from transfer_mission_orders → fails 2.
 *   - Removing dry_run from transfer_mission_orders → fails 3.
 *   - Replacing the canonical destructive helpers with a custom field
 *     (description prefix would no longer match) → fails 2 or 3.
 *
 * Locks T-04-27 — D-05 gating flip.
 */
function getFieldDescription(field: unknown): string | undefined {
  const f = field as { description?: string; _def?: { description?: string } };
  return f?.description ?? f?._def?.description;
}

export const gatingAsymmetryLock: Evaluator = async () => {
  const failures: string[] = [];

  // 1. create_mission must NOT have confirm.
  const cmShape = (
    createMissionSpec.inputSchema as unknown as {
      shape: Record<string, unknown>;
    }
  ).shape;
  if ("confirm" in cmShape && cmShape.confirm !== undefined) {
    failures.push(
      "create_mission: unexpected DESTRUCTIVE confirm field — D-05 says create is NON-destructive",
    );
  }

  // 2. transfer_mission_orders must have confirm with DESTRUCTIVE-GATE: prefix.
  const tmoShape = (
    transferMissionOrdersSpec.inputSchema as unknown as {
      shape: Record<string, unknown>;
    }
  ).shape;
  if (!tmoShape.confirm) {
    failures.push(
      "transfer_mission_orders: missing confirm field — D-05 says transfer IS destructive-gated",
    );
  } else {
    const desc = getFieldDescription(tmoShape.confirm);
    if (!desc || !desc.startsWith("DESTRUCTIVE-GATE:")) {
      failures.push(
        `transfer_mission_orders: confirm.description does not start with "DESTRUCTIVE-GATE:" (got ${JSON.stringify(desc ?? null)}) — likely not the canonical destructiveConfirmField`,
      );
    }
  }

  // 3. transfer_mission_orders must have dry_run with DRY-RUN: prefix.
  if (!tmoShape.dry_run) {
    failures.push("transfer_mission_orders: missing dry_run field");
  } else {
    const desc = getFieldDescription(tmoShape.dry_run);
    if (!desc || !desc.startsWith("DRY-RUN:")) {
      failures.push(
        `transfer_mission_orders: dry_run.description does not start with "DRY-RUN:" (got ${JSON.stringify(desc ?? null)})`,
      );
    }
  }

  return {
    name: "gating-asymmetry-lock",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "D-05 gating asymmetry held: create_mission has no confirm field; transfer_mission_orders wires the canonical destructive confirm + dry_run (T-04-27 locked)"
        : `D-05 VIOLATION — failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  gatingAsymmetryLock,
];
