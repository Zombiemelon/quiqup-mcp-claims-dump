/**
 * Canonical destructive-gate helpers — the SINGLE source for the `confirm: true`
 * + `dry_run` contract every DESTRUCTIVE tool in Phase 2 onwards uses.
 *
 * Why a shared helper (rather than per-tool inline checks):
 *   Every destructive tool in Phases 2/4/6/8/9/10 (delete_integration_source,
 *   delete_salla_connection, batch status transitions, cancel_inbound,
 *   delete_products, delete_dispatcher_rule_set, delete_stripe_payment_method, …)
 *   needs a uniform "MUST set confirm: true" gate so the LLM behaviour is
 *   identical across the surface. A shared helper enforces a uniform error
 *   message shape (so an LLM that learns the recovery on one tool reuses it
 *   for every destructive tool), a uniform Zod field description (so the
 *   `confirm` field renders the same string in every tool's surface), and a
 *   uniform dry-run semantic. Per-tool inline checks would drift.
 *
 * Why NOT integrated into registerTool's `guardrails` block:
 *   The destructive-confirm gate is a per-CALL invariant ("did this CALL set
 *   confirm: true?") whereas guardrails are per-TOOL config ("does this TOOL
 *   carry rate-limit / idempotency / audit?"). Packing the confirm gate into
 *   the guardrails block would force callers to either thread the runtime args
 *   into a guardrail constructor function (ugly) or special-case the gate
 *   inside the registerTool orchestrator (couples destructive semantics to
 *   the wrapper). Inline `requireConfirm()` at the top of the handler is the
 *   clearer chokepoint — greppable, testable in isolation, and the
 *   per-tool spec stays a pure declarative object.
 *
 * Why throw + catch + buildConfirmationRequiredResult (rather than return
 * directly from requireConfirm):
 *   A throw keeps the happy-path in the handler linear ("requireConfirm; then
 *   do the work") and lets the typed error carry the toolName + resource so
 *   tests can match on the structured payload. The handler catches the typed
 *   error at the top of its body and converts to a structured isError result
 *   — this avoids relying on the registerTool wrapper to know about
 *   destructive semantics.
 *
 * Future-phase contract — Phase 4 batch status transitions, Phase 6
 * (cancel_inbound + delete_products), Phase 8 SHPR-04, Phase 9 (delete_dispatcher_rule_set),
 * Phase 10 FIN-11 (delete_stripe_payment_method) MUST import these exports
 * DIRECTLY (no copy-paste, no rename). The exported names are part of the
 * library's stable surface; do not rename without coordinated updates across
 * every destructive tool that imports from this module.
 */

import { z } from "zod";

/**
 * Zod field added to every destructive tool's input schema. Optional boolean
 * — the gate's job is to reject anything that isn't strictly `true`, so we
 * lean on Zod for shape and on `requireConfirm` for the value check.
 */
export const destructiveConfirmField = z
  .boolean()
  .optional()
  .describe(
    "DESTRUCTIVE-GATE: MUST be set to true to actually perform the deletion. " +
      "If omitted or false, the tool returns a structured error naming the " +
      "resource that would have been deleted, and NO upstream call is made. " +
      "This is intentional — destructive operations require explicit caller intent.",
  );

/**
 * Optional dry-run flag. When true the handler short-circuits AFTER all
 * pre-flight checks (auth, scope, confirm) but BEFORE the upstream
 * destructive call — agents can verify scope and gate semantics without
 * irreversible action.
 */
export const destructiveDryRunField = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "DRY-RUN: If true, run every pre-flight check (auth, scope, confirm) but " +
      "DO NOT call the upstream destructive endpoint. Returns a structured " +
      "preview describing what WOULD have been deleted. Pair with confirm: true " +
      "to exercise the full gate without irreversible action.",
  );

/**
 * Typed error thrown by `requireConfirm` when the destructive gate is not
 * cleared. Carries the toolName + resourceDescription as readonly fields so
 * the catch site (and tests) can render a structured error result without
 * parsing the message string.
 */
export class ConfirmationRequiredError extends Error {
  public readonly toolName: string;
  public readonly resourceDescription: string;

  constructor(toolName: string, resourceDescription: string) {
    super(
      `Confirmation required: ${toolName} would delete ${resourceDescription}. ` +
        `Re-call with confirm: true to actually perform the deletion.`,
    );
    this.name = "ConfirmationRequiredError";
    this.toolName = toolName;
    this.resourceDescription = resourceDescription;
  }
}

/**
 * Throw `ConfirmationRequiredError` unless `args.confirm === true`. Call this
 * at the TOP of every destructive handler — BEFORE the JWT mint, BEFORE any
 * upstream work — so a missing-confirm call costs zero upstream traffic.
 *
 * Strict equality (not truthy): the only value that clears the gate is
 * boolean `true`. Strings ("true"), 1, etc. are rejected.
 */
export function requireConfirm(
  toolName: string,
  args: { confirm?: boolean | undefined },
  resourceDescription: string,
): void {
  if (args.confirm !== true) {
    throw new ConfirmationRequiredError(toolName, resourceDescription);
  }
}

/**
 * True iff caller passed `dry_run: true`. Callers should short-circuit AFTER
 * all pre-flight checks but BEFORE the upstream destructive call. Use
 * `requireConfirm` BEFORE `isDryRun` — dry-run does NOT bypass confirm
 * (T-02-39). To exercise dry-run the caller must ALSO set `confirm: true`,
 * which is intentional: dry-run means "I have confirmed; let me see what
 * would happen without doing it" — not "skip confirm because I'm only
 * dry-running".
 */
export function isDryRun(args: { dry_run?: boolean | undefined }): boolean {
  return args.dry_run === true;
}

/**
 * Sanitize a caller-supplied string for safe interpolation into the
 * confirmation-required error text (02-REVIEW WR-09).
 *
 * Two risks the bare-interpolation form had:
 *   1. Log injection — `id = "abc\nadmin_session: ..."` would land newline-
 *      separated tokens in the audit log line.
 *   2. PII / unintended disclosure — an LLM that copy-pastes a whole
 *      `list_integration_connections` row into the id arg gets the row
 *      echoed back in the error text.
 *
 * Cap length and strip control characters; the cap is generous (256) so
 * legitimate ids and shop_names are never truncated.
 */
export function sanitizeForResourceText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.slice(0, 256).replace(/[\r\n\t\x00-\x1f]+/g, " ");
}

/**
 * Convert a `ConfirmationRequiredError` into the structured MCP tool-result
 * shape callers return directly. The result is `isError: true` and the text
 * names the tool, the resource, and the literal `confirm: true` recovery
 * hint so the LLM caller has a copy-pasteable next step.
 */
export function buildConfirmationRequiredResult(err: ConfirmationRequiredError): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const text =
    `Confirmation required: \`${err.toolName}\` would delete ${err.resourceDescription}. ` +
    `NO upstream call was made. ` +
    `To perform the deletion, re-call \`${err.toolName}\` with the same arguments PLUS ` +
    `\`confirm: true\`. To preview without deleting, pair \`confirm: true\` with ` +
    `\`dry_run: true\`.`;
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}
