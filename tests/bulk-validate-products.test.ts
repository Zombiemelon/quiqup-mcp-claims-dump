import { describe, it, expect } from "vitest";

describe("bulk_validate_products (disabled-pending-M6)", () => {
  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/bulk-validate-products");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("bulk_validate_products");
      expect(mod.spec.description).toMatch(/bulk|validate/i);

      // file_base64 + filename are the standard MCP shape for a CSV upload.
      const result = mod.spec.inputSchema.safeParse({
        file_base64: "c2t1LG5hbWUKQUJDLEZvbw==",
        filename: "products.csv",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing file_base64", async () => {
      const mod = await import("../lib/tools/bulk-validate-products");
      const result = mod.spec.inputSchema.safeParse({ filename: "products.csv" });
      expect(result.success).toBe(false);
    });

    it("rejects missing filename", async () => {
      const mod = await import("../lib/tools/bulk-validate-products");
      const result = mod.spec.inputSchema.safeParse({ file_base64: "abc" });
      expect(result.success).toBe(false);
    });
  });

  describe("disabled handler", () => {
    it("throws an M6-guardrail error when invoked", async () => {
      const mod = await import("../lib/tools/bulk-validate-products");
      await expect(
        mod.spec.handler(
          {
            userId: "u_1",
            orgId: null,
            sessionId: null,
            scopes: [],
            bearerToken: null,
          },
          { file_base64: "abc", filename: "x.csv" },
        ),
      ).rejects.toThrow(/disabled pending M6/);
    });
  });
});
