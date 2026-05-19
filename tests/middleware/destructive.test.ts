/**
 * Unit tests for the destructive-gate helpers at lib/middleware/destructive.ts.
 *
 * Scope: helper functions in isolation — no MCP server, no MSW, no Quiqup
 * mocks. Integration coverage (the gate applied through real tool handlers
 * with MSW request-count assertions) lives in tests/tools/destructive-integrations.test.ts.
 */

import { describe, it, expect } from "vitest";
import {
  destructiveConfirmField,
  destructiveDryRunField,
  ConfirmationRequiredError,
  requireConfirm,
  isDryRun,
  buildConfirmationRequiredResult,
} from "@/lib/middleware/destructive";

describe("destructiveConfirmField", () => {
  it("accepts undefined (optional)", () => {
    expect(destructiveConfirmField.safeParse(undefined).success).toBe(true);
  });

  it("accepts false", () => {
    const parsed = destructiveConfirmField.safeParse(false);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(false);
  });

  it("accepts true", () => {
    const parsed = destructiveConfirmField.safeParse(true);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(true);
  });

  it("rejects non-boolean values (no coercion)", () => {
    expect(destructiveConfirmField.safeParse(1).success).toBe(false);
    expect(destructiveConfirmField.safeParse("true").success).toBe(false);
    expect(destructiveConfirmField.safeParse(null).success).toBe(false);
    expect(destructiveConfirmField.safeParse({}).success).toBe(false);
  });

  it("description carries the canonical DESTRUCTIVE-GATE phrase", () => {
    expect(destructiveConfirmField.description).toContain("DESTRUCTIVE-GATE");
    expect(destructiveConfirmField.description).toContain("MUST be set to true");
  });
});

describe("destructiveDryRunField", () => {
  it("defaults to false when omitted", () => {
    const parsed = destructiveDryRunField.safeParse(undefined);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(false);
  });

  it("accepts true", () => {
    const parsed = destructiveDryRunField.safeParse(true);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(true);
  });

  it("accepts false", () => {
    const parsed = destructiveDryRunField.safeParse(false);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(false);
  });

  it("rejects non-boolean values", () => {
    expect(destructiveDryRunField.safeParse("true").success).toBe(false);
    expect(destructiveDryRunField.safeParse(1).success).toBe(false);
  });
});

describe("requireConfirm", () => {
  it("throws ConfirmationRequiredError when args.confirm is undefined", () => {
    expect(() =>
      requireConfirm("delete_thing", {}, "thing id abc"),
    ).toThrow(ConfirmationRequiredError);
  });

  it("throws when args.confirm === false", () => {
    expect(() =>
      requireConfirm("delete_thing", { confirm: false }, "thing id abc"),
    ).toThrow(ConfirmationRequiredError);
  });

  it("throws when args.confirm is a truthy non-boolean (no coercion)", () => {
    // The Zod field rejects non-booleans at parse time, but the runtime gate
    // also strict-equals against `true` so a misuse cannot bypass the gate.
    expect(() =>
      requireConfirm(
        "delete_thing",
        { confirm: "true" as unknown as boolean },
        "thing id abc",
      ),
    ).toThrow(ConfirmationRequiredError);
    expect(() =>
      requireConfirm(
        "delete_thing",
        { confirm: 1 as unknown as boolean },
        "thing id abc",
      ),
    ).toThrow(ConfirmationRequiredError);
  });

  it("does NOT throw when args.confirm === true", () => {
    expect(() =>
      requireConfirm("delete_thing", { confirm: true }, "thing id abc"),
    ).not.toThrow();
  });

  it("the thrown error has toolName + resourceDescription as readonly fields", () => {
    try {
      requireConfirm("delete_thing", {}, "thing id abc");
      throw new Error("requireConfirm did not throw — test setup broken");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfirmationRequiredError);
      const ce = err as ConfirmationRequiredError;
      expect(ce.toolName).toBe("delete_thing");
      expect(ce.resourceDescription).toBe("thing id abc");
      expect(ce.name).toBe("ConfirmationRequiredError");
    }
  });
});

describe("isDryRun", () => {
  it("returns true for args.dry_run === true", () => {
    expect(isDryRun({ dry_run: true })).toBe(true);
  });

  it("returns false for omitted dry_run", () => {
    expect(isDryRun({})).toBe(false);
  });

  it("returns false for explicit dry_run: false", () => {
    expect(isDryRun({ dry_run: false })).toBe(false);
  });

  it("returns false for undefined dry_run", () => {
    expect(isDryRun({ dry_run: undefined })).toBe(false);
  });

  it("returns false for truthy non-boolean dry_run (strict equality)", () => {
    expect(isDryRun({ dry_run: 1 as unknown as boolean })).toBe(false);
    expect(isDryRun({ dry_run: "true" as unknown as boolean })).toBe(false);
  });
});

describe("buildConfirmationRequiredResult", () => {
  it("returns isError: true with a single text block", () => {
    const err = new ConfirmationRequiredError(
      "delete_integration_source",
      "shopify connection for shop \"acme\"",
    );
    const result = buildConfirmationRequiredResult(err);
    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
  });

  it("text contains toolName, resourceDescription, and the literal 'confirm: true'", () => {
    const err = new ConfirmationRequiredError(
      "delete_integration_source",
      "shopify connection for shop \"acme\"",
    );
    const result = buildConfirmationRequiredResult(err);
    const text = result.content[0].text;
    expect(text).toContain("delete_integration_source");
    expect(text).toContain("shopify connection for shop \"acme\"");
    expect(text).toContain("confirm: true");
  });

  it("text states no upstream call was made (so the LLM cannot assume partial state)", () => {
    const err = new ConfirmationRequiredError("delete_salla_connection", "Salla connection id c1");
    const result = buildConfirmationRequiredResult(err);
    expect(result.content[0].text.toLowerCase()).toContain("no upstream call");
  });
});
