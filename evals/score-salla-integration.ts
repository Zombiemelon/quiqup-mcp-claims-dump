/**
 * Scorers for the Phase-2 Salla integration family eval
 * (salla-integration-v1).
 *
 * Six scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)
 *   2. required-fields-present (0..1)
 *   3. args-overlap (0..1)
 *   4. description-quality (0..1)        — STATIC; per-tool substring
 *      checklist on production spec.description. Critical assertions:
 *        - update_salla_config contains "list_service_kinds" (cross-phase
 *          reference; T-02-33).
 *        - get_salla_config contains "no config" or "not yet" (404-as-null
 *          semantic; T-02-30).
 *        - get_salla_connection contains "token" (omission contract;
 *          T-02-29).
 *   5. token-omission (0/1)              — STATIC source-inspection;
 *      readFile()s lib/tools/get-salla-connection.ts and asserts the
 *      destructure-and-discard pattern is present:
 *        - source contains "{ token: _token, ...connectionSafe }"
 *          (or close equivalent), AND
 *        - "connectionSafe" appears on the return path.
 *      Mirrors the auth-isolation pattern from plan 01-04 T-01-28 — a
 *      maintainer cannot land a regression on the Salla token-omission
 *      surface without simultaneously editing or deleting this scorer.
 *   6. four-oh-four-as-null (0/1)        — STATIC source-inspection;
 *      readFile()s lib/tools/get-salla-config.ts and asserts:
 *        - source contains "status === 404", AND
 *        - source contains "config: null" (the structured null-config
 *          response shape).
 *      Locks T-02-30 at the eval layer.
 *
 * Lenient by design — extras don't penalize.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as installSallaSpec } from "@/lib/tools/install-salla";
import { spec as getSallaConnectionSpec } from "@/lib/tools/get-salla-connection";
import { spec as getSallaPlatformDataSpec } from "@/lib/tools/get-salla-platform-data";
import { spec as getSallaConfigSpec } from "@/lib/tools/get-salla-config";
import { spec as updateSallaConfigSpec } from "@/lib/tools/update-salla-config";
import { spec as toggleSallaFulfillmentSpec } from "@/lib/tools/toggle-salla-fulfillment";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  install_salla: [],
  get_salla_connection: ["id"],
  get_salla_platform_data: ["connection_id"],
  get_salla_config: ["connection_id"],
  update_salla_config: ["connection_id"],
  toggle_salla_fulfillment: ["id", "is_fulfillment"],
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
    spec: installSallaSpec,
    substrings: [
      "/integrations/install/salla",
      "401",
      "list_integration_connections",
    ],
  },
  {
    spec: getSallaConnectionSpec,
    substrings: [
      "/integrations/connections/{id}",
      "401",
      // The token-omission contract — description MUST surface the word
      // "token" so the LLM understands why it cannot see one.
      "token",
    ],
  },
  {
    spec: getSallaPlatformDataSpec,
    substrings: [
      "/platform-data",
      "401",
      // LIVE-vs-SAVED disambiguation.
      "get_salla_config",
    ],
  },
  {
    spec: getSallaConfigSpec,
    substrings: [
      "/integrations/configs/",
      "401",
      // 404-as-null contract (T-02-30) — description MUST tell the LLM the
      // upstream 404 surfaces as a structured null response.
      "config: null",
    ],
  },
  {
    spec: updateSallaConfigSpec,
    substrings: [
      "/integrations/configs/",
      "401",
      // Cross-phase reference to list_service_kinds (T-02-33).
      "list_service_kinds",
    ],
  },
  {
    spec: toggleSallaFulfillmentSpec,
    substrings: [
      "/fulfillment",
      "401",
      "get_salla_connection",
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
 * STATIC source-inspection: token-omission contract on get_salla_connection
 * (T-02-29).
 *
 * Reads lib/tools/get-salla-connection.ts and asserts:
 *   - source contains the destructure-and-discard binding
 *     `{ token: _token, ...connectionSafe }` (so the upstream `token` field
 *     is dropped before anything is returned to the LLM); AND
 *   - source mentions `connectionSafe` on the return path.
 *
 * Score 1.0 if both substrings present; 0.0 otherwise.
 *
 * A maintainer cannot land a regression that re-leaks the token without
 * simultaneously editing or deleting this scorer — and either change is
 * visible in PR review. Mirrors the auth-isolation pattern from plan 01-04
 * T-01-28.
 */
const SALLA_CONNECTION_SOURCE_PATH = "lib/tools/get-salla-connection.ts";

export const tokenOmission: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  const failures: string[] = [];
  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), SALLA_CONNECTION_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "token-omission",
      value: 0.0,
      comment: `read failed for ${SALLA_CONNECTION_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }

  // Allow either `_token` or `token: _token` style — anchor on the
  // `...connectionSafe` rest binding which is the LOAD-BEARING bit.
  if (!raw.includes("...connectionSafe")) {
    failures.push(
      `${SALLA_CONNECTION_SOURCE_PATH}: missing "...connectionSafe" rest-destructure of the upstream connection object (T-02-29 token strip)`,
    );
  }
  if (!raw.includes("token: _token")) {
    failures.push(
      `${SALLA_CONNECTION_SOURCE_PATH}: missing "token: _token" discard binding (T-02-29 token strip)`,
    );
  }
  // The unwrapped + sanitised object MUST flow back to the caller.
  if (!raw.includes("JSON.stringify(connectionSafe")) {
    failures.push(
      `${SALLA_CONNECTION_SOURCE_PATH}: missing "JSON.stringify(connectionSafe" on the return path`,
    );
  }

  return {
    name: "token-omission",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "get-salla-connection.ts strips token via destructure-and-discard before returning"
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC source-inspection: 404-as-null contract on get_salla_config
 * (T-02-30).
 *
 * Reads lib/tools/get-salla-config.ts and asserts:
 *   - source contains "status === 404" (the explicit 404 branch); AND
 *   - source contains "config: null" (the structured null-config response
 *     shape).
 *
 * Score 1.0 if both substrings present; 0.0 otherwise.
 */
const SALLA_CONFIG_SOURCE_PATH = "lib/tools/get-salla-config.ts";

export const fourOhFourAsNull: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  const failures: string[] = [];
  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), SALLA_CONFIG_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "four-oh-four-as-null",
      value: 0.0,
      comment: `read failed for ${SALLA_CONFIG_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }

  if (!raw.includes("status === 404")) {
    failures.push(
      `${SALLA_CONFIG_SOURCE_PATH}: missing "status === 404" branch (T-02-30 404-as-null)`,
    );
  }
  if (!raw.includes("config: null")) {
    failures.push(
      `${SALLA_CONFIG_SOURCE_PATH}: missing "config: null" structured null-config response (T-02-30)`,
    );
  }

  return {
    name: "four-oh-four-as-null",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "get-salla-config.ts surfaces upstream 404 as { config: null } structured response"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  tokenOmission,
  fourOhFourAsNull,
];
