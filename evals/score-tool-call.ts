/**
 * Scorers for the create_lastmile_order eval.
 *
 * Three item-level evaluators reported as scores on each trace in Langfuse:
 *   - tool-name-match (0/1)        — did the LLM pick the right tool?
 *   - required-fields-present (0..1) — fraction of must-have top-level args
 *   - args-overlap (0..1)          — leaf-level overlap with expected args
 *
 * Lenient by design: extras in the LLM output don't penalize, string
 * matches are case/substring insensitive. The point is signal on tool-use
 * quality, not exact JSON equality.
 */

import type { Evaluator } from "@langfuse/client";

const REQUIRED_TOP_LEVEL = ["origin", "destination", "payment_mode", "items"] as const;

export const toolNameMatch: Evaluator = async ({ output, expectedOutput }) => {
  const actual = (output as { tool?: string } | undefined)?.tool ?? null;
  const expected = (expectedOutput as { tool?: string } | undefined)?.tool ?? null;
  const match = actual !== null && actual === expected;
  return {
    name: "tool-name-match",
    value: match ? 1.0 : 0.0,
    comment: match
      ? `Called ${actual}`
      : `Expected ${expected ?? "<none>"}, got ${actual ?? "<no tool call>"}`,
  };
};

export const requiredFieldsPresent: Evaluator = async ({ output }) => {
  const args = (output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const present = REQUIRED_TOP_LEVEL.filter((k) => k in args);
  return {
    name: "required-fields-present",
    value: present.length / REQUIRED_TOP_LEVEL.length,
    comment: `${present.length}/${REQUIRED_TOP_LEVEL.length}: [${present.join(", ")}]`,
  };
};

function isNumericLike(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n);
  }
  return false;
}

function overlap(expected: unknown, actual: unknown): { matched: number; total: number } {
  if (expected === null || expected === undefined) {
    return { matched: 1, total: 1 };
  }
  if (typeof expected !== "object") {
    if (typeof expected === "string" && typeof actual === "string") {
      const hit = actual.toLowerCase().includes(expected.toLowerCase());
      return { matched: hit ? 1 : 0, total: 1 };
    }
    if (typeof expected === "number" && typeof actual === "number") {
      return { matched: expected === actual ? 1 : 0, total: 1 };
    }
    // Cross-type: if both sides parse as finite numbers, compare numerically.
    // Handles "0.0" vs 0, "150.0" vs 150 — common LLM type drift on numeric
    // fields where the API accepts either representation.
    if (isNumericLike(expected) && isNumericLike(actual)) {
      return { matched: Number(expected) === Number(actual) ? 1 : 0, total: 1 };
    }
    // Fallback: stringwise.
    return { matched: String(expected) === String(actual) ? 1 : 0, total: 1 };
  }
  if (Array.isArray(expected)) {
    const actualArr = Array.isArray(actual) ? actual : [];
    let m = 0;
    let t = 1; // length-or-greater check
    if (actualArr.length >= expected.length) m += 1;
    // Sample first item if both have entries.
    if (expected[0] !== undefined && actualArr[0] !== undefined) {
      const sub = overlap(expected[0], actualArr[0]);
      m += sub.matched;
      t += sub.total;
    }
    return { matched: m, total: t };
  }
  let matched = 0;
  let total = 0;
  for (const k of Object.keys(expected as Record<string, unknown>)) {
    const sub = overlap(
      (expected as Record<string, unknown>)[k],
      (actual as Record<string, unknown> | undefined)?.[k],
    );
    matched += sub.matched;
    total += sub.total;
  }
  return { matched, total };
}

export const argsOverlap: Evaluator = async ({ output, expectedOutput }) => {
  const a = (output as { args?: unknown } | undefined)?.args ?? {};
  const e = (expectedOutput as { args?: unknown } | undefined)?.args ?? {};
  const { matched, total } = overlap(e, a);
  // When the dataset specifies no expected args (total === 0), the tool
  // truly requires no arguments — a correct empty call IS a perfect match.
  // Returning 0 here would deterministically tank the average for any
  // family whose canonical tools have empty/default args (e.g. `list_*`
  // tools), as observed in get-account (4/7) and woocommerce-integration
  // (2/7) where the args-overlap score was capped below threshold by
  // construction, regardless of LLM behavior.
  return {
    name: "args-overlap",
    value: total > 0 ? matched / total : 1,
    comment:
      total > 0
        ? `${matched}/${total} leaf matches`
        : "no required args — empty call accepted as perfect match",
  };
};

export const evaluators = [toolNameMatch, requiredFieldsPresent, argsOverlap];
