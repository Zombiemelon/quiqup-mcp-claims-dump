/**
 * Scorers for the Phase-2 destructive-integrations family eval
 * (destructive-integrations-v1).
 *
 * Five scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)
 *
 *   2. required-fields-present (0..1)   — per-tool rules:
 *        delete_integration_source → source + shop_name
 *        delete_salla_connection   → id
 *
 *   3. args-overlap (0..1)              — wraps ./score-tool-call.ts.
 *
 *   4. confirm-elicited (0/1)            — variant of args-overlap specific
 *      to the `confirm` field. Scores 1.0 iff the LLM's output args contain
 *      `confirm: true` (matching the expected). Reports SEPARATELY so a
 *      regression in the description's confirm-elicitation language
 *      (T-02-37) shows up at the trace level even when the broader
 *      args-overlap signal is still mostly green.
 *
 *   5. confirm-gate-present (0/1)        — STATIC; imports both delete
 *      tool specs AND the canonical `destructiveConfirmField` /
 *      `destructiveDryRunField` from lib/middleware/destructive.ts. Asserts:
 *        - spec.inputSchema.shape.confirm exists on BOTH delete tools, AND
 *          is the SAME Zod instance as `destructiveConfirmField`; AND
 *        - spec.inputSchema.shape.dry_run exists on BOTH delete tools,
 *          AND is the SAME Zod instance as `destructiveDryRunField`.
 *      Score = 1.0 only if all 4 identity assertions pass. A maintainer
 *      cannot silently remove or rename the gate without flipping this
 *      score to 0 (T-02-52).
 *
 * Lenient by design on tool-name + args; STRICT on the gate identity.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as deleteIntegrationSourceSpec } from "@/lib/tools/delete-integration-source";
import { spec as deleteSallaConnectionSpec } from "@/lib/tools/delete-salla-connection";
import {
  destructiveConfirmField,
  destructiveDryRunField,
} from "@/lib/middleware/destructive";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  delete_integration_source: ["source", "shop_name"],
  delete_salla_connection: ["id"],
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

/**
 * confirm-elicited: did the LLM output `confirm: true` exactly when the
 * expected args said it should? Scored independently of the broader
 * args-overlap so a regression in the confirm-elicitation language
 * (T-02-37) surfaces at the trace level.
 */
export const confirmElicited: Evaluator = async ({ output, expectedOutput }) => {
  const actualArgs =
    (output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const expectedArgs =
    (expectedOutput as { args?: Record<string, unknown> } | undefined)?.args ??
    {};

  const expectedConfirm = expectedArgs.confirm;
  const actualConfirm = actualArgs.confirm;

  // If the expected case has no confirm key, the scorer is a no-op pass.
  if (!("confirm" in expectedArgs)) {
    return {
      name: "confirm-elicited",
      value: 1.0,
      comment: "expected args do not require confirm",
    };
  }

  const match = actualConfirm === expectedConfirm;
  return {
    name: "confirm-elicited",
    value: match ? 1.0 : 0.0,
    comment: match
      ? `confirm matches expected (${String(expectedConfirm)})`
      : `expected confirm=${String(expectedConfirm)}, got ${String(actualConfirm ?? "<absent>")}`,
  };
};

/**
 * STATIC: confirm-gate-present — imports the canonical
 * destructiveConfirmField + destructiveDryRunField from
 * lib/middleware/destructive.ts and asserts spec.inputSchema.shape.confirm
 * AND spec.inputSchema.shape.dry_run are the SAME Zod instances on BOTH
 * destructive tools.
 *
 * A maintainer cannot remove or rename the gate without simultaneously
 * editing this scorer (which is PR-visible).
 */
export const confirmGatePresent: Evaluator = async () => {
  const failures: string[] = [];

  // Walk both tools and check both fields.
  type SpecLike = {
    name: string;
    inputSchema: { shape: Record<string, unknown> };
  };
  const checks: Array<{ spec: SpecLike; field: string; canonical: unknown }> = [
    {
      spec: deleteIntegrationSourceSpec as unknown as SpecLike,
      field: "confirm",
      canonical: destructiveConfirmField,
    },
    {
      spec: deleteIntegrationSourceSpec as unknown as SpecLike,
      field: "dry_run",
      canonical: destructiveDryRunField,
    },
    {
      spec: deleteSallaConnectionSpec as unknown as SpecLike,
      field: "confirm",
      canonical: destructiveConfirmField,
    },
    {
      spec: deleteSallaConnectionSpec as unknown as SpecLike,
      field: "dry_run",
      canonical: destructiveDryRunField,
    },
  ];

  for (const { spec, field, canonical } of checks) {
    const shape = spec.inputSchema?.shape ?? {};
    const present = field in shape && shape[field] !== undefined;
    if (!present) {
      failures.push(`${spec.name}: inputSchema.shape.${field} is missing`);
      continue;
    }
    // Strict identity — the spec field MUST be the canonical helper export.
    if (shape[field] !== canonical) {
      failures.push(
        `${spec.name}: inputSchema.shape.${field} is NOT the canonical destructive${field === "confirm" ? "ConfirmField" : "DryRunField"} (T-02-52)`,
      );
    }
  }

  return {
    name: "confirm-gate-present",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "both delete tools wire confirm + dry_run through the canonical destructive helper fields"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  confirmElicited,
  confirmGatePresent,
];
