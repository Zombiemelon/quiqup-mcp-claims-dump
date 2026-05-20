/**
 * Scorers for the Phase-3 Orders Core REST family eval
 * (orders-document-upload-v1).
 *
 * Six scorers feed Langfuse traces:
 *
 *   1. tool-name-match (0/1)            — wrapped from ./score-tool-call.ts.
 *
 *   2. required-fields-present (0..1)   — upload_order_document hard-requires
 *      client_order_id + file_base64 + filename + content_type
 *      (document_type / admin_override / idempotency_key all default or
 *      are optional). Reports proportion present.
 *
 *   3. args-overlap (0..1)              — wrapped from ./score-tool-call.ts.
 *
 *   4. description-quality (0..1)       — STATIC; per-tool substring
 *      checklist on production spec.description.
 *
 *   5. no-caller-identity-fields (0/1)  — STATIC; imports the production
 *      spec and asserts Object.keys(spec.inputSchema.shape) contains NONE
 *      of the forbidden caller-identity field names. Locks the BL-04
 *      server-binding invariant — adding `user_id: z.string()` to the
 *      schema would surface that key in `.shape` and trip the scorer.
 *      Mirrors the confirm-gate-present pattern from
 *      ./score-destructive-integrations.ts (import production spec,
 *      inspect inputSchema.shape, structural assertion).
 *
 *   6. guardrails-block-present (0/1)   — STATIC; imports the production
 *      spec and asserts:
 *        - spec.guardrails?.audit === true
 *        - spec.guardrails?.idempotency?.keyArg === "idempotency_key"
 *        - spec.guardrails?.rateLimit?.capacity > 0
 *      Locks the BL-01 canonical guardrails block for write tools.
 *
 * Lenient by design on tool-name + args; STRICT on the server-binding +
 * guardrails invariants.
 */

import type { Evaluator } from "@langfuse/client";

import {
  toolNameMatch as _toolNameMatch,
  argsOverlap as _argsOverlap,
} from "./score-tool-call";

import { spec as uploadOrderDocumentSpec } from "@/lib/tools/upload-order-document";

export const toolNameMatch: Evaluator = async (ctx) => {
  const r = await _toolNameMatch(ctx);
  return { ...r, name: "tool-name-match" };
};

export const argsOverlap: Evaluator = async (ctx) => {
  const r = await _argsOverlap(ctx);
  return { ...r, name: "args-overlap" };
};

const REQUIRED_FIELDS: Record<string, readonly string[]> = {
  upload_order_document: [
    "client_order_id",
    "file_base64",
    "filename",
    "content_type",
  ],
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
    spec: uploadOrderDocumentSpec,
    substrings: [
      // Endpoint marker.
      "/orders-by-client-id/{clientOrderID}/documents",
      // Error-modes section.
      "401",
      // Identity-binding warning — description MUST tell the LLM not to
      // pass caller-supplied identity fields (BL-04 lesson).
      "user_id",
      // Idempotency note.
      "idempotency_key",
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
 * STATIC: no-caller-identity-fields — imports the production
 * upload_order_document spec and asserts Object.keys(inputSchema.shape)
 * contains NONE of the forbidden caller-identity field names.
 *
 * Locks BL-04: the uploader identity is bound server-side via
 * auth.userId. A maintainer cannot land `user_id: z.string()` (or any
 * sibling) on the input schema without simultaneously editing this
 * scorer — and either change is visible in PR review.
 *
 * Mirrors the confirm-gate-present pattern from
 * ./score-destructive-integrations.ts (import production spec, inspect
 * inputSchema.shape, structural assertion).
 *
 * Zod note: `.passthrough()` does NOT add keys to `.shape`, so an
 * upstream passthrough-style schema cannot bypass this check by hiding
 * the field outside `.shape`. Adding `user_id: z.string()` always
 * lands in `.shape`.
 */
const FORBIDDEN_IDENTITY_KEYS = [
  "user_id",
  "actor_id",
  "actor_email",
  "partner_id",
  "uploader_id",
  "actor",
] as const;

export const noCallerIdentityFields: Evaluator = async () => {
  const shape = (
    uploadOrderDocumentSpec.inputSchema as unknown as {
      shape: Record<string, unknown>;
    }
  ).shape;
  const keys = Object.keys(shape);
  const offenders = FORBIDDEN_IDENTITY_KEYS.filter((k) => keys.includes(k));
  return {
    name: "no-caller-identity-fields",
    value: offenders.length === 0 ? 1.0 : 0.0,
    comment:
      offenders.length === 0
        ? `upload_order_document.spec.inputSchema.shape has no caller-identity fields — BL-04 server-binding holds. Keys: [${keys.join(", ")}]`
        : `BL-04 VIOLATION: spec.inputSchema.shape contains forbidden caller-identity field(s): [${offenders.join(", ")}]`,
  };
};

/**
 * STATIC: guardrails-block-present — imports the production
 * upload_order_document spec and asserts the BL-01 canonical guardrails
 * block is wired correctly:
 *   - audit: true
 *   - idempotency.keyArg === "idempotency_key"
 *   - rateLimit.capacity > 0
 *
 * A maintainer cannot silently remove a guardrail (or rename the
 * idempotency key arg) without flipping this score to 0.
 */
export const guardrailsBlockPresent: Evaluator = async () => {
  const guardrails = (
    uploadOrderDocumentSpec as unknown as {
      guardrails?: {
        audit?: boolean;
        idempotency?: { keyArg?: string; ttlMs?: number };
        rateLimit?: { capacity?: number; refillPerSec?: number };
      };
    }
  ).guardrails;

  if (!guardrails) {
    return {
      name: "guardrails-block-present",
      value: 0.0,
      comment:
        "upload_order_document.spec.guardrails is missing — BL-01 canonical guardrails block not wired",
    };
  }

  const failures: string[] = [];
  if (guardrails.audit !== true) {
    failures.push("spec.guardrails.audit !== true (repudiation defence)");
  }
  if (guardrails.idempotency?.keyArg !== "idempotency_key") {
    failures.push(
      `spec.guardrails.idempotency.keyArg !== "idempotency_key" (got ${String(guardrails.idempotency?.keyArg ?? "<absent>")})`,
    );
  }
  if (!guardrails.rateLimit || (guardrails.rateLimit.capacity ?? 0) <= 0) {
    failures.push(
      `spec.guardrails.rateLimit.capacity must be > 0 (got ${String(guardrails.rateLimit?.capacity ?? "<absent>")})`,
    );
  }

  return {
    name: "guardrails-block-present",
    value: failures.length === 0 ? 1.0 : 0.0,
    comment:
      failures.length === 0
        ? "upload_order_document.spec.guardrails wires audit + idempotency(idempotency_key) + rateLimit — BL-01 canonical block intact"
        : `failures: ${failures.join("; ")}`,
  };
};

export const evaluators = [
  toolNameMatch,
  requiredFieldsPresent,
  argsOverlap,
  descriptionQuality,
  noCallerIdentityFields,
  guardrailsBlockPresent,
];
