import { describe, it, expect } from "vitest";

describe("update_product", () => {
  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/update-product");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("update_product");
      expect(mod.spec.description).toMatch(/product/i);

      const result = mod.spec.inputSchema.safeParse({
        sku: "MCP-TEST-001",
        patch: { name: "Renamed product" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing sku", async () => {
      const mod = await import("../lib/tools/update-product");
      const result = mod.spec.inputSchema.safeParse({ patch: { name: "x" } });
      expect(result.success).toBe(false);
    });

    it("rejects non-string sku", async () => {
      const mod = await import("../lib/tools/update-product");
      const result = mod.spec.inputSchema.safeParse({ sku: 123, patch: { name: "x" } });
      expect(result.success).toBe(false);
    });

    it("rejects empty patch object (must change at least one field)", async () => {
      const mod = await import("../lib/tools/update-product");
      const result = mod.spec.inputSchema.safeParse({ sku: "X", patch: {} });
      expect(result.success).toBe(false);
    });
  });
});
