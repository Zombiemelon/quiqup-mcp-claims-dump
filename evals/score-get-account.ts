/**
 * Scorers for the Phase-1 Platform-read family eval (get-account-v1).
 *
 * Four scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)         — did the LLM pick the right tool?
 *      Reused from ./score-tool-call.ts unchanged.
 *
 *   2. required-fields-present (0..1) — fraction of must-have args present.
 *      Platform reads have NO universally required arg (every input field
 *      is .default()-ed: `id` defaults to "me" on capabilities + addresses,
 *      `environment` defaults to "production" everywhere). The only tool
 *      where a caller MUST volunteer an `id` is `get_account_by_id`, so
 *      this scorer hard-codes that single conditional rule rather than a
 *      flat required-list.
 *
 *   3. args-overlap (0..1)           — leaf-level overlap with expected args.
 *      Reused from ./score-tool-call.ts unchanged.
 *
 *   4. description-quality (0..1)    — STATIC scorer that does NOT depend
 *      on the LLM output. Runs the same value for every dataset item:
 *      reads spec.description on each of the 5 read-family tools and
 *      asserts a per-tool checklist (endpoint path, "401" substring,
 *      disambiguation language like "whoami_platform" on get_account, etc.).
 *      Locks in the eval-driven-description-improvement loop documented
 *      in the .claude memory of the same name.
 *
 * Lenient by design — extras don't penalize, string match is
 * case/substring insensitive (same philosophy as ./score-tool-call.ts).
 */

import type { Evaluator } from "@langfuse/client";

import { toolNameMatch as _toolNameMatch, argsOverlap as _argsOverlap } from "./score-tool-call";

import { spec as getAccountSpec } from "@/lib/tools/get-account";
import { spec as getPermissionsSpec } from "@/lib/tools/get-permissions";
import { spec as getAccountCapabilitiesSpec } from "@/lib/tools/get-account-capabilities";
import { spec as getAccountByIdSpec } from "@/lib/tools/get-account-by-id";
import { spec as listAccountAddressesSpec } from "@/lib/tools/list-account-addresses";

/**
 * Thin wrappers around the generic tool-call scorers so this file
 * surfaces all four scorer names directly (the eval-gate grep
 * acceptance test in 01-04-PLAN.md counts `name: "..."` literals
 * per file). Behaviour is unchanged — the wrappers delegate to the
 * imports verbatim.
 */
export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

/**
 * Per-tool required-fields rule. Only `get_account_by_id` actually requires
 * the caller to specify `id` (no default). Every other read-family tool has
 * sensible defaults — surfacing them isn't a quality signal.
 */
export const requiredFieldsPresent: Evaluator = async ({ output, expectedOutput }) => {
  const args = (output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const expectedTool = (expectedOutput as { tool?: string } | undefined)?.tool ?? null;
  if (expectedTool === "get_account_by_id") {
    const present = "id" in args && typeof args.id === "string" && args.id.length > 0;
    return {
      name: "required-fields-present",
      value: present ? 1.0 : 0.0,
      comment: present
        ? "id supplied (required for get_account_by_id)"
        : "missing required `id` for get_account_by_id",
    };
  }
  // No hard-required fields for the other tools in this family.
  return {
    name: "required-fields-present",
    value: 1.0,
    comment: "no required args for this tool (defaults cover the surface)",
  };
};

/**
 * Description-quality assertions per Phase-1 Platform-read tool.
 *
 * Each tool gets a small per-tool checklist of substrings the description
 * MUST contain — the substrings encode the disambiguation language that
 * the .claude `eval-driven-description-improvement` memory captures as
 * regression-prone. If any substring is missing the scorer drops below 1.0
 * and the EVAL_GATE block in get-account.ts fails the run (min: 1.0).
 *
 * Note on the gating threshold: description-quality is a STATIC, item-
 * independent scorer. It returns the same value for every dataset item,
 * so the per-experiment average equals the per-item value — min: 1.0
 * means "every assertion passes" rather than "1.0 average across N
 * items".
 */
interface DescriptionCheck {
  spec: { name: string; description: string };
  substrings: string[];
}

const DESCRIPTION_CHECKS: DescriptionCheck[] = [
  {
    spec: getAccountSpec,
    substrings: [
      "/account",
      "401",
      // Disambiguation language — the eval-driven-description-improvement
      // memory's whole reason for existing.
      "whoami_platform",
      "get_account_by_id",
    ],
  },
  {
    spec: getPermissionsSpec,
    substrings: [
      "/permissions",
      "401",
      // get_permissions distinguishes itself from both get_account and
      // whoami_platform — the description must call out at least one.
      "whoami_platform",
    ],
  },
  {
    spec: getAccountCapabilitiesSpec,
    substrings: [
      "/accounts/{id}/capabilities",
      "401",
      "whoami_platform",
    ],
  },
  {
    spec: getAccountByIdSpec,
    substrings: [
      "/accounts/{id}",
      "401",
      "get_account",
    ],
  },
  {
    spec: listAccountAddressesSpec,
    substrings: [
      "/accounts/{id}/addresses",
      "401",
      "whoami_platform",
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
    // Length assertion (per-tool, contributes one slot to the score).
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
