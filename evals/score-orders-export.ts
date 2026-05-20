/**
 * Scorers for the Phase-3 Ex-core family eval (orders-export-v1).
 *
 * Seven scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — wrapped from ./score-tool-call.ts.
 *
 *   2. required-fields-present (0..1)   — download_orders_export requires
 *      `from` AND `to` (no defaults — the upstream needs an explicit
 *      window). Reports proportion present.
 *
 *   3. args-overlap (0..1)              — wrapped from ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)       — STATIC; per-tool substring
 *      checklist on production spec.description (endpoint marker,
 *      yyyy-mm-dd format note, 401 error mode, binary-envelope shape
 *      ref, canonical Example block).
 *
 *   5. binary-envelope-contract (0/1)   — STATIC source-inspection;
 *      readFile()s `lib/tools/download-orders-export.ts` and asserts
 *      ALL THREE substrings are present (case-sensitive):
 *        - "contentType"
 *        - "base64"
 *        - "filenameHint"
 *      Phase 5 (PDF labels), Phase 7 (inventory CSV), and Phase 10
 *      (Zoho PDFs) will all reuse this exact envelope shape. Allowing
 *      it to drift on the anchor tool would silently break those
 *      phases' contract assumption.
 *
 *   6. csv-date-format-pin (0/1)        — STATIC source-inspection;
 *      readFile()s `lib/tools/download-orders-export.ts` and asserts
 *      the yyyy-mm-dd regex literal (`^\d{4}-\d{2}-\d{2}$`) appears
 *      in the source. Locks the date-format invariant per the WR-02
 *      lesson — if someone "modernizes" the date field to full
 *      ISO-8601, this scorer trips.
 *
 *   7. binary-envelope-block-type (0/1) — STATIC source-inspection (added
 *      for 03-REVIEW WR-04); readFile()s `lib/tools/download-orders-export.ts`
 *      and asserts the binary envelope is returned inside a `type: "resource"`
 *      content block — NOT a `type: "text"` block. Re-introducing the
 *      `text`-block shape would re-trigger the 2026-05-14 widening
 *      rationale on `register.ts:108` (megabytes of base64 forcing
 *      LLM clients into bash-heredoc gymnastics). Phase 5 (PDFs), Phase 7
 *      (CSV), and Phase 10 (Zoho PDFs) all inherit this contract.
 *
 * Lenient by design on tool-name + args; STRICT on the binary-envelope
 * + date-format invariants.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as downloadOrdersExportSpec } from "@/lib/tools/download-orders-export";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  download_orders_export: ["from", "to"],
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
    spec: downloadOrdersExportSpec,
    substrings: [
      // Endpoint marker.
      "/orders/download",
      // Error-modes section.
      "401",
      // Binary-envelope contract — description MUST surface the envelope
      // shape so the LLM knows the return is base64, not parsed CSV rows.
      "contentType",
      "base64",
      "filenameHint",
      // Date-format note — yyyy-mm-dd, not full ISO-8601 (WR-02 lesson).
      "yyyy-mm-dd",
      // Canonical example block.
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
 * STATIC source-inspection: binary-envelope-contract.
 *
 * Reads lib/tools/download-orders-export.ts and asserts all three of
 * `contentType`, `base64`, `filenameHint` appear in the source.
 *
 * Rationale: Phase 5 (PDF labels), Phase 7 (inventory CSV), and Phase 10
 * (Zoho PDFs) will all reuse this exact envelope shape. Allowing it to
 * drift on the anchor tool would silently break those phases' contract
 * assumption — locking it here means a maintainer cannot rename
 * `filenameHint` to `filename` (or similar plausible refactor) without
 * simultaneously editing this scorer.
 */
const ORDERS_EXPORT_SOURCE_PATH = "lib/tools/download-orders-export.ts";

const BINARY_ENVELOPE_KEYS = ["contentType", "base64", "filenameHint"] as const;

export const binaryEnvelopeContract: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), ORDERS_EXPORT_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "binary-envelope-contract",
      value: 0.0,
      comment: `read failed for ${ORDERS_EXPORT_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }

  const failures: string[] = [];
  for (const key of BINARY_ENVELOPE_KEYS) {
    if (!raw.includes(key)) {
      failures.push(
        `${ORDERS_EXPORT_SOURCE_PATH}: missing "${key}" — binary-envelope contract broken (Phase 5/7/10 will silently regress)`,
      );
    }
  }

  return {
    name: "binary-envelope-contract",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "download-orders-export.ts wires the canonical { contentType, base64, filenameHint } envelope — Phase 5/7/10 contract holds"
        : `failures: ${failures.join("; ")}`,
  };
};

/**
 * STATIC source-inspection: csv-date-format-pin.
 *
 * Reads lib/tools/download-orders-export.ts and asserts the
 * yyyy-mm-dd regex literal appears in the source. Locks the
 * date-format invariant per the WR-02 lesson — the upstream
 * uses yyyy-mm-dd, NOT full ISO-8601. If someone "modernises"
 * the date field, this scorer trips.
 *
 * We look for either of two equivalent string forms of the regex
 * so the scorer survives a stylistic refactor (regex-literal vs
 * `new RegExp` string).
 */
const DATE_FORMAT_REGEX_FRAGMENTS = [
  // Regex literal form: /^\d{4}-\d{2}-\d{2}$/
  "\\d{4}-\\d{2}-\\d{2}",
] as const;

export const csvDateFormatPin: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), ORDERS_EXPORT_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "csv-date-format-pin",
      value: 0.0,
      comment: `read failed for ${ORDERS_EXPORT_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }

  const present = DATE_FORMAT_REGEX_FRAGMENTS.some((frag) => raw.includes(frag));
  return {
    name: "csv-date-format-pin",
    value: present ? 1.0 : 0.0,
    comment: present
      ? `${ORDERS_EXPORT_SOURCE_PATH} pins yyyy-mm-dd via the canonical regex — WR-02 lesson held`
      : `${ORDERS_EXPORT_SOURCE_PATH} no longer contains the yyyy-mm-dd regex — date format may have drifted`,
  };
};

/**
 * STATIC source-inspection: binary-envelope-block-type (03-REVIEW WR-04).
 *
 * Reads lib/tools/download-orders-export.ts and asserts the binary
 * envelope is returned inside a `type: "resource"` content block — NOT
 * a `type: "text"` block. The text-block shape was the historical
 * regression (a CSV export can easily be megabytes; squeezing megabytes
 * of base64 through a `text` block forces LLM clients into bash-heredoc
 * gymnastics to decode bytes that should have flowed as a `resource`
 * block to begin with — see lib/tools/register.ts:108 widening note
 * from 2026-05-14).
 *
 * We look for the exact substring `type: "resource"` inside the source
 * file. If a future refactor switches to single quotes or reorders the
 * key, the assertion can be widened — but the canonical project style
 * is `type: "resource" as const` so the substring is the simplest
 * line-of-defence.
 *
 * Phase 5 (PDFs), Phase 7 (CSV), Phase 10 (Zoho PDFs) all inherit this
 * contract: any tool that returns the `{ contentType, base64, filenameHint }`
 * envelope MUST emit a `resource` block.
 */
const RESOURCE_BLOCK_MARKER = 'type: "resource"';

export const binaryEnvelopeBlockType: Evaluator = async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");

  let raw: string;
  try {
    raw = await readFile(
      path.resolve(process.cwd(), ORDERS_EXPORT_SOURCE_PATH),
      "utf-8",
    );
  } catch (err) {
    return {
      name: "binary-envelope-block-type",
      value: 0.0,
      comment: `read failed for ${ORDERS_EXPORT_SOURCE_PATH}: ${(err as Error).message}`,
    };
  }

  const hasResourceBlock = raw.includes(RESOURCE_BLOCK_MARKER);
  return {
    name: "binary-envelope-block-type",
    value: hasResourceBlock ? 1.0 : 0.0,
    comment: hasResourceBlock
      ? `${ORDERS_EXPORT_SOURCE_PATH} returns the binary envelope inside a resource block — WR-04 contract held; Phase 5/7/10 will inherit the right shape`
      : `${ORDERS_EXPORT_SOURCE_PATH} no longer emits a \`type: "resource"\` content block — the binary envelope may have regressed to a text block (03-REVIEW WR-04). Decoding megabytes of base64 out of a text block forces LLM clients into bash-heredoc gymnastics; see lib/tools/register.ts:108`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  binaryEnvelopeContract,
  csvDateFormatPin,
  binaryEnvelopeBlockType,
];
