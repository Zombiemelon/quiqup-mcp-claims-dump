import { describe, it, expect } from "vitest";

describe("bulk_commit_products (disabled-pending-M6)", () => {
  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/bulk-commit-products");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("bulk_commit_products");
      expect(mod.spec.description).toMatch(/bulk|commit/i);

      const result = mod.spec.inputSchema.safeParse({ upload_id: "UPL_ABC" });
      expect(result.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing upload_id", async () => {
      const mod = await import("../lib/tools/bulk-commit-products");
      const result = mod.spec.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-string upload_id", async () => {
      const mod = await import("../lib/tools/bulk-commit-products");
      const result = mod.spec.inputSchema.safeParse({ upload_id: 123 });
      expect(result.success).toBe(false);
    });
  });

  describe("disabled handler", () => {
    it("throws an M6-guardrail error when invoked", async () => {
      const mod = await import("../lib/tools/bulk-commit-products");
      await expect(
        mod.spec.handler(
          {
            userId: "u_1",
            orgId: null,
            sessionId: null,
            scopes: [],
            bearerToken: null,
          },
          { upload_id: "UPL_ABC" },
        ),
      ).rejects.toThrow(/disabled pending M6/);
    });
  });
});
