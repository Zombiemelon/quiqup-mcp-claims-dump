import { describe, it, expect } from "vitest";
import { argsOverlap, toolNameMatch } from "../../evals/score-tool-call";

const ctx = (output: unknown, expectedOutput: unknown) =>
  ({
    input: { request: "test" },
    output,
    expectedOutput,
  }) as Parameters<typeof argsOverlap>[0];

describe("argsOverlap", () => {
  it("returns 1.0 when both expected and actual args are empty (no-arg tool happy path)", async () => {
    const r = await argsOverlap(
      ctx({ tool: "list_x", args: {} }, { tool: "list_x", args: {} }),
    );
    expect(r.value).toBe(1.0);
  });

  it("returns 1.0 when expected has no args even if LLM volunteered extras (lenient on extras)", async () => {
    const r = await argsOverlap(
      ctx(
        { tool: "list_x", args: { environment: "production" } },
        { tool: "list_x", args: {} },
      ),
    );
    expect(r.value).toBe(1.0);
  });

  it("returns full match when every leaf matches", async () => {
    const r = await argsOverlap(
      ctx(
        { tool: "x", args: { site_url: "https://acme.test", country: ["AE"] } },
        { tool: "x", args: { site_url: "https://acme.test", country: ["AE"] } },
      ),
    );
    expect(r.value).toBe(1.0);
  });

  it("returns partial score when some leaves missing", async () => {
    const r = await argsOverlap(
      ctx(
        { tool: "x", args: { a: "alpha" } },
        { tool: "x", args: { a: "alpha", b: "beta" } },
      ),
    );
    expect(r.value).toBeLessThan(1.0);
    expect(r.value).toBeGreaterThan(0);
  });

  it("string match is substring + case insensitive", async () => {
    const r = await argsOverlap(
      ctx(
        { tool: "x", args: { env: "PRODUCTION-us" } },
        { tool: "x", args: { env: "production" } },
      ),
    );
    expect(r.value).toBe(1.0);
  });
});

describe("toolNameMatch", () => {
  it("scores 1 when names match", async () => {
    const r = await toolNameMatch(ctx({ tool: "x" }, { tool: "x" }));
    expect(r.value).toBe(1.0);
  });

  it("scores 0 when names differ", async () => {
    const r = await toolNameMatch(ctx({ tool: "y" }, { tool: "x" }));
    expect(r.value).toBe(0);
  });
});
