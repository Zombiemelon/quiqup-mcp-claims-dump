import { describe, it, expect } from "vitest";

describe("create_product", () => {
  describe("registration", () => {
    it("registers under the expected name with required input schema", async () => {
      const mod = await import("../lib/tools/create-product");
      expect(mod.spec).toBeDefined();
      expect(mod.spec.name).toBe("create_product");
      expect(mod.spec.description).toMatch(/product/i);

      const result = mod.spec.inputSchema.safeParse({
        sku: "MCP-TEST-001",
        name: "MCP Test Product",
        selling_price: 1000,
        currency: "AED",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("rejects missing sku", async () => {
      const mod = await import("../lib/tools/create-product");
      const result = mod.spec.inputSchema.safeParse({
        name: "x",
        selling_price: 1,
        currency: "AED",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing required fields surfaced by upstream (selling_price, currency)", async () => {
      const mod = await import("../lib/tools/create-product");
      const r1 = mod.spec.inputSchema.safeParse({ sku: "X", name: "x", currency: "AED" });
      expect(r1.success).toBe(false);
      const r2 = mod.spec.inputSchema.safeParse({ sku: "X", name: "x", selling_price: 1 });
      expect(r2.success).toBe(false);
    });

    it("rejects wrong-type selling_price", async () => {
      const mod = await import("../lib/tools/create-product");
      const result = mod.spec.inputSchema.safeParse({
        sku: "X",
        name: "x",
        selling_price: "lots",
        currency: "AED",
      });
      expect(result.success).toBe(false);
    });
  });
});
