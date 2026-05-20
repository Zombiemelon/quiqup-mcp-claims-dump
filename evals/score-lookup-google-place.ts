/**
 * Scorers for the Google Places family eval (lookup-google-place-v1).
 *
 * Five scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)           — did the LLM pick lookup_google_place?
 *      Wrapped from ./score-tool-call.ts so this file surfaces the literal
 *      `name: "tool-name-match"` for the eval-gate grep audit.
 *
 *   2. required-fields-present (0..1)  — place_id MUST be present.
 *      lookup_google_place has no default for place_id; field_mask is
 *      optional. The conditional is simpler than the Platform-read family's.
 *
 *   3. args-overlap (0..1)             — leaf-level overlap with expected args.
 *      Wrapped from ./score-tool-call.ts so the literal scorer name is owned
 *      by this file.
 *
 *   4. description-quality (0..1)      — STATIC scorer that does NOT depend
 *      on the LLM output. Asserts the production spec.description of
 *      lookup_google_place contains:
 *        - "GOOGLE_PLACES_API_KEY"     (env var documented),
 *        - "Clerk" OR "actor-token"     (auth-exception called out), and
 *        - "never returned"             (key-redaction policy stated).
 *      This is the eval-layer lock on the auth-isolation must-have.
 *
 *   5. auth-isolation (0/1)            — STATIC scorer that readFile()s
 *      `lib/tools/lookup-google-place.ts` and `lib/clients/google-places.ts`
 *      and asserts neither imports `getQuiqupReadyJwt`, `QuiqupLastmileClient`,
 *      or any Quiqup-bridge identifier. Duplicates the unit-test invariant
 *      from `tests/tools/google-places.test.ts` at the eval layer so the
 *      EVAL_GATE=1 CI step also enforces the isolation — a regression here
 *      now requires deleting/relocating this scorer, which is visible in
 *      PR review (T-01-28).
 *
 * Lenient by design — extras don't penalize, same philosophy as
 * ./score-tool-call.ts.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as lookupGooglePlaceSpec } from "@/lib/tools/lookup-google-place";

/**
 * Thin wrapper around the generic tool-call scorer so this file surfaces
 * `name: "tool-name-match"` for the eval-gate grep audit.
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
 * lookup_google_place hard-requires `place_id` (no .default()). field_mask
 * is optional — getting it right earns args-overlap points, but absence
 * does not penalise required-fields-present.
 */
export const requiredFieldsPresent: Evaluator = async ({ output }) => {
  const args =
    (output as { args?: Record<string, unknown> } | undefined)?.args ?? {};
  const present =
    "place_id" in args &&
    typeof args.place_id === "string" &&
    (args.place_id as string).length > 0;
  return {
    name: "required-fields-present",
    value: present ? 1.0 : 0.0,
    comment: present
      ? "place_id supplied"
      : "missing required `place_id` for lookup_google_place",
  };
};

const DESCRIPTION_LENGTH_MIN = 200;

/**
 * Description-quality assertions on the lookup_google_place ToolSpec.
 *
 * The substrings encode the AUTH-EXCEPTION language documented in the
 * tool's header comment + the implementation file. Without these, the
 * agent has no way to know lookup_google_place runs through the Google
 * key path (not Clerk → Quiqup), so the description-quality bar is set
 * at "every assertion must pass" (min 1.0 in the eval-gate config).
 */
export const descriptionQuality: Evaluator = async () => {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;

  const desc = lookupGooglePlaceSpec.description;

  // Length check (counts toward the score).
  total += 1;
  if (desc.length >= DESCRIPTION_LENGTH_MIN) {
    passed += 1;
  } else {
    failures.push(
      `description length ${desc.length} < ${DESCRIPTION_LENGTH_MIN}`,
    );
  }

  // Required substring: env-var name.
  total += 1;
  if (desc.includes("GOOGLE_PLACES_API_KEY")) {
    passed += 1;
  } else {
    failures.push('description missing "GOOGLE_PLACES_API_KEY"');
  }

  // Auth-exception language: at least one of "Clerk" or "actor-token".
  total += 1;
  if (desc.includes("Clerk") || desc.includes("actor-token")) {
    passed += 1;
  } else {
    failures.push('description missing "Clerk" or "actor-token"');
  }

  // Key-redaction policy statement.
  total += 1;
  if (desc.includes("never returned")) {
    passed += 1;
  } else {
    failures.push('description missing "never returned"');
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
 * Auth-isolation: source-string inspection of the implementation files.
 *
 * The lookup_google_place tool + GooglePlacesClient MUST NOT IMPORT or
 * CALL any Quiqup-bridge identifier (`getQuiqupReadyJwt`,
 * `QuiqupLastmileClient`). This duplicates the unit-test invariant in
 * tests/tools/google-places.test.ts at the eval layer so CI EVAL_GATE=1
 * also enforces the isolation. A regression here now requires
 * deleting/relocating BOTH this scorer AND the unit test — two
 * PR-visible signals (T-01-28 mitigation).
 *
 * Important: this scorer strips line + block comments BEFORE inspecting
 * the source. Both files legitimately MENTION the forbidden identifiers
 * in their header comments to explain the auth-exception (T-01-28
 * documentation requirement); a naive substring search would report a
 * false positive against the very comments that exist to prevent the
 * regression.
 */
const FORBIDDEN_IDENTIFIERS = [
  "getQuiqupReadyJwt",
  "QuiqupLastmileClient",
] as const;

// Repo-root-relative paths the scorer reads. Resolved at call-time so the
// scorer works whether `bun run` is invoked from the repo root or from a
// nested directory (Bun's process.cwd() is the launch dir).
const TOOL_SOURCE_PATH = "lib/tools/lookup-google-place.ts";
const CLIENT_SOURCE_PATH = "lib/clients/google-places.ts";

/**
 * Strip /* ... *​/ block comments AND // line comments from a TS source
 * string. Deliberately a regex-only pass, not a real TS parser — false
 * positives on string-literal occurrences are accepted (none of the
 * forbidden identifiers are realistic substrings of a non-import string
 * literal in this codebase, and the unit test catches anything this
 * misses).
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (skip protocol-//-)
}

export const authIsolation: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  const failures: string[] = [];
  for (const rel of [TOOL_SOURCE_PATH, CLIENT_SOURCE_PATH]) {
    let raw: string;
    try {
      raw = await readFile(path.resolve(process.cwd(), rel), "utf-8");
    } catch (err) {
      failures.push(`${rel}: read failed (${(err as Error).message})`);
      continue;
    }
    const code = stripComments(raw);
    for (const ident of FORBIDDEN_IDENTIFIERS) {
      if (code.includes(ident)) {
        failures.push(`${rel}: must not contain "${ident}" in code`);
      }
    }
  }

  return {
    name: "auth-isolation",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "tool + client code (sans comments) is free of Quiqup-bridge identifiers"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  authIsolation,
];
